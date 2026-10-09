import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { secureHeaders, protectApi } from "./security-controls";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import * as path from "path";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy, AllowedMethods, OriginRequestPolicy, Function as EdgeFunction, FunctionCode, FunctionEventType,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin, HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ARecord, AaaaRecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

interface NotationAuthStackProps extends StackProps {
  /** Name of the legacy table the /import-device endpoint reads from. */
  legacyTableName: string;
  resourceSuffix?: string;
  certificateArn?: string;
  hostedZoneId?: string;
}

/**
 * The authenticated (instance B) stack: OAuth42-gated API over a fresh
 * songbook-partitioned table, plus S3+CloudFront hosting for its static
 * frontend. Fully parallel to NotationProd — the legacy stack and table
 * are never modified; the only coupling is a READ grant on the legacy
 * table for the one-shot device import.
 *
 * Only public OAuth configuration is synthesized; the client credential
 * is referenced from Secrets Manager and read by the runtime.
 */
export class NotationAuthStack extends Stack {
  constructor(scope: Construct, id: string, props: NotationAuthStackProps) {
    super(scope, id, props);

    if (!!props.certificateArn !== !!props.hostedZoneId) throw new Error("Provide both certificateArn and hostedZoneId for custom domains.");
    const chartDomain = props.certificateArn ? "charts.infermusic.ai" : undefined;
    const suffix = props.resourceSuffix ?? "";
    const isTest = suffix !== "";
    const appOrigins = ["https://d1ptfjofjtkwqr.cloudfront.net", ...(chartDomain ? [`https://${chartDomain}`] : [])];
    const clientId = process.env.OAUTH_CLIENT_ID ?? "oauth42_app_ce567578a0c9471dbb6f2cdec36b91f4";
    const sessions = new Table(this, "Sessions", {
      partitionKey: {name:"id", type:AttributeType.STRING}, billingMode:BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute:"ttl", removalPolicy:RemovalPolicy.RETAIN, deletionProtection:true,
      maxReadRequestUnits: 100, maxWriteRequestUnits: 50,
    });

    const table = new Table(this, "Table", {
      tableName: `NotationAppAuth${suffix}`,
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      deletionProtection: !isTest, timeToLiveAttribute: "ttl",
      maxReadRequestUnits: 100, maxWriteRequestUnits: 50,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: isTest ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
    });

    const legacyTable = Table.fromTableName(
      this,
      "LegacyTable",
      props.legacyTableName
    );

    const fn = new NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "..", "lambda", "handler-auth.ts"),
      runtime: Runtime.NODEJS_22_X,
      memorySize: 512,
      // The account cap is 10 and AWS requires those slots to stay unreserved.
      // API throttles provide app-specific limits.
      logGroup: new LogGroup(this, "HandlerLogs", { retention: RetentionDays.ONE_WEEK }),
      // Import copies whole legacy partitions (potentially thousands of
      // version rows) — needs more headroom than the 10s data routes.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        SESSION_TABLE_NAME: sessions.tableName,
        COOKIE_SESSIONS: "1",
        SESSION_MIGRATION_UNTIL: "2026-10-16T00:00:00Z",
        APP_ORIGINS: appOrigins.join(","),
        LEGACY_TABLE_NAME: props.legacyTableName,
        OAUTH_ISSUER: process.env.OAUTH_ISSUER ?? "https://api.oauth42.com",
        OAUTH_JWKS_URL:
          process.env.OAUTH_JWKS_URL ??
          "https://api.oauth42.com/.well-known/jwks.json",
        OAUTH_AUDIENCE: process.env.OAUTH_AUDIENCE ?? clientId,
        OAUTH_CLIENT_ID: clientId,
        OAUTH_CLIENT_SECRET_ID: "NotationApp/oauth42/client-secret",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: [],
      },
    });
    table.grantReadWriteData(fn);
    sessions.grantReadWriteData(fn);
    Secret.fromSecretNameV2(this, "OAuthClientSecret", "NotationApp/oauth42/client-secret").grantRead(fn);
    legacyTable.grantReadData(fn);

    // ── Static frontend: private bucket behind CloudFront ────────────────
    const siteBucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true, enforceSSL: true,
      removalPolicy: isTest ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isTest,
    });

    const distribution = new Distribution(this, "SiteDistribution", {
      ...(props.certificateArn ? {
        certificate: Certificate.fromCertificateArn(this, "SiteCertificate", props.certificateArn),
        domainNames: [chartDomain!],
      } : {}),
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: secureHeaders(this),
        functionAssociations: [{ eventType: FunctionEventType.VIEWER_REQUEST, function: new EdgeFunction(this, "StaticPath", { code: FunctionCode.fromInline("function handler(event) { var r = event.request; if (r.uri.endsWith('/')) r.uri += 'index.html'; return r; }") }) }],
      },
      defaultRootObject: "index.html",

    });

    if (props.hostedZoneId && chartDomain) {
      const zone = HostedZone.fromHostedZoneAttributes(this, "InferMusicZone", { hostedZoneId: props.hostedZoneId, zoneName: "infermusic.ai" });
      const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
      new ARecord(this, "ChartsAlias", { zone, recordName: chartDomain, target });
      new AaaaRecord(this, "ChartsAliasV6", { zone, recordName: chartDomain, target });
    }

    const api = new HttpApi(this, "Api", {
      apiName: `NotationAuthApi${suffix}`,
      corsPreflight: {
        allowOrigins: [
          ...appOrigins,
          ...(chartDomain ? [`https://${chartDomain}`] : []),
          "http://localhost:3000",
          "http://localhost:3001",
        ],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.PUT,
          CorsHttpMethod.POST,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["content-type", "authorization", "x-device-id"],
        maxAge: Duration.hours(1),
      },
    });

    distribution.addBehavior("/auth-api/*", new HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`), {
      allowedMethods: AllowedMethods.ALLOW_ALL, cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
      functionAssociations: [{ eventType: FunctionEventType.VIEWER_REQUEST, function: new EdgeFunction(this, "ApiPath", { code: FunctionCode.fromInline("function handler(event) { var r = event.request; r.uri = r.uri.substring(9); return r; }") }) }],
    });
    protectApi(this, api, fn, true);
    const integration = new HttpLambdaIntegration("Integration", fn);
    api.addRoutes({ path: "/oauth/session", methods: [HttpMethod.POST], integration });
    api.addRoutes({ path: "/oauth/logout", methods: [HttpMethod.POST], integration });
    api.addRoutes({ path: "/oauth/exchange", methods: [HttpMethod.POST], integration });
    api.addRoutes({ path: "/oauth/refresh", methods: [HttpMethod.POST], integration });
    api.addRoutes({ path: "/me", methods: [HttpMethod.GET], integration });
    api.addRoutes({ path: "/songbooks", methods: [HttpMethod.POST], integration });
    api.addRoutes({
      path: "/songbooks/{id}/members",
      methods: [HttpMethod.GET],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/members/{sub}",
      methods: [HttpMethod.DELETE],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/invites",
      methods: [HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/invites/{token}",
      methods: [HttpMethod.DELETE],
      integration,
    });
    api.addRoutes({
      path: "/invites/{token}/accept",
      methods: [HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/songs",
      methods: [HttpMethod.GET],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/songs/{songId}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/songs/{songId}/versions",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
    });
    api.addRoutes({
      path: "/songbooks/{id}/songs/{songId}/versions/{ts}",
      methods: [HttpMethod.GET],
      integration,
    });
    api.addRoutes({ path: "/import-device", methods: [HttpMethod.POST], integration });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "SiteBucketName", { value: siteBucket.bucketName });
    new CfnOutput(this, "SiteUrl", {
      value: `https://${chartDomain ?? distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}

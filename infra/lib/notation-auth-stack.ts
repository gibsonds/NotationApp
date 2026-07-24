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
  CachePolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Construct } from "constructs";

interface NotationAuthStackProps extends StackProps {
  /** Name of the legacy table the /import-device endpoint reads from. */
  legacyTableName: string;
  resourceSuffix?: string;
}

/**
 * The authenticated (instance B) stack: OAuth42-gated API over a fresh
 * songbook-partitioned table, plus S3+CloudFront hosting for its static
 * frontend. Fully parallel to NotationProd — the legacy stack and table
 * are never modified; the only coupling is a READ grant on the legacy
 * table for the one-shot device import.
 *
 * OAuth env comes from the deploy environment at synth time:
 *   OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET (portal registration values;
 *   secret only if OAuth42 registers us as a confidential client).
 */
export class NotationAuthStack extends Stack {
  constructor(scope: Construct, id: string, props: NotationAuthStackProps) {
    super(scope, id, props);

    const suffix = props.resourceSuffix ?? "";
    const isTest = suffix !== "";

    const table = new Table(this, "Table", {
      tableName: `NotationAppAuth${suffix}`,
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
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
      runtime: Runtime.NODEJS_20_X,
      memorySize: 512,
      // Import copies whole legacy partitions (potentially thousands of
      // version rows) — needs more headroom than the 10s data routes.
      timeout: Duration.seconds(30),
      environment: {
        TABLE_NAME: table.tableName,
        LEGACY_TABLE_NAME: props.legacyTableName,
        OAUTH_ISSUER: process.env.OAUTH_ISSUER ?? "https://api.oauth42.com",
        OAUTH_JWKS_URL:
          process.env.OAUTH_JWKS_URL ??
          "https://api.oauth42.com/.well-known/jwks.json",
        ...(process.env.OAUTH_AUDIENCE
          ? { OAUTH_AUDIENCE: process.env.OAUTH_AUDIENCE }
          : {}),
        OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID ?? "",
        OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET ?? "",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: [],
      },
    });
    table.grantReadWriteData(fn);
    legacyTable.grantReadData(fn);

    // ── Static frontend: private bucket behind CloudFront ────────────────
    const siteBucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isTest ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: isTest,
    });

    const distribution = new Distribution(this, "SiteDistribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      // Next static export uses real files per route; SPA-style deep links
      // (e.g. /?code=... callbacks are query-only so the root object covers
      // them). 404 → index.html keeps unknown paths usable.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    const api = new HttpApi(this, "Api", {
      apiName: `NotationAuthApi${suffix}`,
      corsPreflight: {
        allowOrigins: [
          `https://${distribution.distributionDomainName}`,
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

    const integration = new HttpLambdaIntegration("Integration", fn);
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
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}

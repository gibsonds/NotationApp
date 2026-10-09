import { secureHeaders } from "./security-controls";
import { CfnOutput, Fn, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { CachePolicy, Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { ARecord, AaaaRecord, HostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface InferMusicDomainProps {
  /** Attach custom names only after registration and DNS certificate validation. */
  certificateArn?: string;
  hostedZoneId?: string;
}

/** DNS is separate so nameservers can be delegated before requesting TLS. */
export class InferMusicDnsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const zone = new HostedZone(this, "Zone", { zoneName: "infermusic.ai" });
    zone.applyRemovalPolicy(RemovalPolicy.RETAIN);
    new CfnOutput(this, "HostedZoneId", { value: zone.hostedZoneId });
    new CfnOutput(this, "NameServers", { value: Fn.join(", ", zone.hostedZoneNameServers!) });
  }
}

/** Independent home/scales hosting; the charts database and API stay in NotationAuth. */
export class InferMusicStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & InferMusicDomainProps) {
    super(scope, id, props);
    if (!!props.certificateArn !== !!props.hostedZoneId) throw new Error("Provide both certificateArn and hostedZoneId for custom domains.");
    const zone = props.hostedZoneId ? HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: props.hostedZoneId, zoneName: "infermusic.ai" }) : undefined;
    const certificate = props.certificateArn ? Certificate.fromCertificateArn(this, "Certificate", props.certificateArn) : undefined;
    const bucket = new Bucket(this, "SiteBucket", { blockPublicAccess: BlockPublicAccess.BLOCK_ALL, versioned: true, enforceSSL: true, removalPolicy: RemovalPolicy.RETAIN });
    new CfnOutput(this, "SiteBucketName", { value: bucket.bucketName });
    const headers = secureHeaders(this);
    for (const [name, prefix, domains] of [
      ["Home", "/home", ["infermusic.ai", "www.infermusic.ai"]],
      ["Scales", "/scales", ["scales.infermusic.ai"]],
    ] as const) {
      const distribution = new Distribution(this, `${name}Distribution`, {
        defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(bucket, { originPath: prefix }), viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS, cachePolicy: CachePolicy.CACHING_OPTIMIZED, responseHeadersPolicy: headers },
        defaultRootObject: "index.html",
        ...(certificate ? { certificate, domainNames: [...domains] } : {}),
      });
      if (zone) for (const domain of domains) {
        const target = RecordTarget.fromAlias(new CloudFrontTarget(distribution));
        new ARecord(this, `${name}-${domain}-A`, { zone, recordName: domain, target });
        new AaaaRecord(this, `${name}-${domain}-AAAA`, { zone, recordName: domain, target });
      }
      new CfnOutput(this, `${name}DistributionId`, { value: distribution.distributionId });
      new CfnOutput(this, `${name}Url`, { value: `https://${certificate ? domains[0] : distribution.distributionDomainName}` });
    }
  }
}

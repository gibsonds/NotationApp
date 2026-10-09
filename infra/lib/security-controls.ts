import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { HttpApi, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { ResponseHeadersPolicy, HeadersFrameOption, HeadersReferrerPolicy } from 'aws-cdk-lib/aws-cloudfront';

export function secureHeaders(scope: Construct) {
  return new ResponseHeadersPolicy(scope, 'SecurityHeaders', {
    securityHeadersBehavior: {
      contentTypeOptions: { override: true },
      frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
      referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.NO_REFERRER, override: true },
      strictTransportSecurity: { accessControlMaxAge: Duration.days(365), override: true },
      // Static HTML receives a second, hash-based script policy at publication.
      contentSecurityPolicy: { contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.anthropic.com https://api.openai.com https://*.execute-api.us-east-1.amazonaws.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", override: true },
    },
    customHeadersBehavior: { customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()', override: true }] },
  });
}
export function protectApi(scope: Construct, api: HttpApi, fn: LambdaFunction, hasOAuth = false) {
  const logs = new LogGroup(scope, 'ApiAccessLogs', { retention: RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });
  const stage = api.defaultStage!.node.defaultChild as CfnStage;
  stage.defaultRouteSettings = { throttlingRateLimit: 15, throttlingBurstLimit: 30, detailedMetricsEnabled: true };
  // This untyped CloudFormation map requires CloudFormation's property casing.
  if (hasOAuth) stage.routeSettings = { 'POST /oauth/exchange': { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 } };
  // No IP, user agent, subject, headers, raw URL, query, or body.
  stage.accessLogSettings = { destinationArn: logs.logGroupArn, format: JSON.stringify({ requestId: '$context.requestId', route: '$context.routeKey', status: '$context.status', latency: '$context.responseLatency' }) };
  for (const [name, metric, threshold] of [
    ['Errors', fn.metricErrors({period:Duration.minutes(5)}), 5],
    ['Throttles', fn.metricThrottles({period:Duration.minutes(5)}), 10],
    ['ApiTraffic', api.metricCount({period:Duration.minutes(5)}), 1000],
  ] as const) new Alarm(scope, name+'Alarm', { metric, threshold, evaluationPeriods: 1, comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD, treatMissingData: TreatMissingData.NOT_BREACHING });
}

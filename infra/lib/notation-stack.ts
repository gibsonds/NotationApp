import * as path from "path";
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export class NotationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, "Table", {
      tableName: "NotationApp",
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: AttributeType.STRING },
    });

    const fn = new NodejsFunction(this, "Handler", {
      entry: path.join(__dirname, "..", "lambda", "handler.ts"),
      runtime: Runtime.NODEJS_20_X,
      memorySize: 512,
      timeout: Duration.seconds(10),
      environment: { TABLE_NAME: table.tableName },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: [],
      },
    });
    table.grantReadWriteData(fn);

    const integration = new HttpLambdaIntegration("Integration", fn);
    const api = new HttpApi(this, "Api", {
      apiName: "NotationApi",
      corsPreflight: {
        allowOrigins: ["https://gibsonds.github.io", "http://localhost:3000"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["content-type", "x-device-id"],
        maxAge: Duration.hours(1),
      },
    });

    api.addRoutes({ path: "/songs", methods: [HttpMethod.GET], integration });
    api.addRoutes({
      path: "/songs/{id}",
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      integration,
    });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "TableName", { value: table.tableName });
  }
}

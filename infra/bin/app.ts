#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { NotationStack } from "../lib/notation-stack";

const app = new App();
new NotationStack(app, "NotationProd", {
  env: { account: "637423285747", region: "us-east-1" },
});

// Test stack — separate DynamoDB table + API + Lambda, so cloud-schema
// changes can be exercised without touching prod data. Deploy with
// `cdk deploy NotationTest`. Resource names are suffixed with `-test`.
new NotationStack(app, "NotationTest", {
  env: { account: "637423285747", region: "us-east-1" },
  resourceSuffix: "-test",
});

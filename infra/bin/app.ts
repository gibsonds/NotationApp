#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { NotationStack } from "../lib/notation-stack";
import { NotationAuthStack } from "../lib/notation-auth-stack";

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

// Instance B: the OAuth42-authenticated, songbook-partitioned instance
// (issue #74/#76). Fully parallel to NotationProd — its own table, API,
// and CloudFront-hosted frontend. Only coupling: a read grant on the
// legacy table for one-shot device imports. Deploy with
// `cdk deploy NotationAuth`.
new NotationAuthStack(app, "NotationAuth", {
  env: { account: "637423285747", region: "us-east-1" },
  legacyTableName: "NotationApp",
});

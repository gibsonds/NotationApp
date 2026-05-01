#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { NotationStack } from "../lib/notation-stack";

const app = new App();
new NotationStack(app, "NotationProd", {
  env: { account: "637423285747", region: "us-east-1" },
});

/**
 * Seed script for DynamoDB Local: creates the auth-instance table (and a
 * stand-in legacy table so /import-device can be exercised locally).
 * Idempotent — existing tables are left alone.
 */
import {
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  endpoint: process.env.DDB_ENDPOINT ?? "http://localhost:8000",
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

const TABLES = [
  process.env.TABLE_NAME ?? "NotationAppAuth-local",
  process.env.LEGACY_TABLE_NAME ?? "NotationApp-local",
];

async function main() {
  const existing = new Set((await client.send(new ListTablesCommand({}))).TableNames);
  for (const name of TABLES) {
    if (existing.has(name)) {
      console.log(`[create-tables] ${name} exists`);
      continue;
    }
    await client.send(
      new CreateTableCommand({
        TableName: name,
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    console.log(`[create-tables] created ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

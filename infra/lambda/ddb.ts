/**
 * Shared DynamoDB client + helpers for the authenticated (songbook-model)
 * API. The legacy modules (repo.ts / handler.ts) intentionally do NOT use
 * this file — they stay byte-for-byte untouched so the legacy instance
 * carries zero risk from the NotationAuth work.
 *
 * DDB_ENDPOINT (optional) points the client at DynamoDB Local for the
 * docker-compose dev environment; unset in Lambda.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient(
    process.env.DDB_ENDPOINT
      ? {
          endpoint: process.env.DDB_ENDPOINT,
          region: process.env.AWS_REGION ?? "us-east-1",
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "local",
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "local",
          },
        }
      : {}
  )
);

export const TABLE = process.env.TABLE_NAME!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;

/** Drain a Query past DynamoDB's ~1MB page limit. Same rationale as the
 *  legacy repo.ts fix: a single page silently drops items past the
 *  boundary, which is how songs "disappeared" from the legacy instance. */
export async function queryAll(
  input: ConstructorParameters<typeof QueryCommand>[0]
): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({ ...input, ExclusiveStartKey: startKey })
    );
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** Split items into BatchWrite chunks of `size` (DynamoDB caps at 25). */
export function chunk<T>(items: T[], size = 25): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** BatchWrite puts with unprocessed-item retry and jittered backoff. */
export async function batchPutAll(table: string, items: Item[]): Promise<void> {
  for (const group of chunk(items)) {
    let pending: Item[] = group;
    let attempt = 0;
    while (pending.length > 0) {
      const out = await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [table]: pending.map((Item) => ({ PutRequest: { Item } })),
          },
        })
      );
      const un = out.UnprocessedItems?.[table] ?? [];
      pending = un
        .map((r) => r.PutRequest?.Item)
        .filter((i): i is Item => !!i);
      if (pending.length > 0) {
        attempt += 1;
        if (attempt > 8) throw new Error("batch write retries exhausted");
        // Deterministic-ish exponential backoff with mild jitter.
        const delay = Math.min(2000, 50 * 2 ** attempt) + (attempt * 37) % 50;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

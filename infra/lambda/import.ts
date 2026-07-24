/**
 * One-shot import of a legacy device songbook (DEVICE#<id> partition in
 * the OLD NotationApp table) into a songbook in the new authed table.
 *
 * - Idempotency marker `pk DEVICE#<id>, sk IMPORT#` in the NEW table,
 *   written create-only. Same-user rerun resumes/merges (safe: copies are
 *   conditional); a different user gets 409 — first import wins.
 * - Copy, not move: the legacy instance keeps working untouched.
 * - Songs: conditional puts (newest updatedAt wins) so re-imports and
 *   overlapping imports merge instead of clobbering.
 * - Versions: batched puts; identical keys overwrite identically.
 */
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, TABLE, batchPutAll, type Item } from "./ddb";

const LEGACY_TABLE = process.env.LEGACY_TABLE_NAME ?? "";

export class ImportClaimedError extends Error {
  constructor(public importedBy: string) {
    super("device already imported by another user");
    this.name = "ImportClaimedError";
  }
}

/** Drain the legacy device partition (reads the OLD table). */
async function queryLegacyDevice(deviceId: string): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: LEGACY_TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":pk": `DEVICE#${deviceId}`,
          ":sk": "SONG#",
        },
        ExclusiveStartKey: startKey,
      })
    );
    items.push(...(out.Items ?? []));
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

/** Pure: re-key legacy rows onto the target songbook partition, stamping
 *  savedBy and fresh concurrency tokens on Song rows. Exported for tests. */
export function rekeyLegacyItems(
  items: Item[],
  songbookId: string,
  sub: string,
  mintVersion: () => string = randomUUID
): { songs: Item[]; versions: Item[] } {
  const pk = `SONGBOOK#${songbookId}`;
  const songs: Item[] = [];
  const versions: Item[] = [];
  for (const it of items) {
    const rekeyed = { ...it, pk, importedFrom: it.pk };
    if (it.entity === "Song") {
      songs.push({ ...rekeyed, savedBy: sub, version: mintVersion() });
    } else if (it.entity === "Version") {
      versions.push(rekeyed);
    }
    // Other entities (e.g. legacy CLAIM markers) are not copied.
  }
  return { songs, versions };
}

export async function importDevice(
  deviceId: string,
  sub: string,
  songbookId: string
): Promise<{ songs: number; versions: number; resumed: boolean }> {
  if (!LEGACY_TABLE) throw new Error("legacy import not configured");

  // Create-only idempotency marker in the NEW table.
  let resumed = false;
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          pk: `DEVICE#${deviceId}`,
          sk: "IMPORT#",
          entity: "Import",
          importedBy: sub,
          songbookId,
          importedAt: Date.now(),
        },
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  } catch (err) {
    if ((err as { name?: string }).name !== "ConditionalCheckFailedException") {
      throw err;
    }
    const marker = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { pk: `DEVICE#${deviceId}`, sk: "IMPORT#" },
      })
    );
    const importedBy = marker.Item?.importedBy as string | undefined;
    if (importedBy && importedBy !== sub) {
      throw new ImportClaimedError(importedBy);
    }
    resumed = true; // same user re-running — safe to re-copy (conditional puts)
  }

  const legacyItems = await queryLegacyDevice(deviceId);
  const { songs, versions } = rekeyLegacyItems(legacyItems, songbookId, sub);

  // Songs individually with newest-wins condition (merges reruns/overlaps).
  for (const item of songs) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: item,
          ConditionExpression:
            "attribute_not_exists(pk) OR updatedAt < :src",
          ExpressionAttributeValues: { ":src": item.updatedAt ?? 0 },
        })
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "ConditionalCheckFailedException") {
        throw err;
      }
      // Existing copy is newer — correct outcome, skip.
    }
  }

  // Versions in bulk — identical sk re-copies overwrite identically.
  await batchPutAll(TABLE, versions);

  return { songs: songs.length, versions: versions.length, resumed };
}

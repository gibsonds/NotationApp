import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { SongDTO, SongSummary } from "./types";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;

const songPk = (deviceId: string) => `DEVICE#${deviceId}`;
const songSk = (id: string) => `SONG#${id}`;
const versionSk = (id: string, ts: number) => `SONG#${id}#V#${ts}`;
const versionPrefix = (id: string) => `SONG#${id}#V#`;

// Cloud-side version retention: when a song is overwritten, the prior
// state is archived as a version row before the new one is written.
// Rate-limited so high-frequency autosaves don't generate hundreds of
// near-identical versions; once per VERSION_INTERVAL_MS at most.
const VERSION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VERSIONS_PER_SONG = 20;

export async function listSongs(deviceId: string): Promise<SongSummary[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: { ":pk": songPk(deviceId), ":sk": "SONG#" },
      // "id" and "title" are reserved words in DynamoDB; use placeholders.
      ExpressionAttributeNames: {
        "#id": "id",
        "#title": "title",
        "#savedAt": "savedAt",
        "#updatedAt": "updatedAt",
        "#folder": "folder",
      },
      ProjectionExpression: "#id, #title, #savedAt, #updatedAt, #folder",
    })
  );
  return (out.Items ?? []) as SongSummary[];
}

export async function getSong(deviceId: string, id: string): Promise<SongDTO | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: songPk(deviceId), sk: songSk(id) },
    })
  );
  if (!out.Item) return null;
  return {
    id: out.Item.id,
    title: out.Item.title,
    savedAt: out.Item.savedAt,
    updatedAt: out.Item.updatedAt,
    score: out.Item.score,
    ...(out.Item.folder ? { folder: out.Item.folder } : {}),
  };
}

export async function putSong(
  deviceId: string,
  id: string,
  body: { title: string; score: Record<string, unknown>; savedAt?: number; folder?: string | null }
): Promise<SongDTO> {
  const now = Date.now();

  // Read the current item so we can archive it as a version (rate-limited
  // by VERSION_INTERVAL_MS so autosaves at 8s intervals don't blow up the
  // version table).
  const currentResp = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: songPk(deviceId), sk: songSk(id) } })
  );
  const current = currentResp.Item;
  let didVersion = false;
  if (current) {
    const lastVersionedAt = (current.lastVersionedAt as number | undefined) ?? 0;
    if (now - lastVersionedAt > VERSION_INTERVAL_MS) {
      const versionTs = (current.updatedAt as number | undefined) ?? now;
      const versionItem = {
        ...current,
        pk: songPk(deviceId),
        sk: versionSk(id, versionTs),
        entity: "Version",
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: versionItem }));
      didVersion = true;

      // Trim old versions beyond MAX_VERSIONS_PER_SONG.
      const allVersions = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": songPk(deviceId),
            ":sk": versionPrefix(id),
          },
          ScanIndexForward: false, // newest first
        })
      );
      const items = allVersions.Items ?? [];
      if (items.length > MAX_VERSIONS_PER_SONG) {
        const toDelete = items.slice(MAX_VERSIONS_PER_SONG);
        await Promise.all(
          toDelete.map((v) =>
            ddb.send(
              new DeleteCommand({
                TableName: TABLE,
                Key: { pk: v.pk, sk: v.sk },
              })
            )
          )
        );
      }
    }
  }

  const item: Record<string, unknown> = {
    pk: songPk(deviceId),
    sk: songSk(id),
    entity: "Song",
    id,
    title: body.title,
    savedAt: body.savedAt ?? now,
    updatedAt: now,
    version: 1,
    score: body.score,
    lastVersionedAt: didVersion ? now : ((current?.lastVersionedAt as number | undefined) ?? 0),
  };
  if (body.folder && body.folder.trim()) item.folder = body.folder.trim();
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return {
    id,
    title: item.title as string,
    savedAt: item.savedAt as number,
    updatedAt: item.updatedAt as number,
    score: body.score,
    ...(item.folder ? { folder: item.folder as string } : {}),
  };
}

/** List version timestamps for a song (newest first). Used by the
 *  per-song history view to show server-side versions alongside the
 *  device-local IndexedDB autosaves. */
export async function listVersions(deviceId: string, id: string): Promise<number[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": songPk(deviceId),
        ":sk": versionPrefix(id),
      },
      ProjectionExpression: "sk",
      ScanIndexForward: false,
    })
  );
  return (out.Items ?? [])
    .map((it) => parseInt(String(it.sk).split("#V#")[1] || "0", 10))
    .filter((n) => n > 0);
}

/** Fetch a single version as a SongDTO. */
export async function getVersion(
  deviceId: string,
  id: string,
  ts: number
): Promise<SongDTO | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: songPk(deviceId), sk: versionSk(id, ts) },
    })
  );
  if (!out.Item) return null;
  return {
    id: out.Item.id,
    title: out.Item.title,
    savedAt: out.Item.savedAt,
    updatedAt: out.Item.updatedAt,
    score: out.Item.score,
    ...(out.Item.folder ? { folder: out.Item.folder } : {}),
  };
}

export async function deleteSong(deviceId: string, id: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: songPk(deviceId), sk: songSk(id) },
    })
  );
}

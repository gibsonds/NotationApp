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
  };
  // null/empty explicitly clears the folder; absent leaves it untouched
  // — but PutCommand replaces the whole item, so we MUST include or
  // omit folder according to body. Treat undefined as "no folder".
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

export async function deleteSong(deviceId: string, id: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: songPk(deviceId), sk: songSk(id) },
    })
  );
}

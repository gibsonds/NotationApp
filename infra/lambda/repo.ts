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
      },
      ProjectionExpression: "#id, #title, #savedAt, #updatedAt",
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
  };
}

export async function putSong(
  deviceId: string,
  id: string,
  body: { title: string; score: Record<string, unknown>; savedAt?: number }
): Promise<SongDTO> {
  const now = Date.now();
  const item = {
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
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return {
    id,
    title: item.title,
    savedAt: item.savedAt,
    updatedAt: item.updatedAt,
    score: body.score,
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

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { SongDTO, SongSummary, VersionEntry } from "./types";

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
// Total cap across all kinds. With tiered eviction (auto-only pruning,
// keeping the version most distinct from its neighbors), this stretches
// recent-dense / older-sparse — last hour fine-grained, last day every
// hour, last week every day, etc.
const MAX_VERSIONS_PER_SONG = 30;

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

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

      // Determine kind: "daily" if no daily version exists for today's
      // UTC date; otherwise "auto". Named revisions are created via a
      // separate endpoint and never hit this code path.
      const allVersionsBefore = await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
          ExpressionAttributeValues: {
            ":pk": songPk(deviceId),
            ":sk": versionPrefix(id),
          },
          ScanIndexForward: false,
        })
      );
      const existing = allVersionsBefore.Items ?? [];
      const today = dayKey(now);
      const hasDailyToday = existing.some(
        (v) => v.kind === "daily" && dayKey(v.updatedAt as number) === today
      );
      const kind = hasDailyToday ? "auto" : "daily";

      const versionItem = {
        ...current,
        pk: songPk(deviceId),
        sk: versionSk(id, versionTs),
        entity: "Version",
        kind,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: versionItem }));
      didVersion = true;

      // Tiered eviction: total cap MAX_VERSIONS_PER_SONG, but only
      // "auto" versions are eligible for pruning. Named + daily are
      // sticky. Among auto versions when we're over the cap, drop the
      // one that contributes least temporal info — the one closest in
      // time to its neighbors.
      const allItemsAfter = [...existing, versionItem];
      if (allItemsAfter.length > MAX_VERSIONS_PER_SONG) {
        const sortedAsc = allItemsAfter
          .slice()
          .sort(
            (a, b) =>
              (a.updatedAt as number) - (b.updatedAt as number)
          );
        const autos: typeof sortedAsc = [];
        const idxOf = new Map<typeof sortedAsc[number], number>();
        sortedAsc.forEach((v, i) => idxOf.set(v, i));
        for (const v of sortedAsc) if (v.kind === "auto") autos.push(v);

        const overBy = allItemsAfter.length - MAX_VERSIONS_PER_SONG;
        const victims: typeof sortedAsc = [];
        for (let n = 0; n < overBy && autos.length > 0; n++) {
          // Find the auto version whose temporal "gap to the closer
          // neighbor in the FULL set" is smallest — i.e., the one whose
          // removal loses the least information.
          let bestI = 0;
          let bestGap = Infinity;
          for (let i = 0; i < autos.length; i++) {
            const v = autos[i];
            const fullIdx = idxOf.get(v)!;
            const prev = sortedAsc[fullIdx - 1];
            const next = sortedAsc[fullIdx + 1];
            const dPrev = prev ? (v.updatedAt as number) - (prev.updatedAt as number) : Infinity;
            const dNext = next ? (next.updatedAt as number) - (v.updatedAt as number) : Infinity;
            const gap = Math.min(dPrev, dNext);
            if (gap < bestGap) {
              bestGap = gap;
              bestI = i;
            }
          }
          const victim = autos[bestI];
          victims.push(victim);
          autos.splice(bestI, 1);
        }
        await Promise.all(
          victims.map((v) =>
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

/** List versions for a song with kind/name metadata, newest first. */
export async function listVersions(deviceId: string, id: string): Promise<VersionEntry[]> {
  const out = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": songPk(deviceId),
        ":sk": versionPrefix(id),
      },
      ExpressionAttributeNames: {
        "#sk": "sk",
        "#updatedAt": "updatedAt",
        "#savedAt": "savedAt",
        "#title": "title",
        "#kind": "kind",
        "#name": "name",
      },
      ProjectionExpression: "#sk, #updatedAt, #savedAt, #title, #kind, #name",
      ScanIndexForward: false,
    })
  );
  return (out.Items ?? []).map((it) => {
    const ts = (it.updatedAt as number | undefined) ??
      parseInt(String(it.sk).split("#V#")[1] || "0", 10);
    return {
      ts,
      kind: ((it.kind as string) ?? "auto") as VersionEntry["kind"],
      name: it.name as string | undefined,
      title: it.title as string | undefined,
      savedAt: it.savedAt as number | undefined,
    };
  });
}

/** Create a NAMED revision — explicit user-marked milestone. Never
 *  pruned by auto-eviction. Stored under the version SK with kind
 *  "named" and the user-supplied name. */
export async function createNamedRevision(
  deviceId: string,
  id: string,
  name: string,
  body: { title: string; score: Record<string, unknown>; folder?: string | null }
): Promise<VersionEntry> {
  const now = Date.now();
  const versionItem: Record<string, unknown> = {
    pk: songPk(deviceId),
    sk: versionSk(id, now),
    entity: "Version",
    kind: "named",
    name,
    id,
    title: body.title,
    savedAt: now,
    updatedAt: now,
    score: body.score,
  };
  if (body.folder && body.folder.trim()) versionItem.folder = body.folder.trim();
  await ddb.send(new PutCommand({ TableName: TABLE, Item: versionItem }));
  return {
    ts: now,
    kind: "named",
    name,
    title: body.title,
    savedAt: now,
  };
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

/**
 * Data layer for the authenticated, songbook-partitioned instance (#76).
 *
 * Key shapes (single table, TABLE_NAME = NotationAppAuth):
 *   pk SONGBOOK#<uuid>  sk META                  Songbook record
 *   pk SONGBOOK#<uuid>  sk SONG#<id>             Song (current state)
 *   pk SONGBOOK#<uuid>  sk SONG#<id>#V#<ts>      Version (auto|daily|named)
 *   pk SONGBOOK#<uuid>  sk MEMBER#<sub>          Member (for listing a book's members)
 *   pk USER#<sub>       sk MEMBER#<songbookId>   Membership mirror (for listing a user's books)
 *   pk SONGBOOK#<uuid>  sk INVITE#<token>        Invite (role-scoped join token)
 *   pk DEVICE#<legacy>  sk IMPORT#               Legacy-import idempotency marker (see import.ts)
 *
 * Song/version semantics (archiving, tiered eviction, optimistic
 * concurrency via an opaque `version` uuid) are ported from the legacy
 * repo.ts, plus a `savedBy` stamp on every write (needed by #88/#89).
 */
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { ddb, TABLE, queryAll, type Item } from "./ddb";
import type {
  Invite,
  Member,
  Membership,
  Role,
  SongDTOB,
  SongSummaryB,
  VersionEntryB,
} from "./songbook-types";

export class VersionConflictErrorB extends Error {
  constructor(public current: SongDTOB) {
    super("version conflict");
    this.name = "VersionConflictErrorB";
  }
}

const bookPk = (songbookId: string) => `SONGBOOK#${songbookId}`;
const userPk = (sub: string) => `USER#${sub}`;
const songSk = (id: string) => `SONG#${id}`;
const versionSk = (id: string, ts: number) => `SONG#${id}#V#${ts}`;
const versionPrefix = (id: string) => `SONG#${id}#V#`;

const VERSION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VERSIONS_PER_SONG = 30;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

// ── Songbooks & membership ─────────────────────────────────────────────────

export async function createSongbook(
  sub: string,
  name: string,
  email?: string
): Promise<Membership> {
  const songbookId = randomUUID();
  const now = Date.now();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: bookPk(songbookId),
              sk: "META",
              entity: "Songbook",
              songbookId,
              name,
              createdBy: sub,
              createdAt: now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: userPk(sub),
              sk: `MEMBER#${songbookId}`,
              entity: "Membership",
              songbookId,
              name,
              role: "owner",
              addedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: bookPk(songbookId),
              sk: `MEMBER#${sub}`,
              entity: "Member",
              sub,
              role: "owner",
              addedAt: now,
              ...(email ? { email } : {}),
            },
          },
        },
      ],
    })
  );
  return { songbookId, name, role: "owner", addedAt: now };
}

export async function listMemberships(sub: string): Promise<Membership[]> {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: { ":pk": userPk(sub), ":sk": "MEMBER#" },
  });
  return items.map((it) => ({
    songbookId: it.songbookId as string,
    name: (it.name as string) ?? "Songbook",
    role: it.role as Role,
    addedAt: it.addedAt as number,
  }));
}

/** The caller's role in a songbook, or null when not a member. */
export async function getRole(
  sub: string,
  songbookId: string
): Promise<Role | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: userPk(sub), sk: `MEMBER#${songbookId}` },
    })
  );
  return (out.Item?.role as Role) ?? null;
}

export async function listMembers(songbookId: string): Promise<Member[]> {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: { ":pk": bookPk(songbookId), ":sk": "MEMBER#" },
  });
  return items.map((it) => ({
    sub: it.sub as string,
    role: it.role as Role,
    addedAt: it.addedAt as number,
    ...(it.email ? { email: it.email as string } : {}),
  }));
}

export async function removeMember(
  songbookId: string,
  sub: string
): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE,
            Key: { pk: bookPk(songbookId), sk: `MEMBER#${sub}` },
          },
        },
        {
          Delete: {
            TableName: TABLE,
            Key: { pk: userPk(sub), sk: `MEMBER#${songbookId}` },
          },
        },
      ],
    })
  );
}

// ── Invites (share-link successor: role-scoped join tokens) ────────────────

export async function createInvite(
  songbookId: string,
  role: Exclude<Role, "owner">,
  createdBy: string
): Promise<Invite> {
  const token = randomUUID();
  const now = Date.now();
  const invite: Invite = {
    token,
    songbookId,
    role,
    createdBy,
    createdAt: now,
    expiresAt: now + INVITE_TTL_MS,
  };
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: bookPk(songbookId),
        sk: `INVITE#${token}`,
        entity: "Invite",
        // GSI-free token lookup: invites are also written under their own pk
        // so acceptance doesn't need the songbook id in the URL.
        ...invite,
      },
    })
  );
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: `INVITE#${token}`, sk: "META", entity: "InviteLookup", ...invite },
    })
  );
  return invite;
}

export async function getInvite(token: string): Promise<Invite | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: `INVITE#${token}`, sk: "META" } })
  );
  if (!out.Item) return null;
  const inv = out.Item as unknown as Invite;
  return inv.expiresAt > Date.now() ? inv : null;
}

/** Accept an invite: the caller becomes a member at the invite's role.
 *  Idempotent — re-accepting keeps the existing (possibly higher) role. */
export async function acceptInvite(
  token: string,
  sub: string,
  email?: string
): Promise<Membership | null> {
  const invite = await getInvite(token);
  if (!invite) return null;
  const existing = await getRole(sub, invite.songbookId);
  if (existing) {
    const meta = await getSongbookMeta(invite.songbookId);
    return {
      songbookId: invite.songbookId,
      name: meta?.name ?? "Songbook",
      role: existing,
      addedAt: Date.now(),
    };
  }
  const meta = await getSongbookMeta(invite.songbookId);
  const now = Date.now();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: userPk(sub),
              sk: `MEMBER#${invite.songbookId}`,
              entity: "Membership",
              songbookId: invite.songbookId,
              name: meta?.name ?? "Songbook",
              role: invite.role,
              addedAt: now,
            },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: bookPk(invite.songbookId),
              sk: `MEMBER#${sub}`,
              entity: "Member",
              sub,
              role: invite.role,
              addedAt: now,
              ...(email ? { email } : {}),
            },
          },
        },
      ],
    })
  );
  return {
    songbookId: invite.songbookId,
    name: meta?.name ?? "Songbook",
    role: invite.role,
    addedAt: now,
  };
}

export async function revokeInvite(
  songbookId: string,
  token: string
): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE,
            Key: { pk: bookPk(songbookId), sk: `INVITE#${token}` },
          },
        },
        {
          Delete: { TableName: TABLE, Key: { pk: `INVITE#${token}`, sk: "META" } },
        },
      ],
    })
  );
}

async function getSongbookMeta(
  songbookId: string
): Promise<{ name: string } | null> {
  const out = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk: bookPk(songbookId), sk: "META" } })
  );
  return out.Item ? { name: out.Item.name as string } : null;
}

// ── Songs & versions (ported from legacy repo.ts + savedBy) ───────────────

export async function listSongsB(songbookId: string): Promise<SongSummaryB[]> {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    FilterExpression: "entity = :entity",
    ExpressionAttributeValues: {
      ":pk": bookPk(songbookId),
      ":sk": "SONG#",
      ":entity": "Song",
    },
    ExpressionAttributeNames: {
      "#id": "id",
      "#title": "title",
      "#savedAt": "savedAt",
      "#updatedAt": "updatedAt",
      "#folder": "folder",
      "#version": "version",
      "#savedBy": "savedBy",
    },
    ProjectionExpression:
      "#id, #title, #savedAt, #updatedAt, #folder, #version, #savedBy",
  });
  return items.map((it) => ({
    ...(it as SongSummaryB),
    version: typeof it.version === "string" ? it.version : "",
  }));
}

export async function getSongB(
  songbookId: string,
  id: string
): Promise<SongDTOB | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: bookPk(songbookId), sk: songSk(id) },
    })
  );
  if (!out.Item) return null;
  return itemToDto(out.Item);
}

function itemToDto(item: Item): SongDTOB {
  return {
    id: item.id,
    title: item.title,
    savedAt: item.savedAt,
    updatedAt: item.updatedAt,
    version: typeof item.version === "string" ? item.version : "",
    score: item.score,
    ...(item.folder ? { folder: item.folder } : {}),
    ...(item.savedBy ? { savedBy: item.savedBy } : {}),
  };
}

export async function putSongB(
  songbookId: string,
  id: string,
  savedBy: string,
  body: {
    title: string;
    score: Record<string, unknown>;
    savedAt?: number;
    folder?: string | null;
    expectedVersion?: string;
  }
): Promise<SongDTOB> {
  const now = Date.now();
  const pk = bookPk(songbookId);

  const currentResp = await ddb.send(
    new GetCommand({ TableName: TABLE, Key: { pk, sk: songSk(id) } })
  );
  const current = currentResp.Item;

  // Optimistic concurrency (same contract as legacy): a mismatched
  // expectedVersion → 409 with the current DTO for conflict resolution.
  if (
    body.expectedVersion !== undefined &&
    current &&
    typeof current.version === "string" &&
    current.version !== body.expectedVersion
  ) {
    throw new VersionConflictErrorB(itemToDto(current));
  }

  // Archive the prior state as a version row, rate-limited, with tiered
  // eviction (auto-only pruning; named + daily sticky).
  let didVersion = false;
  if (current) {
    const lastVersionedAt = (current.lastVersionedAt as number | undefined) ?? 0;
    if (now - lastVersionedAt > VERSION_INTERVAL_MS) {
      const versionTs = (current.updatedAt as number | undefined) ?? now;
      const existing = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": pk, ":sk": versionPrefix(id) },
        ScanIndexForward: false,
      });
      const today = dayKey(now);
      const hasDailyToday = existing.some(
        (v) => v.kind === "daily" && dayKey(v.updatedAt as number) === today
      );
      const kind = hasDailyToday ? "auto" : "daily";
      const versionItem: Item = {
        ...current,
        pk,
        sk: versionSk(id, versionTs),
        entity: "Version",
        kind,
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: versionItem }));
      didVersion = true;

      const all: Item[] = [...existing, versionItem];
      if (all.length > MAX_VERSIONS_PER_SONG) {
        for (const victim of pickEvictionVictims(all, all.length - MAX_VERSIONS_PER_SONG)) {
          await ddb.send(
            new DeleteCommand({
              TableName: TABLE,
              Key: { pk: victim.pk, sk: victim.sk },
            })
          );
        }
      }
    }
  }

  const item: Item = {
    pk,
    sk: songSk(id),
    entity: "Song",
    id,
    title: body.title,
    savedAt: body.savedAt ?? now,
    updatedAt: now,
    version: randomUUID(),
    savedBy,
    score: body.score,
    lastVersionedAt: didVersion
      ? now
      : ((current?.lastVersionedAt as number | undefined) ?? 0),
  };
  if (body.folder && body.folder.trim()) item.folder = body.folder.trim();
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return itemToDto(item);
}

/** Tiered eviction: only "auto" versions are eligible; among them, drop
 *  the one closest in time to a neighbor (least temporal information).
 *  Pure — exported for unit tests. */
export function pickEvictionVictims(all: Item[], overBy: number): Item[] {
  const sortedAsc = all
    .slice()
    .sort((a, b) => (a.updatedAt as number) - (b.updatedAt as number));
  const idxOf = new Map<Item, number>();
  sortedAsc.forEach((v, i) => idxOf.set(v, i));
  const autos = sortedAsc.filter((v) => v.kind === "auto");
  const victims: Item[] = [];
  for (let n = 0; n < overBy && autos.length > 0; n++) {
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
    victims.push(autos[bestI]);
    autos.splice(bestI, 1);
  }
  return victims;
}

export async function deleteSongB(songbookId: string, id: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: bookPk(songbookId), sk: songSk(id) },
    })
  );
}

export async function listVersionsB(
  songbookId: string,
  id: string
): Promise<VersionEntryB[]> {
  const items = await queryAll({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
    ExpressionAttributeValues: {
      ":pk": bookPk(songbookId),
      ":sk": versionPrefix(id),
    },
    ExpressionAttributeNames: {
      "#sk": "sk",
      "#updatedAt": "updatedAt",
      "#savedAt": "savedAt",
      "#title": "title",
      "#kind": "kind",
      "#name": "name",
      "#savedBy": "savedBy",
    },
    ProjectionExpression: "#sk, #updatedAt, #savedAt, #title, #kind, #name, #savedBy",
    ScanIndexForward: false,
  });
  return items.map((it) => {
    const ts =
      (it.updatedAt as number | undefined) ??
      parseInt(String(it.sk).split("#V#")[1] || "0", 10);
    return {
      ts,
      kind: ((it.kind as string) ?? "auto") as VersionEntryB["kind"],
      name: it.name as string | undefined,
      title: it.title as string | undefined,
      savedAt: it.savedAt as number | undefined,
      savedBy: it.savedBy as string | undefined,
    };
  });
}

export async function getVersionB(
  songbookId: string,
  id: string,
  ts: number
): Promise<SongDTOB | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { pk: bookPk(songbookId), sk: versionSk(id, ts) },
    })
  );
  return out.Item ? itemToDto(out.Item) : null;
}

export async function createNamedRevisionB(
  songbookId: string,
  id: string,
  name: string,
  savedBy: string,
  body: { title: string; score: Record<string, unknown>; folder?: string | null }
): Promise<VersionEntryB> {
  const now = Date.now();
  const item: Item = {
    pk: bookPk(songbookId),
    sk: versionSk(id, now),
    entity: "Version",
    kind: "named",
    name,
    id,
    title: body.title,
    savedAt: now,
    updatedAt: now,
    savedBy,
    score: body.score,
  };
  if (body.folder && body.folder.trim()) item.folder = body.folder.trim();
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return { ts: now, kind: "named", name, title: body.title, savedAt: now, savedBy };
}

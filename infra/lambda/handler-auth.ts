/**
 * Entry point for the authenticated (NotationAuth) API instance.
 *
 * Every data route requires a valid OAuth42 Bearer JWT (see auth.ts) and a
 * songbook membership at a sufficient role:
 *   viewer → GET; editor → + PUT/POST; owner → + DELETE, members, invites.
 * The only unauthenticated routes are the /oauth broker pair, which is how
 * a session begins.
 *
 * The legacy handler.ts / repo.ts are untouched — this file serves the new
 * stack only.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { AuthError, requireUser, type AuthedUser } from "./auth";
import { exchangeCode, refreshToken } from "./oauth-broker";
import { ImportClaimedError, importDevice } from "./import";
import {
  acceptInvite,
  createInvite,
  createNamedRevisionB,
  createSongbook,
  deleteSongB,
  getRole,
  getSongB,
  getVersionB,
  listMembers,
  listMemberships,
  listSongsB,
  listVersionsB,
  putSongB,
  removeMember,
  revokeInvite,
  VersionConflictErrorB,
} from "./songbook-repo";
import type { Role } from "./songbook-types";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** Pure role gate — exported for unit tests. */
export function roleAllows(role: Role | null, required: Role): boolean {
  return role !== null && RANK[role] >= RANK[required];
}

class ForbiddenError extends Error {}

async function requireRole(
  sub: string,
  songbookId: string,
  required: Role
): Promise<Role> {
  const role = await getRole(sub, songbookId);
  if (!roleAllows(role, required)) throw new ForbiddenError();
  return role as Role;
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> {
  try {
    return JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const route = event.routeKey;
  const p = event.pathParameters ?? {};

  try {
    // ── Unauthenticated: OAuth broker ─────────────────────────────────────
    if (route === "POST /oauth/exchange") {
      const b = parseBody(event);
      if (
        typeof b.code !== "string" ||
        typeof b.code_verifier !== "string" ||
        typeof b.redirect_uri !== "string"
      ) {
        return json(400, { error: "code, code_verifier, redirect_uri required" });
      }
      const out = await exchangeCode({
        code: b.code,
        code_verifier: b.code_verifier,
        redirect_uri: b.redirect_uri,
      });
      return json(out.status, out.body);
    }
    if (route === "POST /oauth/refresh") {
      const b = parseBody(event);
      if (typeof b.refresh_token !== "string") {
        return json(400, { error: "refresh_token required" });
      }
      const out = await refreshToken({ refresh_token: b.refresh_token });
      return json(out.status, out.body);
    }

    // ── Everything else requires a verified user ──────────────────────────
    const user = await requireUser(event.headers);

    switch (route) {
      case "GET /me":
        return json(200, await bootstrapMe(user));

      case "POST /songbooks": {
        const b = parseBody(event);
        const name =
          typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Songbook";
        return json(200, await createSongbook(user.sub, name, user.email));
      }

      case "GET /songbooks/{id}/members": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "viewer");
        return json(200, { members: await listMembers(songbookId) });
      }

      case "DELETE /songbooks/{id}/members/{sub}": {
        const songbookId = need(p.id);
        const target = need(p.sub);
        await requireRole(user.sub, songbookId, "owner");
        if (target === user.sub) {
          return json(400, { error: "owner cannot remove themselves" });
        }
        await removeMember(songbookId, target);
        return json(200, { ok: true });
      }

      case "POST /songbooks/{id}/invites": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "owner");
        const b = parseBody(event);
        const role = b.role === "viewer" ? "viewer" : "editor";
        return json(200, await createInvite(songbookId, role, user.sub));
      }

      case "DELETE /songbooks/{id}/invites/{token}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "owner");
        await revokeInvite(songbookId, need(p.token));
        return json(200, { ok: true });
      }

      case "POST /invites/{token}/accept": {
        const membership = await acceptInvite(need(p.token), user.sub, user.email);
        return membership
          ? json(200, membership)
          : json(404, { error: "invite not found or expired" });
      }

      case "GET /songbooks/{id}/songs": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "viewer");
        return json(200, { songs: await listSongsB(songbookId) });
      }

      case "GET /songbooks/{id}/songs/{songId}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "viewer");
        const song = await getSongB(songbookId, need(p.songId));
        return song ? json(200, song) : json(404, { error: "not found" });
      }

      case "PUT /songbooks/{id}/songs/{songId}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "editor");
        const b = parseBody(event);
        if (!b.title || typeof b.title !== "string") {
          return json(400, { error: "title required" });
        }
        if (!b.score || typeof b.score !== "object") {
          return json(400, { error: "score required" });
        }
        if (b.folder !== undefined && b.folder !== null && typeof b.folder !== "string") {
          return json(400, { error: "folder must be string" });
        }
        return json(
          200,
          await putSongB(songbookId, need(p.songId), user.sub, {
            title: b.title,
            score: b.score as Record<string, unknown>,
            savedAt: typeof b.savedAt === "number" ? b.savedAt : undefined,
            folder: (b.folder as string | null | undefined) ?? null,
            expectedVersion:
              typeof b.expectedVersion === "string" ? b.expectedVersion : undefined,
          })
        );
      }

      case "DELETE /songbooks/{id}/songs/{songId}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "owner");
        await deleteSongB(songbookId, need(p.songId));
        return json(200, { ok: true });
      }

      case "GET /songbooks/{id}/songs/{songId}/versions": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "viewer");
        return json(200, { versions: await listVersionsB(songbookId, need(p.songId)) });
      }

      case "POST /songbooks/{id}/songs/{songId}/versions": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "editor");
        const b = parseBody(event);
        if (!b.name || typeof b.name !== "string") return json(400, { error: "name required" });
        if (!b.title || typeof b.title !== "string") return json(400, { error: "title required" });
        if (!b.score || typeof b.score !== "object") return json(400, { error: "score required" });
        return json(
          200,
          await createNamedRevisionB(songbookId, need(p.songId), b.name, user.sub, {
            title: b.title,
            score: b.score as Record<string, unknown>,
            folder: (b.folder as string | null | undefined) ?? null,
          })
        );
      }

      case "GET /songbooks/{id}/songs/{songId}/versions/{ts}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "viewer");
        const ts = parseInt(need(p.ts), 10);
        if (Number.isNaN(ts)) return json(400, { error: "invalid ts" });
        const v = await getVersionB(songbookId, need(p.songId), ts);
        return v ? json(200, v) : json(404, { error: "version not found" });
      }

      case "POST /import-device": {
        const b = parseBody(event);
        if (typeof b.deviceId !== "string" || !b.deviceId) {
          return json(400, { error: "deviceId required" });
        }
        if (typeof b.songbookId !== "string" || !b.songbookId) {
          return json(400, { error: "songbookId required" });
        }
        await requireRole(user.sub, b.songbookId, "editor");
        const result = await importDevice(b.deviceId, user.sub, b.songbookId);
        return json(200, result);
      }
    }
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    if (err instanceof ForbiddenError) return json(403, { error: "forbidden" });
    if (err instanceof MissingParamError) return json(400, { error: "missing path parameter" });
    if (err instanceof VersionConflictErrorB) {
      return json(409, { error: "conflict", current: err.current });
    }
    if (err instanceof ImportClaimedError) {
      return json(409, { error: "device already imported by another account" });
    }
    console.error("handler-auth error", err);
    return json(500, { error: "internal error" });
  }

  return json(404, { error: "not found" });
};

/** First-touch bootstrap: list memberships; if the user has none, create a
 *  personal songbook so the client always has somewhere to save. */
async function bootstrapMe(user: AuthedUser) {
  let memberships = await listMemberships(user.sub);
  if (memberships.length === 0) {
    memberships = [await createSongbook(user.sub, "My Songs", user.email)];
  }
  return {
    sub: user.sub,
    ...(user.email ? { email: user.email } : {}),
    ...(user.name ? { name: user.name } : {}),
    memberships,
  };
}

class MissingParamError extends Error {}
function need(v: string | undefined): string {
  if (!v) throw new MissingParamError();
  return v;
}

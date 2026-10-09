/**
 * Entry point for the authenticated (NotationAuth) API instance.
 *
 * Every production data route requires a revocable HttpOnly session and a
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
import { exchangeCode } from "./oauth-broker";
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
import { assertBrowserRequest, createSession, deleteSession, sessionCookie, sessionUser } from "./sessions";
import { RequestError, readBody, identifier, limitOperation } from "./security";
import type { Role } from "./songbook-types";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
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
  return readBody(event.body, event.isBase64Encoded);
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const route = event.routeKey;
  const p = event.pathParameters ?? {};

  try {
    if (event.body) parseBody(event);
    if (process.env.COOKIE_SESSIONS === "1" && !route.startsWith("GET ")) assertBrowserRequest(event);
    if (route === "POST /oauth/logout") {
      await deleteSession(event);
      return { ...json(200, { ok: true }) as object, cookies: [sessionCookie("", 0)] };
    }
    if (route === "POST /oauth/session") {
      // Short migration window for already-signed-in tabs. No tokens returned.
      if (Date.now() > Date.parse(process.env.SESSION_MIGRATION_UNTIL ?? "1970-01-01")) throw new AuthError(401, "Please sign in again.");
      const user = await requireUser(event.headers);
      await limitOperation(user.sub, "sessions", 10, 3600);
      const created = await createSession({ access_token: event.headers.authorization?.slice(7)});
      await deleteSession(event);
      return { ...json(200, { ok: true }) as object, cookies: [created.cookie] };
    }
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
      if (!(process.env.APP_ORIGINS ?? "").split(",").some(origin => b.redirect_uri === `${origin}/`)) throw new AuthError(400, "Invalid redirect URI.");
      const out = await exchangeCode({
        code: b.code,
        code_verifier: b.code_verifier,
        redirect_uri: b.redirect_uri,
      });
      if (out.status !== 200) return json(out.status, { error: "Sign-in could not be completed." });
      const created = await createSession(out.body);
      await deleteSession(event);
      return { ...json(200, { ok: true }) as object, cookies: [created.cookie] };
    }
    if (route === "POST /oauth/refresh") return json(410, { error: "Reload Charts to use secure sessions." });

    // ── Everything else requires a verified user ──────────────────────────
    const user = process.env.COOKIE_SESSIONS === "1" ? await sessionUser(event) : await requireUser(event.headers);
    await limitOperation(user.sub, "requests", 300, 60);
    if (!route.startsWith("GET ")) await limitOperation(user.sub, "writes", 90, 60);

    switch (route) {
      case "GET /me":
        return json(200, await bootstrapMe(user));

      case "POST /songbooks": {
        await limitOperation(user.sub, "books", 10, 86400);
        const b = parseBody(event);
        const name =
          typeof b.name === "string" && b.name.trim() ? b.name.trim() : "Songbook";
        if (name.length > 120) throw new RequestError(400, "Name must be at most 120 characters.");
        return json(200, await createSongbook(user.sub, name));
      }

      case "GET /songbooks/{id}/members": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "owner");
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
        await limitOperation(user.sub, "invites", 50, 86400);
        if (b.role !== "viewer" && b.role !== "editor") throw new RequestError(400, "Invalid invitation role.");
        const role = b.role;
        return json(200, await createInvite(songbookId, role, user.sub));
      }

      case "DELETE /songbooks/{id}/invites/{token}": {
        const songbookId = need(p.id);
        await requireRole(user.sub, songbookId, "owner");
        await revokeInvite(songbookId, need(p.token));
        return json(200, { ok: true });
      }

      case "POST /invites/{token}/accept": {
        const membership = await acceptInvite(need(p.token), user.sub);
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
        await limitOperation(user.sub, "revisions", 100, 86400);
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
        await limitOperation(user.sub, "imports", 5, 3600);
        const b = parseBody(event);
        if (typeof b.deviceId !== "string" || !b.deviceId) {
          return json(400, { error: "deviceId required" });
        }
        if (typeof b.songbookId !== "string" || !b.songbookId) {
          return json(400, { error: "songbookId required" });
        }
        await requireRole(user.sub, b.songbookId, "editor");
        identifier(b.deviceId);
        const result = await importDevice(b.deviceId, user.sub, b.songbookId);
        return json(200, result);
      }
    }
  } catch (err) {
    if (err instanceof RequestError) return json(err.statusCode, { error: err.message });
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    if (err instanceof ForbiddenError) return json(403, { error: "forbidden" });
    if (err instanceof MissingParamError) return json(400, { error: "missing path parameter" });
    if (err instanceof VersionConflictErrorB) {
      return json(409, { error: "conflict", current: err.current });
    }
    if (err instanceof ImportClaimedError) {
      return json(409, { error: "device already imported by another account" });
    }
    console.error("handler-auth error", { name: (err as Error).name, route, requestId: event.requestContext?.requestId });
    return json(500, { error: "internal error" });
  }

  return json(404, { error: "not found" });
};

/** First-touch bootstrap: list memberships; if the user has none, create a
 *  personal songbook so the client always has somewhere to save. */
async function bootstrapMe(user: AuthedUser) {
  let memberships = await listMemberships(user.sub);
  if (memberships.length === 0) {
    memberships = [await createSongbook(user.sub, "My Songs")];
  }
  return {
    sub: user.sub,

    memberships,
  };
}

class MissingParamError extends Error {}
function need(v: string | undefined): string {
  return identifier(v);
}

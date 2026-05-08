import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  createNamedRevision,
  deleteSong,
  getSong,
  getVersion,
  listSongs,
  listVersions,
  putSong,
  VersionConflictError,
} from "./repo";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  // HTTP API lowercases header names; check both forms defensively.
  const deviceId =
    event.headers["x-device-id"] ?? event.headers["X-Device-Id"];
  if (!deviceId) return json(401, { error: "missing X-Device-Id" });

  // event.routeKey is already "METHOD /path" (e.g. "GET /songs/{id}").
  const route = event.routeKey;
  const id = event.pathParameters?.id;

  try {
    switch (route) {
      case "GET /songs":
        return json(200, { songs: await listSongs(deviceId) });

      case "GET /songs/{id}": {
        if (!id) return json(400, { error: "missing id" });
        const song = await getSong(deviceId, id);
        return song ? json(200, song) : json(404, { error: "not found" });
      }

      case "PUT /songs/{id}": {
        if (!id) return json(400, { error: "missing id" });
        const body = JSON.parse(event.body ?? "{}");
        if (!body.title || typeof body.title !== "string") {
          return json(400, { error: "title required" });
        }
        if (!body.score || typeof body.score !== "object") {
          return json(400, { error: "score required" });
        }
        // folder is optional; only string allowed (or null/missing for none)
        if (body.folder !== undefined && body.folder !== null && typeof body.folder !== "string") {
          return json(400, { error: "folder must be string" });
        }
        return json(200, await putSong(deviceId, id, body));
      }

      case "DELETE /songs/{id}": {
        if (!id) return json(400, { error: "missing id" });
        await deleteSong(deviceId, id);
        return json(200, { ok: true });
      }

      case "GET /songs/{id}/versions": {
        if (!id) return json(400, { error: "missing id" });
        return json(200, { versions: await listVersions(deviceId, id) });
      }

      case "POST /songs/{id}/versions": {
        if (!id) return json(400, { error: "missing id" });
        const body = JSON.parse(event.body ?? "{}");
        if (!body.name || typeof body.name !== "string") {
          return json(400, { error: "name required" });
        }
        if (!body.title || typeof body.title !== "string") {
          return json(400, { error: "title required" });
        }
        if (!body.score || typeof body.score !== "object") {
          return json(400, { error: "score required" });
        }
        return json(200, await createNamedRevision(deviceId, id, body.name, body));
      }

      case "GET /songs/{id}/versions/{ts}": {
        if (!id) return json(400, { error: "missing id" });
        const tsStr = event.pathParameters?.ts;
        if (!tsStr) return json(400, { error: "missing ts" });
        const ts = parseInt(tsStr, 10);
        if (Number.isNaN(ts)) return json(400, { error: "invalid ts" });
        const v = await getVersion(deviceId, id, ts);
        return v ? json(200, v) : json(404, { error: "version not found" });
      }
    }
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return json(409, { error: "conflict", current: err.current });
    }
    console.error("handler error", err);
    return json(500, { error: "internal error" });
  }

  return json(404, { error: "not found" });
};

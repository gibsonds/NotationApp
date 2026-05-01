import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { deleteSong, getSong, listSongs, putSong } from "./repo";

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
        return json(200, await putSong(deviceId, id, body));
      }

      case "DELETE /songs/{id}": {
        if (!id) return json(400, { error: "missing id" });
        await deleteSong(deviceId, id);
        return json(200, { ok: true });
      }
    }
  } catch (err) {
    console.error("handler error", err);
    return json(500, { error: "internal error" });
  }

  return json(404, { error: "not found" });
};

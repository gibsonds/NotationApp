/**
 * Local dev server: runs the authenticated Lambda handler as a plain
 * Node HTTP server — no Lambda, no API Gateway. Used by docker-compose
 * (with DynamoDB Local) and directly via `npx tsx infra/local/server.ts`.
 *
 * It maps an incoming request onto the same APIGatewayProxyEventV2 shape
 * the Lambda receives (routeKey + pathParameters + body + headers), so
 * there is exactly one code path in handler-auth.ts for cloud and local.
 * This adapter is also the portability seam: the API is "a container
 * that speaks HTTP" — deployable to any container runtime as-is.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { handler } from "../lambda/handler-auth";

const PORT = parseInt(process.env.PORT ?? "4000", 10);

// Route templates the API defines, mirrored from notation-auth-stack.ts.
// Matched most-specific-first (more literal segments first).
const ROUTES: Array<{ method: string; template: string }> = [
  { method: "POST", template: "/oauth/exchange" },
  { method: "POST", template: "/oauth/refresh" },
  { method: "GET", template: "/me" },
  { method: "POST", template: "/songbooks" },
  { method: "GET", template: "/songbooks/{id}/members" },
  { method: "DELETE", template: "/songbooks/{id}/members/{sub}" },
  { method: "POST", template: "/songbooks/{id}/invites" },
  { method: "DELETE", template: "/songbooks/{id}/invites/{token}" },
  { method: "POST", template: "/invites/{token}/accept" },
  { method: "GET", template: "/songbooks/{id}/songs" },
  { method: "GET", template: "/songbooks/{id}/songs/{songId}" },
  { method: "PUT", template: "/songbooks/{id}/songs/{songId}" },
  { method: "DELETE", template: "/songbooks/{id}/songs/{songId}" },
  { method: "GET", template: "/songbooks/{id}/songs/{songId}/versions" },
  { method: "POST", template: "/songbooks/{id}/songs/{songId}/versions" },
  { method: "GET", template: "/songbooks/{id}/songs/{songId}/versions/{ts}" },
  { method: "POST", template: "/import-device" },
];

/** Match a concrete path against a route template, extracting params. */
export function matchRoute(
  method: string,
  pathname: string
): { routeKey: string; pathParameters: Record<string, string> } | null {
  const segs = pathname.split("/").filter(Boolean);
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const tsegs = r.template.split("/").filter(Boolean);
    if (tsegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < tsegs.length; i++) {
      const t = tsegs[i];
      if (t.startsWith("{") && t.endsWith("}")) {
        params[t.slice(1, -1)] = decodeURIComponent(segs[i]);
      } else if (t !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { routeKey: `${r.method} ${r.template}`, pathParameters: params };
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,x-device-id",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  const match = matchRoute(req.method ?? "GET", url.pathname);
  if (!match) {
    res.writeHead(404, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v;
  }
  const event = {
    routeKey: match.routeKey,
    pathParameters: match.pathParameters,
    headers,
    body: await readBody(req),
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
  } as unknown as APIGatewayProxyEventV2;

  try {
    const out = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    res.writeHead(out.statusCode ?? 200, {
      ...(out.headers as Record<string, string>),
      ...CORS_HEADERS,
    });
    res.end(out.body ?? "");
  } catch (err) {
    console.error("[local-server] unhandled", err);
    res.writeHead(500, { "content-type": "application/json", ...CORS_HEADERS });
    res.end(JSON.stringify({ error: "internal error" }));
  }
}).listen(PORT, () => {
  console.log(`[local-server] notation auth API on http://localhost:${PORT}`);
  console.log(`[local-server] table=${process.env.TABLE_NAME} ddb=${process.env.DDB_ENDPOINT ?? "aws"}`);
});

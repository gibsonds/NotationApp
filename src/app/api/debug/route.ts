import { appendFileSync } from "fs";
import { NextRequest } from "next/server";

const LOG_FILE = "/tmp/notation-debug.log";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  if (req.headers.get("origin") !== new URL(req.url).origin) return new Response(null, { status: 403 });
  try {
    const body = await req.text();
    if (body.length > 4096) return new Response(null, { status: 413 });
    const { msg } = JSON.parse(body);
    if (typeof msg !== "string") return new Response(null, { status: 400 });
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

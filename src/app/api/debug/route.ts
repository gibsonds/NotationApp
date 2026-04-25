import { appendFileSync } from "fs";
import { NextRequest } from "next/server";

const LOG_FILE = "/tmp/notation-debug.log";

export async function POST(req: NextRequest) {
  try {
    const { msg } = await req.json();
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    appendFileSync(LOG_FILE, line);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}

// Reports whether the server has a default LLM API key configured via env
// vars. The client uses this (alongside its own BYOK store) to decide
// whether to show the "No LLM connected" prompt in the AI panel. The route
// only returns a boolean — the actual key value never leaves the server.

export const dynamic = "force-dynamic";

export async function GET() {
  const hasDefaultKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  return Response.json({ hasDefaultKey });
}

/**
 * AI request/response logging — console only.
 *
 * Used to write each request to `.ai-logs/*.json` as well, but that
 * required `fs`/`path` which broke client bundling once score-client
 * started importing ai-provider for the BYOK-from-browser path. The
 * console summary covers debugging needs in both runtimes (devtools
 * Network tab gives the full request/response payload anyway).
 */

export interface AILogEntry {
  id: string;
  timestamp: string;
  operation: "create" | "revise";
  provider: string;
  model: string;
  // Request
  prompt: string;
  systemPrompt: string;
  currentScore?: unknown;
  // Response
  rawResponse?: string;
  parsedResponse?: unknown;
  // Result
  error?: string;
  durationMs: number;
}

export function logAIRequest(entry: AILogEntry): void {
  const status = entry.error ? "ERROR" : "OK";
  console.log(
    `[AI ${entry.operation.toUpperCase()}] ${status} | ${entry.provider}/${entry.model} | ${entry.durationMs}ms | prompt: "${entry.prompt.slice(0, 80)}${entry.prompt.length > 80 ? "..." : ""}"`,
  );
  if (entry.error) {
    console.error(`[AI ERROR] ${entry.error}`);
  }
  if (entry.rawResponse) {
    const raw = entry.rawResponse;
    if (raw.length > 500) {
      console.log(`[AI RAW] (${raw.length} chars) ${raw.slice(0, 300)}...${raw.slice(-200)}`);
    } else {
      console.log(`[AI RAW] ${raw}`);
    }
  }
}

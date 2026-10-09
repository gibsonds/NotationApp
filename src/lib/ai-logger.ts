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
  console.log(`[AI ${entry.operation}] ${entry.error ? "ERROR" : "OK"} | ${entry.provider}/${entry.model} | ${entry.durationMs}ms`);
}

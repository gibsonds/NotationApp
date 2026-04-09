import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), ".ai-logs");

function ensureLogDir() {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // If we can't create the dir, we'll just log to console
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

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

let logCounter = 0;

export function logAIRequest(entry: AILogEntry): void {
  const ts = entry.timestamp;
  const status = entry.error ? "ERROR" : "OK";

  // Always log summary to console
  console.log(
    `[AI ${entry.operation.toUpperCase()}] ${status} | ${entry.provider}/${entry.model} | ${entry.durationMs}ms | prompt: "${entry.prompt.slice(0, 80)}${entry.prompt.length > 80 ? "..." : ""}"`
  );

  if (entry.error) {
    console.error(`[AI ERROR] ${entry.error}`);
  }

  // Log raw response to console (truncated)
  if (entry.rawResponse) {
    const raw = entry.rawResponse;
    if (raw.length > 500) {
      console.log(`[AI RAW] (${raw.length} chars) ${raw.slice(0, 300)}...${raw.slice(-200)}`);
    } else {
      console.log(`[AI RAW] ${raw}`);
    }
  }

  // Write full log to file
  ensureLogDir();
  try {
    logCounter++;
    const filename = `${ts}-${entry.operation}-${logCounter}.json`;
    const filepath = path.join(LOG_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));
    console.log(`[AI LOG] Written to ${filepath}`);
  } catch (err) {
    console.error("[AI LOG] Failed to write log file:", err);
  }
}

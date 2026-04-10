import { Score, ScoreIntent, ScorePatch } from "./schema";
import { logAIRequest, AILogEntry } from "./ai-logger";
import { compactScoreForAI, estimateTokens } from "./score-compact";
import { NoteSelection } from "./transforms";

// ── LLM-agnostic interface ─────────────────────────────────────────────────

export interface ScoreIntentProvider {
  createScoreFromPrompt(prompt: string): Promise<{
    intent: ScoreIntent;
    message: string;
  }>;
  reviseScoreFromPrompt(
    prompt: string,
    currentScore: Score,
    selection?: NoteSelection
  ): Promise<{
    patches: ScorePatch[];
    message: string;
  }>;
}

// ── System prompt for score generation ─────────────────────────────────────

export const SYSTEM_PROMPT_CREATE = `You are a music notation assistant. Given a natural language description of a musical score, output a structured JSON object representing the score intent.

Output ONLY valid JSON matching this schema:
{
  "title": string (optional),
  "composer": string (optional),
  "tempo": number (BPM, optional),
  "timeSignature": string like "4/4" (optional),
  "keySignature": one of "C","G","D","A","E","B","F#","Gb","Db","Ab","Eb","Bb","F","Am","Em","Bm","F#m","C#m","G#m","D#m","Dm","Gm","Cm","Fm","Bbm","Ebm" (optional),
  "measures": number (optional),
  "staves": array of { "name": string, "clef": "treble"|"bass"|"alto"|"tenor", "lyricsMode": "attached"|"none" (optional), "voices": array of { "role": "melody"|"harmony"|"bass"|"accompaniment"|"general", "notes": array of note objects } (optional) } (optional),
  "chordSymbols": array of { "measure": number, "beat": number, "symbol": string } (optional),
  "rehearsalMarks": array of { "measure": number, "label": string } (optional)
}

Note objects have: { "pitch": string like "G4" or "rest", "duration": "whole"|"half"|"quarter"|"eighth"|"sixteenth", "dots": 0-2, "accidental": "sharp"|"flat"|"natural"|"none", "tieStart": boolean, "tieEnd": boolean, "lyric": string (optional — one syllable per note, use "-" suffix for melisma continuation e.g. "Hal-", "le-", "lu-", "jah"), "articulations": ["accent"|"strong-accent"|"staccato"|"staccatissimo"|"tenuto"|"detached-legato"|"fermata"] (optional array), "beam": "begin"|"continue"|"end"|"none" (optional — override auto-beaming; omit to use default beaming), "measure": number, "beat": number }

BEAMING: By default, consecutive eighth/sixteenth notes are automatically beamed within beat groups. Use the "beam" field to override: "begin" starts a beam group, "continue" extends it, "end" closes it, "none" prevents beaming on that note. Example: to beam 4 eighth notes across beats 1-2, set beam:"begin" on the first, beam:"continue" on the middle two, beam:"end" on the last.

LYRICS: To add lyrics, put a "lyric" field on each note that carries a syllable. For chords, only the first note (lowest beat value) gets the lyric. The staff must have "lyricsMode": "attached" (use "update_staff" to set this if needed). Break words into syllables with hyphens: "A-", "ma-", "zing" or "hal-", "le-", "lu-", "jah". One syllable per note.

Rules:
- Generate actual musical notes that make sense musically (correct pitches for the key, proper rhythms filling each measure).
- For each voice, notes MUST fill every measure exactly. A 4/4 measure needs exactly 4 quarter-note beats worth of duration.
- Use reasonable defaults: 120 BPM, 8 measures, 4/4 time if not specified.
- Chord symbols should use standard notation: "G", "Am7", "Cmaj7", "F#m", etc.
- If the user asks for a melody, generate an actual singable melody in the specified key.
- If the user asks for a bass line, generate appropriate bass notes.
- If the user asks for harmony, generate harmonically appropriate parts.
- Keep it musically tasteful and idiomatic for the style requested.
- Output raw JSON only, no markdown fences, no explanation.`;

export const SYSTEM_PROMPT_REVISE = `You are a music notation assistant. Given a user's revision request and the current score JSON, output patch operations to modify the score — or a conversational response if you need clarification or want to explain something.

Output ONLY a JSON object with one of these structures:

If making changes:
{
  "patches": [...],
  "message": "Brief description of what changed"
}

If you need to ask a question, explain something, or the request is ambiguous:
{
  "patches": [],
  "message": "Your question or explanation here"
}

Available patch operations:
- { "op": "set_title", "value": string }
- { "op": "set_tempo", "value": number }
- { "op": "set_time_signature", "value": string }
- { "op": "set_key_signature", "value": string }
- { "op": "set_measures", "value": number }
- { "op": "update_staff", "staffId": string, "name"?: string, "clef"?: string, "lyricsMode"?: string }
- { "op": "add_staff", "staff": { full staff object } }
- { "op": "remove_staff", "staffId": string }
- { "op": "set_notes", "staffId": string, "voiceId": string, "notes": [...note objects] }  (MERGES by measure — only measures present in notes array are replaced; other measures are preserved)
- { "op": "set_chord_symbols", "chordSymbols": [...] }
- { "op": "replace_score", "score": { full score intent object } }

To add or change lyrics: use "set_notes" with the "lyric" field on each note. Also ensure the staff has lyricsMode "attached" via "update_staff". One syllable per note, hyphenate multi-syllable words: "A-", "ma-", "zing".

Rules:
- Use minimal patches — only change what the user asked for.
- If the change is complex (rewrite most of the score), use "replace_score".
- For note changes, ensure measures are fully filled with correct durations.
- "set_notes" merges by measure: only include notes for the measures you want to change. Notes in other measures are automatically preserved. Do NOT send notes for the entire score when only modifying specific measures.
- Preserve existing content the user didn't ask to change.
- The "message" should briefly explain what you changed in musical terms.
- If the request is unclear, ambiguous, or you need more information, respond with empty patches [] and ask your question in "message". It's better to ask than to guess wrong.
- If the user asks a question about the score (not requesting a change), respond with empty patches [] and answer in "message".
- Output raw JSON only, no markdown fences, no explanation.`;

// ── Anthropic Claude Provider ──────────────────────────────────────────────

export class ClaudeProvider implements ScoreIntentProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "claude-sonnet-4-20250514") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async createScoreFromPrompt(
    prompt: string
  ): Promise<{ intent: ScoreIntent; message: string }> {
    const startTime = Date.now();
    const logEntry: Partial<AILogEntry> = {
      id: `create-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operation: "create",
      provider: "anthropic",
      model: this.model,
      prompt,
      systemPrompt: SYSTEM_PROMPT_CREATE.slice(0, 200) + "...",
    };

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16384,
          system: SYSTEM_PROMPT_CREATE,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${err}`);
      }

      const data = await response.json();
      const text = data.content[0]?.text;
      logEntry.rawResponse = text;

      if (!text) throw new Error("Empty response from Claude");

      const intent = safeParseJSON(text, "create");
      logEntry.parsedResponse = intent;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);

      return {
        intent,
        message: `Created score based on your description.`,
      };
    } catch (err: any) {
      logEntry.error = err.message;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);
      throw err;
    }
  }

  async reviseScoreFromPrompt(
    prompt: string,
    currentScore: Score,
    selection?: NoteSelection
  ): Promise<{ patches: ScorePatch[]; message: string }> {
    const startTime = Date.now();
    const logEntry: Partial<AILogEntry> = {
      id: `revise-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operation: "revise",
      provider: "anthropic",
      model: this.model,
      prompt,
      systemPrompt: SYSTEM_PROMPT_REVISE.slice(0, 200) + "...",
      currentScore: `[${currentScore.staves.length} staves, ${currentScore.measures} measures]`,
    };

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 16384,
          system: SYSTEM_PROMPT_REVISE,
          messages: [
            {
              role: "user",
              content: buildRevisionPrompt(currentScore, prompt, selection),
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API error: ${response.status} - ${err}`);
      }

      const data = await response.json();
      const text = data.content[0]?.text;
      const stopReason = data.stop_reason;
      logEntry.rawResponse = text;

      if (!text) throw new Error("Empty response from Claude");

      if (stopReason === "max_tokens") {
        console.warn("[AI] Response was truncated (hit max_tokens). Score may be too large for revision context.");
      }

      const parsed = safeParseJSON(text, "revise");
      logEntry.parsedResponse = parsed;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);

      return {
        patches: parsed.patches || [],
        message: parsed.message || "Score updated.",
      };
    } catch (err: any) {
      logEntry.error = err.message;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);
      throw err;
    }
  }
}

// ── OpenAI-compatible Provider ─────────────────────────────────────────────

export class OpenAIProvider implements ScoreIntentProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(
    apiKey: string,
    model = "gpt-4o",
    baseUrl = "https://api.openai.com/v1"
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
  }

  async createScoreFromPrompt(
    prompt: string
  ): Promise<{ intent: ScoreIntent; message: string }> {
    const startTime = Date.now();
    const logEntry: Partial<AILogEntry> = {
      id: `create-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operation: "create",
      provider: "openai",
      model: this.model,
      prompt,
      systemPrompt: SYSTEM_PROMPT_CREATE.slice(0, 200) + "...",
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT_CREATE },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${err}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content;
      logEntry.rawResponse = text;

      if (!text) throw new Error("Empty response from OpenAI");

      const intent = safeParseJSON(text, "create");
      logEntry.parsedResponse = intent;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);

      return {
        intent,
        message: `Created score based on your description.`,
      };
    } catch (err: any) {
      logEntry.error = err.message;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);
      throw err;
    }
  }

  async reviseScoreFromPrompt(
    prompt: string,
    currentScore: Score,
    selection?: NoteSelection
  ): Promise<{ patches: ScorePatch[]; message: string }> {
    const startTime = Date.now();
    const logEntry: Partial<AILogEntry> = {
      id: `revise-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operation: "revise",
      provider: "openai",
      model: this.model,
      prompt,
      systemPrompt: SYSTEM_PROMPT_REVISE.slice(0, 200) + "...",
      currentScore: `[${currentScore.staves.length} staves, ${currentScore.measures} measures]`,
    };

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT_REVISE },
            {
              role: "user",
              content: buildRevisionPrompt(currentScore, prompt, selection),
            },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${err}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content;
      logEntry.rawResponse = text;

      if (!text) throw new Error("Empty response from OpenAI");

      const parsed = safeParseJSON(text, "revise");
      logEntry.parsedResponse = parsed;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);

      return {
        patches: parsed.patches || [],
        message: parsed.message || "Score updated.",
      };
    } catch (err: any) {
      logEntry.error = err.message;
      logEntry.durationMs = Date.now() - startTime;
      logAIRequest(logEntry as AILogEntry);
      throw err;
    }
  }
}

// ── Provider Factory ───────────────────────────────────────────────────────

export function createProvider(): ScoreIntentProvider {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (anthropicKey) {
    return new ClaudeProvider(
      anthropicKey,
      process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
    );
  }

  if (openaiKey) {
    return new OpenAIProvider(
      openaiKey,
      process.env.OPENAI_MODEL || "gpt-4o"
    );
  }

  throw new Error(
    "No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildRevisionPrompt(score: Score, prompt: string, selection?: NoteSelection): string {
  const fullJson = JSON.stringify(score, null, 2);
  const fullTokens = estimateTokens(fullJson);

  // Determine focus measures from selection
  const focusMeasures = selection
    ? Array.from(
        { length: selection.endMeasure - selection.startMeasure + 1 },
        (_, i) => selection.startMeasure + i
      )
    : undefined;

  // If the full score is small enough (< 8K tokens), send it as-is
  if (fullTokens < 8000) {
    return `Current score:\n${fullJson}\n\nRevision request: ${prompt}`;
  }

  // Otherwise, send a compact version with full notes for selected measures
  const compact = compactScoreForAI(score, { focusMeasures });
  const compactJson = JSON.stringify(compact, null, 2);
  console.log(
    `[AI] Score too large for full context (${fullTokens} tokens). Using compact representation (${estimateTokens(compactJson)} tokens).` +
    (focusMeasures ? ` Focus measures: ${focusMeasures.join(", ")}` : "")
  );

  let instructions =
    `Current score (compact — note details summarized per measure):\n${compactJson}\n\n` +
    `IMPORTANT: The score has ${score.measures} measures across ${score.staves.length} staves. `;

  if (focusMeasures) {
    instructions +=
      `Full note data is included for measures ${focusMeasures[0]}-${focusMeasures[focusMeasures.length - 1]}. ` +
      `Other measures are summarized. Only modify the selected measures unless the user explicitly asks otherwise. `;
  } else {
    instructions += `Note arrays are summarized above. `;
  }

  instructions +=
    `When using "set_notes", provide complete note arrays for affected measures. ` +
    `For structural changes (key, tempo, title, clef, time signature), use the specific patch ops.\n\n` +
    `Revision request: ${prompt}`;

  return instructions;
}

function safeParseJSON(text: string, context: string): any {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (firstError: any) {
    console.error(`[AI JSON] First parse attempt failed for ${context}:`, firstError.message);
    console.error(`[AI JSON] Raw text length: ${cleaned.length}, last 100 chars: "${cleaned.slice(-100)}"`);

    // Attempt to repair truncated JSON by closing open brackets/braces
    const repaired = tryRepairJSON(cleaned);
    if (repaired) {
      try {
        const result = JSON.parse(repaired);
        console.warn(`[AI JSON] Successfully repaired truncated JSON for ${context}`);
        return result;
      } catch {
        // Fall through to error
      }
    }

    throw new Error(
      `Failed to parse AI response as JSON (${context}). ` +
      `Response length: ${cleaned.length} chars. ` +
      `Last 80 chars: "${cleaned.slice(-80)}". ` +
      `This usually means the response was truncated (too large for max_tokens). ` +
      `Original error: ${firstError.message}`
    );
  }
}

function tryRepairJSON(text: string): string | null {
  // Count unmatched brackets and braces
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") braces++;
    else if (ch === "}") braces--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }

  if (braces === 0 && brackets === 0) return null; // Not a bracket issue

  // Close any open string
  let repaired = text;
  if (inString) repaired += '"';

  // Close brackets and braces (innermost first)
  // Try to figure out the nesting order from the end
  const closers: string[] = [];
  let b = braces;
  let k = brackets;

  // Simple heuristic: close in reverse order they'd likely be open
  // For typical JSON: close arrays first, then objects
  while (k > 0) { closers.push("]"); k--; }
  while (b > 0) { closers.push("}"); b--; }

  // Remove trailing comma before closing
  repaired = repaired.replace(/,\s*$/, "");
  repaired += closers.join("");

  return repaired;
}

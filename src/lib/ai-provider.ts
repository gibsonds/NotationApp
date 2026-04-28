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

There are TWO output modes — pick based on the user's request:

(A) FULL NOTATION mode: generate \`staves\` with notes for melody/harmony/bass. Use this for instrumental pieces, melodies, transcriptions, or anything where the user explicitly wants notes on a staff.

(B) CHORD CHART mode (a.k.a. songbook / lead sheet / lyrics-and-chords / "no notation"): generate \`sections\` and OMIT \`staves\` (use an empty array []). Use this when the user provides lyrics, asks for "just lyrics and chords", says "no notation", describes a song by sections ("verse", "chorus") and chords, or asks for a chord chart / songbook / lead sheet. ALWAYS use this mode when the user's input is primarily lyric text.

LYRICS-FIRST WORKFLOW: If the user pastes lyrics with no chord information ("just lyrics", "no chords yet", or just lyric text alone), output a chord chart with the lyrics filled in and chord lines LEFT EMPTY. Don't invent chords they didn't ask for. They will follow up with "add chords [D G D A]..." in a revise step.

Output ONLY valid JSON matching this schema:
{
  "title": string (optional),
  "composer": string (optional),
  "tempo": number (BPM, optional),
  "timeSignature": string like "4/4" (optional),
  "keySignature": one of "C","G","D","A","E","B","F#","Gb","Db","Ab","Eb","Bb","F","Am","Em","Bm","F#m","C#m","G#m","D#m","Dm","Gm","Cm","Fm","Bbm","Ebm" (optional),
  "measures": number (optional, full-notation mode only),
  "staves": array of { "name": string, "clef": "treble"|"bass"|"alto"|"tenor", "lyricsMode": "attached"|"none" (optional), "voices": array of { "role": "melody"|"harmony"|"bass"|"accompaniment"|"general", "notes": array of note objects } (optional) } (notation mode — omit or [] for chord-chart mode),
  "chordSymbols": array of { "measure": number, "beat": number, "symbol": string } (optional),
  "rehearsalMarks": array of { "measure": number, "label": string } (optional),
  "sections": array of { "id": string, "label": string, "lines": array of { "chords": string, "lyrics": string } } (chord-chart mode),
  "form": array of section IDs in playback order (chord-chart mode, optional — order will default to sections[] order if not specified)
}

CHORD CHART MODE — LINE FORMAT:
The \`lines\` array represents the section as it should appear on the page, top to bottom. Each line has a \`chords\` overlay (free-form text) and a \`lyrics\` line. They render in MONOSPACE so column N of the chord line visually sits above column N of the lyric line — that's how a chord change is positioned over a specific syllable.

The \`chords\` field is a free-form string mixing chord names and bar markers ("|"), padded with spaces so each chord lines up above the syllable where it changes. Examples:
  chords: "D                G              D       A"
  lyrics: "Once I saw a tree with a bend so big it broke"

  chords: "|D    |D    |"
  lyrics: ""                       ← chord-only line (intro vamp pattern)

  chords: "        |            |G          |"
  lyrics: "when it was just a twig that was long ago"

  chords: ""
  lyrics: "Must have gotten crushed"   ← lyric-only line (no chord change here)

A blank line (both empty) creates vertical spacing between phrases. Use it sparingly.

CHORD CHART MODE — RULES:
- Each section's \`id\` is short ("V", "C", "B", "intro", "outro", "bridge"). The \`label\` is the human display name ("Verse", "Verse 1", "Chorus", "Bridge", "Intro").
- Pure-lyrics input (no chord info from user) → emit lines with the lyrics filled in and chord strings as "". Do NOT guess chords.
- When the user asks for chords, place them above the syllable where they change. Pad with spaces. Use bar markers "|" if the user used them or asked for them.
- Chord names use standard notation: C, Am, G7, Cmaj7, F#m7b5, etc.
- A "vamp" of N bars on chord X = a chord-only line like "|X    |X    |X    |X    |" (one line, multiple bars).
- \`form\` is the ordered sequence of section IDs that play. "VVCVCBVCC" means \`["V","V","C","V","C","B","V","C","C"]\`. Optional — omit it if the user hasn't specified.
- Set \`measures\` to 1 for chord-chart mode (it's not used by the chord-chart renderer; it just satisfies the schema).

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

Note objects have: { "pitch": string like "G4" or "rest", "duration": "whole"|"half"|"quarter"|"eighth"|"sixteenth", "dots": 0-2, "accidental": "sharp"|"flat"|"natural"|"none", "tieStart": boolean, "tieEnd": boolean, "lyric": string (optional), "articulations": ["accent"|"staccato"|"tenuto"|"fermata"|...] (optional array), "beam": "begin"|"continue"|"end"|"none" (optional — override auto-beaming), "measure": number, "beat": number }

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
- { "op": "update_note", "staffId": string, "voiceId": string, "measure": number, "beat": number, "pitch": string, "updates": { ...fields to change } }  (modifies a single existing note in place — use for ties, accidentals, dots, articulations, lyrics, beam overrides)
- { "op": "set_chord_symbols", "chordSymbols": [...] }

Chord-chart (songbook) patches — prefer these over \`replace_score\` when the score has \`sections\` populated. They're targeted, fast, and round-trip cleanly through undo/redo:
- { "op": "set_section_label", "sectionId": string, "label": string }  (rename a section)
- { "op": "add_section", "section": { id, label, lines: [...] }, "index"?: number }
- { "op": "remove_section", "sectionId": string }
- { "op": "update_section_line", "sectionId": string, "lineIdx": number, "chords"?: string, "lyrics"?: string }  (edit chord overlay or lyrics in place)
- { "op": "add_section_line", "sectionId": string, "index"?: number, "line": { "chords": string, "lyrics": string } }
- { "op": "remove_section_line", "sectionId": string, "lineIdx": number }
- { "op": "set_form", "form": [section ids in order] }
- { "op": "split_section", "sectionId": string, "atLineIdx": number, "newSection": { "id": string, "label": string } }  (split a section into two — lines from atLineIdx onward move to the new section)

- { "op": "replace_score", "score": { full score intent object } }  (only if you're rewriting most of the song)

CHORD CHART EDITS: If the score has \`sections\` populated (chord-chart / songbook mode), prefer the targeted section patches above. Only fall back to \`replace_score\` when the change is structural (rewriting most sections at once). The chord-chart format is:
  sections: [{ id, label, lines: [{ chords: string, lyrics: string }, ...] }]
- The \`chords\` line is a free-form string with chord names and "|" bar markers, space-padded so each chord sits above the syllable in the \`lyrics\` line below it (monospace alignment).
- Common edits:
  - "add chords for verse 1: D G D A" → fill in the verse's chord lines, placing chords above syllables. If the user lists chords without saying which syllable, distribute them evenly across the line.
  - "no chords yet, just lyrics" → emit lines with chords: "" and lyrics filled in.
  - "change the second chord to G7" → modify just that chord in the right line.
  - "add a chorus" → append a new section to sections[].
- Preserve existing sections the user didn't ask to change. If only modifying one section, still emit the full sections array via \`replace_score\` with all sections.
- For chord charts, \`staves\` should be [] and \`measures\` should be 1.

TIES: To add a tie between two notes of the same pitch, use "update_note" to set "tieStart": true on the first note and "tieEnd": true on the second note. NEVER use "set_notes" just to add ties — "set_notes" replaces ALL notes in that measure, which will delete other notes. Always use "update_note" for modifying properties of existing notes (ties, accidentals, dots, articulations, lyrics).

BEAMING: By default, consecutive eighth/sixteenth notes are automatically beamed within beat groups. Use the "beam" field on notes to override: "begin" starts a beam group, "continue" extends it, "end" closes it, "none" prevents beaming on that note. Example: to beam two eighth notes on beats 3 and 4, set beam:"begin" on the first and beam:"end" on the second.

MULTIPLE VOICES: Each staff can have multiple voices for polyphonic writing. Use separate "set_notes" patches with different voiceId values to write independent rhythmic layers on the same staff. Voice 1 is typically the melody/upper part, Voice 2 is the lower part. Both voices must independently fill each measure with correct durations. Common use: Voice 1 has beamed eighth notes while Voice 2 has longer note values or rests underneath.

LYRICS: Use "set_notes" with the "lyric" field on each note. Ensure the staff has lyricsMode "attached" via "update_staff". One syllable per note, hyphenate multi-syllable words: "A-", "ma-", "zing".

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

  // Hard-pin the AI into chord-chart mode when the score is one. Without this,
  // the model sometimes "helpfully" offers to convert it to staff notation or
  // asks clarifying questions that imply a notation interpretation.
  const isChordChart = Array.isArray(score.sections) && score.sections.length > 0;
  const modeHint = isChordChart
    ? `MODE: chord-chart (a.k.a. songbook / lead sheet). The score has ${score.sections.length} section(s) and NO staves. Edit sections via \`replace_score\`. Do NOT add staves, do NOT convert to staff notation, do NOT ask whether the user wants notation — they don't. Adding/removing sections, filling in chord lines, editing lyrics, and reordering sections all happen in chord-chart format. If the user asks to "add an Intro section", append a new section to \`sections\` with id="intro" or similar; do not interpret this as adding a staff or notation measures.\n\n`
    : "";

  // If the full score is small enough (< 8K tokens), send it as-is
  if (fullTokens < 8000) {
    return `${modeHint}Current score:\n${fullJson}\n\nRevision request: ${prompt}`;
  }

  // Otherwise, send a compact version with full notes for selected measures
  const compact = compactScoreForAI(score, { focusMeasures });
  const compactJson = JSON.stringify(compact, null, 2);
  console.log(
    `[AI] Score too large for full context (${fullTokens} tokens). Using compact representation (${estimateTokens(compactJson)} tokens).` +
    (focusMeasures ? ` Focus measures: ${focusMeasures.join(", ")}` : "")
  );

  let instructions =
    `${modeHint}Current score (compact — note details summarized per measure):\n${compactJson}\n\n` +
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

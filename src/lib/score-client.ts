/**
 * Client-side dispatcher for AI score operations (create, revise).
 *
 * In a normal `npm run dev` environment, score requests go through
 * Next.js API routes at `/api/score/*` which read BYOK headers from the
 * client and call Anthropic / OpenAI server-side. In the static
 * GitHub Pages build (`STATIC_EXPORT=1`), those routes don't exist —
 * so this module short-circuits the round-trip and calls the provider
 * directly from the browser using the BYOK key from localStorage.
 *
 * Callers don't need to know which path executed: they get the same
 * shape back either way. Errors thrown contain user-displayable
 * messages so UI layers can surface them directly.
 */

import { IS_STATIC_EXPORT } from "@/lib/api-availability";
import { createProvider } from "@/lib/ai-provider";
import { getApiKey, getByokHeaders } from "@/lib/api-key-store";
import {
  expandIntentToScore,
  validateScore,
  validateScoreIntent,
} from "@/lib/validation";
import { applyPatch } from "@/lib/patches";
import type { Score } from "@/lib/schema";
import type { ScorePatch } from "@/lib/schema";
import type { NoteSelection } from "@/lib/transforms";

export interface CreateScoreResult {
  score: Score;
  message: string;
  warnings: string[];
}

export interface ReviseScoreResult {
  score: Score;
  patches: ScorePatch[];
  message: string;
  warnings: string[];
}

/**
 * True when the running build can dispatch AI calls (either via the
 * server route OR via a BYOK key in browser localStorage). UI gates
 * should check THIS, not IS_STATIC_EXPORT — a static deploy with a
 * stored key is perfectly capable of running AI requests.
 */
export function aiAvailable(): boolean {
  if (!IS_STATIC_EXPORT) return true;
  return !!(getApiKey("anthropic") || getApiKey("openai"));
}

/** User-facing message for the case where AI is gated. */
export function aiUnavailableMessage(): string {
  if (!IS_STATIC_EXPORT) {
    return "AI is not configured on this server. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env.local, or open API Keys settings to add one.";
  }
  return "Add an Anthropic or OpenAI API key under Settings → API Keys to use AI on this deploy. Keys live only in your browser.";
}

export async function requestCreateScore(prompt: string): Promise<CreateScoreResult> {
  if (IS_STATIC_EXPORT) {
    return createScoreDirect(prompt);
  }
  const res = await fetch("/api/score/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getByokHeaders() },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Score create failed: ${res.status}`);
  }
  return res.json();
}

export async function requestReviseScore(
  prompt: string,
  currentScore: Score,
  selection?: NoteSelection,
  selectedNote?: string,
): Promise<ReviseScoreResult> {
  if (IS_STATIC_EXPORT) {
    return reviseScoreDirect(prompt, currentScore, selection, selectedNote);
  }
  const res = await fetch("/api/score/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getByokHeaders() },
    body: JSON.stringify({ prompt, currentScore, selection, selectedNote }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Score revise failed: ${res.status}`);
  }
  return res.json();
}

// ── Direct-from-browser implementations ───────────────────────────────────
// These mirror the logic in src/app/api/score/{create,revise}/route.ts but
// run client-side using the BYOK key. Any future change to a route's
// semantics needs a matching change here.

async function createScoreDirect(prompt: string): Promise<CreateScoreResult> {
  const provider = createProvider({
    anthropic: getApiKey("anthropic") ?? undefined,
    openai: getApiKey("openai") ?? undefined,
  });
  const { intent, message } = await provider.createScoreFromPrompt(prompt);

  const intentValidation = validateScoreIntent(intent);
  if (!intentValidation.valid) {
    throw new Error(
      `AI generated invalid score structure: ${intentValidation.errors.join("; ")}`,
    );
  }
  const score = expandIntentToScore(intent);
  const validation = validateScore(score);
  return {
    score,
    message,
    warnings: [...intentValidation.warnings, ...validation.warnings],
  };
}

async function reviseScoreDirect(
  prompt: string,
  currentScore: Score,
  selection?: NoteSelection,
  selectedNote?: string,
): Promise<ReviseScoreResult> {
  // Mirror the server route's chord-chart-vs-staff augmentation.
  const isChordChart =
    Array.isArray(currentScore.sections) && currentScore.sections.length > 0;
  let augmentedPrompt = prompt;
  if (!isChordChart) {
    if (selection) {
      const range =
        selection.startMeasure === selection.endMeasure
          ? `measure ${selection.startMeasure}`
          : `measures ${selection.startMeasure}-${selection.endMeasure}`;
      const staffNote = selection.staffIds
        ? ` on staves: ${selection.staffIds.join(", ")}`
        : "";
      const noteInfo = selectedNote ? ` (selected note: ${selectedNote})` : "";
      augmentedPrompt = `[SELECTION: ${range}${staffNote}${noteInfo}] ${prompt}`;
    } else if (selectedNote) {
      augmentedPrompt = `[SELECTED NOTE: ${selectedNote}] ${prompt}`;
    }
  }

  const provider = createProvider({
    anthropic: getApiKey("anthropic") ?? undefined,
    openai: getApiKey("openai") ?? undefined,
  });
  const { patches, message } = await provider.reviseScoreFromPrompt(
    augmentedPrompt,
    currentScore,
    selection,
  );

  let updatedScore = currentScore;
  for (const patch of patches) {
    updatedScore = applyPatch(updatedScore, patch);
  }
  const validation = validateScore(updatedScore);

  return {
    score: updatedScore,
    patches,
    message,
    warnings: validation.warnings,
  };
}

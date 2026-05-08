/**
 * localStorage-backed feedback storage. Submissions are sanitized before
 * write — HTML tags stripped, trimmed, length-capped — so anything later
 * displayed back from this store is safe regardless of how it was entered.
 */

export type FeedbackCategory = "bug" | "feature" | "other";

export interface FeedbackEntry {
  id: string;
  timestamp: number;
  category: FeedbackCategory;
  message: string;
  email?: string;
  images?: string[];
}

const STORAGE_KEY = "notation-app-feedback";
const MAX_MESSAGE_LENGTH = 1000;
const MAX_EMAIL_LENGTH = 200;
const MAX_IMAGES = 3;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function sanitizeImages(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((s): s is string => typeof s === "string" && IMAGE_DATA_URL_PATTERN.test(s))
    .slice(0, MAX_IMAGES);
}

/** Strip HTML tags, decode common entities, collapse whitespace, trim, cap length. */
function sanitizeText(input: string, maxLength: number): string {
  if (typeof input !== "string") return "";
  // Remove anything that looks like an HTML tag, including malformed/unclosed
  // ones — repeat until stable so nested constructs like "<<b>script>" don't
  // leave a residual "<b>".
  let prev = "";
  let cur = input;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(/<[^>]*>?/g, "");
  }
  // Decode a small set of HTML entities so "&lt;script&gt;" doesn't survive
  // as visible markup-looking text.
  cur = cur
    .replace(/&lt;/gi, "")
    .replace(/&gt;/gi, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x?[0-9a-f]+;/gi, "");
  return cur.trim().slice(0, maxLength);
}

/** Read the stored feedback array, recovering from corruption by returning []. */
export function getFeedback(): FeedbackEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is FeedbackEntry =>
          e &&
          typeof e === "object" &&
          typeof e.id === "string" &&
          typeof e.timestamp === "number" &&
          (e.category === "bug" || e.category === "feature" || e.category === "other") &&
          typeof e.message === "string"
      )
      .map((e) => {
        const images = sanitizeImages(e.images);
        if (images.length > 0) return { ...e, images };
        const { images: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
  } catch {
    return [];
  }
}

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  email?: string;
  images?: string[];
}

/**
 * Sanitize and persist a feedback submission. Returns the stored entry, or
 * throws if the message is empty after sanitization.
 */
export function submitFeedback(entry: FeedbackInput): FeedbackEntry {
  const message = sanitizeText(entry.message, MAX_MESSAGE_LENGTH);
  if (!message) {
    throw new Error("Message is required.");
  }
  const emailRaw = entry.email ? sanitizeText(entry.email, MAX_EMAIL_LENGTH) : "";
  const images = sanitizeImages(entry.images);
  const stored: FeedbackEntry = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `fb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
    category: entry.category,
    message,
    ...(emailRaw ? { email: emailRaw } : {}),
    ...(images.length > 0 ? { images } : {}),
  };

  const existing = getFeedback();
  const next = [...existing, stored];
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("[feedback-store] write failed", err);
      throw err;
    }
  }
  return stored;
}

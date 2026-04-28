/**
 * Check whether server-backed features (AI generation, AI revision, audio
 * transcription, MIDI/MusicXML import via API route) are available.
 *
 * Returns false when the app was built with STATIC_EXPORT=1 (e.g. for the
 * GitHub Pages deploy) — in that case no server is running, so the routes
 * don't exist. Clients should detect this up-front and surface a friendly
 * "feature unavailable in this hosted build" message rather than letting
 * a network request silently 404.
 */
export const IS_STATIC_EXPORT = process.env.NEXT_PUBLIC_STATIC_EXPORT === "1";

export const SERVER_FEATURES_AVAILABLE = !IS_STATIC_EXPORT;

export const STATIC_FEATURE_DISABLED_MESSAGE =
  "This feature requires the local dev server with an LLM API key. Clone the repo and run `npm run dev` to use AI generation, revision, or audio transcription.";

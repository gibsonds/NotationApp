"use client";

const PREFS_KEY = "notation-app-playback-prefs";

export interface PlaybackPrefs {
  metronome: boolean;
  countInBars: 0 | 1 | 2;
}

const DEFAULT: PlaybackPrefs = { metronome: false, countInBars: 0 };

export function loadPlaybackPrefs(): PlaybackPrefs {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

export function savePlaybackPrefs(p: PlaybackPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* localStorage full — settings still apply for the session */
  }
}

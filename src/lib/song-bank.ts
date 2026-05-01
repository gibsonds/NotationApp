import type { Score } from "@/lib/schema";

export interface SongBankEntry {
  id: string;
  title: string;
  savedAt: number;
  score: Score;
}

const STORAGE_KEY = "notation-app-songs";

export function getSongs(): SongBankEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SongBankEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveSong(title: string, score: Score): void {
  const songs = getSongs();
  songs.push({
    id: `song-${Date.now()}`,
    title,
    savedAt: Date.now(),
    score: JSON.parse(JSON.stringify(score)),
  });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch {
    console.warn("[song-bank] localStorage quota exceeded");
  }
}

export function deleteSong(id: string): void {
  try {
    const songs = getSongs().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch {
    console.warn("[song-bank] failed to delete song");
  }
}

export function setSongs(songs: SongBankEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  } catch {
    console.warn("[song-bank] localStorage quota exceeded");
  }
}

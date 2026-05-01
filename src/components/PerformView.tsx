"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/schema";
import ChordChartView from "@/components/ChordChartView";
import { useScoreStore } from "@/store/score-store";
import { getSongs, type SongBankEntry } from "@/lib/song-bank";

const PREFS_KEY = "notation-app-perform-prefs";

interface PerformPrefs {
  fontSize: number;       // rem
  lineHeight: number;     // unitless multiplier
  letterSpacing: number;  // em
  columns: 1 | 2;
}

const DEFAULT_PREFS: PerformPrefs = {
  fontSize: 1.5,
  lineHeight: 1.4,
  letterSpacing: 0.02,
  columns: 1,
};

function loadPrefs(): PerformPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: PerformPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* localStorage full or blocked — settings still apply for the session */
  }
}

interface PerformViewProps {
  score: Score;
  onExit: () => void;
}

/**
 * Full-bleed read-only view of a chord chart, optimized for performance use
 * on iPad. Top/bottom tap zones page-scroll; floating toolbar adjusts font
 * size, leading, and kerning live (persisted globally to localStorage).
 * Esc or the Done button returns to edit mode.
 */
export default function PerformView({ score, onExit }: PerformViewProps) {
  const [prefs, setPrefs] = useState<PerformPrefs>(loadPrefs);
  const setScore = useScoreStore(s => s.setScore);
  const setUIState = useScoreStore(s => s.setUIState);
  const currentSongId = useScoreStore(s => s.uiState.currentSongId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Snapshot the song list on mount — performance shouldn't be interrupted
  // by sync updates. Newest first matches the My Songs modal ordering.
  const [songs] = useState<SongBankEntry[]>(() => getSongs().slice().reverse());

  // Find the position of the current song in the list. Falls back to the
  // first song if currentSongId isn't set or doesn't match (e.g. unsaved
  // edits, fresh creation). The fallback also handles the case where the
  // user opens Perform without ever loading from My Songs.
  const currentIndex = useMemo(() => {
    if (!songs.length) return -1;
    const byId = currentSongId
      ? songs.findIndex(s => s.id === currentSongId)
      : -1;
    if (byId !== -1) return byId;
    const byTitle = songs.findIndex(s => s.title === score.title);
    return byTitle !== -1 ? byTitle : 0;
  }, [songs, currentSongId, score.title]);

  const loadAt = (idx: number) => {
    if (idx < 0 || idx >= songs.length) return;
    const entry = songs[idx];
    setScore(entry.score);
    setUIState({ currentSongId: entry.id });
    scrollRef.current?.scrollTo({ top: 0 });
    setPickerOpen(false);
  };

  useEffect(() => savePrefs(prefs), [prefs]);

  // Detect whether the current layout overflows the scroll container's
  // viewport — used as a hint for 2-col mode where vertical scrolling
  // forces awkward column-1-then-column-2 reading. Re-runs on prefs/score
  // changes and on resize.
  useEffect(() => {
    const measure = () => {
      const el = scrollRef.current;
      if (!el) return;
      setOverflows(el.scrollHeight > el.clientHeight + 2);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && scrollRef.current) ro.observe(scrollRef.current);
    window.addEventListener("resize", measure);
    // Re-measure after fonts/layout settle.
    const t = setTimeout(measure, 100);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      clearTimeout(t);
    };
  }, [prefs, score]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerOpen) setPickerOpen(false);
        else onExit();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onExit, pickerOpen]);

  const pageBy = (frac: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: el.clientHeight * frac, behavior: "smooth" });
  };

  const adjust = (
    key: keyof PerformPrefs,
    delta: number,
    min: number,
    max: number
  ) => {
    setPrefs(p => ({
      ...p,
      [key]: Math.max(min, Math.min(max, +(p[key] + delta).toFixed(3))),
    }));
  };

  // Wrapper CSS variables consumed by ChordChartView's inline styles. Section
  // headers scale 1.5x relative to body text; same line-height + tracking.
  const wrapperVars: React.CSSProperties = {
    ["--perf-font-size" as never]: `${prefs.fontSize}rem`,
    ["--perf-line-height" as never]: prefs.lineHeight,
    ["--perf-letter-spacing" as never]: `${prefs.letterSpacing}em`,
    ["--perf-label-font-size" as never]: `${prefs.fontSize * 1.5}rem`,
  };

  const btn =
    "w-11 h-11 flex items-center justify-center text-base font-semibold rounded-lg bg-gray-900/80 text-gray-100 hover:bg-gray-800 active:bg-gray-700 backdrop-blur-sm shadow border border-white/10";

  return (
    <div
      className="fixed inset-0 z-50 bg-[#0f0f1f] text-gray-100"
      style={wrapperVars}
    >
      {/* Scrollable content. Padded so the first/last lines aren't behind
          the tap zones. */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-auto pt-[10vh] pb-[14vh]"
      >
        <ChordChartView score={score} performMode performColumns={prefs.columns} />
      </div>

      {/* Top tap zone — page up */}
      <button
        type="button"
        onClick={() => pageBy(-0.8)}
        className="absolute top-0 left-0 right-0 h-[10vh] flex items-start justify-center pt-2 text-gray-400 hover:bg-white/5 active:bg-white/10 transition-colors"
        aria-label="Scroll up"
      >
        <svg
          className="w-8 h-8 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Bottom tap zone — page down */}
      <button
        type="button"
        onClick={() => pageBy(0.8)}
        className="absolute bottom-0 left-0 right-0 h-[14vh] flex items-end justify-center pb-3 text-gray-400 hover:bg-white/5 active:bg-white/10 transition-colors"
        aria-label="Scroll down"
      >
        <svg
          className="w-10 h-10 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Top-left nav cluster — Prev / Title (opens picker) / Next */}
      {songs.length > 0 && (
        <div className="absolute top-3 left-3 flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10 max-w-[calc(50vw-1rem)]">
          <button
            type="button"
            onClick={() => loadAt(currentIndex - 1)}
            disabled={currentIndex <= 0}
            className={`${btn} disabled:opacity-30 disabled:hover:bg-gray-900/80`}
            aria-label="Previous song"
            title="Previous song"
          >
            ◀
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(o => !o)}
            className="h-11 px-3 flex items-center gap-1 text-sm font-medium text-gray-100 hover:bg-gray-800 active:bg-gray-700 rounded-lg max-w-[40vw]"
            title="Jump to song"
          >
            <span className="truncate">
              {songs[currentIndex]?.title ?? score.title ?? "Untitled"}
            </span>
            <svg className="w-3 h-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => loadAt(currentIndex + 1)}
            disabled={currentIndex < 0 || currentIndex >= songs.length - 1}
            className={`${btn} disabled:opacity-30 disabled:hover:bg-gray-900/80`}
            aria-label="Next song"
            title="Next song"
          >
            ▶
          </button>
        </div>
      )}

      {/* Song picker — opens below the title button when toggled */}
      {pickerOpen && songs.length > 0 && (
        <>
          <div
            className="absolute inset-0 z-10"
            onClick={() => setPickerOpen(false)}
          />
          <div className="absolute top-[68px] left-3 z-20 bg-white text-gray-800 rounded-xl shadow-2xl border border-gray-200 w-[min(360px,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto">
            <ul className="py-1">
              {songs.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => loadAt(i)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-blue-50 active:bg-blue-100 ${
                      i === currentIndex ? "bg-blue-50 font-medium" : ""
                    }`}
                  >
                    <div className="truncate">{s.title}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(s.savedAt).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Floating toolbar — top-right. Sits above the top tap zone via DOM
          order; pointer events on toolbar children win over the zone. */}
      <div className="absolute top-3 right-3 flex flex-wrap items-center justify-end gap-2 max-w-[calc(100vw-1.5rem)]">
        <div className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10">
          <button
            type="button"
            onClick={() => adjust("fontSize", -0.1, 0.6, 4)}
            className={btn}
            aria-label="Font smaller"
            title="Font smaller"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => adjust("fontSize", 0.1, 0.6, 4)}
            className={btn}
            aria-label="Font larger"
            title="Font larger"
          >
            A+
          </button>
        </div>
        <div className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10">
          <button
            type="button"
            onClick={() => adjust("lineHeight", -0.1, 0.8, 3)}
            className={btn}
            aria-label="Less leading"
            title="Tighter line spacing"
          >
            ≡−
          </button>
          <button
            type="button"
            onClick={() => adjust("lineHeight", 0.1, 0.8, 3)}
            className={btn}
            aria-label="More leading"
            title="Looser line spacing"
          >
            ≡+
          </button>
        </div>
        <div className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10">
          <button
            type="button"
            onClick={() => adjust("letterSpacing", -0.02, -0.05, 0.4)}
            className={btn}
            aria-label="Tighter kerning"
            title="Tighter letter spacing"
          >
            ↔−
          </button>
          <button
            type="button"
            onClick={() => adjust("letterSpacing", 0.02, -0.05, 0.4)}
            className={btn}
            aria-label="Wider kerning"
            title="Wider letter spacing"
          >
            ↔+
          </button>
        </div>
        <button
          type="button"
          onClick={() => setPrefs(p => ({ ...p, columns: p.columns === 1 ? 2 : 1 }))}
          className={`${btn} ${prefs.columns === 2 ? "bg-blue-700 hover:bg-blue-700" : ""}`}
          aria-label="Toggle columns"
          title={prefs.columns === 1 ? "Two columns" : "One column"}
        >
          {prefs.columns === 1 ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="4" y="4" width="7" height="16" rx="1" />
              <rect x="13" y="4" width="7" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="5" y="4" width="14" height="16" rx="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="px-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium shadow"
        >
          Done
        </button>
      </div>

      {/* Overflow hint — shown only when layout requires scrolling. In 2-col
          mode this means awkward read order; in 1-col it just means the
          tap zones are needed (no warning). */}
      {prefs.columns === 2 && overflows && (
        <div className="absolute top-[68px] right-3 z-30 bg-amber-500/90 text-amber-50 text-xs px-3 py-1.5 rounded-lg shadow border border-amber-300/30 max-w-[260px]">
          Doesn't fit on one screen. Try a smaller font or 1 column.
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/schema";
import ChordChartView from "@/components/ChordChartView";
import PaginatedPerformChart from "@/components/PaginatedPerformChart";
import AnnotationLayer from "@/components/AnnotationLayer";
import AnnotateToggle from "@/components/AnnotateToggle";
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
  onOpenMySongs?: () => void;
}

/**
 * Full-bleed read-only view of a chord chart, optimized for performance use
 * on iPad. Top/bottom tap zones page-scroll; floating toolbar adjusts font
 * size, leading, and kerning live (persisted globally to localStorage).
 * Esc or the Done button returns to edit mode.
 */
export default function PerformView({ score, onExit, onOpenMySongs }: PerformViewProps) {
  const [prefs, setPrefs] = useState<PerformPrefs>(loadPrefs);
  const setScore = useScoreStore(s => s.setScore);
  const setUIState = useScoreStore(s => s.setUIState);
  const currentSongId = useScoreStore(s => s.uiState.currentSongId);
  const performFolder = useScoreStore(s => s.uiState.performFolder ?? null);
  // Whether we're annotating from inside perform mode. The button below
  // toggles uiState.annotationMode without leaving perform — same scroll
  // position, same chrome — so the user can drop a note where they're
  // already looking on the chart.
  const annotationMode = useScoreStore(s => s.uiState.annotationMode);
  // 1-col scrolls the outer container vertically; 2-col scrolls the
  // PaginatedPerformChart's inner pages strip horizontally. They live in
  // different DOM nodes so we need separate refs.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const horizScrollRef = useRef<HTMLDivElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Snapshot the song list on mount — performance shouldn't be interrupted
  // by sync updates. Newest first matches the My Songs modal ordering.
  const [songs] = useState<SongBankEntry[]>(() => getSongs().slice().reverse());

  // All folder names (sorted), for the picker's folder selector.
  const folderNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) if (s.folder) set.add(s.folder);
    return Array.from(set).sort();
  }, [songs]);

  // Songs in the active scope (folder filter). When performFolder is set,
  // prev/next only walks that subset — picking 'Set 1' once means the
  // user stays in Set 1 across song changes.
  const songsInScope = useMemo(() => {
    if (!performFolder) return songs;
    return songs.filter(s => s.folder === performFolder);
  }, [songs, performFolder]);

  // Find the position of the current song in the SCOPED list. Falls back
  // to 0 if the loaded song isn't in scope (so prev/next still work).
  const currentIndex = useMemo(() => {
    if (!songsInScope.length) return -1;
    const byId = currentSongId
      ? songsInScope.findIndex(s => s.id === currentSongId)
      : -1;
    if (byId !== -1) return byId;
    const byTitle = songsInScope.findIndex(s => s.title === score.title);
    return byTitle !== -1 ? byTitle : 0;
  }, [songsInScope, currentSongId, score.title]);

  const loadAt = (idx: number) => {
    if (idx < 0 || idx >= songsInScope.length) return;
    const entry = songsInScope[idx];
    setScore(entry.score);
    setUIState({ currentSongId: entry.id });
    scrollRef.current?.scrollTo({ top: 0 });
    setPickerOpen(false);
  };

  useEffect(() => savePrefs(prefs), [prefs]);

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

  // Page-snap navigation. In 1-col we vertically scroll the outer container
  // by one viewport. In 2-col we horizontally scroll the PaginatedPerform-
  // Chart's pages strip by one client-width — which is one full
  // book-page-turn (both columns advance together to a new page).
  const pageBy = (direction: 1 | -1) => {
    if (prefs.columns === 2) {
      const el = horizScrollRef.current;
      if (el && el.clientWidth > 0) {
        const pageW = el.clientWidth;
        const currentPage = Math.round(el.scrollLeft / pageW);
        const maxPage = Math.max(0, Math.ceil((el.scrollWidth - pageW) / pageW));
        const targetPage = Math.max(0, Math.min(maxPage, currentPage + direction));
        el.scrollTo({ left: targetPage * pageW, behavior: "smooth" });
        return;
      }
    }
    const el = scrollRef.current;
    if (!el) return;
    const pageH = el.clientHeight;
    if (pageH === 0) return;
    const currentPage = Math.round(el.scrollTop / pageH);
    const maxPage = Math.max(0, Math.ceil((el.scrollHeight - pageH) / pageH));
    const targetPage = Math.max(0, Math.min(maxPage, currentPage + direction));
    el.scrollTo({ top: targetPage * pageH, behavior: "smooth" });
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
      {/* 1-col: vertical scroll, ChordChartView reused.
          2-col: PaginatedPerformChart owns layout (Quark-style pages).
          The relative inner wrapper sizes to content so AnnotationLayer's
          absolute inset-0 spans the actual chord chart, not just the
          viewport — annotations stay anchored to content while scrolling. */}
      {prefs.columns === 1 ? (
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto pt-[7vh] pb-16"
        >
          <div className="relative">
            <ChordChartView score={score} performMode performColumns={1} />
            <AnnotationLayer />
          </div>
        </div>
      ) : (
        <PaginatedPerformChart
          score={score}
          prefs={prefs}
          scrollRef={horizScrollRef}
        />
      )}

      {/* Pager — compact bidirectional control floated at bottom-center.
          Replaces the full-width top/bottom tap zones that obscured
          lyrics. Arrow direction tracks the column mode: ↑/↓ in 1-col
          (vertical paging), ←/→ in 2-col (horizontal page-turn). */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-xl bg-gray-900/70 backdrop-blur-sm shadow border border-white/10 p-1">
        <button
          type="button"
          onClick={() => pageBy(-1)}
          className={btn}
          aria-label="Previous page"
          title="Previous page"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {prefs.columns === 2 ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            )}
          </svg>
        </button>
        <button
          type="button"
          onClick={() => pageBy(1)}
          className={btn}
          aria-label="Next page"
          title="Next page"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {prefs.columns === 2 ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            )}
          </svg>
        </button>
      </div>

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
            className="h-11 px-3 flex flex-col items-start justify-center text-gray-100 hover:bg-gray-800 active:bg-gray-700 rounded-lg max-w-[40vw]"
            title="Jump to song"
          >
            {performFolder && (
              <span className="text-[9px] uppercase tracking-wider text-gray-400 leading-none mb-0.5">
                {performFolder}
              </span>
            )}
            <span className="flex items-center gap-1 truncate text-sm font-medium leading-tight">
              <span className="truncate">
                {songsInScope[currentIndex]?.title ?? score.title ?? "Untitled"}
              </span>
              <svg className="w-3 h-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            onClick={() => loadAt(currentIndex + 1)}
            disabled={currentIndex < 0 || currentIndex >= songsInScope.length - 1}
            className={`${btn} disabled:opacity-30 disabled:hover:bg-gray-900/80`}
            aria-label="Next song"
            title="Next song"
          >
            ▶
          </button>
        </div>
      )}

      {/* Song picker with folder scope selector at top. The folder filter
          persists to UIState so picking 'Set 1' once keeps prev/next within
          Set 1 across song changes. */}
      {pickerOpen && songs.length > 0 && (
        <>
          <div
            className="absolute inset-0 z-10"
            onClick={() => setPickerOpen(false)}
          />
          <div className="absolute top-[68px] left-3 z-20 bg-white text-gray-800 rounded-xl shadow-2xl border border-gray-200 w-[min(360px,calc(100vw-1.5rem))] max-h-[60vh] overflow-hidden flex flex-col">
            {folderNames.length > 0 && (
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setUIState({ performFolder: null })}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    !performFolder
                      ? "bg-blue-600 text-white"
                      : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  All ({songs.length})
                </button>
                {folderNames.map(f => {
                  const count = songs.filter(s => s.folder === f).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setUIState({ performFolder: f })}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${
                        performFolder === f
                          ? "bg-blue-600 text-white"
                          : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {f} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {songsInScope.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500 text-center">
                  No songs in this folder.
                </div>
              ) : (
                <ul className="py-1">
                  {songsInScope.map((s, i) => (
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
                          {s.folder ? ` · ${s.folder}` : ""}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {/* Mode cluster — pinned top-right in the SAME screen position used
          in edit mode (see <AnnotateToggle /> rendered from page.tsx).
          Annotate stays in place whether you're in Edit or Perform; only
          the neighbor changes (Perform shows an Edit-out button here). */}
      <div className="absolute top-3 right-3 z-30 flex items-center gap-1 rounded-xl bg-gray-900/80 backdrop-blur-sm shadow border border-white/10 p-1">
        <AnnotateToggle />
        <button
          type="button"
          onClick={() => {
            if (annotationMode) setUIState({ annotationMode: false });
            onExit();
          }}
          className="px-3 h-11 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium"
          aria-label="Edit (exit perform mode)"
        >
          Edit
        </button>
      </div>

      {/* Floating toolbar — wrap-able cluster of style/columns controls
          plus a My Songs button. Positioned to the LEFT of the pinned
          mode buttons. Width budget assumes both Edit + Annotate are
          shown (~13rem). */}
      <div className="absolute top-3 right-[14rem] flex flex-wrap items-center justify-end gap-2 max-w-[calc(100vw-15rem)]">
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
        {onOpenMySongs && (
          <button
            type="button"
            onClick={onOpenMySongs}
            className={btn}
            aria-label="Open My Songs"
            title="My Songs"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
        )}
      </div>

    </div>
  );
}

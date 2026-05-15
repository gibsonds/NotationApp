"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Score } from "@/lib/schema";
import ChordChartView from "@/components/ChordChartView";
import PaginatedPerformChart from "@/components/PaginatedPerformChart";
import AnnotationLayer from "@/components/AnnotationLayer";
import AnnotateToggle from "@/components/AnnotateToggle";
import { useScoreStore } from "@/store/score-store";
import { getSongs, SongsUpdatedEvent, type SongBankEntry } from "@/lib/song-bank";
import { getSets, SetsUpdatedEvent, songSetMembership, type SongSet } from "@/lib/song-sets";
import {
  activeBarFromElapsed,
  beatsPerBarOf,
  computeBarInventory,
} from "@/lib/chord-bar-inventory";
import {
  computeLineScrollTarget,
  isLineTransition,
} from "@/lib/perform-scroll";

const PREFS_KEY = "notation-app-perform-prefs";

interface PerformPrefs {
  fontSize: number;       // rem
  lineHeight: number;     // unitless multiplier
  letterSpacing: number;  // em
  columns: 1 | 2;
  /** Auto-scroll speed in pixels-per-second. Applies in 1-col (vertical
   *  scroll on the outer container) and 2-col (horizontal scroll on the
   *  PaginatedPerformChart pages strip). Defaults to 30, slow enough to
   *  read; user dials in their own speed via toolbar buttons. */
  scrollSpeed: number;
}

const DEFAULT_PREFS: PerformPrefs = {
  fontSize: 1.5,
  lineHeight: 1.4,
  letterSpacing: 0.02,
  columns: 1,
  scrollSpeed: 30,
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
  const activeSetId = useScoreStore(s => s.uiState.activeSetId ?? null);
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

  // Song list. Subscribe to the SongsUpdatedEvent so any sync, save,
  // delete, or rename in another surface (My Songs modal especially)
  // refreshes the picker here. Also re-read on picker-open as a
  // safety net in case an event was missed during a remount race.
  // Newest first matches My Songs modal ordering.
  const [songs, setSongs] = useState<SongBankEntry[]>(() => getSongs().slice().reverse());
  useEffect(() => {
    const refresh = () => setSongs(getSongs().slice().reverse());
    window.addEventListener(SongsUpdatedEvent, refresh);
    return () => window.removeEventListener(SongsUpdatedEvent, refresh);
  }, []);
  useEffect(() => {
    if (pickerOpen) {
      setSongs(getSongs().slice().reverse());
    }
  }, [pickerOpen]);

  // Sets list — only consulted when activeSetId is non-null, but we
  // subscribe so renames/reorder land here without remounting.
  const [sets, setSetsState] = useState<SongSet[]>(() => getSets());
  useEffect(() => {
    const refresh = () => setSetsState(getSets());
    window.addEventListener(SetsUpdatedEvent, refresh);
    return () => window.removeEventListener(SetsUpdatedEvent, refresh);
  }, []);
  const activeSet = activeSetId ? sets.find(s => s.id === activeSetId) ?? null : null;

  // Sets the currently-loaded song is a member of. Drives the chip
  // strip at the top of the picker so the user can swap between sets
  // without bouncing back to My Songs. When ≥1, the chip strip
  // replaces the standard folder/activeSet headers in the picker.
  const currentSongSets = useMemo(() => {
    if (!currentSongId) return [] as SongSet[];
    return songSetMembership(sets).get(currentSongId) ?? [];
  }, [sets, currentSongId]);

  // All folder names (sorted), for the picker's folder selector.
  const folderNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) if (s.folder) set.add(s.folder);
    return Array.from(set).sort();
  }, [songs]);

  // Sentinel folder values stored in performFolder. Three distinct picks:
  //  - UNFILED_FOLDER: songs with no folder set (the default tab).
  //  - ALL_FOLDER: every song, regardless of folder. Includes archived
  //    folders even if the user has them collapsed in My Songs.
  //  - any other string: the specific folder name.
  // null is treated as UNFILED_FOLDER for legacy users — when the field
  // wasn't yet populated, default to the focused subset.
  const UNFILED_FOLDER = "_unfiled" as const;
  const ALL_FOLDER = "_all" as const;
  const activeFolder = performFolder ?? UNFILED_FOLDER;

  const songsInScope = useMemo(() => {
    // Active set takes precedence over folder filter — when the user
    // loaded a song from a set, prev/next walks that set in order
    // (and stops at the ends). Missing-from-songbank ids are dropped.
    if (activeSet) {
      const byId = new Map(songs.map(s => [s.id, s]));
      return activeSet.songIds
        .map(id => byId.get(id))
        .filter((s): s is SongBankEntry => !!s);
    }
    if (activeFolder === ALL_FOLDER) return songs;
    if (activeFolder === UNFILED_FOLDER) return songs.filter(s => !s.folder);
    return songs.filter(s => s.folder === activeFolder);
  }, [songs, activeFolder, activeSet]);

  const unfiledCount = useMemo(
    () => songs.filter(s => !s.folder).length,
    [songs],
  );

  // Find the position of the current song in the SCOPED list. Returns
  // -1 when the loaded song isn't in scope (e.g., user switched folder
  // or set after loading the song) — that disables prev/next and lets
  // the chip fall through to `score.title` so it displays the
  // ACTUALLY-loaded song rather than lying about being on scope[0].
  const currentIndex = useMemo(() => {
    if (!songsInScope.length) return -1;
    const byId = currentSongId
      ? songsInScope.findIndex(s => s.id === currentSongId)
      : -1;
    if (byId !== -1) return byId;
    const byTitle = songsInScope.findIndex(s => s.title === score.title);
    return byTitle;
  }, [songsInScope, currentSongId, score.title]);

  const loadAt = (idx: number) => {
    if (idx < 0 || idx >= songsInScope.length) return;
    const entry = songsInScope[idx];
    setScore(entry.score);
    // Keep activeSetId stable when stepping inside a set so the next
    // prev/next still walks the same set even after the song change.
    setUIState({ currentSongId: entry.id });
    scrollRef.current?.scrollTo({ top: 0 });
    setPickerOpen(false);
  };

  useEffect(() => savePrefs(prefs), [prefs]);

  // Auto-scroll for hands-free reading (#23). Off by default; the user
  // toggles via the toolbar button. While on, requestAnimationFrame
  // advances scrollTop (1-col) or scrollLeft (2-col) by speed/60 each
  // frame. Pauses on pager tap, picker open, or perform-mode exit.
  const [autoScroll, setAutoScroll] = useState(false);
  const autoScrollHandleRef = useRef<number | null>(null);
  // Tempo-aware speed: when the score has a tempo set, scale the
  // user's px/sec preference linearly by tempo/120. So a song at
  // 240 BPM scrolls twice as fast as a song at 120 BPM at the same
  // px/sec setting — closer to "moves with the song". 120 BPM is a
  // neutral reference; ± buttons still adjust prefs.scrollSpeed
  // around it. True bar-accurate scrolling (with green bar highlight
  // as bars are "played") is a follow-up slice — needs ChordChartView
  // to split chord-line text into per-bar spans first.
  const songTempo = score?.tempo ?? 0;
  // Perform-mode tempo override — for practicing slower without
  // mutating the song's saved tempo. Resets when the loaded song
  // changes so a slow rehearsal of Song A doesn't leak into Song B.
  // null = use song's tempo; otherwise this value drives both the
  // scroll rate AND the bar-highlight advance rate.
  const [performTempoOverride, setPerformTempoOverride] = useState<number | null>(null);
  useEffect(() => {
    setPerformTempoOverride(null);
    // New song = fresh playback state. Without this, switching songs
    // mid-rehearsal would resume the new song from the old song's
    // elapsed time, landing the highlight on a bogus bar.
    autoScrollElapsedRef.current = 0;
    setActiveBarIdx(null);
  }, [score?.id]);
  const effectiveTempo = performTempoOverride ?? songTempo;
  const tempoFactor = effectiveTempo > 0 ? effectiveTempo / 120 : 1;
  const effectiveScrollSpeed = prefs.scrollSpeed * tempoFactor;

  // Tempo change without rescaling elapsed would jump the bar index —
  // the active bar derives from `floor(elapsed * tempo / 60 / beatsPerBar)`,
  // so the same elapsed under a different tempo lands on a different
  // bar. Preserve the musical position (beats consumed so far) by
  // rescaling elapsed inversely with the tempo ratio.
  const changeTempoOverride = (next: number | null) => {
    const oldTempo = effectiveTempo;
    const newTempo = next ?? songTempo;
    if (oldTempo > 0 && newTempo > 0 && oldTempo !== newTempo) {
      autoScrollElapsedRef.current =
        autoScrollElapsedRef.current * (oldTempo / newTempo);
    }
    setPerformTempoOverride(next);
  };

  // Bar inventory drives the green per-bar highlight overlay during
  // auto-scroll. Computed once per score; activeBarIdx is the only
  // value that changes during the RAF loop, and it only changes
  // ~once per bar (~once every 2 seconds at 120 BPM 4/4) — far less
  // often than every frame, so React reconciliation stays cheap.
  const barInventory = useMemo(
    () => (score ? computeBarInventory(score) : []),
    [score],
  );
  const beatsPerBar = useMemo(
    () => beatsPerBarOf(score?.timeSignature),
    [score?.timeSignature],
  );
  const autoScrollElapsedRef = useRef(0);
  const [activeBarIdx, setActiveBarIdx] = useState<number | null>(null);
  // Track the fractional pixel position separately from element
  // scrollTop, which only accepts integers — without this, slow speeds
  // (e.g. 5 px/sec ≈ 0.08 px/frame) would round to 0 every frame and
  // never advance.
  const scrollAccumRef = useRef(0);

  useEffect(() => {
    if (!autoScroll) {
      // PAUSE preserves elapsed + activeBarIdx so Continue resumes
      // from the same bar instead of restarting from the top. End-of-
      // song and song-change paths handle their own resets below.
      return;
    }
    let lastTime = performance.now();
    const step = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      autoScrollElapsedRef.current += dt;
      // Active bar derivation — only setState when the value changes
      // so we don't churn the chord chart every frame.
      const nextBarIdx = activeBarFromElapsed(
        barInventory,
        autoScrollElapsedRef.current,
        effectiveTempo,
        beatsPerBar,
      );
      setActiveBarIdx((prev) => (prev === nextBarIdx ? prev : nextBarIdx));
      // End-of-song detection: when bars run out, stop the loop and
      // reset elapsed so a fresh tap on Continue starts the song over
      // from bar 0 rather than instantly re-finishing.
      const tracking = barInventory.length > 0 && effectiveTempo > 0;
      if (tracking && nextBarIdx === null && autoScrollElapsedRef.current > 0) {
        setAutoScroll(false);
        autoScrollElapsedRef.current = 0;
        setActiveBarIdx(null);
        autoScrollHandleRef.current = requestAnimationFrame(step);
        return;
      }
      // Scroll model:
      //   - With bar inventory + tempo: scroll is driven by the separate
      //     scroll-on-line-transition effect below. This RAF loop only
      //     updates elapsed + activeBarIdx; nothing scrolls per-frame.
      //     Within a line, scroll stays still. On line transition, the
      //     effect animates scroll to the new line's target position
      //     over one bar's duration — fast enough to feel "musical",
      //     slow enough to not race.
      //   - Without bar inventory OR tempo: legacy constant px/sec scaled
      //     by tempo factor (effectiveScrollSpeed).
      if (!tracking) {
        const delta = effectiveScrollSpeed * dt;
        scrollAccumRef.current += delta;
        if (scrollAccumRef.current >= 1) {
          const whole = Math.floor(scrollAccumRef.current);
          scrollAccumRef.current -= whole;
          if (prefs.columns === 2) {
            const el = horizScrollRef.current;
            if (el) {
              const max = el.scrollWidth - el.clientWidth;
              el.scrollLeft = Math.min(max, el.scrollLeft + whole);
              if (el.scrollLeft >= max) setAutoScroll(false);
            }
          } else {
            const el = scrollRef.current;
            if (el) {
              const max = el.scrollHeight - el.clientHeight;
              el.scrollTop = Math.min(max, el.scrollTop + whole);
              if (el.scrollTop >= max) setAutoScroll(false);
            }
          }
        }
      }
      autoScrollHandleRef.current = requestAnimationFrame(step);
    };
    autoScrollHandleRef.current = requestAnimationFrame(step);
    return () => {
      if (autoScrollHandleRef.current !== null) {
        cancelAnimationFrame(autoScrollHandleRef.current);
        autoScrollHandleRef.current = null;
      }
      scrollAccumRef.current = 0;
    };
  }, [autoScroll, effectiveScrollSpeed, prefs.columns, barInventory, effectiveTempo, beatsPerBar]);

  // Scroll-on-line-transition. When the active bar moves to a DIFFERENT
  // line, animate the chord chart scroll to position that line 1/3 from
  // the top of the viewport, eased over one bar's duration. Within the
  // same line: no scroll (long-line pause). At the start of the song
  // before any line crosses the 1/3 mark: target is 0, no scroll (warmup).
  //
  // Pure logic (computeLineScrollTarget / isLineTransition) lives in
  // src/lib/perform-scroll.ts and is covered by perform-scroll.test.ts —
  // tests guard the warmup / long-line-pause / off-the-page regressions
  // we've hit on this surface.
  const lastActiveBarRef = useRef<typeof activeBarIdx extends infer T ? T : null>(null);
  const scrollAnimHandleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoScroll) {
      lastActiveBarRef.current = null;
      if (scrollAnimHandleRef.current !== null) {
        cancelAnimationFrame(scrollAnimHandleRef.current);
        scrollAnimHandleRef.current = null;
      }
      return;
    }
    if (activeBarIdx === null) return;
    const bar = barInventory[activeBarIdx];
    if (!bar) return;
    const prevBar = lastActiveBarRef.current != null ? barInventory[lastActiveBarRef.current as number] ?? null : null;
    lastActiveBarRef.current = activeBarIdx;
    // Only trigger scroll when the LINE changes (not on every bar
    // within a line). The pure helper makes this rule testable.
    if (!isLineTransition(prevBar, bar)) return;
    const container = prefs.columns === 2 ? horizScrollRef.current : scrollRef.current;
    if (!container) return;
    // SCOPE the query to the perform-mode scroll container. The editor's
    // ChordChartView is still mounted underneath the fixed-inset perform
    // overlay and ALSO renders [data-bar-line] attributes — without
    // scoping, document.querySelector grabs the EDITOR's line, whose Y
    // coordinates are unrelated to where the perform chord chart actually
    // sits. That mismatch was producing wildly wrong scroll targets
    // (overshooting the active line off the top of the page).
    const el = container.querySelector<HTMLElement>(
      `[data-bar-line="${CSS.escape(`${bar.sectionId}-${bar.lineIdx}`)}"]`,
    );
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const horizontal = prefs.columns === 2;
    const elStart = horizontal
      ? el.getBoundingClientRect().left - containerRect.left + container.scrollLeft
      : el.getBoundingClientRect().top - containerRect.top + container.scrollTop;
    const viewport = horizontal ? container.clientWidth : container.clientHeight;
    const max = horizontal
      ? container.scrollWidth - container.clientWidth
      : container.scrollHeight - container.clientHeight;
    const target = computeLineScrollTarget(elStart, viewport, max);
    const startScroll = horizontal ? container.scrollLeft : container.scrollTop;
    if (target === startScroll) return; // nothing to do
    // Duration matches one bar's worth of music time, so the line
    // transition feels in tempo with what just played.
    const secsPerBar = effectiveTempo > 0 ? (60 / effectiveTempo) * beatsPerBar : 1;
    const durationMs = Math.max(150, Math.min(3000, secsPerBar * 1000));
    const startTime = performance.now();
    if (scrollAnimHandleRef.current !== null) {
      cancelAnimationFrame(scrollAnimHandleRef.current);
    }
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      // Cosine ease-in-out — softer than linear, no overshoot.
      const eased = 0.5 - 0.5 * Math.cos(t * Math.PI);
      const next = startScroll + (target - startScroll) * eased;
      if (horizontal) container.scrollLeft = next;
      else container.scrollTop = next;
      if (t < 1) {
        scrollAnimHandleRef.current = requestAnimationFrame(tick);
      } else {
        scrollAnimHandleRef.current = null;
      }
    };
    scrollAnimHandleRef.current = requestAnimationFrame(tick);
  }, [autoScroll, activeBarIdx, barInventory, prefs.columns, effectiveTempo, beatsPerBar]);

  // Manual pager / picker / Escape should all pause auto-scroll so the
  // user isn't fighting the loop while interacting with the chrome.
  useEffect(() => {
    if (pickerOpen && autoScroll) setAutoScroll(false);
  }, [pickerOpen, autoScroll]);

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
    if (autoScroll) setAutoScroll(false);
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
          {/* No top spacer — user wants the chord chart to start at
              the top of the viewport. computeLineScrollTarget already
              clamps target to 0 while the active line's content-Y is
              within the top viewport/3 (the "warmup" period), so
              scroll stays at 0 until the active line passes the 1/3
              mark, then engages to hold the line at that mark. */}
          <div className="relative">
            <ChordChartView
              score={score}
              performMode
              performColumns={1}
              activeBar={activeBarIdx !== null ? barInventory[activeBarIdx] ?? null : null}
            />
            <AnnotationLayer />
          </div>
          {/* Bottom spacer: extends the scrollable range so the LAST
              line can still scroll up to the 1/3 mark instead of
              hitting max_scroll clamp at some lower position. Without
              this, the active-bar overlay drifts below 1/3 toward the
              end of the song and looks "off the rails". */}
          <div style={{ height: "67vh" }} aria-hidden />
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

      {/* Top-left nav cluster — Prev / Title (opens picker) / Next.
          Fixed-width cluster so the ▶ next-song arrow doesn't drift
          when song titles vary in length. Title button takes flex-1
          of the remaining space and truncates anything longer. */}
      {songs.length > 0 && (
        <div className="absolute top-3 left-3 flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10 w-[min(34rem,calc(50vw-1rem))]">
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
            className="h-11 px-3 flex flex-col items-start justify-center text-gray-100 hover:bg-gray-800 active:bg-gray-700 rounded-lg flex-1 min-w-0"
            title="Jump to song"
          >
            {activeSet ? (
              <span className="text-[9px] uppercase tracking-wider text-pink-300 leading-none mb-0.5 truncate max-w-full">
                Set: {activeSet.name}
              </span>
            ) : performFolder ? (
              <span className="text-[9px] uppercase tracking-wider text-gray-400 leading-none mb-0.5 truncate max-w-full">
                {performFolder}
              </span>
            ) : null}
            <span className="flex items-center gap-1 text-sm font-medium leading-tight w-full min-w-0">
              <span className="truncate flex-1 text-left">
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
            {currentSongSets.length > 0 ? (
              // Chip strip: every set this song belongs to. Tap to
              // enter that set; the active set chip is highlighted.
              // "Exit set" appears next to the chips when one is active,
              // so the user can go back to folder-scoped prev/next.
              <div className="px-3 py-2 border-b border-gray-100 bg-pink-50/60 flex flex-wrap items-center gap-1">
                <span className="text-[10px] uppercase tracking-wider text-pink-700/70 mr-1">
                  Switch to set:
                </span>
                {currentSongSets.map((s) => {
                  const isActive = activeSetId === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setUIState({ activeSetId: s.id })}
                      className={`px-2 py-1 text-xs rounded-md transition-colors max-w-[140px] truncate ${
                        isActive
                          ? "bg-pink-600 text-white"
                          : "bg-white border border-pink-200 text-pink-800 hover:bg-pink-100"
                      }`}
                      title={isActive ? "Currently walking this set" : `Switch prev/next to walk ${s.name}`}
                    >
                      {s.name}
                    </button>
                  );
                })}
                {activeSetId && (
                  <button
                    type="button"
                    onClick={() => setUIState({ activeSetId: null })}
                    className="ml-auto px-2 py-1 text-[11px] rounded-md text-pink-700 hover:bg-pink-100"
                    title="Exit set — go back to folder filter"
                  >
                    × Exit set
                  </button>
                )}
              </div>
            ) : activeSet ? (
              // Edge case: song was loaded inside a set but is no
              // longer a member of it (removed from the set after
              // load). Keep the canonical "Set: name + Exit" affordance.
              <div className="px-3 py-2 border-b border-gray-100 bg-pink-50/60 flex items-center gap-2">
                <span className="text-xs font-medium text-pink-800 truncate flex-1">
                  Set: {activeSet.name}
                </span>
                <button
                  type="button"
                  onClick={() => setUIState({ activeSetId: null })}
                  className="px-2 py-1 text-[11px] rounded-md text-pink-700 hover:bg-pink-100"
                  title="Exit set — go back to folder filter"
                >
                  Exit set
                </button>
              </div>
            ) : (folderNames.length > 0 || unfiledCount > 0) && (
              <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-1">
                {unfiledCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setUIState({ performFolder: UNFILED_FOLDER })}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      activeFolder === UNFILED_FOLDER
                        ? "bg-blue-600 text-white"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                    }`}
                    title="Songs without a folder"
                  >
                    Unfiled ({unfiledCount})
                  </button>
                )}
                {folderNames.map(f => {
                  const count = songs.filter(s => s.folder === f).length;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setUIState({ performFolder: f })}
                      className={`px-2 py-1 text-xs rounded-md transition-colors ${
                        activeFolder === f
                          ? "bg-blue-600 text-white"
                          : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {f} ({count})
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setUIState({ performFolder: ALL_FOLDER })}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    activeFolder === ALL_FOLDER
                      ? "bg-blue-600 text-white"
                      : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-100"
                  }`}
                  title="Every song, including archived folders"
                >
                  All ({songs.length})
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto">
              {songsInScope.length === 0 ? (
                <div className="px-4 py-6 text-sm text-gray-500 text-center">
                  {activeSet ? "This set is empty." : "No songs in this folder."}
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
        {/* Auto-scroll cluster (#23) — play/pause + speed adjusts.
            Speed is in pixels/sec; clamped to a readable range. Initial
            scaffolding; tempo-aware sync is a future slice. */}
        <div className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10">
          <button
            type="button"
            onClick={() => setAutoScroll((on) => !on)}
            className={`${btn} ${autoScroll ? "bg-blue-700 hover:bg-blue-700" : ""}`}
            aria-label={autoScroll ? "Pause auto-scroll" : "Start auto-scroll"}
            title={
              songTempo > 0
                ? `${autoScroll ? "Pause" : "Start"} auto-scroll (${effectiveScrollSpeed.toFixed(0)} px/sec @ ${songTempo} bpm)`
                : `${autoScroll ? "Pause" : "Start"} auto-scroll (${prefs.scrollSpeed} px/sec — no tempo set)`
            }
          >
            {autoScroll ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={() => adjust("scrollSpeed", -5, 5, 200)}
            className={btn}
            aria-label="Slower auto-scroll"
            title={`Slower (${Math.max(5, prefs.scrollSpeed - 5)} px/sec)`}
          >
            ⊖
          </button>
          <button
            type="button"
            onClick={() => adjust("scrollSpeed", 5, 5, 200)}
            className={btn}
            aria-label="Faster auto-scroll"
            title={`Faster (${Math.min(200, prefs.scrollSpeed + 5)} px/sec)`}
          >
            ⊕
          </button>
        </div>
        {/* Perform-tempo override cluster — adjust tempo just for
            this performance (e.g. practice slower). Does NOT save
            back to the song; resets when you load a different song.
            ♩ button reverts to the song's saved tempo. Only shown
            when the song has a tempo set. */}
        {songTempo > 0 && (
          <div className="flex items-center gap-1 bg-gray-900/80 backdrop-blur-sm rounded-xl p-1 shadow border border-white/10">
            <button
              type="button"
              onClick={() => changeTempoOverride(Math.max(20, effectiveTempo - 2))}
              className={btn}
              aria-label="Slower tempo"
              title={`Slower (${Math.max(20, effectiveTempo - 2)} bpm)`}
            >
              ♩−
            </button>
            <button
              type="button"
              onClick={() => changeTempoOverride(null)}
              disabled={performTempoOverride === null}
              className="h-11 px-3 flex items-center text-sm font-medium text-gray-100 hover:bg-gray-800 active:bg-gray-700 rounded-lg disabled:opacity-60 disabled:cursor-default"
              title={
                performTempoOverride === null
                  ? `Song tempo: ${songTempo} bpm`
                  : `Click to reset to song tempo (${songTempo} bpm)`
              }
            >
              {effectiveTempo} bpm
              {performTempoOverride !== null && (
                <span className="ml-1.5 text-[9px] uppercase tracking-wider opacity-60">⟲</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => changeTempoOverride(Math.min(300, effectiveTempo + 2))}
              className={btn}
              aria-label="Faster tempo"
              title={`Faster (${Math.min(300, effectiveTempo + 2)} bpm)`}
            >
              ♩+
            </button>
          </div>
        )}
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

      {/* Big floating Pause / Continue — always visible during perform
          mode. The toolbar play/pause is small and easy to miss while
          reading; this is the always-reachable transport. Pause when
          rolling, Continue (green) when paused so the user can resume
          from where they left off (elapsed + activeBar are preserved
          across pauses; only song change or end-of-song resets them). */}
      <button
        type="button"
        onClick={() => setAutoScroll((on) => !on)}
        className={`absolute bottom-20 left-1/2 -translate-x-1/2 z-40 px-6 py-3 rounded-full text-white text-base font-semibold shadow-2xl backdrop-blur-sm border border-white/20 flex items-center gap-2 ${
          autoScroll
            ? "bg-red-600/90 hover:bg-red-700 active:bg-red-800"
            : "bg-emerald-600/90 hover:bg-emerald-700 active:bg-emerald-800"
        }`}
        aria-label={autoScroll ? "Pause auto-scroll" : "Continue auto-scroll"}
        title={autoScroll ? "Pause auto-scroll" : "Continue auto-scroll"}
      >
        {autoScroll ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
        <span>{autoScroll ? "Pause" : "Continue"}</span>
        {songTempo > 0 && (
          <span className="text-xs opacity-80 font-normal ml-1">
            {songTempo} bpm
          </span>
        )}
      </button>

    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Score } from "@/lib/schema";
import ChordChartView from "@/components/ChordChartView";

const PREFS_KEY = "notation-app-perform-prefs";

interface PerformPrefs {
  fontSize: number;       // rem
  lineHeight: number;     // unitless multiplier
  letterSpacing: number;  // em
}

const DEFAULT_PREFS: PerformPrefs = {
  fontSize: 1.5,
  lineHeight: 1.4,
  letterSpacing: 0.02,
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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => savePrefs(prefs), [prefs]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onExit]);

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
        <ChordChartView score={score} performMode />
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
          onClick={onExit}
          className="px-4 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-medium shadow"
        >
          Done
        </button>
      </div>
    </div>
  );
}

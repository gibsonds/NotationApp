"use client";

import { useScoreStore, type AppMode } from "@/store/score-store";

interface ModeOption {
  mode: AppMode;
  label: string;
  activeClass: string;
  title: string;
}

const OPTIONS: ModeOption[] = [
  {
    mode: "edit",
    label: "Edit",
    activeClass: "bg-white/15 text-white",
    title: "Edit mode: change notes, lyrics, chords",
  },
  {
    mode: "perform",
    label: "Perform",
    activeClass: "bg-pink-500/30 text-pink-100",
    title: "Perform mode: full-screen chord chart for live use",
  },
  {
    mode: "annotate",
    label: "Annotate",
    activeClass: "bg-amber-500/30 text-amber-100",
    title: "Annotate mode: tap anywhere on the score to add a sticky note",
  },
];

export default function ModeSelector({
  performAvailable = true,
}: {
  /** When false, the Perform option is disabled (no chord-chart sections to perform). */
  performAvailable?: boolean;
} = {}) {
  const appMode = useScoreStore((s) => s.uiState.appMode);
  const setUIState = useScoreStore((s) => s.setUIState);

  return (
    <div
      role="radiogroup"
      aria-label="App mode"
      className="inline-flex items-stretch rounded-md bg-black/30 border border-white/10 overflow-hidden min-h-[44px]"
    >
      {OPTIONS.map((opt) => {
        const isActive = appMode === opt.mode;
        const disabled = opt.mode === "perform" && !performAvailable;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => setUIState({ appMode: opt.mode })}
            title={disabled ? "Perform requires a chord-chart song" : opt.title}
            className={`px-4 min-w-[72px] text-sm font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
              isActive
                ? opt.activeClass
                : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

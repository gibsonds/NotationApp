"use client";

import { useScoreStore } from "@/store/score-store";

type Mode = "edit" | "perform";

/**
 * Top-level mode selector — Edit | Perform — plus an Annotate toggle next
 * to it. Annotate is a sub-mode that overlays either Edit or Perform: the
 * button toggles uiState.annotationMode without touching performMode, so
 * the user can drop sticky notes from whichever top-level view they're in
 * and the behavior is identical in both. Mirrors the Annotate button in
 * PerformView's top-right cluster.
 */
export default function ModeSelector() {
  const { uiState, setUIState, score } = useScoreStore();

  const hasChordChart = !!(score?.sections && score.sections.length > 0);

  const currentMode: Mode = uiState.performMode ? "perform" : "edit";

  function selectMode(mode: Mode) {
    if (mode === "perform" && !hasChordChart) return;
    setUIState({ performMode: mode === "perform" });
  }

  const segments: { id: Mode; label: string; disabled?: boolean }[] = [
    { id: "edit", label: "Edit" },
    { id: "perform", label: "Perform", disabled: !hasChordChart },
  ];

  const annotating = uiState.annotationMode;

  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="inline-flex items-center rounded-md bg-white/8 border border-white/15 overflow-hidden"
        style={{ minHeight: 44 }}
        role="tablist"
        aria-label="Editor mode"
      >
        {segments.map((seg, i) => {
          const isActive = currentMode === seg.id;
          const isDisabled = seg.disabled;
          return (
            <button
              key={seg.id}
              role="tab"
              aria-selected={isActive}
              disabled={isDisabled}
              onClick={() => selectMode(seg.id)}
              className={[
                "px-4 text-sm font-medium h-full transition-colors",
                i > 0 ? "border-l border-white/15" : "",
                isActive
                  ? "bg-white text-gray-900"
                  : isDisabled
                  ? "text-gray-600 cursor-not-allowed"
                  : "text-gray-300 hover:bg-white/10 cursor-pointer",
              ].join(" ")}
              style={{ minHeight: 44 }}
              title={
                seg.id === "perform" && isDisabled
                  ? "Perform mode requires a chord-chart score"
                  : undefined
              }
            >
              {seg.label}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setUIState({ annotationMode: !annotating })}
        aria-pressed={annotating}
        aria-label={annotating ? "Stop annotating" : "Annotate"}
        title={annotating
          ? "Tap the chart to add a sticky note. Tap Annotating to stop."
          : "Annotate — drop sticky notes on the chart (works in Edit and Perform)"
        }
        className={[
          "px-4 text-sm font-medium rounded-md border transition-colors",
          annotating
            ? "bg-yellow-300 text-gray-900 border-yellow-400 hover:bg-yellow-200"
            : "bg-white/8 text-gray-300 border-white/15 hover:bg-white/15",
        ].join(" ")}
        style={{ minHeight: 44 }}
      >
        {annotating ? "Annotating" : "Annotate"}
      </button>
    </div>
  );
}

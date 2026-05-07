"use client";

import { useScoreStore } from "@/store/score-store";

/**
 * Annotate sub-mode toggle. Pinned to the top-right of the viewport in
 * the SAME screen position whether the user is in Edit or Perform — that
 * consistency is the whole point. Toggles uiState.annotationMode without
 * touching performMode.
 *
 * In PerformView this is rendered next to an Edit button (which exits
 * perform); in edit-mode page.tsx it's rendered alone.
 */
export default function AnnotateToggle() {
  const annotationMode = useScoreStore((s) => s.uiState.annotationMode);
  const setUIState = useScoreStore((s) => s.setUIState);

  return (
    <button
      type="button"
      onClick={() => setUIState({ annotationMode: !annotationMode })}
      aria-pressed={annotationMode}
      aria-label={annotationMode ? "Stop annotating" : "Annotate"}
      title={
        annotationMode
          ? "Tap the chart to add a sticky note. Tap Annotating to stop."
          : "Annotate — drop sticky notes on the chart"
      }
      className={`px-3 h-11 rounded-lg text-sm font-medium transition-colors ${
        annotationMode
          ? "bg-yellow-400 text-gray-900 hover:bg-yellow-300"
          : "text-gray-100 hover:bg-gray-800 active:bg-gray-700"
      }`}
    >
      {annotationMode ? "Annotating" : "Annotate"}
    </button>
  );
}

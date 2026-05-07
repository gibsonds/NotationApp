"use client";

import { useScoreStore } from "@/store/score-store";
import { logEvent, scoreTypeOf } from "@/lib/analytics";

type Mode = "edit" | "perform" | "annotate";

export default function ModeSelector() {
  const { uiState, setUIState, score } = useScoreStore();

  const hasChordChart = !!(score?.sections && score.sections.length > 0);

  const currentMode: Mode = uiState.performMode
    ? "perform"
    : uiState.annotationMode
    ? "annotate"
    : "edit";

  function selectMode(mode: Mode) {
    if (mode === "perform" && !hasChordChart) return;
    if (mode !== currentMode) {
      logEvent({ event: "mode_switch", name: mode, scoreType: scoreTypeOf(score) });
    }
    setUIState({
      performMode: mode === "perform",
      annotationMode: mode === "annotate",
    });
  }

  const segments: { id: Mode; label: string; disabled?: boolean }[] = [
    { id: "edit", label: "Edit" },
    { id: "perform", label: "Perform", disabled: !hasChordChart },
    { id: "annotate", label: "Annotate" },
  ];

  return (
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
  );
}

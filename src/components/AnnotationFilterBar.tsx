"use client";

import { useScoreStore, type AnnotationFilters } from "@/store/score-store";

export default function AnnotationFilterBar() {
  const score = useScoreStore((s) => s.score);
  const uiState = useScoreStore((s) => s.uiState);
  const setUIState = useScoreStore((s) => s.setUIState);

  const annotationMode = uiState.annotationMode;
  const { annotationFilters } = uiState;
  const annotations = score?.annotations ?? [];

  // Only show when annotate mode is on or there are annotations
  if (!annotationMode && annotations.length === 0) return null;

  const usedLabels = [...new Set(annotations.filter((a) => a.label).map((a) => a.label))];

  const setFilters = (partial: Partial<AnnotationFilters>) => {
    setUIState({ annotationFilters: { ...annotationFilters, ...partial } });
  };

  const toggleLabel = (lbl: string) => {
    const hidden = annotationFilters.hiddenLabels;
    setFilters({
      hiddenLabels: hidden.includes(lbl)
        ? hidden.filter((l) => l !== lbl)
        : [...hidden, lbl],
    });
  };

  return (
    <div className="print-hide flex items-center flex-wrap gap-2 px-4 py-1.5 bg-[#16162a] text-white text-[11px] border-t border-white/10">
      <span className="text-gray-400 font-mono font-medium">Annotations</span>

      <span className="text-gray-600">|</span>

      {/* Shared / Personal toggles */}
      <button
        type="button"
        onClick={() => setFilters({ showShared: !annotationFilters.showShared })}
        className={`px-2 py-0.5 rounded transition-colors font-mono ${
          annotationFilters.showShared
            ? "bg-blue-600 text-white"
            : "bg-gray-700 text-gray-400"
        }`}
      >
        Shared
      </button>
      <button
        type="button"
        onClick={() => setFilters({ showPersonal: !annotationFilters.showPersonal })}
        className={`px-2 py-0.5 rounded transition-colors font-mono ${
          annotationFilters.showPersonal
            ? "bg-purple-600 text-white"
            : "bg-gray-700 text-gray-400"
        }`}
      >
        Personal
      </button>

      {/* Label chips */}
      {usedLabels.length > 0 && (
        <>
          <span className="text-gray-600">|</span>
          {usedLabels.map((lbl) => {
            const hidden = annotationFilters.hiddenLabels.includes(lbl);
            return (
              <button
                key={lbl}
                type="button"
                onClick={() => toggleLabel(lbl)}
                className={`px-2 py-0.5 rounded transition-colors font-mono ${
                  hidden
                    ? "bg-gray-700 text-gray-500 line-through"
                    : "bg-amber-600/80 text-white"
                }`}
              >
                {lbl}
              </button>
            );
          })}
        </>
      )}

      <span className="text-gray-600">|</span>

      {/* Hide in performance mode */}
      <button
        type="button"
        onClick={() => setFilters({ hideInPerformance: !annotationFilters.hideInPerformance })}
        className={`px-2 py-0.5 rounded transition-colors font-mono ${
          annotationFilters.hideInPerformance
            ? "bg-gray-500 text-white"
            : "bg-gray-700 text-gray-400"
        }`}
        title="When enabled, annotations are hidden during playback"
      >
        Hide in performance
      </button>

      {/* Annotation count */}
      <span className="ml-auto text-gray-500 font-mono">
        {annotations.length} annotation{annotations.length !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

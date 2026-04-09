"use client";

import { useScoreStore } from "@/store/score-store";
import { useCallback } from "react";

export default function SelectionBar() {
  const { score, selection, setSelection, lastOperation } = useScoreStore();

  const handleMeasureClick = useCallback(
    (measure: number, e: React.MouseEvent) => {
      if (e.shiftKey && selection) {
        // Extend selection
        const start = Math.min(selection.startMeasure, measure);
        const end = Math.max(selection.endMeasure, measure);
        setSelection({
          startMeasure: start,
          endMeasure: end,
          staffIds: selection.staffIds,
        });
      } else if (e.metaKey || e.ctrlKey) {
        // Toggle single measure in/out — for simplicity, just set to that measure
        if (
          selection &&
          selection.startMeasure === measure &&
          selection.endMeasure === measure
        ) {
          setSelection(null);
        } else {
          setSelection({ startMeasure: measure, endMeasure: measure });
        }
      } else {
        // Single click — select just that measure, or deselect if already selected
        if (
          selection &&
          selection.startMeasure === measure &&
          selection.endMeasure === measure
        ) {
          setSelection(null);
        } else {
          setSelection({ startMeasure: measure, endMeasure: measure });
        }
      }
    },
    [selection, setSelection]
  );

  if (!score) return null;

  const measures = Array.from({ length: score.measures }, (_, i) => i + 1);

  const handleSelectAll = () => {
    setSelection({ startMeasure: 1, endMeasure: score.measures });
  };

  const handleClearSelection = () => {
    setSelection(null);
  };

  const handleStaffToggle = (staffId: string) => {
    if (!selection) return;
    const current = selection.staffIds || score.staves.map((s) => s.id);
    const updated = current.includes(staffId)
      ? current.filter((id) => id !== staffId)
      : [...current, staffId];
    setSelection({
      ...selection,
      staffIds: updated.length === score.staves.length ? undefined : updated,
    });
  };

  const isSelected = (m: number) =>
    selection !== null &&
    m >= selection.startMeasure &&
    m <= selection.endMeasure;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50 border-b border-gray-200 text-xs">
      {/* Measure cells */}
      <span className="text-gray-500 shrink-0">Measures:</span>
      <div className="flex gap-px overflow-x-auto flex-1">
        {measures.map((m) => (
          <button
            key={m}
            onClick={(e) => handleMeasureClick(m, e)}
            className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono transition-colors ${
              isSelected(m)
                ? "bg-blue-500 text-white"
                : "bg-white text-gray-500 hover:bg-blue-100 border border-gray-200"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Staff filter */}
      {selection && score.staves.length > 1 && (
        <div className="flex items-center gap-1 shrink-0 border-l border-gray-300 pl-2">
          <span className="text-gray-500">Staves:</span>
          {score.staves.map((staff) => {
            const active =
              !selection.staffIds || selection.staffIds.includes(staff.id);
            return (
              <button
                key={staff.id}
                onClick={() => handleStaffToggle(staff.id)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  active
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {staff.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 border-l border-gray-300 pl-2">
        <button
          onClick={handleSelectAll}
          className="px-1.5 py-0.5 text-gray-600 hover:bg-gray-200 rounded"
        >
          All
        </button>
        {selection && (
          <button
            onClick={handleClearSelection}
            className="px-1.5 py-0.5 text-gray-600 hover:bg-gray-200 rounded"
          >
            Clear
          </button>
        )}
      </div>

      {/* Selection info */}
      {selection && (
        <span className="text-gray-400 shrink-0">
          m{selection.startMeasure}
          {selection.endMeasure !== selection.startMeasure &&
            `-${selection.endMeasure}`}
          {selection.staffIds && ` (${selection.staffIds.length} staves)`}
        </span>
      )}

      {/* Last operation replay indicator */}
      {lastOperation && (
        <span className="text-purple-500 shrink-0" title={`Last: ${lastOperation.prompt}`}>
          &#x21bb;
        </span>
      )}
    </div>
  );
}

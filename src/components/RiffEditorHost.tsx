"use client";

// Mounts the riff editor from `uiState.riffEditor`, mirroring RiffPeekHost.
// Both chart renderers and the peek card can open it, so the target lives in
// the store rather than in any one component.

import { useEffect } from "react";
import RiffEditorSheet from "@/components/RiffEditorSheet";
import { useScoreStore } from "@/store/score-store";

export default function RiffEditorHost() {
  const score = useScoreStore((s) => s.score);
  const target = useScoreStore((s) => s.uiState.riffEditor);
  const setUIState = useScoreStore((s) => s.setUIState);

  const riff = target?.riffId ? (score?.riffs ?? []).find((r) => r.id === target.riffId) : undefined;

  // The riff being edited can vanish underneath us (undo, a cloud merge, a
  // different song loaded). Close rather than leaving a sheet editing nothing.
  useEffect(() => {
    if (target?.riffId && !riff) setUIState({ riffEditor: null });
  }, [target?.riffId, riff, setUIState]);

  if (!target) return null;
  if (target.riffId && !riff) return null;

  const anchor = riff
    ? { sectionId: riff.anchor.sectionId ?? "", lineIdx: riff.anchor.lineIdx }
    : { sectionId: target.sectionId ?? "", lineIdx: target.lineIdx };

  return (
    <RiffEditorSheet
      riff={riff}
      anchor={anchor}
      onClose={() => setUIState({ riffEditor: null })}
    />
  );
}

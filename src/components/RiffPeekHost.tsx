"use client";

// Mounts the peek card for whichever riff `uiState.openRiffId` names.
//
// A host rather than inlining the card in each parent: PerformView and page
// both need it, and both would otherwise repeat the lookup, the
// riff-went-away guard, and the close/select handlers.

import { useEffect } from "react";
import RiffPeekCard from "@/components/RiffPeekCard";
import { useScoreStore } from "@/store/score-store";

export default function RiffPeekHost({ performMode }: { performMode?: boolean }) {
  const score = useScoreStore((s) => s.score);
  const openRiffId = useScoreStore((s) => s.uiState.openRiffId);
  const setUIState = useScoreStore((s) => s.setUIState);

  const riffs = score?.riffs ?? [];
  const riff = openRiffId ? riffs.find((r) => r.id === openRiffId) : undefined;

  // The open riff can vanish under us — deleted, or the score replaced by a
  // load. Clear the dangling id rather than leaving a card that renders
  // nothing and swallows the next Escape.
  useEffect(() => {
    if (openRiffId && !riff) setUIState({ openRiffId: null });
  }, [openRiffId, riff, setUIState]);

  if (!riff) return null;
  return (
    <RiffPeekCard
      riff={riff}
      allRiffs={riffs}
      performMode={performMode}
      onClose={() => setUIState({ openRiffId: null })}
      onSelect={(next) => setUIState({ openRiffId: next.id })}
    />
  );
}

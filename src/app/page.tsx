"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useScoreStore } from "@/store/score-store";
import PromptPanel from "@/components/PromptPanel";
import PropertiesPanel from "@/components/PropertiesPanel";
import Toolbar from "@/components/Toolbar";
import SelectionBar from "@/components/SelectionBar";

// Dynamic import to prevent SSR for OSMD (uses browser APIs)
const ScoreRenderer = dynamic(() => import("@/components/ScoreRenderer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      Loading renderer...
    </div>
  ),
});

export default function Home() {
  const { score, undo, redo, layout } = useScoreStore();
  const [zoom, setZoom] = useState(1.0);
  const printFnRef = useRef<(() => Promise<void>) | null>(null);
  const handlePrint = useCallback(() => { printFnRef.current?.(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  return (
    <div className="flex flex-col h-screen bg-gray-100 print-full">
      <div className="print-hide">
        <Toolbar zoom={zoom} onZoomChange={setZoom} onPrint={handlePrint} />
        <SelectionBar />
      </div>

      <div className="flex flex-1 overflow-hidden print-full">
        {/* Left: Prompt Panel */}
        <div className="w-80 shrink-0 print-hide">
          <PromptPanel />
        </div>

        {/* Center: Score View */}
        <div className="flex-1 overflow-auto p-4 print-full">
          {score ? (
            <div className="score-container h-full">
              <ScoreRenderer
                score={score}
                zoom={zoom}
                layout={layout}
                onReady={(h) => { printFnRef.current = h.printScore; }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2 print-hide">
              <div className="text-6xl opacity-30">&#119070;</div>
              <p className="text-lg font-medium">No score yet</p>
              <p className="text-sm">
                Type a description in the prompt panel to generate a score
              </p>
            </div>
          )}
        </div>

        {/* Right: Properties Panel */}
        <div className="w-72 shrink-0 print-hide">
          <PropertiesPanel />
        </div>
      </div>
    </div>
  );
}

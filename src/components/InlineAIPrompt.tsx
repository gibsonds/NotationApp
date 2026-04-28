"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useScoreStore } from "@/store/score-store";
import { IS_STATIC_EXPORT, STATIC_FEATURE_DISABLED_MESSAGE } from "@/lib/api-availability";
import { v4 as uuidv4 } from "uuid";

interface InlineAIPromptProps {
  note: { measure: number; beat: number; pitch: string; staffIndex: number };
  position: { x: number; y: number };
  onClose: () => void;
}

export default function InlineAIPrompt({ note, position, onClose }: InlineAIPromptProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { score, setScore, applyPatches, addMessage, setWarnings } = useScoreStore();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || !score || loading) return;

    const prompt = input.trim();
    if (IS_STATIC_EXPORT) {
      addMessage({ id: uuidv4(), role: "assistant", content: STATIC_FEATURE_DISABLED_MESSAGE, timestamp: Date.now() });
      onClose();
      return;
    }
    setLoading(true);

    try {
      const staff = score.staves[note.staffIndex];
      const voice = staff?.voices[0];
      const sorted = voice?.notes
        .filter(n => n.pitch !== "rest")
        .sort((a, b) => a.measure - b.measure || a.beat - b.beat) || [];
      const idx = sorted.findIndex(n => n.measure === note.measure && Math.abs(n.beat - note.beat) < 0.05);
      const curNote = idx >= 0 ? sorted[idx] : null;
      const prev = idx > 0 ? sorted[idx - 1] : null;
      const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

      let selectedNoteInfo = `${note.pitch} at measure ${note.measure} beat ${note.beat} on staff "${staff?.name}"`;
      if (prev) selectedNoteInfo += `. Previous note: ${prev.pitch} m${prev.measure} b${prev.beat}`;
      if (next) selectedNoteInfo += `. Next note: ${next.pitch} m${next.measure} b${next.beat}`;

      const res = await fetch("/api/score/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currentScore: score,
          selection: {
            startMeasure: note.measure,
            endMeasure: note.measure,
            staffIds: staff ? [staff.id] : undefined,
          },
          selectedNote: selectedNoteInfo,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (data.score) {
        setScore(data.score);
      } else if (data.patches?.length) {
        applyPatches(data.patches);
      }

      if (data.warnings?.length) setWarnings(data.warnings);

      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: data.message || `Applied: "${prompt}" to ${note.pitch} at m${note.measure}`,
        timestamp: Date.now(),
      });

      onClose();
    } catch (err: any) {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `AI edit error: ${err.message}`,
        timestamp: Date.now(),
      });
      onClose();
    }
  }, [input, score, note, loading, setScore, applyPatches, addMessage, setWarnings, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Position: keep within viewport
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(position.x, window.innerWidth - 340),
    top: Math.min(position.y + 10, window.innerHeight - 60),
    zIndex: 1001,
  };

  return (
    <div ref={containerRef} style={style} className="bg-white rounded-lg shadow-xl border border-purple-200 p-2 w-[320px]">
      <div className="text-[10px] text-purple-400 mb-1">
        AI Edit: {note.pitch} at m{note.measure}
      </div>
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='e.g. "transpose up a third"'
          disabled={loading}
          className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-400 focus:border-transparent disabled:opacity-50 text-gray-800 placeholder-gray-400"
          autoFocus
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="px-3 py-1.5 text-sm font-medium bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "..." : "Go"}
        </button>
      </div>
    </div>
  );
}

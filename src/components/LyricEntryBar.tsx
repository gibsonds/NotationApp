"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useScoreStore } from "@/store/score-store";
import { Note } from "@/lib/schema";

/**
 * Lyric entry bar: type lyrics that flow under notes sequentially.
 * Space = commit word + advance to next note.
 * Hyphen at end = syllable break (adds "-" suffix) + advance.
 * Enter/Escape = exit lyric mode.
 * Backspace on empty = go back to previous note.
 * Lyrics update on the score in real-time as you type.
 */

interface LyricEntryBarProps {
  staffId: string;
  voiceId: string;
  startMeasure: number;
  startBeat: number;
  /** Incremented by parent when user clicks a note — triggers a jump without prop-loop */
  jumpKey?: number;
  onClose: () => void;
  onCurrentNote: (info: { measure: number; beat: number; staffIndex: number } | null) => void;
}

export default function LyricEntryBar({ staffId, voiceId, startMeasure, startBeat, jumpKey, onClose, onCurrentNote }: LyricEntryBarProps) {
  const score = useScoreStore((s) => s.score);
  const applyPatches = useScoreStore((s) => s.applyPatches);
  const [text, setText] = useState("");
  const [noteIndex, setNoteIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCurrentNoteRef = useRef(onCurrentNote);
  onCurrentNoteRef.current = onCurrentNote;

  // Get sorted pitched notes for the voice — stable deps
  const notes = useMemo((): Note[] => {
    if (!score) return [];
    const staff = score.staves.find(s => s.id === staffId);
    const voice = staff?.voices.find(v => v.id === voiceId);
    if (!voice) return [];
    return voice.notes
      .filter(n => n.pitch !== "rest")
      .sort((a, b) => a.measure - b.measure || a.beat - b.beat);
  }, [score, staffId, voiceId]);

  const noteIndexRef = useRef(noteIndex);
  noteIndexRef.current = noteIndex;

  // Find starting index on mount
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let idx = notes.findIndex(
      n => n.measure === startMeasure && Math.abs(n.beat - startBeat) < 0.1
    );
    if (idx < 0) {
      idx = notes.findIndex(
        n => n.measure > startMeasure || (n.measure === startMeasure && n.beat >= startBeat - 0.5)
      );
    }
    const startIdx = idx >= 0 ? idx : 0;
    setNoteIndex(startIdx);
    setText(notes[startIdx]?.lyric || "");
    setTimeout(() => inputRef.current?.focus(), 50);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep a ref to notes so the jump effect doesn't depend on the memo
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Jump to clicked note — only fires when parent increments jumpKey (on click),
  // NOT on every stepEntry/prop change, which avoids the infinite update loop.
  const prevJumpKeyRef = useRef(jumpKey);
  useEffect(() => {
    if (!initRef.current) return;
    if (jumpKey === prevJumpKeyRef.current) return;
    prevJumpKeyRef.current = jumpKey;

    const curNotes = notesRef.current;
    let idx = curNotes.findIndex(
      n => n.measure === startMeasure && Math.abs(n.beat - startBeat) < 0.1
    );
    if (idx < 0) {
      idx = curNotes.findIndex(
        n => n.measure > startMeasure || (n.measure === startMeasure && n.beat >= startBeat - 0.5)
      );
    }
    const newIdx = idx >= 0 ? idx : noteIndexRef.current;
    setNoteIndex(newIdx);
    setText(curNotes[newIdx]?.lyric || "");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [jumpKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update parent highlight when noteIndex changes — use ref to avoid dep on callback
  const prevHighlightRef = useRef<string | null>(null);
  useEffect(() => {
    const note = notes[noteIndex];
    if (note && score) {
      const staffIdx = score.staves.findIndex(s => s.id === staffId);
      const key = `${note.measure}:${note.beat}:${staffIdx}`;
      if (prevHighlightRef.current !== key) {
        prevHighlightRef.current = key;
        onCurrentNoteRef.current({ measure: note.measure, beat: note.beat, staffIndex: staffIdx });
      }
    } else {
      if (prevHighlightRef.current !== null) {
        prevHighlightRef.current = null;
        onCurrentNoteRef.current(null);
      }
    }
  }, [noteIndex, notes, score, staffId]);

  const currentNote = notes[noteIndex] || null;

  // Commit lyric to the current note and optionally advance
  const commitLyric = useCallback((lyricText: string, advance: boolean) => {
    const note = notes[noteIndex];
    if (!note) return;

    applyPatches([{
      op: "update_note" as const,
      staffId,
      voiceId,
      measure: note.measure,
      beat: note.beat,
      pitch: note.pitch,
      updates: { lyric: lyricText || undefined },
    }]);

    if (advance) {
      if (noteIndex < notes.length - 1) {
        setNoteIndex(noteIndex + 1);
        // Load existing lyric from next note
        const next = notes[noteIndex + 1];
        setText(next?.lyric || "");
      } else {
        onClose();
      }
    } else {
      setText("");
    }
  }, [staffId, voiceId, notes, noteIndex, applyPatches, onClose]);

  const goBack = useCallback(() => {
    if (noteIndex > 0) {
      setNoteIndex(noteIndex - 1);
      const prev = notes[noteIndex - 1];
      setText(prev?.lyric || "");
    }
  }, [noteIndex, notes]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      // Always commit current text (even empty — clears lyric)
      commitLyric(text.trim(), false);
      onClose();
      return;
    }

    if (e.key === "Backspace" && text === "") {
      e.preventDefault();
      goBack();
      return;
    }

    if (e.key === " ") {
      e.preventDefault();
      commitLyric(text.trim(), true);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      commitLyric("", true);
      return;
    }

    // Arrow Right — commit current lyric and advance (like Space but keeps empty text)
    if (e.key === "ArrowRight" && text === "") {
      e.preventDefault();
      if (noteIndex < notes.length - 1) {
        setNoteIndex(noteIndex + 1);
        const next = notes[noteIndex + 1];
        setText(next?.lyric || "");
      }
      return;
    }

    // Arrow Left — go back to previous note (commit current first)
    if (e.key === "ArrowLeft" && text === "") {
      e.preventDefault();
      goBack();
      return;
    }
  }, [text, commitLyric, goBack, onClose, noteIndex, notes]);

  // Handle text changes — commit on hyphen, otherwise just update local state
  // (no live applyPatches — that triggers full OSMD re-render and scroll jumps)
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val.endsWith("-") && val.length > 1) {
      commitLyric(val, true);
      return;
    }
    setText(val);
  }, [commitLyric]);

  if (!score) return null;

  return (
    <div className="print-hide flex items-center gap-3 px-4 py-2 bg-pink-900 text-white text-xs border-t border-pink-700">
      <span className="text-pink-300 font-bold text-sm">LYRIC</span>

      {currentNote ? (
        <span className="text-pink-200">
          {currentNote.pitch} M{currentNote.measure}:B{currentNote.beat}
          <span className="text-pink-400 ml-1">({noteIndex + 1}/{notes.length})</span>
        </span>
      ) : (
        <span className="text-pink-400">No notes to add lyrics to</span>
      )}

      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Type lyric, Space=next, hyphen=syllable, arrows=navigate, Esc=done"
        className="flex-1 px-2 py-1 text-sm bg-pink-800 text-white border border-pink-600 rounded focus:outline-none focus:border-pink-400 placeholder-pink-500"
        autoFocus
      />

      {/* Preview strip */}
      <div className="flex items-center gap-1 text-[10px] text-pink-400 max-w-xs overflow-hidden">
        {notes.slice(Math.max(0, noteIndex - 2), noteIndex + 5).map((n, i) => {
          const absIdx = Math.max(0, noteIndex - 2) + i;
          const isCurrent = absIdx === noteIndex;
          return (
            <span
              key={`${n.measure}-${n.beat}`}
              className={isCurrent ? "text-white font-bold underline" : n.lyric ? "text-pink-300" : "text-pink-600"}
            >
              {isCurrent ? (text || "_") : (n.lyric || "\u00B7")}
            </span>
          );
        })}
      </div>

      <button
        onClick={() => { commitLyric(text.trim(), false); onClose(); }}
        className="px-2 py-0.5 text-[10px] bg-pink-700 hover:bg-pink-600 rounded"
      >
        Done (Esc)
      </button>
    </div>
  );
}

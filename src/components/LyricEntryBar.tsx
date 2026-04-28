"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useScoreStore } from "@/store/score-store";
import { ChordSymbol, Note, ScorePatch } from "@/lib/schema";

// ── Inline chord parser ──────────────────────────────────────────────────────

interface WordChordPair {
  word: string;
  chord?: string;
}

// Matches chord names: G, Am, C#m, Bb, D7, Cmaj7, G/B, D/F#, sus4, etc.
const CHORD_RE = /^[A-G][b#]?(m|M|maj|min|dim|aug|sus[24]?|add)?\d*(\/[A-G][b#]?)?$/;
function isChordToken(s: string): boolean { return CHORD_RE.test(s); }

/** Parse [G]Amazing [C]grace bracketed-chord format. Newlines are treated as spaces. */
function parseBracketed(text: string): WordChordPair[] {
  const pairs: WordChordPair[] = [];
  const re = /\[([^\]]+)\]|(\S+)/g;
  let pendingChord: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.replace(/\n/g, " "))) !== null) {
    if (m[1] !== undefined) {
      pendingChord = m[1].trim();
    } else {
      pairs.push({ word: m[2], chord: pendingChord });
      pendingChord = undefined;
    }
  }
  return pairs;
}

/** Parse above-the-line format: a chord-only line paired with the lyric line below it. */
function parseAboveLine(text: string): WordChordPair[] {
  const pairs: WordChordPair[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) { i++; continue; }

    const isChordLine = tokens.every(isChordToken);
    const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
    const nextTokens = nextLine?.trim().split(/\s+/).filter(Boolean) ?? [];
    const nextIsLyric = nextTokens.length > 0 && !nextTokens.every(isChordToken);

    if (isChordLine && nextIsLyric) {
      // Extract chord positions (column-indexed) from the chord line
      const chordCols: { col: number; chord: string }[] = [];
      let cm: RegExpExecArray | null;
      const cr = /\S+/g;
      while ((cm = cr.exec(line)) !== null) {
        if (isChordToken(cm[0])) chordCols.push({ col: cm.index, chord: cm[0] });
      }

      // Extract word positions (column-indexed) from the lyric line
      const wordCols: { col: number; word: string }[] = [];
      let wm: RegExpExecArray | null;
      const wr = /\S+/g;
      while ((wm = wr.exec(nextLine!)) !== null) {
        wordCols.push({ col: wm.index, word: wm[0] });
      }

      // Greedy nearest-unassigned-word assignment: each chord claims the closest word
      const result: WordChordPair[] = wordCols.map(w => ({ word: w.word }));
      const usedWords = new Set<number>();
      for (const { col, chord } of chordCols) {
        let best = -1, bestDist = Infinity;
        for (let wi = 0; wi < wordCols.length; wi++) {
          if (usedWords.has(wi)) continue;
          const dist = Math.abs(wordCols[wi].col - col);
          if (dist < bestDist) { bestDist = dist; best = wi; }
        }
        if (best >= 0) { result[best].chord = chord; usedWords.add(best); }
      }
      pairs.push(...result);
      i += 2;
    } else {
      // Plain lyric line (or an unpairable chord-only line — treat words as lyrics)
      pairs.push(...tokens.map(w => ({ word: w })));
      i++;
    }
  }
  return pairs;
}

/**
 * Parse pasted lyrics text that may contain inline chord annotations.
 * Bracketed format ([G]word) is detected first; otherwise above-the-line format is tried.
 * Pure lyrics (no chords) return pairs with no chord field set.
 */
function parseLyricsWithChords(text: string): WordChordPair[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (/\[[A-G][^\]]*\]/.test(trimmed)) return parseBracketed(trimmed);
  return parseAboveLine(trimmed);
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
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

  const handlePasteSubmit = useCallback(() => {
    const pairs = parseLyricsWithChords(pasteText);
    if (pairs.length > 0) {
      const allPatches: ScorePatch[] = pairs.flatMap(({ word }, i) => {
        const note = notes[noteIndex + i];
        if (!note) return [];
        return [{
          op: "update_note" as const,
          staffId,
          voiceId,
          measure: note.measure,
          beat: note.beat,
          pitch: note.pitch,
          updates: { lyric: word },
        }];
      });

      // Collect chord symbols from pairs and merge into score.chordSymbols
      const newChords: ChordSymbol[] = pairs.flatMap(({ chord }, i) => {
        if (!chord) return [];
        const note = notes[noteIndex + i];
        if (!note) return [];
        return [{ measure: note.measure, beat: note.beat, symbol: chord }];
      });

      if (newChords.length > 0 && score) {
        const overwrittenKeys = new Set(newChords.map(c => `${c.measure}:${c.beat}`));
        const kept = score.chordSymbols.filter(
          cs => !overwrittenKeys.has(`${cs.measure}:${cs.beat}`)
        );
        allPatches.push({
          op: "set_chord_symbols",
          chordSymbols: [...kept, ...newChords],
        });
      }

      if (allPatches.length > 0) applyPatches(allPatches);

      const newIdx = Math.min(noteIndex + pairs.length, notes.length - 1);
      setNoteIndex(newIdx);
      setText(notes[newIdx]?.lyric || "");
    }
    setPasteMode(false);
    setPasteText("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [pasteText, notes, noteIndex, staffId, voiceId, applyPatches, score]);

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
    <div className="print-hide bg-[#1a1a2e] text-white text-xs border-t border-pink-500/30">
      {/* Paste block panel */}
      {pasteMode && (
        <div className="flex items-start gap-3 px-4 pt-3 pb-2">
          <span className="text-pink-300 font-bold text-sm shrink-0 mt-1">PASTE</span>
          <textarea
            ref={pasteRef}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste lyrics here — words are assigned to notes in order. ⌘↩ to apply, Esc to cancel."
            rows={4}
            className="flex-1 px-2 py-1 text-sm bg-white/5 text-white border border-pink-500/30 rounded-lg focus:outline-none focus:border-pink-400 placeholder-pink-500/50 resize-y"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setPasteMode(false);
                setPasteText("");
                setTimeout(() => inputRef.current?.focus(), 50);
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handlePasteSubmit();
              }
            }}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={handlePasteSubmit}
              className="px-2 py-1 text-[10px] bg-pink-600 hover:bg-pink-500 rounded-lg text-white transition-colors"
            >
              Apply (⌘↩)
            </button>
            <button
              onClick={() => {
                setPasteMode(false);
                setPasteText("");
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="px-2 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 rounded-lg text-pink-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Normal lyric entry bar */}
      <div className="flex items-center gap-3 px-4 py-2">
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
          className="flex-1 px-2 py-1 text-sm bg-white/5 text-white border border-pink-500/30 rounded-lg focus:outline-none focus:border-pink-400 placeholder-pink-500/50"
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
          onClick={() => {
            setPasteMode(true);
            setTimeout(() => pasteRef.current?.focus(), 50);
          }}
          className="px-2 py-0.5 text-[10px] bg-pink-800/40 hover:bg-pink-800/60 rounded-lg text-pink-300 transition-colors"
          title="Paste a block of lyrics and auto-assign to notes"
        >
          Paste Block
        </button>

        <button
          onClick={() => { commitLyric(text.trim(), false); onClose(); }}
          className="px-2 py-0.5 text-[10px] bg-pink-600/30 hover:bg-pink-600/50 rounded-lg text-pink-300 transition-colors"
        >
          Done (Esc)
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useScoreStore } from "@/store/score-store";
import { ChordSymbol, Note, ScorePatch } from "@/lib/schema";
import { parseLyricsWithChords, parseToSections } from "@/lib/lyric-parser";

export default function PasteLyricsModal({ onClose }: { onClose: () => void }) {
  const score = useScoreStore(s => s.score);
  const applyPatches = useScoreStore(s => s.applyPatches);
  const stepEntry = useScoreStore(s => s.stepEntry);
  const [text, setText] = useState("");

  // Determine staff, voice, sorted notes, and starting index from stepEntry
  const { staffId, voiceId, notes, startIdx } = useMemo((): {
    staffId: string; voiceId: string; notes: Note[]; startIdx: number;
  } => {
    if (!score) return { staffId: "", voiceId: "", notes: [], startIdx: 0 };
    const staff = (stepEntry ? score.staves.find(s => s.id === stepEntry.staffId) : null)
      ?? score.staves[0];
    const voice = (stepEntry ? staff?.voices.find(v => v.id === stepEntry.voiceId) : null)
      ?? staff?.voices[0];
    if (!staff || !voice) return { staffId: "", voiceId: "", notes: [], startIdx: 0 };

    const sorted = voice.notes
      .filter(n => n.pitch !== "rest")
      .sort((a, b) => a.measure - b.measure || a.beat - b.beat);

    let idx = 0;
    if (stepEntry) {
      const exact = sorted.findIndex(
        n => n.measure === stepEntry.measure && Math.abs(n.beat - stepEntry.beat) < 0.1
      );
      if (exact >= 0) {
        idx = exact;
      } else {
        const next = sorted.findIndex(
          n => n.measure > stepEntry.measure ||
            (n.measure === stepEntry.measure && n.beat >= stepEntry.beat - 0.5)
        );
        if (next >= 0) idx = next;
      }
    }
    return { staffId: staff.id, voiceId: voice.id, notes: sorted, startIdx: idx };
  }, [score, stepEntry]);

  const isChordChartMode = !!score && score.sections.length > 0 && score.staves.length === 0;

  // Keep a ref to the apply handler so the keyboard effect never goes stale
  const applyRef = useRef<() => void>(() => {});

  const handleApplyChordChart = () => {
    if (!score || !isChordChartMode) return;
    const parsedSections = parseToSections(text);
    if (parsedSections.length === 0) { onClose(); return; }

    const hasHeaders = parsedSections.length > 1 || parsedSections[0].label !== "";

    if (!hasHeaders) {
      // No section headers — old behaviour: replace lines in section[0] only
      const section = score.sections[0];
      const newLines = parsedSections[0].lines;
      if (newLines.length === 0) { onClose(); return; }
      const patches: ScorePatch[] = [];
      for (let i = section.lines.length - 1; i >= 0; i--) {
        patches.push({ op: "remove_section_line", sectionId: section.id, lineIdx: i });
      }
      for (const line of newLines) {
        patches.push({ op: "add_section_line", sectionId: section.id, line });
      }
      applyPatches(patches);
    } else {
      // Section headers detected — replace ALL sections with the parsed result
      const ts = Date.now();
      const patches: ScorePatch[] = [];
      for (const section of score.sections) {
        patches.push({ op: "remove_section", sectionId: section.id });
      }
      for (let i = 0; i < parsedSections.length; i++) {
        const parsed = parsedSections[i];
        const label = parsed.label || score.sections[0]?.label || "Verse 1";
        patches.push({
          op: "add_section",
          section: {
            id: `section-${ts}-${i}`,
            label,
            lines: parsed.lines.length > 0 ? parsed.lines : [{ chords: "", lyrics: "" }],
          },
        });
      }
      applyPatches(patches);
    }
    onClose();
  };

  const handleApply = () => {
    if (isChordChartMode) { handleApplyChordChart(); return; }

    const pairs = parseLyricsWithChords(text);
    if (pairs.length === 0 || !score) { onClose(); return; }

    const allPatches: ScorePatch[] = pairs.flatMap(({ word }, i) => {
      const note = notes[startIdx + i];
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

    const newChords: ChordSymbol[] = pairs.flatMap(({ chord }, i) => {
      if (!chord) return [];
      const note = notes[startIdx + i];
      if (!note) return [];
      return [{ measure: note.measure, beat: note.beat, symbol: chord }];
    });

    if (newChords.length > 0) {
      const overwrittenKeys = new Set(newChords.map(c => `${c.measure}:${c.beat}`));
      const kept = score.chordSymbols.filter(
        cs => !overwrittenKeys.has(`${cs.measure}:${cs.beat}`)
      );
      allPatches.push({ op: "set_chord_symbols", chordSymbols: [...kept, ...newChords] });
    }

    if (allPatches.length > 0) applyPatches(allPatches);
    onClose();
  };

  // Keep ref current on every render so the stable effect below always calls the latest
  useEffect(() => { applyRef.current = handleApply; });

  // Stable keyboard handler: Escape closes, Cmd/Ctrl+Enter applies
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { applyRef.current(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const canApply = !!text.trim() && !!score && (isChordChartMode || notes.length > 0);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900 text-base">Paste Lyrics / Chords</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isChordChartMode
                ? <>Replaces section content. Section headers (<code className="bg-gray-100 px-1 rounded font-mono">Verse 1:</code>, <code className="bg-gray-100 px-1 rounded font-mono">Chorus:</code>, etc.) create multiple sections. Supports <code className="bg-gray-100 px-1 rounded font-mono">[G]chord</code> and chord-above-lyric formats.</>
                : <>Words assigned to notes from the cursor. Supports <code className="bg-gray-100 px-1 rounded font-mono">[G]chord</code> and chord-above-lyric formats.</>
              }
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={8}
            autoFocus
            placeholder={
              "Section headers split into multiple sections:\nVerse 1:\n[G]Amazing [C]grace how [G]sweet\n\nChorus:\nHow great thou art\n\n" +
              "Or plain lyrics (no headers):\nAmazing grace how sweet the sound\n\n" +
              "Chord-above-lyric:\nG         C    G\nAmazing grace how sweet"
            }
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono"
          />

          {!isChordChartMode && score && !stepEntry && notes.length > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              No note selected — pasting from the beginning. Tap a note first to set the start position.
            </p>
          )}
          {!isChordChartMode && score && notes.length === 0 && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              No pitched notes found. Add notes to the score before pasting lyrics.
            </p>
          )}
          {isChordChartMode && score && score.sections.length > 0 && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Chord chart mode. Without headers: replaces &ldquo;{score.sections[0].label}&rdquo; lines.
              With headers (Verse:, Chorus:, Bridge:, …): replaces all {score.sections.length} section{score.sections.length !== 1 ? "s" : ""}.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-3 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className="px-6 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

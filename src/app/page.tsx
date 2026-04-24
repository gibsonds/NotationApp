"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useScoreStore } from "@/store/score-store";
import { playScore, stopPlayback, isPlaying } from "@/lib/playback";
import PromptPanel from "@/components/PromptPanel";
import PropertiesPanel from "@/components/PropertiesPanel";
import Toolbar from "@/components/Toolbar";
import SelectionBar from "@/components/SelectionBar";
import LyricEntryBar from "@/components/LyricEntryBar";
import NoteContextMenu from "@/components/NoteContextMenu";

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
  const stepEntry = useScoreStore((s) => s.stepEntry);
  const setStepEntry = useScoreStore((s) => s.setStepEntry);
  const applyPatches = useScoreStore((s) => s.applyPatches);
  const copySelection = useScoreStore((s) => s.copySelection);
  const pasteAtSelection = useScoreStore((s) => s.pasteAtSelection);
  const addMessage = useScoreStore((s) => s.addMessage);
  const selection = useScoreStore((s) => s.selection);
  const setSelection = useScoreStore((s) => s.setSelection);
  const clipboard = useScoreStore((s) => s.clipboard);
  const [zoom, setZoom] = useState(1.0);
  const [playing, setPlaying] = useState(false);
  const [playbackPos, setPlaybackPos] = useState<{ measure: number; beat: number } | null>(null);
  const [selectedNote, setSelectedNote] = useState<{ measure: number; beat: number; staffIndex: number; pitch: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; note: { measure: number; beat: number; pitch: string; staffIndex: number } } | null>(null);
  const [editingPosition, setEditingPosition] = useState(false);
  const [editMeasure, setEditMeasure] = useState("");
  const [editBeat, setEditBeat] = useState("");
  const [lyricMode, setLyricMode] = useState(false);
  const [lyricJumpKey, setLyricJumpKey] = useState(0);
  const [lyricHighlight, setLyricHighlight] = useState<{ measure: number; beat: number; staffIndex: number } | null>(null);
  const printFnRef = useRef<(() => Promise<void>) | null>(null);
  const handlePrint = useCallback(() => { printFnRef.current?.(); }, []);

  // Compute cursor position from stepEntry
  const cursorPosition = stepEntry ? {
    measure: stepEntry.measure,
    beat: stepEntry.beat,
    staffIndex: score?.staves.findIndex(s => s.id === stepEntry.staffId) ?? 0,
  } : null;

  // Handle score click — now receives precise pitch when a note was clicked
  const handleScoreClick = useCallback((info: {
    measure: number; beat: number; staffIndex: number;
    pitch?: string; shiftKey?: boolean;
    isRightClick?: boolean; clientX?: number; clientY?: number;
  }) => {
    if (!score) return;
    const staffIdx = info.staffIndex;
    const staff = score.staves[staffIdx];
    if (!staff) return;
    const voice = (stepEntry ? staff.voices.find(v => v.id === stepEntry.voiceId) : null) || staff.voices[0];
    if (!voice) return;

    // Close context menu on any click
    setContextMenu(null);

    // Right-click on a note → context menu
    if (info.isRightClick && info.pitch && info.clientX != null && info.clientY != null) {
      setSelectedNote({ measure: info.measure, beat: info.beat, staffIndex: staffIdx, pitch: info.pitch });
      setStepEntry({ active: true, staffId: staff.id, voiceId: voice.id, measure: info.measure, beat: info.beat });
      setContextMenu({
        x: info.clientX,
        y: info.clientY,
        note: { measure: info.measure, beat: info.beat, pitch: info.pitch, staffIndex: staffIdx },
      });
      return;
    }

    // Shift+click: extend selection range
    if (info.shiftKey) {
      const anchor = selectedNote
        ? { measure: selectedNote.measure, beat: selectedNote.beat }
        : stepEntry
          ? { measure: stepEntry.measure, beat: stepEntry.beat }
          : { measure: info.measure, beat: info.beat };

      const startM = Math.min(anchor.measure, info.measure);
      const endM = Math.max(anchor.measure, info.measure);
      const startB = anchor.measure < info.measure ? anchor.beat
        : anchor.measure > info.measure ? info.beat
        : Math.min(anchor.beat, info.beat);
      const endB = anchor.measure < info.measure ? info.beat
        : anchor.measure > info.measure ? anchor.beat
        : Math.max(anchor.beat, info.beat);

      setSelection({
        startMeasure: startM,
        endMeasure: endM,
        startBeat: Math.round(startB * 100) / 100,
        endBeat: Math.round(endB * 100) / 100,
      });
      return;
    }

    // Normal click on a note — select it precisely
    if (info.pitch) {
      setSelectedNote({ measure: info.measure, beat: info.beat, staffIndex: staffIdx, pitch: info.pitch });
      setSelection(null);
      setStepEntry({ active: true, staffId: staff.id, voiceId: voice.id, measure: info.measure, beat: info.beat });
      if (lyricMode) setLyricJumpKey(k => k + 1);
      return;
    }

    // Normal click on empty space — move cursor, deselect
    setSelectedNote(null);
    setSelection(null);
    setStepEntry({
      active: true,
      staffId: staff.id,
      voiceId: voice.id,
      measure: info.measure,
      beat: Math.max(1, info.beat),
    });
  }, [stepEntry, score, setStepEntry, selectedNote, setSelection, lyricMode]);

  // Arrow keys to move cursor + Delete to remove selected note
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Undo/Redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        redo();
        return;
      }

      // Copy/Paste
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        // Only intercept if no text is selected (allow normal text copy)
        const textSelected = window.getSelection()?.toString();
        if (!textSelected) {
          e.preventDefault();
          const msg = copySelection();
          if (msg) addMessage({ id: crypto.randomUUID(), role: "assistant", content: msg, timestamp: Date.now() });
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        const textSelected = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (!textSelected) {
          e.preventDefault();
          const msg = pasteAtSelection();
          if (msg) addMessage({ id: crypto.randomUUID(), role: "assistant", content: msg, timestamp: Date.now() });
        }
        return;
      }

      if (!stepEntry || !score) return;

      const [beatsStr, beatTypeStr] = score.timeSignature.split("/").map(Number);
      const beatsPerMeasure = beatsStr * (4 / beatTypeStr);

      // Arrow Right — advance cursor. Snaps to whole beats; shift = half-beat.
      if (e.key === "ArrowRight") {
        e.preventDefault();
        let { measure, beat } = stepEntry;
        if (e.shiftKey) {
          beat = Math.floor(beat * 2 + 1) / 2; // next half-beat
        } else {
          beat = Math.floor(beat) + 1; // next whole beat
        }
        if (beat >= beatsPerMeasure + 1 - 0.001) {
          beat = 1;
          measure++;
          if (measure > score.measures) { measure = score.measures; beat = beatsPerMeasure; }
        }
        setStepEntry({ ...stepEntry, measure, beat: Math.round(beat * 1000) / 1000 });
        setSelectedNote(null);
        return;
      }

      // Arrow Left — move cursor back. Snaps to whole beats; shift = half-beat.
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        let { measure, beat } = stepEntry;
        if (e.shiftKey) {
          beat = Math.ceil(beat * 2 - 1) / 2; // prev half-beat
        } else {
          beat = Math.ceil(beat) - 1; // prev whole beat
        }
        if (beat < 1) {
          if (measure > 1) {
            measure--;
            beat = beatsPerMeasure;
          } else {
            beat = 1;
          }
        }
        setStepEntry({ ...stepEntry, measure, beat: Math.round(beat * 1000) / 1000 });
        setSelectedNote(null);
        return;
      }

      // Arrow Up / Down — move between staves
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (score.staves.length <= 1) return;
        e.preventDefault();
        const curIdx = score.staves.findIndex(s => s.id === stepEntry.staffId);
        const newIdx = e.key === "ArrowUp"
          ? Math.max(0, curIdx - 1)
          : Math.min(score.staves.length - 1, curIdx + 1);
        if (newIdx !== curIdx) {
          const newStaff = score.staves[newIdx];
          setStepEntry({
            ...stepEntry,
            staffId: newStaff.id,
            voiceId: newStaff.voices[0]?.id || stepEntry.voiceId,
          });
        }
        return;
      }

      // L key — toggle lyric entry mode
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        if (lyricMode) {
          setLyricMode(false);
          setLyricHighlight(null);
        } else {
          applyPatches([{
            op: "update_staff" as const,
            staffId: stepEntry.staffId,
            lyricsMode: "attached" as const,
          }]);
          setLyricMode(true);
        }
        return;
      }

      // Delete selected note (only when a note is explicitly selected, not during general step-entry)
      if (e.key === "Delete" && selectedNote && !e.shiftKey) {
        e.preventDefault();
        applyPatches([{
          op: "remove_note",
          staffId: stepEntry.staffId,
          voiceId: stepEntry.voiceId,
          measure: selectedNote.measure,
          beat: selectedNote.beat,
          pitch: selectedNote.pitch,
        }]);
        setSelectedNote(null);
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [stepEntry, score, selectedNote, undo, redo, setStepEntry, applyPatches, copySelection, pasteAtSelection, addMessage, lyricMode, setLyricMode]);

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
                cursorPosition={cursorPosition}
                selectedNote={selectedNote}
                onScoreClick={handleScoreClick}
                selection={selection}
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

      {/* Bottom status bar */}
      {score && (
        <div className="print-hide flex items-center justify-between px-4 py-1.5 bg-gray-800 text-white text-xs font-mono border-t border-gray-700">
          <div className="flex items-center gap-3">
            {/* Playback controls */}
            <button
              onClick={async () => {
                if (playing) {
                  stopPlayback();
                  setPlaying(false);
                  setPlaybackPos(null);
                } else {
                  setPlaying(true);
                  await playScore(score, selection, (m, b) => {
                    if (m === 0) { setPlaybackPos(null); return; }
                    setPlaybackPos({ measure: m, beat: b });
                  });
                  setPlaying(false);
                  setPlaybackPos(null);
                }
              }}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                playing
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-green-600 hover:bg-green-700 text-white"
              }`}
              title={playing ? "Stop playback" : `Play${selection ? ` m${selection.startMeasure}-${selection.endMeasure}` : " all"}`}
            >
              {playing ? "\u25A0 Stop" : "\u25B6 Play"}
            </button>
            {playbackPos && (
              <span className="text-green-400 text-[10px]">
                M{playbackPos.measure}:B{playbackPos.beat.toFixed(1)}
              </span>
            )}

            {/* Divider */}
            <span className="text-gray-600">|</span>

            {/* Cursor position (editable) */}
            {stepEntry && (
              <>
                {editingPosition ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const m = parseInt(editMeasure);
                      const b = parseFloat(editBeat);
                      if (!isNaN(m) && !isNaN(b) && m >= 1 && b >= 1) {
                        const maxM = score?.measures || 999;
                        setStepEntry({ ...stepEntry, measure: Math.min(m, maxM), beat: Math.round(b * 1000) / 1000 });
                      }
                      setEditingPosition(false);
                    }}
                  >
                    <span className="text-blue-300 text-[10px]">Cursor:</span>
                    <span className="text-blue-300 text-[10px]">M</span>
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      value={editMeasure}
                      onChange={(e) => setEditMeasure(e.target.value)}
                      className="w-10 px-1 py-0 text-[11px] bg-gray-700 text-blue-300 font-bold border border-gray-600 rounded text-center"
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingPosition(false); }}
                    />
                    <span className="text-blue-300 text-[10px]">B</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={editBeat}
                      onChange={(e) => setEditBeat(e.target.value)}
                      className="w-12 px-1 py-0 text-[11px] bg-gray-700 text-blue-300 font-bold border border-gray-600 rounded text-center"
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingPosition(false); }}
                    />
                    <button type="submit" className="text-[10px] text-green-400 hover:text-green-300">Go</button>
                  </form>
                ) : (
                  <span
                    className="text-blue-300 font-bold cursor-pointer hover:text-blue-200 select-none"
                    onClick={() => {
                      setEditMeasure(String(stepEntry.measure));
                      setEditBeat(String(stepEntry.beat));
                      setEditingPosition(true);
                    }}
                    title="Click to edit cursor position"
                  >
                    Cursor M{stepEntry.measure}:B{stepEntry.beat % 1 === 0 ? stepEntry.beat : stepEntry.beat.toFixed(2)}
                  </span>
                )}
                <span className="text-gray-500 text-[10px]">
                  {score?.staves.find(s => s.id === stepEntry.staffId)?.name || ""}
                </span>
              </>
            )}

            {/* Selected note info */}
            {selectedNote && (
              <>
                <span className="text-gray-600">|</span>
                <span className="text-blue-300 text-[10px] font-medium">
                  {selectedNote.pitch} M{selectedNote.measure}:B{selectedNote.beat}
                  {(() => {
                    const staff = score?.staves[selectedNote.staffIndex];
                    const voice = staff?.voices[0];
                    const n = voice?.notes.find(
                      n => n.measure === selectedNote.measure && Math.abs(n.beat - selectedNote.beat) < 0.05 && n.pitch === selectedNote.pitch
                    );
                    if (!n) return "";
                    return ` ${n.duration}${n.dots ? "." : ""}${n.tieStart ? " tie" : ""}${n.lyric ? ` "${n.lyric}"` : ""}`;
                  })()}
                </span>
              </>
            )}

            <span className="text-gray-600">|</span>

            {/* Selection range */}
            {selection ? (
              <span className="text-yellow-300 text-[10px]">
                Sel: M{selection.startMeasure}
                {selection.startBeat ? `:B${selection.startBeat}` : ""}
                {(selection.endMeasure !== selection.startMeasure || (selection.endBeat && selection.endBeat !== selection.startBeat))
                  ? ` \u2192 M${selection.endMeasure}${selection.endBeat ? `:B${selection.endBeat}` : ""}`
                  : ""}
                {selection.staffIds ? ` [${selection.staffIds.map(id => score.staves.find(s => s.id === id)?.name || id).join(",")}]` : ""}
              </span>
            ) : (
              <span className="text-gray-500 text-[10px]">No selection</span>
            )}

            {/* Divider */}
            <span className="text-gray-600">|</span>

            {/* Copy/Paste controls */}
            <button
              onClick={() => {
                const msg = copySelection();
                if (msg) addMessage({ id: crypto.randomUUID(), role: "assistant", content: msg, timestamp: Date.now() });
              }}
              disabled={!selection}
              className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Copy selected measures (Cmd+C)"
            >
              Copy
            </button>
            <button
              onClick={() => {
                const msg = pasteAtSelection();
                if (msg) addMessage({ id: crypto.randomUUID(), role: "assistant", content: msg, timestamp: Date.now() });
              }}
              disabled={!clipboard || !selection}
              className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Paste at selection (Cmd+V)"
            >
              Paste
            </button>
            {clipboard && (
              <span className="text-gray-500 text-[10px]">
                Clip: {clipboard.measureCount}m, {clipboard.staves.reduce((s, st) => s + st.voices.reduce((v, vo) => v + vo.notes.length, 0), 0)} notes
              </span>
            )}

            <span className="text-gray-600">|</span>

            {/* Lyric entry */}
            <button
              onClick={() => {
                if (lyricMode) {
                  setLyricMode(false);
                  setLyricHighlight(null);
                } else if (stepEntry) {
                  // Ensure lyricsMode is "attached" on the staff
                  applyPatches([{
                    op: "update_staff" as const,
                    staffId: stepEntry.staffId,
                    lyricsMode: "attached" as const,
                  }]);
                  setLyricMode(true);
                }
              }}
              disabled={!stepEntry}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                lyricMode
                  ? "bg-pink-600 text-white hover:bg-pink-700"
                  : "bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"
              }`}
              title="Enter lyric mode: type words under notes (click a note first)"
            >
              Lyric
            </button>
          </div>

          <div className="flex items-center gap-2 text-gray-500 text-[10px]">
            <span>{score?.timeSignature || "4/4"}</span>
            <span>{score?.tempo || 120}bpm</span>
            <span>{score?.measures}m</span>
          </div>
        </div>
      )}

      {/* Lyric entry bar */}
      {lyricMode && stepEntry && score && (
        <LyricEntryBar
          staffId={stepEntry.staffId}
          voiceId={stepEntry.voiceId}
          startMeasure={stepEntry.measure}
          startBeat={stepEntry.beat}
          jumpKey={lyricJumpKey}
          onClose={() => { setLyricMode(false); setLyricHighlight(null); setSelectedNote(null); }}
          onCurrentNote={(info) => {
            setLyricHighlight(info);
            if (info) {
              const staff = score.staves[info.staffIndex];
              const voice = staff?.voices.find(v => v.id === stepEntry.voiceId) || staff?.voices[0];
              const note = voice?.notes.find(n => n.measure === info.measure && Math.abs(n.beat - info.beat) < 0.01 && n.pitch !== "rest");
              setSelectedNote({ measure: info.measure, beat: info.beat, staffIndex: info.staffIndex, pitch: note?.pitch || "" });
              // Move cursor to follow the lyric navigation
              setStepEntry({ ...stepEntry, measure: info.measure, beat: info.beat, staffId: staff.id });
            } else {
              setSelectedNote(null);
            }
          }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <NoteContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          note={contextMenu.note}
          onClose={() => setContextMenu(null)}
          onLyricEdit={() => {
            if (!stepEntry) return;
            applyPatches([{
              op: "update_staff" as const,
              staffId: stepEntry.staffId,
              lyricsMode: "attached" as const,
            }]);
            setLyricMode(true);
          }}
        />
      )}
    </div>
  );
}

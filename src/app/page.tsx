"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useScoreStore } from "@/store/score-store";
import { playScore, stopPlayback, isPlaying } from "@/lib/playback";
import PromptPanel from "@/components/PromptPanel";
import PropertiesPanel from "@/components/PropertiesPanel";
import MenuBar from "@/components/MenuBar";
import MidiKeyboard from "@/components/MidiKeyboard";
import LyricEntryBar from "@/components/LyricEntryBar";
import NoteContextMenu from "@/components/NoteContextMenu";
import CommandPalette, { PaletteCommand } from "@/components/CommandPalette";
import InlineAIPrompt from "@/components/InlineAIPrompt";
import ChordChartView from "@/components/ChordChartView";
import { cleanScoreOverflow } from "@/lib/score-cleanup";

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
  const uiState = useScoreStore((s) => s.uiState);
  const setUIState = useScoreStore((s) => s.setUIState);
  const leftPanelOpen = uiState.sidebarOpen;
  const setLeftPanelOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setUIState({ sidebarOpen: typeof v === "function" ? v(uiState.sidebarOpen) : v });
  }, [setUIState, uiState.sidebarOpen]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [inlineAI, setInlineAI] = useState<{ note: { measure: number; beat: number; pitch: string; staffIndex: number }; position: { x: number; y: number } } | null>(null);
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
    pitch?: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean;
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
      if (info.pitch) {
        // Shift+click on a note — beat-level range selection
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
      } else {
        // Shift+click on empty space — measure-level range selection
        const anchorM = selection?.startMeasure ?? stepEntry?.measure ?? info.measure;
        const start = Math.min(anchorM, info.measure);
        const end = Math.max(anchorM, info.measure);
        setSelection({ startMeasure: start, endMeasure: end, staffIds: selection?.staffIds });
      }
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

    // Normal click on empty space — select the measure (for LLM/range operations)
    setSelectedNote(null);
    if (info.metaKey || info.ctrlKey) {
      // Cmd/Ctrl+click on empty space: toggle staff in/out of selection
      if (selection) {
        const allStaffIds = score.staves.map(s => s.id);
        const current = selection.staffIds || allStaffIds;
        const clickedStaffId = staff.id;
        const updated = current.includes(clickedStaffId)
          ? current.filter(id => id !== clickedStaffId)
          : [...current, clickedStaffId];
        if (updated.length === 0) {
          setSelection(null);
        } else {
          setSelection({
            ...selection,
            staffIds: updated.length === allStaffIds.length ? undefined : updated,
          });
        }
      }
    } else {
      // Plain click on empty space: select just this measure
      setSelection({
        startMeasure: info.measure,
        endMeasure: info.measure,
      });
    }
    setStepEntry({
      active: true,
      staffId: staff.id,
      voiceId: voice.id,
      measure: info.measure,
      beat: Math.max(1, info.beat),
    });
  }, [stepEntry, score, setStepEntry, selectedNote, selection, setSelection, lyricMode]);

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

      // Command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(p => !p);
        return;
      }

      // Toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        setLeftPanelOpen(p => !p);
        return;
      }

      // Select All
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        if (score) {
          setSelection({ startMeasure: 1, endMeasure: score.measures });
          setSelectedNote(null);
        }
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

      // Escape — clear selection
      if (e.key === "Escape") {
        if (selection) {
          e.preventDefault();
          setSelection(null);
          return;
        }
        if (selectedNote) {
          e.preventDefault();
          setSelectedNote(null);
          return;
        }
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
  }, [stepEntry, score, selectedNote, selection, undo, redo, setStepEntry, setSelection, applyPatches, copySelection, pasteAtSelection, addMessage, lyricMode, setLyricMode]);

  // Command palette commands
  const paletteCommands: PaletteCommand[] = useMemo(() => [
    { id: "edit.undo", label: "Undo", category: "Edit", shortcut: "Cmd+Z", action: undo, enabled: true },
    { id: "edit.redo", label: "Redo", category: "Edit", shortcut: "Cmd+Shift+Z", action: redo, enabled: true },
    { id: "edit.copy", label: "Copy Selection", category: "Edit", shortcut: "Cmd+C", action: () => copySelection(), enabled: !!selection },
    { id: "edit.paste", label: "Paste", category: "Edit", shortcut: "Cmd+V", action: () => pasteAtSelection(), enabled: !!selection },
    { id: "edit.selectAll", label: "Select All", category: "Edit", shortcut: "Cmd+A", action: () => { if (score) setSelection({ startMeasure: 1, endMeasure: score.measures }); }, enabled: !!score },
    { id: "edit.clearSelection", label: "Clear Selection", category: "Edit", shortcut: "Esc", action: () => setSelection(null), enabled: !!selection },
    { id: "view.toggleSidebar", label: "Toggle Sidebar", category: "View", shortcut: "Cmd+B", action: () => setLeftPanelOpen(p => !p) },
    { id: "view.zoomIn", label: "Zoom In", category: "View", action: () => setZoom(z => Math.min(2, z + 0.1)) },
    { id: "view.zoomOut", label: "Zoom Out", category: "View", action: () => setZoom(z => Math.max(0.5, z - 0.1)) },
    { id: "view.resetZoom", label: "Reset Zoom", category: "View", action: () => setZoom(1.0) },
    { id: "tools.lyricMode", label: lyricMode ? "Exit Lyric Mode" : "Enter Lyric Mode", category: "Tools", shortcut: "L", action: () => {
      if (lyricMode) { setLyricMode(false); setLyricHighlight(null); }
      else if (stepEntry) {
        applyPatches([{ op: "update_staff" as const, staffId: stepEntry.staffId, lyricsMode: "attached" as const }]);
        setLyricMode(true);
      }
    }, enabled: !!stepEntry || lyricMode },
    { id: "tools.cleanOverflow", label: selection ? `Clean Overflow Notes in Measures ${selection.startMeasure}-${selection.endMeasure}` : "Clean Overflow Notes (whole score)", category: "Tools", action: () => {
      if (!score) return;
      const target = selection ? Array.from({ length: selection.endMeasure - selection.startMeasure + 1 }, (_, i) => selection.startMeasure + i) : undefined;
      const { patches, removed } = cleanScoreOverflow(score, target);
      if (patches.length === 0) {
        addMessage({ id: `cleanup-${Date.now()}`, timestamp: Date.now(), role: "assistant", content: "No overflow detected — score is clean." });
        return;
      }
      applyPatches(patches);
      const lines = removed.map(r => `  • ${r.staffName} M${r.measure}: ${r.pitch}@B${r.beat} ${r.duration}${r.dots ? "." + r.dots : ""} — ${r.reason}`).join("\n");
      addMessage({ id: `cleanup-${Date.now()}`, timestamp: Date.now(), role: "assistant", content: `Removed ${removed.length} overflow note${removed.length === 1 ? "" : "s"}:\n${lines}\n\nThis is undoable (Cmd+Z).` });
    }, enabled: !!score },
    { id: "navigate.cursorRight", label: "Cursor Right", category: "Navigate", shortcut: "\u2192", action: () => {
      if (!stepEntry || !score) return;
      const [num, den] = score.timeSignature.split("/").map(Number);
      const bpm = num * (4 / den);
      let { measure, beat } = stepEntry;
      beat = Math.floor(beat) + 1;
      if (beat >= bpm + 1 - 0.001) { beat = 1; measure = Math.min(measure + 1, score.measures); }
      setStepEntry({ ...stepEntry, measure, beat: Math.round(beat * 1000) / 1000 });
    }, enabled: !!stepEntry },
    { id: "navigate.cursorLeft", label: "Cursor Left", category: "Navigate", shortcut: "\u2190", action: () => {
      if (!stepEntry || !score) return;
      const [num, den] = score.timeSignature.split("/").map(Number);
      const bpm = num * (4 / den);
      let { measure, beat } = stepEntry;
      beat = Math.ceil(beat) - 1;
      if (beat < 1) { if (measure > 1) { measure--; beat = bpm; } else beat = 1; }
      setStepEntry({ ...stepEntry, measure, beat: Math.round(beat * 1000) / 1000 });
    }, enabled: !!stepEntry },
  ], [score, selection, stepEntry, lyricMode, undo, redo, copySelection, pasteAtSelection, setSelection, setStepEntry, applyPatches, addMessage]);

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fa] print-full">
      <div className="print-hide">
        <MenuBar
          zoom={zoom}
          onZoomChange={setZoom}
          onPrint={handlePrint}
          onToggleSidebar={() => setLeftPanelOpen(p => !p)}
          sidebarOpen={leftPanelOpen}
        />
      </div>

      <div className="flex flex-1 overflow-hidden print-full">
        {/* Left sidebar: AI + Properties drawers (collapsible) */}
        <div
          className={`shrink-0 print-hide transition-all duration-300 ease-in-out overflow-hidden ${
            leftPanelOpen ? "w-80" : "w-0"
          }`}
        >
          <div className="w-80 h-full flex flex-col bg-[#1a1a2e] text-gray-200 overflow-y-auto">
            {/* Sidebar header with close button */}
            <div className="flex items-center justify-between px-4 py-2 shrink-0">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Panels</span>
              <button
                onClick={() => setLeftPanelOpen(false)}
                className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                title="Close sidebar (Cmd+B)"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
            {/* AI Chat drawer */}
            <DrawerSection title="AI Assistant" open={uiState.aiDrawerOpen} onToggle={(v) => setUIState({ aiDrawerOpen: v })} flex>
              <PromptPanel />
            </DrawerSection>

            {/* Properties drawer */}
            <DrawerSection title="Properties" open={uiState.propsDrawerOpen} onToggle={(v) => setUIState({ propsDrawerOpen: v })}>
              <PropertiesPanel embedded />
            </DrawerSection>
          </div>
        </div>

        {/* Sidebar toggle */}
        {!leftPanelOpen && (
          <button
            onClick={() => setLeftPanelOpen(true)}
            className="print-hide shrink-0 w-7 flex items-center justify-center bg-[#1a1a2e] hover:bg-[#16213e] border-r border-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
            title="Show sidebar (Cmd+B)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Center: Score View — chord chart if `sections` is populated, else notation */}
        <div className="flex-1 overflow-auto p-4 print-full bg-[#f8f9fa]">
          {score ? (
            score.sections && score.sections.length > 0 ? (
              <div className="score-container h-full">
                <ChordChartView score={score} />
              </div>
            ) : (
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
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3 print-hide">
              <div className="text-7xl opacity-20">&#119070;</div>
              <p className="text-lg font-light tracking-wide">No score yet</p>
              <p className="text-sm text-gray-400">
                Type a description in the prompt panel to generate a score
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom status bar */}
      {score && (
        <div className="print-hide flex items-center justify-between px-4 py-1.5 bg-[#0f0f23] text-white text-xs font-mono border-t border-white/10">
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

            {/* Selection range with staff toggles */}
            {selection ? (
              <div className="flex items-center gap-1.5">
                <span className="text-blue-300 text-[10px] font-medium">
                  m{selection.startMeasure}
                  {selection.endMeasure !== selection.startMeasure ? `-${selection.endMeasure}` : ""}
                  {selection.startBeat ? `:b${selection.startBeat}` : ""}
                  {selection.endBeat && selection.endBeat !== selection.startBeat ? `-b${selection.endBeat}` : ""}
                </span>
                {score.staves.length > 1 && (
                  <div className="flex items-center gap-px">
                    {score.staves.map((staff) => {
                      const active = !selection.staffIds || selection.staffIds.includes(staff.id);
                      return (
                        <button
                          key={staff.id}
                          onClick={() => {
                            const allIds = score.staves.map(s => s.id);
                            const current = selection.staffIds || allIds;
                            const updated = active
                              ? current.filter(id => id !== staff.id)
                              : [...current, staff.id];
                            if (updated.length === 0) return;
                            setSelection({
                              ...selection,
                              staffIds: updated.length === allIds.length ? undefined : updated,
                            });
                          }}
                          className={`px-1 py-0 text-[9px] rounded transition-colors ${
                            active
                              ? "bg-blue-600 text-white"
                              : "bg-gray-700 text-gray-500"
                          }`}
                          title={`${active ? "Exclude" : "Include"} ${staff.name}`}
                        >
                          {staff.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button
                  onClick={() => setSelection(null)}
                  className="px-1 py-0 text-[9px] text-gray-400 hover:text-white transition-colors"
                  title="Clear selection (Escape)"
                >
                  Clear
                </button>
              </div>
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

            {/* MIDI keyboard */}
            <MidiKeyboard />

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
          onAIEdit={(n, pos) => setInlineAI({ note: n, position: pos })}
        />
      )}

      {/* Inline AI prompt (from right-click → Edit with AI) */}
      {inlineAI && (
        <InlineAIPrompt
          note={inlineAI.note}
          position={inlineAI.position}
          onClose={() => setInlineAI(null)}
        />
      )}

      {/* Command palette */}
      <CommandPalette
        commands={paletteCommands}
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
}

/** Collapsible drawer section for the sidebar.
 * `flex` mode: when open, fills remaining vertical space (for the chat panel).
 * Supports controlled (`open`/`onToggle`) or uncontrolled (`defaultOpen`) modes. */
function DrawerSection({ title, open: controlledOpen, onToggle, defaultOpen = false, flex = false, children }: {
  title: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  defaultOpen?: boolean;
  flex?: boolean;
  children: React.ReactNode;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : localOpen;
  const toggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setLocalOpen(next);
  };
  return (
    <div className={`border-t border-gray-700/50 ${flex && isOpen ? "flex-1 min-h-0 flex flex-col" : ""}`}>
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors shrink-0"
      >
        <span>{title}</span>
        <svg
          className={`w-3 h-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {flex ? (
        <div className={`transition-all duration-200 ease-in-out overflow-hidden ${isOpen ? "flex-1 min-h-0 flex flex-col" : "h-0"}`}>
          {children}
        </div>
      ) : (
        <div className={`transition-all duration-200 ease-in-out overflow-hidden ${isOpen ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 10rem)" }}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

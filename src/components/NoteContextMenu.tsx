"use client";

import { useEffect, useRef } from "react";
import { useScoreStore } from "@/store/score-store";
import { NoteDuration } from "@/lib/schema";

interface NoteContextMenuProps {
  x: number;
  y: number;
  note: { measure: number; beat: number; pitch: string; staffIndex: number };
  onClose: () => void;
  onLyricEdit: () => void;
  onAIEdit?: (note: { measure: number; beat: number; pitch: string; staffIndex: number }, position: { x: number; y: number }) => void;
}

const DURATIONS: { label: string; value: NoteDuration }[] = [
  { label: "Whole", value: "whole" },
  { label: "Half", value: "half" },
  { label: "Quarter", value: "quarter" },
  { label: "Eighth", value: "eighth" },
  { label: "16th", value: "sixteenth" },
];

export default function NoteContextMenu({ x, y, note, onClose, onLyricEdit, onAIEdit }: NoteContextMenuProps) {
  const { score, applyPatches } = useScoreStore();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  if (!score) return null;

  const staff = score.staves[note.staffIndex];
  if (!staff) return null;
  const voice = staff.voices[0];
  if (!voice) return null;

  // Find the actual note in our data
  const scoreNote = voice.notes.find(
    n => n.measure === note.measure && Math.abs(n.beat - note.beat) < 0.05 && n.pitch === note.pitch
  );

  const doAction = (action: () => void) => {
    action();
    onClose();
  };

  const changeDuration = (dur: NoteDuration) => {
    doAction(() => {
      applyPatches([{
        op: "update_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
        updates: { duration: dur },
      }]);
    });
  };

  const toggleDot = () => {
    if (!scoreNote) return;
    doAction(() => {
      applyPatches([{
        op: "update_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
        updates: { dots: scoreNote.dots ? 0 : 1 },
      }]);
    });
  };

  const toggleTie = () => {
    if (!scoreNote) return;
    doAction(() => {
      applyPatches([{
        op: "update_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
        updates: { tieStart: !scoreNote.tieStart },
      }]);
    });
  };

  const setAccidental = (acc: "sharp" | "flat" | "natural" | "none") => {
    doAction(() => {
      applyPatches([{
        op: "update_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
        updates: { accidental: acc },
      }]);
    });
  };

  const deleteNote = () => {
    doAction(() => {
      applyPatches([{
        op: "remove_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
      }]);
    });
  };

  const addArticulation = (art: string) => {
    if (!scoreNote) return;
    const existing = scoreNote.articulations || [];
    const arts = existing.includes(art as any)
      ? existing.filter(a => a !== art)
      : [...existing, art as any];
    doAction(() => {
      applyPatches([{
        op: "update_note",
        staffId: staff.id,
        voiceId: voice.id,
        measure: note.measure,
        beat: note.beat,
        pitch: note.pitch,
        updates: { articulations: arts },
      }]);
    });
  };

  // Position: keep menu within viewport
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 1000,
  };

  return (
    <div ref={menuRef} style={menuStyle} className="bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[180px] text-sm">
      {/* Note info header */}
      <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-100">
        {note.pitch} &middot; M{note.measure} B{note.beat} &middot; {scoreNote?.duration || "?"}
        {scoreNote?.dots ? ` (dotted)` : ""}
      </div>

      {/* Duration */}
      <div className="px-1 py-1 border-b border-gray-100">
        <div className="px-2 py-0.5 text-[10px] text-gray-400 uppercase">Duration</div>
        <div className="flex gap-0.5 px-2">
          {DURATIONS.map(d => (
            <button
              key={d.value}
              onClick={() => changeDuration(d.value)}
              className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
                scoreNote?.duration === d.value
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "hover:bg-gray-100 text-gray-600"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick actions */}
      <button onClick={toggleDot} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex justify-between">
        <span>{scoreNote?.dots ? "Remove Dot" : "Add Dot"}</span>
        <span className="text-gray-400 text-xs">.</span>
      </button>
      <button onClick={toggleTie} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex justify-between">
        <span>{scoreNote?.tieStart ? "Remove Tie" : "Add Tie"}</span>
      </button>

      {/* Accidentals */}
      <div className="border-t border-gray-100 px-1 py-1">
        <div className="px-2 py-0.5 text-[10px] text-gray-400 uppercase">Accidental</div>
        <div className="flex gap-0.5 px-2">
          {([["none", "♮"], ["sharp", "♯"], ["flat", "♭"]] as const).map(([acc, sym]) => (
            <button
              key={acc}
              onClick={() => setAccidental(acc)}
              className={`px-2 py-0.5 text-sm rounded transition-colors ${
                scoreNote?.accidental === acc
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "hover:bg-gray-100 text-gray-600"
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Articulations */}
      <div className="border-t border-gray-100 px-1 py-1">
        <div className="px-2 py-0.5 text-[10px] text-gray-400 uppercase">Articulation</div>
        <div className="flex flex-wrap gap-0.5 px-2">
          {([
            ["accent", ">"],
            ["staccato", "·"],
            ["tenuto", "—"],
            ["fermata", "𝄐"],
          ] as const).map(([art, sym]) => (
            <button
              key={art}
              onClick={() => addArticulation(art)}
              className={`px-2 py-0.5 text-sm rounded transition-colors ${
                scoreNote?.articulations?.includes(art as any)
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "hover:bg-gray-100 text-gray-600"
              }`}
              title={art}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Lyric */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => { onClose(); onLyricEdit(); }}
          className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex justify-between"
        >
          <span>{scoreNote?.lyric ? `Edit Lyric "${scoreNote.lyric}"` : "Add Lyric"}</span>
          <span className="text-gray-400 text-xs">L</span>
        </button>
      </div>

      {/* Edit with AI */}
      {onAIEdit && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => { onClose(); onAIEdit(note, { x, y }); }}
            className="w-full text-left px-3 py-1.5 hover:bg-purple-50 text-purple-700 flex justify-between"
          >
            <span>Edit with AI...</span>
          </button>
        </div>
      )}

      {/* Delete */}
      <div className="border-t border-gray-100">
        <button
          onClick={deleteNote}
          className="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-600 flex justify-between"
        >
          <span>Delete Note</span>
          <span className="text-red-400 text-xs">Del</span>
        </button>
      </div>
    </div>
  );
}

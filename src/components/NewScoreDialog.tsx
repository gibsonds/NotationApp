"use client";

import { useState } from "react";
import { useScoreStore } from "@/store/score-store";
import { Score } from "@/lib/schema";
import { v4 as uuidv4 } from "uuid";

interface StaffConfig {
  name: string;
  clef: "treble" | "bass" | "alto" | "tenor";
}

const PRESETS: Record<string, { staves: StaffConfig[]; tempo: number; timeSignature: string; measures: number }> = {
  "Lead Sheet": { staves: [{ name: "Lead", clef: "treble" }], tempo: 120, timeSignature: "4/4", measures: 32 },
  "Piano": { staves: [{ name: "Right Hand", clef: "treble" }, { name: "Left Hand", clef: "bass" }], tempo: 120, timeSignature: "4/4", measures: 16 },
  "SATB": { staves: [{ name: "Soprano", clef: "treble" }, { name: "Alto", clef: "treble" }, { name: "Tenor", clef: "treble" }, { name: "Bass", clef: "bass" }], tempo: 100, timeSignature: "4/4", measures: 16 },
};

export default function NewScoreDialog({ onClose }: { onClose: () => void }) {
  const { setScore, addMessage } = useScoreStore();
  const [title, setTitle] = useState("Untitled Score");
  const [tempo, setTempo] = useState(120);
  const [timeSignature, setTimeSignature] = useState("4/4");
  const [keySignature, setKeySignature] = useState("C");
  const [measures, setMeasures] = useState(16);
  const [staves, setStaves] = useState<StaffConfig[]>([{ name: "Staff 1", clef: "treble" }]);

  const applyPreset = (name: string) => {
    const p = PRESETS[name];
    if (!p) return;
    setStaves([...p.staves]);
    setTempo(p.tempo);
    setTimeSignature(p.timeSignature);
    setMeasures(p.measures);
  };

  const addStaff = () => {
    setStaves([...staves, { name: `Staff ${staves.length + 1}`, clef: "treble" }]);
  };

  const removeStaff = (i: number) => {
    if (staves.length <= 1) return;
    setStaves(staves.filter((_, idx) => idx !== i));
  };

  const updateStaff = (i: number, update: Partial<StaffConfig>) => {
    setStaves(staves.map((s, idx) => idx === i ? { ...s, ...update } : s));
  };

  const create = () => {
    const score: Score = {
      id: uuidv4(),
      title,
      composer: "",
      tempo,
      timeSignature,
      keySignature: keySignature as Score["keySignature"],
      measures,
      staves: staves.map((s, i) => ({
        id: `staff_${i + 1}`,
        name: s.name,
        clef: s.clef,
        lyricsMode: "attached" as const,
        voices: [{
          id: `staff_${i + 1}_voice_1`,
          role: "general" as const,
          notes: [],
        }],
      })),
      chordSymbols: [],
      rehearsalMarks: [],
      repeats: [],
      metadata: {},
    };
    setScore(score);
    addMessage({
      id: uuidv4(),
      role: "assistant",
      content: `Created "${title}" — ${staves.length} staff${staves.length > 1 ? "s" : ""}, ${measures} measures, ${timeSignature} at ${tempo} BPM.`,
      timestamp: Date.now(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-[420px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-800">New Score</h2>
        </div>

        <div className="p-4 space-y-3">
          {/* Presets */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Presets</label>
            <div className="flex gap-1">
              {Object.keys(PRESETS).map(name => (
                <button key={name} onClick={() => applyPreset(name)}
                  className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors">
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1">Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>

          {/* Row: Tempo, Time Sig, Key, Measures */}
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">BPM</label>
              <input type="number" value={tempo} onChange={e => setTempo(Number(e.target.value))}
                min={20} max={300}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Time</label>
              <select value={timeSignature} onChange={e => setTimeSignature(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option>2/4</option><option>3/4</option><option>4/4</option><option>5/4</option>
                <option>6/4</option><option>6/8</option><option>7/8</option><option>12/8</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Key</label>
              <select value={keySignature} onChange={e => setKeySignature(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
                {["C","G","D","A","E","B","F#","Gb","Db","Ab","Eb","Bb","F","Am","Em","Bm","F#m","C#m","Dm","Gm","Cm","Fm"].map(k =>
                  <option key={k}>{k}</option>
                )}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Bars</label>
              <input type="number" value={measures} onChange={e => setMeasures(Number(e.target.value))}
                min={1} max={200}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
          </div>

          {/* Staves */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500">Staves</label>
              <button onClick={addStaff} className="text-xs text-blue-600 hover:text-blue-800">+ Add Staff</button>
            </div>
            <div className="space-y-1.5">
              {staves.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="text" value={s.name} onChange={e => updateStaff(i, { name: e.target.value })}
                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  <select value={s.clef} onChange={e => updateStaff(i, { clef: e.target.value as StaffConfig["clef"] })}
                    className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="treble">Treble</option>
                    <option value="bass">Bass</option>
                    <option value="alto">Alto</option>
                    <option value="tenor">Tenor</option>
                  </select>
                  {staves.length > 1 && (
                    <button onClick={() => removeStaff(i)} className="text-red-400 hover:text-red-600 text-sm px-1">x</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
          <button onClick={create} className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded">Create</button>
        </div>
      </div>
    </div>
  );
}

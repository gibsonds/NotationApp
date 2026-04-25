"use client";

import { useState } from "react";
import { useScoreStore, DEFAULT_LAYOUT, PRINT_LAYOUT, REALBOOK_LAYOUT, STYLE_PRESETS, StylePreset, LayoutSettings, MusicFont, TextFont, PageSize } from "@/store/score-store";
import { KeySignature, Clef } from "@/lib/schema";
import { v4 as uuidv4 } from "uuid";
import RevisionPanel from "./RevisionPanel";

interface PropertiesPanelProps {
  embedded?: boolean;
}

export default function PropertiesPanel({ embedded = false }: PropertiesPanelProps) {
  const { score, applyPatches, warnings, layout, setLayout } = useScoreStore();

  if (!score) {
    if (embedded) return <div className="px-4 py-3 text-xs text-gray-500">No score loaded</div>;
    return (
      <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200">
        <div className="px-4 py-3 border-b border-gray-200 bg-white">
          <h2 className="font-semibold text-gray-800 text-sm">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-4 text-center">
          Generate a score to see properties
        </div>
      </div>
    );
  }

  // Dark embedded mode (inside sidebar drawer)
  if (embedded) {
    return (
      <div className="pb-2">
        {/* Score Properties */}
        <PropSection title="Score" defaultOpen>
          <div className="space-y-1.5">
            <DarkField label="Title" value={score.title} onChange={(v) => applyPatches([{ op: "set_title", value: v }])} />
            <DarkField label="Tempo" value={String(score.tempo)} type="number" onChange={(v) => applyPatches([{ op: "set_tempo", value: parseInt(v, 10) || 120 }])} />
            <DarkSelect label="Key" value={score.keySignature} options={["C","G","D","A","E","B","F","Bb","Eb","Ab","Db","Am","Em","Bm","Dm","Gm","Cm","Fm"]}
              onChange={(v) => applyPatches([{ op: "set_key_signature", value: v as KeySignature }])} />
            <DarkField label="Time" value={score.timeSignature} onChange={(v) => applyPatches([{ op: "set_time_signature", value: v }])} />
            <DarkField label="Measures" value={String(score.measures)} type="number" onChange={(v) => applyPatches([{ op: "set_measures", value: parseInt(v, 10) || 8 }])} />
          </div>
        </PropSection>

        {/* Staves */}
        <PropSection title={`Staves (${score.staves.length})`} defaultOpen={false}
          action={<button onClick={() => applyPatches([{ op: "add_staff", staff: { id: uuidv4(), name: `Staff ${score.staves.length + 1}`, clef: "treble", lyricsMode: "none", voices: [{ id: uuidv4(), role: "general", notes: [] }] } }])}
            className="text-[10px] text-blue-400 hover:text-blue-300 font-medium">+ Add</button>}>
          <div className="space-y-2">
            {score.staves.map(staff => (
              <div key={staff.id} className="bg-white/5 rounded-lg p-2.5 space-y-1.5 border border-white/10">
                <DarkField label="Name" value={staff.name} onChange={(v) => applyPatches([{ op: "update_staff", staffId: staff.id, name: v }])} />
                <DarkSelect label="Clef" value={staff.clef} options={["treble","bass","alto","tenor"]}
                  onChange={(v) => applyPatches([{ op: "update_staff", staffId: staff.id, clef: v as Clef }])} />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">{staff.voices.length}v, {staff.voices.reduce((n, v) => n + v.notes.length, 0)} notes</span>
                  {score.staves.length > 1 && (
                    <button onClick={() => applyPatches([{ op: "remove_staff", staffId: staff.id }])} className="text-[10px] text-red-400/60 hover:text-red-400">Remove</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </PropSection>

        {/* Style & Layout */}
        <PropSection title="Style" defaultOpen>
          <div className="flex gap-1 mb-3">
            {(Object.entries(STYLE_PRESETS) as [StylePreset, { label: string; layout: LayoutSettings }][]).map(([key, preset]) => {
              const isActive = layout.musicFont === preset.layout.musicFont && layout.textFont === preset.layout.textFont;
              return (
                <button key={key} onClick={() => setLayout(preset.layout)}
                  className={`px-2.5 py-1 text-[10px] font-medium rounded-lg transition-colors ${
                    isActive ? "bg-blue-500/30 text-blue-300 ring-1 ring-blue-500/40" : "bg-white/10 text-gray-300 hover:bg-white/15"
                  }`}>
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1 mb-2">
            <button onClick={() => setLayout({ compactMode: !layout.compactMode })}
              className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${layout.compactMode ? "bg-blue-500/30 text-blue-300" : "bg-white/10 text-gray-300 hover:bg-white/15"}`}>Compact</button>
          </div>
          <div className="space-y-1">
            <DarkRange label="Note size" value={layout.noteSize} min={0.5} max={1.2} step={0.05} onChange={(v) => setLayout({ noteSize: v })} />
            <DarkRange label="Meas/line" value={layout.measuresPerSystem} min={0} max={8} step={1} onChange={(v) => setLayout({ measuresPerSystem: v })} />
            <DarkRange label="Sys gap" value={layout.systemSpacing} min={1} max={15} step={0.5} onChange={(v) => setLayout({ systemSpacing: v })} />
            <DarkRange label="Margins" value={layout.pageLeftMargin} min={0} max={20} step={1} onChange={(v) => setLayout({ pageLeftMargin: v, pageRightMargin: v })} />
            <DarkSelect label="Notes" value={layout.musicFont} options={["bravura","petaluma","gonville"]}
              onChange={(v) => setLayout({ musicFont: v as MusicFont })} />
            <DarkSelect label="Text" value={layout.textFont} options={["georgia","palatino","garamond","times","helvetica","noto","handwritten"]}
              onChange={(v) => setLayout({ textFont: v as TextFont })} />
          </div>
        </PropSection>

        {/* Warnings */}
        {warnings.length > 0 && (
          <PropSection title="Warnings" defaultOpen>
            <div className="bg-amber-500/10 rounded-lg p-2 text-[10px] text-amber-300 space-y-0.5 border border-amber-500/20">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          </PropSection>
        )}

        {/* Revisions */}
        <PropSection title="Revisions" defaultOpen={false}>
          <RevisionPanel />
        </PropSection>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 border-l border-gray-200 overflow-y-auto">
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="font-semibold text-gray-800 text-sm">Properties</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Score Properties */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Score
          </h3>
          <div className="space-y-2">
            <Field
              label="Title"
              value={score.title}
              onChange={(v) =>
                applyPatches([{ op: "set_title", value: v }])
              }
            />
            <Field
              label="Tempo"
              value={String(score.tempo)}
              type="number"
              onChange={(v) =>
                applyPatches([{ op: "set_tempo", value: parseInt(v, 10) || 120 }])
              }
            />
            <SelectField
              label="Key"
              value={score.keySignature}
              options={[
                "C", "G", "D", "A", "E", "B", "F", "Bb", "Eb", "Ab", "Db",
                "Am", "Em", "Bm", "Dm", "Gm", "Cm", "Fm",
              ]}
              onChange={(v) =>
                applyPatches([
                  { op: "set_key_signature", value: v as KeySignature },
                ])
              }
            />
            <Field
              label="Time Sig"
              value={score.timeSignature}
              onChange={(v) =>
                applyPatches([{ op: "set_time_signature", value: v }])
              }
            />
            <Field
              label="Measures"
              value={String(score.measures)}
              type="number"
              onChange={(v) =>
                applyPatches([
                  { op: "set_measures", value: parseInt(v, 10) || 8 },
                ])
              }
            />
          </div>
        </section>

        {/* Staves */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Staves
            </h3>
            <button
              onClick={() => {
                const id = uuidv4();
                applyPatches([{
                  op: "add_staff",
                  staff: {
                    id,
                    name: `Staff ${score.staves.length + 1}`,
                    clef: "treble",
                    lyricsMode: "none",
                    voices: [{ id: uuidv4(), role: "general", notes: [] }],
                  },
                }]);
              }}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              + Add Staff
            </button>
          </div>
          <div className="space-y-3">
            {score.staves.map((staff) => (
              <div
                key={staff.id}
                className="bg-white rounded-lg border border-gray-200 p-3 space-y-2"
              >
                <Field
                  label="Name"
                  value={staff.name}
                  onChange={(v) =>
                    applyPatches([
                      { op: "update_staff", staffId: staff.id, name: v },
                    ])
                  }
                />
                <SelectField
                  label="Clef"
                  value={staff.clef}
                  options={["treble", "bass", "alto", "tenor"]}
                  onChange={(v) =>
                    applyPatches([
                      {
                        op: "update_staff",
                        staffId: staff.id,
                        clef: v as Clef,
                      },
                    ])
                  }
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {staff.voices.length} voice(s) &middot;{" "}
                    {staff.voices.reduce((n, v) => n + v.notes.length, 0)} notes
                  </span>
                  {score.staves.length > 1 && (
                    <button
                      onClick={() => applyPatches([{ op: "remove_staff", staffId: staff.id }])}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Chord Symbols */}
        {score.chordSymbols.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Chord Symbols
            </h3>
            <div className="bg-white rounded-lg border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
              {score.chordSymbols.map((c, i) => (
                <div key={i}>
                  m{c.measure} beat {c.beat}: <strong>{c.symbol}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">
              Warnings
            </h3>
            <div className="bg-amber-50 rounded-lg border border-amber-200 p-3 text-xs text-amber-700 space-y-1">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Style & Layout */}
      <div className="p-4 border-t border-gray-200">
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Style
          </h3>
          <div className="flex gap-1 mb-3">
            {(Object.entries(STYLE_PRESETS) as [StylePreset, { label: string; layout: LayoutSettings }][]).map(([key, preset]) => {
              const isActive = layout.musicFont === preset.layout.musicFont && layout.textFont === preset.layout.textFont;
              return (
                <button key={key} onClick={() => setLayout(preset.layout)}
                  className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                    isActive ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}>
                  {preset.label}
                </button>
              );
            })}
          </div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Layout
          </h3>
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setLayout({ compactMode: !layout.compactMode })}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                layout.compactMode
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Compact
            </button>
          </div>
          <div className="space-y-1.5">
            <RangeField
              label="Title size"
              value={layout.titleSize}
              min={0.5}
              max={5}
              step={0.1}
              onChange={(v) => setLayout({ titleSize: v })}
            />
            <RangeField
              label="Top margin"
              value={layout.pageTopMargin}
              min={0}
              max={20}
              step={1}
              onChange={(v) => setLayout({ pageTopMargin: v })}
            />
            <RangeField
              label="Side margins"
              value={layout.pageLeftMargin}
              min={0}
              max={20}
              step={1}
              onChange={(v) =>
                setLayout({ pageLeftMargin: v, pageRightMargin: v })
              }
            />
            <RangeField
              label="System gap"
              value={layout.systemSpacing}
              min={1}
              max={15}
              step={0.5}
              onChange={(v) => setLayout({ systemSpacing: v })}
            />
            <RangeField
              label="Note size"
              value={layout.noteSize}
              min={0.5}
              max={1.2}
              step={0.05}
              onChange={(v) => setLayout({ noteSize: v })}
            />
            <RangeField
              label="Meas/line"
              value={layout.measuresPerSystem}
              min={0}
              max={8}
              step={1}
              onChange={(v) => setLayout({ measuresPerSystem: v })}
            />
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Notes</label>
              <select
                value={layout.musicFont}
                onChange={(e) => setLayout({ musicFont: e.target.value as MusicFont })}
                className="flex-1 px-1 py-0.5 text-[10px] border border-gray-200 rounded bg-white text-gray-800"
              >
                <option value="bravura">Bravura (classic)</option>
                <option value="petaluma">Petaluma (handwritten)</option>
                <option value="gonville">Gonville (screen)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Text</label>
              <select
                value={layout.textFont}
                onChange={(e) => setLayout({ textFont: e.target.value as TextFont })}
                className="flex-1 px-1 py-0.5 text-[10px] border border-gray-200 rounded bg-white text-gray-800"
              >
                <option value="georgia">Georgia</option>
                <option value="palatino">Palatino</option>
                <option value="garamond">Garamond</option>
                <option value="times">Times New Roman</option>
                <option value="helvetica">Helvetica</option>
                <option value="noto">Noto Serif</option>
                <option value="handwritten">Handwritten</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Page breaks</label>
              <input
                type="checkbox"
                checked={layout.pageBreaks}
                onChange={(e) => setLayout({ pageBreaks: e.target.checked })}
                className="accent-blue-500"
              />
              <span className="text-[10px] text-gray-400">
                {layout.pageBreaks
                  ? layout.pageSize === "a4" ? "A4 pages" : "Letter pages"
                  : "Endless scroll"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Page size</label>
              <select
                value={layout.pageSize}
                onChange={(e) => setLayout({ pageSize: e.target.value as PageSize })}
                className="flex-1 px-1 py-0.5 text-[10px] border border-gray-200 rounded bg-white text-gray-800"
              >
                <option value="letter">US Letter (8.5 &times; 11&quot;)</option>
                <option value="a4">A4 (210 &times; 297mm)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Page #s</label>
              <input
                type="checkbox"
                checked={layout.printPageNumbers}
                onChange={(e) => setLayout({ printPageNumbers: e.target.checked })}
                className="accent-blue-500"
              />
              <span className="text-[10px] text-gray-400">
                {layout.printPageNumbers ? "Shown in print" : "Hidden"}
              </span>
            </div>
            <Field
              label="Header"
              value={layout.printHeader}
              onChange={(v) => setLayout({ printHeader: v })}
            />
            <Field
              label="Footer"
              value={layout.printFooter}
              onChange={(v) => setLayout({ printFooter: v })}
            />
          </div>
        </section>
      </div>

      {/* Revisions — anchored at bottom */}
      <div className="mt-auto">
        <RevisionPanel />
      </div>
    </div>
  );
}

// ── Reusable field components ──────────────────────────────────────────────

function Field({
  label,
  value,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 w-16 shrink-0">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-800"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500 w-16 shrink-0">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white text-gray-800"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-gray-500 w-16 shrink-0">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-blue-500"
      />
      <span className="text-[10px] text-gray-400 w-6 text-right">
        {value}
      </span>
    </div>
  );
}

// ── Dark-themed field components (for embedded/sidebar mode) ─────────────

function DarkField({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-gray-500 w-14 shrink-0">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500/50" />
    </div>
  );
}

function DarkSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-gray-500 w-14 shrink-0">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-2 py-1 text-[11px] bg-white/5 border border-white/10 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function DarkRange({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[10px] text-gray-500 w-14 shrink-0">{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-blue-400" />
      <span className="text-[10px] text-gray-500 w-6 text-right">{value}</span>
    </div>
  );
}

function PropSection({ title, defaultOpen = true, action, children }: {
  title: string; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5">
      <div
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors cursor-pointer"
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
      >
        <svg className={`w-2.5 h-2.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="flex-1 text-left">{title}</span>
        {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
      </div>
      <div className={`overflow-hidden transition-all duration-150 ${open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="px-4 pb-3">
          {children}
        </div>
      </div>
    </div>
  );
}

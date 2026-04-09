"use client";

import { useScoreStore, DEFAULT_LAYOUT, PRINT_LAYOUT, LayoutSettings } from "@/store/score-store";
import { KeySignature, Clef } from "@/lib/schema";
import RevisionPanel from "./RevisionPanel";

export default function PropertiesPanel() {
  const { score, applyPatches, warnings, layout, setLayout } = useScoreStore();

  if (!score) {
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
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Staves
          </h3>
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
                <div className="text-xs text-gray-400">
                  {staff.voices.length} voice(s) &middot;{" "}
                  {staff.voices.reduce((n, v) => n + v.notes.length, 0)} notes
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

      {/* Layout */}
      <div className="p-4 border-t border-gray-200">
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Layout
          </h3>
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setLayout(DEFAULT_LAYOUT)}
              className="px-2 py-1 text-[10px] font-medium bg-gray-100 hover:bg-gray-200 rounded transition-colors text-gray-700"
            >
              Default
            </button>
            <button
              onClick={() => setLayout(PRINT_LAYOUT)}
              className="px-2 py-1 text-[10px] font-medium bg-gray-100 hover:bg-gray-200 rounded transition-colors text-gray-700"
            >
              Print
            </button>
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
              <label className="text-[10px] text-gray-500 w-16 shrink-0">Page breaks</label>
              <input
                type="checkbox"
                checked={layout.pageBreaks}
                onChange={(e) => setLayout({ pageBreaks: e.target.checked })}
                className="accent-blue-500"
              />
              <span className="text-[10px] text-gray-400">
                {layout.pageBreaks ? "Letter pages" : "Endless scroll"}
              </span>
            </div>
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

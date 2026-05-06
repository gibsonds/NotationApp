"use client";

import { useScoreStore } from "@/store/score-store";

interface ArticulationsPaletteProps {
  selectedNote: { measure: number; beat: number; staffIndex: number; pitch: string } | null;
}

/** Always-visible palette of articulations + dynamics + accidentals, rendered
 *  above the score in notation mode. Click a button to apply (or remove) the
 *  marking on the currently-selected note. When nothing is selected the
 *  palette shows in a disabled state with a hint. */
export default function ArticulationsPalette({ selectedNote }: ArticulationsPaletteProps) {
  const { score, applyPatches } = useScoreStore();

  const target = (() => {
    if (!score || !selectedNote) return null;
    const staff = score.staves[selectedNote.staffIndex];
    if (!staff) return null;
    const voice = staff.voices[0];
    if (!voice) return null;
    const note = voice.notes.find(
      (n) =>
        n.measure === selectedNote.measure &&
        Math.abs(n.beat - selectedNote.beat) < 0.05 &&
        n.pitch === selectedNote.pitch,
    );
    if (!note) return null;
    return { staff, voice, note };
  })();

  const enabled = !!target;

  const toggleArticulation = (art: string) => {
    if (!target) return;
    const existing = target.note.articulations || [];
    const arts = existing.includes(art as never)
      ? existing.filter((a) => a !== art)
      : [...existing, art as never];
    applyPatches([
      {
        op: "update_note",
        staffId: target.staff.id,
        voiceId: target.voice.id,
        measure: selectedNote!.measure,
        beat: selectedNote!.beat,
        pitch: selectedNote!.pitch,
        updates: { articulations: arts },
      },
    ]);
  };

  const setDynamic = (dyn: string | undefined) => {
    if (!target) return;
    applyPatches([
      {
        op: "update_note",
        staffId: target.staff.id,
        voiceId: target.voice.id,
        measure: selectedNote!.measure,
        beat: selectedNote!.beat,
        pitch: selectedNote!.pitch,
        updates: { dynamic: dyn as never },
      },
    ]);
  };

  const setAccidental = (acc: "none" | "sharp" | "flat" | "natural") => {
    if (!target) return;
    applyPatches([
      {
        op: "update_note",
        staffId: target.staff.id,
        voiceId: target.voice.id,
        measure: selectedNote!.measure,
        beat: selectedNote!.beat,
        pitch: selectedNote!.pitch,
        updates: { accidental: acc },
      },
    ]);
  };

  const ARTS: { art: string; sym: string; title: string }[] = [
    { art: "accent",          sym: ">",  title: "Accent" },
    { art: "strong-accent",   sym: "^",  title: "Strong accent (marcato)" },
    { art: "staccato",        sym: "·",  title: "Staccato" },
    { art: "staccatissimo",   sym: "'",  title: "Staccatissimo" },
    { art: "tenuto",          sym: "—",  title: "Tenuto" },
    { art: "detached-legato", sym: "—·", title: "Detached legato" },
    { art: "fermata",         sym: "𝄐",  title: "Fermata" },
  ];

  const DYNS = ["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff"] as const;
  const ACCS: { acc: "none" | "sharp" | "flat" | "natural"; sym: string }[] = [
    { acc: "none",    sym: "♮" },
    { acc: "sharp",   sym: "♯" },
    { acc: "flat",    sym: "♭" },
  ];

  const activeArts = target?.note.articulations || [];
  const activeDyn = target?.note.dynamic;
  const activeAcc = target?.note.accidental || "none";

  const btnBase = "px-1.5 py-0.5 text-[11px] rounded transition-colors";
  const btnIdle = "bg-white/5 hover:bg-white/15 text-gray-300";
  const btnActive = "bg-blue-500/30 text-blue-200 ring-1 ring-blue-400/40";
  const btnDisabled = "opacity-40 cursor-not-allowed";

  return (
    <div className="print-hide flex items-center gap-3 px-3 py-1 bg-[#0f0f23] border-b border-white/10 text-xs">
      {/* Articulations */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">Artic</span>
        {ARTS.map((a) => {
          const on = activeArts.includes(a.art as never);
          return (
            <button
              key={a.art}
              onClick={() => toggleArticulation(a.art)}
              disabled={!enabled}
              title={a.title}
              className={`${btnBase} ${!enabled ? btnDisabled : on ? btnActive : btnIdle}`}
            >
              {a.sym}
            </button>
          );
        })}
      </div>

      {/* Accidentals */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">Acc</span>
        {ACCS.map((a) => {
          const on = activeAcc === a.acc;
          return (
            <button
              key={a.acc}
              onClick={() => setAccidental(a.acc)}
              disabled={!enabled}
              title={a.acc}
              className={`${btnBase} text-base ${!enabled ? btnDisabled : on ? btnActive : btnIdle}`}
            >
              {a.sym}
            </button>
          );
        })}
      </div>

      {/* Dynamics */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 mr-1">Dyn</span>
        {DYNS.map((d) => {
          const on = activeDyn === d;
          return (
            <button
              key={d}
              onClick={() => setDynamic(on ? undefined : d)}
              disabled={!enabled}
              title={d}
              className={`${btnBase} italic ${!enabled ? btnDisabled : on ? btnActive : btnIdle}`}
            >
              {d}
            </button>
          );
        })}
      </div>

      {!enabled && (
        <span className="text-[10px] text-gray-500 italic ml-auto">
          Select a note to apply
        </span>
      )}
    </div>
  );
}

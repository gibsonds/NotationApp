"use client";

import { Score, ChordChartSection } from "@/lib/schema";

interface ChordChartViewProps {
  score: Score;
}

interface SectionBlockProps {
  section: ChordChartSection;
}

/**
 * Render a section as a sequence of paired chord/lyric lines in monospace.
 * Column N of the chord line visually sits above column N of the lyric line —
 * that's how the user (or AI) places a chord change above a specific syllable.
 *
 * Empty chord line = lyric-only row (just lyrics, no chords specified yet).
 * Empty lyric line = chord-only row (e.g. an instrumental vamp pattern).
 */
function SectionBlock({ section }: SectionBlockProps) {
  return (
    <section className="mb-6">
      <h3 className="text-pink-300 uppercase tracking-widest text-xs font-bold mb-2">
        {section.label}
      </h3>
      <div className="font-mono text-sm leading-tight whitespace-pre">
        {section.lines.map((line, i) => (
          <div key={i} className="mb-2">
            {line.chords ? (
              <div className="text-yellow-300 whitespace-pre">{line.chords}</div>
            ) : null}
            {line.lyrics ? (
              <div className="text-gray-100 whitespace-pre">{line.lyrics}</div>
            ) : null}
            {/* Render an empty spacer for completely-blank lines so structure is preserved. */}
            {!line.chords && !line.lyrics ? <div>&nbsp;</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ChordChartView({ score }: ChordChartViewProps) {
  const sectionMap = new Map(score.sections.map(s => [s.id, s]));

  // Section order to display: form sequence if present (deduplicated — show
  // each unique section once even if form repeats it), otherwise sections in
  // their declared order.
  let displayOrder: ChordChartSection[];
  if (score.form && score.form.length > 0) {
    const seen = new Set<string>();
    displayOrder = [];
    for (const id of score.form) {
      if (seen.has(id)) continue;
      const sec = sectionMap.get(id);
      if (!sec) continue;
      seen.add(id);
      displayOrder.push(sec);
    }
    // Append any sections that exist but never appear in form — useful for
    // "I have a verse and a chorus but haven't decided the form yet".
    for (const sec of score.sections) {
      if (!seen.has(sec.id)) displayOrder.push(sec);
    }
  } else {
    displayOrder = score.sections;
  }

  // Build a human-readable form string by collapsing consecutive repeats:
  // ["V","V","V","C","C"] → "V×3 C×2".
  const formDisplay = (() => {
    if (!score.form || score.form.length === 0) return null;
    const groups: { id: string; n: number }[] = [];
    for (const id of score.form) {
      const last = groups[groups.length - 1];
      if (last && last.id === id) last.n += 1;
      else groups.push({ id, n: 1 });
    }
    return groups.map(g => (g.n > 1 ? `${g.id}×${g.n}` : g.id)).join(" ");
  })();

  return (
    <div className="w-full h-full overflow-auto bg-[#0f0f1f] text-gray-100 p-8 font-sans">
      <header className="mb-6 pb-4 border-b border-gray-700">
        <h1 className="text-3xl font-bold text-white">{score.title || "Untitled"}</h1>
        {score.composer && (
          <p className="text-gray-400 mt-1">{score.composer}</p>
        )}
        <div className="text-sm text-gray-500 mt-2 flex gap-4 flex-wrap">
          <span>{score.timeSignature}</span>
          <span>{score.tempo} bpm</span>
          <span>Key of {score.keySignature}</span>
          {formDisplay && <span>Form: {formDisplay}</span>}
        </div>
      </header>

      {displayOrder.length === 0 ? (
        <p className="text-gray-500 italic">
          No chord chart yet. Try asking the AI:
          {" "}
          <code className="bg-gray-900 px-2 py-0.5 rounded text-pink-300 mx-1">
            paste lyrics — no notation, just lyrics for verse 1: ...
          </code>
          {" "}then{" "}
          <code className="bg-gray-900 px-2 py-0.5 rounded text-pink-300 mx-1">
            add chords D, G, D, A above the verse
          </code>
        </p>
      ) : (
        displayOrder.map(section => (
          <SectionBlock key={section.id} section={section} />
        ))
      )}
    </div>
  );
}

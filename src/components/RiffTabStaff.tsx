"use client";

// ── Tab staff for a riff ────────────────────────────────────────────────────
//
// A deliberately small, self-contained SVG renderer rather than a second OSMD
// instance. OSMD writes document-global DOM ids (`osmdCanvasPage1`) and reads
// them back with getElementById, and VexFlow 1.2.93 bakes a module-global font
// scale into notes at construction — so a second instance at a different note
// size corrupts the first. A peek card is by definition a second instance.
//
// It also keeps the markup outside `.score-container`, which matters: the print
// rule `.score-container svg { width: 100% !important }` would stretch a
// snippet across the page, and the SVG-export handlers grab the FIRST
// `.score-container svg` in the document.
//
// Tab is the easy case — no accidentals, no ledger lines, no key signature —
// so this stays comfortably small.

import { useMemo } from "react";
import { beatsPerBarOf } from "@/lib/riff-ascii";
import type { Riff, RiffEvent } from "@/lib/schema";

interface RiffTabStaffProps {
  riff: Riff;
  /** Vertical gap between strings, px. Drives overall scale. */
  stringGap?: number;
  /** Show the tuning letters down the left edge. */
  showTuning?: boolean;
  className?: string;
}

const PAD_X = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 26; // room for stems below the staff
const MIN_BAR_WIDTH = 110;
const LABEL_W = 18;

/** Stem length and flag count by duration. Rests get no stem. */
const FLAGS: Record<string, number> = {
  eighth: 1,
  sixteenth: 2,
  "thirty-second": 3,
  "sixty-fourth": 4,
};

export default function RiffTabStaff({
  riff,
  stringGap = 15,
  showTuning = true,
  className,
}: RiffTabStaffProps) {
  const layout = useMemo(() => {
    const stringCount = Math.max(
      riff.tuning.length || 6,
      ...riff.bars.flatMap((b) => b.events.flatMap((e) => e.notes.map((n) => n.string))),
      1,
    );
    const beatsPerBar = beatsPerBarOf(riff.timeSignature);
    const bars = riff.bars.length || 1;

    // Wider bars when a bar is busy, so fret numbers don't collide.
    const busiest = Math.max(1, ...riff.bars.map((b) => b.events.length));
    const barWidth = Math.max(MIN_BAR_WIDTH, busiest * 26);

    const left = PAD_X + (showTuning ? LABEL_W : 0);
    const width = left + bars * barWidth + PAD_X;
    const staffHeight = (stringCount - 1) * stringGap;
    const height = PAD_TOP + staffHeight + PAD_BOTTOM;

    const yOf = (stringNo: number) => PAD_TOP + (stringNo - 1) * stringGap;
    const xOf = (barIdx: number, beat: number) => {
      const frac = Math.min(1, Math.max(0, (beat - 1) / beatsPerBar));
      // Inset so a downbeat doesn't sit exactly on the barline.
      return left + barIdx * barWidth + 12 + frac * (barWidth - 20);
    };

    return { stringCount, bars, barWidth, left, width, height, staffHeight, yOf, xOf };
  }, [riff, stringGap, showTuning]);

  const { stringCount, bars, barWidth, left, width, height, staffHeight, yOf, xOf } = layout;

  const isRest = (e: RiffEvent) => e.notes.length === 0;

  return (
    <svg
      // Explicit width/height + a viewBox: the print stylesheet stretches any
      // `.score-container svg` to full width, and this must not be caught by it.
      className={`riff-svg ${className ?? ""}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: "100%", height: "auto", fontFamily: "ui-monospace, monospace" }}
      role="img"
      aria-label={`Tab for ${riff.label}`}
    >
      {/* String lines */}
      {Array.from({ length: stringCount }, (_, i) => (
        <line
          key={`s${i}`}
          x1={left}
          y1={yOf(i + 1)}
          x2={left + bars * barWidth}
          y2={yOf(i + 1)}
          stroke="currentColor"
          strokeOpacity={0.45}
          strokeWidth={1}
        />
      ))}

      {/* Tuning letters (octave dropped — tab labels never carry one) */}
      {showTuning &&
        riff.tuning.slice(0, stringCount).map((t, i) => (
          <text
            key={`t${i}`}
            x={PAD_X}
            y={yOf(i + 1) + 3.5}
            fontSize={9}
            fill="currentColor"
            fillOpacity={0.55}
          >
            {t.replace(/-?\d+$/, "")}
          </text>
        ))}

      {/* Barlines, including the closing one */}
      {Array.from({ length: bars + 1 }, (_, i) => (
        <line
          key={`b${i}`}
          x1={left + i * barWidth}
          y1={yOf(1)}
          x2={left + i * barWidth}
          y2={yOf(stringCount)}
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={i === 0 || i === bars ? 1.6 : 1}
        />
      ))}

      {/* Events */}
      {riff.bars.map((bar, barIdx) =>
        bar.events.map((ev, evIdx) => {
          const x = xOf(barIdx, ev.beat);
          const key = `e${barIdx}-${evIdx}`;
          if (isRest(ev)) {
            // Drawn, not typed: the Unicode rest glyphs (𝄽 and friends) are
            // absent from the monospace stacks this renders in and come out as
            // tofu. A small bar on the middle string reads fine at this size.
            const midY = yOf(Math.ceil(stringCount / 2));
            return (
              <rect
                key={key}
                x={x - 3}
                y={midY - 1.5}
                width={6}
                height={3}
                rx={0.5}
                fill="currentColor"
                fillOpacity={0.45}
              />
            );
          }
          const stemTop = yOf(stringCount) + 4;
          const stemBottom = stemTop + 12;
          const flags = FLAGS[ev.duration] ?? 0;
          return (
            <g key={key}>
              {ev.notes.map((n, ni) => {
                const y = yOf(n.string);
                const label = String(n.fret);
                // Halo: knock the string line out behind the number so the
                // digit stays legible where the line would cross it.
                return (
                  <g key={ni}>
                    <rect
                      x={x - (label.length * 3.4 + 1.5)}
                      y={y - 5.5}
                      width={label.length * 6.8 + 3}
                      height={11}
                      fill="var(--riff-bg, #ffffff)"
                    />
                    <text
                      x={x}
                      y={y + 3.5}
                      fontSize={10.5}
                      textAnchor="middle"
                      fill="currentColor"
                      fontWeight={600}
                    >
                      {label}
                    </text>
                  </g>
                );
              })}
              {/* Rhythm: a stem under the staff, with flags for shorter values.
                  Enough to read the shape of the riff without pretending to be
                  full engraving. */}
              <line
                x1={x}
                y1={stemTop}
                x2={x}
                y2={stemBottom}
                stroke="currentColor"
                strokeOpacity={0.6}
                strokeWidth={1}
              />
              {Array.from({ length: flags }, (_, fi) => (
                <line
                  key={`f${fi}`}
                  x1={x}
                  y1={stemBottom - fi * 3.5}
                  x2={x + 5}
                  y2={stemBottom - 2.5 - fi * 3.5}
                  stroke="currentColor"
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />
              ))}
            </g>
          );
        }),
      )}

      {/* Nothing to draw yet — say so rather than showing an empty grid. */}
      {riff.bars.every((b) => b.events.length === 0) && (
        <text
          x={left + 12}
          y={PAD_TOP + staffHeight / 2 + 3.5}
          fontSize={10}
          fill="currentColor"
          fillOpacity={0.5}
        >
          No notes yet
        </text>
      )}
    </svg>
  );
}

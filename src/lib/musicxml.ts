import { Score, Note, Clef, KeySignature, ChordSymbol, Articulation } from "./schema";

// ── Key signature fifths map ───────────────────────────────────────────────

const KEY_FIFTHS: Record<string, number> = {
  C: 0,  Am: 0,
  G: 1,  Em: 1,
  D: 2,  Bm: 2,
  A: 3,  "F#m": 3,
  E: 4,  "C#m": 4,
  B: 5,  "G#m": 5,
  "F#": 6, "D#m": 6,
  F: -1, Dm: -1,
  Bb: -2, Gm: -2,
  Eb: -3, Cm: -3,
  Ab: -4, Fm: -4,
  Db: -5, Bbm: -5,
  Gb: -6, Ebm: -6,
};

const DURATION_DIVISIONS: Record<string, number> = {
  whole: 64,
  half: 32,
  quarter: 16,
  eighth: 8,
  sixteenth: 4,
  "thirty-second": 2,
  "sixty-fourth": 1,
};

const DURATION_TYPE: Record<string, string> = {
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  sixteenth: "16th",
  "thirty-second": "32nd",
  "sixty-fourth": "64th",
};

// ── Clef mapping ───────────────────────────────────────────────────────────

function clefToMusicXML(clef: Clef): { sign: string; line: number } {
  switch (clef) {
    case "treble":
      return { sign: "G", line: 2 };
    case "bass":
      return { sign: "F", line: 4 };
    case "alto":
      return { sign: "C", line: 3 };
    case "tenor":
      return { sign: "C", line: 4 };
  }
}

// ── Pitch parsing ──────────────────────────────────────────────────────────

function parsePitch(pitch: string): {
  step: string;
  alter: number;
  octave: number;
} | null {
  if (pitch.toLowerCase() === "rest") return null;

  const match = pitch.match(/^([A-Ga-g])([#b]?)(\d+)$/);
  if (!match) return null;

  const step = match[1].toUpperCase();
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = parseInt(match[3], 10);

  return { step, alter, octave };
}

// ── XML escaping ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Build chord symbol lookup ──────────────────────────────────────────────

function buildChordLookup(
  chords: ChordSymbol[]
): Map<string, ChordSymbol> {
  const map = new Map<string, ChordSymbol>();
  for (const c of chords) {
    map.set(`${c.measure}:${c.beat}`, c);
  }
  return map;
}

// Parse a note name (e.g. "C", "F#", "Bb") returning step, alter, and chars consumed
function parseNoteName(s: string, offset: number): { step: string; alter: number; length: number } | null {
  if (offset >= s.length) return null;
  const step = s[offset]?.toUpperCase();
  if (!/[A-G]/.test(step)) return null;
  let alter = 0;
  let length = 1;
  const next = s[offset + 1];
  if (next === "#" || next === "♯") { alter = 1; length++; }
  else if (next === "b" || next === "♭") { alter = -1; length++; }
  return { step, alter, length };
}

// Parse chord symbol string into root, kind, bass, and display text
function parseChordSymbol(symbol: string): {
  rootStep: string;
  rootAlter: number;
  kind: string;
  kindText: string;
  bassStep?: string;
  bassAlter?: number;
} {
  let s = symbol.trim();

  // Split on slash for bass note (e.g. "C/E", "Am7/G")
  let bassStep: string | undefined;
  let bassAlter: number | undefined;
  const slashIdx = s.indexOf("/");
  let bassPart = "";
  if (slashIdx > 0) {
    bassPart = s.slice(slashIdx + 1);
    s = s.slice(0, slashIdx);
    const bass = parseNoteName(bassPart, 0);
    if (bass) {
      bassStep = bass.step;
      bassAlter = bass.alter;
    }
  }

  const root = parseNoteName(s, 0);
  if (!root) return { rootStep: "C", rootAlter: 0, kind: "major", kindText: "" };

  const remainder = s.slice(root.length);

  // Order matters: longer/more-specific prefixes first
  let kind = "major";
  let kindText = "";

  if (/^maj9/i.test(remainder))       { kind = "major-ninth"; kindText = remainder; }
  else if (/^maj7/i.test(remainder))  { kind = "major-seventh"; kindText = remainder; }
  else if (/^maj/i.test(remainder) && remainder.length === 3)  { kind = "major"; kindText = remainder; }
  else if (/^m7b5/i.test(remainder))  { kind = "half-diminished"; kindText = remainder; }
  else if (/^m9/i.test(remainder))    { kind = "minor-ninth"; kindText = remainder; }
  else if (/^m7/i.test(remainder) || /^min7/i.test(remainder))  { kind = "minor-seventh"; kindText = remainder; }
  else if (/^m6/i.test(remainder) || /^min6/i.test(remainder))  { kind = "minor-sixth"; kindText = remainder; }
  else if (/^m\b/i.test(remainder) || /^min/i.test(remainder) || remainder === "m") { kind = "minor"; kindText = remainder; }
  else if (/^dim7/i.test(remainder))  { kind = "diminished-seventh"; kindText = remainder; }
  else if (/^dim/i.test(remainder) || remainder === "°") { kind = "diminished"; kindText = remainder; }
  else if (/^aug7/i.test(remainder))  { kind = "augmented-seventh"; kindText = remainder; }
  else if (/^aug/i.test(remainder) || remainder === "+") { kind = "augmented"; kindText = remainder; }
  else if (/^13/i.test(remainder))    { kind = "dominant-13th"; kindText = remainder; }
  else if (/^11/i.test(remainder))    { kind = "dominant-11th"; kindText = remainder; }
  else if (/^9/i.test(remainder))     { kind = "dominant-ninth"; kindText = remainder; }
  else if (/^7sus4/i.test(remainder)) { kind = "suspended-fourth"; kindText = remainder; }
  else if (/^7/i.test(remainder))     { kind = "dominant"; kindText = remainder; }
  else if (/^6\/9/i.test(remainder) || /^6add9/i.test(remainder)) { kind = "major-sixth"; kindText = remainder; }
  else if (/^6/i.test(remainder))     { kind = "major-sixth"; kindText = remainder; }
  else if (/^sus4/i.test(remainder))  { kind = "suspended-fourth"; kindText = remainder; }
  else if (/^sus2/i.test(remainder))  { kind = "suspended-second"; kindText = remainder; }
  else if (/^add9/i.test(remainder))  { kind = "major"; kindText = remainder; }
  else if (remainder.length > 0)      { kindText = remainder; }

  return { rootStep: root.step, rootAlter: root.alter, kind, kindText, bassStep, bassAlter };
}

// ── Main MusicXML Generator ────────────────────────────────────────────────

export function scoreToMusicXML(score: Score): string {
  const lines: string[] = [];
  const divisions = 16; // quarter note = 16 divisions (supports 64th notes)

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">'
  );
  lines.push('<score-partwise version="4.0">');

  // Work / identification
  if (score.title) {
    lines.push("  <work>");
    lines.push(`    <work-title>${esc(score.title)}</work-title>`);
    lines.push("  </work>");
  }
  if (score.composer) {
    lines.push("  <identification>");
    lines.push(`    <creator type="composer">${esc(score.composer)}</creator>`);
    lines.push("  </identification>");
  }

  // Part list
  lines.push("  <part-list>");
  for (const staff of score.staves) {
    lines.push(`    <score-part id="${esc(staff.id)}">`);
    lines.push(
      `      <part-name>${esc(staff.name)}</part-name>`
    );
    lines.push("    </score-part>");
  }
  lines.push("  </part-list>");

  // Time signature parsing
  const [beatsStr, beatTypeStr] = score.timeSignature.split("/");
  const beats = parseInt(beatsStr, 10);
  const beatType = parseInt(beatTypeStr, 10);

  // Key
  const fifths = KEY_FIFTHS[score.keySignature] ?? 0;
  const mode = score.keySignature.endsWith("m") ? "minor" : "major";

  // Chord lookup
  const chordLookup = buildChordLookup(score.chordSymbols);

  // Measure duration in divisions
  const measureDivisions = beats * (64 / beatType);

  // Parts
  for (let si = 0; si < score.staves.length; si++) {
    const staff = score.staves[si];
    const clef = clefToMusicXML(staff.clef);
    const isFirstPart = si === 0;

    lines.push(`  <part id="${esc(staff.id)}">`);

    // Group notes by voice and measure for multi-voice support
    const voiceNotesByMeasure: { voiceNum: number; notesByMeasure: Record<number, Note[]> }[] = [];
    for (let vi = 0; vi < staff.voices.length; vi++) {
      const voice = staff.voices[vi];
      const byMeasure: Record<number, Note[]> = {};
      for (const note of voice.notes) {
        if (!byMeasure[note.measure]) byMeasure[note.measure] = [];
        byMeasure[note.measure].push(note);
      }
      voiceNotesByMeasure.push({ voiceNum: vi + 1, notesByMeasure: byMeasure });
    }
    const hasMultipleVoices = staff.voices.length > 1;

    // Flat view for single-voice backward compat
    const notesByMeasure: Record<number, Note[]> = {};
    for (const voice of staff.voices) {
      for (const note of voice.notes) {
        if (!notesByMeasure[note.measure]) notesByMeasure[note.measure] = [];
        notesByMeasure[note.measure].push(note);
      }
    }

    for (let m = 1; m <= score.measures; m++) {
      lines.push(`    <measure number="${m}">`);

      // Attributes on first measure
      if (m === 1) {
        lines.push("      <attributes>");
        lines.push(`        <divisions>${divisions}</divisions>`);
        lines.push("        <key>");
        lines.push(`          <fifths>${fifths}</fifths>`);
        lines.push(`          <mode>${mode}</mode>`);
        lines.push("        </key>");
        lines.push("        <time>");
        lines.push(`          <beats>${beats}</beats>`);
        lines.push(`          <beat-type>${beatType}</beat-type>`);
        lines.push("        </time>");
        lines.push("        <clef>");
        lines.push(`          <sign>${clef.sign}</sign>`);
        lines.push(`          <line>${clef.line}</line>`);
        lines.push("        </clef>");
        lines.push("      </attributes>");

        // Tempo direction on first part, first measure
        if (isFirstPart && score.tempo) {
          lines.push("      <direction placement=\"above\">");
          lines.push("        <direction-type>");
          lines.push(
            `          <metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome>`
          );
          lines.push("        </direction-type>");
          lines.push("        <sound tempo=\"" + score.tempo + "\"/>");
          lines.push("      </direction>");
        }
      }

      // Chord symbols (only on first part typically, but we attach to first)
      if (isFirstPart) {
        // Find all chords for this measure
        for (let b = 1; b <= beats; b++) {
          const chord = chordLookup.get(`${m}:${b}`);
          if (chord) {
            const parsed = parseChordSymbol(chord.symbol);
            lines.push("      <harmony>");
            lines.push("        <root>");
            lines.push(
              `          <root-step>${parsed.rootStep}</root-step>`
            );
            if (parsed.rootAlter !== 0) {
              lines.push(
                `          <root-alter>${parsed.rootAlter}</root-alter>`
              );
            }
            lines.push("        </root>");
            lines.push(
              `        <kind text="${esc(parsed.kindText)}">${parsed.kind}</kind>`
            );
            if (parsed.bassStep) {
              lines.push("        <bass>");
              lines.push(`          <bass-step>${parsed.bassStep}</bass-step>`);
              if (parsed.bassAlter && parsed.bassAlter !== 0) {
                lines.push(`          <bass-alter>${parsed.bassAlter}</bass-alter>`);
              }
              lines.push("        </bass>");
            }
            lines.push("      </harmony>");
          }
        }
      }

      if (hasMultipleVoices) {
        // Multi-voice: render each voice separately with <backup> between them
        for (let vIdx = 0; vIdx < voiceNotesByMeasure.length; vIdx++) {
          const { voiceNum, notesByMeasure: vByMeasure } = voiceNotesByMeasure[vIdx];
          const vNotes = vByMeasure[m];

          if (vIdx > 0) {
            // <backup> rewinds the cursor to the start of the measure
            const mDur = beats * (64 / beatType);
            lines.push("      <backup>");
            lines.push(`        <duration>${mDur}</duration>`);
            lines.push("      </backup>");
          }

          if (vNotes && vNotes.length > 0) {
            emitVoiceNotes(lines, vNotes, voiceNum, staff.lyricsMode, beats);
          } else {
            // Voice has no notes in this measure — write a whole-measure rest
            const wholeDur = beats * (64 / beatType);
            lines.push("      <note>");
            lines.push('        <rest measure="yes"/>');
            lines.push(`        <duration>${wholeDur}</duration>`);
            lines.push(`        <voice>${voiceNum}</voice>`);
            lines.push("      </note>");
          }
        }
      } else {
        // Single voice: original path (no <voice> tags needed for compatibility)
        const notes = notesByMeasure[m];
        if (notes && notes.length > 0) {
          emitVoiceNotes(lines, notes, undefined, staff.lyricsMode, beats);
        } else {
          // Empty measure — write a whole rest
          const wholeDur = beats * (64 / beatType);
          lines.push("      <note>");
          lines.push('        <rest measure="yes"/>');
          lines.push(`        <duration>${wholeDur}</duration>`);
          lines.push("      </note>");
        }
      }

      lines.push("    </measure>");
    }

    lines.push("  </part>");
  }

  lines.push("</score-partwise>");
  return lines.join("\n");
}

// ── Emit notes for one voice in a measure ─────────────────────────────────

function emitVoiceNotes(
  lines: string[],
  notes: Note[],
  voiceNum: number | undefined,
  lyricsMode: string,
  beatsPerMeasure: number = 4,
) {
  // Sort by beat; within same beat, lyric-bearing note first, then by pitch
  notes.sort((a, b) => {
    const beatDiff = a.beat - b.beat;
    if (Math.abs(beatDiff) > 0.01) return beatDiff;
    if (a.lyric && !b.lyric) return -1;
    if (!a.lyric && b.lyric) return 1;
    return a.pitch.localeCompare(b.pitch);
  });

  // Pre-compute beam groups
  const beamable = new Set(["eighth", "sixteenth", "thirty-second", "sixty-fourth"]);
  type BeamInfo = { start: number; end: number };
  const beamGroups: BeamInfo[] = [];
  let beamStart = -1;

  for (let ni = 0; ni < notes.length; ni++) {
    const note = notes[ni];
    const isChordNote = ni > 0 && Math.abs(note.beat - notes[ni - 1].beat) < 0.01 && note.pitch !== "rest";
    if (isChordNote) continue;

    const isBeamable = beamable.has(note.duration) && note.pitch !== "rest";
    if (isBeamable) {
      if (beamStart === -1) beamStart = ni;
    }
    if (!isBeamable || ni === notes.length - 1 || isLastRhythmicInBeat(notes, ni, beamable)) {
      if (beamStart !== -1) {
        let rhythmicCount = 0;
        for (let k = beamStart; k <= (isBeamable ? ni : ni - 1); k++) {
          const isChord = k > 0 && Math.abs(notes[k].beat - notes[k - 1].beat) < 0.01 && notes[k].pitch !== "rest";
          if (!isChord) rhythmicCount++;
        }
        if (rhythmicCount >= 2) {
          beamGroups.push({ start: beamStart, end: isBeamable ? ni : ni - 1 });
        }
        beamStart = -1;
      }
      if (isBeamable && !isLastRhythmicInBeat(notes, ni, beamable)) {
        beamStart = ni;
      }
    }
  }

  // Build beam status map
  const beamStatus = new Map<number, "begin" | "continue" | "end">();
  for (const group of beamGroups) {
    let rhythmicIdx = 0;
    let lastRhythmicCount = 0;
    for (let k = group.start; k <= group.end; k++) {
      const isChord = k > 0 && Math.abs(notes[k].beat - notes[k - 1].beat) < 0.01 && notes[k].pitch !== "rest";
      if (!isChord) lastRhythmicCount++;
    }
    for (let k = group.start; k <= group.end; k++) {
      const isChord = k > 0 && Math.abs(notes[k].beat - notes[k - 1].beat) < 0.01 && notes[k].pitch !== "rest";
      if (isChord) continue;
      rhythmicIdx++;
      if (rhythmicIdx === 1) beamStatus.set(k, "begin");
      else if (rhythmicIdx === lastRhythmicCount) beamStatus.set(k, "end");
      else beamStatus.set(k, "continue");
    }
  }

  // Apply manual beam overrides
  for (let ni = 0; ni < notes.length; ni++) {
    if (notes[ni].beam) {
      if (notes[ni].beam === "none") beamStatus.delete(ni);
      else beamStatus.set(ni, notes[ni].beam as "begin" | "continue" | "end");
    }
  }

  // Track position and fill gaps with rests to ensure measure totals are correct
  let currentBeat = 1; // 1-indexed beat position
  let prevBeat = -1;
  for (let ni = 0; ni < notes.length; ni++) {
    const note = notes[ni];
    const parsed = parsePitch(note.pitch);
    const dur = DURATION_DIVISIONS[note.duration] ?? 4;
    const isChordNote = Math.abs(note.beat - prevBeat) < 0.01 && note.pitch !== "rest";

    // Fill gap before this note with rests (skip for chord notes)
    if (!isChordNote && note.beat > currentBeat + 0.01) {
      emitGapRests(lines, currentBeat, note.beat, voiceNum);
    }

    lines.push("      <note>");
    if (isChordNote) lines.push("        <chord/>");

    if (parsed) {
      lines.push("        <pitch>");
      lines.push(`          <step>${parsed.step}</step>`);
      if (parsed.alter !== 0) lines.push(`          <alter>${parsed.alter}</alter>`);
      lines.push(`          <octave>${parsed.octave}</octave>`);
      lines.push("        </pitch>");
    } else {
      lines.push("        <rest/>");
    }
    lines.push(`        <duration>${dur}</duration>`);
    if (voiceNum !== undefined) lines.push(`        <voice>${voiceNum}</voice>`);
    lines.push(`        <type>${DURATION_TYPE[note.duration] ?? "quarter"}</type>`);

    if (note.dots > 0) {
      for (let d = 0; d < note.dots; d++) lines.push("        <dot/>");
    }

    // Tuplet time-modification
    if (note.tuplet) {
      lines.push("        <time-modification>");
      lines.push(`          <actual-notes>${note.tuplet.actualNotes}</actual-notes>`);
      lines.push(`          <normal-notes>${note.tuplet.normalNotes}</normal-notes>`);
      lines.push("        </time-modification>");
    }

    if (note.tieStart) lines.push('        <tie type="start"/>');
    if (note.tieEnd) lines.push('        <tie type="stop"/>');

    // Beam
    const beam = beamStatus.get(ni);
    if (beam && !isChordNote) lines.push(`        <beam number="1">${beam}</beam>`);

    // Notations
    const hasArticulations = note.articulations && note.articulations.length > 0;
    const hasFermata = note.articulations?.includes("fermata");
    const nonFermataArticulations = note.articulations?.filter((a: Articulation) => a !== "fermata") ?? [];
    const hasTupletStart = note.tuplet && isTupletStart(notes, ni);
    const hasTupletStop = note.tuplet && isTupletEnd(notes, ni);
    if (note.tieStart || note.tieEnd || hasArticulations || hasTupletStart || hasTupletStop) {
      lines.push("        <notations>");
      if (note.tieEnd) lines.push('          <tied type="stop"/>');
      if (note.tieStart) lines.push('          <tied type="start"/>');
      if (hasTupletStart) lines.push('          <tuplet type="start"/>');
      if (hasTupletStop) lines.push('          <tuplet type="stop"/>');
      if (nonFermataArticulations.length > 0) {
        lines.push("          <articulations>");
        for (const art of nonFermataArticulations) lines.push(`            <${art}/>`);
        lines.push("          </articulations>");
      }
      if (hasFermata) lines.push('          <fermata type="upright"/>');
      lines.push("        </notations>");
    }

    // Lyrics
    if (note.lyric && lyricsMode === "attached" && !isChordNote) {
      lines.push("        <lyric>");
      lines.push(`          <text>${esc(note.lyric)}</text>`);
      lines.push("        </lyric>");
    }

    lines.push("      </note>");

    // Advance currentBeat past this note (skip for chord notes — they don't advance time)
    if (!isChordNote) {
      let noteDurBeats = (DURATION_DIVISIONS[note.duration] ?? 16) / 16; // divisions to beats
      if (note.dots > 0) noteDurBeats *= 1.5;
      if (note.tuplet) noteDurBeats *= note.tuplet.normalNotes / note.tuplet.actualNotes;
      currentBeat = note.beat + noteDurBeats;
    }
    prevBeat = note.beat;
  }

  // Fill trailing gap to end of measure with rests
  const measureEnd = 1 + beatsPerMeasure;
  if (currentBeat < measureEnd - 0.01) {
    emitGapRests(lines, currentBeat, measureEnd, voiceNum);
  }
}

/**
 * Emit rests to fill a gap from `fromBeat` to `toBeat`.
 * Uses the largest fitting durations to minimize rest count.
 */
function emitGapRests(lines: string[], fromBeat: number, toBeat: number, voiceNum: number | undefined) {
  const GAP_DURS: { beats: number; dur: string; type: string }[] = [
    { beats: 4, dur: "64", type: "whole" },
    { beats: 2, dur: "32", type: "half" },
    { beats: 1, dur: "16", type: "quarter" },
    { beats: 0.5, dur: "8", type: "eighth" },
    { beats: 0.25, dur: "4", type: "16th" },
    { beats: 0.125, dur: "2", type: "32nd" },
    { beats: 0.0625, dur: "1", type: "64th" },
  ];

  let pos = fromBeat;
  while (pos < toBeat - 0.001) {
    const gap = toBeat - pos;
    // Find largest duration that fits
    let chosen = GAP_DURS[GAP_DURS.length - 1];
    for (const d of GAP_DURS) {
      if (d.beats <= gap + 0.001) { chosen = d; break; }
    }
    lines.push("      <note>");
    lines.push("        <rest/>");
    lines.push(`        <duration>${chosen.dur}</duration>`);
    if (voiceNum !== undefined) lines.push(`        <voice>${voiceNum}</voice>`);
    lines.push(`        <type>${chosen.type}</type>`);
    lines.push("      </note>");
    pos += chosen.beats;
  }
}

// Check if the next rhythmic (non-chord) note crosses a beam-group boundary.
// In common time signatures, beams group within half-bar units:
// 4/4: beats 1-2 and 3-4; 3/4: each beat; 6/8: beats 1-3 and 4-6
function isLastRhythmicInBeat(notes: Note[], ni: number, beamable: Set<string>): boolean {
  const currentBeat = notes[ni].beat;
  // Beam group boundary at every 2 beats (half-bar in 4/4)
  const beamGroup = Math.floor((currentBeat - 1) / 2);

  for (let k = ni + 1; k < notes.length; k++) {
    const isChord = k > 0 && Math.abs(notes[k].beat - notes[k - 1].beat) < 0.01 && notes[k].pitch !== "rest";
    if (isChord) continue;

    if (!beamable.has(notes[k].duration) || notes[k].pitch === "rest") return true;
    // Break beam at half-bar boundaries
    const nextBeamGroup = Math.floor((notes[k].beat - 1) / 2);
    if (nextBeamGroup !== beamGroup) return true;
    return false;
  }
  return true;
}

/** Is this note the first in a tuplet group? */
function isTupletStart(notes: Note[], ni: number): boolean {
  if (!notes[ni].tuplet) return false;
  if (ni === 0) return true;
  // Previous non-chord note doesn't have the same tuplet
  for (let k = ni - 1; k >= 0; k--) {
    if (Math.abs(notes[k].beat - notes[ni].beat) < 0.01) continue; // chord
    const kTup = notes[k].tuplet;
    const niTup = notes[ni].tuplet!;
    return !kTup ||
      kTup.actualNotes !== niTup.actualNotes ||
      kTup.normalNotes !== niTup.normalNotes;
  }
  return true;
}

/** Is this note the last in a tuplet group? */
function isTupletEnd(notes: Note[], ni: number): boolean {
  if (!notes[ni].tuplet) return false;
  if (ni === notes.length - 1) return true;
  for (let k = ni + 1; k < notes.length; k++) {
    if (Math.abs(notes[k].beat - notes[ni].beat) < 0.01) continue; // chord
    const kTup = notes[k].tuplet;
    const niTup = notes[ni].tuplet!;
    return !kTup ||
      kTup.actualNotes !== niTup.actualNotes ||
      kTup.normalNotes !== niTup.normalNotes;
  }
  return true;
}

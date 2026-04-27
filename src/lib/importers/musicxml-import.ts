import { Score, Note, Staff, Voice, ChordSymbol } from "../schema";
import { v4 as uuidv4 } from "uuid";

// ── MusicXML Importer ──────────────────────────────────────────────────────
// Parses MusicXML (partwise format) into our canonical Score model.

const FIFTHS_TO_KEY: Record<number, string> = {
  "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab",
  "-3": "Eb", "-2": "Bb", "-1": "F",
  0: "C",
  1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
};

const TYPE_TO_DURATION: Record<string, string> = {
  whole: "whole",
  half: "half",
  quarter: "quarter",
  eighth: "eighth",
  "16th": "sixteenth",
};

export function parseMusicXML(xmlString: string): Score {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("Invalid MusicXML: " + parserError.textContent);
  }

  // Title
  const title =
    getText(doc, "work-title") ||
    getText(doc, "movement-title") ||
    "Imported Score";
  const composer = getText(doc, 'creator[type="composer"]') || "";

  // Parts
  const partElements = doc.querySelectorAll("score-partwise > part");
  const partListItems = doc.querySelectorAll("score-part");

  let tempo = 120;
  let timeSignature = "4/4";
  let keySignature = "C";
  let maxMeasure = 0;

  const staves: Staff[] = [];
  const chordSymbols: ChordSymbol[] = [];

  partElements.forEach((partEl, pi) => {
    const partId = partEl.getAttribute("id") || `part_${pi + 1}`;
    const partListEl = Array.from(partListItems).find(
      (el) => el.getAttribute("id") === partId
    );
    const partName = partListEl
      ? getText(partListEl, "part-name") || `Part ${pi + 1}`
      : `Part ${pi + 1}`;

    let clef: "treble" | "bass" | "alto" | "tenor" = "treble";
    const notes: Note[] = [];
    const measures = partEl.querySelectorAll("measure");

    let divisions = 1;

    measures.forEach((measureEl) => {
      const measureNum = parseInt(measureEl.getAttribute("number") || "1", 10);
      if (measureNum > maxMeasure) maxMeasure = measureNum;

      // Attributes
      const attrEl = measureEl.querySelector("attributes");
      if (attrEl) {
        const divEl = attrEl.querySelector("divisions");
        if (divEl) divisions = parseInt(divEl.textContent || "1", 10);

        const fifthsEl = attrEl.querySelector("key > fifths");
        if (fifthsEl && pi === 0) {
          const fifths = parseInt(fifthsEl.textContent || "0", 10);
          const mode = getText(attrEl, "key > mode") || "major";
          keySignature = FIFTHS_TO_KEY[fifths] || "C";
          if (mode === "minor") keySignature += "m";
        }

        const beatsEl = attrEl.querySelector("time > beats");
        const beatTypeEl = attrEl.querySelector("time > beat-type");
        if (beatsEl && beatTypeEl && pi === 0) {
          timeSignature = `${beatsEl.textContent}/${beatTypeEl.textContent}`;
        }

        const signEl = attrEl.querySelector("clef > sign");
        if (signEl) {
          const sign = signEl.textContent || "G";
          if (sign === "G") clef = "treble";
          else if (sign === "F") clef = "bass";
          else if (sign === "C") clef = "alto";
        }
      }

      // Tempo from direction
      const soundEl = measureEl.querySelector("direction sound[tempo]");
      if (soundEl && pi === 0) {
        tempo = parseInt(soundEl.getAttribute("tempo") || "120", 10);
      }

      // Harmony (chord symbols)
      measureEl.querySelectorAll("harmony").forEach((harmEl) => {
        const rootStep = getText(harmEl, "root > root-step") || "C";
        const rootAlter = getText(harmEl, "root > root-alter");
        const kind = getText(harmEl, "kind") || "major";

        let symbol = rootStep;
        if (rootAlter === "1") symbol += "#";
        else if (rootAlter === "-1") symbol += "b";

        // Convert kind to common symbols
        if (kind === "minor") symbol += "m";
        else if (kind === "dominant") symbol += "7";
        else if (kind === "major-seventh") symbol += "maj7";
        else if (kind === "minor-seventh") symbol += "m7";
        else if (kind === "diminished") symbol += "dim";
        else if (kind === "augmented") symbol += "aug";

        chordSymbols.push({
          measure: measureNum,
          beat: 1, // Simplified - could calculate from position
          symbol,
        });
      });

      // Notes
      let currentBeat = 1;
      measureEl.querySelectorAll("note").forEach((noteEl) => {
        const isChordNote = noteEl.querySelector("chord") !== null;
        const isRest = noteEl.querySelector("rest") !== null;

        const durEl = noteEl.querySelector("duration");
        const durationDivs = durEl
          ? parseInt(durEl.textContent || "1", 10)
          : divisions;
        const beatDuration = durationDivs / divisions;

        const typeEl = noteEl.querySelector("type");
        const typeStr = typeEl?.textContent || "quarter";
        const duration = TYPE_TO_DURATION[typeStr] || "quarter";

        const dotCount = noteEl.querySelectorAll("dot").length;

        // Ties
        const tieEls = noteEl.querySelectorAll("tie");
        let tieStart = false;
        let tieEnd = false;
        tieEls.forEach((t) => {
          if (t.getAttribute("type") === "start") tieStart = true;
          if (t.getAttribute("type") === "stop") tieEnd = true;
        });

        // Lyrics
        const lyricText = getText(noteEl, "lyric > text") || undefined;

        let pitch = "rest";
        let accidental: "sharp" | "flat" | "natural" | "none" = "none";

        if (!isRest) {
          const step = getText(noteEl, "pitch > step") || "C";
          const octave = getText(noteEl, "pitch > octave") || "4";
          const alter = getText(noteEl, "pitch > alter");

          let accStr = "";
          if (alter === "1") {
            accStr = "#";
            accidental = "sharp";
          } else if (alter === "-1") {
            accStr = "b";
            accidental = "flat";
          }

          pitch = `${step}${accStr}${octave}`;
        }

        const beat = isChordNote ? currentBeat : currentBeat;

        notes.push({
          pitch,
          duration: duration as any,
          dots: dotCount,
          accidental,
          tieStart,
          tieEnd,
          measure: measureNum,
          beat: Math.round(beat * 100) / 100,
          ...(lyricText ? { lyric: lyricText } : {}),
        });

        if (!isChordNote) {
          currentBeat += beatDuration;
        }
      });
    });

    const hasLyrics = notes.some((n) => n.lyric);

    staves.push({
      id: `staff_${pi + 1}`,
      name: partName,
      clef,
      lyricsMode: hasLyrics ? "attached" : "none",
      voices: [
        {
          id: `staff_${pi + 1}_voice_1`,
          role: (clef as string) === "bass" ? ("bass" as const) : ("melody" as const),
          notes,
        },
      ],
    });
  });

  return {
    id: uuidv4(),
    title,
    composer,
    tempo,
    timeSignature,
    keySignature: keySignature as any,
    measures: maxMeasure,
    staves,
    chordSymbols,
    rehearsalMarks: [],
    repeats: [],
    sections: [],
    form: [],
    metadata: { source: "musicxml" },
  };
}

function getText(parent: Element | Document, selector: string): string {
  const el = parent.querySelector(selector);
  return el?.textContent?.trim() || "";
}

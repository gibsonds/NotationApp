import { Score, Note, Staff, Voice, ChordSymbol } from "../schema";
import { v4 as uuidv4 } from "uuid";

// ── StaffPad .snt NSKeyedArchiver parser ───────────────────────────────────
//
// File format: gzip-compressed binary plist (NSKeyedArchiver)
// Structure: composition -> trackBars[track][bar] -> voices -> rhythmicEvents -> notes
//
// Duration encoding: 3=whole, 4=half, 5=quarter, 6=eighth, 7=sixteenth
// Note letter: 0=C, 1=D, 2=E, 3=F, 4=G, 5=A, 6=B
// Note pitch: chromatic semitones from C (0=C, 2=D, 4=E, 5=F, 7=G, 9=A, 11=B)
// Clef type: 1=treble, 3=bass
// Key signature: 7=C, 8=F(1♭), 9=B♭(2♭), 6=G(1♯), 5=D(2♯), etc.
// Event type: 0=note/chord, 1=rest

const LETTER_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL_PITCH = [0, 2, 4, 5, 7, 9, 11]; // chromatic pitch for each letter

const DURATION_MAP: Record<number, "whole" | "half" | "quarter" | "eighth" | "sixteenth"> = {
  3: "whole",
  4: "half",
  5: "quarter",
  6: "eighth",
  7: "sixteenth",
};

const CLEF_MAP: Record<number, "treble" | "bass" | "alto" | "tenor"> = {
  1: "treble",
  3: "bass",
  // StaffPad also uses other values, but these are the common ones
};

// Key signature: 7 = C major (center), < 7 = sharps, > 7 = flats
const KEY_SIG_MAP: Record<number, string> = {
  0: "C#",  // 7 sharps (or enharmonic)
  1: "F#",  // 6 sharps
  2: "B",   // 5 sharps
  3: "E",   // 4 sharps
  4: "A",   // 3 sharps
  5: "D",   // 2 sharps
  6: "G",   // 1 sharp
  7: "C",   // 0 sharps/flats
  8: "F",   // 1 flat
  9: "Bb",  // 2 flats
  10: "Eb", // 3 flats
  11: "Ab", // 4 flats
  12: "Db", // 5 flats
  13: "Gb", // 6 flats
  14: "Cb", // 7 flats
};

type PlistObject = any;

class SNTParser {
  private objects: PlistObject[];

  constructor(objects: PlistObject[]) {
    this.objects = objects;
  }

  resolve(ref: any): any {
    if (ref && typeof ref === "object" && "UID" in ref) {
      const val = this.objects[ref.UID];
      if (val === "$null") return null;
      return val;
    }
    return ref;
  }

  resolveArray(ref: any): any[] {
    const arr = this.resolve(ref);
    if (arr && arr["NS.objects"]) {
      return arr["NS.objects"].map((r: any) => this.resolve(r));
    }
    if (Array.isArray(arr)) return arr;
    return [];
  }

  resolveString(ref: any): string {
    const val = this.resolve(ref);
    if (typeof val === "string") return val;
    return "";
  }

  parse(): Score {
    const root = this.objects[1];
    const comp = this.resolve(root.composition);

    // Instruments
    const instruments = this.resolveArray(comp.instruments);
    const instrumentName = instruments.length > 0
      ? this.resolveString(instruments[0].instrumentTitle) || "Instrument"
      : "Instrument";

    // Global bars (time signature, tempo)
    const bars = this.resolveArray(comp.bars);
    const barCount = bars.length;

    // Get tempo from first bar
    const firstBarTempo = this.resolve(bars[0]?.tempo);
    const bpm = firstBarTempo?.bpm ?? 120;

    // Get time signature from first bar
    const tsUpper = this.resolveArray(bars[0]?.timeSignatureUpperNumbers);
    const tsLower = this.resolveArray(bars[0]?.timeSignatureLowerNumbers);
    const timeSignature = `${tsUpper[0] ?? 4}/${tsLower[0] ?? 4}`;

    const beatsPerMeasure = tsUpper[0] ?? 4;
    const beatType = tsLower[0] ?? 4;

    // Tracks and trackBars
    const trackBarsOuter = this.resolveArray(comp.trackBars);
    const tracks = this.resolveArray(comp.tracks);

    // Determine key signature from first track bar's clef
    let keySignature = "C";
    const staves: Staff[] = [];
    const allChordSymbols: ChordSymbol[] = [];

    for (let ti = 0; ti < trackBarsOuter.length; ti++) {
      const trackBars = this.resolveArray(trackBarsOuter[ti]);
      const track = tracks[ti];
      const trackVoices = track ? this.resolveArray(track.voices) : [];
      const voiceCount = Math.max(trackVoices.length, 1);

      // Get clef and key from first bar
      const firstTB = trackBars[0];
      const firstClef = firstTB ? this.resolve(firstTB.clef) : null;
      const clefType = firstClef?.clefType ?? 1;
      const clef = CLEF_MAP[clefType] ?? "treble";

      // Key signature - use the first non-zero key signature
      const ks = firstClef?.keySignature ?? 7;
      if (ks !== 0 && keySignature === "C") {
        keySignature = KEY_SIG_MAP[ks] ?? "C";
      }

      // Staff name from instrument
      const staffName = trackBarsOuter.length === 1
        ? instrumentName
        : `${instrumentName} ${clef === "treble" ? "(R)" : "(L)"}`;

      // Parse notes from all bars for this track
      const voicesMap: Map<number, Note[]> = new Map();

      for (let bi = 0; bi < trackBars.length; bi++) {
        const tb = trackBars[bi];
        if (!tb) continue;

        const tbVoices = this.resolveArray(tb.voices);

        for (let vi = 0; vi < tbVoices.length; vi++) {
          const voice = tbVoices[vi];
          if (!voice) continue;

          const events = this.resolveArray(voice.rhythmicEvents);
          let currentBeat = 1;

          for (const event of events) {
            const eventType = event.type ?? 0;
            const durationCode = event.duration ?? 5;
            const dots = event.dots ?? 0;
            const duration = DURATION_MAP[durationCode] ?? "quarter";

            // Calculate beat duration for advancing
            const beatDuration = this.calcBeatDuration(durationCode, dots, beatType);

            const eventNotes = this.resolveArray(event.notes);
            const lyricText = this.resolveString(event.text) || undefined;

            // Check for ties from previous notes
            const hasTieEnd = false; // Would need context from previous event

            if (eventType === 0 && eventNotes.length > 0) {
              // Note or chord — lyric only on the first note
              for (let ni = 0; ni < eventNotes.length; ni++) {
                const sntNote = eventNotes[ni];
                const letter = sntNote.letter ?? 0;
                const pitch = sntNote.pitch ?? 0;
                const octave = sntNote.octave ?? 4;

                const noteName = this.pitchToString(letter, pitch, octave);
                const accidental = this.getAccidental(letter, pitch);

                // Check for ties
                const relationships = this.resolveArray(sntNote.relationships);
                const hasTie = relationships.length > 0;

                const note: Note = {
                  pitch: noteName,
                  duration,
                  dots,
                  accidental,
                  tieStart: hasTie,
                  tieEnd: false, // Set later in tie resolution
                  measure: bi + 1,
                  beat: Math.round(currentBeat * 100) / 100,
                  ...(ni === 0 && lyricText && lyricText !== "-" ? { lyric: lyricText } : {}),
                };

                if (!voicesMap.has(vi)) voicesMap.set(vi, []);
                voicesMap.get(vi)!.push(note);
              }
            } else if (eventType === 1) {
              // Rest
              const note: Note = {
                pitch: "rest",
                duration,
                dots,
                accidental: "none",
                tieStart: false,
                tieEnd: false,
                measure: bi + 1,
                beat: Math.round(currentBeat * 100) / 100,
              };

              if (!voicesMap.has(vi)) voicesMap.set(vi, []);
              voicesMap.get(vi)!.push(note);
            }

            currentBeat += beatDuration;
          }
        }
      }

      // Build voice objects, filtering out empty/rest-only voices
      const voices: Voice[] = [];
      for (const [vi, notes] of voicesMap.entries()) {
        // Skip voices that only contain whole-measure rests
        const hasRealNotes = notes.some(n => n.pitch !== "rest");
        if (!hasRealNotes && vi > 0) continue;

        const role = vi === 0 ? (clef === "bass" ? "bass" as const : "melody" as const) : "harmony" as const;
        voices.push({
          id: `staff_${ti + 1}_voice_${vi + 1}`,
          role,
          notes,
        });
      }

      // Ensure at least one voice
      if (voices.length === 0) {
        voices.push({
          id: `staff_${ti + 1}_voice_1`,
          role: "general",
          notes: [],
        });
      }

      staves.push({
        id: `staff_${ti + 1}`,
        name: staffName,
        clef,
        lyricsMode: voices.some(v => v.notes.some(n => n.lyric)) ? "attached" : "none",
        voices,
      });
    }

    // Resolve ties (mark tieEnd on notes that are tied to)
    for (const staff of staves) {
      for (const voice of staff.voices) {
        for (let i = 0; i < voice.notes.length - 1; i++) {
          if (voice.notes[i].tieStart) {
            // Find the next note with the same pitch
            for (let j = i + 1; j < voice.notes.length; j++) {
              if (voice.notes[j].pitch === voice.notes[i].pitch) {
                voice.notes[j].tieEnd = true;
                break;
              }
            }
          }
        }
      }
    }

    return {
      id: uuidv4(),
      title: instrumentName !== "Piano" ? instrumentName : "Imported Score",
      composer: "",
      tempo: bpm,
      timeSignature,
      keySignature: keySignature as any,
      measures: barCount,
      staves,
      chordSymbols: allChordSymbols,
      rehearsalMarks: [],
      repeats: [],
      metadata: { source: "staffpad", originalFormat: "snt" },
    };
  }

  private calcBeatDuration(durationCode: number, dots: number, beatType: number): number {
    // Duration in quarter-note beats
    const baseBeats: Record<number, number> = {
      3: 4,     // whole
      4: 2,     // half
      5: 1,     // quarter
      6: 0.5,   // eighth
      7: 0.25,  // sixteenth
    };

    let dur = baseBeats[durationCode] ?? 1;
    let dotVal = dur;
    for (let d = 0; d < dots; d++) {
      dotVal /= 2;
      dur += dotVal;
    }

    // Adjust for beat type (e.g. in 6/8, beat = dotted quarter)
    return dur;
  }

  private pitchToString(letter: number, pitch: number, octave: number): string {
    const letterName = LETTER_NAMES[letter] ?? "C";
    const naturalPitch = NATURAL_PITCH[letter] ?? 0;
    const alter = pitch - naturalPitch;

    let accStr = "";
    if (alter === 1) accStr = "#";
    else if (alter === -1) accStr = "b";
    else if (alter === 2) accStr = "##";
    else if (alter === -2) accStr = "bb";
    // alter === 0: natural, no accidental string

    return `${letterName}${accStr}${octave}`;
  }

  private getAccidental(letter: number, pitch: number): "sharp" | "flat" | "natural" | "none" {
    const naturalPitch = NATURAL_PITCH[letter] ?? 0;
    const alter = pitch - naturalPitch;

    if (alter === 1 || alter === 2) return "sharp";
    if (alter === -1 || alter === -2) return "flat";
    return "none";
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function parseSNT(buffer: ArrayBuffer): Promise<Score> {
  // Dynamic imports for Node.js modules
  const pako = await import("pako");
  const bplistParser = await import("bplist-parser");

  // Decompress gzip
  const compressed = new Uint8Array(buffer);
  const decompressed = pako.inflate(compressed);

  // Parse binary plist
  const parsed = bplistParser.parseBuffer(Buffer.from(decompressed));
  const objects = parsed[0]["$objects"];

  if (!objects || !Array.isArray(objects)) {
    throw new Error("Invalid .snt file: no $objects array in plist");
  }

  const parser = new SNTParser(objects);
  return parser.parse();
}

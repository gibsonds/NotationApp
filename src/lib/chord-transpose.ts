/**
 * Chord-chart transpose helper.
 *
 * Walks a chord-chart line (text like "C  G/B  Am F#m7") and shifts every
 * chord token by N semitones, preserving bars, suffixes, and bass-note
 * slashes. Sharp/flat preference is chosen to match the new key — if the
 * destination is e.g. F major, accidentals come out as flats; if D major,
 * sharps. Caller passes the destination preference explicitly when known.
 */

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NAME_TO_SEMITONE: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11,
};

export type Accidental = "sharp" | "flat" | "auto";

function transposeRoot(root: string, semitones: number, prefer: Accidental): string {
  const semi = NAME_TO_SEMITONE[root];
  if (semi === undefined) return root;
  const newSemi = ((semi + semitones) % 12 + 12) % 12;
  if (prefer === "flat") return FLAT_NAMES[newSemi];
  if (prefer === "sharp") return SHARP_NAMES[newSemi];
  // Auto: keep the input's accidental flavor when possible. If input had a
  // flat letter, prefer flat; if sharp, prefer sharp; otherwise sharp.
  if (root.includes("b") || root.includes("♭")) return FLAT_NAMES[newSemi];
  return SHARP_NAMES[newSemi];
}

/** Match a single chord-token at the start of a string. Returns the matched
 *  text (root + suffix + optional /bass) and its length, or null if no
 *  chord starts here. */
function matchChordAt(text: string, start: number): { token: string; length: number } | null {
  // Root: A-G plus optional accidental
  const rootMatch = /^[A-G][b#♭♯]?/.exec(text.slice(start));
  if (!rootMatch) return null;
  let i = start + rootMatch[0].length;
  // Suffix: chord quality / extensions — letters, digits, +, °, ø, parens,
  // commas. Stop at whitespace or '|' or '/' (bass-note follows).
  while (i < text.length && /[a-zA-Z0-9+°ø()Δ△,#♯b♭\-]/.test(text[i])) i++;
  // Optional bass note after a slash
  if (text[i] === "/") {
    const bassMatch = /^\/[A-G][b#♭♯]?/.exec(text.slice(i));
    if (bassMatch) i += bassMatch[0].length;
  }
  return { token: text.slice(start, i), length: i - start };
}

/** Split a chord token into root, suffix, bass-root, bass-acc.
 *  e.g. "F#m7/A" -> { root: "F#", suffix: "m7", bass: "A" }. */
function splitChordToken(token: string): { root: string; suffix: string; bass?: string } {
  const m = /^([A-G][b#♭♯]?)(.*)$/.exec(token);
  if (!m) return { root: token, suffix: "" };
  let suffix = m[2];
  let bass: string | undefined;
  const slash = suffix.indexOf("/");
  if (slash >= 0) {
    const bassPart = suffix.slice(slash + 1);
    const bassMatch = /^[A-G][b#♭♯]?/.exec(bassPart);
    if (bassMatch) {
      bass = bassMatch[0];
      suffix = suffix.slice(0, slash);
    }
  }
  return { root: m[1], suffix, bass };
}

function normalizeAccidental(s: string): string {
  return s.replace(/♯/g, "#").replace(/♭/g, "b");
}

/** Transpose a single chord token. Preserves the suffix and bass note. */
export function transposeChordToken(
  token: string,
  semitones: number,
  prefer: Accidental = "auto",
): string {
  const norm = normalizeAccidental(token);
  const parts = splitChordToken(norm);
  const newRoot = transposeRoot(parts.root, semitones, prefer);
  const newBass = parts.bass ? transposeRoot(parts.bass, semitones, prefer) : undefined;
  return newRoot + parts.suffix + (newBass ? "/" + newBass : "");
}

/** Walk a chord-chart line, replacing each chord token with its transposed
 *  equivalent. Bars, spaces, and any non-chord characters pass through
 *  untouched so column alignment is preserved as much as possible (note:
 *  if a transposed token has a different length, columns will shift). */
export function transposeChordLine(
  line: string,
  semitones: number,
  prefer: Accidental = "auto",
): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    // Only attempt chord-match on uppercase A-G — skip everything else
    // verbatim so bars, spaces, commas etc. survive.
    if (ch >= "A" && ch <= "G") {
      const m = matchChordAt(line, i);
      if (m) {
        out += transposeChordToken(m.token, semitones, prefer);
        i += m.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

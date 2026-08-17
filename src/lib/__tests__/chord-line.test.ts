import { describe, expect, it } from "vitest";
import { findTokenAtColumn, nearestWordStartCol, setChordAtColumn } from "../chord-line";

// "Amazing grace how sweet"
//  A0..g6  (sp7)  grace8..e12  (sp13)  how14..w16  (sp17)  sweet18..t22
const LINE = "Amazing grace how sweet";

describe("nearestWordStartCol", () => {
  it("returns the word's start when the tap lands inside a word", () => {
    expect(nearestWordStartCol(LINE, 10)).toBe(8); // inside "grace"
    expect(nearestWordStartCol(LINE, 0)).toBe(0); // first letter of "Amazing"
    expect(nearestWordStartCol(LINE, 20)).toBe(18); // inside "sweet"
  });

  it("snaps to the nearer word when the tap lands on whitespace", () => {
    // col 7 is the space between "Amazing" (start 0) and "grace" (start 8);
    // "grace" is closer.
    expect(nearestWordStartCol(LINE, 7)).toBe(8);
  });

  it("snaps to the last word when the tap is past the end of the line", () => {
    expect(nearestWordStartCol(LINE, 100)).toBe(18); // "sweet"
  });

  it("returns null when there are no words to snap to", () => {
    expect(nearestWordStartCol("", 0)).toBeNull();
    expect(nearestWordStartCol("   ", 1)).toBeNull();
  });
});

// Nudging a chord one column (Alt+←/→ and the ◀ ▶ buttons in ChordEntryBar).
// The move regressed twice over: #169 dropped the key bindings, and the
// re-anchor path would have defeated them anyway — see the slack test below.
describe("chord nudge — moving a chord one column", () => {
  it("moves the chord and leaves no copy at the old column", () => {
    // "C" sits at column 6, over "g" of "Driving".
    let chords = "      C              G";
    // What handleEditingChange does for a step-left: clear the original
    // token, then place the same text one column over.
    chords = setChordAtColumn(chords, 6, "");
    chords = setChordAtColumn(chords, 5, "C");
    expect(chords.indexOf("C")).toBe(5);
    expect(chords.match(/C/g)).toHaveLength(1);
    // The other chord is undisturbed.
    expect(chords.indexOf("G")).toBe(21);
  });

  it("repeated nudges walk the chord along the line", () => {
    let chords = "      C";
    for (let i = 0; i < 3; i++) {
      const from = chords.indexOf("C");
      chords = setChordAtColumn(chords, from, "");
      chords = setChordAtColumn(chords, from - 1, "C");
    }
    expect(chords.indexOf("C")).toBe(3);
  });

  it("findTokenAtColumn's default slack matches an ADJACENT token", () => {
    // This is the trap the nudge has to avoid: asking for the token at the
    // column we are moving INTO returns the chord we just moved, whose start
    // is the old column — re-anchoring on it pins the chord in place, so the
    // nudge silently does nothing. The nudge path must not re-query here.
    const chords = "      C";
    expect(findTokenAtColumn(chords, 5)?.start).toBe(6); // slack=1 snaps back
    expect(findTokenAtColumn(chords, 7)?.start).toBe(6);
    // With slack 0 the neighbouring column is genuinely empty.
    expect(findTokenAtColumn(chords, 5, 0)).toBeUndefined();
  });
});

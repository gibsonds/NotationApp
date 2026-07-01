import { describe, expect, it } from "vitest";
import { nearestWordStartCol } from "../chord-line";

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

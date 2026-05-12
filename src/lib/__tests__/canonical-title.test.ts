import { describe, expect, it } from "vitest";
import { canonicalSongTitle } from "../song-bank";

describe("canonicalSongTitle", () => {
  it("collapses case + whitespace + trim", () => {
    expect(canonicalSongTitle("  Friday GIG  ")).toBe("friday gig");
  });

  it("collapses internal double-spaces and tabs to single space", () => {
    expect(canonicalSongTitle("Friday   gig\t!")).toBe("friday gig !");
  });

  it("collapses non-breaking space (U+00A0) like a regular space", () => {
    expect(canonicalSongTitle("Friday gig")).toBe("friday gig");
  });

  it("folds NFD to NFC — precomposed and decomposed accented chars match", () => {
    const nfc = "Café";              // single precomposed é
    const nfd = "Café";        // e + combining acute
    expect(canonicalSongTitle(nfc)).toBe(canonicalSongTitle(nfd));
    expect(canonicalSongTitle(nfc)).toBe("café");
  });

  it("folds smart single quotes to straight", () => {
    expect(canonicalSongTitle("Friday’s gig")).toBe("friday's gig");
    expect(canonicalSongTitle("‘So it goes’")).toBe("'so it goes'");
  });

  it("folds smart double quotes to straight", () => {
    expect(canonicalSongTitle("“Hey”")).toBe('"hey"');
  });

  it("returns empty string for null/undefined-ish input", () => {
    // Defensive: any caller passing through an undefined title shouldn't blow up.
    expect(canonicalSongTitle("")).toBe("");
    expect(canonicalSongTitle(undefined as unknown as string)).toBe("");
  });

  it("equates iPad-typed and Mac-typed versions of the same title", () => {
    // The actual scenario this helper exists for: same song saved on
    // both devices, one with auto-corrected smart quote + NFD accent.
    const iPad = "Café’s Anthem";          // NFC + smart apostrophe
    const mac = "Café's Anthem";              // NFD + straight apostrophe
    expect(canonicalSongTitle(iPad)).toBe(canonicalSongTitle(mac));
  });
});

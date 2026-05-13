import { describe, expect, it } from "vitest";
import { aliasCanonicalTitle, isAliasTitle } from "../song-bank";

describe("aliasCanonicalTitle", () => {
  it("strips (snapped)", () => {
    expect(aliasCanonicalTitle("Anywhere (snapped)")).toBe("Anywhere");
  });
  it("strips (recovered 9:06 PM)", () => {
    expect(aliasCanonicalTitle("Foggy Night (recovered 9:06 PM)")).toBe("Foggy Night");
  });
  it("strips (latest 10:37 PM)", () => {
    expect(aliasCanonicalTitle("Star to Star (latest 10:37 PM)")).toBe("Star to Star");
  });
  it("strips (snapped) with trailing whitespace", () => {
    expect(aliasCanonicalTitle("Foo (snapped)   ")).toBe("Foo");
  });
  it("is case-insensitive on the keyword", () => {
    expect(aliasCanonicalTitle("Foo (Snapped)")).toBe("Foo");
    expect(aliasCanonicalTitle("Foo (RECOVERED 1:00 AM)")).toBe("Foo");
  });
  it("returns null for plain titles", () => {
    expect(aliasCanonicalTitle("Hurricane Larry")).toBeNull();
    expect(aliasCanonicalTitle("Untitled")).toBeNull();
  });
  it("does not match unrelated parens", () => {
    expect(aliasCanonicalTitle("Song (live version)")).toBeNull();
    expect(aliasCanonicalTitle("Take 2 (rehearsal)")).toBeNull();
  });

  it("strips (with highlights HH:MM PM)", () => {
    expect(aliasCanonicalTitle("Foggy Night (with highlights 10:26 PM)")).toBe(
      "Foggy Night",
    );
  });

  it("strips (chords fixed HH:MM PM)", () => {
    expect(aliasCanonicalTitle("Star to Star (chords fixed 9:59 PM)")).toBe(
      "Star to Star",
    );
  });

  it("strips bare (old) tag", () => {
    expect(aliasCanonicalTitle("Anywhere (old)")).toBe("Anywhere");
  });

  it("catches future timestamped aliases via trailing HH:MM AM|PM rule", () => {
    // Even unknown verbs get caught if they trail with a time.
    expect(aliasCanonicalTitle("Twig (remixed 10:42 PM)")).toBe("Twig");
    expect(aliasCanonicalTitle("Hurricane (autosaved 1:00 am)")).toBe(
      "Hurricane",
    );
  });
});

describe("isAliasTitle", () => {
  it("matches alias titles", () => {
    expect(isAliasTitle("Anywhere (snapped)")).toBe(true);
    expect(isAliasTitle("Foo (recovered 9:06 PM)")).toBe(true);
    expect(isAliasTitle("Bar (latest 10:37 PM)")).toBe(true);
  });
  it("rejects plain titles", () => {
    expect(isAliasTitle("Anywhere")).toBe(false);
    expect(isAliasTitle("Song (live)")).toBe(false);
  });
});

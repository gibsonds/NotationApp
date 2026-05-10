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

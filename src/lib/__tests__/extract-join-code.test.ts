import { describe, expect, it } from "vitest";
import { extractJoinCode } from "@/lib/song-cloud";

const UUID = "5d30c34c-5d51-4e69-9eda-b6e717ea2315";

describe("extractJoinCode — happy paths", () => {
  it("accepts a raw UUID", () => {
    expect(extractJoinCode(UUID)).toBe(UUID);
  });

  it("accepts a share URL and extracts the join param", () => {
    expect(extractJoinCode(`https://gibsonds.github.io/NotationApp/?join=${UUID}`)).toBe(UUID);
  });

  it("trims surrounding whitespace", () => {
    expect(extractJoinCode(`   ${UUID}   `)).toBe(UUID);
  });

  it("lowercases an upper-cased UUID for consistent partitioning", () => {
    expect(extractJoinCode(UUID.toUpperCase())).toBe(UUID);
  });
});

describe("extractJoinCode — sanitisation of pasted garbage", () => {
  it("strips a leading backslash (the bug that started this)", () => {
    // URL-encoded paste round-trip produced \5d30c34c-... once in
    // production; the UUID part is fine, the leading slash partitioned
    // the device to its own private songbook.
    expect(extractJoinCode(`\\${UUID}`)).toBe(UUID);
  });

  it("strips a leading quote (chat-app smart-quote auto-correct)", () => {
    expect(extractJoinCode(`"${UUID}"`)).toBe(UUID);
  });

  it("decodes URL-encoded backslash inside the join param and strips it", () => {
    // %5C decodes to \, then sanitize strips it.
    expect(
      extractJoinCode(`https://example.com/?join=%5C${UUID}`),
    ).toBe(UUID);
  });
});

describe("extractJoinCode — invalid input rejected", () => {
  it("returns null for empty string", () => {
    expect(extractJoinCode("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(extractJoinCode("   ")).toBeNull();
  });

  it("returns null for a non-UUID string", () => {
    expect(extractJoinCode("not-a-uuid")).toBeNull();
  });

  it("returns null when the URL has no join param", () => {
    expect(extractJoinCode("https://example.com/?other=1")).toBeNull();
  });

  it("returns null when interior characters break the UUID shape", () => {
    // Mid-string spaces or stray chars aren't auto-corrected — better
    // to reject than mutate something the user intended to be valid.
    expect(extractJoinCode(`5d30c34c 5d51-4e69-9eda-b6e717ea2315`)).toBeNull();
  });
});

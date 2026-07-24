import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  challengeS256,
  generateVerifier,
  randomState,
} from "@/lib/pkce";

describe("generateVerifier", () => {
  it("produces 43-128 chars from the RFC 7636 unreserved set", () => {
    for (const len of [43, 64, 128, 10, 500]) {
      const v = generateVerifier(len);
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("is non-deterministic", () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});

describe("challengeS256", () => {
  it("matches the RFC 7636 Appendix B known vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await challengeS256(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });
});

describe("base64UrlEncode", () => {
  it("uses url-safe alphabet without padding", () => {
    // 0xfb 0xff encodes to "+/8=" in plain base64 → "-_8" url-safe unpadded.
    expect(base64UrlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
  });
});

describe("randomState", () => {
  it("is url-safe and unique", () => {
    const s = randomState();
    expect(s).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(randomState()).not.toBe(s);
  });
});

/**
 * Decision-table tests for the server-side auth gate and role checks —
 * pure logic only, verifier stubbed, no network/DDB.
 */
import { describe, expect, it } from "vitest";
import { AuthError, resolveUserFromHeaders } from "../auth";
import { roleAllows } from "../handler-auth";
import { pickEvictionVictims } from "../songbook-repo";
import { rekeyLegacyItems } from "../import";
import { chunk } from "../ddb";

const okVerify = async () => ({
  payload: { sub: "user-1", email: "u@test" } as Record<string, unknown>,
});
const failVerify = async () => {
  throw new Error("bad signature");
};

describe("resolveUserFromHeaders", () => {
  it("accepts a valid bearer and extracts claims", async () => {
    const u = await resolveUserFromHeaders(
      { authorization: "Bearer good" },
      {},
      okVerify
    );
    expect(u).toEqual({ sub: "user-1", email: "u@test" });
  });

  it("401s with no authorization header", async () => {
    await expect(resolveUserFromHeaders({}, {}, okVerify)).rejects.toThrow(AuthError);
  });

  it("401s on a malformed scheme", async () => {
    await expect(
      resolveUserFromHeaders({ authorization: "Basic abc" }, {}, okVerify)
    ).rejects.toThrow(AuthError);
  });

  it("401s when verification fails — never falls back", async () => {
    await expect(
      resolveUserFromHeaders(
        { authorization: "Bearer forged", "x-device-id": "dev-1" },
        {},
        failVerify
      )
    ).rejects.toThrow(AuthError);
  });

  it("401s when the payload has no sub", async () => {
    await expect(
      resolveUserFromHeaders({ authorization: "Bearer x" }, {}, async () => ({
        payload: {},
      }))
    ).rejects.toThrow(AuthError);
  });

  it("accepts stub identities only with AUTH_STUB=1 AND NODE_ENV=development", async () => {
    const headers = { authorization: "Bearer stub:alice:a@test" };
    const dev = { AUTH_STUB: "1", NODE_ENV: "development" };
    expect(await resolveUserFromHeaders(headers, dev, failVerify)).toEqual({
      sub: "alice",
      email: "a@test",
    });
    // Missing either flag → the stub token goes to the real verifier and fails.
    await expect(
      resolveUserFromHeaders(headers, { AUTH_STUB: "1" }, failVerify)
    ).rejects.toThrow(AuthError);
    await expect(
      resolveUserFromHeaders(headers, { NODE_ENV: "development" }, failVerify)
    ).rejects.toThrow(AuthError);
  });
});

describe("roleAllows", () => {
  const cases: Array<[string | null, string, boolean]> = [
    ["viewer", "viewer", true],
    ["viewer", "editor", false],
    ["viewer", "owner", false],
    ["editor", "viewer", true],
    ["editor", "editor", true],
    ["editor", "owner", false],
    ["owner", "viewer", true],
    ["owner", "editor", true],
    ["owner", "owner", true],
    [null, "viewer", false],
  ];
  for (const [role, required, expected] of cases) {
    it(`${role ?? "non-member"} vs ${required} → ${expected}`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(roleAllows(role as any, required as any)).toBe(expected);
    });
  }
});

describe("rekeyLegacyItems", () => {
  const legacy = [
    { pk: "DEVICE#d1", sk: "SONG#s1", entity: "Song", id: "s1", updatedAt: 10, version: "old" },
    { pk: "DEVICE#d1", sk: "SONG#s1#V#5", entity: "Version", id: "s1", updatedAt: 5 },
    { pk: "DEVICE#d1", sk: "CLAIM#", entity: "Claim" },
  ];

  it("re-keys songs and versions onto the songbook partition", () => {
    const { songs, versions } = rekeyLegacyItems(legacy, "book-1", "user-1", () => "v-new");
    expect(songs).toHaveLength(1);
    expect(versions).toHaveLength(1);
    expect(songs[0].pk).toBe("SONGBOOK#book-1");
    expect(songs[0].sk).toBe("SONG#s1");
    expect(versions[0].pk).toBe("SONGBOOK#book-1");
  });

  it("stamps savedBy + a fresh concurrency token on songs, and records provenance", () => {
    const { songs } = rekeyLegacyItems(legacy, "book-1", "user-1", () => "v-new");
    expect(songs[0].savedBy).toBe("user-1");
    expect(songs[0].version).toBe("v-new");
    expect(songs[0].importedFrom).toBe("DEVICE#d1");
  });

  it("does not copy non-song entities (claim markers etc.)", () => {
    const { songs, versions } = rekeyLegacyItems(legacy, "b", "u");
    expect(songs.length + versions.length).toBe(2);
  });

  it("is idempotent — rerunning yields identical keys", () => {
    const a = rekeyLegacyItems(legacy, "b", "u", () => "v");
    const b = rekeyLegacyItems(legacy, "b", "u", () => "v");
    expect(a).toEqual(b);
  });
});

describe("chunk", () => {
  it("splits into DynamoDB batch sizes", () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const out = chunk(items);
    expect(out.map((c) => c.length)).toEqual([25, 25, 10]);
    expect(out.flat()).toEqual(items);
  });

  it("handles empty input", () => {
    expect(chunk([])).toEqual([]);
  });
});

describe("pickEvictionVictims", () => {
  const v = (updatedAt: number, kind: string) => ({ pk: "p", sk: `V#${updatedAt}`, updatedAt, kind });

  it("only ever evicts auto versions", () => {
    const all = [v(1, "named"), v(2, "daily"), v(3, "auto"), v(4, "auto")];
    const victims = pickEvictionVictims(all, 3);
    expect(victims.every((x) => x.kind === "auto")).toBe(true);
    expect(victims).toHaveLength(2); // only 2 autos exist
  });

  it("drops the auto version closest to a neighbor (least temporal info)", () => {
    // autos at 10, 11 (dense pair) and 100 (isolated) — dense one goes first.
    const all = [v(10, "auto"), v(11, "auto"), v(100, "auto")];
    const victims = pickEvictionVictims(all, 1);
    expect([10, 11]).toContain(victims[0].updatedAt);
  });
});

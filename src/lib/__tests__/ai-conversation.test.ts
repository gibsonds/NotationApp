import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider, OpenAIProvider } from "../ai-provider";
import { revisionConversation } from "../ai-conversation";
import type { Score } from "../schema";

vi.mock("../ai-logger", () => ({ logAIRequest: vi.fn() }));

const conversation = [
  { role: "user" as const, content: 'Put "but I\'m not moving on" on a new line.' },
  { role: "assistant" as const, content: "It appears in both Pre-Chorus sections (2 and 5). Should I update both, or one?" },
];
const score = { id: "sleepwalking", staves: [], sections: [], measures: 1 } as unknown as Score;

afterEach(() => vi.unstubAllGlobals());

describe("AI clarification context", () => {
  for (const kind of ["claude", "openai"] as const) {
    it(`sends the earlier request and clarification with 'update both' to ${kind}`, async () => {
      const output = { patches: [], message: "Updated both Pre-Chorus sections." };
      const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(kind === "claude"
        ? { content: [{ type: "tool_use", name: "emit_revision", input: output }] }
        : { choices: [{ message: { content: JSON.stringify(output) } }] })));
      vi.stubGlobal("fetch", fetch);
      const provider = kind === "claude" ? new ClaudeProvider("test") : new OpenAIProvider("test");
      await provider.reviseScoreFromPrompt("update both", score, undefined, conversation);
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      const turns = body.messages.filter((m: { role: string }) => m.role !== "system");
      expect(turns.slice(0, 2)).toEqual(conversation);
      expect(turns[2].content).toContain("Revision request: update both");
      expect(turns).toHaveLength(3);
    });
  }

  it("excludes messages from another song and strips UI metadata", () => {
    expect(revisionConversation([
      { ...conversation[0], scoreId: "other-song" },
      { ...conversation[0], scoreId: "sleepwalking", id: "msg-1", timestamp: 123 },
      { ...conversation[1], scoreId: "sleepwalking" },
    ], "sleepwalking")).toEqual(conversation);
  });

  it("ignores invalid roles and bounds large histories", () => {
    const turns = revisionConversation([
      { role: "system", content: "not a conversation turn" },
      ...Array.from({ length: 30 }, () => ({ role: "user", content: "x".repeat(8000) })),
    ]);
    expect(turns.every(t => t.role === "user")).toBe(true);
    expect(turns.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(24000);
    expect(revisionConversation({ messages: conversation })).toEqual([]);
  });
});

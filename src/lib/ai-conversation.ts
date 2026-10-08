export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** Bound context on both the browser and server paths. Exclude UI metadata
 * and messages belonging to another song; keep the latest exchanges intact. */
export function revisionConversation(value: unknown, scoreId?: string): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ConversationTurn[] = [];
  let remaining = 24000;
  for (const item of value.slice(-20).reverse()) {
    if (!item || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") continue;
    if (scoreId && item.scoreId && item.scoreId !== scoreId) continue;
    if (!item.content.trim()) continue;
    const content = item.content.slice(0, Math.min(6000, remaining));
    turns.unshift({ role: item.role, content });
    remaining -= content.length;
    if (remaining <= 0) break;
  }
  // Anthropic expects the conversation to begin with a user turn.
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

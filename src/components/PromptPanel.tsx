"use client";

import { useState, useRef, useEffect } from "react";
import { useScoreStore, ChatMessage, RecordedOperation } from "@/store/score-store";
import { matchBuiltinCommand, BUILTIN_COMMANDS } from "@/lib/transforms";
import { v4 as uuidv4 } from "uuid";

export default function PromptPanel() {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const {
    messages,
    addMessage,
    isGenerating,
    setIsGenerating,
    setScore,
    setWarnings,
    applyPatches,
    score,
    selection,
    stepEntry,
    lastOperation,
    setLastOperation,
    copySelection,
    pasteAtSelection,
  } = useScoreStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isGenerating) return;

    const prompt = input.trim();
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: "user",
      content: prompt + (selection ? ` [m${selection.startMeasure}-${selection.endMeasure}]` : ""),
      timestamp: Date.now(),
    };
    addMessage(userMsg);
    setInput("");

    // Check for replay commands
    if (score && lastOperation && isReplayCommand(prompt)) {
      await replayLastOperation();
      return;
    }

    // Check for built-in commands (deterministic, no AI needed)
    if (score) {
      const builtin = matchBuiltinCommand(prompt);
      if (builtin) {
        // Copy and paste are special — they use store clipboard, not transforms
        if (builtin.name === "copy") {
          const msg = copySelection();
          addMessage({ id: uuidv4(), role: "assistant", content: msg || "Copied.", timestamp: Date.now() });
          return;
        }
        if (builtin.name === "paste") {
          const msg = pasteAtSelection();
          addMessage({ id: uuidv4(), role: "assistant", content: msg || "Pasted.", timestamp: Date.now() });
          return;
        }

        const newScore = builtin.execute(score, selection ?? undefined);
        setScore(newScore);
        setLastOperation({
          prompt,
          type: "builtin",
          builtinCommand: builtin.name,
          selection: selection ?? undefined,
        });
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: `${builtin.description}${selection ? ` (measures ${selection.startMeasure}-${selection.endMeasure})` : ""}.`,
          timestamp: Date.now(),
        });
        return;
      }
    }

    // AI request
    setIsGenerating(true);
    try {
      const endpoint = score ? "/api/score/revise" : "/api/score/create";
      // Build selection context: use explicit selection range, or derive from stepEntry (selected note)
      let effectiveSelection = selection ?? undefined;
      if (!effectiveSelection && stepEntry && score) {
        // Single note selected — create a selection covering its measure+staff
        effectiveSelection = {
          startMeasure: stepEntry.measure,
          endMeasure: stepEntry.measure,
          staffIds: [stepEntry.staffId],
        };
      }
      // Find the specific note at the cursor + surrounding notes for the LLM
      let selectedNoteInfo: string | undefined;
      if (stepEntry && score) {
        const staff = score.staves.find(s => s.id === stepEntry.staffId);
        const voice = staff?.voices.find(v => v.id === stepEntry.voiceId) || staff?.voices[0];
        if (voice) {
          const sorted = voice.notes
            .filter(n => n.pitch !== "rest")
            .sort((a, b) => a.measure - b.measure || a.beat - b.beat);
          const idx = sorted.findIndex(n => n.measure === stepEntry.measure && Math.abs(n.beat - stepEntry.beat) < 0.05);
          if (idx >= 0) {
            const note = sorted[idx];
            const prev = idx > 0 ? sorted[idx - 1] : null;
            const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;
            let info = `${note.pitch} at measure ${note.measure} beat ${note.beat} on staff "${staff?.name}" (voice "${voice.id}")`;
            if (prev) info += `. Previous note: ${prev.pitch} m${prev.measure} b${prev.beat}`;
            if (next) info += `. Next note: ${next.pitch} m${next.measure} b${next.beat}`;
            selectedNoteInfo = info;
          }
        }
      }
      const body = score
        ? { prompt, currentScore: score, selection: effectiveSelection, selectedNote: selectedNoteInfo }
        : { prompt };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to process request");
      }

      const hasChanges = data.score || (data.patches && data.patches.length > 0);

      if (data.score) {
        setScore(data.score);
      } else if (data.patches && data.patches.length > 0) {
        applyPatches(data.patches);
      }

      if (data.warnings?.length) {
        setWarnings(data.warnings);
      }

      // Only record operation for replay if there were actual changes
      if (hasChanges) {
        setLastOperation({
          prompt,
          type: "ai",
          patches: data.patches,
          selection: selection ?? undefined,
        });
      }

      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: data.message || (score ? "Score updated." : "Score created."),
        timestamp: Date.now(),
      });
    } catch (err: any) {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Error: ${err.message}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const replayLastOperation = async () => {
    if (!score || !lastOperation) return;

    const sel = selection ?? undefined;

    if (lastOperation.type === "builtin" && lastOperation.builtinCommand) {
      const cmd = BUILTIN_COMMANDS.find(
        (c) => c.name === lastOperation.builtinCommand
      );
      if (cmd) {
        const newScore = cmd.execute(score, sel);
        setScore(newScore);
        setLastOperation({ ...lastOperation, selection: sel });
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: `Replayed: ${cmd.description}${sel ? ` (measures ${sel.startMeasure}-${sel.endMeasure})` : ""}.`,
          timestamp: Date.now(),
        });
      }
      return;
    }

    // Replay AI operation with new selection
    setIsGenerating(true);
    try {
      const res = await fetch("/api/score/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: lastOperation.prompt,
          currentScore: score,
          selection: sel,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Replay failed");

      if (data.score) {
        setScore(data.score);
      } else if (data.patches) {
        applyPatches(data.patches);
      }

      setLastOperation({ ...lastOperation, selection: sel, patches: data.patches });
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Replayed "${lastOperation.prompt}"${sel ? ` on measures ${sel.startMeasure}-${sel.endMeasure}` : ""}.`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Replay error: ${err.message}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const selectionLabel = selection
    ? `m${selection.startMeasure}${selection.endMeasure !== selection.startMeasure ? `-${selection.endMeasure}` : ""}`
    : null;

  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="font-semibold text-gray-800 text-sm">Prompt</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Describe the music you want to create
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-8 space-y-3">
            <p className="text-lg">&#9833;</p>
            <p>Describe a score to get started</p>
            <div className="space-y-1.5 text-xs text-gray-400">
              <p>&quot;4/4 time, key of G, lead sheet with chord symbols&quot;</p>
              <p>&quot;SATB hymn in D major, 8 measures&quot;</p>
              <p>&quot;12-bar blues in F with walking bass&quot;</p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === "user"
                ? "bg-blue-600 text-white ml-4"
                : "bg-white text-gray-800 border border-gray-200 mr-4"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {isGenerating && (
          <div className="bg-white text-gray-500 border border-gray-200 rounded-lg px-3 py-2 text-sm mr-4">
            <span className="inline-flex gap-1">
              <span className="animate-bounce">.</span>
              <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Replay button */}
      {lastOperation && score && (
        <div className="px-3 py-2 border-t border-gray-100">
          <button
            onClick={replayLastOperation}
            disabled={isGenerating}
            className="w-full px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg disabled:opacity-50 transition-colors text-left"
          >
            &#x21bb; Replay &quot;{lastOperation.prompt.slice(0, 40)}
            {lastOperation.prompt.length > 40 ? "..." : ""}&quot;
            {selectionLabel ? ` on ${selectionLabel}` : ""}
          </button>
        </div>
      )}

      {/* Selection indicator */}
      {selectionLabel && (
        <div className="px-3 py-1 bg-blue-50 border-t border-blue-100 text-xs text-blue-600">
          Selection: {selectionLabel}
          {selection?.staffIds && ` (${selection.staffIds.length} staves)`}
          {" "}&mdash; edits will apply to selection only
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 bg-white">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              score
                ? selectionLabel
                  ? `Edit ${selectionLabel}...`
                  : "Describe changes..."
                : "Describe the score you want..."
            }
            disabled={isGenerating}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 text-gray-800 placeholder-gray-400"
          />
          <button
            type="submit"
            disabled={isGenerating || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}

function isReplayCommand(prompt: string): boolean {
  const lower = prompt.toLowerCase().trim();
  return (
    lower === "again" ||
    lower === "same" ||
    lower === "same thing" ||
    lower === "do it again" ||
    lower === "repeat" ||
    lower === "replay" ||
    lower === "do the same" ||
    lower === "do the same thing" ||
    lower.startsWith("same here") ||
    lower.startsWith("do that here") ||
    lower.startsWith("do the same here") ||
    lower.startsWith("apply that here") ||
    lower.startsWith("do this here")
  );
}

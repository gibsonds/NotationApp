"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
  enabled?: boolean;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  isOpen: boolean;
  onClose: () => void;
}

/** Simple fuzzy match: all query chars must appear in target in order */
function fuzzyMatch(query: string, target: string): { match: boolean; score: number } {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (q.length === 0) return { match: true, score: 0 };

  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Bonus for consecutive matches
      if (ti === prevMatchIdx + 1) score += 2;
      // Bonus for matching at word start
      if (ti === 0 || t[ti - 1] === " ") score += 3;
      score += 1;
      prevMatchIdx = ti;
      qi++;
    }
  }

  return { match: qi === q.length, score };
}

export default function CommandPalette({ commands, isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter and sort commands
  const filtered = useMemo(() => {
    const results: { cmd: PaletteCommand; score: number }[] = [];
    for (const cmd of commands) {
      if (cmd.enabled === false) continue;
      const labelMatch = fuzzyMatch(query, cmd.label);
      const catMatch = fuzzyMatch(query, cmd.category);
      const bestScore = Math.max(labelMatch.score, catMatch.score);
      if (labelMatch.match || catMatch.match) {
        results.push({ cmd, score: bestScore });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.cmd);
  }, [commands, query]);

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: PaletteCommand[] }[] = [];
    const catMap = new Map<string, PaletteCommand[]>();
    for (const cmd of filtered) {
      const list = catMap.get(cmd.category) || [];
      list.push(cmd);
      catMap.set(cmd.category, list);
    }
    for (const [category, items] of catMap) {
      groups.push({ category, items });
    }
    return groups;
  }, [filtered]);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const cmd = filtered[selectedIndex];
    if (cmd) {
      onClose();
      // Defer execution so the palette closes first
      setTimeout(() => cmd.action(), 50);
    }
  }, [filtered, selectedIndex, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      executeSelected();
      return;
    }
  }, [filtered.length, executeSelected, onClose]);

  if (!isOpen) return null;

  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[480px] max-h-[60vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="px-4 py-3 border-b border-gray-100">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="w-full text-sm text-gray-800 placeholder-gray-400 outline-none"
            autoFocus
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">
              No commands found
            </div>
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category}>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">
                  {category}
                </div>
                {items.map((cmd) => {
                  const idx = flatIdx++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-selected={isSelected}
                      onClick={() => {
                        onClose();
                        setTimeout(() => cmd.action(), 50);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full px-4 py-2 text-sm text-left flex items-center justify-between transition-colors ${
                        isSelected ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span>{cmd.label}</span>
                      {cmd.shortcut && (
                        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {cmd.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400 flex items-center gap-3">
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">\u2191\u2193</kbd> Navigate</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">\u21B5</kbd> Execute</span>
          <span><kbd className="px-1 py-0.5 bg-gray-100 rounded text-[9px]">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

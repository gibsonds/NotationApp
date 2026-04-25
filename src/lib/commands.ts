/**
 * Command registry — central list of all user-facing actions.
 * Used by MenuBar, CommandPalette, and keyboard shortcut dispatch.
 */

export interface Command {
  id: string;
  label: string;
  category: "file" | "edit" | "view" | "tools" | "navigate";
  shortcut?: string;           // display hint e.g. "Cmd+Z"
  execute: () => void;
  enabled?: () => boolean;     // default: always enabled
}

export interface CommandRegistry {
  commands: Command[];
  execute: (id: string) => void;
  getCommand: (id: string) => Command | undefined;
  getByCategory: (category: Command["category"]) => Command[];
}

export function createRegistry(commands: Command[]): CommandRegistry {
  const map = new Map(commands.map(c => [c.id, c]));
  return {
    commands,
    execute: (id: string) => {
      const cmd = map.get(id);
      if (cmd && (cmd.enabled?.() ?? true)) cmd.execute();
    },
    getCommand: (id: string) => map.get(id),
    getByCategory: (cat) => commands.filter(c => c.category === cat),
  };
}

/** Parse shortcut string into KeyboardEvent-compatible check */
export function matchesShortcut(shortcut: string, e: KeyboardEvent): boolean {
  const parts = shortcut.toLowerCase().split("+");
  const key = parts[parts.length - 1];
  const needsMeta = parts.includes("cmd") || parts.includes("meta");
  const needsCtrl = parts.includes("ctrl");
  const needsShift = parts.includes("shift");
  const needsAlt = parts.includes("alt");

  const metaOk = needsMeta ? e.metaKey : !e.metaKey;
  const ctrlOk = needsCtrl ? e.ctrlKey : !needsMeta && !e.ctrlKey; // allow Ctrl as Cmd on non-Mac
  const shiftOk = needsShift ? e.shiftKey : !e.shiftKey;
  const altOk = needsAlt ? e.altKey : !e.altKey;

  // On Mac, Cmd maps to metaKey. On Windows/Linux, Ctrl maps to ctrlKey.
  // "Cmd" in shortcut string should match either.
  const modOk = needsMeta
    ? (e.metaKey || e.ctrlKey) && shiftOk && altOk
    : metaOk && ctrlOk && shiftOk && altOk;

  return modOk && e.key.toLowerCase() === key;
}

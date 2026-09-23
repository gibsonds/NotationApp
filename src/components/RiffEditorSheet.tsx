"use client";

// ── Riff editor ─────────────────────────────────────────────────────────────
//
// ASCII tab is the entry method, and deliberately the first one built: every
// riff you'd want to record is already written that way somewhere, it's the
// one form that works entirely from the keyboard, and it round-trips — the
// same text comes back when you reopen the riff, because `riffToAsciiTab` is
// the inverse of `parseAsciiTab`.
//
// Rhythm is the one thing ASCII tab genuinely can't carry. The parser infers
// it from column spacing and says so in the warnings rather than pretending to
// be sure.

import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import RiffTabStaff from "@/components/RiffTabStaff";
import { parseAsciiTab, riffToAsciiTab } from "@/lib/riff-ascii";
import { DEFAULT_TUNING, type Riff } from "@/lib/schema";
import { useScoreStore } from "@/store/score-store";

/** A blank six-string grid, so a new riff opens on something typeable rather
 *  than an empty box. */
const BLANK_TAB = ["e|--------|", "B|--------|", "G|--------|", "D|--------|", "A|--------|", "E|--------|"].join("\n");

export default function RiffEditorSheet({
  riff,
  anchor,
  onClose,
}: {
  /** Existing riff being edited, or undefined when creating. */
  riff?: Riff;
  /** Where a NEW riff attaches. Ignored when `riff` is given. */
  anchor: { sectionId: string; lineIdx: number };
  onClose: () => void;
}) {
  const applyPatches = useScoreStore((s) => s.applyPatches);
  const score = useScoreStore((s) => s.score);
  const timeSignature = score?.timeSignature;

  const [label, setLabel] = useState(riff?.label ?? "Riff");
  const [ascii, setAscii] = useState(() => (riff ? riffToAsciiTab(riff) : BLANK_TAB));
  const textRef = useRef<HTMLTextAreaElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the label on a new riff (it needs naming), the tab on an edit.
    if (riff) textRef.current?.focus();
    else {
      labelRef.current?.focus();
      labelRef.current?.select();
    }
  }, [riff]);

  // Live preview. Parsing on every keystroke is fine — it's a pure function
  // over a few hundred characters.
  const parsed = useMemo(
    () => parseAsciiTab(ascii, { timeSignature, tuning: riff?.tuning }),
    [ascii, timeSignature, riff?.tuning],
  );

  const previewRiff: Riff = useMemo(
    () => ({
      id: riff?.id ?? "preview",
      label: label || "Riff",
      kind: "tab",
      tuning: parsed.tuning.length ? parsed.tuning : [...DEFAULT_TUNING],
      anchor: riff?.anchor ?? { sectionId: anchor.sectionId, lineIdx: anchor.lineIdx },
      bars: parsed.bars,
      ...(timeSignature ? { timeSignature } : {}),
      visibility: riff?.visibility ?? "shared",
      source: riff?.source ?? "ascii",
      createdAt: riff?.createdAt ?? 0,
    }),
    [riff, label, parsed, anchor, timeSignature],
  );

  const noteCount = parsed.bars.reduce(
    (n, b) => n + b.events.reduce((m, e) => m + e.notes.length, 0),
    0,
  );
  const canSave = noteCount > 0;

  const save = () => {
    if (!canSave) return;
    const name = label.trim() || "Riff";
    if (riff) {
      applyPatches([
        {
          op: "update_riff",
          id: riff.id,
          updates: { label: name, bars: parsed.bars, tuning: previewRiff.tuning },
          // Stamped here, never inside applyPatch — that function is pure and
          // is replayed by undo/redo.
          updatedAt: Date.now(),
        },
      ]);
    } else {
      applyPatches([
        {
          op: "add_riff_from_ascii",
          riff: {
            id: `riff-${uuidv4()}`,
            label: name,
            anchor: { sectionId: anchor.sectionId, lineIdx: anchor.lineIdx },
            createdAt: Date.now(),
          },
          ascii,
        },
      ]);
    }
    onClose();
  };

  const remove = () => {
    if (!riff) return;
    if (!window.confirm(`Delete the riff "${riff.label}"? This can be undone with Cmd+Z.`)) return;
    applyPatches([{ op: "remove_riff", id: riff.id }]);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/40 flex items-start justify-center pt-[10vh] print-hide"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-label={riff ? `Edit riff ${riff.label}` : "Add riff"}
        className="w-[560px] max-w-[92vw] max-h-[80vh] overflow-auto rounded-xl bg-[#12121f] border border-pink-500/40 text-gray-100 shadow-2xl"
        style={{ ["--riff-bg" as string]: "#12121f" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-white/10">
          <span aria-hidden className="text-pink-300">♪</span>
          <h2 className="text-sm font-medium flex-1">{riff ? "Edit riff" : "Add riff"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 sm:w-8 sm:h-8 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 active:bg-white/20"
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="block text-xs text-gray-400 mb-1">Name</span>
            <input
              ref={labelRef}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#0f0f1f] border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Intro riff"
              aria-label="Riff name"
            />
          </label>

          <label className="block">
            <span className="block text-xs text-gray-400 mb-1">
              Tab — paste it, or type over the grid
            </span>
            <textarea
              ref={textRef}
              value={ascii}
              onChange={(e) => setAscii(e.target.value)}
              rows={8}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              // text-base keeps iOS Safari from zooming the page on focus.
              className="w-full px-3 py-2 text-base rounded-lg bg-[#0f0f1f] border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 whitespace-pre overflow-x-auto"
              style={{ fontFamily: "ui-monospace, monospace" }}
              aria-label="ASCII tab"
            />
          </label>

          <div>
            <div className="text-xs text-gray-400 mb-1">Preview</div>
            <div className="rounded-lg border border-white/10 px-3 py-2 overflow-x-auto">
              {canSave ? (
                <RiffTabStaff riff={previewRiff} />
              ) : (
                <p className="text-sm text-gray-500 py-3">
                  No frets read yet. Type fret numbers on the dashes — e.g.{" "}
                  <code className="text-pink-300">e|--3--5--|</code> — and the tab appears here.
                </p>
              )}
            </div>
          </div>

          {parsed.warnings.length > 0 && (
            <ul className="text-[11px] text-amber-300/90 space-y-1 list-disc pl-4">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <p className="text-[11px] text-gray-500">
            Rhythm is guessed from how far apart the frets sit, since tab doesn&rsquo;t
            record it. Space them out to change it.
          </p>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          {riff && (
            <button
              type="button"
              onClick={remove}
              className="px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 active:bg-red-500/20 rounded-lg"
            >
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:bg-white/10 active:bg-white/20 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            title={canSave ? "Save (⌘⏎)" : "Add at least one fret number first"}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
          >
            {riff ? "Save" : "Add riff"}
          </button>
        </div>
      </div>
    </div>
  );
}

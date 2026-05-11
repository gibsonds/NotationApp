"use client";

import { useState, useEffect, useRef } from "react";
import { getAnnotationLabels, saveAnnotationLabel } from "@/lib/annotation-labels";
import type { Annotation } from "@/lib/schema";

type Color = Annotation["color"];
type Visibility = Annotation["visibility"];

interface AnnotationPopoverProps {
  anchorX: number;
  anchorY: number;
  initial?: Annotation;
  onSave: (data: { text: string; color: Color; visibility: Visibility; label: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const COLOR_OPTIONS: { value: Color; bg: string; ring: string }[] = [
  { value: "yellow", bg: "bg-yellow-300", ring: "ring-yellow-500" },
  { value: "blue",   bg: "bg-blue-300",   ring: "ring-blue-500" },
  { value: "pink",   bg: "bg-pink-300",   ring: "ring-pink-500" },
  { value: "green",  bg: "bg-green-300",  ring: "ring-green-500" },
];

export default function AnnotationPopover({
  anchorX,
  anchorY,
  initial,
  onSave,
  onDelete,
  onClose,
}: AnnotationPopoverProps) {
  const [text, setText] = useState(initial?.text ?? "");
  const [color, setColor] = useState<Color>(initial?.color ?? "yellow");
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? "shared");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabelMode, setNewLabelMode] = useState(false);
  const [newLabelText, setNewLabelText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLabels(getAnnotationLabels());
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({ text: text.trim(), color, visibility, label });
  };

  const handleNewLabel = () => {
    const trimmed = newLabelText.trim();
    if (!trimmed) { setNewLabelMode(false); return; }
    saveAnnotationLabel(trimmed);
    setLabels(getAnnotationLabels());
    setLabel(trimmed);
    setNewLabelMode(false);
    setNewLabelText("");
  };

  // Clamp position so popover stays within the score container
  const leftPct = Math.min(Math.max(anchorX * 100, 20), 80);
  const topPct = anchorY * 100;
  const above = topPct > 40;

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 z-40"
        style={{ pointerEvents: "auto" }}
        onClick={onClose}
      />

      {/* Popover */}
      <div
        className="absolute z-50 bg-white rounded-xl shadow-2xl border border-gray-200 w-72"
        style={{
          left: `${leftPct}%`,
          top: above ? `${topPct}%` : `${topPct}%`,
          transform: above
            ? "translate(-50%, calc(-100% - 16px))"
            : "translate(-50%, 16px)",
          pointerEvents: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Color swatches */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setColor(c.value)}
              className={`w-7 h-7 rounded-full ${c.bg} transition-transform ${
                color === c.value ? `ring-2 ring-offset-1 ${c.ring} scale-110` : "hover:scale-110"
              }`}
              title={c.value}
            />
          ))}

          {/* Visibility toggle */}
          <div className="ml-auto flex rounded-lg overflow-hidden border border-gray-200 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setVisibility("shared")}
              className={`px-2.5 py-1 transition-colors ${
                visibility === "shared"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              Shared
            </button>
            <button
              type="button"
              onClick={() => setVisibility("personal")}
              className={`px-2.5 py-1 transition-colors ${
                visibility === "personal"
                  ? "bg-purple-600 text-white"
                  : "bg-white text-gray-500 hover:bg-gray-50"
              }`}
            >
              Personal
            </button>
          </div>
        </div>

        {/* Text area */}
        <div className="px-4 pb-2">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
            }}
            rows={3}
            placeholder="Add a note…"
            className="w-full text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Label row */}
        <div className="px-4 pb-3">
          {newLabelMode ? (
            <div className="flex gap-1">
              <input
                autoFocus
                type="text"
                value={newLabelText}
                onChange={(e) => setNewLabelText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewLabel();
                  if (e.key === "Escape") { setNewLabelMode(false); setNewLabelText(""); }
                }}
                placeholder="Label name"
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleNewLabel}
                className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setNewLabelMode(false); setNewLabelText(""); }}
                className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          ) : (
            <select
              value={label}
              onChange={(e) => {
                if (e.target.value === "__new__") { setNewLabelMode(true); }
                else setLabel(e.target.value);
              }}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
            >
              <option value="">No label</option>
              {labels.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
              <option value="__new__">New label…</option>
            </select>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!text.trim()}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {initial ? "Save" : "Add"}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="py-2 px-3 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-3 text-sm text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

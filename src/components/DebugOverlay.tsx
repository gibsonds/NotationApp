"use client";

import { useEffect, useState, useCallback } from "react";
import { getEvents, clearEvents, type AnalyticsEvent } from "@/lib/analytics";

const DEBUG_FLAG_KEY = "notation-app-debug";
const VISIBLE_EVENT_COUNT = 20;

// Show the overlay when either ?debug=1 is in the URL, or
// localStorage["notation-app-debug"] === "true". Pressing Ctrl+Shift+D
// toggles the flag (and the overlay).
function readInitialVisibility(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") return true;
    return window.localStorage.getItem(DEBUG_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

function setPersistedFlag(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(DEBUG_FLAG_KEY, "true");
    else window.localStorage.removeItem(DEBUG_FLAG_KEY);
  } catch {
    // ignore
  }
}

export default function DebugOverlay() {
  const [visible, setVisible] = useState(false);
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);

  // Set initial visibility once mounted. Initial state is `false` so the
  // server-rendered HTML matches; we then read the URL/localStorage on the
  // client and toggle if needed. The setState-in-effect is intentional —
  // it's the SSR-safe pattern for reading browser-only state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(readInitialVisibility());
  }, []);

  // Refresh the event list when the overlay becomes visible, and subscribe
  // to logEvent's window CustomEvent so the list stays live. The initial
  // setEvents pulls the persisted buffer — needed because the analytics
  // store is an external system, not React state.
  useEffect(() => {
    if (!visible) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents(getEvents());
    const onChange = () => setEvents(getEvents());
    window.addEventListener("notation-app-analytics", onChange);
    return () => window.removeEventListener("notation-app-analytics", onChange);
  }, [visible]);

  // Ctrl+Shift+D toggle. Persists the flag so a refresh keeps state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        // Skip when typing in an input/contenteditable so we don't hijack
        // the user's text editing.
        const t = e.target;
        const isText =
          t instanceof HTMLInputElement ||
          t instanceof HTMLTextAreaElement ||
          (t instanceof HTMLElement && t.isContentEditable);
        if (isText) return;
        e.preventDefault();
        setVisible((v) => {
          const next = !v;
          setPersistedFlag(next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onClear = useCallback(() => {
    clearEvents();
    setEvents([]);
  }, []);

  if (!visible) return null;

  const recent = events.slice(-VISIBLE_EVENT_COUNT).reverse();

  return (
    <div
      className="fixed bottom-3 right-3 z-50 w-72 max-h-80 rounded-lg shadow-lg flex flex-col font-mono text-[10px] border border-white/10"
      style={{ backgroundColor: "rgba(10, 10, 25, 0.85)", color: "#d1d5db", backdropFilter: "blur(4px)" }}
      role="status"
      aria-label="Analytics debug overlay"
    >
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/10">
        <span className="font-semibold uppercase tracking-wider text-gray-400">
          Analytics ({events.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
            title="Clear all events"
          >
            Clear
          </button>
          <button
            onClick={() => {
              setVisible(false);
              setPersistedFlag(false);
            }}
            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-gray-300 transition-colors"
            title="Hide (Ctrl+Shift+D to reopen)"
          >
            ×
          </button>
        </div>
      </div>
      <ul className="overflow-y-auto flex-1 px-2 py-1 space-y-0.5">
        {recent.length === 0 ? (
          <li className="text-gray-500 italic px-1 py-2">No events yet.</li>
        ) : (
          recent.map((ev, i) => (
            <li key={`${ev.t}-${i}`} className="flex gap-2 leading-tight">
              <span className="text-gray-500 shrink-0 tabular-nums">
                {formatTimestamp(ev.t)}
              </span>
              <span className="text-gray-200 truncate">{ev.e}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

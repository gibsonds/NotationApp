"use client";

import { useEffect, useRef, useState } from "react";
import { beginSignIn } from "@/lib/auth";
import { SongbookSwitcher } from "@/components/SongbookSwitcher";

/** No song rows or sync controls are rendered until a verified book is selected. */
export default function SongbookSelectionState({ onClose, signedIn, verified, hasBooks }: {
  onClose: () => void;
  signedIn: boolean;
  verified: boolean;
  hasBooks: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    const target = panel.current?.querySelector<HTMLElement>("select:not(:disabled)") ??
      panel.current?.querySelector<HTMLElement>("button[data-primary]") ?? panel.current?.querySelector<HTMLElement>("button");
    target?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !panel.current?.querySelector('[role="dialog"]')) {
        event.preventDefault(); event.stopPropagation(); onClose();
      }
    };
    // Nested songbook sheets handle Escape during capture, before this parent.
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [onClose]);
  return <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center pt-[12vh] p-4" onClick={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label="My Songs" className="w-[800px] max-w-[92vw] bg-white rounded-xl shadow-2xl text-gray-800" onKeyDown={event => {
      if (event.key !== "Tab" || (event.target as HTMLElement).closest('[role="dialog"]') !== event.currentTarget) return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)");
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header className="px-5 py-3 border-b flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">My Songs</h2>
        {signedIn && <SongbookSwitcher onSwitched={() => {}} />}
        <button type="button" aria-label="Close My Songs" onClick={onClose} className="ml-auto w-11 h-11 rounded-lg hover:bg-gray-100">×</button>
      </header>
      <div className="px-5 py-6 space-y-3 text-sm">
        <p>{!signedIn ? "Sign in to see your songbooks." : verified && hasBooks
          ? "Choose a songbook above to see its songs."
          : "Your songbooks are not ready yet. Refresh to check again."}</p>
        {!signedIn && <button type="button" data-primary aria-label="Sign in to Charts" onClick={() => {
          setError(""); void beginSignIn().catch(() => setError("Could not start sign-in. Please try again."));
        }} className="min-h-11 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">Sign in</button>}
        {signedIn && (!verified || !hasBooks) && <button type="button" data-primary onClick={() => window.location.reload()}
          className="min-h-11 px-4 py-2 text-sm rounded-lg text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500">Refresh songbooks</button>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
      </div>
      <footer className="px-5 py-3 border-t flex justify-end"><button type="button" onClick={onClose}
        className="min-h-11 px-4 py-2 text-sm rounded-lg hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">Close</button></footer>
    </div>
  </div>;
}

"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AUTH_ENABLED, beginSignIn, getSnapshot, signOut, subscribe } from "@/lib/auth";
import { songbookScopeIsCurrent } from "@/lib/songbook-storage";

/** Session details are deliberately not reconstructed from cached JWT claims,
 * email domains, browser state, book names or an assumed upstream provider. */
export default function AccountStatus() {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const title = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); if (auth.verifiedAccount) setError(""); }, [auth.status, auth.verifiedAccount]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    close.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
  if (!AUTH_ENABLED) return null;
  if (!songbookScopeIsCurrent()) return <span role="status" className="ml-2 text-xs text-gray-400">Updating account…</span>;
  const leave = (clear = false) => { void signOut(clear).catch(err => setError(err.message)); };
  if (auth.status !== "signed-in" || !auth.claims) return <span className="ml-2">
    <button onClick={() => void beginSignIn()} className="min-h-11 px-2.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded">
      {auth.status === "expired" ? "Session expired — sign in" : "Sign in"}
    </button>
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}
  </span>;
  const book = auth.memberships.find(m => m.songbookId === auth.activeSongbookId);
  return <>
    <span className="flex flex-wrap min-w-0 max-w-full items-center gap-1.5 ml-2 text-xs text-gray-400">
      <span>Signed in</span>
      <button type="button" aria-label="Account details" aria-haspopup="dialog" onClick={() => setOpen(true)} className="min-h-11 px-2 hover:text-gray-200 hover:bg-white/10 rounded">Account</button>
      {book && <span className="max-w-[140px] truncate" title={`Songbook: ${book.name}`}>Book: {book.name}</span>}
      <button onClick={() => leave()} className="min-h-11 px-2 text-gray-500 hover:text-gray-200 hover:bg-white/10 rounded">Sign out</button>
      <button onClick={() => { if (window.confirm("Sign out and remove this app’s cached songs, drafts, and AI keys from this device? Cloud songs remain saved. Export any unsynced work first.")) leave(true); }} className="min-h-11 px-2 text-gray-500 hover:text-gray-200 rounded">Clear device</button>
      {error && <span role="alert" className="text-red-400">{error}</span>}
    </span>
    {open && createPortal(<div className="fixed inset-0 z-[120] bg-black/40 flex items-start justify-center pt-[12vh] p-4" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby={title} className="w-[560px] max-w-[92vw] bg-white rounded-xl shadow-2xl text-gray-800" onKeyDown={event => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
        <header className="px-5 py-3 border-b flex items-center justify-between"><h2 id={title} className="font-semibold">Account details</h2><button ref={close} onClick={() => setOpen(false)} aria-label="Close account details" className="w-11 h-11 rounded hover:bg-gray-100">×</button></header>
        <div className="px-5 py-4 space-y-4 text-sm">
          <p>Use the account ID to compare which Charts account is signed in on another browser. Songbook names are separate from account identity.</p>
          <dl className="space-y-3">
            <div><dt className="font-medium">Account ID</dt><dd className="break-all select-all">{auth.verifiedAccount?.sub ?? "Unavailable until this session is verified."}</dd></div>
            <div><dt className="font-medium">Name or email</dt><dd>Not provided for this session.</dd></div>
            <div><dt className="font-medium">Sign-in method</dt><dd>Not provided for this session.</dd></div>
          </dl>
          <p className="text-gray-500">Charts uses OAuth42. This session does not tell Charts whether you used Google, Apple, a code, or another sign-in method. The account ID above is not an email address.</p>
        </div>
        <footer className="px-5 py-3 border-t flex justify-end"><button onClick={() => setOpen(false)} className="min-h-11 px-4 text-sm rounded-lg hover:bg-gray-100">Close</button></footer>
      </section>
    </div>, document.body)}
  </>;
}

"use client";

import { useEffect, useState } from "react";
import { getSnapshot, setActiveSongbook } from "@/lib/auth";
import { createSongbook, createSongbookInvite, joinSongbook, listSongbookMembers, removeSongbookMember, type SongbookMember } from "@/lib/songbook-client";

type Mode = "create" | "join" | "invite" | "members";

export default function SongbookManager({ initialMode, onClose }: { initialMode: Mode; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState(() => initialMode === "join" ? new URLSearchParams(window.location.search).get("invite") ?? sessionStorage.getItem("notation-app-pending-invite") ?? "" : "");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [members, setMembers] = useState<SongbookMember[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const auth = getSnapshot();
  const book = auth.memberships.find(m => m.songbookId === auth.activeSongbookId);

  useEffect(() => {
    if (mode === "members" && book) void listSongbookMembers(book.songbookId).then(setMembers).catch(err => setError(err.message));
  }, [mode, book?.songbookId]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) onClose(); }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [busy, onClose]);

  async function submit() {
    setBusy(true); setError("");
    try {
      if (mode === "create") {
        const created = await createSongbook(value);
        setActiveSongbook(created.songbookId);
      } else if (mode === "join") {
        const joined = await joinSongbook(value);
        sessionStorage.removeItem("notation-app-pending-invite");
        const url = new URL(window.location.href); url.searchParams.delete("invite");
        window.history.replaceState(null, "", url);
        setActiveSongbook(joined.songbookId);
      } else if (book) {
        const invite = await createSongbookInvite(book.songbookId, role);
        const url = new URL(window.location.pathname, window.location.origin);
        url.searchParams.set("invite", invite.token);
        setLink(url.toString());
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update songbook."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-start justify-center pt-[12vh]" onClick={() => { if (!busy) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="songbook-manager-title" className="w-[560px] max-w-[92vw] bg-white rounded-xl shadow-xl text-gray-800" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void submit(); }}>
        <header className="px-5 py-3 border-b flex items-center justify-between">
          <h2 id="songbook-manager-title" className="font-semibold">{mode === "create" ? "New songbook" : mode === "join" ? "Join a songbook" : mode === "members" ? `Access to ${book?.name ?? "songbook"}` : `Invite to ${book?.name ?? "songbook"}`}</h2>
          <button type="button" aria-label="Close songbook dialog" disabled={busy} onClick={onClose} className="w-11 h-11 text-gray-500 hover:bg-gray-100 rounded-lg">×</button>
        </header>
        <div className="px-5 py-4 space-y-3">
          {mode === "members" ? <>
            <p className="text-sm text-gray-500">Accounts are identified by a short ID; we don’t store names or emails. Removing someone also blocks their older invitation links.</p>
            {members.map(member => <div key={member.sub} className="flex items-center justify-between px-3 py-3 border rounded-lg">
              <span className="text-sm">{member.sub === auth.claims?.sub ? "You" : `Account ${member.sub.slice(-8)}`} · {member.role}</span>
              {member.role !== "owner" && <button type="button" disabled={busy} className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg" onClick={async () => {
                if (!book || !window.confirm(`Remove account ${member.sub.slice(-8)} from this songbook? Their existing downloaded copies cannot be recalled.`)) return;
                setBusy(true); setError("");
                try { await removeSongbookMember(book.songbookId, member.sub); setMembers(await listSongbookMembers(book.songbookId)); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
              }}>Remove access</button>}
            </div>)}
          </> : mode !== "invite" ? <>
            <label className="block text-sm">{mode === "create" ? "Songbook name" : "Invitation link or code"}
              <input autoFocus value={value} onChange={e => setValue(e.target.value)} required maxLength={mode === "create" ? 120 : 2048} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <p className="text-sm text-gray-500">{mode === "create" ? "Create a separate collection for a person, band, or project. Your current book and editor draft are saved separately." : "Use the invitation supplied by the songbook’s owner."}</p>
          </> : <>
            <label className="block text-sm">The invited person can
              <select value={role} disabled={!!link} onChange={e => setRole(e.target.value as typeof role)} className="ml-2 border border-gray-300 rounded-lg p-2">
                <option value="viewer">View songs</option><option value="editor">Edit songs</option>
              </select>
            </label>
            <p className="text-sm text-gray-500">This link can be used once and expires after 48 hours. Share it only with the person you want to invite.</p>
            {link && <label className="block text-sm">Invitation link
              <input readOnly value={link} onFocus={e => e.target.select()} className="mt-1 w-full border rounded-lg px-3 py-2" />
            </label>}
          </>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
        <footer className="px-5 py-3 border-t flex items-center justify-end gap-2">
          {mode === "create" && <button type="button" disabled={busy} onClick={() => { setMode("join"); setValue(""); setError(""); }} className="mr-auto px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Join instead</button>}
          <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">{link ? "Done" : "Cancel"}</button>
          {mode === "members" ? null : link ? <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("Select and copy the invitation link above."); } }} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg">{copied ? "Copied" : "Copy link"}</button> :
            <button type="submit" disabled={busy || (mode !== "invite" && !value.trim())} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg">{busy ? "Working…" : mode === "create" ? "Create songbook" : mode === "join" ? "Join songbook" : "Create invitation"}</button>}
        </footer>
      </form>
    </div>
  );
}

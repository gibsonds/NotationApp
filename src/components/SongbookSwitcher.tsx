"use client";

/**
 * Songbook picker + legacy-import banner for the authenticated instance
 * (issues #74/#76). Both render nothing on the legacy build
 * (AUTH_ENABLED=false) so MySongsModal behaves exactly as before there.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  AUTH_ENABLED,
  getSnapshot,
  importLegacyDevice,
  legacyImportDone,
  loadMe,
  setActiveSongbook,
  subscribe,
} from "@/lib/auth";
import { extractJoinCode, getDeviceId } from "@/lib/song-cloud";

/** Dropdown of the user's songbooks; switching re-syncs the song list. */
export function SongbookSwitcher({ onSwitched }: { onSwitched: () => void }) {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!AUTH_ENABLED || auth.status !== "signed-in" || auth.memberships.length === 0) {
    return null;
  }
  const active = auth.activeSongbookId ?? auth.memberships[0].songbookId;
  const role = auth.memberships.find((m) => m.songbookId === active)?.role;
  return (
    <span className="flex items-center gap-1.5">
      <select
        value={active}
        onChange={(e) => {
          setActiveSongbook(e.target.value);
          onSwitched();
        }}
        className="text-sm border border-gray-300 rounded-lg px-2 py-1 text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        title="Switch songbook"
      >
        {auth.memberships.map((m) => (
          <option key={m.songbookId} value={m.songbookId}>
            {m.name}
          </option>
        ))}
      </select>
      {role && role !== "owner" && (
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
          {role}
        </span>
      )}
    </span>
  );
}

/** One-time offer to copy this browser's legacy (device-id) songs into the
 *  signed-in account. Dismissable; hidden once an import has completed. */
export function LegacyImportBanner({ onImported }: { onImported: () => void }) {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<string | null>(null);

  // Self-heal: if /me failed at startup (network blip), memberships stay
  // empty and imports would have nowhere to land — retry when the banner
  // becomes visible.
  const needsMe =
    AUTH_ENABLED && auth.status === "signed-in" && auth.memberships.length === 0;
  useEffect(() => {
    if (needsMe) void loadMe();
  }, [needsMe]);

  if (!AUTH_ENABLED || auth.status !== "signed-in" || dismissed || legacyImportDone()) {
    return null;
  }

  const handleImport = async () => {
    // The old songs live under the OLD site's device id, and this (new)
    // origin mints its own — so the pasted share link/code from the old
    // site is the real source. The current origin's device id is only a
    // sensible default in local dev, where both instances share
    // localhost:3000.
    const code = paste.trim() ? extractJoinCode(paste) : getDeviceId();
    if (!code) {
      setResult("That doesn't look like a share link or device code — paste the whole link or the raw code.");
      return;
    }
    if (!auth.activeSongbookId) {
      setResult("Your songbook is still loading — try again in a few seconds.");
      void loadMe();
      return;
    }
    setBusy(true);
    const out = await importLegacyDevice(code);
    setBusy(false);
    if (out) {
      setResult(
        `Imported ${out.songs} song${out.songs === 1 ? "" : "s"} (with ${out.versions} history versions).`
      );
      onImported();
      setTimeout(() => setDismissed(true), 6000);
    } else {
      setResult(
        "Import failed — check the code and try again (another account may have already claimed it)."
      );
    }
  };

  return (
    <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 text-sm text-blue-900">
      <div className="flex items-center gap-3">
        <span className="flex-1">
          {result ??
            "Bring in your songs from the old site: open its My Songs → Sync settings, copy the share link (or raw code), and paste it here. Nothing is deleted from the old site."}
        </span>
        {!result && (
          <button
            onClick={() => setDismissed(true)}
            className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 rounded-lg shrink-0"
          >
            Not now
          </button>
        )}
      </div>
      {!result && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="paste share link or device code from the old site"
            className="flex-1 px-2 py-1.5 text-xs bg-white border border-blue-200 rounded text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleImport}
            disabled={busy || !paste.trim()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg shrink-0"
          >
            {busy ? "Importing…" : "Import songs"}
          </button>
        </div>
      )}
    </div>
  );
}

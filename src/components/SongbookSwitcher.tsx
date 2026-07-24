"use client";

/**
 * Songbook picker + legacy-import banner for the authenticated instance
 * (issues #74/#76). Both render nothing on the legacy build
 * (AUTH_ENABLED=false) so MySongsModal behaves exactly as before there.
 */

import { useState, useSyncExternalStore } from "react";
import {
  AUTH_ENABLED,
  getSnapshot,
  importLegacyDevice,
  legacyImportDone,
  setActiveSongbook,
  subscribe,
} from "@/lib/auth";
import { getDeviceId } from "@/lib/song-cloud";

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
  const [result, setResult] = useState<string | null>(null);

  if (
    !AUTH_ENABLED ||
    auth.status !== "signed-in" ||
    !auth.activeSongbookId ||
    dismissed ||
    legacyImportDone()
  ) {
    return null;
  }

  const handleImport = async () => {
    setBusy(true);
    const out = await importLegacyDevice(getDeviceId());
    setBusy(false);
    if (out) {
      setResult(
        `Imported ${out.songs} song${out.songs === 1 ? "" : "s"} (with ${out.versions} history versions).`
      );
      onImported();
      setTimeout(() => setDismissed(true), 4000);
    } else {
      setResult("Import failed — try again from Sync settings, or ask for help.");
    }
  };

  return (
    <div className="px-5 py-2.5 bg-blue-50 border-b border-blue-100 flex items-center gap-3 text-sm text-blue-900">
      <span className="flex-1">
        {result ??
          "Bring your existing songs into this account? Your songs from the previous (device-based) sync can be copied in — nothing is deleted."}
      </span>
      {!result && (
        <>
          <button
            onClick={handleImport}
            disabled={busy}
            className="px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded-lg"
          >
            {busy ? "Importing…" : "Import songs"}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 rounded-lg"
          >
            Not now
          </button>
        </>
      )}
    </div>
  );
}

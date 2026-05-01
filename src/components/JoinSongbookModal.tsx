"use client";

import { useState } from "react";
import { setSongs as writeLocalSongs } from "@/lib/song-bank";
import { setDeviceId, syncSongbook } from "@/lib/song-cloud";

interface JoinSongbookModalProps {
  code: string;
  onCancel: () => void;
  onJoined: () => void;
}

/**
 * Shown when the URL contains `?join=<deviceId>` and the encoded id differs
 * from this browser's. Joining replaces the local song list with the
 * shared songbook's contents.
 */
export default function JoinSongbookModal({
  code,
  onCancel,
  onJoined,
}: JoinSongbookModalProps) {
  const [busy, setBusy] = useState(false);

  const handleJoin = async () => {
    if (busy) return;
    setBusy(true);
    setDeviceId(code);
    writeLocalSongs([]);
    try {
      await syncSongbook();
    } catch {
      /* syncSongbook is best-effort; if it returned offline the join still
         took effect locally and will reconcile next time. */
    }
    onJoined();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-black/40"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[440px] flex flex-col overflow-hidden text-gray-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold">Join a shared songbook?</h2>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700 space-y-3">
          <p>
            You followed a share link from another device. Joining will load that
            device's songs onto this browser.
          </p>
          <p className="text-amber-700">
            Songs currently saved on this browser will be replaced.
          </p>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 text-sm text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleJoin}
            disabled={busy}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400 rounded-lg transition-colors"
          >
            {busy ? "Joining…" : "Join songbook"}
          </button>
        </div>
      </div>
    </div>
  );
}

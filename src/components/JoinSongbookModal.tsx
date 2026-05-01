"use client";

import { useState } from "react";
import { setDeviceId, syncSongbook } from "@/lib/song-cloud";

interface JoinSongbookModalProps {
  code: string;
  onCancel: () => void;
  onJoined: () => void;
}

/**
 * Shown when the URL contains `?join=<deviceId>` and the encoded id differs
 * from this browser's. Joining points this browser at the linked device's
 * songbook AND merges this browser's existing local songs in (they get
 * pushed up under the new id during the next sync).
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
    // Switch identity first; syncSongbook() then pulls the linked device's
    // songs AND auto-pushes any local-only songs (this browser's existing
    // songs) up under the new id, so neither side loses content.
    setDeviceId(code);
    try {
      await syncSongbook();
    } catch {
      /* best-effort; if offline the new id is set locally and will
         reconcile on the next sync */
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
            You followed a share link from another device. Joining links this
            browser to that device's songbook.
          </p>
          <p>
            Songs currently saved on this browser are kept and shared into the
            joined songbook so neither side loses anything.
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

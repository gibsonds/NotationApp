"use client";

import { useEffect, useState } from "react";
import type { SongBankEntry } from "@/lib/song-bank";

/**
 * Choose how to handle an imported songbook JSON file:
 *
 *  - **Fork**: replace local songs AND generate a brand-new deviceId
 *    so subsequent cloud syncs land in a fresh, isolated cloud
 *    songbook. Use this to experiment on the same songs without
 *    polluting your shared / primary songbook.
 *
 *  - **Replace**: replace local songs but KEEP the current deviceId.
 *    Next sync pushes these songs up to your existing cloud
 *    songbook (e.g. restoring from a backup file you previously
 *    exported).
 *
 * Either way the current local song list is wiped; recommend the
 * user back it up first via File → Export all songs.
 */
export interface ImportSongbookPayload {
  fileName: string;
  songs: SongBankEntry[];
  /** Whatever metadata the export wrote (exportedAt, deviceId, etc.).
   *  Surfaced to help the user spot mismatched files. */
  exportedAt?: string;
  sourceDeviceId?: string;
}

interface Props {
  payload: ImportSongbookPayload;
  currentDeviceId: string;
  currentLocalCount: number;
  onCancel: () => void;
  onFork: () => void;
  onReplace: () => void;
}

export default function ImportSongbookDialog({
  payload,
  currentDeviceId,
  currentLocalCount,
  onCancel,
  onFork,
  onReplace,
}: Props) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!busy) onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const previewTitles = payload.songs.slice(0, 8).map((s) => s.title);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-start justify-center pt-[10vh] bg-black/40"
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onCancel();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-200 w-[560px] max-w-[92vw] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            Import {payload.songs.length} song{payload.songs.length === 1 ? "" : "s"}
            {payload.fileName ? <span className="text-gray-500 font-normal"> from {payload.fileName}</span> : null}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            This replaces your current local songbook ({currentLocalCount} song{currentLocalCount === 1 ? "" : "s"}).
            Tip: File → Export all songs first if you haven&rsquo;t backed up.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {(payload.exportedAt || payload.sourceDeviceId) && (
            <div className="text-xs text-gray-500 font-mono space-y-0.5">
              {payload.exportedAt && (
                <div>Exported: {payload.exportedAt}</div>
              )}
              {payload.sourceDeviceId && (
                <div className="truncate">
                  Source device: {payload.sourceDeviceId}
                  {payload.sourceDeviceId === currentDeviceId && (
                    <span className="text-amber-700 ml-2">(same as this device)</span>
                  )}
                </div>
              )}
            </div>
          )}
          <ul className="text-xs text-gray-700 space-y-0.5">
            {previewTitles.map((t, i) => (
              <li key={i} className="truncate">• {t}</li>
            ))}
            {payload.songs.length > 8 && (
              <li className="italic text-gray-400">…and {payload.songs.length - 8} more</li>
            )}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 space-y-2 bg-gray-50">
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              onFork();
            }}
            disabled={busy}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 rounded-lg text-left"
          >
            <div className="font-semibold">Fork — isolate this device (recommended)</div>
            <div className="text-xs font-normal opacity-80 mt-0.5">
              Generates a brand-new device id. Changes here won&rsquo;t reach your other devices. Use to experiment on the same songs without affecting your shared songbook.
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              onReplace();
            }}
            disabled={busy}
            className="w-full px-4 py-2 text-sm text-gray-800 border border-gray-300 hover:bg-gray-100 active:bg-gray-200 disabled:bg-gray-100 disabled:cursor-not-allowed rounded-lg text-left"
          >
            <div className="font-semibold">Replace — keep current device id</div>
            <div className="text-xs font-normal text-gray-500 mt-0.5">
              Loads the imported songs and pushes them to your existing shared songbook on next sync. Use to restore from a backup of THIS device.
            </div>
          </button>
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

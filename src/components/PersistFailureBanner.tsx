"use client";

import { useEffect, useState } from "react";

/**
 * Shows a persistent banner when localStorage writes are failing (usually
 * QuotaExceededError after lots of editing builds up history/messages).
 * Previously the failure was a silent console.warn — long sessions could
 * lose hours of work without the user noticing.
 *
 * Banner clears itself the next time a persist succeeds.
 */
export default function PersistFailureBanner() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onFail = (e: Event) => {
      const detail = (e as CustomEvent<{ error?: string }>).detail;
      setError(detail?.error || "Local save failed");
    };
    const onOk = () => setError(null);
    window.addEventListener("notation-persist-failed", onFail);
    window.addEventListener("notation-persist-ok", onOk);
    return () => {
      window.removeEventListener("notation-persist-failed", onFail);
      window.removeEventListener("notation-persist-ok", onOk);
    };
  }, []);

  if (!error) return null;

  return (
    <div
      role="alert"
      className="bg-red-600 text-white text-sm px-4 py-2 flex items-center gap-3 shrink-0 print-hide"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0L3.16 16.25A2 2 0 005 19z" />
      </svg>
      <div className="flex-1">
        <strong className="font-semibold">Local save is failing.</strong>{" "}
        Your browser&apos;s storage is full. Open My Songs and Save now to push to the cloud,
        then clear old saved revisions in the side panel to free space.
      </div>
      <code className="text-xs bg-red-700/60 px-2 py-0.5 rounded shrink-0 max-w-xs truncate">
        {error}
      </code>
      <button
        type="button"
        onClick={() => setError(null)}
        className="px-2 py-0.5 text-xs hover:bg-red-700 rounded shrink-0"
        aria-label="Dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

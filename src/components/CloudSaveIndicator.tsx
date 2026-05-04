"use client";

import { useEffect, useState } from "react";
import { CLOUD_ENABLED } from "@/lib/song-cloud";
import { CloudSaveEvents } from "@/lib/cloud-autosave";

/**
 * Tiny status pill showing whether the current song is synced to cloud.
 * Updates via custom events fired by cloud-autosave.ts. Replaces the
 * "I have to remember to click Save Song or I lose my work" anxiety
 * with a visible, real-time confirmation.
 */
export default function CloudSaveIndicator() {
  const [status, setStatus] = useState<"saved" | "saving" | "offline" | "idle">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!CLOUD_ENABLED) return;
    const onSaving = () => setStatus("saving");
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<{ ts?: number }>).detail;
      setStatus("saved");
      setSavedAt(detail?.ts ?? Date.now());
    };
    const onOffline = () => setStatus("offline");
    window.addEventListener(CloudSaveEvents.Saving, onSaving);
    window.addEventListener(CloudSaveEvents.Saved, onSaved);
    window.addEventListener(CloudSaveEvents.Offline, onOffline);
    return () => {
      window.removeEventListener(CloudSaveEvents.Saving, onSaving);
      window.removeEventListener(CloudSaveEvents.Saved, onSaved);
      window.removeEventListener(CloudSaveEvents.Offline, onOffline);
    };
  }, []);

  if (!CLOUD_ENABLED || status === "idle") return null;

  const fmt = (ts: number) =>
    new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const display = (() => {
    switch (status) {
      case "saving":
        return { color: "bg-blue-400", label: "Saving…" };
      case "saved":
        return {
          color: "bg-green-500",
          label: savedAt ? `Saved · ${fmt(savedAt)}` : "Saved",
        };
      case "offline":
        return { color: "bg-amber-500", label: "Offline — will sync" };
      default:
        return null;
    }
  })();

  if (!display) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-gray-400 select-none"
      title={
        status === "saved"
          ? "Pushed to cloud songbook"
          : status === "offline"
          ? "Network failure; queued for retry"
          : "Pushing to cloud…"
      }
    >
      <span className={`w-1.5 h-1.5 rounded-full ${display.color}`} aria-hidden />
      {display.label}
    </span>
  );
}

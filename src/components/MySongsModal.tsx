"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useScoreStore } from "@/store/score-store";
import { saveSnapshot } from "@/lib/autosave";
import AutosaveRecoveryDialog from "@/components/AutosaveRecoveryDialog";
import SetsPanel from "@/components/SetsPanel";
import { PickSetBody, PickSongsBody } from "@/components/AddToSetSheet";
import { getSets, SetsUpdatedEvent, songSetMembership, type SongSet } from "@/lib/song-sets";
import {
  canonicalSongTitle,
  getSongs,
  isAliasTitle,
  saveSong,
  deleteSong,
  renameSong,
  setSongFolder,
  setSongs as writeLocalSongs,
  updateSong,
  SongBankEntry,
} from "@/lib/song-bank";
import {
  CLOUD_ENABLED,
  cloudDeleteSong,
  cloudPutSong,
  enqueueOffline,
  extractJoinCode,
  getDeviceId,
  isTransient,
  setDeviceId,
  syncSongbook,
  type SyncStatus as CloudSyncStatus,
} from "@/lib/song-cloud";
import { logEvent, scoreTypeOf } from "@/lib/analytics";

type SyncStatus = "idle" | CloudSyncStatus;

// Stable empty array for selectors that need a fallback. Returning `[]`
// inline from a zustand selector creates a new reference per call and
// triggers a "getSnapshot should be cached" loop.
const EMPTY_STRINGS: string[] = [];

export default function MySongsModal({ onClose }: { onClose: () => void }) {
  // Analytics: log modal open on mount.
  useEffect(() => {
    logEvent({ event: "mysongs_open" });
  }, []);
  const score = useScoreStore(s => s.score);
  const setScore = useScoreStore(s => s.setScore);
  const setUIState = useScoreStore(s => s.setUIState);
  const currentSongId = useScoreStore(s => s.uiState.currentSongId);
  // Selector returns the raw value (undefined-safe via store rehydrate
  // migration). Default applied OUTSIDE the selector against a module-
  // level constant so reference equality holds across renders.
  const collapsedFoldersRaw = useScoreStore(s => s.uiState.collapsedFolders);
  const collapsedFolders = collapsedFoldersRaw ?? EMPTY_STRINGS;
  const [songs, setSongsState] = useState<SongBankEntry[]>(() =>
    getSongs().slice().reverse()
  );
  const [saveTitle, setSaveTitle] = useState(score?.title || "");
  const [justSaved, setJustSaved] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    CLOUD_ENABLED ? "syncing" : "idle"
  );
  const [deviceId, setDeviceIdState] = useState<string>(() =>
    CLOUD_ENABLED ? getDeviceId() : ""
  );
  const [pasteCode, setPasteCode] = useState("");
  const [showSync, setShowSync] = useState(false);
  const [showRawCode, setShowRawCode] = useState(false);
  const [activeTab, setActiveTab] = useState<"songs" | "sets">("songs");
  const [linkCopied, setLinkCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  // Per-row UI state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Menu and folder picker render at FIXED position anchored to the
  // kebab button — this escapes the modal's overflow-y-auto, which was
  // clipping/swallowing taps on iPad.
  type Anchor = { entry: SongBankEntry; top: number; right: number };
  const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<Anchor | null>(null);
  const [historyForTitle, setHistoryForTitle] = useState<string | null>(null);
  // Folder-header action menu (Export as JSON / Delete all). Stored
  // as `folder: string` where "" represents the Unfiled bucket — same
  // convention as the per-song folder field.
  type FolderAnchor = { folder: string; top: number; right: number };
  const [folderMenuAnchor, setFolderMenuAnchor] = useState<FolderAnchor | null>(null);
  // Multi-select state for bulk operations (#73 follow-up). When
  // selectMode is on, rows render with leading checkboxes; the title
  // toggles selection instead of starting a rename; Load + kebab hide.
  // Esc exits.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Right-pane state machine. Replaces the previous stacked-sheet
  // approach (AddToSetSheet, BulkFolderPicker, etc. as modal-on-modal).
  // The pane lives INSIDE the modal so it's bigger, scrollable, and
  // doesn't pile chrome on top of chrome.
  //
  //  - addToSet: pickSet flow (caller pre-chose songs)
  //  - pickSongs: pickSongs flow (caller pre-chose the set)
  //  - moveFolder: bulk folder picker
  //  - null: pane closed; left pane is full-width
  type RightPaneState =
    | { kind: "addToSet"; songIds: string[] }
    | { kind: "pickSongs"; targetSetId: string }
    | { kind: "moveFolder"; songIds: string[] }
    | { kind: null };
  const [rightPane, setRightPane] = useState<RightPaneState>({ kind: null });
  const closeRightPane = () => setRightPane({ kind: null });

  // Search box state. When non-empty, the list switches from
  // folder-grouped to a flat result list (folder shown inline). Folder
  // collapse state doesn't apply mid-search. Empty string = no filter.
  const [songQuery, setSongQuery] = useState("");
  const songQueryCanon = useMemo(
    () => canonicalSongTitle(songQuery),
    [songQuery],
  );
  const filteredSongs = useMemo(() => {
    if (!songQueryCanon) return songs;
    return songs.filter((s) =>
      canonicalSongTitle(s.title).includes(songQueryCanon),
    );
  }, [songs, songQueryCanon]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Esc layering: close the right pane first, then exit select mode,
  // then let the parent modal handle Esc itself (close). One layer per
  // Esc press.
  useEffect(() => {
    if (!selectMode && rightPane.kind === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (rightPane.kind !== null) {
        e.stopPropagation();
        closeRightPane();
      } else if (selectMode) {
        e.stopPropagation();
        exitSelectMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode, rightPane.kind]);

  const openKebab = (entry: SongBankEntry, e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuAnchor({
      entry,
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  };

  const toggleFolderCollapse = (folder: string) => {
    const set = new Set(collapsedFolders);
    if (set.has(folder)) set.delete(folder);
    else set.add(folder);
    setUIState({ collapsedFolders: Array.from(set) });
  };

  // Sets list — drives the "In N sets" badge on each row so the user
  // can see at a glance whether a song is already on a setlist.
  // Subscribed to SetsUpdatedEvent so adds/removes in another tab
  // (or via the Sets panel inside this modal) flow through.
  const [sets, setSetsState] = useState<SongSet[]>(() => getSets());
  useEffect(() => {
    const refresh = () => setSetsState(getSets());
    window.addEventListener(SetsUpdatedEvent, refresh);
    return () => window.removeEventListener(SetsUpdatedEvent, refresh);
  }, []);
  // songId → list of SongSets the song appears in. Shared helper in
  // src/lib/song-sets.ts so MySongsModal (this badge) and PerformView
  // (switch-to-set chips) compute it the same way.
  const setMembership = useMemo(() => songSetMembership(sets), [sets]);

  // All distinct folder names across the bank, sorted — used by the
  // folder picker so the user doesn't have to remember/retype names.
  const folderNames = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) if (s.folder) set.add(s.folder);
    return Array.from(set).sort();
  }, [songs]);

  // Group entries by folder. Sorted: "(Unfiled)" first, then named folders
  // alphabetically; songs within a folder by savedAt newest-first.
  const grouped = useMemo(() => {
    const buckets = new Map<string, SongBankEntry[]>();
    for (const s of songs) {
      const key = s.folder || "";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(s);
    }
    const folderNames = Array.from(buckets.keys()).filter(k => k !== "").sort();
    const result: Array<{ name: string; label: string; entries: SongBankEntry[] }> = [];
    if (buckets.has("")) {
      result.push({ name: "", label: "(Unfiled)", entries: buckets.get("")! });
    }
    for (const f of folderNames) {
      result.push({ name: f, label: f, entries: buckets.get(f)! });
    }
    return result;
  }, [songs]);

  const refreshLocal = () => setSongsState(getSongs().slice().reverse());

  const runSync = async (): Promise<void> => {
    // Snapshot the LOCAL entry before sync overwrites localStorage. We
    // need this to detect whether the user has in-flight local edits
    // (open-score differs from local-entry) so we don't clobber them.
    const preLocalById = new Map(getSongs().map((e) => [e.id, e]));
    const merged = await syncSongbook({ onStatus: setSyncStatus });
    setSongsState(merged.slice().reverse());

    // Cross-device propagation: if the song currently open in the editor
    // got newer content from the cloud, replace it in the store so the
    // editor reflects the change. Without this, the My Songs list shows
    // a fresh timestamp but the editor keeps rendering the stale score
    // the user originally loaded.
    //
    // Safe-replace check: only swap when the displayed score is
    // structurally identical to what was in localStorage BEFORE sync.
    // If they differ, the user has in-flight local edits not yet
    // autosaved — don't clobber.
    if (currentSongId && score) {
      const fresh = merged.find((e) => e.id === currentSongId);
      const preLocal = preLocalById.get(currentSongId);
      if (fresh && fresh.score !== score) {
        const cloudIsNewer = JSON.stringify(fresh.score) !== JSON.stringify(score);
        const noLocalUnsavedEdits = !!preLocal && JSON.stringify(score) === JSON.stringify(preLocal.score);
        if (cloudIsNewer && noLocalUnsavedEdits) {
          setScore(fresh.score);
        }
      }
    }
  };

  useEffect(() => {
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Share links always point at the deployed Pages site so they're
  // resolvable from any device. (Using window.location would emit
  // http://localhost:3000/... when generated during local dev, which
  // the iPad can't reach.)
  const SHARE_BASE = "https://gibsonds.github.io/NotationApp/";
  const buildShareLink = (id: string): string =>
    `${SHARE_BASE}?join=${encodeURIComponent(id)}`;

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(buildShareLink(deviceId));
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard blocked — the input below shows the link as a fallback */
    }
  };

  const handleCopyDeviceId = async () => {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const handleApplyPastedCode = async () => {
    const next = extractJoinCode(pasteCode);
    if (!next || next === deviceId) return;
    setDeviceId(next);
    setDeviceIdState(next);
    setPasteCode("");
    // After switching identity, the local list is from the OLD device — wipe
    // it so we don't push old songs into the new songbook.
    writeLocalSongs([]);
    setSongsState([]);
    await runSync();
  };


  // Save logic. The default Save UPDATES the current song (matching by
  // currentSongId) instead of always creating a new entry — that's the
  // root cause of the "duplicates pile up every time I save" complaint.
  // Save As (asNew=true) explicitly creates a new entry; useful for
  // forking/copying a song.
  const performSave = async (asNew: boolean) => {
    if (!score) return;
    const title = saveTitle.trim() || score.title || "Untitled Song";

    let entry: SongBankEntry | undefined;
    const localList = getSongs();
    const existing = !asNew && currentSongId ? localList.find(s => s.id === currentSongId) : null;
    if (existing) {
      // Update in place — no new id, no duplicate.
      const updated = updateSong(existing.id, { title, score, savedAt: Date.now() });
      entry = updated || undefined;
    } else {
      saveSong(title, score);
      const fresh = getSongs();
      entry = fresh[fresh.length - 1];
    }
    refreshLocal();
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);

    if (entry) setUIState({ currentSongId: entry.id });

    if (!CLOUD_ENABLED || !entry) return;
    setSyncStatus("syncing");
    try {
      const dto = await cloudPutSong({
        id: entry.id,
        title: entry.title,
        score: entry.score,
        savedAt: entry.savedAt,
        folder: entry.folder ?? null,
        ...(entry.cloudVersion !== undefined && { expectedVersion: entry.cloudVersion }),
      });
      // Advance the local entry's cloudVersion so the autosave can keep
      // sending matching expectedVersion on subsequent edits.
      updateSong(entry.id, { cloudVersion: dto.version });
      setSyncStatus("ok");
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({
          type: "put",
          id: entry.id,
          title: entry.title,
          score: entry.score,
          savedAt: entry.savedAt,
        });
        setSyncStatus("offline");
      } else {
        setSyncStatus("ok");
        console.warn("[my-songs] cloud save failed", err);
      }
    }
  };

  const handleSave = () => {
    logEvent({ event: "mysongs_save", scoreType: scoreTypeOf(score) });
    performSave(false);
  };
  const handleSaveAs = () => {
    logEvent({ event: "mysongs_save_as", scoreType: scoreTypeOf(score) });
    performSave(true);
  };

  const handleLoad = async (entry: SongBankEntry) => {
    logEvent({ event: "mysongs_load", scoreType: scoreTypeOf(entry.score) });
    // Take an autosave snapshot of the OUTGOING score before replacing it.
    // Recovery from this snapshot is how we get back from accidental Loads
    // that overwrite unsaved work — exactly what bit us before.
    if (score) {
      try { await saveSnapshot(score); } catch { /* best-effort */ }
    }
    setScore(entry.score);
    // Auto-flip into perform mode when loading a chord-chart song. Bands
    // typically open a song to play it, not edit it; the Edit button in
    // the perform-mode top-right cluster is one tap away if they need to
    // tweak. Notation scores stay in edit mode (no perform view there).
    const isChordChart = !!(entry.score.sections && entry.score.sections.length > 0);
    setUIState({
      currentSongId: entry.id,
      ...(isChordChart && { performMode: true }),
    });
    onClose();
  };

  const startRename = (entry: SongBankEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
    setMenuAnchor(null);
  };

  const commitRename = async (entry: SongBankEntry) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next || next === entry.title) return;
    const updated = renameSong(entry.id, next);
    refreshLocal();
    if (!updated || !CLOUD_ENABLED) return;
    // Push the rename to cloud (same id, new title — replaces the entry).
    try {
      await cloudPutSong({
        id: updated.id,
        title: updated.title,
        score: updated.score,
        savedAt: updated.savedAt,
        folder: updated.folder ?? null,
      });
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({
          type: "put",
          id: updated.id,
          title: updated.title,
          score: updated.score,
          savedAt: updated.savedAt,
        });
        setSyncStatus("offline");
      }
    }
  };

  const handleMoveToFolder = (entry: SongBankEntry) => {
    // Promote the menu anchor into a picker anchor at the same position
    // so the picker drops where the menu was.
    if (!menuAnchor) return;
    setPickerAnchor({ ...menuAnchor, entry });
    setMenuAnchor(null);
  };

  const applyFolder = async (entry: SongBankEntry, folder: string | null) => {
    setPickerAnchor(null);
    setSongFolder(entry.id, folder);
    refreshLocal();
    if (!CLOUD_ENABLED) return;
    try {
      await cloudPutSong({
        id: entry.id,
        title: entry.title,
        score: entry.score,
        savedAt: entry.savedAt,
        folder: folder ?? null,
      });
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({
          type: "put",
          id: entry.id,
          title: entry.title,
          score: entry.score,
          savedAt: entry.savedAt,
        });
      }
    }
  };

  const applyNewFolder = async (entry: SongBankEntry) => {
    setPickerAnchor(null);
    const next = window.prompt(`New folder name:`, "");
    if (!next || !next.trim()) return;
    await applyFolder(entry, next.trim());
  };

  const [historyForId, setHistoryForId] = useState<string | null>(null);

  const handleViewHistory = (entry: SongBankEntry) => {
    setMenuAnchor(null);
    setHistoryForTitle(entry.title);
    setHistoryForId(entry.id);
  };

  // Find groups of duplicate-titled songs and delete all but the newest
  // (highest savedAt) per title. Both local and cloud — keeps the user
  // out of the "every save creates another copy and they pile up" trap.
  const handleCleanupDuplicates = async () => {
    const list = getSongs();
    const byTitle = new Map<string, SongBankEntry[]>();
    for (const s of list) {
      // Canonical key folds smart quotes / NFC-NFD / case / whitespace so
      // iPad-typed and Mac-typed variants of the same song collide.
      const k = canonicalSongTitle(s.title);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k)!.push(s);
    }
    // Score each entry by total chord + lyric character count. The
    // RICHEST copy of each title wins, with savedAt newer-than tie-
    // breaker. This is the right heuristic when bulk-recover (or
    // anything else) creates a parallel entry — the autosave snapshot
    // it pulled from might not be the most-edited moment, so newest-
    // savedAt alone could discard real chord work in favor of an
    // emptier just-written copy.
    const contentScore = (s: SongBankEntry): number => {
      const sections = s.score.sections ?? [];
      let chars = 0;
      for (const sec of sections) {
        for (const line of sec.lines ?? []) {
          chars += (line.chords ?? "").length;
          chars += (line.lyrics ?? "").length;
        }
      }
      // Notation scores: count notes as a proxy.
      for (const staff of s.score.staves ?? []) {
        for (const v of staff.voices ?? []) chars += (v.notes ?? []).length * 4;
      }
      return chars;
    };
    const toDelete: SongBankEntry[] = [];
    const winners: { keep: SongBankEntry; lost: SongBankEntry[] }[] = [];
    for (const entries of byTitle.values()) {
      if (entries.length <= 1) continue;
      // Sort so the winner is index 0: highest content first, then
      // newest savedAt as tiebreaker.
      entries.sort((a, b) => {
        const sa = contentScore(a);
        const sb = contentScore(b);
        if (sa !== sb) return sb - sa;
        return b.savedAt - a.savedAt;
      });
      winners.push({ keep: entries[0], lost: entries.slice(1) });
      toDelete.push(...entries.slice(1));
    }
    if (toDelete.length === 0) {
      window.alert("No duplicates found.");
      return;
    }
    // Build a confirm message that's transparent about which copy is
    // kept (showing chord-char score) so the user can verify before
    // pulling the trigger.
    const lines: string[] = [];
    for (const w of winners.slice(0, 5)) {
      const keepScore = contentScore(w.keep);
      lines.push(`• Keep "${w.keep.title}" (${keepScore} chars), drop ${w.lost.length} other${w.lost.length === 1 ? "" : "s"}`);
    }
    const more = winners.length > 5 ? `\n…and ${winners.length - 5} more` : "";
    const ok = window.confirm(
      `Delete ${toDelete.length} duplicate ${toDelete.length === 1 ? "song" : "songs"}? The richest copy (most chord + lyric content) of each title is kept.\n\n${lines.join("\n")}${more}`,
    );
    if (!ok) return;
    for (const entry of toDelete) {
      deleteSong(entry.id);
      if (CLOUD_ENABLED) {
        try { await cloudDeleteSong(entry.id); } catch { /* best-effort */ }
      }
    }
    refreshLocal();
    // Pull cloud-side updates that may have happened since the modal
    // opened (server-side merges, deletions from another device, etc.)
    // so the user sees the canonical state in one button-tap, not two.
    if (CLOUD_ENABLED) {
      await runSync();
    }
  };

  // Bulk-delete autosave/recovery alias entries — titles like
  // "Foo (snapped)", "(recovered 9:06 PM)", "(latest 10:37 PM)" — that
  // earlier sync/recovery flows used to disambiguate duplicates. They
  // pile up over time and clutter the Sets candidate picker. Removes
  // both local and cloud copies, with a transparent confirm.
  const handleCleanupAliases = async () => {
    const aliases = getSongs().filter((s) => isAliasTitle(s.title));
    if (aliases.length === 0) {
      window.alert("No alias entries found.");
      return;
    }
    const preview = aliases.slice(0, 8).map((s) => `• "${s.title}"`).join("\n");
    const more = aliases.length > 8 ? `\n…and ${aliases.length - 8} more` : "";
    const ok = window.confirm(
      `Delete ${aliases.length} alias ${aliases.length === 1 ? "entry" : "entries"}? These are autosave/recovery copies whose titles end in (snapped), (recovered …), or (latest …).\n\n${preview}${more}`,
    );
    if (!ok) return;
    for (const entry of aliases) {
      deleteSong(entry.id);
      if (CLOUD_ENABLED) {
        try { await cloudDeleteSong(entry.id); } catch { /* best-effort */ }
      }
    }
    refreshLocal();
    if (CLOUD_ENABLED) {
      await runSync();
    }
  };

  // Export every song in a given folder as a single JSON file. Use to
  // back up before bulk-deleting a folder ("archive" workflow). The
  // file contains full SongBankEntry objects (id, title, score,
  // savedAt, folder, cloudVersion) so it could feed a future import.
  // Folder "" represents the Unfiled bucket.
  const handleExportFolder = (folderName: string) => {
    const entries = getSongs().filter((s) => (s.folder ?? "") === folderName);
    if (entries.length === 0) {
      setFolderMenuAnchor(null);
      return;
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      folder: folderName || "_unfiled",
      songCount: entries.length,
      songs: entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (folderName || "unfiled").replace(/[^a-z0-9-_]+/gi, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `notation-app-${safeName}-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setFolderMenuAnchor(null);
  };

  // Bulk-delete every song in a folder. Pairs with Export above for
  // the "archive a folder" workflow. Confirms with a preview; same
  // local + cloud delete pattern as handleBulkDelete / handleCleanupAliases.
  const handleDeleteFolderContents = async (folderName: string) => {
    const entries = getSongs().filter((s) => (s.folder ?? "") === folderName);
    if (entries.length === 0) {
      setFolderMenuAnchor(null);
      return;
    }
    const folderLabel = folderName || "(Unfiled)";
    const preview = entries.slice(0, 8).map((s) => `• "${s.title}"`).join("\n");
    const more = entries.length > 8 ? `\n…and ${entries.length - 8} more` : "";
    const ok = window.confirm(
      `Delete all ${entries.length} song${entries.length === 1 ? "" : "s"} in folder "${folderLabel}"?\n\nRemoved from local + cloud. Autosave snapshots remain on this device for recovery.\n\n${preview}${more}`,
    );
    if (!ok) return;
    setFolderMenuAnchor(null);
    for (const entry of entries) {
      deleteSong(entry.id);
      if (CLOUD_ENABLED) {
        try { await cloudDeleteSong(entry.id); } catch { /* best-effort */ }
      }
    }
    refreshLocal();
    if (CLOUD_ENABLED) {
      await runSync();
    }
  };

  // Bulk delete of the currently-selected songs. Confirms with a count
  // + preview. Queues all deletes first (local + cloud) and runs ONE
  // sync at the end — same pattern as handleCleanupAliases. Exits
  // select mode on success.
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const all = getSongs();
    const targets = all.filter((s) => selectedIds.has(s.id));
    if (targets.length === 0) {
      exitSelectMode();
      return;
    }
    const preview = targets.slice(0, 8).map((s) => `• "${s.title}"`).join("\n");
    const more = targets.length > 8 ? `\n…and ${targets.length - 8} more` : "";
    const ok = window.confirm(
      `Delete ${targets.length} ${targets.length === 1 ? "song" : "songs"}?\n\n${preview}${more}`,
    );
    if (!ok) return;
    for (const t of targets) {
      deleteSong(t.id);
      if (CLOUD_ENABLED) {
        try { await cloudDeleteSong(t.id); } catch { /* best-effort */ }
      }
    }
    refreshLocal();
    exitSelectMode();
    if (CLOUD_ENABLED) {
      await runSync();
    }
  };

  // Apply a folder choice to an arbitrary set of song ids. Used by
  // the right-pane FolderPickerPaneBody for both the bulk-bar Move
  // action AND single-row kebab Move (where the right pane targets
  // just that one song). Local change runs first; cloud push happens
  // after, with a final runSync().
  const handleBulkMoveToFolderIds = async (ids: string[], folder: string | null) => {
    if (ids.length === 0) return;
    for (const id of ids) {
      setSongFolder(id, folder && folder.trim() ? folder.trim() : null);
    }
    refreshLocal();
    exitSelectMode();
    if (CLOUD_ENABLED) {
      // Push each updated entry so the new folder propagates. Re-read
      // post-update so cloudVersion bumps land on the latest snapshot.
      const updated = getSongs().filter((s) => ids.includes(s.id));
      for (const entry of updated) {
        try {
          const dto = await cloudPutSong({
            id: entry.id,
            title: entry.title,
            score: entry.score,
            savedAt: entry.savedAt,
            folder: entry.folder ?? null,
            ...(entry.cloudVersion !== undefined && { expectedVersion: entry.cloudVersion }),
          });
          updateSong(entry.id, { cloudVersion: dto.version });
        } catch { /* best-effort */ }
      }
      await runSync();
    }
  };

  const handleDelete = async (id: string) => {
    logEvent({ event: "mysongs_delete" });
    deleteSong(id);
    refreshLocal();
    if (!CLOUD_ENABLED) return;
    setSyncStatus("syncing");
    try {
      await cloudDeleteSong(id);
      setSyncStatus("ok");
    } catch (err) {
      if (isTransient(err)) {
        enqueueOffline({ type: "delete", id });
        setSyncStatus("offline");
      } else {
        setSyncStatus("ok");
      }
    }
  };

  const badge = (() => {
    if (syncStatus === "idle") return null;
    const map = {
      syncing: { color: "bg-blue-400", label: "Syncing…" },
      ok: { color: "bg-green-500", label: "Synced" },
      offline: { color: "bg-amber-500", label: "Offline — will retry" },
    } as const;
    const { color, label } = map[syncStatus];
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <span className={`w-1.5 h-1.5 rounded-full ${color}`} aria-hidden />
        {label}
      </span>
    );
  })();

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[1100px] max-w-[95vw] flex flex-col h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-gray-900 text-base">My Songs</h2>
            {badge}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Songs / Sets tab switcher (#73). Sets is a thin slice today —
         * per-device only, no cloud sync until #74 lands. The Songs tab
         * is the existing My Songs view; Sets renders SetsPanel. */}
        <div className="px-5 pt-2 bg-white border-b border-gray-200 flex items-end gap-1">
          {(["songs", "sets"] as const).map((t) => {
            const active = activeTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setActiveTab(t);
                  if (t !== "songs") exitSelectMode();
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                  active
                    ? "bg-blue-50 text-blue-700 border border-blue-200 border-b-transparent"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t === "songs" ? "Songs" : "Sets"}
              </button>
            );
          })}
          {/* Select-mode toggle, Songs tab only. Per docs/ui-guidelines.md
              §"Multi-select" — ghost button in the header that flips to
              Cancel when active. */}
          {activeTab === "songs" && songs.length > 0 && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`ml-auto mb-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                selectMode
                  ? "text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
              title={selectMode ? "Exit select mode (Esc)" : "Select multiple songs for bulk actions"}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          )}
        </div>

        {/* Save bar / no-score message — only on the Songs tab. SetsPanel
            moved into the flex-row below so the right pane can sit
            alongside either tab's content. */}
        {activeTab === "songs" && (score ? (() => {
          // Save flow with explicit branching to prevent silent
          // overwrites. Three states:
          //
          //   1. No currentSongId        → single 'Save Song' button.
          //                                 Always creates a new entry.
          //   2. currentSongId present,
          //      titles match            → single 'Save' button. Updates
          //                                 the existing entry in place
          //                                 (the no-duplicate path).
          //   3. currentSongId present,
          //      titles DIFFER           → AMBIGUOUS. Banner + TWO
          //                                 buttons forcing the user to
          //                                 pick: 'Update [old title]'
          //                                 or 'Save as new'.
          //
          // State 3 is what bit San Francisco / Love Seeking Missile —
          // an AI-generated new song was created while another was
          // loaded; the silent overwrite path clobbered the original.
          const currentEntry =
            currentSongId ? songs.find(s => s.id === currentSongId) : null;
          const titleNow = saveTitle.trim() || score.title || "Untitled Song";
          const titlesMatch = currentEntry && currentEntry.title.trim().toLowerCase() === titleNow.toLowerCase();
          const ambiguous = !!currentEntry && !titlesMatch;
          return (
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
              {ambiguous && (
                <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                  The current song <strong>&ldquo;{currentEntry!.title}&rdquo;</strong> has a different title from what you&rsquo;re saving (<strong>&ldquo;{titleNow}&rdquo;</strong>). Pick one — &ldquo;Update&rdquo; overwrites the existing song; &ldquo;Save as new&rdquo; creates a separate entry.
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={saveTitle}
                  onChange={e => setSaveTitle(e.target.value)}
                  placeholder={score.title || "Song name"}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onKeyDown={e => {
                    if (e.key === "Enter" && !ambiguous) handleSave();
                    if (e.key === "Escape") onClose();
                  }}
                />
                {ambiguous ? (
                  <>
                    <button
                      onClick={handleSave}
                      className="px-3 py-1.5 text-sm font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      title={`Update '${currentEntry!.title}' with this content`}
                    >
                      Update &ldquo;{truncate(currentEntry!.title, 18)}&rdquo;
                    </button>
                    <button
                      onClick={handleSaveAs}
                      className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      title="Create a new entry; leave the existing song alone"
                    >
                      Save as new
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleSave}
                      className={`px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                        justSaved
                          ? "bg-green-600 hover:bg-green-700"
                          : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
                      }`}
                      title={currentEntry ? "Update the current song (no duplicate)" : "Create a new song"}
                    >
                      {justSaved ? "Saved!" : currentEntry ? "Save" : "Save Song"}
                    </button>
                    {currentEntry && (
                      <button
                        onClick={handleSaveAs}
                        className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                        title="Save as a new entry (keeps the current one)"
                      >
                        Save As…
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })() : (
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
            <p className="text-sm text-gray-500">Open or create a score or chord chart to save it here.</p>
          </div>
        ))}

        {/* Search box — pinned above the list. Hidden in Sets tab and
            in select mode (the bulk-action bar already overloads the
            chrome there). */}
        {activeTab === "songs" && !selectMode && songs.length > 0 && (
          <div className="px-5 py-2 border-b border-gray-100 bg-white flex items-center gap-2">
            <input
              type="text"
              value={songQuery}
              onChange={(e) => setSongQuery(e.target.value)}
              placeholder="Search songs…"
              className="flex-1 text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {songQuery && (
              <button
                type="button"
                onClick={() => setSongQuery("")}
                className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                title="Clear search"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Body row — splits into left pane (Songs list or Sets) and an
            optional right pane (Add to set / Move to folder / Pick
            songs for a set). The right pane replaces the previous
            stacked-modal sheets so users get a bigger working surface
            with no modal-on-modal. */}
        <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
          <div className={`flex flex-col min-w-0 ${rightPane.kind ? "hidden md:flex md:flex-1" : "flex-1"}`}>
        {activeTab === "sets" ? (
          <SetsPanel
            onClose={onClose}
            onPickSongs={(setId) => setRightPane({ kind: "pickSongs", targetSetId: setId })}
          />
        ) : (
        <div className="flex-1 overflow-y-auto">
          {songs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              {syncStatus === "syncing"
                ? "Loading…"
                : score
                ? "No songs saved yet. Enter a name above and click Save Song."
                : "No songs saved yet."}
            </div>
          ) : songQueryCanon ? (
            // ── Search-result flat list ─────────────────────────────
            // Folder grouping doesn't apply during search; results may
            // span folders, so we render a single flat list with the
            // folder name shown inline as a small label. Renaming /
            // select / Load / kebab all still work — this is the same
            // <li> structure used in the grouped path below, just
            // unwrapped from the <ul> group wrappers.
            filteredSongs.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">
                No songs match <em className="not-italic font-medium">&ldquo;{songQuery}&rdquo;</em>.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredSongs.map((entry) => {
                  const isSelected = selectedIds.has(entry.id);
                  return (
                    <li
                      key={entry.id}
                      className={`flex items-center px-5 py-3 hover:bg-gray-50 gap-3 relative ${
                        selectMode && isSelected ? "bg-blue-50/40" : ""
                      } ${selectMode ? "cursor-pointer" : ""}`}
                      onClick={selectMode ? () => toggleSelected(entry.id) : undefined}
                    >
                      {selectMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(entry.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 text-blue-600 shrink-0"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        {renamingId === entry.id ? (
                          <input
                            type="text"
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter") commitRename(entry);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            onBlur={() => commitRename(entry)}
                            className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => !selectMode && startRename(entry)}
                            className="text-sm font-medium text-gray-900 truncate text-left hover:text-blue-700 w-full inline-flex items-center gap-2"
                            title={selectMode ? undefined : "Click to rename"}
                          >
                            <span className="truncate">{entry.title}</span>
                            {(() => {
                              const t = scoreTypeOf(entry.score);
                              if (t === "chord-chart") {
                                return (
                                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 shrink-0">
                                    Chart
                                  </span>
                                );
                              }
                              if (t === "notation") {
                                return (
                                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                                    Score
                                  </span>
                                );
                              }
                              return null;
                            })()}
                          </button>
                        )}
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span>{new Date(entry.savedAt).toLocaleString()}</span>
                          {entry.folder && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200"
                              title={`Folder: ${entry.folder}`}
                            >
                              {entry.folder}
                            </span>
                          )}
                          {!selectMode && (() => {
                            const memberOf = setMembership.get(entry.id);
                            if (!memberOf || memberOf.length === 0) return null;
                            const names = memberOf.map((s) => s.name);
                            const label =
                              names.length === 1
                                ? `In: ${names[0]}`
                                : `In ${names.length} sets · ${names.slice(0, 2).join(", ")}${names.length > 2 ? ", …" : ""}`;
                            return (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-100"
                                title={names.join(", ")}
                              >
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      {!selectMode && (
                        <>
                          <button
                            onClick={() => handleLoad(entry)}
                            className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors shrink-0"
                          >
                            Load
                          </button>
                          <button
                            onClick={(e) => openKebab(entry, e)}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors shrink-0"
                            title="More"
                            aria-label="More actions"
                          >
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                              <circle cx="5" cy="12" r="2" />
                              <circle cx="12" cy="12" r="2" />
                              <circle cx="19" cy="12" r="2" />
                            </svg>
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="divide-y divide-gray-100">
              {grouped.map(group => {
                const collapsed = collapsedFolders.includes(group.name || "_unfiled");
                return (
                <div key={group.name || "_unfiled"}>
                  {grouped.length > 1 && (
                    <div className="w-full px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 bg-gray-50 border-b border-gray-100 flex items-center gap-2 transition-colors">
                      <button
                        type="button"
                        onClick={() => toggleFolderCollapse(group.name || "_unfiled")}
                        className="flex-1 flex items-center gap-2 text-left hover:text-gray-700 transition-colors"
                      >
                        <svg
                          className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        </svg>
                        <span>{group.label}</span>
                        <span className="text-gray-400 font-normal">{group.entries.length}</span>
                      </button>
                      {/* Folder-level actions: Export folder as JSON,
                          Delete all in folder. Hidden in select mode so
                          the row chrome doesn't compete with the bulk-
                          action bar. */}
                      {!selectMode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = e.currentTarget.getBoundingClientRect();
                            setFolderMenuAnchor({
                              folder: group.name || "",
                              top: rect.bottom + 4,
                              right: window.innerWidth - rect.right,
                            });
                          }}
                          className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-200 active:bg-gray-300 rounded transition-colors shrink-0"
                          title="Folder actions (Export / Delete all)"
                          aria-label="Folder actions"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  {!collapsed && (
                  <ul className="divide-y divide-gray-100">
                    {group.entries.map(entry => {
                      const isSelected = selectedIds.has(entry.id);
                      const rowClick = selectMode ? () => toggleSelected(entry.id) : undefined;
                      return (
                      <li
                        key={entry.id}
                        className={`flex items-center px-5 py-3 hover:bg-gray-50 gap-3 relative ${
                          selectMode && isSelected ? "bg-blue-50/40" : ""
                        } ${selectMode ? "cursor-pointer" : ""}`}
                        onClick={rowClick}
                      >
                        {/* Leading checkbox in select mode. Clicking the
                            checkbox or anywhere else on the row toggles
                            selection. The Load/kebab buttons and rename
                            affordance hide so the row is purely
                            selection-focused. */}
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(entry.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 text-blue-600 shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          {!selectMode && renamingId === entry.id ? (
                            <input
                              type="text"
                              autoFocus
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitRename(entry);
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              onBlur={() => commitRename(entry)}
                              className="w-full px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : selectMode ? (
                            <div className="text-sm font-medium text-gray-900 truncate inline-flex items-center gap-2">
                              <span className="truncate">{entry.title}</span>
                              {(() => {
                                const t = scoreTypeOf(entry.score);
                                if (t === "chord-chart") {
                                  return (
                                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 shrink-0">
                                      Chart
                                    </span>
                                  );
                                }
                                if (t === "notation") {
                                  return (
                                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                                      Score
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startRename(entry)}
                              className="text-sm font-medium text-gray-900 truncate text-left hover:text-blue-700 w-full inline-flex items-center gap-2"
                              title="Click to rename"
                            >
                              <span className="truncate">{entry.title}</span>
                              {(() => {
                                const t = scoreTypeOf(entry.score);
                                if (t === "chord-chart") {
                                  return (
                                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 shrink-0">
                                      Chart
                                    </span>
                                  );
                                }
                                if (t === "notation") {
                                  return (
                                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">
                                      Score
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </button>
                          )}
                          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{new Date(entry.savedAt).toLocaleString()}</span>
                            {/* "In N sets" pill — hidden in select mode
                                so the row stays purely selection-focused. */}
                            {!selectMode && (() => {
                              const memberOf = setMembership.get(entry.id);
                              if (!memberOf || memberOf.length === 0) return null;
                              const names = memberOf.map((s) => s.name);
                              const label =
                                names.length === 1
                                  ? `In: ${names[0]}`
                                  : `In ${names.length} sets · ${names.slice(0, 2).join(", ")}${names.length > 2 ? ", …" : ""}`;
                              return (
                                <span
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-700 border border-pink-100"
                                  title={names.join(", ")}
                                >
                                  {label}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                        {!selectMode && (
                          <>
                            <button
                              onClick={() => handleLoad(entry)}
                              className="px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 active:bg-blue-100 border border-blue-200 rounded-lg transition-colors shrink-0"
                            >
                              Load
                            </button>
                            <button
                              onClick={(e) => openKebab(entry, e)}
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors shrink-0"
                              title="More"
                              aria-label="More actions"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                <circle cx="5" cy="12" r="2" />
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="19" cy="12" r="2" />
                              </svg>
                            </button>
                          </>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
        )}
          </div>
          {/* Right pane — contextual action target. Replaces stacked
              sheets. On wide viewports, sits alongside the left pane
              (~380px). On narrow viewports (< md ≈ 768px), the left
              pane is hidden and the right pane takes the whole modal,
              Master/Detail style. */}
          {rightPane.kind && (
            <div className="flex flex-col w-full md:w-[380px] md:max-w-[42%] md:border-l md:border-gray-200 bg-white min-h-0">
              {rightPane.kind === "addToSet" && (
                <PickSetBody
                  sets={sets}
                  songIds={rightPane.songIds}
                  onClose={() => {
                    closeRightPane();
                    exitSelectMode();
                  }}
                />
              )}
              {rightPane.kind === "pickSongs" && (
                <PickSongsBody
                  sets={sets}
                  songs={songs}
                  targetSetId={rightPane.targetSetId}
                  onClose={closeRightPane}
                />
              )}
              {rightPane.kind === "moveFolder" && (
                <FolderPickerPaneBody
                  folderNames={folderNames}
                  count={rightPane.songIds.length}
                  onCancel={closeRightPane}
                  onPick={(folder) => {
                    void handleBulkMoveToFolderIds(rightPane.songIds, folder);
                    closeRightPane();
                  }}
                />
              )}
            </div>
          )}
        </div>

        {CLOUD_ENABLED && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => setShowSync(s => !s)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <svg
                className={`w-3 h-3 transition-transform ${showSync ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Sync settings
            </button>
            {showSync && (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    Share this songbook with another device
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-700 truncate">
                      {buildShareLink(deviceId)}
                    </code>
                    <button
                      onClick={handleCopyShareLink}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded transition-colors shrink-0"
                    >
                      {linkCopied ? "Copied!" : "Copy link"}
                    </button>
                  </div>
                  <button
                    onClick={() => setShowRawCode(s => !s)}
                    className="text-xs text-gray-500 hover:text-gray-700 mt-2"
                  >
                    {showRawCode ? "Hide raw code" : "Show raw code"}
                  </button>
                  {showRawCode && (
                    <div className="flex items-center gap-2 mt-2">
                      <code className="flex-1 px-2 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded text-gray-700 truncate">
                        {deviceId}
                      </code>
                      <button
                        onClick={handleCopyDeviceId}
                        className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-100 active:bg-gray-200 rounded transition-colors shrink-0"
                      >
                        {codeCopied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  )}
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="text-xs text-gray-500 mb-1">
                    Or paste a share link / code from another device
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={pasteCode}
                      onChange={e => setPasteCode(e.target.value)}
                      placeholder="paste link or code"
                      className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleApplyPastedCode}
                      disabled={
                        !pasteCode.trim() || extractJoinCode(pasteCode) === deviceId
                      }
                      className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="text-xs text-amber-600 mt-1">
                    Replaces the local song list with the linked device's.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bulk-action bar — appears in select mode whenever ≥1 song is
            picked. Per docs/ui-guidelines.md §"Multi-select" — "N selected"
            on the left, action buttons on the right (primary blue = the
            common action; ghost for the rest; red for Delete). */}
        {selectMode && selectedIds.size > 0 && (
          <div className="px-5 py-3 border-t border-gray-200 bg-blue-50/40 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">
              {selectedIds.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRightPane({ kind: "addToSet", songIds: Array.from(selectedIds) })}
                className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg"
              >
                Add to set…
              </button>
              <button
                onClick={() => setRightPane({ kind: "moveFolder", songIds: Array.from(selectedIds) })}
                className="px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg"
              >
                Move to folder…
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-1.5 text-sm text-red-600 hover:bg-red-50 active:bg-red-100 rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-200 flex justify-between items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={handleCleanupDuplicates}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
              title="Delete duplicate-titled songs, keeping the newest of each"
            >
              Clean up duplicates
            </button>
            <button
              onClick={handleCleanupAliases}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
              title="Delete autosave/recovery alias copies (titles ending in (snapped), (recovered …), (latest …))"
            >
              Clean up aliases
            </button>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-gray-700 hover:bg-gray-100 active:bg-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Kebab menu — fixed-positioned at the button anchor so it isn't
          clipped by the modal's overflow-y-auto song list (the bug that
          made taps unreliable on iPad). */}
      {folderMenuAnchor && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setFolderMenuAnchor(null)} />
          <div
            className="fixed z-[120] w-64 bg-white rounded-lg shadow-2xl border border-gray-200 py-1 text-sm"
            style={{ top: folderMenuAnchor.top, right: folderMenuAnchor.right }}
            // Same stopPropagation pattern as the kebab/folder popovers:
            // these popovers live outside the inner-modal wrapper so
            // unhandled clicks would bubble to the outer modal-close.
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => handleExportFolder(folderMenuAnchor.folder)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
              title="Download every song in this folder as a JSON backup file"
            >
              Export folder as JSON
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => handleDeleteFolderContents(folderMenuAnchor.folder)}
              className="w-full text-left px-3 py-2 hover:bg-red-50 active:bg-red-100 text-red-600"
              title="Permanently delete every song in this folder (local + cloud). Confirms before acting."
            >
              Delete all songs in this folder
            </button>
          </div>
        </>
      )}

      {menuAnchor && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setMenuAnchor(null)} />
          <div
            className="fixed z-[120] w-48 bg-white rounded-lg shadow-2xl border border-gray-200 py-1 text-sm"
            style={{ top: menuAnchor.top, right: menuAnchor.right }}
            // Stop clicks from bubbling to the outer modal-backdrop's
            // onClose. The menu lives OUTSIDE the inner-modal
            // stopPropagation wrapper so it can render past the
            // overflow-y-auto on iPad — but that means menu-item clicks
            // would otherwise close the whole modal before the action
            // can take effect (e.g. Rename: state was set, then modal
            // unmounted before the input could render).
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => startRename(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              Rename
            </button>
            <button
              onClick={() => handleMoveToFolder(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              Move to folder…
            </button>
            <button
              onClick={() => {
                const e = menuAnchor.entry;
                setMenuAnchor(null);
                setRightPane({ kind: "addToSet", songIds: [e.id] });
              }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              Add to set…
            </button>
            <button
              onClick={() => handleViewHistory(menuAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-gray-700"
            >
              View history
            </button>
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { const e = menuAnchor.entry; setMenuAnchor(null); handleDelete(e.id); }}
              className="w-full text-left px-3 py-2 hover:bg-red-50 active:bg-red-100 text-red-600"
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Folder picker — also fixed-positioned for the same reason. */}
      {pickerAnchor && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setPickerAnchor(null)} />
          <div
            className="fixed z-[120] w-56 bg-white rounded-lg shadow-2xl border border-gray-200 py-1 text-sm max-h-[60vh] overflow-y-auto"
            style={{ top: pickerAnchor.top, right: pickerAnchor.right }}
            // Same fix as the kebab menu — popovers rendered outside
            // the inner-modal wrapper need to stop click bubble or the
            // outer modal-backdrop's onClose fires.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400">Move to…</div>
            <button
              onClick={() => applyFolder(pickerAnchor.entry, null)}
              className={`w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 ${
                !pickerAnchor.entry.folder ? "text-blue-700 font-medium" : "text-gray-700"
              }`}
            >
              {!pickerAnchor.entry.folder && "✓ "}(Unfiled)
            </button>
            {folderNames.map(f => (
              <button
                key={f}
                onClick={() => applyFolder(pickerAnchor.entry, f)}
                className={`w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 ${
                  pickerAnchor.entry.folder === f ? "text-blue-700 font-medium" : "text-gray-700"
                }`}
              >
                {pickerAnchor.entry.folder === f && "✓ "}{f}
              </button>
            ))}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => applyNewFolder(pickerAnchor.entry)}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 active:bg-blue-100 text-blue-700"
            >
              + New folder…
            </button>
          </div>
        </>
      )}

      {/* Per-song history (autosave snapshots filtered by title). Restores
          the chosen snapshot via setScore — which auto-snapshots the
          current state first, so picking a history entry is itself reversible. */}
      {historyForTitle && (
        <AutosaveRecoveryDialog
          filterTitle={historyForTitle}
          cloudSongId={historyForId ?? undefined}
          onClose={() => {
            setHistoryForTitle(null);
            setHistoryForId(null);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Folder picker body for the bulk Move action — renders inline inside
 * the MySongsModal right pane, NOT as a standalone modal. (The old
 * standalone stacked-sheet version was replaced when the modal grew
 * a right pane; sheets-on-modals were the "small windows" complaint.)
 *
 * Lists existing folders + "(Unfiled)" + a "+ New folder" inline
 * create. Caller owns positioning and Esc handling.
 */
function FolderPickerPaneBody({
  folderNames,
  count,
  onCancel,
  onPick,
}: {
  folderNames: string[];
  count: number;
  onCancel: () => void;
  onPick: (folder: string | null) => void;
}) {
  const [newFolder, setNewFolder] = useState("");
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Move {count} {count === 1 ? "song" : "songs"} to a folder
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Pick an existing folder or name a new one.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700 text-lg px-2 shrink-0"
          aria-label="Close pane"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-gray-100">
          <li>
            <button
              type="button"
              onClick={() => onPick(null)}
              className="w-full text-left px-5 py-3 text-sm hover:bg-gray-50 active:bg-gray-100 text-gray-900"
            >
              (Unfiled)
            </button>
          </li>
          {folderNames.map((f) => (
            <li key={f}>
              <button
                type="button"
                onClick={() => onPick(f)}
                className="w-full text-left px-5 py-3 text-sm hover:bg-gray-50 active:bg-gray-100 text-gray-900"
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-gray-100 px-5 py-3">
          {creating ? (
            <div className="flex gap-2">
              <input
                type="text"
                autoFocus
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const t = newFolder.trim();
                    if (t) onPick(t);
                  }
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewFolder("");
                  }
                }}
                placeholder="Folder name"
                className="flex-1 text-sm text-gray-900 placeholder-gray-400 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => {
                  const t = newFolder.trim();
                  if (t) onPick(t);
                }}
                disabled={!newFolder.trim()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-300 rounded-lg"
              >
                Move
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full text-left text-sm text-blue-700 hover:underline"
            >
              + New folder…
            </button>
          )}
        </div>
      </div>
    </>
  );
}

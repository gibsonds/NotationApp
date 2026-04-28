"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useScoreStore } from "@/store/score-store";
import { scoreToMusicXML } from "@/lib/musicxml";
import { ScoreSchema } from "@/lib/schema";
import { IS_STATIC_EXPORT, STATIC_FEATURE_DISABLED_MESSAGE } from "@/lib/api-availability";
import { v4 as uuidv4 } from "uuid";

interface MenuBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPrint?: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  onOpenAutosave?: () => void;
  onPasteLyrics?: () => void;
  onMySongs?: () => void;
}

type MenuItem = {
  label: string;
  shortcut?: string;
  action?: () => void;
  enabled?: boolean;
  separator?: false;
  checked?: boolean;
} | {
  separator: true;
  label?: never;
};

function MenuDropdown({ label, items, isOpen, onToggle, onClose }: {
  label: string;
  items: MenuItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={onToggle}
        className={`px-3 py-1 text-sm rounded transition-colors ${
          isOpen
            ? "bg-white/15 text-white"
            : "text-gray-400 hover:bg-white/10 hover:text-gray-200"
        }`}
      >
        {label}
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[220px] z-50 text-gray-800">
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="border-t border-gray-200 my-1" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  if (item.enabled === false) return;
                  item.action?.();
                  onClose();
                }}
                disabled={item.enabled === false}
                className="w-full px-3 py-1.5 text-sm text-left flex items-center justify-between gap-4 text-gray-800 hover:bg-blue-50 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <span className="flex items-center gap-2">
                  {item.checked !== undefined && (
                    <span className="w-4 text-center text-xs">
                      {item.checked ? "\u2713" : ""}
                    </span>
                  )}
                  {item.label}
                </span>
                {item.shortcut && (
                  <span className="text-xs text-gray-500 ml-4">{item.shortcut}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function MenuBar({
  zoom, onZoomChange, onPrint, onOpenAutosave, onPasteLyrics, onMySongs,
  onToggleSidebar, sidebarOpen,
}: MenuBarProps) {
  const {
    score, undo, redo, history, historyIndex, reset, setScore,
    setWarnings, addMessage, setIsGenerating, saveRevision,
    messages, savedRevisions, layout, setLayout,
    copySelection, pasteAtSelection, selection, setSelection,
  } = useScoreStore();

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const toggleMenu = useCallback((name: string) => {
    setOpenMenu(prev => prev === name ? null : name);
  }, []);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  // ── Handlers (moved from Toolbar) ─────────────────────────────────

  const handleNew = () => {
    reset();
    setScore({
      id: uuidv4(),
      title: "Untitled Score",
      composer: "",
      tempo: 120,
      timeSignature: "4/4",
      keySignature: "C",
      measures: 16,
      staves: [{
        id: uuidv4(),
        name: "Staff 1",
        clef: "treble",
        lyricsMode: "none",
        voices: [{ id: uuidv4(), role: "general", notes: [] }],
      }],
      chordSymbols: [],
      rehearsalMarks: [],
      repeats: [],
      sections: [],
      form: [],
      metadata: {},
    });
  };

  /** Start a blank chord chart (songbook mode). One Verse section, one
   *  empty line — the user fills in lyrics and chords from there. No
   *  staves, so the renderer switches to ChordChartView. */
  const handleNewChordChart = () => {
    reset();
    setScore({
      id: uuidv4(),
      title: "Untitled Song",
      composer: "",
      tempo: 120,
      timeSignature: "4/4",
      keySignature: "C",
      measures: 1,
      staves: [],
      chordSymbols: [],
      rehearsalMarks: [],
      repeats: [],
      sections: [{
        id: "v1",
        label: "Verse 1",
        lines: [{ chords: "", lyrics: "" }],
      }],
      form: [],
      metadata: {},
    });
  };

  const handleExportMusicXML = () => {
    if (!score) return;
    const xml = scoreToMusicXML(score);
    downloadFile(xml, `${score.title || "score"}.musicxml`, "application/xml");
  };

  const handleExportJSON = () => {
    if (!score) return;
    const json = JSON.stringify(score, null, 2);
    downloadFile(json, `${score.title || "score"}.json`, "application/json");
  };

  const handleExportSVG = () => {
    const svgEl = document.querySelector(".score-container svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    downloadFile(svgData, `${score?.title || "score"}.svg`, "image/svg+xml");
  };

  const handlePrint = () => {
    if (!score) return;
    if (onPrint) onPrint();
    else window.print();
  };

  const handleSave = () => {
    if (!score) return;
    const name = `${score.title || "Score"} \u2014 ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    saveRevision(name);
    addMessage({ id: uuidv4(), role: "assistant", content: `Saved revision: "${name}".`, timestamp: Date.now() });
  };

  const handleSaveAs = () => {
    if (!score) return;
    const name = prompt("Revision name:", score.title || "Score");
    if (!name) return;
    saveRevision(name);
    addMessage({ id: uuidv4(), role: "assistant", content: `Saved revision: "${name}".`, timestamp: Date.now() });
  };

  const handleSaveProject = () => {
    if (!score) return;
    const project = { version: 1, score, history, historyIndex, messages, savedRevisions, layout };
    const json = JSON.stringify(project, null, 2);
    downloadFile(json, `${score.title || "project"}.notation`, "application/json");
    addMessage({ id: uuidv4(), role: "assistant", content: `Project saved as "${score.title || "project"}.notation".`, timestamp: Date.now() });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const filename = file.name.toLowerCase();

    if (filename.endsWith(".json")) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const result = ScoreSchema.safeParse(parsed);
        if (!result.success) {
          addMessage({ id: uuidv4(), role: "assistant", content: `Import error: Invalid score JSON \u2014 ${result.error.issues.map(i => i.message).join(", ")}`, timestamp: Date.now() });
          return;
        }
        setScore(result.data);
        addMessage({ id: uuidv4(), role: "assistant", content: `Loaded ${file.name}.`, timestamp: Date.now() });
      } catch (err: any) {
        addMessage({ id: uuidv4(), role: "assistant", content: `Import error: ${err.message}`, timestamp: Date.now() });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      return;
    }

    if (IS_STATIC_EXPORT) {
      addMessage({ id: uuidv4(), role: "assistant", content: STATIC_FEATURE_DISABLED_MESSAGE, timestamp: Date.now() });
      return;
    }
    setIsGenerating(true);
    addMessage({ id: uuidv4(), role: "assistant", content: `Importing ${file.name}...`, timestamp: Date.now() });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/score/import", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error((data.error || "Import failed") + (data.debug ? `\n\nDebug: ${JSON.stringify(data.debug, null, 2)}` : ""));
      setScore(data.score);
      if (data.warnings?.length) setWarnings(data.warnings);
      addMessage({ id: uuidv4(), role: "assistant", content: data.message || `Imported ${file.name}.`, timestamp: Date.now() });
    } catch (err: any) {
      addMessage({ id: uuidv4(), role: "assistant", content: `Import error: ${err.message}`, timestamp: Date.now() });
    } finally {
      setIsGenerating(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleOpenProject = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      if (!project.score) throw new Error("Invalid project file \u2014 no score found.");
      const result = ScoreSchema.safeParse(project.score);
      if (!result.success) throw new Error(`Invalid score data: ${result.error.issues.map(i => i.message).join(", ")}`);
      reset();
      const store = useScoreStore.getState();
      useScoreStore.setState({
        score: result.data,
        history: project.history || [result.data],
        historyIndex: project.historyIndex ?? 0,
        messages: project.messages || [],
        savedRevisions: project.savedRevisions || [],
        layout: project.layout ? { ...store.layout, ...project.layout } : store.layout,
      });
      addMessage({ id: uuidv4(), role: "assistant", content: `Opened project "${file.name}" \u2014 "${result.data.title}".`, timestamp: Date.now() });
    } catch (err: any) {
      addMessage({ id: uuidv4(), role: "assistant", content: `Open project error: ${err.message}`, timestamp: Date.now() });
    } finally {
      if (projectInputRef.current) projectInputRef.current.value = "";
    }
  };

  const handleTranscribe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (IS_STATIC_EXPORT) {
      addMessage({ id: uuidv4(), role: "assistant", content: STATIC_FEATURE_DISABLED_MESSAGE, timestamp: Date.now() });
      return;
    }
    setIsGenerating(true);
    addMessage({ id: uuidv4(), role: "assistant", content: `Transcribing ${file.name}... This may take a minute.`, timestamp: Date.now() });
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/score/transcribe", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      setScore(data.score);
      addMessage({ id: uuidv4(), role: "assistant", content: data.message || `Transcribed ${file.name}.`, timestamp: Date.now() });
    } catch (err: any) {
      addMessage({ id: uuidv4(), role: "assistant", content: `Transcription error: ${err.message}`, timestamp: Date.now() });
    } finally {
      setIsGenerating(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  };

  // ── Menu definitions ──────────────────────────────────────────────

  const fileMenu: MenuItem[] = [
    { label: "New Score", action: handleNew },
    { label: "New Chord Chart", action: handleNewChordChart },
    { separator: true },
    { label: "My Songs\u2026", action: () => onMySongs?.() },
    { separator: true },
    { label: "Open Project...", shortcut: "", action: () => projectInputRef.current?.click() },
    { label: "Recover from Auto-save...", action: () => onOpenAutosave?.() },
    { label: "Import...", shortcut: "", action: () => fileInputRef.current?.click() },
    { separator: true },
    { label: "Save Revision", shortcut: "Cmd+S", action: handleSave, enabled: !!score },
    { label: "Save Revision As...", action: handleSaveAs, enabled: !!score },
    { label: "Save Project", action: handleSaveProject, enabled: !!score },
    { separator: true },
    { label: "Export MusicXML", action: handleExportMusicXML, enabled: !!score },
    { label: "Export SVG", action: handleExportSVG, enabled: !!score },
    { label: "Export JSON", action: handleExportJSON, enabled: !!score },
    { separator: true },
    { label: "Print...", shortcut: "Cmd+P", action: handlePrint, enabled: !!score },
  ];

  const editMenu: MenuItem[] = [
    { label: "Undo", shortcut: "Cmd+Z", action: undo, enabled: canUndo },
    { label: "Redo", shortcut: "Cmd+Shift+Z", action: redo, enabled: canRedo },
    { separator: true },
    { label: "Copy", shortcut: "Cmd+C", action: () => copySelection(), enabled: !!selection },
    { label: "Paste", shortcut: "Cmd+V", action: () => pasteAtSelection(), enabled: !!selection },
    { separator: true },
    { label: "Select All", shortcut: "Cmd+A", action: () => { if (score) setSelection({ startMeasure: 1, endMeasure: score.measures }); }, enabled: !!score },
    { label: "Clear Selection", shortcut: "Esc", action: () => setSelection(null), enabled: !!selection },
    { separator: true },
    { label: "Paste Lyrics / Chords\u2026", action: () => onPasteLyrics?.(), enabled: !!score },
  ];

  const viewMenu: MenuItem[] = [
    { label: "Sidebar", shortcut: "Cmd+B", action: onToggleSidebar, checked: sidebarOpen },
    { separator: true },
    { label: "Zoom In", shortcut: "Cmd+=", action: () => onZoomChange(Math.min(2, zoom + 0.1)) },
    { label: "Zoom Out", shortcut: "Cmd+-", action: () => onZoomChange(Math.max(0.5, zoom - 0.1)) },
    { label: "Reset Zoom", action: () => onZoomChange(1.0) },
  ];

  const toolsMenu: MenuItem[] = [
    { label: "Transcribe Audio...", action: () => audioInputRef.current?.click() },
  ];

  return (
    <>
      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept=".mid,.midi,.snt,.musicxml,.mxl,.xml,.json" onChange={handleImport} className="hidden" />
      <input ref={audioInputRef} type="file" accept=".mp3,.m4a,.wav,.aif,.aiff,.ogg,.flac,.mp4" onChange={handleTranscribe} className="hidden" />
      <input ref={projectInputRef} type="file" accept=".notation,.json" onChange={handleOpenProject} className="hidden" />

      <div className="flex items-center gap-0.5 px-2 py-1 bg-[#0f0f23] border-b border-white/10 text-gray-300">
        {/* Brand */}
        <span className="text-sm font-bold text-gray-100 mr-3 tracking-wide">\u2669 NotationApp</span>

        {/* Menus */}
        <MenuDropdown label="File" items={fileMenu} isOpen={openMenu === "file"} onToggle={() => toggleMenu("file")} onClose={closeMenu} />
        <MenuDropdown label="Edit" items={editMenu} isOpen={openMenu === "edit"} onToggle={() => toggleMenu("edit")} onClose={closeMenu} />
        <MenuDropdown label="View" items={viewMenu} isOpen={openMenu === "view"} onToggle={() => toggleMenu("view")} onClose={closeMenu} />
        <MenuDropdown label="Tools" items={toolsMenu} isOpen={openMenu === "tools"} onToggle={() => toggleMenu("tools")} onClose={closeMenu} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Quick-access icons: Undo/Redo + Zoom */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-1 text-gray-500 hover:bg-white/10 rounded disabled:opacity-30"
            title="Undo (Cmd+Z)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-1 text-gray-500 hover:bg-white/10 rounded disabled:opacity-30"
            title="Redo (Cmd+Shift+Z)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
            </svg>
          </button>
          <span className="text-gray-700 mx-1">|</span>
          <button onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))} className="p-1 text-gray-500 hover:bg-white/10 rounded" title="Zoom out">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <span className="text-[10px] text-gray-400 w-8 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => onZoomChange(Math.min(2, zoom + 0.1))} className="p-1 text-gray-500 hover:bg-white/10 rounded" title="Zoom in">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

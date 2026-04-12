"use client";

import { useRef } from "react";
import { useScoreStore } from "@/store/score-store";
import { scoreToMusicXML } from "@/lib/musicxml";
import { ScoreSchema } from "@/lib/schema";
import { ChatMessage } from "@/store/score-store";
import { v4 as uuidv4 } from "uuid";
import MidiKeyboard from "./MidiKeyboard";

interface ToolbarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPrint?: () => void;
}

export default function Toolbar({ zoom, onZoomChange, onPrint }: ToolbarProps) {
  const { score, undo, redo, history, historyIndex, reset, setScore, setWarnings, addMessage, setIsGenerating, saveRevision } = useScoreStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const filename = file.name.toLowerCase();

    // JSON files can be loaded directly client-side
    if (filename.endsWith(".json")) {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const result = ScoreSchema.safeParse(parsed);
        if (!result.success) {
          addMessage({
            id: uuidv4(),
            role: "assistant",
            content: `Import error: Invalid score JSON — ${result.error.issues.map(i => i.message).join(", ")}`,
            timestamp: Date.now(),
          });
          return;
        }
        setScore(result.data);
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: `Loaded ${file.name}.`,
          timestamp: Date.now(),
        });
      } catch (err: any) {
        addMessage({
          id: uuidv4(),
          role: "assistant",
          content: `Import error: ${err.message}`,
          timestamp: Date.now(),
        });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      return;
    }

    setIsGenerating(true);
    addMessage({
      id: uuidv4(),
      role: "assistant",
      content: `Importing ${file.name}...`,
      timestamp: Date.now(),
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/score/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        const debugInfo = data.debug ? `\n\nDebug: ${JSON.stringify(data.debug, null, 2)}` : "";
        throw new Error((data.error || "Import failed") + debugInfo);
      }

      setScore(data.score);
      if (data.warnings?.length) {
        setWarnings(data.warnings);
      }

      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: data.message || `Imported ${file.name}.`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Import error: ${err.message}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsGenerating(false);
      // Reset file input so the same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExportSVG = () => {
    const svgEl = document.querySelector(".score-container svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    downloadFile(svgData, `${score?.title || "score"}.svg`, "image/svg+xml");
  };

  const handlePrint = () => {
    if (!score) return;
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  };

  const handleSave = () => {
    if (!score) return;
    const name = `${score.title || "Score"} — ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    saveRevision(name);
    addMessage({
      id: uuidv4(),
      role: "assistant",
      content: `Saved revision: "${name}". View revisions in the Properties panel.`,
      timestamp: Date.now(),
    });
  };

  const handleSaveAs = () => {
    if (!score) return;
    const name = prompt("Revision name:", score.title || "Score");
    if (!name) return;
    saveRevision(name);
    addMessage({
      id: uuidv4(),
      role: "assistant",
      content: `Saved revision: "${name}". View revisions in the Properties panel.`,
      timestamp: Date.now(),
    });
  };

  const handleTranscribe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsGenerating(true);
    addMessage({
      id: uuidv4(),
      role: "assistant",
      content: `Transcribing ${file.name}... This may take a minute.`,
      timestamp: Date.now(),
    });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/score/transcribe", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Transcription failed");
      }

      setScore(data.score);
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: data.message || `Transcribed ${file.name}.`,
        timestamp: Date.now(),
      });
    } catch (err: any) {
      addMessage({
        id: uuidv4(),
        role: "assistant",
        content: `Transcription error: ${err.message}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsGenerating(false);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
      {/* Left: Brand */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-gray-800">
          ♩ NotationApp
        </span>
      </div>

      {/* Center: Zoom + Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          title="Undo"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
          </svg>
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
          title="Redo"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
          </svg>
        </button>

        <div className="w-px h-5 bg-gray-300 mx-2" />

        <button
          onClick={() => onZoomChange(Math.max(0.5, zoom - 0.1))}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
          title="Zoom out"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
          </svg>
        </button>
        <span className="text-xs text-gray-500 w-12 text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => onZoomChange(Math.min(2, zoom + 0.1))}
          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
          title="Zoom in"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* Right: Import + Export + New */}
      <div className="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi,.snt,.musicxml,.mxl,.xml,.json"
          onChange={handleImport}
          className="hidden"
        />
        <input
          ref={audioInputRef}
          type="file"
          accept=".mp3,.m4a,.wav,.aif,.aiff,.ogg,.flac,.mp4"
          onChange={handleTranscribe}
          className="hidden"
        />
        <button
          onClick={() => audioInputRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded transition-colors"
          title="Transcribe audio to notation (MP3, WAV, M4A, AIF)"
        >
          Transcribe
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
        >
          Import
        </button>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <button
          onClick={handleExportMusicXML}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          MusicXML
        </button>
        <button
          onClick={handleExportSVG}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          SVG
        </button>
        <button
          onClick={handleExportJSON}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          JSON
        </button>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <button
          onClick={handleSave}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
        <button
          onClick={handleSaveAs}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Save As
        </button>
        <button
          onClick={handlePrint}
          disabled={!score}
          className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Print
        </button>
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <MidiKeyboard />
        <div className="w-px h-5 bg-gray-300 mx-1" />
        <button
          onClick={reset}
          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
        >
          New
        </button>
      </div>
    </div>
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

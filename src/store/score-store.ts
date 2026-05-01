import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Score, ScorePatch, NoteDuration } from "@/lib/schema";
import { applyPatch } from "@/lib/patches";
import { NoteSelection, noteInSelection } from "@/lib/transforms";
import { debugLog } from "@/lib/debug-log";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/** A recorded operation that can be replayed on a new selection. */
export interface RecordedOperation {
  prompt: string;
  type: "ai" | "builtin";
  builtinCommand?: string;
  /** For AI ops, the patches that were returned */
  patches?: ScorePatch[];
  /** The selection it was originally applied to */
  selection?: NoteSelection;
}

export type MusicFont = "bravura" | "petaluma" | "gonville";
export type TextFont = "georgia" | "palatino" | "garamond" | "times" | "helvetica" | "noto" | "handwritten";
export type PageSize = "letter" | "a4";

export const PAGE_DIMENSIONS: Record<PageSize, { width: number; height: number; label: string }> = {
  letter: { width: 8.5, height: 11.0, label: "US Letter" },
  a4: { width: 8.27, height: 11.69, label: "A4" },
};

export const TEXT_FONT_STACKS: Record<TextFont, string> = {
  georgia: "Georgia, 'Times New Roman', serif",
  palatino: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  garamond: "Garamond, 'EB Garamond', Georgia, serif",
  times: "'Times New Roman', Times, serif",
  helvetica: "Helvetica, Arial, 'Helvetica Neue', sans-serif",
  noto: "'Noto Serif', Georgia, serif",
  handwritten: "'Marker Felt', 'Comic Neue', 'Caveat', 'Bradley Hand', cursive",
};

export interface LayoutSettings {
  titleSize: number;       // OSMD SheetTitleHeight (default ~4)
  composerSize: number;    // SheetComposerHeight
  titleTopDistance: number;
  titleBottomDistance: number;
  pageTopMargin: number;
  pageLeftMargin: number;
  pageRightMargin: number;
  systemSpacing: number;   // MinimumDistanceBetweenSystems
  compactMode: boolean;
  measuresPerSystem: number; // 0 = auto, >0 = fixed
  pageBreaks: boolean;      // enable page-height pagination
  pageSize: PageSize;       // page dimensions for print/pagination
  noteSize: number;         // notation scale factor (1.0 = default, 0.7 = smaller)
  musicFont: MusicFont;     // VexFlow music notation font
  textFont: TextFont;       // CSS text font for lyrics, titles, etc.
  printPageNumbers: boolean; // show page numbers in print output
  printHeader: string;       // header text for printed pages (empty = none)
  printFooter: string;       // footer/copyright text for printed pages (empty = none)
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  titleSize: 2.4,
  composerSize: 1.4,
  titleTopDistance: 5,
  titleBottomDistance: 1,
  pageTopMargin: 5,
  pageLeftMargin: 5,
  pageRightMargin: 5,
  systemSpacing: 5,
  compactMode: false,
  measuresPerSystem: 0,
  pageBreaks: false,
  pageSize: "letter",
  noteSize: 1.0,
  musicFont: "bravura",
  textFont: "georgia",
  printPageNumbers: true,
  printHeader: "",
  printFooter: "",
};

export const PRINT_LAYOUT: LayoutSettings = {
  titleSize: 2,
  composerSize: 1.2,
  titleTopDistance: 2,
  titleBottomDistance: 1,
  pageTopMargin: 2,
  pageLeftMargin: 3,
  pageRightMargin: 3,
  systemSpacing: 3,
  compactMode: true,
  measuresPerSystem: 4,
  pageBreaks: true,
  pageSize: "letter",
  noteSize: 0.65,
  musicFont: "bravura",
  textFont: "palatino",
  printPageNumbers: true,
  printHeader: "",
  printFooter: "",
};

/** Real Book style — handwritten feel, compact, like classic jazz fake books */
export const REALBOOK_LAYOUT: LayoutSettings = {
  titleSize: 3.2,
  composerSize: 1.0,
  titleTopDistance: 3,
  titleBottomDistance: 0.5,
  pageTopMargin: 3,
  pageLeftMargin: 4,
  pageRightMargin: 4,
  systemSpacing: 3,
  compactMode: true,
  measuresPerSystem: 4,
  pageBreaks: false,
  pageSize: "letter",
  noteSize: 1.0,
  musicFont: "petaluma",
  textFont: "handwritten",
  printPageNumbers: false,
  printHeader: "",
  printFooter: "",
};

export type StylePreset = "modern" | "realbook" | "print";

export const STYLE_PRESETS: Record<StylePreset, { label: string; layout: LayoutSettings }> = {
  modern: { label: "Modern", layout: DEFAULT_LAYOUT },
  realbook: { label: "Real Book", layout: REALBOOK_LAYOUT },
  print: { label: "Print", layout: PRINT_LAYOUT },
};

export interface UIState {
  sidebarOpen: boolean;
  aiDrawerOpen: boolean;
  propsDrawerOpen: boolean;
  performMode: boolean;
  /** Song-bank entry id of the currently loaded score, or null if the
   *  score isn't from the bank (e.g. fresh creation, AI-generated). Used
   *  by PerformView to find prev/next songs in the user's list. */
  currentSongId: string | null;
}

export const DEFAULT_UI_STATE: UIState = {
  sidebarOpen: true,
  aiDrawerOpen: false,
  propsDrawerOpen: true,
  performMode: false,
  currentSongId: null,
};

export interface SavedRevision {
  id: string;
  name: string;
  timestamp: number;
  score: Score;
}

export interface StepEntryState {
  active: boolean;
  staffId: string;
  voiceId: string;
  measure: number;
  beat: number;
}

export interface ClipboardData {
  /** Notes grouped by staffId → voiceId, with measures normalized to start at 1 */
  staves: {
    staffId: string;
    staffName: string;
    voices: {
      voiceId: string;
      notes: import("@/lib/schema").Note[];
    }[];
  }[];
  /** How many measures were copied */
  measureCount: number;
}

export interface ProjectState {
  // Current score
  score: Score | null;
  // Project
  projectId: string | null;
  // Revision history for undo/redo
  history: Score[];
  // Cursor (stepEntry) snapshot at each history index. Kept in lock-step with
  // `history` so undo/redo restore both score AND cursor — without this, a
  // step-entry user undoes a note but the cursor stays at the post-advance
  // position, and the next placed note lands at the wrong beat.
  stepEntryHistory: (StepEntryState | null)[];
  historyIndex: number;
  // Chat messages
  messages: ChatMessage[];
  // Validation warnings
  warnings: string[];
  // Loading state
  isGenerating: boolean;
  // Selection
  selection: NoteSelection | null;
  // Last operation (for replay)
  lastOperation: RecordedOperation | null;
  // Named saved revisions
  savedRevisions: SavedRevision[];
  // Layout settings
  layout: LayoutSettings;
  // Step-entry MIDI input
  stepEntry: StepEntryState | null;
  // Clipboard for copy/paste (not persisted)
  clipboard: ClipboardData | null;
  // UI state (persisted)
  uiState: UIState;
  // Actions
  setScore: (score: Score) => void;
  applyPatches: (patches: ScorePatch[]) => void;
  undo: () => void;
  redo: () => void;
  addMessage: (msg: ChatMessage) => void;
  setWarnings: (warnings: string[]) => void;
  setIsGenerating: (v: boolean) => void;
  setProjectId: (id: string) => void;
  setSelection: (sel: NoteSelection | null) => void;
  setLastOperation: (op: RecordedOperation | null) => void;
  saveRevision: (name: string) => void;
  restoreRevision: (id: string) => void;
  deleteRevision: (id: string) => void;
  setLayout: (layout: Partial<LayoutSettings>) => void;
  setStepEntry: (entry: StepEntryState | null) => void;
  advanceStepCursor: (beats: number) => void;
  stepBack: (beats: number) => void;
  copySelection: () => string | null;
  pasteAtSelection: () => string | null;
  setUIState: (partial: Partial<UIState>) => void;
  reset: () => void;
}

const MAX_HISTORY = 50; // Cap undo history to prevent localStorage quota overflow

export const useScoreStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  score: null,
  projectId: null,
  history: [],
  stepEntryHistory: [],
  historyIndex: -1,
  messages: [],
  warnings: [],
  isGenerating: false,
  selection: null,
  lastOperation: null,
  savedRevisions: [],
  layout: DEFAULT_LAYOUT,
  stepEntry: null,
  clipboard: null,
  uiState: DEFAULT_UI_STATE,

  setScore: (score) => {
    const state = get();
    let newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      score,
    ];
    let newStepHistory = [
      ...state.stepEntryHistory.slice(0, state.historyIndex + 1),
      state.stepEntry,
    ];
    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
      newStepHistory = newStepHistory.slice(newStepHistory.length - MAX_HISTORY);
    }
    set({
      score,
      history: newHistory,
      stepEntryHistory: newStepHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  applyPatches: (patches) => {
    const state = get();
    if (!state.score) return;

    let current = state.score;
    for (const patch of patches) {
      current = applyPatch(current, patch);
    }

    let newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      current,
    ];
    // Snapshot the current stepEntry alongside the new history entry. The
    // snapshot is later updated by advanceStepCursor/stepBack when the cursor
    // moves as part of the same logical action. On undo, we restore this
    // snapshot so the cursor returns to the position it had when this entry
    // was the active state.
    let newStepHistory = [
      ...state.stepEntryHistory.slice(0, state.historyIndex + 1),
      state.stepEntry,
    ];
    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
      newStepHistory = newStepHistory.slice(newStepHistory.length - MAX_HISTORY);
    }
    debugLog(`[Patches] ${patches.map(p => p.op).join(",")} → history[${newHistory.length - 1}], stepEntry=M${state.stepEntry?.measure}B${state.stepEntry?.beat}`);
    set({
      score: current,
      history: newHistory,
      stepEntryHistory: newStepHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    const restoredCursor = state.stepEntryHistory[newIndex] ?? state.stepEntry;
    debugLog(`[Undo] index ${state.historyIndex} → ${newIndex}, cursor M${state.stepEntry?.measure}B${state.stepEntry?.beat} → M${restoredCursor?.measure}B${restoredCursor?.beat}`);
    set({
      score: state.history[newIndex],
      historyIndex: newIndex,
      stepEntry: restoredCursor,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    const restoredCursor = state.stepEntryHistory[newIndex] ?? state.stepEntry;
    debugLog(`[Redo] index ${state.historyIndex} → ${newIndex}, cursor M${state.stepEntry?.measure}B${state.stepEntry?.beat} → M${restoredCursor?.measure}B${restoredCursor?.beat}`);
    set({
      score: state.history[newIndex],
      historyIndex: newIndex,
      stepEntry: restoredCursor,
    });
  },

  addMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  setWarnings: (warnings) => set({ warnings }),
  setIsGenerating: (v) => set({ isGenerating: v }),
  setProjectId: (id) => set({ projectId: id }),
  setSelection: (sel) => set({ selection: sel }),
  setLastOperation: (op) => set({ lastOperation: op }),

  saveRevision: (name) => {
    const state = get();
    if (!state.score) return;
    const revision: SavedRevision = {
      id: `rev-${Date.now()}`,
      name,
      timestamp: Date.now(),
      score: JSON.parse(JSON.stringify(state.score)),
    };
    set((s) => ({ savedRevisions: [...s.savedRevisions, revision] }));
  },

  restoreRevision: (id) => {
    const state = get();
    const rev = state.savedRevisions.find((r) => r.id === id);
    if (!rev) return;
    // Push restored score into undo history
    let newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      rev.score,
    ];
    let newStepHistory = [
      ...state.stepEntryHistory.slice(0, state.historyIndex + 1),
      state.stepEntry,
    ];
    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
      newStepHistory = newStepHistory.slice(newStepHistory.length - MAX_HISTORY);
    }
    set({
      score: rev.score,
      history: newHistory,
      stepEntryHistory: newStepHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  deleteRevision: (id) => {
    set((s) => ({
      savedRevisions: s.savedRevisions.filter((r) => r.id !== id),
    }));
  },

  setLayout: (partial) => {
    set((s) => ({ layout: { ...s.layout, ...partial } }));
  },

  setUIState: (partial) => {
    set((s) => ({ uiState: { ...s.uiState, ...partial } }));
  },

  setStepEntry: (entry) => set({ stepEntry: entry }),

  advanceStepCursor: (beats) => {
    const state = get();
    if (!state.stepEntry || !state.score) return;
    const [beatsStr, beatTypeStr] = state.score.timeSignature.split("/");
    const beatsPerMeasure = parseInt(beatsStr) * (4 / parseInt(beatTypeStr));

    let { measure, beat } = state.stepEntry;
    const prevBeat = beat;
    const prevMeasure = measure;
    beat += beats;
    while (beat >= beatsPerMeasure + 1 - 0.001) {
      beat -= beatsPerMeasure;
      measure++;
    }
    debugLog(`[Step] advance +${beats}: M${prevMeasure} B${prevBeat} → M${measure} B${beat.toFixed(3)} (beatsPerMeasure=${beatsPerMeasure}, ts=${state.score.timeSignature})`);

    // Dump notes in the measure we just left (when wrapping to next measure)
    if (measure !== prevMeasure) {
      const staff = state.score.staves.find(s => s.id === state.stepEntry!.staffId);
      const voice = staff?.voices.find(v => v.id === state.stepEntry!.voiceId);
      if (voice) {
        const mNotes = voice.notes
          .filter(n => n.measure === prevMeasure)
          .sort((a, b) => a.beat - b.beat);
        const DUR_BEATS: Record<string, number> = { whole: 4, half: 2, quarter: 1, eighth: 0.5, sixteenth: 0.25, "thirty-second": 0.125, "sixty-fourth": 0.0625 };
        let totalBeats = 0;
        const desc = mNotes.map(n => {
          let nb = DUR_BEATS[n.duration] || 1;
          if (n.dots) nb *= 1.5;
          totalBeats += nb;
          return `${n.pitch}@B${n.beat}(${n.duration}=${nb})`;
        });
        debugLog(`[Measure ${prevMeasure} dump] ${mNotes.length} notes, totalBeats=${totalBeats}/${beatsPerMeasure}: ${desc.join(", ")}`);
      }
    }
    const newCursor = { ...state.stepEntry, measure, beat: Math.round(beat * 1000) / 1000 };

    // Expand score if needed
    if (measure > state.score.measures) {
      const newScore = { ...state.score, measures: measure };
      let newHistory = [...state.history.slice(0, state.historyIndex + 1), newScore];
      let newStepHistory = [...state.stepEntryHistory.slice(0, state.historyIndex + 1), newCursor];
      if (newHistory.length > MAX_HISTORY) {
        newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
        newStepHistory = newStepHistory.slice(newStepHistory.length - MAX_HISTORY);
      }
      set({
        score: newScore,
        history: newHistory,
        stepEntryHistory: newStepHistory,
        historyIndex: newHistory.length - 1,
        stepEntry: newCursor,
      });
    } else {
      // Update the cursor snapshot at the current history index so undo/redo
      // restore the post-advance position (i.e. where the user actually is now).
      const updatedStepHistory = [...state.stepEntryHistory];
      if (state.historyIndex >= 0) updatedStepHistory[state.historyIndex] = newCursor;
      set({
        stepEntry: newCursor,
        stepEntryHistory: updatedStepHistory,
      });
    }
  },

  stepBack: (beats) => {
    const state = get();
    if (!state.stepEntry || !state.score) return;
    const [beatsStr, beatTypeStr] = state.score.timeSignature.split("/");
    const beatsPerMeasure = parseInt(beatsStr) * (4 / parseInt(beatTypeStr));

    let { measure, beat } = state.stepEntry;
    const prevBeat = beat;
    const prevMeasure = measure;
    beat -= beats;
    while (beat < 1 && measure > 1) {
      beat += beatsPerMeasure;
      measure--;
    }
    if (beat < 1) beat = 1;
    const newCursor = { ...state.stepEntry, measure, beat: Math.round(beat * 1000) / 1000 };
    debugLog(`[StepBack] -${beats}: M${prevMeasure} B${prevBeat} → M${measure} B${beat.toFixed(3)}`);
    const updatedStepHistory = [...state.stepEntryHistory];
    if (state.historyIndex >= 0) updatedStepHistory[state.historyIndex] = newCursor;
    set({
      stepEntry: newCursor,
      stepEntryHistory: updatedStepHistory,
    });
  },

  copySelection: () => {
    const state = get();
    if (!state.score || !state.selection) return "No selection to copy.";
    const sel = state.selection;
    const { startMeasure, endMeasure, staffIds } = sel;
    const measureCount = endMeasure - startMeasure + 1;

    const clipStaves = state.score.staves
      .filter(s => !staffIds || staffIds.length === 0 || staffIds.includes(s.id))
      .map(staff => ({
        staffId: staff.id,
        staffName: staff.name,
        voices: staff.voices.map(voice => ({
          voiceId: voice.id,
          notes: voice.notes
            .filter(n => noteInSelection(n, sel))
            .map(n => ({
              ...n,
              measure: n.measure - startMeasure + 1,
              beat: n.measure === startMeasure && sel.startBeat ? n.beat - sel.startBeat + 1 : n.beat,
            })),
        })),
      }));

    const totalNotes = clipStaves.reduce((sum, s) => sum + s.voices.reduce((vs, v) => vs + v.notes.length, 0), 0);
    if (totalNotes === 0) return "No notes in selection.";

    set({ clipboard: { staves: clipStaves, measureCount } });
    return `Copied ${totalNotes} notes from ${measureCount} measure${measureCount > 1 ? "s" : ""}.`;
  },

  pasteAtSelection: () => {
    const state = get();
    if (!state.score || !state.clipboard) return "Nothing on clipboard.";
    if (!state.selection) return "Select a destination measure first.";

    const destStart = state.selection.startMeasure;
    const clip = state.clipboard;

    // Expand score if paste would exceed current measures
    let current = state.score;
    const neededMeasures = destStart + clip.measureCount - 1;
    if (neededMeasures > current.measures) {
      current = { ...current, measures: neededMeasures };
    }

    // Build patches: for each clipboard staff, match to a score staff by index
    const scoreStaves = state.selection.staffIds && state.selection.staffIds.length > 0
      ? current.staves.filter(s => state.selection!.staffIds!.includes(s.id))
      : current.staves;

    const patches: import("@/lib/schema").ScorePatch[] = [];
    for (let i = 0; i < clip.staves.length && i < scoreStaves.length; i++) {
      const clipStaff = clip.staves[i];
      const destStaff = scoreStaves[i];

      for (const clipVoice of clipStaff.voices) {
        // Match voice by index
        const destVoice = destStaff.voices.find(v => v.id === clipVoice.voiceId) || destStaff.voices[0];
        if (!destVoice) continue;

        const offsetNotes = clipVoice.notes.map(n => ({
          ...n,
          measure: n.measure + destStart - 1,
        }));

        if (offsetNotes.length > 0) {
          patches.push({
            op: "set_notes" as const,
            staffId: destStaff.id,
            voiceId: destVoice.id,
            notes: offsetNotes,
          });
        }
      }
    }

    if (patches.length === 0) return "No matching staves to paste into.";

    // Apply patches using the already-imported applyPatch
    let result = current;
    for (const patch of patches) {
      result = applyPatch(result, patch);
    }
    let newHistory = [...state.history.slice(0, state.historyIndex + 1), result];
    let newStepHistory = [...state.stepEntryHistory.slice(0, state.historyIndex + 1), state.stepEntry];
    if (newHistory.length > MAX_HISTORY) {
      newHistory = newHistory.slice(newHistory.length - MAX_HISTORY);
      newStepHistory = newStepHistory.slice(newStepHistory.length - MAX_HISTORY);
    }
    set({
      score: result,
      history: newHistory,
      stepEntryHistory: newStepHistory,
      historyIndex: newHistory.length - 1,
    });

    const totalNotes = patches.reduce((sum, p) => (p.op === "set_notes" ? sum + p.notes.length : sum), 0);
    return `Pasted ${totalNotes} notes into measure${clip.measureCount > 1 ? "s" : ""} ${destStart}-${destStart + clip.measureCount - 1}.`;
  },

  reset: () =>
    set({
      score: null,
      projectId: null,
      history: [],
      stepEntryHistory: [],
      historyIndex: -1,
      messages: [],
      warnings: [],
      isGenerating: false,
      selection: null,
      lastOperation: null,
      savedRevisions: [],
      layout: DEFAULT_LAYOUT,
      uiState: DEFAULT_UI_STATE,
      stepEntry: null,
    }),
    }),
    {
      name: "notation-app-store",
      version: 10,
      migrate: (persisted: any, version: number) => {
        if (version < 2) {
          persisted = { ...persisted, savedRevisions: persisted.savedRevisions ?? [] };
        }
        if (version < 3) {
          persisted = { ...persisted, layout: persisted.layout ?? DEFAULT_LAYOUT };
        }
        if (version < 4) {
          persisted = { ...persisted, warnings: [] };
        }
        if (version < 7) {
          const layout = persisted.layout ?? DEFAULT_LAYOUT;
          persisted = {
            ...persisted,
            layout: {
              ...DEFAULT_LAYOUT,
              ...layout,
              measuresPerSystem: layout.measuresPerSystem ?? 0,
              pageBreaks: layout.pageBreaks ?? false,
              noteSize: layout.noteSize ?? 1.0,
              musicFont: layout.musicFont ?? "bravura",
              textFont: layout.textFont ?? "georgia",
            },
          };
        }
        if (version < 8) {
          const layout = persisted.layout ?? DEFAULT_LAYOUT;
          persisted = {
            ...persisted,
            layout: {
              ...layout,
              pageSize: layout.pageSize ?? "letter",
              printPageNumbers: layout.printPageNumbers ?? true,
              printHeader: layout.printHeader ?? "",
              printFooter: layout.printFooter ?? "",
            },
          };
        }
        if (version < 9) {
          // Clear any stuck state from schema changes
          persisted = {
            ...persisted,
            isGenerating: false,
            stepEntry: null,
          };
        }
        if (version < 10) {
          persisted = {
            ...persisted,
            uiState: persisted.uiState ?? DEFAULT_UI_STATE,
          };
        }
        return persisted as ProjectState;
      },
      partialize: (state) => ({
        score: state.score,
        projectId: state.projectId,
        // Don't persist full history — it's too large for localStorage.
        // On reload, history starts fresh with the current score.
        historyIndex: 0,
        history: state.score ? [state.score] : [],
        messages: state.messages.slice(-20), // Keep last 20 messages only
        lastOperation: state.lastOperation,
        savedRevisions: state.savedRevisions,
        layout: state.layout,
        uiState: state.uiState,
        // warnings intentionally excluded — they're transient validation results
      }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          return str ? JSON.parse(str) : null;
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (e) {
            // QuotaExceededError — silently drop the persist rather than crashing
            console.warn("[store] localStorage quota exceeded, skipping persist");
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

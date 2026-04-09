import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Score, ScorePatch } from "@/lib/schema";
import { applyPatch } from "@/lib/patches";
import { NoteSelection } from "@/lib/transforms";

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
  noteSize: number;         // notation scale factor (1.0 = default, 0.7 = smaller)
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
  noteSize: 1.0,
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
  noteSize: 0.65,
};

export interface SavedRevision {
  id: string;
  name: string;
  timestamp: number;
  score: Score;
}

export interface ProjectState {
  // Current score
  score: Score | null;
  // Project
  projectId: string | null;
  // Revision history for undo/redo
  history: Score[];
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
  reset: () => void;
}

export const useScoreStore = create<ProjectState>()(
  persist(
    (set, get) => ({
  score: null,
  projectId: null,
  history: [],
  historyIndex: -1,
  messages: [],
  warnings: [],
  isGenerating: false,
  selection: null,
  lastOperation: null,
  savedRevisions: [],
  layout: DEFAULT_LAYOUT,

  setScore: (score) => {
    const state = get();
    const newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      score,
    ];
    set({
      score,
      history: newHistory,
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

    const newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      current,
    ];
    set({
      score: current,
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0) return;
    const newIndex = state.historyIndex - 1;
    set({
      score: state.history[newIndex],
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1) return;
    const newIndex = state.historyIndex + 1;
    set({
      score: state.history[newIndex],
      historyIndex: newIndex,
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
    const newHistory = [
      ...state.history.slice(0, state.historyIndex + 1),
      rev.score,
    ];
    set({
      score: rev.score,
      history: newHistory,
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

  reset: () =>
    set({
      score: null,
      projectId: null,
      history: [],
      historyIndex: -1,
      messages: [],
      warnings: [],
      isGenerating: false,
      selection: null,
      lastOperation: null,
      savedRevisions: [],
      layout: DEFAULT_LAYOUT,
    }),
    }),
    {
      name: "notation-app-store",
      version: 6,
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
        if (version < 6) {
          const layout = persisted.layout ?? DEFAULT_LAYOUT;
          persisted = {
            ...persisted,
            layout: {
              ...layout,
              measuresPerSystem: layout.measuresPerSystem ?? 0,
              pageBreaks: layout.pageBreaks ?? false,
              noteSize: layout.noteSize ?? 1.0,
            },
          };
        }
        return persisted as ProjectState;
      },
      partialize: (state) => ({
        score: state.score,
        projectId: state.projectId,
        history: state.history,
        historyIndex: state.historyIndex,
        messages: state.messages,
        lastOperation: state.lastOperation,
        savedRevisions: state.savedRevisions,
        layout: state.layout,
        // warnings intentionally excluded — they're transient validation results
      }),
    }
  )
);

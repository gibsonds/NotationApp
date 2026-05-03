"use client";

import { useState, useRef, useEffect } from "react";
import { Score, ChordChartSection, ScorePatch } from "@/lib/schema";
import { useScoreStore, TEXT_FONT_STACKS, TextFont } from "@/store/score-store";

type ChartFont = "mono" | TextFont;
const CHART_FONT_STACKS: Record<ChartFont, string> = {
  mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  ...TEXT_FONT_STACKS,
};
const CHART_FONT_LABELS: Record<ChartFont, string> = {
  mono: "Monospace",
  georgia: "Georgia",
  palatino: "Palatino",
  garamond: "Garamond",
  times: "Times",
  helvetica: "Helvetica",
  noto: "Noto Serif",
  handwritten: "Handwritten",
};

type LabelPosition = "above" | "left" | "right";
import {
  findTokenAtColumn,
  setChordAtColumn,
  findNextWordStartCol,
  findPrevWordStartCol,
  ChordToken,
} from "@/lib/chord-line";
import ChordChartContextMenu, { ChordChartContextMenuItem } from "@/components/ChordChartContextMenu";

interface ChordChartViewProps {
  score: Score;
  /** When true, hides editor chrome (style/print controls, "+ Add Section",
   *  context menus) and disables click-to-edit. PerformView uses this to
   *  render a read-only, full-bleed view of the chart. */
  performMode?: boolean;
  /** On-screen column count (1 or 2). Only consulted when performMode is on;
   *  defaults to 1. PerformView toggles this for landscape layouts. */
  performColumns?: 1 | 2;
}

interface EditState {
  sectionId: string;
  lineIdx: number;
  /** Current column (changes when user arrow-navigates while editing). */
  col: number;
  initialValue: string;
  /**
   * If the user clicked on an existing chord token, this is its original
   * position. On commit, the original token is cleared first so arrow-moving
   * a chord/bar relocates it rather than duplicating it.
   */
  originalToken?: ChordToken;
}

/** Text-editing state — separate from chord-editing because they're different
 *  gestures (double-click vs. single-click) and edit different fields. */
interface TextEditState {
  sectionId: string;
  lineIdx: number;
}

/**
 * Render a section as a sequence of paired chord/lyric lines in monospace.
 * Column N of the chord line visually sits above column N of the lyric line —
 * that's how the user (or AI) places a chord change above a specific syllable.
 *
 * Click any character (chord or lyric) → input opens at that column. While
 * editing, arrow keys nudge the position. Enter commits, Esc cancels, empty
 * Enter deletes the chord at that column. Editing an existing chord moves it
 * (the original column is cleared on commit), so re-positioning a bar line
 * works the same way as adding one.
 */
function SectionBlock({
  section,
  onLineClick,
  onLineDoubleClick,
  onLineContextMenu,
  editing,
  textEditing,
  onEditingChange,
  onTextCommit,
  onTextCancel,
  onMove,
  onAddLine,
  onLabelCommit,
  onHeaderContextMenu,
  showDivider,
  labelPosition,
  headerFont,
  chartFont,
}: {
  section: ChordChartSection;
  onLineClick: (sectionId: string, lineIdx: number, col: number) => void;
  onLineDoubleClick: (sectionId: string, lineIdx: number) => void;
  onLineContextMenu: (sectionId: string, lineIdx: number, col: number, clientX: number, clientY: number) => void;
  editing: EditState | null;
  textEditing: TextEditState | null;
  onEditingChange: (newChord: string | null, mode: SubmitMode) => void;
  onTextCommit: (text: string) => void;
  onTextCancel: () => void;
  onMove: (delta: number) => void;
  onAddLine: (sectionId: string) => void;
  onLabelCommit: (sectionId: string, label: string) => void;
  onHeaderContextMenu: (sectionId: string, clientX: number, clientY: number) => void;
  showDivider: boolean;
  labelPosition: LabelPosition;
  headerFont: TextFont;
  chartFont: ChartFont;
}) {
  // Side-label modes use a flex row with the rotated label centered against
  // the section content. Tight gap so the label sits close to the lyrics.
  const isSide = labelPosition === "left" || labelPosition === "right";
  const sectionClass = [
    "mb-8",
    isSide ? "flex gap-2 items-center" : "",
    showDivider ? "pb-3 border-b border-gray-800/60" : "",
  ].filter(Boolean).join(" ");

  const header = (
    <EditableSectionHeader
      label={section.label}
      onCommit={(newLabel) => onLabelCommit(section.id, newLabel)}
      onContextMenu={(x, y) => onHeaderContextMenu(section.id, x, y)}
      position={labelPosition}
      font={headerFont}
    />
  );

  return (
    <section className={sectionClass}>
      {labelPosition === "above" && header}
      {labelPosition === "left" && header}
      <div
        className={`whitespace-pre ${isSide ? "flex-1 min-w-0" : ""}`}
        style={{
          fontFamily: CHART_FONT_STACKS[chartFont],
          fontSize: "var(--perf-font-size, 0.875rem)",
          lineHeight: "var(--perf-line-height, 1.25)",
          letterSpacing: "var(--perf-letter-spacing, normal)",
        }}
      >
        {section.lines.map((line, i) => {
          const isEditingThisLine =
            !!editing && editing.sectionId === section.id && editing.lineIdx === i;
          const isTextEditingThisLine =
            !!textEditing && textEditing.sectionId === section.id && textEditing.lineIdx === i;
          const highlightCol = isEditingThisLine ? editing!.col : null;
          const markerClasses = [
            line.highlight ? "bg-yellow-300/20 -mx-2 px-2 rounded" : "",
            line.underline ? "border-b-2 border-yellow-400/80" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={i} className={`mb-2 relative ${markerClasses}`}>
              {isEditingThisLine && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-pink-400 pointer-events-none z-0"
                  style={{ left: `${editing!.col}ch` }}
                />
              )}
              <ClickableChordLine
                text={line.chords}
                highlightCol={highlightCol}
                onColumnClick={(col) => onLineClick(section.id, i, col)}
                onContextMenu={(col, x, y) => onLineContextMenu(section.id, i, col, x, y)}
              >
                {isEditingThisLine && (
                  <ChordInput
                    col={editing!.col}
                    initialValue={editing!.initialValue}
                    onSubmit={(val, mode) => onEditingChange(val, mode)}
                    onCancel={() => onEditingChange(null, "close")}
                    onMove={onMove}
                  />
                )}
              </ClickableChordLine>
              {isTextEditingThisLine ? (
                <EditableLyricLine
                  initialText={line.lyrics}
                  onCommit={onTextCommit}
                  onCancel={onTextCancel}
                />
              ) : line.lyrics ? (
                <ClickableLyricLine
                  text={line.lyrics}
                  highlightCol={highlightCol}
                  onColumnClick={(col) => onLineClick(section.id, i, col)}
                  onDoubleClick={() => onLineDoubleClick(section.id, i)}
                  onContextMenu={(col, x, y) => onLineContextMenu(section.id, i, col, x, y)}
                />
              ) : (
                <ClickableEmptyLine
                  onColumnClick={(col) => onLineClick(section.id, i, col)}
                  onDoubleClick={() => onLineDoubleClick(section.id, i)}
                  onContextMenu={(col, x, y) => onLineContextMenu(section.id, i, col, x, y)}
                />
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => onAddLine(section.id)}
          className="mt-1 text-xs text-pink-400/60 hover:text-pink-300 px-2 py-0.5 rounded hover:bg-pink-500/10"
        >
          + Add line
        </button>
      </div>
      {labelPosition === "right" && header}
    </section>
  );
}

/**
 * Inline section-header editor. Click the header → it becomes a text input
 * pre-filled with the current label. Enter commits, Esc cancels, blur commits.
 * Dispatches a `set_section_label` patch. Renders in the Real Book handwritten
 * font for a songbook feel, with optional -45° rotation when displayed in
 * side-label mode (label sits in the left margin, content on the right).
 */
/**
 * Inline section-header editor. Renders the label in the chosen font (default
 * handwritten cursive). Supports three placements: above (default), left, or
 * right of the section content. For left/right, the label uses CSS
 * `writing-mode: vertical-rl` so it occupies its rotated bounding box
 * naturally in flex layout — no transform: rotate hacks needed for sizing.
 */
function EditableSectionHeader({
  label,
  onCommit,
  onContextMenu,
  position,
  font,
}: {
  label: string;
  onCommit: (newLabel: string) => void;
  onContextMenu?: (clientX: number, clientY: number) => void;
  position: LabelPosition;
  font: TextFont;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (editing) {
      setValue(label);
      settledRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, label]);

  const isVertical = position === "left" || position === "right";

  const labelStyle: React.CSSProperties = {
    fontFamily: TEXT_FONT_STACKS[font],
    fontSize: "var(--perf-label-font-size, 1.35rem)",
    lineHeight: "var(--perf-line-height, 1.05)",
    letterSpacing: "var(--perf-letter-spacing, 0.02em)",
    ...(isVertical
      ? {
          writingMode: "vertical-rl" as const,
          // For "left", flip 180° so reading direction is upward rather than
          // book-spine downward — feels more natural with the content to the
          // right of it. For "right", the default top-to-bottom reads right.
          transform: position === "left" ? "rotate(180deg)" : "none",
          padding: "2px 0",
        }
      : {}),
  };

  // No `font-semibold` — handwritten typefaces (Marker Felt, Caveat,
  // Bradley Hand) already render with a heavy stylized stroke; adding
  // bold on top makes them look chunky. Let the font's natural weight show.
  const baseClass = "text-pink-300 italic whitespace-nowrap";

  if (editing) {
    const commit = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      const trimmed = value.trim();
      if (trimmed && trimmed !== label) onCommit(trimmed);
      setEditing(false);
    };
    const cancel = () => {
      if (settledRef.current) return;
      settledRef.current = true;
      setValue(label);
      setEditing(false);
    };
    // Always render the editing input upright — vertical inputs are confusing
    // to type into. Snaps back to rotated/vertical after commit.
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={commit}
        className={`${baseClass} bg-pink-900/30 outline-none ring-2 ring-pink-400 rounded px-1 py-0 w-44`}
        style={{ ...labelStyle, writingMode: "horizontal-tb", transform: "none" }}
        autoComplete="off"
        spellCheck={false}
      />
    );
  }

  return (
    <h3
      className={`${baseClass} cursor-text hover:text-pink-200 ${position === "above" ? "inline-block mb-2" : ""}`}
      style={labelStyle}
      onClick={() => setEditing(true)}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      title="Click to rename. Right-click for section actions."
    >
      {label}
    </h3>
  );
}

/**
 * Inline lyric-text editor. Replaces the lyric line with a textarea pre-filled
 * with the current text. Pressing Enter inserts a newline (so committing a
 * multi-line value splits the section line into N consecutive lines). Esc
 * cancels, Cmd/Ctrl+Enter or blur commits.
 */
function EditableLyricLine({
  initialText,
  onCommit,
  onCancel,
}: {
  initialText: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  // Auto-grow the textarea to fit its content (line count).
  const rows = Math.max(1, value.split("\n").length);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={rows}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
        }
        // Plain Enter inserts a newline (default textarea behavior) — that's
        // how the user splits one section line into multiple.
      }}
      onBlur={commit}
      className="w-full bg-pink-900/20 text-white text-sm rounded px-1 outline-none ring-2 ring-pink-400/50 resize-none whitespace-pre leading-tight"
      style={{ fontFamily: "inherit" }}
      spellCheck={false}
    />
  );
}

/**
 * Render a monospace text line and split a single character at `highlightCol`
 * into its own span so the active column gets a background highlight + bold
 * weight — both common monospace fonts preserve glyph width when bolded so
 * the columns of surrounding text stay aligned.
 */
function HighlightedText({
  text,
  highlightCol,
  baseClass,
}: {
  text: string;
  highlightCol: number | null;
  baseClass: string;
}) {
  if (highlightCol === null) {
    return <>{text || " "}</>;
  }
  const before = text.slice(0, highlightCol);
  const target = text[highlightCol] ?? " ";
  const after = text.slice(highlightCol + 1);
  return (
    <>
      <span>{before}</span>
      <span className={`${baseClass} font-bold bg-pink-500/30`}>{target}</span>
      <span>{after}</span>
    </>
  );
}

/**
 * Compute the click column from clientX. Measures the inline `<span>` that
 * contains the text — NOT the outer block `<div>`, which stretches to the
 * full container width and would yield a wildly inflated char width that
 * pushes click positions to the left of where the user clicked.
 */
function columnFromClick(
  textSpan: HTMLSpanElement,
  text: string,
  clientX: number,
): number {
  const rect = textSpan.getBoundingClientRect();
  const sample = window.getComputedStyle(textSpan);
  const fontSizePx = parseFloat(sample.fontSize) || 14;
  const charWidth =
    text.length > 0 ? rect.width / text.length : fontSizePx * 0.6;
  // Anchor to the span's left edge so clicks past the end of the text still
  // resolve to a column past the last character (chord can land in the void
  // beyond the lyric — useful for instrumental tags or end-of-line bar lines).
  return Math.max(0, Math.floor((clientX - rect.left) / Math.max(charWidth, 1)));
}

function ClickableChordLine({
  text,
  highlightCol,
  onColumnClick,
  onContextMenu,
  children,
}: {
  text: string;
  highlightCol: number | null;
  onColumnClick: (col: number) => void;
  onContextMenu: (col: number, clientX: number, clientY: number) => void;
  children?: React.ReactNode;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const span = spanRef.current;
    if (!span) return;
    onColumnClick(columnFromClick(span, text, e.clientX));
  };
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const span = spanRef.current;
    if (!span) return;
    onContextMenu(columnFromClick(span, text, e.clientX), e.clientX, e.clientY);
  };
  return (
    <div
      className="text-yellow-300 whitespace-pre min-h-[1em] relative cursor-text hover:bg-white/5"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span ref={spanRef}>
        <HighlightedText text={text} highlightCol={highlightCol} baseClass="text-pink-200" />
      </span>
      {children}
    </div>
  );
}

function ClickableLyricLine({
  text,
  highlightCol,
  onColumnClick,
  onDoubleClick,
  onContextMenu,
}: {
  text: string;
  highlightCol: number | null;
  onColumnClick: (col: number) => void;
  onDoubleClick: () => void;
  onContextMenu: (col: number, clientX: number, clientY: number) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail >= 2) return;
    const span = spanRef.current;
    if (!span) return;
    onColumnClick(columnFromClick(span, text, e.clientX));
  };
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const span = spanRef.current;
    if (!span) return;
    onContextMenu(columnFromClick(span, text, e.clientX), e.clientX, e.clientY);
  };
  return (
    <div
      className="text-gray-100 whitespace-pre cursor-text hover:bg-white/5"
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenu}
      title="Click: chord. Double-click: edit text. Right-click: line menu."
    >
      <span ref={spanRef}>
        <HighlightedText text={text} highlightCol={highlightCol} baseClass="text-white" />
      </span>
    </div>
  );
}

function ClickableEmptyLine({
  onColumnClick,
  onDoubleClick,
  onContextMenu,
}: {
  onColumnClick: (col: number) => void;
  onDoubleClick: () => void;
  onContextMenu: (col: number, clientX: number, clientY: number) => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.detail >= 2) return;
    const span = spanRef.current;
    if (!span) return;
    onColumnClick(columnFromClick(span, "", e.clientX));
  };
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const span = spanRef.current;
    if (!span) return;
    onContextMenu(columnFromClick(span, "", e.clientX), e.clientX, e.clientY);
  };
  return (
    <div
      className="text-gray-500 whitespace-pre cursor-text hover:bg-white/5 italic min-h-[1em]"
      onClick={handleClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={handleContextMenu}
      title="Click: chord. Double-click: add lyric text. Right-click: line menu."
    >
      <span ref={spanRef}>{" "}</span>
    </div>
  );
}

/**
 * Floating input over the chord line at the clicked column. Auto-focuses on
 * mount. Keyboard contract:
 *   - Enter            → commit and close
 *   - Tab              → commit and jump to the NEXT word in the lyric line
 *   - Shift+Tab        → commit and jump to the PREVIOUS word
 *   - Esc              → cancel
 *   - Shift+←/→        → nudge the chord's column position
 *   - plain ←/→        → move text caret inside the input (preserved default)
 *   - blur (click out) → commit and close
 *
 * Empty submit deletes the chord at that column.
 */
type SubmitMode = "close" | "next-word" | "prev-word" | "step-left" | "step-right";

function ChordInput({
  col,
  initialValue,
  onSubmit,
  onCancel,
  onMove,
}: {
  col: number;
  initialValue: string;
  onSubmit: (newChord: string, mode: SubmitMode) => void;
  onCancel: () => void;
  onMove: (delta: number) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // Scroll into view so an input way out at column 80 doesn't sit hidden
    // off the right edge of the scrollable chord-chart container.
    el.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
  }, []);

  const submit = (val: string, mode: SubmitMode) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(val, mode);
  };
  const cancel = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onCancel();
  };

  // Auto-grow the input so longer chord names like "Cmaj7sus4" or "F#m7b5/A"
  // always fit visibly. Width tracks the value's character count, with a
  // minimum so empty/short values still have a usable target.
  const widthCh = Math.max(value.length + 2, 6);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit(value.trim(), "close");
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      submit(value.trim(), e.shiftKey ? "prev-word" : "next-word");
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === "ArrowLeft" && e.altKey) {
      // Alt+←: commit current chord and re-open input one column to the LEFT.
      // Letter-grain analogue of Shift+Tab. Lets the user step the editing
      // position one character at a time without leaving the keyboard.
      e.preventDefault();
      e.stopPropagation();
      submit(value.trim(), "step-left");
    } else if (e.key === "ArrowRight" && e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      submit(value.trim(), "step-right");
    } else if (e.key === "ArrowLeft" && e.shiftKey) {
      e.preventDefault();
      onMove(-1);
    } else if (e.key === "ArrowRight" && e.shiftKey) {
      e.preventDefault();
      onMove(1);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKey}
      onBlur={() => submit(value.trim(), "close")}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 z-30 bg-pink-900 text-yellow-200 outline-none ring-2 ring-pink-400 rounded px-1 py-0 text-sm"
      // fontFamily: inherit — picks up the chart font from the section's
      // wrapping div so 1ch in the input matches 1ch in the chord/lyric lines
      // (column alignment depends on this).
      style={{ left: `${col}ch`, width: `${widthCh}ch`, minWidth: "5rem", fontFamily: "inherit" }}
      placeholder="chord"
      autoComplete="off"
      spellCheck={false}
    />
  );
}

interface ContextMenuState {
  sectionId: string;
  lineIdx: number;
  col: number;
  x: number;
  y: number;
}

interface HeaderContextMenuState {
  sectionId: string;
  x: number;
  y: number;
}

export default function ChordChartView({ score, performMode = false, performColumns = 1 }: ChordChartViewProps) {
  const applyPatches = useScoreStore((s) => s.applyPatches);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [textEditing, setTextEditing] = useState<TextEditState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [headerContextMenu, setHeaderContextMenu] = useState<HeaderContextMenuState | null>(null);
  // Print density toggles. Each adds a CSS class that's only consulted by
  // @media print rules — no on-screen effect. Persisted in component state
  // (not the score) so toggling them doesn't show as a revision.
  const [printNoMeta, setPrintNoMeta] = useState(false);
  const [printNoTitle, setPrintNoTitle] = useState(false);
  const [printColumns, setPrintColumns] = useState<1 | 2>(2);
  const [printFontSize, setPrintFontSize] = useState(10);   // pt
  const [printLineHeight, setPrintLineHeight] = useState(1.15);
  const [printLetterSpacing, setPrintLetterSpacing] = useState(0);  // em
  const [printSectionGap, setPrintSectionGap] = useState(12);  // pt
  // Style preferences (apply to both screen + print).
  const [sectionDividers, setSectionDividers] = useState(false);
  const [labelPosition, setLabelPosition] = useState<LabelPosition>("above");
  const [headerFont, setHeaderFont] = useState<TextFont>("handwritten");
  const [chartFont, setChartFont] = useState<ChartFont>("mono");

  const sectionMap = new Map(score.sections.map(s => [s.id, s]));

  // Each section has ONE physical position in the chart, in `score.sections`
  // order. The `form` field stays as playback metadata only (rendered at the
  // top of the header). If we ordered display by form, "Add section above
  // verse 2" wouldn't have a sensible target when form repeats section IDs,
  // and a newly-added section (not yet in form) would always be appended at
  // the end instead of at the clicked position.
  const displayOrder: ChordChartSection[] = score.sections;

  const formDisplay = (() => {
    if (!score.form || score.form.length === 0) return null;
    const groups: { id: string; n: number }[] = [];
    for (const id of score.form) {
      const last = groups[groups.length - 1];
      if (last && last.id === id) last.n += 1;
      else groups.push({ id, n: 1 });
    }
    return groups.map(g => (g.n > 1 ? `${g.id}×${g.n}` : g.id)).join(" ");
  })();

  const handleLineClick = (sectionId: string, lineIdx: number, col: number) => {
    if (performMode) return;
    const section = sectionMap.get(sectionId);
    if (!section) return;
    const line = section.lines[lineIdx];
    if (!line) return;
    const existing = findTokenAtColumn(line.chords, col);
    setEditing({
      sectionId,
      lineIdx,
      col: existing ? existing.start : col,
      initialValue: existing?.text ?? "",
      originalToken: existing,
    });
  };

  const handleMove = (delta: number) => {
    setEditing(prev => prev ? { ...prev, col: Math.max(0, prev.col + delta) } : prev);
  };

  const handleLineDoubleClick = (sectionId: string, lineIdx: number) => {
    if (performMode) return;
    // Cancel any chord-edit in progress before switching to text-edit so the
    // input doesn't write a stale chord on blur.
    setEditing(null);
    setTextEditing({ sectionId, lineIdx });
  };

  const handleTextCommit = (newText: string) => {
    if (!textEditing) return;
    const section = sectionMap.get(textEditing.sectionId);
    if (!section) {
      setTextEditing(null);
      return;
    }
    const oldLine = section.lines[textEditing.lineIdx];
    if (!oldLine) {
      setTextEditing(null);
      return;
    }

    const parts = newText.split("\n");

    // Single-line edit — just update the text in place. Use the fine-grained
    // patch so undo/redo reads cleanly (and so an LLM/CLI caller can do the
    // same).
    if (parts.length === 1) {
      if (parts[0] === oldLine.lyrics) {
        setTextEditing(null);
        return;
      }
      applyPatches([{
        op: "update_section_line",
        sectionId: textEditing.sectionId,
        lineIdx: textEditing.lineIdx,
        lyrics: parts[0],
      }]);
      setTextEditing(null);
      return;
    }

    // Multi-line edit (user pressed Enter inside the textarea) — first part
    // becomes the current line's new lyrics (chord overlay preserved); the
    // rest become new lines inserted after, each with an empty chord line.
    const patches: ScorePatch[] = [{
      op: "update_section_line",
      sectionId: textEditing.sectionId,
      lineIdx: textEditing.lineIdx,
      lyrics: parts[0],
    }];
    parts.slice(1).forEach((p, i) => {
      patches.push({
        op: "add_section_line",
        sectionId: textEditing.sectionId,
        index: textEditing.lineIdx + 1 + i,
        line: { chords: "", lyrics: p },
      });
    });
    applyPatches(patches);
    setTextEditing(null);
  };

  const handleTextCancel = () => setTextEditing(null);

  const handleAddLine = (sectionId: string) => {
    if (performMode) return;
    const section = sectionMap.get(sectionId);
    if (!section) return;
    const newIdx = section.lines.length;
    applyPatches([{
      op: "add_section_line",
      sectionId,
      line: { chords: "", lyrics: "" },
    }]);
    // Open text editor for the new line so the user can immediately type.
    setTextEditing({ sectionId, lineIdx: newIdx });
  };

  const handleLabelCommit = (sectionId: string, label: string) => {
    if (performMode) return;
    applyPatches([{ op: "set_section_label", sectionId, label }]);
  };

  const handleLineContextMenu = (
    sectionId: string,
    lineIdx: number,
    col: number,
    clientX: number,
    clientY: number,
  ) => {
    if (performMode) return;
    setEditing(null);
    setTextEditing(null);
    setContextMenu({ sectionId, lineIdx, col, x: clientX, y: clientY });
  };

  const handleRemoveLine = (sectionId: string, lineIdx: number) => {
    applyPatches([{ op: "remove_section_line", sectionId, lineIdx }]);
  };

  const handleAddLineAt = (sectionId: string, index: number, openEditor: boolean) => {
    applyPatches([{
      op: "add_section_line",
      sectionId,
      index,
      line: { chords: "", lyrics: "" },
    }]);
    if (openEditor) setTextEditing({ sectionId, lineIdx: index });
  };

  const newSectionId = () => {
    let i = score.sections.length + 1;
    while (sectionMap.has(`s${i}`)) i++;
    return `s${i}`;
  };

  const handleAddSection = (atIndex?: number, label = "New Section") => {
    const id = newSectionId();
    applyPatches([{
      op: "add_section",
      index: atIndex,
      section: {
        id,
        label,
        lines: [{ chords: "", lyrics: "" }],
      },
    }]);
  };

  const handleRemoveSection = (sectionId: string) => {
    applyPatches([{ op: "remove_section", sectionId }]);
  };

  const handleHeaderContextMenu = (sectionId: string, x: number, y: number) => {
    if (performMode) return;
    setEditing(null);
    setTextEditing(null);
    setContextMenu(null);
    setHeaderContextMenu({ sectionId, x, y });
  };

  const buildHeaderMenuItems = (ctx: HeaderContextMenuState): ChordChartContextMenuItem[] => {
    const idx = score.sections.findIndex(s => s.id === ctx.sectionId);
    return [
      {
        label: "Add section above",
        onClick: () => handleAddSection(idx >= 0 ? idx : undefined),
      },
      {
        label: "Add section below",
        onClick: () => handleAddSection(idx >= 0 ? idx + 1 : undefined),
      },
      {
        divider: true,
        label: "Delete section",
        destructive: true,
        disabled: score.sections.length <= 1,
        onClick: () => handleRemoveSection(ctx.sectionId),
      },
    ];
  };

  // Build the menu items for a given right-click context.
  const buildMenuItems = (ctx: ContextMenuState): ChordChartContextMenuItem[] => {
    const section = sectionMap.get(ctx.sectionId);
    const lineCount = section?.lines.length ?? 0;
    const line = section?.lines[ctx.lineIdx];
    return [
      {
        label: "Insert chord here",
        onClick: () => handleLineClick(ctx.sectionId, ctx.lineIdx, ctx.col),
      },
      {
        label: "Edit lyric text",
        onClick: () => handleLineDoubleClick(ctx.sectionId, ctx.lineIdx),
      },
      {
        divider: true,
        label: line?.highlight ? "Remove highlight" : "Highlight line",
        onClick: () =>
          applyPatches([{
            op: "update_section_line",
            sectionId: ctx.sectionId,
            lineIdx: ctx.lineIdx,
            highlight: !line?.highlight,
          }]),
      },
      {
        label: line?.underline ? "Remove underline" : "Underline line",
        onClick: () =>
          applyPatches([{
            op: "update_section_line",
            sectionId: ctx.sectionId,
            lineIdx: ctx.lineIdx,
            underline: !line?.underline,
          }]),
      },
      { divider: true, label: "Add line above", onClick: () => handleAddLineAt(ctx.sectionId, ctx.lineIdx, true) },
      { label: "Add line below", onClick: () => handleAddLineAt(ctx.sectionId, ctx.lineIdx + 1, true) },
      {
        divider: true,
        label: "Split section here (new section starts at this line)",
        // Splitting at line 0 is degenerate (empty original section); the
        // header right-click "Add section above" is the right gesture there.
        disabled: ctx.lineIdx === 0,
        onClick: () => handleSplitSection(ctx.sectionId, ctx.lineIdx),
      },
      {
        label: "Delete line",
        destructive: true,
        disabled: lineCount <= 1,
        onClick: () => handleRemoveLine(ctx.sectionId, ctx.lineIdx),
      },
    ];
  };

  const handleSplitSection = (sectionId: string, atLineIdx: number) => {
    applyPatches([{
      op: "split_section",
      sectionId,
      atLineIdx,
      newSection: { id: newSectionId(), label: "New Section" },
    }]);
  };

  const handleEditingChange = (newChord: string | null, mode: SubmitMode) => {
    if (!editing) {
      setEditing(null);
      return;
    }
    if (newChord === null) {
      // Cancel — no patch
      setEditing(null);
      return;
    }

    const section = sectionMap.get(editing.sectionId);
    if (!section) {
      setEditing(null);
      return;
    }
    const line = section.lines[editing.lineIdx];
    if (!line) {
      setEditing(null);
      return;
    }

    let newChords = line.chords;
    if (editing.originalToken) {
      newChords = setChordAtColumn(newChords, editing.originalToken.start, "");
    }
    if (newChord !== "") {
      // Don't clobber a different token (e.g. a bar line) sitting at the
      // target column. If the destination is already occupied by something
      // other than the token we're moving, slide the placement to right
      // after that token so a moved chord lands adjacent to a bar instead
      // of replacing it.
      let targetCol = editing.col;
      const collision = findTokenAtColumn(newChords, targetCol, 0);
      if (collision) {
        targetCol = collision.start + collision.len;
      }
      newChords = setChordAtColumn(newChords, targetCol, newChord);
    }

    if (newChords !== line.chords) {
      applyPatches([{
        op: "update_section_line",
        sectionId: editing.sectionId,
        lineIdx: editing.lineIdx,
        chords: newChords,
      }]);
    }

    if (mode === "close") {
      setEditing(null);
      return;
    }

    // Tab / Shift+Tab → next/previous word.
    // Alt+←/→ → previous/next column (letter-grain step).
    // For all four, re-open the chord input at the new position so editing
    // stays on the keyboard.
    let target: { lineIdx: number; col: number } | null;
    if (mode === "step-left") {
      target = { lineIdx: editing.lineIdx, col: Math.max(0, editing.col - 1) };
    } else if (mode === "step-right") {
      target = { lineIdx: editing.lineIdx, col: editing.col + 1 };
    } else {
      target = findNextEditingTarget(
        section,
        editing.lineIdx,
        editing.col,
        mode === "next-word" ? "forward" : "backward",
      );
    }
    if (!target) {
      setEditing(null);
      return;
    }
    const targetSection = sectionMap.get(editing.sectionId)!;
    const targetLine = newChords && target.lineIdx === editing.lineIdx
      ? { ...targetSection.lines[target.lineIdx], chords: newChords }
      : targetSection.lines[target.lineIdx];
    const existing = findTokenAtColumn(targetLine.chords, target.col);
    setEditing({
      sectionId: editing.sectionId,
      lineIdx: target.lineIdx,
      col: existing ? existing.start : target.col,
      initialValue: existing?.text ?? "",
      originalToken: existing,
    });
  };

  /**
   * Walk forward/backward through the section's lyric lines to find the next
   * word start. Hops to subsequent (or prior) lines when the current line has
   * no more words. Returns null if there's nothing left to land on.
   */
  function findNextEditingTarget(
    section: ChordChartSection,
    fromLineIdx: number,
    fromCol: number,
    direction: "forward" | "backward",
  ): { lineIdx: number; col: number } | null {
    const step = direction === "forward" ? 1 : -1;
    // Try the current line first
    const cur = section.lines[fromLineIdx];
    if (cur) {
      const col = direction === "forward"
        ? findNextWordStartCol(cur.lyrics, fromCol)
        : findPrevWordStartCol(cur.lyrics, fromCol);
      if (col !== null) return { lineIdx: fromLineIdx, col };
    }
    // Otherwise hop lines until we find one with a usable word
    for (let li = fromLineIdx + step; li >= 0 && li < section.lines.length; li += step) {
      const line = section.lines[li];
      if (!line.lyrics) continue;
      const col = direction === "forward"
        ? findNextWordStartCol(line.lyrics, -1)
        : findPrevWordStartCol(line.lyrics, line.lyrics.length);
      if (col !== null) return { lineIdx: li, col };
    }
    return null;
  }

  const printClass = [
    "chord-chart",
    printNoMeta ? "chord-chart-print-no-meta" : "",
    printNoTitle ? "chord-chart-print-no-title" : "",
  ].filter(Boolean).join(" ");

  const printVars: React.CSSProperties = {
    // CSS custom properties consumed only by @media print rules in globals.css.
    // Setting them on the wrapper keeps them scoped to this chart.
    ["--print-cols" as never]: printColumns,
    ["--print-font-size" as never]: `${printFontSize}pt`,
    ["--print-line-height" as never]: printLineHeight,
    ["--print-letter-spacing" as never]: `${printLetterSpacing}em`,
    ["--print-section-gap" as never]: `${printSectionGap}pt`,
  };

  // In perform mode, the parent (PerformView) owns scrolling — drop the
  // inner overflow-auto and h-full so its scrollBy() actually moves content.
  // chord-chart-perform tightens section gaps in the perform CSS layer.
  const performColsClass = performMode && performColumns === 2 ? "perform-cols-2" : "";
  const wrapperClass = performMode
    ? `${printClass} chord-chart-perform ${performColsClass} w-full bg-[#0f0f1f] text-gray-100 px-6 pt-2 pb-4 font-sans`
    : `${printClass} w-full h-full overflow-auto bg-[#0f0f1f] text-gray-100 p-8 font-sans`;

  return (
    <div
      className={wrapperClass}
      style={printVars}
    >
      {/* Style + print controls — on-screen only (hidden via .print-hide). */}
      {!performMode && (
      <div className="print-hide flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400 mb-3 select-none">
        <span className="font-semibold uppercase tracking-wider">Style:</span>

        <label className="inline-flex items-center gap-1">
          <span>Labels</span>
          <select
            value={labelPosition}
            onChange={(e) => setLabelPosition(e.target.value as LabelPosition)}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200"
          >
            <option value="above">above</option>
            <option value="left">left</option>
            <option value="right">right</option>
          </select>
        </label>

        <label className="inline-flex items-center gap-1">
          <span>Header font</span>
          <select
            value={headerFont}
            onChange={(e) => setHeaderFont(e.target.value as TextFont)}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200"
          >
            {(Object.entries(TEXT_FONT_STACKS) as [TextFont, string][]).map(([key]) => (
              <option key={key} value={key}>{CHART_FONT_LABELS[key]}</option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1">
          <span>Chart font</span>
          <select
            value={chartFont}
            onChange={(e) => setChartFont(e.target.value as ChartFont)}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200"
            title="Font for chord overlays and lyrics. Monospace is required for precise chord-over-syllable alignment; other fonts are stylistic."
          >
            {(Object.keys(CHART_FONT_STACKS) as ChartFont[]).map((key) => (
              <option key={key} value={key}>{CHART_FONT_LABELS[key]}</option>
            ))}
          </select>
        </label>

        <label className="inline-flex items-center gap-1 cursor-pointer hover:text-gray-200">
          <input type="checkbox" checked={sectionDividers} onChange={(e) => setSectionDividers(e.target.checked)} className="accent-pink-400" />
          <span>Dividers</span>
        </label>

        <span className="text-gray-700">|</span>
        <span className="font-semibold uppercase tracking-wider">Print:</span>
        <label className="inline-flex items-center gap-1">
          <span>Cols</span>
          <select
            value={printColumns}
            onChange={(e) => setPrintColumns(Number(e.target.value) as 1 | 2)}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-200"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1" title="Font size (pt)">
          <span>Size</span>
          <input
            type="number"
            min={6}
            max={18}
            step={0.5}
            value={printFontSize}
            onChange={(e) => setPrintFontSize(Number(e.target.value))}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 w-12"
          />
          <span className="text-gray-600">pt</span>
        </label>
        <label className="inline-flex items-center gap-1" title="Line height (leading) — multiplier of font size">
          <span>Lead</span>
          <input
            type="number"
            min={0.85}
            max={1.8}
            step={0.05}
            value={printLineHeight}
            onChange={(e) => setPrintLineHeight(Number(e.target.value))}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 w-14"
          />
        </label>
        <label className="inline-flex items-center gap-1" title="Letter spacing (kerning) in em">
          <span>Kern</span>
          <input
            type="number"
            min={-0.05}
            max={0.2}
            step={0.005}
            value={printLetterSpacing}
            onChange={(e) => setPrintLetterSpacing(Number(e.target.value))}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 w-14"
          />
          <span className="text-gray-600">em</span>
        </label>
        <label className="inline-flex items-center gap-1" title="Vertical gap between sections (pt)">
          <span>Gap</span>
          <input
            type="number"
            min={0}
            max={36}
            step={1}
            value={printSectionGap}
            onChange={(e) => setPrintSectionGap(Number(e.target.value))}
            className="bg-[#1a1a2e] border border-gray-700 rounded px-1 py-0.5 text-xs text-gray-200 w-12"
          />
          <span className="text-gray-600">pt</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer hover:text-gray-200">
          <input type="checkbox" checked={printNoMeta} onChange={(e) => setPrintNoMeta(e.target.checked)} className="accent-pink-400" />
          <span>Hide meta</span>
        </label>
        <label className="inline-flex items-center gap-1 cursor-pointer hover:text-gray-200">
          <input type="checkbox" checked={printNoTitle} onChange={(e) => setPrintNoTitle(e.target.checked)} className="accent-pink-400" />
          <span>Hide title</span>
        </label>
      </div>
      )}
      {!performMode && (
      <header className="mb-6 pb-4 border-b border-gray-700">
        <h1 className="text-3xl font-bold text-white">{score.title || "Untitled"}</h1>
        {score.composer && <p className="text-gray-400 mt-1">{score.composer}</p>}
        <div className="text-sm text-gray-500 mt-2 flex gap-4 flex-wrap">
          <span>{score.timeSignature}</span>
          <span>{score.tempo} bpm</span>
          <span>Key of {score.keySignature}</span>
          {formDisplay && <span>Form: {formDisplay}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-2 italic">
          <strong>Click</strong>: add/edit a chord ({" "}
          <code className="text-pink-300">D</code>,{" "}
          <code className="text-pink-300">Am7</code>) or bar line ({" "}
          <code className="text-pink-300">|</code>).
          <strong> Tab</strong>: commit and jump to the next word.
          <strong> Shift+Tab</strong>: previous word.{" "}
          <strong>Option+←/→</strong> (Alt+←/→ on Win): commit and step one column.{" "}
          <strong>Shift+←/→</strong>: move the chord position before commit.
          Plain ←/→ moves the text caret. <strong>Enter</strong>: commit and
          close. <strong>Esc</strong>: cancel. Empty + Enter deletes.{" "}
          <strong>Double-click</strong> a lyric to edit (Enter splits line).{" "}
          <strong>Right-click</strong> a line for the line menu.{" "}
          <strong>Click</strong> a section header to rename.
        </p>
      </header>
      )}

      {displayOrder.length === 0 ? (
        <div className="space-y-3">
          <p className="text-gray-500 italic">
            No chord chart yet. Try asking the AI:{" "}
            <code className="bg-gray-900 px-2 py-0.5 rounded text-pink-300 mx-1">
              paste lyrics — no notation, just lyrics for verse 1: ...
            </code>
            {" "}or start a section manually:
          </p>
          <button
            type="button"
            onClick={() => handleAddSection()}
            className="text-sm text-pink-300 hover:text-white px-3 py-1.5 rounded border border-pink-500/40 hover:bg-pink-500/20 transition-colors"
          >
            + Add Section
          </button>
        </div>
      ) : (
        <>
          {displayOrder.map(section => (
            <SectionBlock
              key={section.id}
              section={section}
              onLineClick={handleLineClick}
              onLineDoubleClick={handleLineDoubleClick}
              onLineContextMenu={handleLineContextMenu}
              editing={editing}
              textEditing={textEditing}
              onEditingChange={handleEditingChange}
              onTextCommit={handleTextCommit}
              onTextCancel={handleTextCancel}
              onMove={handleMove}
              onAddLine={handleAddLine}
              onLabelCommit={handleLabelCommit}
              onHeaderContextMenu={handleHeaderContextMenu}
              showDivider={sectionDividers}
              labelPosition={labelPosition}
              headerFont={headerFont}
              chartFont={chartFont}
            />
          ))}
          {!performMode && (
          <div className="mt-6 pt-4 border-t border-gray-800">
            <button
              type="button"
              onClick={() => handleAddSection()}
              className="text-sm text-pink-300 hover:text-white px-4 py-2 rounded-md border border-pink-500/40 hover:bg-pink-500/20 transition-colors font-semibold"
            >
              + Add Section
            </button>
          </div>
          )}
        </>
      )}
      {contextMenu && (
        <ChordChartContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {headerContextMenu && (
        <ChordChartContextMenu
          x={headerContextMenu.x}
          y={headerContextMenu.y}
          items={buildHeaderMenuItems(headerContextMenu)}
          onClose={() => setHeaderContextMenu(null)}
        />
      )}
    </div>
  );
}

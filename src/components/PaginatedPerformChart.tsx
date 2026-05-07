"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChordChartSection, ChordChartLine, Score } from "@/lib/schema";

const MONO_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

/**
 * Each block is either a section header or a single line. The packer
 * treats them independently so a section never bleeds past the bottom of
 * a column — the worst case is a clean break between two of its lines.
 * Continuation columns get a "(Section Label …)" label so the user
 * doesn't lose context.
 */
type Block =
  | { kind: "header"; sectionId: string; section: ChordChartSection }
  | { kind: "line"; sectionId: string; lineIdx: number; line: ChordChartLine };

interface ColumnContent {
  blocks: Block[];
}
interface Page {
  col1: ColumnContent;
  col2: ColumnContent;
}

interface PerformPrefsLike {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

interface PaginatedPerformChartProps {
  score: Score;
  prefs: PerformPrefsLike;
  /** Forwarded ref to the horizontally-scrolling pages strip; PerformView
   *  uses it to drive the bottom pager. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPageChange?: (current: number, total: number) => void;
}

/**
 * Quark-XPress-style 2-column performance layout. Bin-packs by individual
 * line (and section header) so columns always end on a clean line boundary
 * — content can't bleed past the column edge regardless of section size.
 *
 * Reflow is automatic: font/leading/kerning change, ResizeObserver, or
 * score change all retrigger measurement and re-pack.
 */
export default function PaginatedPerformChart({
  score,
  prefs,
  scrollRef,
  onPageChange,
}: PaginatedPerformChartProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const measureContainerRef = useRef<HTMLDivElement | null>(null);
  const measureRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const [pages, setPages] = useState<Page[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  // Flatten the score into per-line blocks. Headers are their own block so
  // we can measure them and decide whether to keep the header attached to
  // its first line at column boundaries. Memoized on score.sections so the
  // recompute callback below doesn't get a fresh identity every render —
  // a fresh identity caused useLayoutEffect to re-fire on every setPages
  // and pegged React's max-update-depth guard.
  const blocks = useMemo<Block[]>(() => {
    const out: Block[] = [];
    for (const section of score.sections) {
      out.push({ kind: "header", sectionId: section.id, section });
      section.lines.forEach((line, lineIdx) => {
        out.push({ kind: "line", sectionId: section.id, lineIdx, line });
      });
    }
    return out;
  }, [score.sections]);

  const blockKey = (b: Block) =>
    b.kind === "header" ? `h:${b.sectionId}` : `l:${b.sectionId}:${b.lineIdx}`;

  const recompute = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const pageW = outer.clientWidth;
    const pageH = outer.clientHeight;
    if (pageW === 0 || pageH === 0) return;

    const PAD_Y = 8; // px — matches .py-2 on each visible page
    const colHeight = pageH - 2 * PAD_Y;

    const heights = new Map<string, number>();
    for (const b of blocks) {
      const key = blockKey(b);
      const el = measureRefs.current.get(key);
      if (el) heights.set(key, el.getBoundingClientRect().height);
    }

    const result: Page[] = [];
    let curPage: Page = { col1: { blocks: [] }, col2: { blocks: [] } };
    let curCol: "col1" | "col2" = "col1";
    let used = 0;

    const flushPage = () => {
      const hasContent =
        curPage.col1.blocks.length > 0 || curPage.col2.blocks.length > 0;
      if (hasContent) result.push(curPage);
      curPage = { col1: { blocks: [] }, col2: { blocks: [] } };
      curCol = "col1";
      used = 0;
    };
    const advanceCol = () => {
      if (curCol === "col1") {
        curCol = "col2";
        used = 0;
      } else {
        flushPage();
      }
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const h = heights.get(blockKey(b)) ?? 0;

      // If a header lands at the bottom of a column with no room for at
      // least its first line, push the header to the next column so the
      // user never sees an orphan title.
      if (b.kind === "header" && curPage[curCol].blocks.length > 0) {
        const next = blocks[i + 1];
        const nextH = next ? (heights.get(blockKey(next)) ?? 0) : 0;
        if (used + h + nextH > colHeight) {
          advanceCol();
        }
      } else if (used + h > colHeight && curPage[curCol].blocks.length > 0) {
        advanceCol();
      }

      curPage[curCol].blocks.push(b);
      used += h;
    }
    flushPage();

    setPages(result);
    void pageW;
  }, [blocks]);

  // Measure-then-pack on mount, when score or prefs change, and on resize.
  useLayoutEffect(() => {
    recompute();
  }, [recompute, prefs.fontSize, prefs.lineHeight, prefs.letterSpacing]);

  useEffect(() => {
    const ro = new ResizeObserver(() => recompute());
    if (outerRef.current) ro.observe(outerRef.current);
    return () => ro.disconnect();
  }, [recompute]);

  // Track current page from scroll position (for the page indicator).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      const idx = Math.round(el.scrollLeft / w);
      setCurrentPage(idx);
      onPageChange?.(idx, pages.length);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, pages.length, onPageChange]);

  // Render a column from a list of blocks. Consecutive line blocks that
  // share a section are grouped under a continuation label when no header
  // block is at the start of the run.
  const renderColumn = (col: ColumnContent) => {
    const out: React.ReactElement[] = [];
    let runSectionId: string | null = null;
    let runStartedWithHeader = false;
    let runLines: { line: ChordChartLine; lineIdx: number }[] = [];
    let runHeaderSection: ChordChartSection | null = null;

    const flushRun = (key: string) => {
      if (!runSectionId) return;
      out.push(
        <PerformSectionGroup
          key={key}
          section={runHeaderSection /* may be null = continuation */}
          continuation={!runStartedWithHeader}
          continuationLabel={
            !runStartedWithHeader
              ? score.sections.find((s) => s.id === runSectionId)?.label
              : undefined
          }
          lines={runLines}
        />,
      );
      runSectionId = null;
      runStartedWithHeader = false;
      runLines = [];
      runHeaderSection = null;
    };

    col.blocks.forEach((b, i) => {
      if (b.kind === "header") {
        flushRun(`r-${i}`);
        runSectionId = b.sectionId;
        runStartedWithHeader = true;
        runHeaderSection = b.section;
      } else {
        if (b.sectionId !== runSectionId) {
          flushRun(`r-${i}`);
          runSectionId = b.sectionId;
          runStartedWithHeader = false;
        }
        runLines.push({ line: b.line, lineIdx: b.lineIdx });
      }
    });
    flushRun(`r-end`);
    return out;
  };

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 pt-[7vh] pb-16 overflow-hidden"
    >
      {/* Hidden measurement column. Width matches a real visible column
          (page px-4 + grid gap-8 = 64px non-column overhead per page).
          Each block — section header and individual line — is measured
          independently so the packer can fit them per column. */}
      <div
        ref={measureContainerRef}
        aria-hidden
        className="absolute opacity-0 pointer-events-none top-0 left-0"
        style={{ width: "calc((100% - 64px) / 2)" }}
      >
        {blocks.map((b) => {
          const key = blockKey(b);
          return (
            <div
              key={key}
              ref={(el) => { measureRefs.current.set(key, el); }}
            >
              {b.kind === "header" ? (
                <PerformSectionHeader section={b.section} />
              ) : (
                <PerformLine line={b.line} />
              )}
            </div>
          );
        })}
      </div>

      {/* Visible pages strip — horizontal scroll-snap so the pager advances
          one page per click. */}
      <div
        ref={scrollRef}
        className="h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex"
        style={{ scrollbarWidth: "none" }}
      >
        {pages.map((page, i) => (
          <div
            key={i}
            className="shrink-0 w-full h-full snap-start grid grid-cols-2 gap-8 px-4 py-2"
          >
            <div className="overflow-hidden">{renderColumn(page.col1)}</div>
            <div className="overflow-hidden">{renderColumn(page.col2)}</div>
          </div>
        ))}
        {pages.length === 0 && (
          <div className="shrink-0 w-full h-full snap-start flex items-center justify-center text-gray-500">
            Laying out…
          </div>
        )}
      </div>

      {/* Page indicator — small, top-center, only when multi-page. */}
      {pages.length > 1 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gray-900/70 backdrop-blur-sm rounded-full text-xs text-gray-200 border border-white/10">
          {currentPage + 1} / {pages.length}
        </div>
      )}
    </div>
  );
}

/** Read-only renderer for a lyric line with per-character highlight/
 *  underline ranges. Mirrors MarkedLyricText in ChordChartView. */
function PerformMarkedLyric({
  text,
  highlightRanges,
  underlineRanges,
}: {
  text: string;
  highlightRanges?: ReadonlyArray<readonly [number, number]>;
  underlineRanges?: ReadonlyArray<readonly [number, number]>;
}) {
  if (!highlightRanges?.length && !underlineRanges?.length) return <>{text}</>;
  const inRange = (rs: ReadonlyArray<readonly [number, number]> | undefined, c: number) =>
    !!rs && rs.some(([s, e]) => c >= s && c < e);
  type State = { hl: boolean; ul: boolean };
  const stateAt = (i: number): State => ({
    hl: inRange(highlightRanges, i),
    ul: inRange(underlineRanges, i),
  });
  const same = (a: State, b: State) => a.hl === b.hl && a.ul === b.ul;
  const segs: Array<{ s: number; e: number; st: State }> = [];
  let cur = stateAt(0);
  let cs = 0;
  for (let i = 1; i <= text.length; i++) {
    const next = i < text.length ? stateAt(i) : null;
    if (next === null || !same(next, cur)) {
      segs.push({ s: cs, e: i, st: cur });
      if (next) { cur = next; cs = i; }
    }
  }
  return (
    <>
      {segs.map(({ s, e, st }, idx) => {
        const cls: string[] = [];
        if (st.hl) cls.push("bg-yellow-300/30 rounded-[2px]");
        if (st.ul) cls.push("border-b-2 border-yellow-400/80");
        return cls.length === 0
          ? <span key={idx}>{text.slice(s, e)}</span>
          : <span key={idx} className={cls.join(" ")}>{text.slice(s, e)}</span>;
      })}
    </>
  );
}

const PERFORM_NAV_LABELS: Record<string, string> = {
  segno: "Segno 𝄋",
  coda: "Coda 𝄌",
  "to-coda": "To Coda",
  fine: "Fine",
  "d.c.": "D.C.",
  "d.s.": "D.S.",
  "d.c. al fine": "D.C. al Fine",
  "d.s. al fine": "D.S. al Fine",
  "d.c. al coda": "D.C. al Coda",
  "d.s. al coda": "D.S. al Coda",
};

function PerformSectionHeader({ section }: { section: ChordChartSection }) {
  return (
    <h3 className="text-pink-300 italic font-semibold text-base mb-1 inline-flex items-baseline flex-wrap gap-2">
      <span>{section.label}</span>
      {section.endingNumber && (
        <span className="text-xs font-mono text-amber-300 border-2 border-b-0 border-amber-300/80 px-1.5 pt-0.5 leading-tight">
          {section.endingNumber}.
        </span>
      )}
      {section.repeatStart && <span className="text-pink-200">𝄆</span>}
      {section.repeatEnd && <span className="text-pink-200">𝄇</span>}
      {section.navMark && (
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-100 not-italic">
          {PERFORM_NAV_LABELS[section.navMark] ?? section.navMark}
        </span>
      )}
    </h3>
  );
}

function PerformLine({ line }: { line: ChordChartLine }) {
  const markerClasses = [
    line.highlight ? "bg-yellow-300/20 rounded px-1" : "",
    line.underline ? "border-b-2 border-yellow-400/80" : "",
  ].filter(Boolean).join(" ");
  return (
    <div
      className={`mb-2 ${markerClasses}`}
      style={{
        fontFamily: MONO_FONT_STACK,
        fontSize: "var(--perf-font-size, 0.875rem)",
        lineHeight: "var(--perf-line-height, 1.25)",
        letterSpacing: "var(--perf-letter-spacing, normal)",
      }}
    >
      {line.chords && (
        <div className="text-yellow-300 whitespace-pre min-h-[1em]">
          {line.chords}
        </div>
      )}
      {line.lyrics && (
        <div className="text-gray-100 whitespace-pre">
          <PerformMarkedLyric
            text={line.lyrics}
            highlightRanges={line.highlightRanges}
            underlineRanges={line.underlineRanges}
          />
        </div>
      )}
      {!line.chords && !line.lyrics && (
        <div className="text-gray-500 whitespace-pre min-h-[1em]">&nbsp;</div>
      )}
    </div>
  );
}

/** A run of one or more consecutive lines from the same section — either
 *  starting with the section's real header, or (when the run starts mid-
 *  section after a column break) prefixed with a faint continuation label
 *  so the user keeps context. */
function PerformSectionGroup({
  section,
  continuation,
  continuationLabel,
  lines,
}: {
  section: ChordChartSection | null;
  continuation: boolean;
  continuationLabel?: string;
  lines: { line: ChordChartLine; lineIdx: number }[];
}) {
  return (
    <section className="mb-3">
      {!continuation && section && <PerformSectionHeader section={section} />}
      {continuation && continuationLabel && (
        <div className="text-pink-300/60 italic text-xs mb-1">
          {continuationLabel} (cont’d)
        </div>
      )}
      {lines.map(({ line, lineIdx }) => (
        <PerformLine key={lineIdx} line={line} />
      ))}
    </section>
  );
}

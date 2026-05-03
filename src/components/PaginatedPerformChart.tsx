"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChordChartSection, Score } from "@/lib/schema";

const MONO_FONT_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

interface Page {
  col1: ChordChartSection[];
  col2: ChordChartSection[];
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
   *  uses it to drive the top/bottom tap zones. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPageChange?: (current: number, total: number) => void;
}

/**
 * Quark-XPress-style 2-column performance layout. Treats each section as
 * an atomic block, measures its rendered height, then bin-packs sections
 * into a chain of (page, column) slots — col1 of page 1, then col2 of
 * page 1, then col1 of page 2, etc. Pages are laid out horizontally and
 * scroll-snap so each tap-zone advance lands on a clean page.
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

  // Re-pack: read rendered section heights from the hidden measure column,
  // walk in order, and assign each section to the current slot. Move to
  // the next slot when a section won't fit in the remaining column space.
  const recompute = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const pageW = outer.clientWidth;
    const pageH = outer.clientHeight;
    if (pageW === 0 || pageH === 0) return;

    // Visible-page padding. Mirrors the .perform-page class below.
    const PAD_X = 16; // px
    const PAD_Y = 8; // px
    const COL_GAP = 32; // px (matches gap-8)

    const colHeight = pageH - 2 * PAD_Y;

    const heights = new Map<string, number>();
    score.sections.forEach((s) => {
      const el = measureRefs.current.get(s.id);
      if (el) heights.set(s.id, el.getBoundingClientRect().height);
    });

    const result: Page[] = [];
    let curPage: Page = { col1: [], col2: [] };
    let curCol: "col1" | "col2" = "col1";
    let used = 0;

    const flushPage = () => {
      if (curPage.col1.length || curPage.col2.length) result.push(curPage);
      curPage = { col1: [], col2: [] };
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

    for (const section of score.sections) {
      const h = heights.get(section.id) ?? 0;
      // If this section is too tall for an empty column, just place it on
      // its own column and let it bleed; the alternative (skipping it) is
      // worse. The user can shrink the font to fit.
      if (h > colHeight && curPage[curCol].length > 0) {
        advanceCol();
      }
      // If it doesn't fit in the remaining column space, move to next.
      if (used + h > colHeight && curPage[curCol].length > 0) {
        advanceCol();
      }
      curPage[curCol].push(section);
      used += h;
    }
    flushPage();

    setPages(result);
    // Suppress unused vars
    void pageW;
    void PAD_X;
    void COL_GAP;
  }, [score]);

  // Measure-then-pack on mount, when score or prefs change, and on resize.
  // useLayoutEffect runs synchronously after DOM mutation so the measurement
  // pass is in the DOM before we read sizes.
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

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 pt-[7vh] pb-[9vh] overflow-hidden"
    >
      {/* Hidden measurement column. Width matches a real visible column so
          height measurements correspond to what'll be rendered. Also pulls
          in the same CSS variables (font-size, line-height, letter-spacing)
          as the visible columns via inheritance from PerformView. */}
      <div
        ref={measureContainerRef}
        aria-hidden
        className="absolute opacity-0 pointer-events-none top-0 left-0"
        style={{ width: "calc((100% - 32px) / 2 - 32px)" }}
      >
        {score.sections.map((s) => (
          <div
            key={s.id}
            ref={(el) => { measureRefs.current.set(s.id, el); }}
          >
            <PerformSection section={s} />
          </div>
        ))}
      </div>

      {/* Visible pages strip — horizontal scroll-snap so the tap zones advance
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
            <div className="overflow-hidden">
              {page.col1.map((s) => <PerformSection key={s.id} section={s} />)}
            </div>
            <div className="overflow-hidden">
              {page.col2.map((s) => <PerformSection key={s.id} section={s} />)}
            </div>
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

/**
 * Read-only section renderer for paginated perform mode. Mirrors the look
 * of the editor's SectionBlock but without any click handlers, edit inputs,
 * or "Add line" affordance — and crucially each section is structurally
 * isolated so the bin-packer can measure it as one unit.
 */
function PerformSection({ section }: { section: ChordChartSection }) {
  return (
    <section className="mb-3">
      <h3 className="text-pink-300 italic font-semibold text-base mb-1">
        {section.label}
      </h3>
      <div
        className="chord-chart-line-body whitespace-pre"
        style={{
          fontFamily: MONO_FONT_STACK,
          fontSize: "var(--perf-font-size, 0.875rem)",
          lineHeight: "var(--perf-line-height, 1.25)",
          letterSpacing: "var(--perf-letter-spacing, normal)",
        }}
      >
        {section.lines.map((line, i) => {
          const markerClasses = [
            line.highlight ? "bg-yellow-300/20 -mx-2 px-2 rounded" : "",
            line.underline ? "border-b-2 border-yellow-400/80" : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={i} className={`mb-2 ${markerClasses}`}>
              {line.chords && (
                <div className="text-yellow-300 whitespace-pre min-h-[1em]">
                  {line.chords}
                </div>
              )}
              {line.lyrics && (
                <div className="text-gray-100 whitespace-pre">{line.lyrics}</div>
              )}
              {!line.chords && !line.lyrics && (
                <div className="text-gray-500 whitespace-pre min-h-[1em]">&nbsp;</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

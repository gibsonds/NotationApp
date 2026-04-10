"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Score } from "@/lib/schema";
import { scoreToMusicXML } from "@/lib/musicxml";
import { LayoutSettings, DEFAULT_LAYOUT, PRINT_LAYOUT, TEXT_FONT_STACKS } from "@/store/score-store";

export interface ScoreRendererHandle {
  printScore: () => Promise<void>;
}

interface ScoreRendererProps {
  score: Score;
  zoom?: number;
  layout?: LayoutSettings;
  onReady?: (handle: ScoreRendererHandle) => void;
}

function applyLayout(osmd: any, layout: LayoutSettings, zoomLevel: number) {
  const rules = osmd.EngravingRules;
  if (!rules) return;

  // ── Spacing mode ──────────────────────────────────────────────
  rules.CompactMode = layout.compactMode;

  if (layout.compactMode) {
    rules.VoiceSpacingMultiplierVexflow = 0.8;
    rules.VoiceSpacingAddendVexflow = 2.5;
    rules.MinSkyBottomDistBetweenStaves = 2;
    rules.MinSkyBottomDistBetweenSystems = 2;
    rules.BetweenStaffDistance = 3;
    rules.StaffDistance = 4;
  } else {
    rules.VoiceSpacingMultiplierVexflow = 0.85;
    rules.VoiceSpacingAddendVexflow = 3;
    rules.MinSkyBottomDistBetweenStaves = 5;
    rules.MinSkyBottomDistBetweenSystems = 5;
    rules.BetweenStaffDistance = 7;
    rules.StaffDistance = 7;
  }

  // ── Page layout ───────────────────────────────────────────────
  rules.SheetTitleHeight = layout.titleSize;
  rules.SheetComposerHeight = layout.composerSize;
  rules.TitleTopDistance = layout.titleTopDistance;
  rules.TitleBottomDistance = layout.titleBottomDistance;
  rules.PageTopMargin = layout.pageTopMargin;
  rules.PageTopMarginNarrow = layout.pageTopMargin;
  rules.PageLeftMargin = layout.pageLeftMargin;
  rules.PageRightMargin = layout.pageRightMargin;
  rules.PageBottomMargin = layout.pageBreaks ? 5 : (layout.compactMode ? 0 : 5);
  rules.MinimumDistanceBetweenSystems = layout.systemSpacing;
  rules.RenderTitle = true;
  rules.RenderComposer = true;
  rules.RenderXMeasuresPerLineAkaSystem = layout.measuresPerSystem;

  // ── Note size scaling ─────────────────────────────────────────
  const s = layout.noteSize;
  rules.VexFlowDefaultNotationFontScale = 39 * s;
  rules.StaffHeight = 4 * s;
  rules.LyricsHeight = 2 * s;
  rules.ChordSymbolTextHeight = 2 * s;

  // ── Engraving quality — line weights ──────────────────────────
  // Professional engraving uses carefully calibrated stroke widths
  rules.StaffLineWidth = 0.1;
  rules.StemWidth = 0.13;
  rules.BeamWidth = 0.5;
  rules.LedgerLineWidth = 0.12;           // Fix: default 1.0 is 10x too thick!
  rules.WedgeLineWidth = 0.12;
  rules.TupletLineWidth = 0.12;
  rules.LyricUnderscoreLineWidth = 0.1;
  rules.SystemThinLineWidth = 0.12;
  rules.SystemBoldLineWidth = 0.5;

  // ── Engraving quality — slurs & ties ──────────────────────────
  rules.SlurHeightFactor = 1.1;
  rules.SlurSlopeMaxAngle = 12;
  rules.TieHeightMinimum = 0.3;
  rules.TieHeightMaximum = 1.4;
  rules.SlurPlacementUseSkyBottomLine = true;  // Smart collision avoidance

  // ── Engraving quality — beams ─────────────────────────────────
  rules.BeamSlopeMaxAngle = 10;

  // ── Fonts ─────────────────────────────────────────────────────
  rules.DefaultVexFlowNoteFont = layout.musicFont;
  rules.DefaultFontFamily = TEXT_FONT_STACKS[layout.textFont] || TEXT_FONT_STACKS.georgia;

  // ── Part names ────────────────────────────────────────────────
  rules.InstrumentLabelTextHeight = 1.5 * s;
  rules.SystemLabelsRightMargin = 0.5;
  rules.RenderPartAbbreviations = true;

  // ── Lyrics spacing ────────────────────────────────────────────
  rules.LyricOverlapAllowedIntoNextMeasure = 0.5;
  rules.HorizontalBetweenLyricsDistance = 0.6;
  rules.LyricsXPaddingFactorForLongLyrics = 1.5;
  rules.LyricsUseXPaddingForLongLyrics = true;
  rules.BetweenSyllableMinimumDistance = 0.8;

  // ── Note spacing ──────────────────────────────────────────────
  rules.MinNoteDistance = 2.2;
  rules.MeasureLeftMargin = 0.8;
  rules.ClefRightMargin = 0.9;

  // Page breaks: letter page format for pagination
  if (layout.pageBreaks) {
    const PF = rules.PageFormat.constructor as any;
    rules.PageFormat = new PF(8.5, 11.0, "letter");
    rules.NewPageAtXMLNewPageAttribute = true;
  } else {
    // Endless scroll: undefined page format, huge page height
    const PF = rules.PageFormat.constructor as any;
    rules.PageFormat = new PF(0, 0);
    rules.PageHeight = 100001;
  }

  osmd.zoom = zoomLevel;
}

export default function ScoreRenderer({ score, zoom = 1.0, layout = DEFAULT_LAYOUT, onReady }: ScoreRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const scoreRef = useRef(score);
  const zoomRef = useRef(zoom);
  const layoutRef = useRef(layout);
  scoreRef.current = score;
  zoomRef.current = zoom;
  layoutRef.current = layout;

  // Expose print function: re-render with PRINT_LAYOUT, print, then restore
  // Track whether we're in a print cycle to prevent premature restore
  const printingRef = useRef(false);
  const savedPrintLayoutRef = useRef<{ layout: LayoutSettings; zoom: number } | null>(null);

  const printScore = useCallback(async () => {
    const osmd = osmdRef.current;
    if (!osmd) return;

    // Save current layout
    savedPrintLayoutRef.current = {
      layout: layoutRef.current,
      zoom: osmd.zoom,
    };
    printingRef.current = true;

    // Set document title to score name so PDF "Save As" uses it
    const prevTitle = document.title;
    const scoreName = scoreRef.current?.title;
    if (scoreName) document.title = scoreName;

    // Re-render with tight print layout
    applyLayout(osmd, PRINT_LAYOUT, 1.0);
    osmd.render();

    // Wait for browser to paint via double-rAF, then print
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    window.print();

    // Safari fires afterprint before capturing — delay restore
    // so the print sheet captures the print layout DOM
    setTimeout(() => {
      document.title = prevTitle;
      const saved = savedPrintLayoutRef.current;
      if (saved && osmdRef.current) {
        applyLayout(osmdRef.current, saved.layout, saved.zoom);
        osmdRef.current.render();
        savedPrintLayoutRef.current = null;
      }
      printingRef.current = false;
    }, 1000);
  }, []);

  // Notify parent when ready
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.({ printScore });
  }, [printScore]);

  // Main render effect
  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!containerRef.current) return;

      const currentScore = scoreRef.current;
      const currentZoom = zoomRef.current;
      const currentLayout = layoutRef.current;

      const scrollParent = containerRef.current.closest(".overflow-auto");
      const prevScrollTop = scrollParent?.scrollTop ?? 0;
      const prevScrollLeft = scrollParent?.scrollLeft ?? 0;

      setLoading(true);
      setError(null);

      try {
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");

        if (!osmdRef.current) {
          osmdRef.current = new OpenSheetMusicDisplay(containerRef.current, {
            autoResize: false,
            backend: "svg",
            drawTitle: true,
            drawComposer: true,
            drawCredits: false,
            drawPartNames: true,
            drawPartAbbreviations: false,
            drawMeasureNumbers: true,
          });
        }

        if (cancelled) return;

        const musicxml = scoreToMusicXML(currentScore);
        await osmdRef.current.load(musicxml);

        if (cancelled) return;

        // Apply layout AFTER load but BEFORE render.
        // render() calls reCalculate() which reads rules for positioning.
        // load() calls reset() which resets zoom to 1, so we must set it after.
        applyLayout(osmdRef.current, currentLayout, currentZoom);
        osmdRef.current.render();

        if (scrollParent) {
          requestAnimationFrame(() => {
            scrollParent.scrollTop = prevScrollTop;
            scrollParent.scrollLeft = prevScrollLeft;
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("OSMD render error:", err);
          setError(err.message || "Failed to render score");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => { cancelled = true; };
  }, [score, zoom, layout]);

  // Restore layout after Cmd+P (system-initiated print, not our button)
  useEffect(() => {
    const handleAfterPrint = () => {
      // If our printScore is handling the cycle, skip — it restores via timeout
      if (printingRef.current) return;
      const osmd = osmdRef.current;
      if (!osmd) return;
      applyLayout(osmd, layoutRef.current, zoomRef.current);
      osmd.render();
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (osmdRef.current) {
        try { osmdRef.current.render(); } catch {}
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="relative w-full h-full overflow-auto bg-white rounded-lg">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Rendering...
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 z-10">
          <div className="text-red-600 text-sm p-4 max-w-md text-center">
            <p className="font-medium">Render Error</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="min-h-[200px] p-4 print-no-pad" />
    </div>
  );
}

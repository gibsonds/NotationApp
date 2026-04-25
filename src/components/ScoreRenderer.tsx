"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Score } from "@/lib/schema";
import { scoreToMusicXML } from "@/lib/musicxml";
import { LayoutSettings, DEFAULT_LAYOUT, PRINT_LAYOUT, TEXT_FONT_STACKS, PAGE_DIMENSIONS } from "@/store/score-store";
import { NoteSelection } from "@/lib/transforms";

export interface ScoreRendererHandle {
  printScore: () => Promise<void>;
}

export interface MeasurePosition {
  measure: number;
  staffIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Precise position of a rendered note, extracted from OSMD's graphic tree */
export interface NoteHit {
  measure: number;
  beat: number;
  pitch: string;
  staffIndex: number;
  x: number;  // pixels relative to container
  y: number;
  svgElement: Element | null;
}

interface ScoreRendererProps {
  score: Score;
  zoom?: number;
  layout?: LayoutSettings;
  onReady?: (handle: ScoreRendererHandle) => void;
  /** Cursor position (thin line showing where input goes) */
  cursorPosition?: { measure: number; beat: number; staffIndex: number } | null;
  /** Called when user clicks a note or empty space on the score */
  onScoreClick?: (info: {
    measure: number;
    beat: number;
    staffIndex: number;
    pitch?: string;       // present when an actual note was clicked
    shiftKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    isRightClick?: boolean;
    clientX?: number;     // for context menu positioning
    clientY?: number;
  }) => void;
  /** Currently selected note (shows highlight) */
  selectedNote?: { measure: number; beat: number; pitch: string; staffIndex: number } | null;
  /** Range selection (yellow overlay) */
  selection?: NoteSelection | null;
}

// ── Print overlay helpers ─────────────────────────────────────────────

function injectPrintOverlays(
  container: HTMLDivElement | null,
  layout: LayoutSettings,
  title: string
) {
  if (!container) return;
  const pageEls = container.querySelectorAll<HTMLElement>(":scope > div");
  const pages = pageEls.length > 0 ? Array.from(pageEls) : [container];

  pages.forEach((page, index) => {
    page.style.position = "relative";
    if (layout.printHeader) {
      const header = document.createElement("div");
      header.className = "print-overlay print-header";
      header.textContent = layout.printHeader === "{title}" ? title : layout.printHeader;
      page.appendChild(header);
    }
    if (layout.printFooter) {
      const footer = document.createElement("div");
      footer.className = "print-overlay print-footer-text";
      footer.textContent = layout.printFooter;
      page.appendChild(footer);
    }
    if (layout.printPageNumbers && pages.length > 1) {
      const pageNum = document.createElement("div");
      pageNum.className = "print-overlay print-page-number";
      pageNum.textContent = String(index + 1);
      page.appendChild(pageNum);
    }
  });
}

function removePrintOverlays(container: HTMLDivElement | null) {
  if (!container) return;
  container.querySelectorAll(".print-overlay").forEach((el) => el.remove());
  container.querySelectorAll<HTMLElement>(":scope > div").forEach((el) => {
    el.style.position = "";
  });
}

// ── Layout application ───────────────────────────────────────────────

function applyLayout(osmd: any, layout: LayoutSettings, zoomLevel: number) {
  const rules = osmd.EngravingRules;
  if (!rules) return;

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

  const s = layout.noteSize;
  rules.VexFlowDefaultNotationFontScale = 39 * s;
  rules.StaffHeight = 4 * s;
  rules.LyricsHeight = 2 * s;
  rules.ChordSymbolTextHeight = 2 * s;

  // Style-specific engraving rules
  if (layout.musicFont === "petaluma") {
    // Real Book / handwritten style — thicker, more organic feel
    rules.StaffLineWidth = 0.12;
    rules.StemWidth = 0.15;
    rules.BeamWidth = 0.6;
    rules.LedgerLineWidth = 0.14;
    rules.WedgeLineWidth = 0.14;
    rules.TupletLineWidth = 0.14;
    rules.LyricUnderscoreLineWidth = 0.12;
    rules.SystemThinLineWidth = 0.14;
    rules.SystemBoldLineWidth = 0.6;
    rules.SlurHeightFactor = 1.3;
    rules.SlurSlopeMaxAngle = 15;
    rules.TieHeightMinimum = 0.35;
    rules.TieHeightMaximum = 1.6;
    rules.BeamSlopeMaxAngle = 12;
  } else {
    // Modern / clean style — precise, thin lines
    rules.StaffLineWidth = 0.1;
    rules.StemWidth = 0.13;
    rules.BeamWidth = 0.5;
    rules.LedgerLineWidth = 0.12;
    rules.WedgeLineWidth = 0.12;
    rules.TupletLineWidth = 0.12;
    rules.LyricUnderscoreLineWidth = 0.1;
    rules.SystemThinLineWidth = 0.12;
    rules.SystemBoldLineWidth = 0.5;
    rules.SlurHeightFactor = 1.1;
    rules.SlurSlopeMaxAngle = 12;
    rules.TieHeightMinimum = 0.3;
    rules.TieHeightMaximum = 1.4;
    rules.BeamSlopeMaxAngle = 10;
  }

  rules.SlurPlacementUseSkyBottomLine = true;

  rules.DefaultVexFlowNoteFont = layout.musicFont;
  rules.DefaultFontFamily = TEXT_FONT_STACKS[layout.textFont] || TEXT_FONT_STACKS.georgia;

  rules.InstrumentLabelTextHeight = 1.5 * s;
  rules.SystemLabelsRightMargin = 0.5;
  rules.RenderPartAbbreviations = true;

  rules.LyricOverlapAllowedIntoNextMeasure = 0.5;
  rules.HorizontalBetweenLyricsDistance = 0.6;
  rules.LyricsXPaddingFactorForLongLyrics = 1.5;
  rules.LyricsUseXPaddingForLongLyrics = true;
  rules.BetweenSyllableMinimumDistance = 0.8;

  rules.MinNoteDistance = 2.2;
  rules.MeasureLeftMargin = 0.8;
  rules.ClefRightMargin = 0.9;

  if (layout.pageBreaks) {
    const dims = PAGE_DIMENSIONS[layout.pageSize] || PAGE_DIMENSIONS.letter;
    const PF = rules.PageFormat.constructor as any;
    rules.PageFormat = new PF(dims.width, dims.height, layout.pageSize);
    rules.NewPageAtXMLNewPageAttribute = true;
  } else {
    const PF = rules.PageFormat.constructor as any;
    rules.PageFormat = new PF(0, 0);
    rules.PageHeight = 100001;
  }

  osmd.zoom = zoomLevel;
}

// ── OSMD pitch → string helper ──────────────────────────────────────

// OSMD NoteEnum: FundamentalNote uses semitone-based indexing
const FUND_NOTE_MAP: Record<number, string> = {
  0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B",
  1: "C", 3: "D", 6: "F", 8: "G", 10: "A",  // enharmonic slots
};

// OSMD AccidentalEnum: 0=NONE, 1=SHARP, 2=FLAT, -1=NATURAL, etc.
// But in practice, natural notes come through with Accidental=2 (which is FLAT in the enum)
// The halfTone value is the most reliable way to reconstruct the pitch

function osmdPitchToString(sourceNote: any): string {
  try {
    const pitch = sourceNote?.Pitch || sourceNote?.pitch;
    if (!pitch) return "rest";

    // Use halfTone for accurate pitch reconstruction
    // OSMD halfTone: C4 = 48 (MIDI 60 - 12)
    const ht = pitch.halfTone;
    if (ht != null) {
      const noteIndex = ((ht % 12) + 12) % 12;
      const octave = Math.floor(ht / 12); // OSMD halfTone 48 = C4 → 48/12=4
      const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
      return `${CHROMATIC[noteIndex]}${octave}`;
    }

    // Fallback: use FundamentalNote + Octave
    const letter = FUND_NOTE_MAP[pitch.FundamentalNote] ?? "C";
    const octave = (pitch.Octave ?? 1) + 3;
    return `${letter}${octave}`;
  } catch {
    return "rest";
  }
}

// ── Note position extraction from OSMD graphic tree ─────────────────

function extractNoteHits(osmd: any, currentZoom: number): NoteHit[] {
  const hits: NoteHit[] = [];
  try {
    const sheet = osmd?.GraphicSheet;
    const measureList = sheet?.MeasureList;
    if (!measureList) return hits;

    for (let m = 0; m < measureList.length; m++) {
      const line = measureList[m];
      if (!line) continue;

      for (let s = 0; s < line.length; s++) {
        const gMeasure = line[s];
        if (!gMeasure?.staffEntries) continue;

        for (const staffEntry of gMeasure.staffEntries) {
          if (!staffEntry?.graphicalVoiceEntries) continue;

          for (const voiceEntry of staffEntry.graphicalVoiceEntries) {
            if (!voiceEntry?.notes) continue;

            for (const gNote of voiceEntry.notes) {
              const sourceNote = gNote?.sourceNote;
              if (!sourceNote) continue;

              // Skip rests
              if (sourceNote.isRest?.() || sourceNote.Pitch == null) continue;

              const pos = gNote.PositionAndShape?.AbsolutePosition;
              if (!pos) continue;

              const measureNum = sourceNote.SourceMeasure?.MeasureNumber ?? (m + 1);
              const timestamp = sourceNote.ParentVoiceEntry?.Timestamp;
              const beat = timestamp ? Math.round((timestamp.RealValue * 4 + 1) * 1000) / 1000 : 1;
              const pitch = osmdPitchToString(sourceNote);

              // Get the SVG element for this note (VexFlow backend)
              let svgEl: Element | null = null;
              try {
                svgEl = gNote.getSVGGElement?.() ?? null;
              } catch { /* not all OSMD versions support this */ }

              // Use OSMD position as baseline
              let noteX = pos.x * 10 * currentZoom;
              let noteY = pos.y * 10 * currentZoom;

              hits.push({
                measure: measureNum,
                beat,
                pitch,
                staffIndex: s,
                x: noteX,
                y: noteY,
                svgElement: svgEl,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[NoteHits] Error extracting:", err);
  }
  return hits;
}

// ══════════════════════════════════════════════════════════════════════

export default function ScoreRenderer({
  score, zoom = 1.0, layout = DEFAULT_LAYOUT, onReady,
  cursorPosition, selectedNote, onScoreClick, selection,
}: ScoreRendererProps) {
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

  // Note positions extracted from OSMD (rebuilt on each render)
  const noteHitsRef = useRef<NoteHit[]>([]);
  const measurePositionsRef = useRef<MeasurePosition[]>([]);

  // Cursor and selection DOM elements (imperative)
  const cursorElRef = useRef<HTMLDivElement | null>(null);
  const highlightedSvgRef = useRef<Element | null>(null); // currently blue-highlighted SVG note
  const selectionElsRef = useRef<HTMLDivElement[]>([]);

  // Stable refs for callbacks and props
  const cursorPositionRef = useRef(cursorPosition);
  const selectedNoteRef = useRef(selectedNote);
  const onScoreClickRef = useRef(onScoreClick);
  const selectionRef = useRef(selection);
  cursorPositionRef.current = cursorPosition;
  selectedNoteRef.current = selectedNote;
  onScoreClickRef.current = onScoreClick;
  selectionRef.current = selection;

  // ── Print ──────────────────────────────────────────────────────────
  const printingRef = useRef(false);
  const savedPrintLayoutRef = useRef<{ layout: LayoutSettings; zoom: number } | null>(null);

  const printScore = useCallback(async () => {
    const osmd = osmdRef.current;
    if (!osmd) return;
    savedPrintLayoutRef.current = { layout: layoutRef.current, zoom: osmd.zoom };
    printingRef.current = true;
    const prevTitle = document.title;
    const scoreName = scoreRef.current?.title;
    if (scoreName) document.title = scoreName;

    const userLayout = layoutRef.current;
    const printLayout: LayoutSettings = {
      ...PRINT_LAYOUT,
      pageSize: userLayout.pageSize,
      printPageNumbers: userLayout.printPageNumbers,
      printHeader: userLayout.printHeader,
      printFooter: userLayout.printFooter,
    };

    applyLayout(osmd, printLayout, 1.0);
    osmd.render();
    injectPrintOverlays(containerRef.current, printLayout, scoreName || "");

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const restore = () => {
      document.title = prevTitle;
      removePrintOverlays(containerRef.current);
      const saved = savedPrintLayoutRef.current;
      if (saved && osmdRef.current) {
        applyLayout(osmdRef.current, saved.layout, saved.zoom);
        osmdRef.current.render();
        savedPrintLayoutRef.current = null;
      }
      printingRef.current = false;
    };

    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      clearTimeout(fallbackTimer);
      setTimeout(restore, 100);
    };
    window.addEventListener("afterprint", onAfterPrint);
    const fallbackTimer = setTimeout(() => {
      window.removeEventListener("afterprint", onAfterPrint);
      restore();
    }, 30000);

    window.print();
  }, []);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.({ printScore });
  }, [printScore]);

  // ── Extract measure positions ────────────────────────────────────

  const extractMeasurePositions = useCallback((osmd: any, currentZoom: number) => {
    const positions: MeasurePosition[] = [];
    try {
      const sheet = osmd?.GraphicSheet;
      const measureList = sheet?.MeasureList;
      if (!measureList) { measurePositionsRef.current = []; return; }

      for (let m = 0; m < measureList.length; m++) {
        const line = measureList[m];
        if (!line) continue;
        for (let s = 0; s < line.length; s++) {
          const gm = line[s];
          if (!gm) continue;
          const ps = gm.PositionAndShape;
          if (ps?.AbsolutePosition && ps?.Size) {
            positions.push({
              measure: m + 1,
              staffIndex: s,
              x: ps.AbsolutePosition.x * 10 * currentZoom,
              y: ps.AbsolutePosition.y * 10 * currentZoom,
              width: ps.Size.width * 10 * currentZoom,
              height: (ps.Size.height || 4) * 10 * currentZoom,
            });
          }
        }
      }
    } catch (err) {
      console.error("[Measures] Error extracting:", err);
    }
    measurePositionsRef.current = positions;
  }, []);

  // ── Position cursor ──────────────────────────────────────────────

  const positionCursorEl = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create/recreate if destroyed by OSMD re-render
    if (!cursorElRef.current || !container.contains(cursorElRef.current)) {
      const el = document.createElement("div");
      el.className = "step-cursor print-hide";
      container.appendChild(el);
      cursorElRef.current = el;
    }

    const cp = cursorPositionRef.current;
    const cursor = cursorElRef.current;

    if (!cp || measurePositionsRef.current.length === 0) {
      cursor.style.display = "none";
      return;
    }

    // If there's a note at this exact cursor position, use its precise x coordinate
    const exactNote = noteHitsRef.current.find(
      n => n.measure === cp.measure &&
           Math.abs(n.beat - cp.beat) < 0.05 &&
           n.staffIndex === cp.staffIndex
    );

    const mp = measurePositionsRef.current.find(
      p => p.measure === cp.measure && p.staffIndex === cp.staffIndex
    );

    // Helper to get a note's live X (preferring the SVG bounding box, which
    // reflects VexFlow's actual layout — the cached `hit.x` from extractNoteHits
    // can drift if the measure relayouts after extraction).
    const containerEl = containerRef.current;
    const cRect = containerEl?.getBoundingClientRect();
    const liveX = (hit: NoteHit): number => {
      if (hit.svgElement?.isConnected && cRect) {
        const r = hit.svgElement.getBoundingClientRect();
        return r.x - cRect.left + r.width / 2;
      }
      return hit.x;
    };

    if (exactNote) {
      cursor.style.display = "block";
      cursor.style.left = `${liveX(exactNote) - 1}px`;
      cursor.style.top = `${mp ? mp.y : exactNote.y - 20}px`;
      cursor.style.height = `${mp ? mp.height : 40}px`;
      return;
    }

    if (!mp) {
      cursor.style.display = "none";
      return;
    }

    // No exact note — interpolate using actual note X coords in the same
    // measure+staff. VexFlow doesn't space notes linearly within a measure
    // (clefs, time signatures, accidentals all shift things), so anchoring
    // to real notes is much more accurate than (beat-1)/beatsPerMeasure.
    const sameMeasure = noteHitsRef.current
      .filter(n => n.measure === cp.measure && n.staffIndex === cp.staffIndex)
      .sort((a, b) => a.beat - b.beat);

    let cursorX: number;
    if (sameMeasure.length === 0) {
      // No notes in this measure — fall back to proportional within the bar.
      const ts = scoreRef.current?.timeSignature || "4/4";
      const [num, den] = ts.split("/").map(Number);
      const beatsPerMeasure = num * (4 / den);
      const beatFrac = Math.max(0, Math.min(1, (cp.beat - 1) / beatsPerMeasure));
      const contentOffset = mp.measure === 1 ? mp.width * 0.15 : mp.width * 0.05;
      const contentWidth = mp.width - contentOffset;
      cursorX = mp.x + contentOffset + beatFrac * contentWidth;
    } else {
      // Find the surrounding notes by beat
      const prev = [...sameMeasure].reverse().find(n => n.beat <= cp.beat);
      const next = sameMeasure.find(n => n.beat > cp.beat);

      if (prev && next) {
        // Interpolate between prev and next note X coords
        const t = (cp.beat - prev.beat) / (next.beat - prev.beat);
        cursorX = liveX(prev) + t * (liveX(next) - liveX(prev));
      } else if (prev) {
        // Cursor is past the last note — extrapolate using an average per-beat width
        const lastX = liveX(prev);
        if (sameMeasure.length >= 2) {
          const first = sameMeasure[0];
          const beatSpan = prev.beat - first.beat || 1;
          const xSpan = lastX - liveX(first);
          const perBeat = xSpan / beatSpan;
          cursorX = lastX + (cp.beat - prev.beat) * perBeat;
        } else {
          // Only one note in measure; nudge a bit to the right of it.
          cursorX = lastX + (mp.x + mp.width - lastX) * 0.5;
        }
        // Clamp to inside the measure box
        cursorX = Math.min(cursorX, mp.x + mp.width - 4);
      } else if (next) {
        // Cursor is before the first note — line up with that note.
        cursorX = liveX(next);
      } else {
        cursorX = mp.x + mp.width / 2;
      }
    }

    cursor.style.display = "block";
    cursor.style.left = `${cursorX - 1}px`;
    cursor.style.top = `${mp.y}px`;
    cursor.style.height = `${mp.height}px`;
  }, []);

  // ── Highlight selected note via CSS class on SVG element ─────

  // Track what we last highlighted to avoid redundant DOM work
  const lastHighlightKeyRef = useRef<string | null>(null);

  const updateNoteHighlight = useCallback(() => {
    const sn = selectedNoteRef.current;
    const newKey = sn ? `${sn.measure}:${sn.beat}:${sn.pitch}:${sn.staffIndex}` : null;

    // Skip if nothing changed and the element is still in the DOM
    if (newKey === lastHighlightKeyRef.current && highlightedSvgRef.current?.isConnected) {
      return;
    }

    // Remove highlight from previously selected element
    if (highlightedSvgRef.current) {
      highlightedSvgRef.current.classList.remove("note-selected");
      highlightedSvgRef.current = null;
    }
    lastHighlightKeyRef.current = null;

    if (!sn || !sn.pitch) return;

    // Find the SVG element for the selected note
    const noteHit = noteHitsRef.current.find(
      n => n.measure === sn.measure &&
           Math.abs(n.beat - sn.beat) < 0.05 &&
           n.pitch === sn.pitch &&
           n.staffIndex === sn.staffIndex
    );

    if (noteHit?.svgElement) {
      noteHit.svgElement.classList.add("note-selected");
      highlightedSvgRef.current = noteHit.svgElement;
      lastHighlightKeyRef.current = newKey;

      // Auto-scroll the selected note into view (smooth, only vertically if needed)
      noteHit.svgElement.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, []);

  // ── Position selection overlays ────────────────────────────────

  const positionSelectionEls = useCallback(() => {
    const container = containerRef.current;
    const sel = selectionRef.current;
    const positions = measurePositionsRef.current;

    for (const el of selectionElsRef.current) el.remove();
    selectionElsRef.current = [];

    if (!container || !sel || positions.length === 0) return;

    const selected = positions.filter(
      mp => mp.measure >= sel.startMeasure && mp.measure <= sel.endMeasure
    );

    for (const mp of selected) {
      const el = document.createElement("div");
      el.className = "selection-highlight";
      el.style.position = "absolute";
      el.style.left = `${mp.x}px`;
      el.style.top = `${mp.y - 2}px`;
      el.style.width = `${mp.width}px`;
      el.style.height = `${mp.height + 4}px`;
      el.style.backgroundColor = "rgba(37, 99, 235, 0.1)";
      el.style.border = "1.5px solid rgba(37, 99, 235, 0.4)";
      el.style.borderRadius = "3px";
      el.style.pointerEvents = "none";
      el.style.zIndex = "18";
      container.appendChild(el);
      selectionElsRef.current.push(el);
    }
  }, []);

  // ── Make note SVG elements interactive ─────────────────────────

  const setupNoteInteraction = useCallback(() => {
    const hits = noteHitsRef.current;
    for (const hit of hits) {
      const el = hit.svgElement;
      if (!el) continue;

      // Make notes look clickable
      (el as HTMLElement).style.cursor = "pointer";

      // Add subtle hover effect via class
      el.classList.add("osmd-note-interactive");
    }
  }, []);

  // ── Reposition all visual elements ─────────────────────────────

  useEffect(() => {
    positionCursorEl();
    updateNoteHighlight();
    positionSelectionEls();
  }, [cursorPosition, selectedNote, selection, positionCursorEl, updateNoteHighlight, positionSelectionEls]);

  // ── Click handler: find nearest note or use measure fallback ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      if (!onScoreClickRef.current) return;
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Step 1: Find nearest note by 2D distance to its live SVG position.
      // This is more reliable than staff bounding boxes (which OSMD reports
      // incorrectly for rest-only staves).
      const positions = measurePositionsRef.current;
      if (positions.length === 0) return;

      const hits = noteHitsRef.current;
      let bestHit: NoteHit | null = null;
      let bestNoteDist = Infinity;
      const MAX_NOTE_DIST = 50; // Max 2D pixel distance to match a note

      for (const hit of hits) {
        let noteX = hit.x;
        let noteY = hit.y;
        if (hit.svgElement?.isConnected) {
          const svgRect = hit.svgElement.getBoundingClientRect();
          noteX = svgRect.x - rect.left + svgRect.width / 2;
          noteY = svgRect.y - rect.top + svgRect.height / 2;
        }

        const dx = Math.abs(clickX - noteX);
        const dy = Math.abs(clickY - noteY);
        // Weighted distance: horizontal proximity matters more (notes on the
        // same staff differ in Y by pitch, but users click by horizontal position)
        const dist = Math.sqrt(dx * dx + (dy * 0.5) * (dy * 0.5));
        if (dist < MAX_NOTE_DIST && dist < bestNoteDist) {
          bestNoteDist = dist;
          bestHit = hit;
        }
      }

      if (bestHit) {
        onScoreClickRef.current({
          measure: bestHit.measure,
          beat: bestHit.beat,
          staffIndex: bestHit.staffIndex,
          pitch: bestHit.pitch,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
        });
        return;
      }

      // Step 2: No note nearby — find staff via midpoint bisection for cursor placement
      let clickedStaff = -1;
      let bestMP: MeasurePosition | null = null;

      const measureStaves = new Map<number, MeasurePosition[]>();
      for (const mp of positions) {
        const list = measureStaves.get(mp.measure) || [];
        list.push(mp);
        measureStaves.set(mp.measure, list);
      }

      let bestStaffDist = Infinity;
      for (const [, stavesArr] of measureStaves) {
        const inX = stavesArr.some(mp => clickX >= mp.x - 15 && clickX <= mp.x + mp.width + 15);
        if (!inX) continue;
        const sorted = stavesArr.slice().sort((a, b) => a.y - b.y);
        const centers = sorted.map(s => s.y + Math.max(s.height, 40) / 2);
        for (let i = 0; i < sorted.length; i++) {
          const upper = i === 0 ? -Infinity : (centers[i - 1] + centers[i]) / 2;
          const lower = i === sorted.length - 1 ? Infinity : (centers[i] + centers[i + 1]) / 2;
          if (clickY >= upper && clickY < lower) {
            const dist = Math.abs(clickY - centers[i]);
            if (dist < bestStaffDist) {
              bestStaffDist = dist;
              clickedStaff = sorted[i].staffIndex;
              bestMP = sorted[i];
            }
            break;
          }
        }
      }

      if (!bestMP) return;

      // Use measure position for cursor placement
      const ts = scoreRef.current?.timeSignature || "4/4";
      const [num, den] = ts.split("/").map(Number);
      const beatsPerMeasure = num * (4 / den);
      const contentOffset = bestMP.measure === 1 ? bestMP.width * 0.15 : bestMP.width * 0.05;
      const contentWidth = bestMP.width - contentOffset;
      const relX = clickX - bestMP.x - contentOffset;
      const beatFrac = Math.max(0, Math.min(1, relX / contentWidth));
      const beat = 1 + Math.round(beatFrac * beatsPerMeasure * 4) / 4;

      onScoreClickRef.current({
        measure: bestMP.measure,
        beat: Math.max(1, Math.min(beat, beatsPerMeasure + 0.99)),
        staffIndex: clickedStaff,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
      });
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!onScoreClickRef.current) return;
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Determine clicked staff using midpoint bisection (same as click handler)
      let clickedStaff = -1;
      const positions = measurePositionsRef.current;
      const ctxMeasureStaves = new Map<number, MeasurePosition[]>();
      for (const mp of positions) {
        const list = ctxMeasureStaves.get(mp.measure) || [];
        list.push(mp);
        ctxMeasureStaves.set(mp.measure, list);
      }
      let ctxBestDist = Infinity;
      for (const [, stavesArr] of ctxMeasureStaves) {
        const inX = stavesArr.some(mp => clickX >= mp.x - 15 && clickX <= mp.x + mp.width + 15);
        if (!inX) continue;
        const sorted = stavesArr.slice().sort((a, b) => a.y - b.y);
        const centers = sorted.map(s => s.y + Math.max(s.height, 40) / 2);
        for (let i = 0; i < sorted.length; i++) {
          const upper = i === 0 ? -Infinity : (centers[i - 1] + centers[i]) / 2;
          const lower = i === sorted.length - 1 ? Infinity : (centers[i] + centers[i + 1]) / 2;
          if (clickY >= upper && clickY < lower) {
            const dist = Math.abs(clickY - centers[i]);
            if (dist < ctxBestDist) {
              ctxBestDist = dist;
              clickedStaff = sorted[i].staffIndex;
            }
            break;
          }
        }
      }

      // Find nearest note by 2D distance (same approach as click handler)
      const hits = noteHitsRef.current;
      let bestHit: NoteHit | null = null;
      let bestDist = 50;

      for (const hit of hits) {
        let noteX = hit.x;
        let noteY = hit.y;
        if (hit.svgElement?.isConnected) {
          const svgRect = hit.svgElement.getBoundingClientRect();
          noteX = svgRect.x - rect.left + svgRect.width / 2;
          noteY = svgRect.y - rect.top + svgRect.height / 2;
        }
        const dx = Math.abs(clickX - noteX);
        const dy = Math.abs(clickY - noteY);
        const dist = Math.sqrt(dx * dx + (dy * 0.5) * (dy * 0.5));
        if (dist < bestDist) {
          bestDist = dist;
          bestHit = hit;
        }
      }

      if (bestHit) {
        e.preventDefault();
        onScoreClickRef.current({
          measure: bestHit.measure,
          beat: bestHit.beat,
          staffIndex: bestHit.staffIndex,
          pitch: bestHit.pitch,
          isRightClick: true,
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }
    };

    container.addEventListener("click", handleClick);
    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      container.removeEventListener("click", handleClick);
      container.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  // ── Main render effect ──────────────────────────────────────────

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

      // Only show loading indicator on first render (not re-renders that would cause flicker)
      if (!osmdRef.current) setLoading(true);
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

        // Apply layout BEFORE load — sets VexFlowDefaultNotationFontScale on
        // EngravingRules so the new graphic uses these values.
        applyLayout(osmdRef.current, currentLayout, currentZoom);

        // OSMD/VexFlow note-size bug workaround.
        // VexFlow bakes `glyph_font_scale` into each StaveNote at construction
        // time, reading from the global `Vex.Flow.DEFAULT_NOTATION_FONT_SCALE`.
        // OSMD only writes that global inside `drawer.drawSheet()` (i.e. during
        // `render()`), and the StaveNotes are constructed by `load()` BEFORE
        // any render runs. So on a preset change, `load()` builds the new
        // graphic using the *previous* render's font scale — and the new notes
        // render at the wrong size. Calling `render()` once before `load()`
        // forces drawSheet's preamble to push the just-applied EngravingRules
        // scale into the Vex.Flow global, so the upcoming load() builds notes
        // at the correct scale. The second render() below is what the user
        // actually sees.
        const isReRender = !!osmdRef.current.graphic;
        if (isReRender) {
          containerRef.current.style.visibility = "hidden";
          try { osmdRef.current.render(); } catch { /* may throw if container size 0 */ }
        }

        const musicxml = scoreToMusicXML(currentScore);
        await osmdRef.current.load(musicxml);

        if (cancelled) return;

        // Re-apply after load in case load() reset any rules
        applyLayout(osmdRef.current, currentLayout, currentZoom);

        // Temporarily lock scroll during OSMD render to prevent jump
        if (scrollParent) {
          (scrollParent as HTMLElement).style.overflow = "hidden";
        }

        osmdRef.current.render();
        if (isReRender) {
          containerRef.current.style.visibility = "";
        }

        // Restore scroll position and re-enable scrolling
        if (scrollParent) {
          scrollParent.scrollTop = prevScrollTop;
          scrollParent.scrollLeft = prevScrollLeft;
          (scrollParent as HTMLElement).style.overflow = "";
        }

        // Extract positions for both measures and individual notes
        extractMeasurePositions(osmdRef.current, currentZoom);
        noteHitsRef.current = extractNoteHits(osmdRef.current, currentZoom);
        console.log(`[ScoreRenderer] Extracted ${noteHitsRef.current.length} note positions, ${measurePositionsRef.current.length} measure positions`);

        // Expose to test harness
        if (typeof window !== "undefined") {
          const containerEl = containerRef.current;
          const cRect = containerEl?.getBoundingClientRect();
          (window as any).__noteHits = noteHitsRef.current.map(h => {
            let x = h.x, y = h.y;
            // Use SVG bounding box for more accurate click coordinates
            if (h.svgElement?.isConnected && cRect) {
              const sr = h.svgElement.getBoundingClientRect();
              x = sr.x - cRect.left + sr.width / 2;
              y = sr.y - cRect.top + sr.height / 2;
            }
            return {
              measure: h.measure, beat: h.beat, pitch: h.pitch,
              staffIndex: h.staffIndex, x, y,
              hasElement: !!h.svgElement,
            };
          });
          (window as any).__measurePositions = measurePositionsRef.current;
          (window as any).__osmd = osmdRef.current;
          (window as any).__osmdFontScale = osmdRef.current?.EngravingRules?.VexFlowDefaultNotationFontScale;
          (window as any).__osmdNoteSize = currentLayout.noteSize;
        }

        // Make notes interactive and position overlays
        setupNoteInteraction();
        positionCursorEl();
        updateNoteHighlight();
        positionSelectionEls();

        // Final scroll restore after all positioning is done
        if (scrollParent) {
          scrollParent.scrollTop = prevScrollTop;
          scrollParent.scrollLeft = prevScrollLeft;
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

  // ── System print restore ───────────────────────────────────────

  useEffect(() => {
    const handleAfterPrint = () => {
      if (printingRef.current) return;
      removePrintOverlays(containerRef.current);
      const osmd = osmdRef.current;
      if (!osmd) return;
      applyLayout(osmd, layoutRef.current, zoomRef.current);
      osmd.render();
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cursorElRef.current?.remove();
      highlightedSvgRef.current?.classList.remove("note-selected");
      for (const el of selectionElsRef.current) el.remove();
    };
  }, []);

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
      <div ref={containerRef} className="relative min-h-[200px] p-4 print-no-pad" />
    </div>
  );
}

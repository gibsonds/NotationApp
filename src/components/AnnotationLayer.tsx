"use client";

import { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useScoreStore } from "@/store/score-store";
import type { Annotation } from "@/lib/schema";
import AnnotationPopover from "./AnnotationPopover";

type Color = Annotation["color"];
type Visibility = Annotation["visibility"];

const COLOR_CLASSES: Record<Color, { bg: string; border: string; text: string; tail: string }> = {
  yellow: { bg: "bg-yellow-200", border: "border-yellow-400", text: "text-yellow-900", tail: "#fef08a" },
  blue:   { bg: "bg-blue-200",   border: "border-blue-400",   text: "text-blue-900",   tail: "#bfdbfe" },
  pink:   { bg: "bg-pink-200",   border: "border-pink-400",   text: "text-pink-900",   tail: "#fbcfe8" },
  green:  { bg: "bg-green-200",  border: "border-green-400",  text: "text-green-900",  tail: "#bbf7d0" },
};

export default function AnnotationLayer() {
  const score = useScoreStore((s) => s.score);
  const applyPatches = useScoreStore((s) => s.applyPatches);
  const uiState = useScoreStore((s) => s.uiState);

  const annotationMode = uiState.appMode === "annotate";
  const { annotationFilters } = uiState;
  const annotations: Annotation[] = score?.annotations ?? [];

  const [pendingAnchor, setPendingAnchor] = useState<{ x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingAnnotation = editingId
    ? annotations.find((a) => a.id === editingId) ?? null
    : null;

  const filteredAnnotations = annotations.filter((ann) => {
    if (annotationFilters.hideInPerformance) return false;
    if (ann.visibility === "shared" && !annotationFilters.showShared) return false;
    if (ann.visibility === "personal" && !annotationFilters.showPersonal) return false;
    if (annotationFilters.hiddenLabels.includes(ann.label)) return false;
    return true;
  });

  const handleLayerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!annotationMode) return;
      if ((e.target as HTMLElement).closest("[data-annotation-bubble]")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      setPendingAnchor({ x, y });
      setEditingId(null);
    },
    [annotationMode]
  );

  const handleBubbleClick = (e: React.MouseEvent, ann: Annotation) => {
    e.stopPropagation();
    setEditingId(ann.id);
    setPendingAnchor(null);
  };

  const handleCreate = (data: {
    text: string; color: Color; visibility: Visibility; label: string;
  }) => {
    if (!pendingAnchor) return;
    applyPatches([{
      op: "add_annotation",
      annotation: {
        id: uuidv4(),
        anchorX: pendingAnchor.x,
        anchorY: pendingAnchor.y,
        text: data.text,
        color: data.color,
        visibility: data.visibility,
        label: data.label,
        createdAt: Date.now(),
      },
    }]);
    setPendingAnchor(null);
  };

  const handleUpdate = (
    id: string,
    updates: { text?: string; color?: Color; visibility?: Visibility; label?: string }
  ) => {
    applyPatches([{ op: "update_annotation", id, updates }]);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    applyPatches([{ op: "remove_annotation", id }]);
    setEditingId(null);
  };

  const handleClose = () => {
    setPendingAnchor(null);
    setEditingId(null);
  };

  if (!score) return null;

  return (
    <div
      className={`absolute inset-0 ${annotationMode ? "cursor-crosshair" : ""}`}
      style={{ pointerEvents: annotationMode ? "auto" : "none" }}
      onClick={handleLayerClick}
    >
      {/* Annotation bubbles */}
      {filteredAnnotations.map((ann) => {
        const cls = COLOR_CLASSES[ann.color] ?? COLOR_CLASSES.yellow;
        return (
          <div
            key={ann.id}
            data-annotation-bubble="true"
            className="absolute"
            style={{
              left: `${ann.anchorX * 100}%`,
              top: `${ann.anchorY * 100}%`,
              transform: "translate(-50%, calc(-100% - 8px))",
              pointerEvents: "auto",
              zIndex: 10,
            }}
            onClick={(e) => handleBubbleClick(e, ann)}
          >
            <div
              className={`relative rounded-lg border px-2.5 py-1.5 text-xs shadow-md cursor-pointer max-w-[180px] min-w-[44px] min-h-[36px] flex flex-col justify-center ${cls.bg} ${cls.border} ${cls.text}`}
              title={ann.text}
            >
              {ann.label && (
                <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60 leading-none mb-0.5">
                  {ann.label}
                </span>
              )}
              <span className="leading-tight line-clamp-2">{ann.text}</span>
            </div>
            {/* Tail triangle */}
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full"
              style={{
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: `8px solid ${cls.tail}`,
              }}
            />
          </div>
        );
      })}

      {/* New annotation popover */}
      {pendingAnchor && (
        <AnnotationPopover
          anchorX={pendingAnchor.x}
          anchorY={pendingAnchor.y}
          onSave={handleCreate}
          onClose={handleClose}
        />
      )}

      {/* Edit annotation popover */}
      {editingAnnotation && (
        <AnnotationPopover
          anchorX={editingAnnotation.anchorX}
          anchorY={editingAnnotation.anchorY}
          initial={editingAnnotation}
          onSave={(data) => handleUpdate(editingAnnotation.id, data)}
          onDelete={() => handleDelete(editingAnnotation.id)}
          onClose={handleClose}
        />
      )}
    </div>
  );
}

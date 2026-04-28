"use client";

import { useEffect, useRef } from "react";

export interface ChordChartContextMenuItem {
  label: string;
  onClick: () => void;
  /** Optional disabled state with a hover hint. */
  disabled?: boolean;
  /** Visually emphasize destructive items (delete). */
  destructive?: boolean;
  /** Renders a divider above this item. */
  divider?: boolean;
}

interface ChordChartContextMenuProps {
  x: number;
  y: number;
  items: ChordChartContextMenuItem[];
  onClose: () => void;
}

export default function ChordChartContextMenu({
  x,
  y,
  items,
  onClose,
}: ChordChartContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[180px] bg-[#1a1a2e] border border-pink-500/30 rounded-md shadow-xl py-1 text-sm font-sans"
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.divider && <div className="my-1 border-t border-gray-700" />}
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
            className={`w-full text-left px-3 py-1.5 transition-colors ${
              item.disabled
                ? "text-gray-600 cursor-not-allowed"
                : item.destructive
                  ? "text-red-300 hover:bg-red-900/40"
                  : "text-gray-200 hover:bg-pink-500/20"
            }`}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}

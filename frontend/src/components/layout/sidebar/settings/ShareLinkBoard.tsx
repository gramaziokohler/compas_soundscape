"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { linkKey, linkMemberCount, useShareConfigStore } from "@/store";
import type { ShareItemKind, ShareLink } from "@/types/share";
import { boardItemKey, buildBoardSegments, type BoardRect, type BoardSegment } from "@/utils/shareBoardGeometry";
import { SHARE_SETTINGS, UI_BORDER_RADIUS } from "@/utils/constants";

export interface ShareBoardItem {
  id: string;
  label: string;
}

export interface ShareLinkBoardProps {
  /** Shared items per column (only shared items can be linked). */
  items: Record<ShareItemKind, ShareBoardItem[]>;
  links: ShareLink[];
}

const COLUMNS: ShareItemKind[] = ["scene", "simulation", "listener"];

/** What the next click builds on: a lone item, or an existing link. */
type BoardSelection = { kind: ShareItemKind; id: string } | { linkId: string } | null;

/**
 * Link board of Settings → Share: three columns (scenes / simulations /
 * listeners). Click an item, then an item of another column to link them;
 * click a linked item of the selected group again to unlink it. Each link is
 * drawn as a faint line (a scene → listener line with no simulation passes
 * dashed behind the middle column). Names truncate to the column width.
 */
export function ShareLinkBoard({ items, links }: ShareLinkBoardProps) {
  const createLink = useShareConfigStore((s) => s.createLink);
  const updateLink = useShareConfigStore((s) => s.updateLink);
  const [selection, setSelection] = useState<BoardSelection>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLElement>());
  const [segments, setSegments] = useState<BoardSegment[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Memoized: `measure` (and the layout effect) must only change with the links.
  const usableLinks = useMemo(() => links.filter((l) => linkMemberCount(l) >= 2), [links]);
  const selectedLink = selection && "linkId" in selection ? usableLinks.find((l) => l.id === selection.linkId) : undefined;

  const ownerOf = useCallback(
    (kind: ShareItemKind, id: string) => usableLinks.find((l) => l[linkKey(kind)] === id),
    [usableLinks],
  );

  const handleItemClick = (kind: ShareItemKind, id: string) => {
    const owner = ownerOf(kind, id);
    if (selectedLink) {
      if (selectedLink[linkKey(kind)] === id) {
        // De-select: the item leaves the group (a group left with one item dissolves).
        updateLink(selectedLink.id, kind, undefined);
        setSelection(linkMemberCount(selectedLink) > 2 ? { linkId: selectedLink.id } : null);
      } else if (owner) {
        setSelection({ linkId: owner.id });
      } else {
        updateLink(selectedLink.id, kind, id);
      }
      return;
    }
    if (selection && "kind" in selection) {
      if (selection.kind === kind) {
        setSelection(selection.id === id ? null : owner ? { linkId: owner.id } : { kind, id });
        return;
      }
      setSelection({ linkId: createLink({ [selection.kind]: selection.id, [kind]: id }) });
      return;
    }
    setSelection(owner ? { linkId: owner.id } : { kind, id });
  };

  // Measure chips relative to the board and rebuild the lines on any layout change.
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const origin = board.getBoundingClientRect();
    const rects = new Map<string, BoardRect>();
    chipRefs.current.forEach((el, key) => {
      const r = el.getBoundingClientRect();
      rects.set(key, { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top });
    });
    setSize({ width: origin.width, height: origin.height });
    setSegments(buildBoardSegments(usableLinks, rects));
  }, [usableLinks]);

  useLayoutEffect(() => {
    measure();
    const board = boardRef.current;
    if (!board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [measure, items]);

  const isSelected = (kind: ShareItemKind, id: string) =>
    selectedLink ? selectedLink[linkKey(kind)] === id : !!selection && "kind" in selection && selection.kind === kind && selection.id === id;

  return (
    <div
      ref={boardRef}
      className="relative grid"
      style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", columnGap: SHARE_SETTINGS.BOARD_COLUMN_GAP_PX, rowGap: 4 }}
      onClick={(e) => { if (e.target === e.currentTarget) setSelection(null); }}
      onKeyDown={(e) => { if (e.key === "Escape") setSelection(null); }}
    >
      <svg
        aria-hidden="true"
        width={size.width}
        height={size.height}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "visible" }}
      >
        {segments.map((seg) => {
          const active = seg.linkId === selectedLink?.id;
          return (
            <path
              key={seg.key}
              d={seg.path}
              fill="none"
              stroke={active ? "var(--color-primary)" : "var(--color-secondary-hover)"}
              strokeOpacity={active ? SHARE_SETTINGS.BOARD_LINE_SELECTED_OPACITY : SHARE_SETTINGS.BOARD_LINE_OPACITY}
              strokeWidth={SHARE_SETTINGS.BOARD_LINE_WIDTH}
              strokeDasharray={seg.skipsMiddle ? SHARE_SETTINGS.BOARD_SKIP_DASH : undefined}
            />
          );
        })}
      </svg>

      {COLUMNS.map((kind) => (
        <span key={`h-${kind}`} className="min-w-0 truncate text-[9px] uppercase tracking-wider text-secondary-hover" title={SHARE_SETTINGS.BOARD_COLUMNS[kind]}>
          {SHARE_SETTINGS.BOARD_COLUMNS[kind]}
        </span>
      ))}

      {COLUMNS.map((kind) => (
        <div key={`c-${kind}`} className="flex min-w-0 flex-col gap-1" style={{ gridRow: 2 }}>
          {items[kind].length === 0 ? (
            <span className="text-[10px] text-secondary-hover">{SHARE_SETTINGS.BOARD_EMPTY_COLUMN}</span>
          ) : (
            items[kind].map((item) => {
              const key = boardItemKey(kind, item.id);
              const selected = isSelected(kind, item.id);
              const linked = !!ownerOf(kind, item.id);
              return (
                <button
                  key={key}
                  type="button"
                  ref={(el) => { if (el) chipRefs.current.set(key, el); else chipRefs.current.delete(key); }}
                  onClick={() => handleItemClick(kind, item.id)}
                  aria-pressed={selected}
                  title={item.label}
                  className="relative w-full min-w-0 truncate px-1.5 py-1 text-left text-[10px] transition-colors"
                  style={{
                    zIndex: 1,
                    borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                    // Opaque so a line skipping the middle column passes behind its chips.
                    background: selected ? "var(--color-primary)" : "var(--color-secondary-lighter)",
                    color: selected ? "var(--color-on-blue)" : "var(--color-foreground)",
                    border: `1px solid ${linked && !selected ? "var(--color-primary)" : "transparent"}`,
                  }}
                >
                  {item.label}
                </button>
              );
            })
          )}
        </div>
      ))}
    </div>
  );
}

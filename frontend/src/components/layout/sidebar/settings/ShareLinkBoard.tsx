"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { linkKey, linkMemberCount, useShareConfigStore, type ShareLinkEnd } from "@/store";
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

/**
 * Link board of Settings → Share: three columns (scenes / simulations /
 * listeners). Click an item, then an item of another column to connect them —
 * the selection then clears, so the next two clicks make the next link. Click a
 * connected pair again to disconnect it. An item can be in several links (one
 * scene with several listeners). Each link is drawn as a faint line (a scene →
 * listener line with no simulation passes dashed behind the middle column) and
 * listed under the board with a remove button; hovering an item or a list row
 * highlights its links.
 */
export function ShareLinkBoard({ items, links }: ShareLinkBoardProps) {
  const toggleConnection = useShareConfigStore((s) => s.toggleConnection);
  const removeLink = useShareConfigStore((s) => s.removeLink);
  // First end of the link being made.
  const [pending, setPending] = useState<ShareLinkEnd | null>(null);
  const [hovered, setHovered] = useState<ShareLinkEnd | { linkId: string } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLElement>());
  const [segments, setSegments] = useState<BoardSegment[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Memoized: `measure` (and the layout effect) must only change with the links.
  const usableLinks = useMemo(() => links.filter((l) => linkMemberCount(l) >= 2), [links]);

  const labelOf = useCallback(
    (kind: ShareItemKind, id: string) => items[kind].find((item) => item.id === id)?.label ?? id,
    [items],
  );

  const linksOf = useCallback(
    (end: ShareLinkEnd) => usableLinks.filter((l) => l[linkKey(end.kind)] === end.id),
    [usableLinks],
  );

  // Links drawn highlighted: those of the pending item, else of what is hovered.
  const highlighted = useMemo(() => {
    const focus = pending ?? hovered;
    if (!focus) return new Set<string>();
    if ("linkId" in focus) return new Set([focus.linkId]);
    return new Set(linksOf(focus).map((l) => l.id));
  }, [pending, hovered, linksOf]);

  const handleItemClick = (end: ShareLinkEnd) => {
    if (!pending || pending.kind === end.kind) {
      // Start a link here (clicking the pending item again cancels it).
      setPending(pending && pending.kind === end.kind && pending.id === end.id ? null : end);
      return;
    }
    toggleConnection(pending, end);
    setPending(null);
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

  return (
    <div className="flex flex-col gap-2" onKeyDown={(e) => { if (e.key === "Escape") setPending(null); }}>
      <div
        ref={boardRef}
        className="relative grid"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", columnGap: SHARE_SETTINGS.BOARD_COLUMN_GAP_PX, rowGap: 4 }}
        onClick={(e) => { if (e.target === e.currentTarget) setPending(null); }}
      >
        <svg
          aria-hidden="true"
          width={size.width}
          height={size.height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "visible" }}
        >
          {segments.map((seg) => {
            const active = highlighted.has(seg.linkId);
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
                const end: ShareLinkEnd = { kind, id: item.id };
                const isPending = pending?.kind === kind && pending.id === item.id;
                const linked = linksOf(end).length > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    ref={(el) => { if (el) chipRefs.current.set(key, el); else chipRefs.current.delete(key); }}
                    onClick={() => handleItemClick(end)}
                    onMouseEnter={() => setHovered(end)}
                    onMouseLeave={() => setHovered(null)}
                    aria-pressed={isPending}
                    title={item.label}
                    className="relative w-full min-w-0 truncate px-1.5 py-1 text-left text-[10px] transition-colors"
                    style={{
                      zIndex: 1,
                      borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                      // Opaque so a line skipping the middle column passes behind its chips.
                      background: isPending ? "var(--color-primary)" : "var(--color-secondary-lighter)",
                      color: isPending ? "var(--color-on-blue)" : "var(--color-foreground)",
                      border: `1px solid ${linked && !isPending ? "var(--color-primary)" : "transparent"}`,
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

      {/* Every link, one row each — hover highlights it on the board. */}
      <div className="flex flex-col gap-0.5">
        {usableLinks.length === 0 ? (
          <span className="text-[10px] text-secondary-hover">{SHARE_SETTINGS.BOARD_NO_LINKS}</span>
        ) : (
          usableLinks.map((link) => {
            const label = COLUMNS
              .flatMap((kind) => {
                const id = link[linkKey(kind)];
                return id ? [labelOf(kind, id)] : [];
              })
              .join(SHARE_SETTINGS.BOARD_LINK_SEPARATOR);
            return (
              <div
                key={link.id}
                className="group flex min-w-0 items-center gap-1 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-[var(--color-secondary-lighter)]"
                style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                onMouseEnter={() => setHovered({ linkId: link.id })}
                onMouseLeave={() => setHovered(null)}
              >
                <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                <button
                  type="button"
                  onClick={() => removeLink(link.id)}
                  title={SHARE_SETTINGS.BOARD_REMOVE_LINK}
                  aria-label={SHARE_SETTINGS.BOARD_REMOVE_LINK}
                  className="shrink-0 text-secondary-hover opacity-0 transition-opacity hover:text-error focus:opacity-100 group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

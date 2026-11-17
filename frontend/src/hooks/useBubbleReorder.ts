import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { SIMPLE_MODE } from '@/utils/constants';

const SLOT = SIMPLE_MODE.BUBBLE_SIZE + SIMPLE_MODE.BUBBLE_GAP;

/** Inclusive range of positions an item may be dropped at. */
export interface ReorderBounds {
  min: number;
  max: number;
}

interface UseBubbleReorderArgs {
  /** Called on drop with item positions (in the column's `items` order). Undefined = no reordering. */
  onReorder?: (from: number, to: number) => void;
  /** Restrict where the item at `from` may land (e.g. within its own type). */
  getBounds?: (from: number) => ReorderBounds;
  /** 'down': position + 1 sits lower on screen; 'up' (column-reverse): higher. */
  direction: 'down' | 'up';
  /** First rendered position and number of rendered positions (the scroll window). */
  first: number;
  visibleCount: number;
  /** A drag ended (the click that follows the release must be swallowed). */
  onDragEnd: () => void;
}

interface DragState {
  from: number;
  target: number;
  dy: number;
}

interface PressState {
  from: number;
  startY: number;
  pointerId: number;
  dragging: boolean;
}

export interface BubbleSlotProps {
  style: CSSProperties;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (e: PointerEvent<HTMLDivElement>) => void;
}

/**
 * useBubbleReorder Hook
 *
 * Drag-to-reorder for a bubble column. A press becomes a drag past
 * SCROLL_DRAG_THRESHOLD_PX; the dragged bubble follows the pointer and its
 * neighbours slide one slot to make room. Nothing changes in the stores until
 * the drop, which calls `onReorder(from, to)` once. Drops stay inside the
 * rendered window (scroll first to move further) and inside `getBounds`.
 * Pointer capture keeps the drag alive outside the bubble; a lost capture
 * cancels it. Ctrl+press is skipped (macOS Ctrl+click opens the context menu).
 *
 * Usage (BubbleScrollColumn):
 * ```tsx
 * const reorder = useBubbleReorder({ onReorder, direction, first, visibleCount, onDragEnd });
 * <div key={key} {...reorder.slotProps(position)}>{item}</div>
 * ```
 */
export function useBubbleReorder({
  onReorder,
  getBounds,
  direction,
  first,
  visibleCount,
  onDragEnd,
}: UseBubbleReorderArgs) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pressRef = useRef<PressState | null>(null);
  // Screen px per position step: down columns grow downward, up columns upward.
  const step = direction === 'down' ? SLOT : -SLOT;

  const targetFor = (from: number, dy: number): number => {
    const bounds = getBounds?.(from) ?? { min: 0, max: Number.MAX_SAFE_INTEGER };
    const min = Math.max(bounds.min, first);
    const max = Math.min(bounds.max, first + visibleCount - 1);
    return Math.min(max, Math.max(min, from + Math.round(dy / step)));
  };

  const end = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== e.pointerId) return;
    pressRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!press.dragging) return;
    const target = targetFor(press.from, e.clientY - press.startY);
    setDrag(null);
    onDragEnd();
    if (commit && target !== press.from) onReorder?.(press.from, target);
  };

  /** Neighbour shift (px) while `drag` is active: the items between from and target slide one slot. */
  const offsetOf = (position: number): number => {
    if (!drag) return 0;
    if (position === drag.from) return drag.dy;
    if (drag.from < drag.target && position > drag.from && position <= drag.target) return -step;
    if (drag.from > drag.target && position >= drag.target && position < drag.from) return step;
    return 0;
  };

  const slotProps = (position: number): BubbleSlotProps => {
    const isDragged = drag?.from === position;
    const offset = offsetOf(position);
    return {
      style: {
        touchAction: 'none',
        userSelect: 'none',
        transform: offset !== 0 ? `translateY(${offset}px)` : undefined,
        // Neighbours glide; the dragged bubble tracks the pointer. No transition
        // outside a drag, so the drop lands without animating from a stale offset.
        transition: drag && !isDragged ? `transform ${SIMPLE_MODE.REORDER_SHIFT_MS}ms ease-out` : 'none',
        zIndex: isDragged ? 1 : undefined,
        cursor: isDragged ? 'grabbing' : undefined,
      },
      onPointerDown: (e) => {
        if (!onReorder || e.button !== 0 || e.ctrlKey) return;
        pressRef.current = { from: position, startY: e.clientY, pointerId: e.pointerId, dragging: false };
      },
      onPointerMove: (e) => {
        const press = pressRef.current;
        if (!press || press.pointerId !== e.pointerId) return;
        const dy = e.clientY - press.startY;
        if (!press.dragging) {
          if (Math.abs(dy) < SIMPLE_MODE.SCROLL_DRAG_THRESHOLD_PX) return;
          press.dragging = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        setDrag({ from: press.from, target: targetFor(press.from, dy), dy });
      },
      onPointerUp: (e) => end(e, true),
      onPointerCancel: (e) => end(e, false),
      onLostPointerCapture: (e) => end(e, false),
    };
  };

  return { slotProps, isDragging: drag !== null };
}

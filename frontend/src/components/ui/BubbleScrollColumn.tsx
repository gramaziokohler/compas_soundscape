'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { BubbleScrollButton, type BubbleTone } from '@/components/ui/Bubble';
import { clampScroll, scrollToInclude, windowLayout } from '@/utils/bubbleOverflow';
import { SIMPLE_MODE } from '@/utils/constants';

const SLOT = SIMPLE_MODE.BUBBLE_SIZE + SIMPLE_MODE.BUBBLE_GAP;
const SLIDE_PX = 8;
const SLIDE_MS = 180;

export interface BubbleScrollColumnProps {
  /** Keyed bubble nodes, in list order. */
  items: ReactNode[];
  /** The "+" closing the column — always visible, outside the scroll window. */
  addButton: ReactNode;
  /** Vertical budget in px (see useBubbleColumnSpace). */
  availablePx: number;
  /** Item to keep in view (selected / active / open); re-applied when it changes. */
  focusIndex?: number | null;
  /** 'down' grows from the top; 'up' grows from the bottom corner (item 0 nearest the "+"). */
  direction?: 'down' | 'up';
  align?: 'flex-start' | 'flex-end';
  labelSide?: 'left' | 'right';
  tone?: BubbleTone;
  /** Fixed placement (left/right + top/bottom), z-index, extra classes' styles. */
  style: CSSProperties;
  className?: string;
  /** DOM id on the column (e.g. a SectionHighlight target). */
  id?: string;
}

/**
 * BubbleScrollColumn Component
 *
 * A Simple-mode bubble column bounded to a vertical budget. While its bubbles
 * fit it renders exactly like a plain column; once they don't, it shows a
 * window of bubbles between two arrow pills ("N more" above / below). Mouse
 * wheel, vertical drag and the arrows scroll one bubble (arrows: one page);
 * the focused bubble is scrolled into view whenever it changes. Only the
 * visible bubbles are rendered, so hover labels and backdrop blur are never
 * clipped.
 *
 * Usage:
 * ```tsx
 * <BubbleScrollColumn
 *   items={scenes.map((s) => <SceneBubble key={s.id} … />)}
 *   addButton={<BubbleAddButton … />}
 *   availablePx={space.soundscapes}
 *   focusIndex={selectedIndex}
 *   style={{ left: 16, top: 40, zIndex: 25 }}
 * />
 * ```
 */
export function BubbleScrollColumn({
  items,
  addButton,
  availablePx,
  focusIndex = null,
  direction = 'down',
  align = 'flex-start',
  labelSide = 'right',
  tone = 'primary',
  style,
  className = '',
  id,
}: BubbleScrollColumnProps) {
  const count = items.length;
  const { overflow, visibleSlots } = windowLayout(count, availablePx);
  const [scroll, setScroll] = useState(0);
  const first = clampScroll(scroll, count, visibleSlots);
  const hiddenBefore = first;
  const hiddenAfter = Math.max(0, count - first - visibleSlots);

  const columnRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const wheelAccRef = useRef(0);
  const dragRef = useRef<{ y: number; start: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const scrollBy = (delta: number) => setScroll(clampScroll(first + delta, count, visibleSlots));

  // Keep the focused bubble in view when focus (or the window size) changes.
  useEffect(() => {
    if (focusIndex === null || focusIndex < 0 || focusIndex >= count) return;
    setScroll((s) => clampScroll(scrollToInclude(clampScroll(s, count, visibleSlots), focusIndex, visibleSlots), count, visibleSlots));
  }, [focusIndex, count, visibleSlots]);

  // Short slide of the window in the scroll direction (transform only — keeps the bubbles' backdrop blur).
  const prevFirstRef = useRef(first);
  useEffect(() => {
    const prev = prevFirstRef.current;
    prevFirstRef.current = first;
    if (prev === first || !windowRef.current?.animate) return;
    const sign = (first > prev ? 1 : -1) * (direction === 'down' ? 1 : -1);
    windowRef.current.animate(
      [{ transform: `translateY(${sign * SLIDE_PX}px)` }, { transform: 'translateY(0)' }],
      { duration: SLIDE_MS, easing: 'ease-out' },
    );
  }, [first, direction]);

  // Wheel scrolls one bubble per step. Non-passive so the page / viewer never scrolls underneath.
  const scrollStateRef = useRef({ overflow, first, count, visibleSlots, direction });
  useEffect(() => {
    scrollStateRef.current = { overflow, first, count, visibleSlots, direction };
  });
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const st = scrollStateRef.current;
      if (!st.overflow) return;
      e.preventDefault();
      e.stopPropagation();
      wheelAccRef.current += e.deltaY;
      const steps = Math.trunc(wheelAccRef.current / SIMPLE_MODE.SCROLL_WHEEL_STEP_PX);
      if (steps === 0) return;
      wheelAccRef.current -= steps * SIMPLE_MODE.SCROLL_WHEEL_STEP_PX;
      // Wheel down shows what is visually below: later items (down column) or earlier ones (up column).
      const delta = st.direction === 'down' ? steps : -steps;
      setScroll(clampScroll(st.first + delta, st.count, st.visibleSlots));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Vertical drag on the window; becomes a drag only past a threshold so plain clicks still land.
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false;
    if (!overflow || e.button !== 0) return;
    dragRef.current = { y: e.clientY, start: first, dragging: false };
  };
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.dragging) {
      if (Math.abs(dy) < SIMPLE_MODE.SCROLL_DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Dragging content away from the "+" end reveals later items.
    const delta = Math.round((direction === 'down' ? -dy : dy) / SLOT);
    setScroll(clampScroll(drag.start + delta, count, visibleSlots));
  };
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.dragging) return;
    suppressClickRef.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const visibleItems = overflow ? items.slice(first, first + visibleSlots) : items;
  const beforeArrow = overflow && (
    <BubbleScrollButton
      direction={direction === 'down' ? 'up' : 'down'}
      hiddenCount={hiddenBefore}
      onClick={() => scrollBy(-visibleSlots)}
      labelSide={labelSide}
      tone={tone}
    />
  );
  const afterArrow = overflow && (
    <BubbleScrollButton
      direction={direction === 'down' ? 'down' : 'up'}
      hiddenCount={hiddenAfter}
      onClick={() => scrollBy(visibleSlots)}
      labelSide={labelSide}
      tone={tone}
    />
  );
  const scrollWindow = visibleItems.length > 0 && (
    <div
      ref={windowRef}
      className="bubble-scroll-window"
      style={{ touchAction: overflow ? 'none' : undefined }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={(e) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {visibleItems}
    </div>
  );

  return (
    <div
      ref={columnRef}
      id={id}
      className={`bubble-column ${className}`}
      style={{
        gap: SIMPLE_MODE.BUBBLE_GAP,
        // No visible box — only shapes the SectionHighlight ring around the column.
        borderRadius: SIMPLE_MODE.BUBBLE_SIZE / 2,
        flexDirection: direction === 'down' ? 'column' : 'column-reverse',
        alignItems: align,
        ...style,
      }}
    >
      {direction === 'down' ? (
        <>
          {beforeArrow}
          {scrollWindow}
          {afterArrow}
          {addButton}
        </>
      ) : (
        <>
          {addButton}
          {beforeArrow}
          {scrollWindow}
          {afterArrow}
        </>
      )}
    </div>
  );
}

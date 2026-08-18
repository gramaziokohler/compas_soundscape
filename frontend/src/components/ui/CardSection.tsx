'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode, Fragment } from 'react';
import type { CardType, CardBaseConfig, CardColor } from '@/types/card';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * CardSection Component
 *
 * A generic section template that provides:
 * - Expand/collapse management (single expansion)
 * - "Add" button with type selector dropdown
 * - Status display (count, pending)
 * - Drag-to-reorder (hold and drag in the card header area)
 * - Magnetic insertion line indicator
 */

/** Pixel height of the card header region that initiates a drag on mousedown. */
const DRAG_HEADER_PX = 40;

// ============================================================================
// Types
// ============================================================================

export interface CardTypeOption {
  type: CardType;
  label: string;
  enabled: boolean;
  disabledTooltip?: string;
}

export interface CardSectionProps<TItem extends CardBaseConfig> {
  items: TItem[];
  availableTypes: CardTypeOption[];
  emptyMessage: string;
  statusLabel: string;
  addButtonTitle: string;
  onAddItem: (type: CardType) => void;
  renderCard: (
    item: TItem,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (index: number) => void
  ) => ReactNode;
  footer?: ReactNode;
  header?: ReactNode;
  getPendingCount?: (items: TItem[]) => number;
  isRunning?: boolean;
  expandedIndex?: number | null;
  onExpandedIndexChange?: (index: number | null) => void;
  color?: CardColor;
  /** Reorder callback — called with (fromIndex, toIndex) after a drag-drop. */
  onReorder?: (from: number, to: number) => void;
  /** Ctrl+drag duplicate callback — called with (fromIndex, toInsertionIndex) when Ctrl is held during drag. */
  onDuplicate?: (fromIndex: number, toInsertionIndex: number) => void;
  /** Optional action rendered below the empty message (when items.length === 0) */
  emptyAction?: ReactNode;
  /** Label shown on the add-card button. Defaults to `Add a ${statusLabel} card`. */
  addButtonLabel?: string;
}

// ============================================================================
// Internal drag types
// ============================================================================

interface DragData {
  index: number;
  startY: number;
  currentY: number;
  hasMoved: boolean;
  insertionIndex: number;
  ghostRect: { top: number; left: number; width: number; height: number };
  /** True when Ctrl key is held — duplicates instead of moving. */
  isCopyMode: boolean;
}

interface DragVisual {
  index: number;
  startY: number;
  currentY: number;
  insertionIndex: number;
  ghostRect: { top: number; left: number; width: number; height: number };
  /** True when Ctrl key is held — duplicates instead of moving. */
  isCopyMode: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function CardSection<TItem extends CardBaseConfig>({
  items,
  availableTypes,
  emptyMessage,
  statusLabel,
  addButtonTitle,
  onAddItem,
  renderCard,
  footer,
  header,
  getPendingCount,
  isRunning = false,
  expandedIndex: controlledExpandedIndex,
  onExpandedIndexChange,
  color = 'primary' as const,
  onReorder,
  onDuplicate,
  emptyAction,
  addButtonLabel,
}: CardSectionProps<TItem>) {
  const isControlled = controlledExpandedIndex !== undefined;

  const [internalExpandedIndex, setInternalExpandedIndex] = useState<number | null>(
    items.length > 0 ? 0 : null
  );

  const expandedIndex = isControlled ? controlledExpandedIndex : internalExpandedIndex;

  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const typeSelectorRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  /** Nearest scrollable ancestor of a node (walks up the DOM tree). */
  const getScrollParent = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
      node = node.parentElement;
    }
    return null;
  };

  /** Scrolls the section up so a dropdown opening below the button is fully visible. */
  const scrollDropdownIntoView = useCallback(() => {
    const dd = typeDropdownRef.current;
    if (!dd) return;
    const rect = dd.getBoundingClientRect();
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
    const viewportOverflow = rect.bottom - viewportBottom;

    const scroller = getScrollParent(dd);
    if (scroller && scroller !== document.scrollingElement) {
      const scrollerRect = scroller.getBoundingClientRect();
      const clippedOverflow = rect.bottom - scrollerRect.bottom;
      if (clippedOverflow > 0) {
        scroller.scrollBy({ top: clippedOverflow + 8, behavior: 'smooth' });
      } else if (viewportOverflow > 0) {
        window.scrollBy({ top: viewportOverflow + 8, behavior: 'smooth' });
      }
    } else if (viewportOverflow > 0) {
      window.scrollBy({ top: viewportOverflow + 8, behavior: 'smooth' });
    }
  }, []);

  const handleToggleTypeSelector = useCallback(() => {
    const willOpen = !showTypeSelector;
    setShowTypeSelector(willOpen);
    if (willOpen) {
      setTimeout(scrollDropdownIntoView, 50);
    }
  }, [showTypeSelector, scrollDropdownIntoView]);

  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Drag state ────────────────────────────────────────────────────────────────

  // Mutable drag data — updated on every mousemove to avoid setState overhead
  const dragDataRef = useRef<DragData | null>(null);

  // Visual state that drives rendering
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);

  // Stable refs to avoid stale closures inside global event handlers
  const itemsLengthRef = useRef(items.length);
  itemsLengthRef.current = items.length;

  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const onDuplicateRef = useRef(onDuplicate);
  onDuplicateRef.current = onDuplicate;

  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;

  // ── Insertion index calculation ───────────────────────────────────────────────

  /** Returns the gap index (0 = before card 0, n = after last card) nearest to cursorY. */
  const calcInsertionIndex = useCallback((cursorY: number): number => {
    const n = itemsLengthRef.current;
    if (n === 0) return 0;

    const gapYs: (number | undefined)[] = new Array(n + 1);

    for (let i = 0; i < n; i++) {
      const el = cardRefs.current.get(i);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (i === 0) gapYs[0] = r.top;
      if (i < n - 1) {
        const nextEl = cardRefs.current.get(i + 1);
        if (nextEl) gapYs[i + 1] = (r.bottom + nextEl.getBoundingClientRect().top) / 2;
      } else {
        gapYs[n] = r.bottom;
      }
    }

    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= n; i++) {
      const y = gapYs[i];
      if (y === undefined) continue;
      const d = Math.abs(cursorY - y);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []); // stable — only reads refs

  // ── Drag start (mousedown on grip) ────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent, index: number) => {
    if (!onReorder && !onDuplicate) return;
    e.preventDefault();
    e.stopPropagation();

    const el = cardRefs.current.get(index);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragDataRef.current = {
      index,
      startY: e.clientY,
      currentY: e.clientY,
      hasMoved: false,
      insertionIndex: index + 1,
      ghostRect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      isCopyMode: e.ctrlKey || e.metaKey,
    };

    document.body.style.cursor = dragDataRef.current.isCopyMode ? 'copy' : 'grabbing';
    document.body.style.userSelect = 'none';
  }, [onReorder, onDuplicate]);

  // ── Global mouse event handlers (mounted once) ────────────────────────────────

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragDataRef.current;
      if (!drag) return;

      drag.currentY = e.clientY;
      // Update copy mode based on current modifier state
      const ctrlHeld = e.ctrlKey || e.metaKey;
      drag.isCopyMode = ctrlHeld;
      document.body.style.cursor = ctrlHeld ? 'copy' : 'grabbing';
      if (!drag.hasMoved && Math.abs(e.clientY - drag.startY) > 4) drag.hasMoved = true;
      if (!drag.hasMoved) return;

      drag.insertionIndex = calcInsertionIndex(e.clientY);
      setDragVisual({
        index: drag.index,
        startY: drag.startY,
        currentY: drag.currentY,
        insertionIndex: drag.insertionIndex,
        ghostRect: drag.ghostRect,
        isCopyMode: drag.isCopyMode,
      });
    };

    const handleMouseUp = () => {
      const drag = dragDataRef.current;
      dragDataRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragVisual(null);

      if (!drag?.hasMoved) return;

      const ins = drag.insertionIndex;

      // Ctrl+drag: duplicate instead of reorder
      if (drag.isCopyMode && onDuplicateRef.current) {
        const targetInsertion = ins;
        onDuplicateRef.current(drag.index, targetInsertion);
        return;
      }

      // No-op: dropping in place
      if (ins === drag.index || ins === drag.index + 1) return;

      // Target index in the reordered array (after the dragged item is removed)
      const targetIndex = ins > drag.index ? ins - 1 : ins;

      onReorderRef.current?.(drag.index, targetIndex);

      // Keep the dragged card expanded at its new position (uncontrolled mode only)
      if (!isControlledRef.current) {
        setInternalExpandedIndex(targetIndex);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [calcInsertionIndex]); // calcInsertionIndex is stable

  // ── Expand / collapse ─────────────────────────────────────────────────────────

  const handleToggleExpand = useCallback((index: number) => {
    const newIndex = expandedIndex === index ? null : index;

    if (isControlled && onExpandedIndexChange) {
      onExpandedIndexChange(newIndex);
    } else {
      setInternalExpandedIndex(newIndex);
    }

    if (newIndex !== null) {
      setTimeout(() => {
        cardRefs.current.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [expandedIndex, isControlled, onExpandedIndexChange]);

  const prevItemCount = useRef(items.length);

  useEffect(() => {
    if (!isControlled && items.length > prevItemCount.current) {
      const lastIndex = items.length - 1;
      setInternalExpandedIndex(lastIndex);
      setTimeout(() => {
        cardRefs.current.get(lastIndex)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
    prevItemCount.current = items.length;
  }, [items.length, isControlled]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeSelectorRef.current && !typeSelectorRef.current.contains(event.target as Node)) {
        setShowTypeSelector(false);
      }
    };
    if (showTypeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTypeSelector]);

  const handleTypeSelect = useCallback((type: CardType) => {
    onAddItem(type);
    setShowTypeSelector(false);
  }, [onAddItem]);

  const totalCount = items.length;
  const pendingCount = getPendingCount ? getPendingCount(items) : 0;
  const addCardLabel = addButtonLabel ?? `Add a ${statusLabel} card`;

  const sectionColorStyle = {
    '--card-color': `var(--color-${color})`,
    '--card-color-hover': `var(--color-${color}-hover)`,
    '--card-color-light': `var(--color-${color}-light)`,
    accentColor: `var(--color-${color})`,
  } as React.CSSProperties;

  // Insertion is a no-op if it would leave the card at the same position
  const isNoOpInsertion = dragVisual
    ? dragVisual.insertionIndex === dragVisual.index ||
      dragVisual.insertionIndex === dragVisual.index + 1
    : false;

  const isDraggingMoved = dragVisual !== null && dragVisual.currentY !== dragVisual.startY;

  return (
    <div className="flex flex-col gap-3" style={sectionColorStyle}>
      {/* {header} */}

      {/* Status bar (count only) */}
      {totalCount > 0 && (
        <div className="flex items-center text-xs w-full gap-1 text-secondary-hover">
          {totalCount} {statusLabel}{totalCount !== 1 ? 's' : ''}
          {pendingCount > 0 && <span> ({pendingCount} pending)</span>}
        </div>
      )}

      {/* Card list */}
      <div ref={listRef} className="flex flex-col gap-2">
        {/* Insertion line before first card */}
        {isDraggingMoved && !isNoOpInsertion && dragVisual.insertionIndex === 0 && (
          <InsertionLine color={color} />
        )}

        {items.map((item, index) => (
          <Fragment key={index}>
            <div
              ref={(el) => {
                if (el) cardRefs.current.set(index, el);
                else cardRefs.current.delete(index);
              }}
              style={{
                opacity: isDraggingMoved && dragVisual.index === index ? 0.25 : 1,
                transition: isDraggingMoved ? 'none' : 'opacity 0.15s',
              }}
              onMouseDown={(onReorder || onDuplicate) ? (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, input, select, textarea, a')) return;
                const rect = e.currentTarget.getBoundingClientRect();
                if (e.clientY - rect.top > DRAG_HEADER_PX) return;
                handleDragStart(e, index);
              } : undefined}
              onMouseMove={(onReorder || onDuplicate) ? (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const inHeader = e.clientY - rect.top <= DRAG_HEADER_PX;
                const isBtn = !!(e.target as HTMLElement).closest('button, input, select, textarea, a');
                const ctrlHeld = e.ctrlKey || e.metaKey;
                e.currentTarget.style.cursor = (inHeader && !isBtn) ? (ctrlHeld ? 'copy' : 'grab') : '';
              } : undefined}
              onMouseLeave={(onReorder || onDuplicate) ? (e) => { e.currentTarget.style.cursor = ''; } : undefined}
            >
              {renderCard(item, index, expandedIndex === index, handleToggleExpand)}
            </div>

            {/* Insertion line after this card */}
            {isDraggingMoved && !isNoOpInsertion && dragVisual.insertionIndex === index + 1 && (
              <InsertionLine color={color} />
            )}
          </Fragment>
        ))}
      </div>

      {/* Empty state — shown above the add button when no cards exist */}
      {items.length === 0 && emptyMessage && (
        <EmptyState message={emptyMessage} action={emptyAction} />
      )}

      {/* Add-card button (New button UI) + type selector */}
      <div className="relative" ref={typeSelectorRef}>
        <button
          onClick={handleToggleTypeSelector}
          title={addButtonTitle}
          aria-label={addButtonTitle}
          className={`w-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 py-6 opacity-60 hover:opacity-100 transition-all duration-150 cursor-pointer active:scale-95 ${showTypeSelector ? 'scale-95 opacity-100' : ''}`}
          style={{ borderColor: 'var(--card-color)', backgroundColor: 'var(--color-secondary-light)' }}
        >
          <span className="text-2xl leading-none" style={{ color: 'var(--card-color)' }}>+</span>
          <span className="text-xs font-medium text-secondary-hover">{addCardLabel}</span>
        </button>

        {showTypeSelector && (
          <div ref={typeDropdownRef} className="absolute left-0 right-0 top-full mt-1 z-[100] rounded-lg shadow-lg bg-background border border-secondary-light overflow-hidden">
            {availableTypes.map((option, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === availableTypes.length - 1;
              const roundedClass = isFirst && isLast ? 'rounded-lg' : isFirst ? 'rounded-t-lg' : isLast ? 'rounded-b-lg' : '';
              return (
                <button
                  key={option.type}
                  onClick={() => option.enabled ? handleTypeSelect(option.type) : null}
                  disabled={!option.enabled}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${roundedClass} ${
                    option.enabled
                      ? 'text-foreground cursor-pointer hover:text-white'
                      : 'text-secondary-hover cursor-not-allowed opacity-60'
                  }`}
                  onMouseEnter={(e) => { if (option.enabled) e.currentTarget.style.backgroundColor = 'var(--card-color)'; }}
                  onMouseLeave={(e) => { if (option.enabled) e.currentTarget.style.backgroundColor = ''; }}
                  title={option.enabled ? option.label : option.disabledTooltip}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {footer}

      {/* Drag ghost — fixed-position card silhouette that follows the cursor */}
      {isDraggingMoved && (
        <div
          style={{
            position: 'fixed',
            top: dragVisual.ghostRect.top + (dragVisual.currentY - dragVisual.startY),
            left: dragVisual.ghostRect.left,
            width: dragVisual.ghostRect.width,
            height: dragVisual.ghostRect.height,
            pointerEvents: 'none',
            zIndex: 9999,
            opacity: 0.85,
            transform: 'rotate(0.8deg) scale(1.01)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            borderRadius: '8px',
            border: `1.5px solid var(--color-${color})`,
            backgroundColor: 'var(--color-background)',
          }}
        >
          {/* "+" badge shown during copy (Ctrl+drag) mode */}
          {dragVisual.isCopyMode && (
            <div
              style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                width: '18px',
                height: '18px',
                borderRadius: '50%',
                backgroundColor: `var(--color-${color})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
                color: 'white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                zIndex: 1,
              }}
            >
              +
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// InsertionLine — magnetic drop indicator shown between cards
// ============================================================================

function InsertionLine({ color }: { color: string }) {
  return (
    <div
      className="relative mx-1"
      style={{
        height: '2px',
        borderRadius: '1px',
        backgroundColor: `var(--color-${color})`,
        boxShadow: `0 0 7px var(--color-${color})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: '-4px',
          top: '-3px',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: `var(--color-${color})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '-4px',
          top: '-3px',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: `var(--color-${color})`,
        }}
      />
    </div>
  );
}


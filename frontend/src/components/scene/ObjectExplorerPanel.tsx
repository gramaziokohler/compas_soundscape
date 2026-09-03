'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ObjectExplorer } from '@/components/layout/ObjectExplorer';
import { useUIStore } from '@/store/uiStore';
import { RefreshIcon } from '@/components/ui/Icon';
import { useViewportScale } from '@/hooks/useViewportScale';
import { clampToViewport, clampToViewportWidth, clampToViewportHeight, getScale } from '@/utils/scale';
import { UI_SCALE } from '@/utils/constants';

const MIN_WIDTH = 380;
const MIN_HEIGHT = 200;
const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 1000;
const HEADER_HEIGHT = 40;
const CONTENT_PADDING = 8;

const PANEL_MARGIN = 24;
/** Panel center as a fraction of viewport width for the default (center-right) placement. */
const DEFAULT_X_CENTER_FRACTION = 0.62;

interface ObjectExplorerPanelProps {
  onClose: () => void;
  isVisible: boolean;
  isRightSidebarExpanded?: boolean;
  rightSidebarWidth?: number;
}

export function ObjectExplorerPanel({ onClose, isVisible, isRightSidebarExpanded = false, rightSidebarWidth = 0 }: ObjectExplorerPanelProps) {
  const scale = useViewportScale();

  const [itemCount, setItemCount] = useState(0);
  const resetAllRef = useRef<(() => void) | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);

  // NOTE: initial size is a stable constant (matching SSR) to avoid a hydration
  // mismatch — the fluid viewport-proportional height is applied in the mount
  // effect below. The panel is display:none until positionReady anyway.
  const [position, setPosition] = useState({ x: -DEFAULT_WIDTH, y: 72 });
  const [positionReady, setPositionReady] = useState(false);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  useEffect(() => {
    const saved = useUIStore.getState().objectExplorerPanel;
    const vp = getScale().viewport;
    const fluidDefaultHeight = Math.max(
      MIN_HEIGHT,
      Math.min(
        Math.max(MIN_HEIGHT, Math.min(vp.height * UI_SCALE.OBJECT_EXPLORER_PANEL_HEIGHT.FRACTION, 1000)),
        vp.height * 0.85,
      ),
    );
    if (saved) {
      const onScreen = saved.x >= -saved.width + 100
        && saved.y >= 0
        && saved.x < vp.width
        && saved.y < vp.height;
      if (onScreen) {
        setPosition({ x: saved.x, y: saved.y });
        setSize({ width: saved.width, height: Math.max(MIN_HEIGHT, saved.height) });
        setPositionReady(true);
        return;
      }
    }
    const sidebarOffset = isRightSidebarExpanded ? rightSidebarWidth + PANEL_MARGIN : PANEL_MARGIN;
    const initWidth = clampToViewportWidth(saved?.width ?? DEFAULT_WIDTH, MIN_WIDTH);
    const initHeight = clampToViewportHeight(saved?.height ?? fluidDefaultHeight, MIN_HEIGHT, PANEL_MARGIN);
    const targetX = scale.viewport.width * DEFAULT_X_CENTER_FRACTION - initWidth / 2;
    const maxX = scale.viewport.width - initWidth - sidebarOffset;
    const targetY = (scale.viewport.height - initHeight) / 2;
    setPosition({
      x: Math.max(PANEL_MARGIN, Math.min(targetX, maxX)),
      y: Math.max(PANEL_MARGIN, Math.min(targetY, scale.viewport.height - initHeight - PANEL_MARGIN)),
    });
    setSize({ width: initWidth, height: initHeight });
    setPositionReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preserve the panel's *relative* position across viewport resizes: the
  // absolute pixel position is scaled by the viewport growth/shrink ratio, then
  // clamped so the panel stays on-screen (clamped-fluid sizing). Never mid-drag.
  const lastViewportRef = useRef(scale.viewport);
  useEffect(() => {
    if (!positionReady || isDraggingRef.current || isResizingRef.current) return;
    const cur = scale.viewport;
    const prev = lastViewportRef.current;
    if (prev.width === cur.width && prev.height === cur.height) return;
    lastViewportRef.current = cur;
    const ratioX = prev.width > 0 ? cur.width / prev.width : 1;
    const ratioY = prev.height > 0 ? cur.height / prev.height : 1;
    setSize((s) => ({ ...s, height: clampToViewportHeight(s.height, MIN_HEIGHT, PANEL_MARGIN) }));
    setPosition((p) => {
      const nx = Math.round(p.x * ratioX);
      const ny = Math.round(p.y * ratioY);
      const c = clampToViewport(nx, ny, sizeRef.current.width, sizeRef.current.height, PANEL_MARGIN);
      if (c.x === p.x && c.y === p.y) return p;
      return c;
    });
  }, [scale.viewport.width, scale.viewport.height, positionReady]);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0 });

  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { sizeRef.current = size; }, [size]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.mouseX;
        const dy = e.clientY - dragStartRef.current.mouseY;
        setPosition({
          x: dragStartRef.current.panelX + dx,
          y: dragStartRef.current.panelY + dy,
        });
      } else if (isResizingRef.current) {
        const dx = e.clientX - resizeStartRef.current.mouseX;
        const dy = e.clientY - resizeStartRef.current.mouseY;
        setSize({
          width: Math.max(MIN_WIDTH, resizeStartRef.current.width + dx),
          height: Math.max(MIN_HEIGHT, resizeStartRef.current.height + dy),
        });
      }
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current || isResizingRef.current) {
        const p = positionRef.current;
        const s = sizeRef.current;
        useUIStore.getState().setObjectExplorerPanel({ x: p.x, y: p.y, width: s.width, height: s.height });
      }
      isDraggingRef.current = false;
      isResizingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: positionRef.current.x,
      panelY: positionRef.current.y,
    };
    e.preventDefault();
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    isResizingRef.current = true;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: rect?.width ?? sizeRef.current.width,
      height: rect?.height ?? sizeRef.current.height,
    };
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={panelRef}
      id="object-explorer-panel"
      className="fixed flex flex-col shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: 'auto',
        maxHeight: size.height,
        zIndex: 9999,
        display: (isVisible && positionReady) ? 'flex' : 'none',
        backgroundColor: 'var(--background)',
        border: '1.5px solid var(--color-primary)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Blur backdrop layer rendered as a pseudo-backdrop via box-shadow on a sibling */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '8px',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          pointerEvents: 'none',
          zIndex: -1,
        }}
      />

      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height: `${HEADER_HEIGHT}px`,
          borderBottom: '1px solid var(--color-secondary-light)',
          cursor: 'grab',
          userSelect: 'none',
          backgroundColor: 'var(--background)',
        }}
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-semibold text-foreground">Object Explorer</span>
        <div className="flex items-center gap-2">
          {itemCount > 0 && (
            <span className="text-xs" style={{ color: 'var(--color-secondary-hover)' }}>
              {itemCount} items
            </span>
          )}
          <button
            data-no-drag
            onClick={() => resetAllRef.current?.()}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: '18px',
              height: '18px',
              color: 'var(--color-secondary-hover)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary-light)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Reset hidden / isolated items"
          >
            <RefreshIcon size="0.8rem" />
          </button>
          <button
            data-no-drag
            onClick={onClose}
            className="flex items-center justify-center rounded transition-colors"
            style={{
              width: '18px',
              height: '18px',
              color: 'var(--color-secondary-hover)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-warning)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          padding: `0 ${CONTENT_PADDING}px ${CONTENT_PADDING}px`,
        }}
      >
        <ObjectExplorer
          resetAllRef={resetAllRef}
          onItemCountChange={setItemCount}
          maxTreeHeight={Math.max(MIN_HEIGHT - HEADER_HEIGHT - CONTENT_PADDING * 2, size.height - HEADER_HEIGHT - CONTENT_PADDING * 2)}
        />
      </div>

      {/* Resize handle */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '18px',
          height: '18px',
          cursor: 'nwse-resize',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: '3px',
        }}
        onMouseDown={handleResizeStart}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M9 1L1 9M9 5L5 9" stroke="var(--color-secondary-hover)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

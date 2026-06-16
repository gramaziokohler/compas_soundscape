'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ObjectExplorer } from '@/components/layout/ObjectExplorer';

const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;
const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 500;

const PANEL_MARGIN = 24;

interface ObjectExplorerPanelProps {
  onClose: () => void;
  isVisible: boolean;
  isRightSidebarExpanded?: boolean;
  rightSidebarWidth?: number;
}

export function ObjectExplorerPanel({ onClose, isVisible, isRightSidebarExpanded = false, rightSidebarWidth = 0 }: ObjectExplorerPanelProps) {
  const [itemCount, setItemCount] = useState(0);
  const resetAllRef = useRef<(() => void) | null>(null);

  // Use a safe SSR-stable initial position; corrected after mount via useEffect
  const [position, setPosition] = useState({ x: -DEFAULT_WIDTH, y: 72 });
  const [positionReady, setPositionReady] = useState(false);

  // Set real initial position after mount (avoids SSR/client mismatch)
  useEffect(() => {
    const sidebarOffset = isRightSidebarExpanded ? rightSidebarWidth + PANEL_MARGIN : PANEL_MARGIN;
    setPosition({
      x: window.innerWidth - DEFAULT_WIDTH - sidebarOffset,
      y: 72,
    });
    setPositionReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const isResizingRef = useRef(false);
  const resizeStartRef = useRef({ mouseX: 0, mouseY: 0, width: 0, height: 0 });

  // Store latest position/size in refs so the effect closure doesn't need them as deps
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
    isResizingRef.current = true;
    resizeStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      width: sizeRef.current.width,
      height: sizeRef.current.height,
    };
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div
      className="fixed flex flex-col backdrop-blur-sm shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        zIndex: 9999,
        display: (isVisible && positionReady) ? 'flex' : 'none',
        backgroundColor: 'var(--background)',
        border: '1px solid var(--color-secondary-light)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height: '40px',
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
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
      <ObjectExplorer resetAllRef={resetAllRef} onItemCountChange={setItemCount} />

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

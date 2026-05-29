'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { EntityInfoPanel } from '@/components/layout/sidebar/EntityInfoPanel';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';
import { useSpeckleStore } from '@/store';
import type { SoundEvent } from '@/types';

const INITIAL_WIDTH = 320;
const MIN_WIDTH = 200;
const MIN_HEIGHT = 100;
const HEADER_HEIGHT = 36;

interface SceneContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  generatedSounds?: SoundEvent[];
  onGoToReceiver?: (receiverId: string) => void;
}

/**
 * SceneContextMenu
 *
 * Floating context panel shown on right-click over a Speckle object.
 * Renders EntityInfoPanel for the selected object.
 * Draggable (header), resizable (bottom-right handle).
 * Rendered via createPortal to guarantee correct viewport-relative positioning.
 * Dismisses on pointer-down outside the panel or Escape.
 */
export function SceneContextMenu({
  x,
  y,
  onClose,
  generatedSounds,
  onGoToReceiver,
}: SceneContextMenuProps) {
  // Initialise position clamped to viewport
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
    return {
      x: Math.max(4, Math.min(x, vw - INITIAL_WIDTH - 4)),
      y: Math.max(4, Math.min(y, vh - MIN_HEIGHT - 4)),
    };
  });
  // height === 0 means auto (fit content); set to explicit px only after user resizes
  const [size, setSize] = useState({ width: INITIAL_WIDTH, height: 0 });

  const selectedEntity = useSpeckleStore((s) => s.selectedEntity);
  const panelTitle = selectedEntity?.objectName || selectedEntity?.objectType || 'Object Info';

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const resizeStartRef = useRef<{ mx: number; my: number; w: number; h: number } | null>(null);

  // Header drag
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStartRef.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  }, [pos.x, pos.y]);

  // Resize handle — capture current rendered height so auto-height panels resize correctly
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const currentH = panelRef.current?.offsetHeight ?? MIN_HEIGHT;
    resizeStartRef.current = { mx: e.clientX, my: e.clientY, w: size.width, h: currentH };
  }, [size.width]);

  // Document-level mousemove / mouseup for drag and resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragStartRef.current) {
        const dx = e.clientX - dragStartRef.current.mx;
        const dy = e.clientY - dragStartRef.current.my;
        setPos({ x: dragStartRef.current.px + dx, y: dragStartRef.current.py + dy });
      } else if (resizeStartRef.current) {
        const dw = e.clientX - resizeStartRef.current.mx;
        const dh = e.clientY - resizeStartRef.current.my;
        setSize({
          width: Math.max(MIN_WIDTH, resizeStartRef.current.w + dw),
          height: Math.max(MIN_HEIGHT, resizeStartRef.current.h + dh),
        });
      }
    };
    const onUp = () => {
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Close on pointer-down outside (skip during drag / resize)
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (dragStartRef.current || resizeStartRef.current) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const panel = (
    <div
      ref={panelRef}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.width,
        height: size.height > 0 ? size.height : 'auto',
        maxHeight: '85vh',
        zIndex: 1000,
        backgroundColor: 'var(--background)',
        border: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)`,
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Draggable header */}
      <div
        onMouseDown={handleDragMouseDown}
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          height: HEADER_HEIGHT,
          borderBottom: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)`,
          cursor: 'grab',
          userSelect: 'none',
          backgroundColor: 'var(--background)',
        }}
      >
        <span
          style={{ fontSize: '13px', fontWeight: 600, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 40px)' }}
          title={panelTitle}
        >
          {panelTitle}
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-muted, #888)',
            fontSize: '20px',
            lineHeight: 1,
            padding: '2px 6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* EntityInfoPanel content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: `${UI_RIGHT_SIDEBAR.PADDING}px`,
        }}
      >
        <EntityInfoPanel
          onGoToReceiver={onGoToReceiver}
          generatedSounds={generatedSounds}
        />
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 18,
          height: 18,
          cursor: 'se-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.35 }}>
          <path d="M0 10 L10 0 M4 10 L10 4 M8 10 L10 8" stroke="var(--foreground)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}

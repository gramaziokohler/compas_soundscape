'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { EntityInfoPanel } from '@/components/layout/sidebar/EntityInfoPanel';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';
import { useSpeckleStore, useAcousticLayerStore } from '@/store';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { getRootNodesForModel, getGeometryLeafIdsFromNode } from '@/hooks/useSpeckleTree';
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
  onOpenExplorer?: () => void;
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
  onOpenExplorer,
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

  // ── Viewer filtering state (syncs with ObjectExplorer via same stateKey) ──
  const viewMode = useSpeckleStore((s) => s.viewMode);
  const modelFileName = useSpeckleStore((s) => s.modelFileName);
  const worldTreeVersion = useSpeckleStore((s) => s.worldTreeVersion);
  const getViewerRef = useSpeckleStore((s) => s.getViewerRef);
  const acousticExplorerHiddenIds = useSpeckleStore((s) => s.acousticExplorerHiddenIds);
  const addAcousticExplorerHiddenId = useSpeckleStore((s) => s.addAcousticExplorerHiddenId);
  const removeAcousticExplorerHiddenId = useSpeckleStore((s) => s.removeAcousticExplorerHiddenId);
  const applyAcousticExplorerHiddenIsolation = useSpeckleStore((s) => s.applyAcousticExplorerHiddenIsolation);
  const selectedAcousticLayerName = useAcousticLayerStore((s) => s.selectedAcousticLayerName);

  const viewerRef = useMemo<React.RefObject<any>>(() => ({
    get current() { return getViewerRef(); }
  }), [getViewerRef]);

  const filtering = useSpeckleFiltering(viewerRef, 'explorer-default');
  const isAcousticMode = viewMode === 'acoustic';
  const hasDefinedLayer = !!selectedAcousticLayerName;
  const hideIsolateButton = isAcousticMode && hasDefinedLayer;

  // ── Resolve geometry leaf IDs for selected entity ──
  const geometryLeafIds = useMemo(() => {
    if (!selectedEntity?.objectId) return [];
    const viewer = getViewerRef();
    if (!viewer) return [];
    const worldTree = viewer.getWorldTree?.();
    if (!worldTree) return [];
    const rootNodes = getRootNodesForModel(worldTree, modelFileName);

    const findNode = (nodes: any[]): any | null => {
      for (const node of nodes) {
        const nodeId = node.raw?.id || node.model?.id || node.id;
        if (nodeId === selectedEntity.objectId) return node;
        const children = node.model?.children || node.children;
        if (children) {
          const found = findNode(children);
          if (found) return found;
        }
      }
      return null;
    };

    const node = findNode(rootNodes);
    if (!node) return [];
    return getGeometryLeafIdsFromNode(node);
  }, [selectedEntity?.objectId, modelFileName, worldTreeVersion, getViewerRef]);

  // ── Derived state ──
  const isHidden = geometryLeafIds.length > 0 && (
    isAcousticMode
      ? geometryLeafIds.every((id) => acousticExplorerHiddenIds.includes(id))
      : filtering.areObjectsHidden(geometryLeafIds)
  );
  const isIsolated = geometryLeafIds.length > 0 && filtering.areObjectsIsolated(geometryLeafIds);

  // ── Handlers (same logic as ObjectExplorer) ──
  const handleToggleVisibility = useCallback(() => {
    if (geometryLeafIds.length === 0) return;

    if (isAcousticMode) {
      const allHidden = geometryLeafIds.every((id) => acousticExplorerHiddenIds.includes(id));
      geometryLeafIds.forEach((id) => {
        if (allHidden) {
          removeAcousticExplorerHiddenId(id);
        } else {
          addAcousticExplorerHiddenId(id);
        }
      });
      applyAcousticExplorerHiddenIsolation();
    } else {
      const currentlyHidden = filtering.areObjectsHidden(geometryLeafIds);
      if (currentlyHidden) {
        filtering.showObjects(geometryLeafIds);
      } else {
        filtering.hideObjects(geometryLeafIds);
      }
    }
  }, [geometryLeafIds, isAcousticMode, acousticExplorerHiddenIds,
      addAcousticExplorerHiddenId, removeAcousticExplorerHiddenId,
      applyAcousticExplorerHiddenIsolation, filtering]);

  const handleToggleIsolation = useCallback(() => {
    if (geometryLeafIds.length === 0) return;

    if (isIsolated) {
      filtering.unIsolateObjects(geometryLeafIds);
    } else {
      filtering.isolateObjects(geometryLeafIds);
    }
  }, [geometryLeafIds, isIsolated, filtering]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onOpenExplorer?.()}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-secondary-hover)',
              fontSize: '18px',
              lineHeight: 1,
              padding: '2px 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Object Explorer"
            aria-label="Open Object Explorer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Hide/Isolate buttons — same as ObjectExplorer */}
          {geometryLeafIds.length > 0 && (
            <>
              <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--color-secondary-light)', margin: '0 2px' }} />

              {/* Hide/Show button */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={handleToggleVisibility}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: isHidden ? 'var(--color-primary)' : 'var(--color-secondary-hover)',
                  padding: '2px 4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={isHidden ? 'Show' : 'Hide'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="none">
                  <path
                    d="M12 5c-7.633 0-9.927 6.617-9.948 6.684L1.946 12l.105.316C2.073 12.383 4.367 19 12 19s9.927-6.617 9.948-6.684l.106-.316-.105-.316C21.927 11.617 19.633 5 12 5zm0 11c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4z"
                    fill="currentColor"
                  />
                  <circle cx="12" cy="12" r="2" fill="currentColor" />
                </svg>
              </button>

              {/* Isolate button — hidden in acoustic mode */}
              {!hideIsolateButton && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={handleToggleIsolation}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: isIsolated ? 'var(--color-primary)' : 'var(--color-secondary-hover)',
                    padding: '2px 4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title={isIsolated ? 'Un-isolate' : 'Isolate'}
                >
                  {isIsolated ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="none">
                      <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" opacity="0.3" />
                      <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="8" y="8" width="8" height="8" rx="1" />
                    </svg>
                  )}
                </button>
              )}
            </>
          )}

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

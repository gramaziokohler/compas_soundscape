import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ContextMenuHit } from '@/lib/three/speckle-event-bridge';

/** Pointer travel (px) beyond which a right-press is an orbit, not a click. */
const DRAG_THRESHOLD_PX = 4;

export interface SceneContextMenuState {
  x: number;
  y: number;
  hit: ContextMenuHit;
}

/**
 * Right-click on the viewer: selects the object under the cursor (Speckle mesh,
 * sound sphere or listener — same as a left click) and opens the context menu
 * on it. Ignored after a right-drag (orbit) and in first-person mode; the
 * browser menu is always suppressed over the canvas.
 */
export function useSceneContextMenu(containerRef: RefObject<HTMLDivElement | null>) {
  const [menu, setMenu] = useState<SceneContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Track the gesture locally: during init more than one event bridge can
    // exist, so the coordinator's `wasOrbiting` flag may read stale.
    let downPos: { x: number; y: number } | null = null;
    let dragged = false;

    const handlePointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
      dragged = false;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!downPos) return;
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) dragged = true;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const { coordinator, isFirstPersonMode } = useSpeckleEngineStore.getState();
      if (isFirstPersonMode || dragged) return;

      const hit = coordinator?.getEventBridge()?.selectForContextMenu(e.clientX, e.clientY) ?? null;
      setMenu(hit ? { x: e.clientX, y: e.clientY, hit } : null);
    };

    container.addEventListener('pointerdown', handlePointerDown, true);
    container.addEventListener('pointermove', handlePointerMove, true);
    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, true);
      container.removeEventListener('pointermove', handlePointerMove, true);
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [containerRef]);

  return { menu, closeMenu };
}

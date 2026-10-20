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
 *
 * `contextmenu` timing is platform-dependent: Windows fires it after
 * `pointerup` (the drag is already known), macOS / Linux fire it on press,
 * before any movement. When it arrives while the button is still held, the
 * menu is deferred to the release so a right-drag orbit never opens it.
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
    let pressed = false;
    // `contextmenu` arrived mid-press (macOS order) — open on release.
    let pendingMenu = false;

    const tryOpenMenu = (x: number, y: number) => {
      const { coordinator, isFirstPersonMode } = useSpeckleEngineStore.getState();
      if (isFirstPersonMode || dragged) return;

      const hit = coordinator?.getEventBridge()?.selectForContextMenu(x, y) ?? null;
      setMenu(hit ? { x, y, hit } : null);
    };

    const handlePointerDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
      dragged = false;
      pressed = true;
      pendingMenu = false;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!downPos) return;
      const dx = e.clientX - downPos.x;
      const dy = e.clientY - downPos.y;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) dragged = true;
    };

    // Window + capture: fires even when released off the container, and before
    // Speckle's canvas pointerup emits ObjectClicked — so selectForContextMenu
    // has set the bridge's contextMenuSelection by the time it is re-asserted.
    const handlePointerUp = (e: PointerEvent) => {
      pressed = false;
      if (!pendingMenu) return;
      pendingMenu = false;
      tryOpenMenu(e.clientX, e.clientY);
    };

    const handlePointerCancel = () => {
      pressed = false;
      pendingMenu = false;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (pressed) {
        pendingMenu = true;
        return;
      }
      tryOpenMenu(e.clientX, e.clientY);
    };

    container.addEventListener('pointerdown', handlePointerDown, true);
    container.addEventListener('pointermove', handlePointerMove, true);
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown, true);
      container.removeEventListener('pointermove', handlePointerMove, true);
      container.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [containerRef]);

  return { menu, closeMenu };
}

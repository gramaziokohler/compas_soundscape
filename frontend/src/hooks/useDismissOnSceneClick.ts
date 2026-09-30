import { useEffect, useRef } from 'react';
import { useAreaDrawingStore, useSpeckleStore, useUIStore } from '@/store';
import { SIMPLE_MODE } from '@/utils/constants';

/** Viewer container — only clicks inside it count as "outside the panel". */
const SCENE_CONTAINER_SELECTOR = '#speckle-scene-container';
/** Let the viewer / cards react to the click before deciding it was a "background" click. */
const SETTLE_DELAY_MS = 120;

interface SelectionSnapshot {
  objectIds: string[];
  entity: unknown;
  soundCard: number | null;
}

function snapshot(): SelectionSnapshot {
  const speckle = useSpeckleStore.getState();
  return {
    objectIds: speckle.selectedObjectIds,
    entity: speckle.selectedEntity,
    soundCard: useUIStore.getState().expandedSoundCardIndex,
  };
}

/** True when the click picked something (an object, an entity, a sound sphere). */
function clickSelectedSomething(before: SelectionSnapshot, after: SelectionSnapshot): boolean {
  const pickedObject = after.objectIds.length > 0 && after.objectIds !== before.objectIds;
  const pickedEntity = !!after.entity && after.entity !== before.entity;
  const pickedSound = after.soundCard !== null && after.soundCard !== before.soundCard;
  return pickedObject || pickedEntity || pickedSound;
}

/** Viewer interaction modes during which a 3D click belongs to the open card. */
function viewerModeActive(): boolean {
  return useAreaDrawingStore.getState().isDrawing || useUIStore.getState().acousticLayerSelectionMode;
}

/**
 * Reduce a Simple-mode panel when the user clicks the 3D scene around it.
 *
 * Only a plain click on the viewer counts — never a camera drag, never a click
 * on UI (menus, the bottom bar, other panels), never while a viewer interaction
 * mode is active, and never when the click selected something (object, entity
 * or sound sphere), since that click was meant for the open card.
 *
 * Usage:
 * ```tsx
 * useDismissOnSceneClick(() => setPanel(null), panel !== null, () => isLinkingEntity);
 * ```
 */
export function useDismissOnSceneClick(onDismiss: () => void, enabled: boolean, isBusy?: () => boolean): void {
  const onDismissRef = useRef(onDismiss);
  const isBusyRef = useRef(isBusy);
  onDismissRef.current = onDismiss;
  isBusyRef.current = isBusy;

  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; before: SelectionSnapshot } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      start =
        e.button === 0 && target?.closest?.(SCENE_CONTAINER_SELECTOR)
          ? { x: e.clientX, y: e.clientY, before: snapshot() }
          : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const { x, y, before } = start;
      start = null;
      if (Math.hypot(e.clientX - x, e.clientY - y) > SIMPLE_MODE.DISMISS_DRAG_TOLERANCE) return;
      if (viewerModeActive() || isBusyRef.current?.()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!clickSelectedSomething(before, snapshot())) onDismissRef.current();
      }, SETTLE_DELAY_MS);
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);
}

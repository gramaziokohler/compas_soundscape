'use client';

import { useCallback, useEffect } from 'react';
import { useSceneWorkflowStore } from '@/store/sceneWorkflowStore';
import { SIMPLE_MODE } from '@/utils/constants';

export interface BubbleFrontLayer {
  /** z-index for the floating card host: in front of the docked DAW when it was clicked last. */
  zIndex: number;
  /** Attach to the card host — a click anywhere in it (portaled popups included) brings it to the front. */
  onPointerDownCapture: () => void;
}

/**
 * Simple-mode stacking between the floating bubble cards and the docked DAW:
 * whichever was clicked last is drawn on top (the DAW sets `'daw'` on its own
 * pointerdown). A card that opens — `openKey` changes to a non-null value —
 * comes to the front so it is never born hidden.
 *
 * Usage:
 * ```tsx
 * const front = useBubbleFrontLayer(openIndex);
 * <div onPointerDownCapture={front.onPointerDownCapture} style={{ zIndex: front.zIndex }}>…</div>
 * ```
 */
export function useBubbleFrontLayer(openKey: string | number | null): BubbleFrontLayer {
  const inFront = useSceneWorkflowStore((s) => s.simpleFrontLayer === 'panel');
  const raise = useCallback(() => useSceneWorkflowStore.getState().setSimpleFrontLayer('panel'), []);

  useEffect(() => {
    if (openKey !== null) raise();
  }, [openKey, raise]);

  return {
    zIndex: inFront ? SIMPLE_MODE.PANEL_RAISED_Z_INDEX : SIMPLE_MODE.Z_INDEX,
    onPointerDownCapture: raise,
  };
}

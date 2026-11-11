/**
 * Click-to-type for the gizmo's translate arrows.
 *
 * A quick click (no drag, no hold — see ClickGesture) on an X / Y / Z arrow of a
 * TransformControls gizmo restores the object to where the press started and
 * opens a numeric prompt "Move X [ ] m"; Enter moves it by that distance along
 * the world axis. Plane handles and the center handle open nothing.
 *
 * Usage:
 * ```ts
 * const detach = attachTranslateClickPrompt(transformControls, (axis, distance, origin) => moveTo(origin + axis * distance));
 * detach();
 * ```
 */

import * as THREE from 'three';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GUMBALL } from '@/utils/constants';
import { ClickGesture } from './gumball-click-gesture';
import { openGumballNumericPrompt } from './gumball-numeric-prompt';
import { isGumballAxis, type GumballAxis } from './gumball-rotation-arcs';

/**
 * Called with the clicked axis, the distance (m; 0 = restore after the click) and
 * the gizmo anchor position at the start of the press.
 */
export type TranslateApply = (axis: GumballAxis, distance: number, origin: THREE.Vector3) => void;

export function attachTranslateClickPrompt(tc: TransformControls, apply: TranslateApply): () => void {
  const gesture = new ClickGesture();
  let lastUp: { click: boolean; x: number; y: number } | null = null;
  let pressAxis: GumballAxis | null = null;
  let origin: THREE.Vector3 | null = null;

  // Window capture runs before TransformControls' own canvas listeners.
  const onWindowDown = (e: PointerEvent) => {
    if (e.button === 0) gesture.begin(e);
  };
  const onWindowUp = (e: PointerEvent) => {
    if (e.button === 0) lastUp = { click: gesture.end(e), x: e.clientX, y: e.clientY };
  };

  const onMouseDown = () => {
    pressAxis = isGumballAxis(tc.axis) && tc.mode === 'translate' ? tc.axis : null;
    origin = tc.object ? tc.object.position.clone() : null;
  };

  const onMouseUp = () => {
    const axis = pressAxis;
    const start = origin;
    const up = lastUp;
    pressAxis = null;
    origin = null;
    lastUp = null;
    if (!axis || !start || !up?.click) return;
    // Undo the sub-threshold jitter of the click so the typed move is exact.
    if (tc.object && tc.object.position.distanceToSquared(start) > 1e-12) apply(axis, 0, start);
    setTimeout(() => {
      openGumballNumericPrompt({
        clientX: up.x,
        clientY: up.y,
        label: `Move ${axis}`,
        unit: GUMBALL.DISTANCE_UNIT,
        onSubmit: (distance) => apply(axis, distance, start),
      });
    }, 0);
  };

  window.addEventListener('pointerdown', onWindowDown, true);
  window.addEventListener('pointerup', onWindowUp, true);
  tc.addEventListener('mouseDown', onMouseDown);
  tc.addEventListener('mouseUp', onMouseUp);

  return () => {
    window.removeEventListener('pointerdown', onWindowDown, true);
    window.removeEventListener('pointerup', onWindowUp, true);
    tc.removeEventListener('mouseDown', onMouseDown);
    tc.removeEventListener('mouseUp', onMouseUp);
  };
}

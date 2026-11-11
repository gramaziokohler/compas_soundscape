/**
 * ClickGesture
 *
 * Tells a quick click on a gumball handle apart from a drag or a held press:
 * a press counts as a click only when it is released within GUMBALL.CLICK_MAX_MS
 * and moved less than GUMBALL.CLICK_MAX_MOVE_PX. Holding the button down (even
 * without moving) is not a click, so it never opens the numeric prompt.
 *
 * Usage:
 * ```ts
 * const gesture = new ClickGesture();
 * onPointerDown = (e) => gesture.begin(e);
 * onPointerUp = (e) => { if (gesture.end(e)) openPrompt(); };
 * ```
 */

import { GUMBALL } from '@/utils/constants';

interface PointerLike {
  clientX: number;
  clientY: number;
}

export class ClickGesture {
  private down: { x: number; y: number; t: number } | null = null;

  /** Start tracking a press. */
  begin(e: PointerLike): void {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  /** Finish the press; true when it was a quick, in-place click. Consumes the gesture. */
  end(e: PointerLike): boolean {
    const down = this.down;
    this.down = null;
    if (!down) return false;
    const elapsed = performance.now() - down.t;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    const maxMove = GUMBALL.CLICK_MAX_MOVE_PX;
    return elapsed <= GUMBALL.CLICK_MAX_MS && dx * dx + dy * dy <= maxMove * maxMove;
  }

  cancel(): void {
    this.down = null;
  }
}

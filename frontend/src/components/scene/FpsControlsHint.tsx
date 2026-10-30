'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { MouseIcon } from '@/components/ui/MouseIcon';
import { useOneTimeHint } from '@/hooks/useOneTimeHint';
import { useUIStore } from '@/store';
import { FPS_CONTROLS_HINT, SCENE_BOTTOM_BAR } from '@/utils/constants';

/** The red "Leave FPS view" bubble icon, drawn inline as a legend. */
function ExitIcon() {
  const size = FPS_CONTROLS_HINT.EXIT_ICON_SIZE;
  return (
    <span className="bubble bubble--exit" style={{ width: size, height: size, display: 'inline-flex' }} aria-label="Leave FPS view button">
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    </span>
  );
}

/**
 * Shrink `el` into the "Leave FPS view" button, then call `onDone`. Falls back
 * to calling `onDone` at once when the button is missing or motion is reduced.
 */
function shrinkIntoExitButton(el: HTMLElement, onDone: () => void): Animation | null {
  const target = document.getElementById(FPS_CONTROLS_HINT.EXIT_BUTTON_ID);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!target || reduceMotion || typeof el.animate !== 'function') {
    onDone();
    return null;
  }
  const from = el.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  // `translateX(-50%)` is the strip's own horizontal centering (globals.css).
  const animation = el.animate(
    [
      { transform: 'translateX(-50%) translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translateX(-50%) translate(${dx}px, ${dy}px) scale(${FPS_CONTROLS_HINT.CLOSE_END_SCALE})`, opacity: 0 },
    ],
    { duration: FPS_CONTROLS_HINT.CLOSE_ANIMATION_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  );
  animation.onfinish = onDone;
  return animation;
}

/**
 * FpsControlsHint Component
 *
 * Share view: while the viewer is locked in a listener's first-person view, a
 * centred strip just above the scene bottom bar (and the docked DAW) lists the
 * FPS controls and how to leave. It shows on each FPS entry until the visitor
 * closes it (×): it then shrinks into the "Leave FPS view" button — where the
 * controls stay reachable — and never shows again (useOneTimeHint).
 *
 * Usage:
 * ```tsx
 * {isFirstPersonMode && !canEdit && <FpsControlsHint />}
 * ```
 */
export function FpsControlsHint() {
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  const { seen, markSeen } = useOneTimeHint(FPS_CONTROLS_HINT.HINT_ID);
  const rootRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  // Leaving FPS mid-animation unmounts the strip: still count it as closed.
  const closingRef = useRef(false);
  const markSeenRef = useRef(markSeen);
  markSeenRef.current = markSeen;
  useEffect(() => () => {
    if (closingRef.current) markSeenRef.current();
  }, []);

  if (seen) return null;

  const handleClose = () => {
    if (closing || !rootRef.current) return;
    closingRef.current = true;
    setClosing(true);
    shrinkIntoExitButton(rootRef.current, markSeen);
  };

  const iconSize = FPS_CONTROLS_HINT.MOUSE_ICON_SIZE;
  return (
    <div
      ref={rootRef}
      className="fps-controls-hint backdrop-blur-lg backdrop-saturate-150"
      role="status"
      style={{
        bottom: SCENE_BOTTOM_BAR.HEIGHT + FPS_CONTROLS_HINT.GAP + dockLift,
        zIndex: FPS_CONTROLS_HINT.Z_INDEX,
        pointerEvents: closing ? 'none' : undefined,
      }}
    >
      <span className="fps-controls-hint__title">{FPS_CONTROLS_HINT.TITLE}</span>
      <span>{FPS_CONTROLS_HINT.LOCKED}</span>
      <span className="fps-controls-hint__item">
        Look around <MouseIcon control="left" size={iconSize} /> or
        <span className="kbd-group">
          {FPS_CONTROLS_HINT.ARROW_KEYS.map((key) => <kbd key={key} className="kbd">{key}</kbd>)}
        </span>
      </span>
      <span className="fps-controls-hint__item">
        Roll <MouseIcon control="right" size={iconSize} />
      </span>
      <span className="fps-controls-hint__item">
        Zoom <MouseIcon control="wheel" size={iconSize} />
      </span>
      <span className="fps-controls-hint__item">
        Leave <kbd className="kbd">Esc</kbd> or <ExitIcon />
      </span>
      <button
        type="button"
        className="bar-hint__close"
        onClick={handleClose}
        title={FPS_CONTROLS_HINT.CLOSE_LABEL}
        aria-label={FPS_CONTROLS_HINT.CLOSE_LABEL}
      >
        <Icon size="12px">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </Icon>
      </button>
    </div>
  );
}

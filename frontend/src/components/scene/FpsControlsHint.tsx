'use client';

import { MouseIcon } from '@/components/ui/MouseIcon';
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
 * FpsControlsHint Component
 *
 * Share view: while the viewer is locked in a listener's first-person view, a
 * centred strip just above the scene bottom bar (and the docked DAW) lists the
 * FPS controls and how to leave.
 *
 * Usage:
 * ```tsx
 * {isFirstPersonMode && !canEdit && <FpsControlsHint />}
 * ```
 */
export function FpsControlsHint() {
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  const iconSize = FPS_CONTROLS_HINT.MOUSE_ICON_SIZE;
  return (
    <div
      className="fps-controls-hint backdrop-blur-lg backdrop-saturate-150"
      role="status"
      style={{
        bottom: SCENE_BOTTOM_BAR.HEIGHT + FPS_CONTROLS_HINT.GAP + dockLift,
        zIndex: FPS_CONTROLS_HINT.Z_INDEX,
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
    </div>
  );
}

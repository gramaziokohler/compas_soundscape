'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { MouseIcon } from '@/components/ui/MouseIcon';
import { ShortcutKeys } from '@/components/ui/ShortcutKeys';
import { useOneTimeHint } from '@/hooks/useOneTimeHint';
import { FPS_CONTROLS, FPS_HELP_POPUP } from '@/utils/constants';

const HINT_ID = 'fps';

interface FpsHelpPopupProps {
  /** True while the viewer is in a listener's first-person view. */
  active: boolean;
  /** Element the popup sits to the left of (the FPS bubble row). */
  anchorRef: RefObject<HTMLElement | null>;
}

/**
 * First-time helper shown to the left of the FPS listener bubble the first
 * time a user enters first-person view: explains the locked position and
 * lists the FPS controls. Shown once per user (useOneTimeHint) — it is marked
 * seen as soon as it appears, and closes on × or when FPS ends.
 * Fixed-positioned from the anchor's rect so the scrolling bubble column
 * can't clip it.
 *
 * Usage:
 * ```tsx
 * <FpsHelpPopup active={isFps} anchorRef={rowRef} />
 * ```
 */
export function FpsHelpPopup({ active, anchorRef }: FpsHelpPopupProps) {
  const { seen, markSeen } = useOneTimeHint(HINT_ID);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; centerY: number } | null>(null);

  // Show on the first FPS entry; mark seen immediately so it never returns.
  useEffect(() => {
    if (active && !seen) {
      setVisible(true);
      markSeen();
    }
  }, [active, seen, markSeen]);

  useEffect(() => {
    if (!active) setVisible(false);
  }, [active]);

  useLayoutEffect(() => {
    if (!visible) return;
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ left: rect.left, centerY: rect.top + rect.height / 2 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [visible, anchorRef]);

  if (!visible || !anchor) return null;

  return (
    <div
      className="bar-hint fps-hint"
      role="dialog"
      aria-label="First-person view controls"
      style={{
        left: anchor.left - FPS_HELP_POPUP.GAP - FPS_HELP_POPUP.WIDTH,
        top: anchor.centerY,
        width: FPS_HELP_POPUP.WIDTH,
        zIndex: FPS_HELP_POPUP.Z_INDEX,
      }}
    >
      <div className="bar-hint__body">
        <p className="bar-hint__title">You&apos;re in first-person view (FPS)</p>
        <p className="bar-hint__message">Your position is locked. Controls:</p>
        <div className="fps-hint__controls">
          {FPS_CONTROLS.map((row) => (
            <div key={row.label} className="bar-shortcut-row">
              <span className="bar-shortcut-row__label">{row.label}</span>
              <span className="fps-hint__keys">
                {row.mouse && <MouseIcon control={row.mouse} size={FPS_HELP_POPUP.MOUSE_ICON_SIZE} />}
                <ShortcutKeys keys={row.keys} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <button type="button" className="bar-hint__close" onClick={() => setVisible(false)} title="Close" aria-label="Close FPS help">
        <Icon size="12px">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </Icon>
      </button>
    </div>
  );
}

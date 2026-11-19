'use client';

import type { CSSProperties, MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, Power } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { AnchorRect } from '@/hooks/useAnchorRect';
import { useShareTutorial, type ShareTutorialPlacement } from '@/hooks/useShareTutorial';
import { SHARE_TUTORIAL } from '@/utils/constants';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Fixed position of the tip beside its anchor, kept inside the viewport. */
function tipStyle(placement: ShareTutorialPlacement, rect: AnchorRect): CSSProperties {
  const { GAP, WIDTH, VIEWPORT_MARGIN, Z_INDEX } = SHARE_TUTORIAL;
  const maxLeft = window.innerWidth - WIDTH - VIEWPORT_MARGIN;
  if (placement === 'above' || placement === 'below') {
    const centerX = rect.left + rect.width / 2;
    const left = clamp(centerX - WIDTH / 2, VIEWPORT_MARGIN, maxLeft);
    return {
      left,
      bottom: placement === 'above' ? window.innerHeight - rect.top + GAP : undefined,
      top: placement === 'below' ? rect.bottom + GAP : undefined,
      width: WIDTH,
      zIndex: Z_INDEX,
      // Arrow toward the anchor even when the tip is clamped sideways.
      '--share-tutorial-arrow-x': `${centerX - left}px`,
    } as CSSProperties;
  }
  const left = placement === 'right' ? rect.right + GAP : rect.left - GAP - WIDTH;
  return {
    left: clamp(left, VIEWPORT_MARGIN, maxLeft),
    top: rect.top + rect.height / 2,
    width: WIDTH,
    zIndex: Z_INDEX,
  };
}

/**
 * ShareTutorial Component
 *
 * Share view: the first-load mini tutorial for visitors who never used the app.
 * One numbered tip at a time, pinned beside what it explains — a scene circle
 * (turn it on), the Play button, the Acoustics column, the Listeners column,
 * the view-mode toolbar.
 * A tip stays until the visitor acts: a click on it or the › arrow moves on,
 * ‹ goes back, × skips the tour (see useShareTutorial). While the visitor hovers the column a tip points at,
 * the tip fades out of the way of the bubbles' hover flyouts (globals.css).
 *
 * Usage (page.tsx):
 * ```tsx
 * {isShareView && <ShareTutorial />}
 * ```
 */
export function ShareTutorial() {
  const { step, number, anchorRect, hasPrev, isLast, next, prev, skip } = useShareTutorial();
  if (!step || !anchorRect) return null;

  const copy = SHARE_TUTORIAL.STEPS[step.id];
  /** Tip buttons act on their own — the tip's click (next) must not fire too. */
  const own = (action: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    action();
  };
  const nextLabel = isLast ? SHARE_TUTORIAL.FINISH_LABEL : SHARE_TUTORIAL.NEXT_LABEL;

  return (
    <div
      key={step.id}
      className={`share-tutorial-tip share-tutorial-tip--${step.placement} backdrop-blur-lg backdrop-saturate-150`}
      data-step={step.id}
      role="status"
      aria-live="polite"
      style={tipStyle(step.placement, anchorRect)}
      onClick={next}
    >
      <span className="share-tutorial-tip__badge" aria-hidden="true">{number}</span>
      <div className="share-tutorial-tip__body">
        <p className="share-tutorial-tip__title">{copy.title}</p>
        <p className="share-tutorial-tip__message">
          {copy.message}
          {'afterIcon' in copy && (
            <>
              {' '}
              <span className="share-tutorial-tip__power" role="img" aria-label="power">
                <Power size={SHARE_TUTORIAL.POWER_ICON_SIZE} strokeWidth={2.4} aria-hidden="true" />
              </span>
              {copy.afterIcon}
            </>
          )}
        </p>
        <div className="share-tutorial-tip__nav">
          <button
            type="button"
            className="share-tutorial-tip__arrow"
            onClick={own(prev)}
            disabled={!hasPrev}
            title={SHARE_TUTORIAL.PREV_LABEL}
            aria-label={SHARE_TUTORIAL.PREV_LABEL}
          >
            <ChevronLeft size={SHARE_TUTORIAL.ARROW_ICON_SIZE} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="share-tutorial-tip__arrow"
            onClick={own(next)}
            title={nextLabel}
            aria-label={nextLabel}
          >
            <ChevronRight size={SHARE_TUTORIAL.ARROW_ICON_SIZE} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="bar-hint__close"
        onClick={own(skip)}
        title={SHARE_TUTORIAL.SKIP_LABEL}
        aria-label={SHARE_TUTORIAL.SKIP_LABEL}
      >
        <Icon size="12px">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </Icon>
      </button>
    </div>
  );
}

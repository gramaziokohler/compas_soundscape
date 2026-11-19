'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Power } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { AnchorRect } from '@/hooks/useAnchorRect';
import { useShareTutorial, type ShareTutorialPlacement, type ShareTutorialStep } from '@/hooks/useShareTutorial';
import { SHARE_TUTORIAL, SHARE_VIEW } from '@/utils/constants';

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

interface ShownTip {
  step: ShareTutorialStep;
  number: number;
  anchorRect: AnchorRect;
}

interface TipCardProps extends ShownTip {
  hasPrev: boolean;
  isLast: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  onSkip?: () => void;
}

/** The tip's markup. Only its buttons act: a click elsewhere on it does nothing. */
function TipCard({ step, number, anchorRect, hasPrev, isLast, onNext, onPrev, onSkip }: TipCardProps) {
  const copy = SHARE_TUTORIAL.STEPS[step.id];
  const nextLabel = isLast ? SHARE_TUTORIAL.FINISH_LABEL : SHARE_TUTORIAL.NEXT_LABEL;
  return (
    <div
      className={`share-tutorial-tip share-tutorial-tip--${step.placement} backdrop-blur-lg backdrop-saturate-150`}
      data-step={step.id}
      role="status"
      aria-live="polite"
      style={tipStyle(step.placement, anchorRect)}
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
            onClick={onPrev}
            disabled={!hasPrev}
            title={SHARE_TUTORIAL.PREV_LABEL}
            aria-label={SHARE_TUTORIAL.PREV_LABEL}
          >
            <ChevronLeft size={SHARE_TUTORIAL.ARROW_ICON_SIZE} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="share-tutorial-tip__arrow"
            onClick={onNext}
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
        onClick={onSkip}
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

/**
 * The tip that was just hidden, shrinking and sliding into the bottom bar's
 * Tour button (where it can be shown again). Removed when the animation ends.
 */
function ClosingTip({ tip, onDone }: { tip: ShownTip; onDone: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const card = wrap?.firstElementChild;
    const target = document.getElementById(SHARE_VIEW.TOUR_BUTTON_ID);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!wrap || !card || !target || reducedMotion) {
      onDone();
      return;
    }
    const from = card.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const dx = to.left + to.width / 2 - fromX;
    const dy = to.top + to.height / 2 - fromY;
    wrap.style.transformOrigin = `${fromX}px ${fromY}px`;
    const animation = wrap.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(${SHARE_TUTORIAL.CLOSE_SCALE})`, opacity: 0 },
      ],
      { duration: SHARE_TUTORIAL.CLOSE_ANIMATION_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    );
    animation.onfinish = onDone;
    return () => animation.cancel();
  }, [onDone]);

  return (
    <div ref={wrapRef} className="share-tutorial-closing" aria-hidden="true">
      <TipCard {...tip} hasPrev={false} isLast={false} />
    </div>
  );
}

export interface ShareTutorialProps {
  /** Powered listener (single or grid listener id), or null: the Listeners step moves on when it changes. */
  activeListenerId: string | null;
}

/**
 * ShareTutorial Component
 *
 * Share view: the first-load mini tutorial for visitors who never used the app.
 * One numbered tip at a time, pinned beside what it explains: a scene circle
 * (turn it on), the Play button, the Acoustics column, the Listeners column,
 * the view-mode toolbar.
 * A tip stays until the visitor does what it asks or uses its buttons: › moves
 * on, ‹ goes back, × hides the tour at its step (the bottom bar's Tour button
 * shows it again; see useShareTutorial). A click elsewhere on the tip does
 * nothing. Hiding shrinks the tip into the Tour button. While the visitor
 * hovers the column a tip points at, the tip fades out of the way of the
 * bubbles' hover flyouts (globals.css).
 *
 * Usage (page.tsx):
 * ```tsx
 * {isShareView && <ShareTutorial activeListenerId={shareActiveListenerId} />}
 * ```
 */
export function ShareTutorial({ activeListenerId }: ShareTutorialProps) {
  const { step, number, anchorRect, hasPrev, isLast, next, prev, skip, closeNonce } = useShareTutorial({ activeListenerId });
  const lastShownRef = useRef<ShownTip | null>(null);
  const [closing, setClosing] = useState<{ tip: ShownTip; nonce: number } | null>(null);
  const [clearClosing] = useState(() => () => setClosing(null));

  // Remember the tip on screen, so the close animation can replay it.
  useLayoutEffect(() => {
    if (step && anchorRect) lastShownRef.current = { step, number, anchorRect };
  }, [step, number, anchorRect]);

  // Hidden: animate the last tip into the Tour button (before paint, no flicker).
  useLayoutEffect(() => {
    if (closeNonce === 0 || !lastShownRef.current) return;
    setClosing({ tip: lastShownRef.current, nonce: closeNonce });
    lastShownRef.current = null;
  }, [closeNonce]);

  return (
    <>
      {closing && <ClosingTip key={closing.nonce} tip={closing.tip} onDone={clearClosing} />}
      {step && anchorRect && (
        <TipCard
          key={step.id}
          step={step}
          number={number}
          anchorRect={anchorRect}
          hasPrev={hasPrev}
          isLast={isLast}
          onNext={next}
          onPrev={prev}
          onSkip={skip}
        />
      )}
    </>
  );
}

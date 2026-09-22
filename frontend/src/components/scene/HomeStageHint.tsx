'use client';

import React, { useRef, useState } from 'react';

interface HomeStageHintProps {
  /** True while a file is dragged over the window — swaps the message. */
  isDragOver: boolean;
  /** Opens the centered Speckle model browser pop-up. */
  onOpenSpeckle: () => void;
  /** DOM id of the control button the hint shrinks toward when dismissed. */
  targetButtonId?: string;
  /** Called after the shrink animation completes. */
  onDismiss?: () => void;
}

/**
 * HomeStageHint
 *
 * The single evident affordance on the Home empty stage. Tells the user how to
 * begin and reacts to a full-window drag-over. A close button appears on hover;
 * dismissing it shrinks the pill toward the "Load a Speckle model" control
 * button, which remains as the persistent affordance.
 *
 * Usage:
 * ```tsx
 * <HomeStageHint isDragOver={isDragOver} onOpenSpeckle={() => setShowBrowser(true)} />
 * ```
 */
export function HomeStageHint({
  isDragOver,
  onOpenSpeckle,
  targetButtonId,
  onDismiss,
}: HomeStageHintProps) {
  const pillRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [transform, setTransform] = useState<string | undefined>(undefined);

  const handleClose = () => {
    if (closing) return;
    const pill = pillRef.current;
    let nextTransform: string | undefined;
    if (pill) {
      const rect = pill.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let tx = 0;
      let ty = 0;
      const target = targetButtonId ? document.getElementById(targetButtonId) : null;
      if (target) {
        const tr = target.getBoundingClientRect();
        tx = tr.left + tr.width / 2 - cx;
        ty = tr.top + tr.height / 2 - cy;
      }
      nextTransform = `translate(${tx}px, ${ty}px) scale(0.08)`;
    }
    setTransform(nextTransform);
    setClosing(true);
    window.setTimeout(() => onDismiss?.(), 1000);
  };

  return (
    <div
      className="absolute pointer-events-none z-20 flex justify-center"
      style={{ left: 0, right: 0, bottom: '9%' }}
    >
      <div
        ref={pillRef}
        className="group pointer-events-auto relative frosted-surface backdrop-blur-lg backdrop-saturate-150 rounded-full px-4 py-2 text-center"
        style={{
          border: '1px solid var(--color-overlay-border)',
          background: 'var(--color-overlay-bg)',
          boxShadow: 'var(--shadow-md)',
          transform,
          opacity: closing ? 0 : 1,
          transformOrigin: 'center center',
          transition: 'transform 950ms cubic-bezier(0.4, 0, 0.2, 1), opacity 950ms ease-in',
        }}
      >
        {isDragOver ? (
          <span className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
            Drop to load your model.
          </span>
        ) : (
          <span className="text-xs text-secondary-hover">
            Drop a model here, upload it from{' '}
            <button
              type="button"
              onClick={onOpenSpeckle}
              className="underline font-medium bg-transparent border-0 p-0 cursor-pointer"
              style={{ color: 'var(--color-primary)' }}
            >
              Speckle
            </button>{' '}
            or click the sphere to begin.
          </span>
        )}

        <button
          type="button"
          onClick={handleClose}
          title="Dismiss"
          className="absolute flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--color-secondary-light)',
            color: 'var(--color-secondary-hover)',
            border: '1px solid var(--color-overlay-border)',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

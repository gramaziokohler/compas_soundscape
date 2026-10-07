'use client';

import { useCallback, useRef } from 'react';
import type React from 'react';

/**
 * Backdrop props that close a modal only on a genuine backdrop click.
 *
 * A plain `onClick={onClose}` on the backdrop also fires when a drag starts
 * inside the dialog (e.g. selecting text in an input) and the mouse is released
 * on the backdrop or outside the window. Here the press must both start and end
 * on the backdrop itself.
 *
 * Usage:
 * ```tsx
 * const backdropProps = useBackdropDismiss(onClose);
 * <div className="backdrop" {...backdropProps}>...</div>
 * ```
 */
export function useBackdropDismiss(onClose: () => void) {
  const pressStartedOnBackdropRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    pressStartedOnBackdropRef.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const startedOnBackdrop = pressStartedOnBackdropRef.current;
      pressStartedOnBackdropRef.current = false;
      if (startedOnBackdrop && e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return { onMouseDown, onClick };
}

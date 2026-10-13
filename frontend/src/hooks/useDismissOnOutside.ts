import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on a pointer-down outside `ref` or on Escape, while `open`.
 * Pointer-down is captured so it fires before the outside target's own handlers.
 *
 * Usage:
 * ```tsx
 * const rootRef = useRef<HTMLDivElement>(null);
 * useDismissOnOutside(rootRef, open, () => setOpen(false));
 * ```
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

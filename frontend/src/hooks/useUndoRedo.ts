import { useEffect } from 'react';
import { globalUndo, globalRedo } from '@/store';

/**
 * Mounts global Ctrl+Z / Ctrl+Y (and Cmd+Z / Cmd+Shift+Z on macOS) keyboard
 * shortcuts that undo/redo the most recent action across ALL registered zundo
 * stores in chronological order.
 *
 * Mount once at the root of the app (page.tsx).
 * Skipped when focus is inside an <input>, <textarea>, or contenteditable element.
 */
export function useUndoRedo(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      // Don't intercept while the user is typing
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return;

      if (e.key === 'z') {
        e.preventDefault();
        globalUndo();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        // Ctrl+Y  (Windows)  or  Cmd+Shift+Z  (macOS)
        e.preventDefault();
        globalRedo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

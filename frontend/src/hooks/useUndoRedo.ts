import { useEffect } from 'react';
import { globalUndo, globalRedo, installUndoInteractionTracking } from '@/store';
import { hasModKey, isTypingTarget } from '@/lib/shortcuts/keyboard-utils';
import { isShareViewActive } from '@/store/shareViewStore';

/**
 * Mounts global Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (Cmd on macOS) keyboard
 * shortcuts that undo/redo the most recent action across ALL registered zundo
 * stores in chronological order.
 *
 * Also installs interaction tracking: every pointer press and every text-field
 * edit records as ONE undo step (see installUndoInteractionTracking).
 *
 * Mount once at the root of the app (page.tsx).
 * Skipped when focus is inside a text field or contenteditable element.
 */
export function useUndoRedo(): void {
  useEffect(() => installUndoInteractionTracking(), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!hasModKey(e) || e.altKey) return;
      // Share view: nothing is editable, so there is nothing to undo.
      if (isShareViewActive()) return;

      // Don't intercept while the user is typing
      if (isTypingTarget(e.target)) return;

      // With Shift held, e.key is usually 'Z' — normalise before comparing.
      const key = e.key.toLowerCase();
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        // Ctrl+Y  (Windows)  or  Ctrl/Cmd+Shift+Z
        e.preventDefault();
        globalRedo();
      } else if (key === 'z') {
        e.preventDefault();
        globalUndo();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

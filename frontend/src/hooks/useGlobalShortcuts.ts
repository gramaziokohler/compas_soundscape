import { useEffect } from 'react';
import { getShortcutTarget, resolvePlaybackTarget } from '@/lib/shortcuts/shortcut-targets';
import {
  hasModKey,
  installFocusModalityTracking,
  isActivatableTarget,
  isDialogOpen,
  isKeyboardFocusedControl,
  isModalOpen,
  isTypingTarget,
} from '@/lib/shortcuts/keyboard-utils';
import { useAudioControlsStore, useSpeckleStore, useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { hideSelection } from '@/lib/three/speckle-selection-actions';

/**
 * App-wide keyboard shortcuts (definitions + labels: KEYBOARD_SHORTCUTS in
 * utils/constants.ts). Mount once in page.tsx, next to useUndoRedo.
 *
 * Owners of the actual actions (SpeckleScene, SoundGenerationSection) publish
 * them via lib/shortcuts/shortcut-targets.ts; this hook only routes keys.
 *
 * Never fires while typing in a text field or while a modal is open.
 * Ctrl+Enter is handled per-card (ui/Card.tsx), undo/redo by useUndoRedo.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isTypingTarget(e.target) || isModalOpen()) return;
      if (hasModKey(e)) return;

      // Esc is shared with many local handlers (selection phases, DAW dock, FPS…)
      // registered in arbitrary order. Defer so they run first, and only cascade
      // when none of them consumed it (preventDefault).
      // Dialog / FPS state is sampled now: by the deferred tick a popover closed
      // by this same press is already gone.
      if (e.key === 'Escape') {
        if (isDialogOpen() || useSpeckleEngineStore.getState().isFirstPersonMode) return;
        window.setTimeout(() => {
          if (!e.defaultPrevented) escapeCascade();
        }, 0);
        return;
      }

      const handled = route(e);
      if (handled) e.preventDefault();
    };

    const stopTracking = installFocusModalityTracking();
    window.addEventListener('keydown', handler);
    return () => {
      stopTracking();
      window.removeEventListener('keydown', handler);
    };
  }, []);
}

/** Dispatch one key press. Returns true when the key was consumed. */
function route(e: KeyboardEvent): boolean {
  const isFirstPerson = useSpeckleEngineStore.getState().isFirstPersonMode;

  // ── Playback ────────────────────────────────────────────────────────────
  if (e.code === 'Space' && !e.altKey) {
    // A Tab-focused button / link activates on Space natively — don't double-fire.
    if (isKeyboardFocusedControl(e.target)) return false;
    if (e.repeat) return true; // swallow auto-repeat so holding Space doesn't scroll / flicker
    const handled = e.shiftKey ? stopPlayback() : toggleBestTarget();
    // A mouse-focused button would still fire its click on Space keyup in some
    // browsers despite preventDefault — drop its focus so only playback reacts.
    if (handled && isActivatableTarget(e.target)) (e.target as HTMLElement).blur();
    return handled;
  }

  if (e.repeat) return false;

  if (e.key === 'Home' && !e.shiftKey && !e.altKey) {
    const timeline = getShortcutTarget('timeline');
    if (!timeline?.rewind || !timeline.canToggle()) return false;
    timeline.rewind();
    return true;
  }

  // Letter shortcuts — case-insensitive, no Alt (Alt+letter is used by browsers / OS).
  if (!e.altKey && e.key.length === 1) {
    const key = e.key.toLowerCase();
    if (key === 'm' && !e.shiftKey) {
      useAudioControlsStore.getState().toggleMasterMute();
      return true;
    }
    if (key === 'f' && !e.shiftKey && !isFirstPerson) {
      if (getShortcutTarget('soundCards')?.zoomToExpanded()) return true;
      const viewer = getShortcutTarget('viewer');
      if (!viewer) return false;
      viewer.frameSelection();
      return true;
    }
    if (key === 'h' && e.shiftKey && !isFirstPerson) {
      return hideSelection();
    }
    if (key === 's' && !e.shiftKey) {
      useUIStore.getState().toggleSoundsAndListenersVisible();
      return true;
    }
    if (e.key === '?') {
      const ui = useUIStore.getState();
      ui.setShortcutsOpen(!ui.shortcutsOpen);
      return true;
    }
  }

  // ── Cards ───────────────────────────────────────────────────────────────
  if (e.altKey && !e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isFirstPerson) {
    const cards = getShortcutTarget('soundCards');
    if (!cards) return false;
    cards.step(e.key === 'ArrowDown' ? 1 : -1);
    return true;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && !e.shiftKey && !e.altKey && !isFirstPerson) {
    // Backspace only when nothing is focused — it's too easy to hit by accident elsewhere.
    if (e.key === 'Backspace' && e.target !== document.body) return false;
    return getShortcutTarget('soundCards')?.removeExpanded() ?? false;
  }

  return false;
}

/** Space: expanded card preview if playable, otherwise the timeline. */
function toggleBestTarget(): boolean {
  const target = resolvePlaybackTarget();
  if (!target) return false;
  target.toggle();
  return true;
}

/** Shift+Space: stop whatever is playing (card preview and/or timeline). */
function stopPlayback(): boolean {
  const card = getShortcutTarget('cardPreview');
  const timeline = getShortcutTarget('timeline');
  card?.stop?.();
  if (timeline?.canToggle()) timeline.stop?.();
  return !!card || !!timeline?.canToggle();
}

/**
 * Esc (after dialogs/popovers and first-person mode had their turn):
 * playing preview stops → expanded card collapses → 3D selection clears.
 */
function escapeCascade(): void {
  const audio = useAudioControlsStore.getState();
  if (audio.previewingSoundId) {
    audio.stopSoundcardPreview();
    return;
  }
  if (getShortcutTarget('soundCards')?.collapse()) return;

  const speckle = useSpeckleStore.getState();
  if (speckle.selectedObjectIds.length > 0 || speckle.selectedEntity) {
    speckle.clearViewerSelection();
  }
}

/**
 * Share view: no hover / double-click interaction with model objects, and a
 * left click selects one only while the Object Explorer is open (to locate it
 * in the tree, see isModelPickingBlocked).
 *
 * Speckle's SelectionExtension binds its `ObjectClicked` (auto-select) and
 * `ObjectDoubleClicked` (zoom to object / zoom extents) handlers at construction,
 * so they cannot be overridden. Both read `_enabled` at call time, so the
 * extension is switched off only while the renderer emits those two events:
 * programmatic selection (`selectObjects`, e.g. from the Object Explorer) keeps
 * working. Sound spheres / listeners are picked by our own canvas listeners
 * (speckle-event-bridge.ts) and are unaffected.
 *
 * Usage (once, after the extensions are created):
 * ```ts
 * installShareViewPickingGuard(viewer, selectionExtension);
 * ```
 */
import { ViewerEvent } from '@speckle/viewer';
import type { Viewer, SelectionExtension } from '@speckle/viewer';
import { isShareViewActive } from '@/store/shareViewStore';
import { useUIStore } from '@/store';

/**
 * Clicking a model object does nothing in the share view, except while the
 * Object Explorer is open: then a left click selects it (and the tree reveals it).
 */
export function isModelPickingBlocked(): boolean {
  return isShareViewActive() && !useUIStore.getState().showObjectExplorer;
}

function isSuppressed(name: string): boolean {
  if (name === ViewerEvent.ObjectDoubleClicked) return isShareViewActive();
  if (name === ViewerEvent.ObjectClicked) return isModelPickingBlocked();
  return false;
}

export function installShareViewPickingGuard(viewer: Viewer, selectionExtension: SelectionExtension): void {
  const emit = viewer.emit.bind(viewer);
  viewer.emit = (name: string, ...args: unknown[]): void => {
    if (!isSuppressed(name)) {
      emit(name, ...args);
      return;
    }
    const wasEnabled = selectionExtension.enabled;
    selectionExtension.enabled = false;
    try {
      emit(name, ...args);
    } finally {
      selectionExtension.enabled = wasEnabled;
    }
  };
}

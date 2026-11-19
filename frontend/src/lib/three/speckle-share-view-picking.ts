/**
 * Share view: no hover / click / double-click interaction with model objects.
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

const SUPPRESSED_EVENTS: readonly string[] = [ViewerEvent.ObjectClicked, ViewerEvent.ObjectDoubleClicked];

export function installShareViewPickingGuard(viewer: Viewer, selectionExtension: SelectionExtension): void {
  const emit = viewer.emit.bind(viewer);
  viewer.emit = (name: string, ...args: unknown[]): void => {
    if (!isShareViewActive() || !SUPPRESSED_EVENTS.includes(name)) {
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

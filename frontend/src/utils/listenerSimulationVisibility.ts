import { useGridListenersStore, useReceiversStore } from '@/store';

/**
 * Make the given listeners (single listener ids and grid listener ids) the only
 * ones shown for simulation: they are shown, every other single / grid listener
 * is hidden. Used when a share link group with listeners is activated in the editor.
 */
export function showOnlyListenersForSimulation(listenerIds: ReadonlySet<string>): void {
  useReceiversStore.getState().showOnlyReceiversForSimulation(listenerIds);
  useGridListenersStore.getState().showOnlyGridListenersForSimulation(listenerIds);
}

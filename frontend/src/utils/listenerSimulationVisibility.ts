import { useGridListenersStore, useReceiversStore } from '@/store';

/**
 * Make one listener (single listener id or grid listener id) the only one shown
 * for simulation: it is shown, every other single / grid listener is hidden.
 * Used when a share link group with a listener is activated in the editor.
 */
export function showOnlyListenerForSimulation(listenerId: string): void {
  useReceiversStore.getState().showOnlyReceiverForSimulation(listenerId);
  useGridListenersStore.getState().showOnlyGridListenerForSimulation(listenerId);
}

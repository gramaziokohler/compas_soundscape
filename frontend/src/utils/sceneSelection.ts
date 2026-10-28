/**
 * Select which sound scene is shown/played (Simple mode owns this state while
 * the expert Sidebar is unmounted). Shared by the scene bubbles and the share
 * view's linked activation.
 */
import { useAudioControlsStore, useCardFlowStore, useUIStore } from '@/store';

export function selectSceneByIndex(usageIndex: number, contextIndex: number | null): void {
  useAudioControlsStore.getState().stopSoundcardPreview();
  useUIStore.getState().setActiveSoundParentIndex(usageIndex);
  const flow = useCardFlowStore.getState();
  flow.setActiveUsageOriginalIndex(usageIndex);
  flow.setActiveContextOriginalIndex(contextIndex);
}

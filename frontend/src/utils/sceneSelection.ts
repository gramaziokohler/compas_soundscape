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

/**
 * Turn the powered sound scene off: playback stops and, out of the Sounds step,
 * the 3D scene and the DAW show no sounds at all (a null parent *inside* the
 * step would show every scene's sounds). Shared by the scene bubbles and the
 * share view's "Reset camera view".
 */
export function deselectActiveScene(): void {
  const audio = useAudioControlsStore.getState();
  audio.stopSoundcardPreview();
  audio.stopAll();
  const ui = useUIStore.getState();
  ui.setActiveSoundParentIndex(null);
  ui.setIsInSoundsStep(false);
}

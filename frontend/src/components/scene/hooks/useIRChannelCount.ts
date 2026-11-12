import { useEffect, useState } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

/**
 * Channel count of the orchestrator's current impulse response (0 = none).
 *
 * Kept in state and refreshed on audio-graph rebuilds and on the IR-related
 * props, instead of being read from the orchestrator during render: the scene
 * no longer re-renders every frame, so a render-time read could go stale.
 */
export function useIRChannelCount(
  audioOrchestrator: AudioOrchestrator | null | undefined,
  ...refreshKeys: unknown[]
): number {
  const [channelCount, setChannelCount] = useState(
    () => audioOrchestrator?.getIRState().channelCount ?? 0,
  );

  useEffect(() => {
    if (!audioOrchestrator) {
      setChannelCount(0);
      return;
    }
    const read = () => setChannelCount(audioOrchestrator.getIRState().channelCount ?? 0);
    read();
    return audioOrchestrator.onGraphChanged(read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOrchestrator, ...refreshKeys]);

  return channelCount;
}

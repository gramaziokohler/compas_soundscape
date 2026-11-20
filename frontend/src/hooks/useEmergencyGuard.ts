/**
 * useEmergencyGuard — runs the emergency guard (lib/diagnostics/emergency-guard.ts)
 * for the scene, in the editor and the share view alike (crashes happen in both).
 * It samples once a second without frame tracking. Playback controls are read
 * through refs, so the guard starts once.
 */
import { useEffect, useRef } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { notifyError } from '@/store';
import { startEmergencyGuard } from '@/lib/diagnostics/emergency-guard';
import { EMERGENCY_GUARD } from '@/utils/constants';

interface UseEmergencyGuardProps {
  audioOrchestrator: AudioOrchestrator | null;
  isPlaying: boolean;
  onPause: () => void;
  onPlay: () => void;
}

export function useEmergencyGuard({ audioOrchestrator, isPlaying, onPause, onPlay }: UseEmergencyGuardProps): void {
  const live = useRef({ audioOrchestrator, isPlaying, onPause, onPlay });
  live.current = { audioOrchestrator, isPlaying, onPause, onPlay };

  useEffect(
    () =>
      startEmergencyGuard({
        releaseAudioMemory: () => {
          const orchestrator = live.current.audioOrchestrator;
          orchestrator?.cancelIRSwap();
          orchestrator?.releaseIRMemory();
          orchestrator?.setIRCacheBudgetScale(EMERGENCY_GUARD.IR_BUDGET_SCALE_AFTER);
        },
        isPlaying: () => live.current.isPlaying,
        pause: () => live.current.onPause(),
        resume: () => live.current.onPlay(),
        notify: (message, type) => notifyError(message, type),
      }),
    [],
  );
}

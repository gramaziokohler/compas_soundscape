/**
 * useSceneReloadPause — when a scene switch replaces the sound set (share-link scene or
 * simulation change), the timeline waits for the new scene instead of playing it
 * half-loaded: playback pauses, the bottom bar shows "Loading sounds n/N", and once every
 * buffer is in and the new sources have their simulation IRs, playback resumes where it
 * paused. A safety timeout resumes anyway if a load hangs.
 */
import { useEffect, useRef } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useTransportTimeStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { SCENE_RELOAD } from '@/utils/constants';

interface UseSceneReloadPauseProps {
  audioOrchestrator: AudioOrchestrator | null;
  isPlaying: boolean;
  onPause: () => void;
  onPlay: () => void;
}

export function useSceneReloadPause({ audioOrchestrator, isPlaying, onPause, onPlay }: UseSceneReloadPauseProps): void {
  const live = useRef({ audioOrchestrator, isPlaying, onPause, onPlay });
  live.current = { audioOrchestrator, isPlaying, onPause, onPlay };

  useEffect(() => {
    const { setSceneLoadProgress } = useTransportTimeStore.getState();
    let pausedByReload = false;
    let reloadSeq = 0;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeManager: (() => void) | null = null;

    const resume = (seq: number) => {
      if (seq !== reloadSeq) return; // a newer reload started meanwhile
      if (safetyTimer !== null) clearTimeout(safetyTimer);
      safetyTimer = null;
      setSceneLoadProgress(null);
      if (pausedByReload) {
        pausedByReload = false;
        live.current.onPlay();
      }
    };

    let reloading = false;
    const onProgress = (progress: { loaded: number; total: number } | null) => {
      if (progress) {
        setSceneLoadProgress(progress);
        if (!reloading) {
          reloading = true;
          reloadSeq++;
          if (live.current.isPlaying && !pausedByReload) {
            pausedByReload = true;
            live.current.onPause();
          }
          const seq = reloadSeq;
          safetyTimer = setTimeout(() => resume(seq), SCENE_RELOAD.MAX_PAUSE_MS);
        }
        return;
      }
      // Every buffer is in: give the new sources their IRs before playing again.
      reloading = false;
      const seq = reloadSeq;
      const orchestrator = live.current.audioOrchestrator;
      (orchestrator ? orchestrator.refreshSourceIRs() : Promise.resolve())
        .catch((error) => console.error('[useSceneReloadPause] IR refresh failed:', error))
        .finally(() => resume(seq));
    };

    const attach = () => {
      unsubscribeManager?.();
      const manager = useSpeckleEngineStore.getState().coordinator?.getSoundSphereManager();
      unsubscribeManager = manager ? manager.onSceneReload(onProgress) : null;
    };
    attach();
    const unsubscribeEngine = useSpeckleEngineStore.subscribe((state, prev) => {
      if (state.coordinator !== prev.coordinator) attach();
    });

    return () => {
      unsubscribeEngine();
      unsubscribeManager?.();
      if (safetyTimer !== null) clearTimeout(safetyTimer);
      setSceneLoadProgress(null);
    };
  }, []);
}

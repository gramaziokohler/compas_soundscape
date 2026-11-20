/**
 * useSceneReloadPause — when a scene switch replaces the sound set (share-link scene or
 * simulation change), playback pauses only briefly: it resumes as soon as the scene is
 * "safe enough" — SCENE_RELOAD.RESUME_FRACTION of its sounds loaded, or after
 * SCENE_RELOAD.RESUME_AFTER_MS at most — while the bottom bar keeps showing
 * "Loading sounds n/N" until every sound is in. Sounds that arrive after the resume
 * join mid-clip (Transport.handleSourceAdded), and the finished scene gets its
 * simulation IRs in one swap (orchestrator.refreshSourceIRs).
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
    let reloading = false;
    let pausedByReload = false;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeManager: (() => void) | null = null;

    const clearTimer = () => {
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
    };

    /** Play again (if this reload paused it); the progress widget stays until the end. */
    const resumePlayback = () => {
      clearTimer();
      if (!pausedByReload) return;
      pausedByReload = false;
      live.current.onPlay();
    };

    const onProgress = (progress: { loaded: number; total: number } | null) => {
      if (progress) {
        setSceneLoadProgress(progress);
        if (!reloading) {
          reloading = true;
          if (live.current.isPlaying) {
            pausedByReload = true;
            live.current.onPause();
            resumeTimer = setTimeout(resumePlayback, SCENE_RELOAD.RESUME_AFTER_MS);
          }
        }
        if (pausedByReload && progress.loaded >= Math.ceil(progress.total * SCENE_RELOAD.RESUME_FRACTION)) {
          resumePlayback();
        }
        return;
      }
      // Every sound is in: resume if still waiting, then give the whole scene its IRs.
      reloading = false;
      resumePlayback();
      setSceneLoadProgress(null);
      live.current.audioOrchestrator
        ?.refreshSourceIRs()
        .catch((error) => console.error('[useSceneReloadPause] IR refresh failed:', error));
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
      clearTimer();
      setSceneLoadProgress(null);
    };
  }, []);
}

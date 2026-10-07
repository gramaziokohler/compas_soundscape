import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { diagnoseLowOutput } from '@/lib/audio/utils/low-output-diagnosis';
import { useAudioControlsStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { AUDIO_CONTROL, LOW_OUTPUT_HINT } from '@/utils/constants';
import type { LowOutputHint, LowOutputHintId } from '@/types/audio';

interface UseLowOutputHintsOptions {
  audioOrchestrator: AudioOrchestrator | null;
  isPlaying: boolean;
  timelineOpen: boolean;
  onOpenTimeline: () => void;
}

/**
 * Low-Output Hints Hook
 *
 * For `LOW_OUTPUT_HINT.CHECK_WINDOW_MS` after Play is pressed, samples the final
 * (post-limiter) output level and, when it stays below `LOW_OUTPUT_DBFS` for `SUSTAIN_MS`, asks
 * `diagnoseLowOutput` why: suspended audio, master volume, mute/solo, quiet
 * tracks, out-of-simulation sounds, low-energy IRs, or a far-away camera.
 * The hint clears once the output recovers past `RECOVER_OUTPUT_DBFS`, or after `DISPLAY_MS`.
 * Dismissed hints stay hidden for the rest of the session.
 *
 * @returns The current hint (or null), plus apply/dismiss handlers.
 */
export function useLowOutputHints({
  audioOrchestrator,
  isPlaying,
  timelineOpen,
  onOpenTimeline,
}: UseLowOutputHintsOptions) {
  const [hint, setHint] = useState<LowOutputHint | null>(null);
  const normalizeEnabled = useAudioControlsStore((s) => s.normalizeImpulseResponses);

  const dismissedRef = useRef<Set<LowOutputHintId>>(new Set());
  const lowSinceRef = useRef<number | null>(null);
  const contextRef = useRef({ normalizeEnabled, timelineOpen });
  contextRef.current = { normalizeEnabled, timelineOpen };

  useEffect(() => {
    if (!isPlaying || !audioOrchestrator) {
      lowSinceRef.current = null;
      setHint(null);
      return;
    }

    audioOrchestrator.resetOutputLevel();
    const startedAt = performance.now();
    const timer = setInterval(() => {
      // Only diagnose right after Play is pressed; a shown hint lingers via DISPLAY_MS.
      if (performance.now() - startedAt > LOW_OUTPUT_HINT.CHECK_WINDOW_MS) {
        clearInterval(timer);
        return;
      }

      const diag = audioOrchestrator.getOutputDiagnostics();
      if (!diag) return;

      const suspended = diag.contextState !== 'running';
      const hasVoices = diag.sources.length > 0;
      // Gaps between clips (no voices) are neither low nor recovered: keep the current state.
      if (!suspended && !hasVoices) return;

      if (!suspended && diag.outputDbfs > LOW_OUTPUT_HINT.RECOVER_OUTPUT_DBFS) {
        lowSinceRef.current = null;
        setHint(null);
        return;
      }
      if (!suspended && diag.outputDbfs >= LOW_OUTPUT_HINT.LOW_OUTPUT_DBFS) return;

      const now = performance.now();
      lowSinceRef.current ??= now;
      if (now - lowSinceRef.current < LOW_OUTPUT_HINT.SUSTAIN_MS) return;

      const next = diagnoseLowOutput(diag, contextRef.current);
      const visible = next && !dismissedRef.current.has(next.id) ? next : null;
      setHint((prev) =>
        prev?.id === visible?.id && prev?.message === visible?.message ? prev : visible,
      );
    }, LOW_OUTPUT_HINT.POLL_MS);

    return () => clearInterval(timer);
  }, [isPlaying, audioOrchestrator]);

  // Auto-hide a shown hint so it never stays up for the whole playback.
  useEffect(() => {
    if (!hint) return;
    const timeout = setTimeout(() => setHint(null), LOW_OUTPUT_HINT.DISPLAY_MS);
    return () => clearTimeout(timeout);
  }, [hint]);

  /** Hide the hint and wait a full sustain period before re-diagnosing. */
  const settle = useCallback(() => {
    lowSinceRef.current = null;
    setHint(null);
  }, []);

  const dismiss = useCallback(() => {
    if (hint) dismissedRef.current.add(hint.id);
    settle();
  }, [hint, settle]);

  const applyAction = useCallback(() => {
    if (!hint?.action) return;
    const audio = useAudioControlsStore.getState();

    switch (hint.action.kind) {
      case 'resume-audio':
        void audioOrchestrator?.resumeAudioContext();
        break;
      case 'raise-master':
        audio.setMasterVolume(AUDIO_CONTROL.MASTER_VOLUME.RESET);
        break;
      case 'unmute-all':
        audio.restoreMuteSolo([], []);
        break;
      case 'open-timeline':
        onOpenTimeline();
        break;
      case 'normalize-irs':
        audio.setNormalizeImpulseResponses(true);
        break;
      case 'move-closer': {
        const coordinator = useSpeckleEngineStore.getState().coordinator;
        if (coordinator && hint.target) {
          const { x, y, z } = hint.target;
          coordinator.zoomToPosition(new THREE.Vector3(x, y, z), LOW_OUTPUT_HINT.FLY_TO_DISTANCE_M);
        }
        break;
      }
    }
    settle();
  }, [hint, audioOrchestrator, onOpenTimeline, settle]);

  return { hint, applyAction, dismiss };
}

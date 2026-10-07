'use client';

import { useCallback, useRef, useState } from 'react';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { pauseStore, commitStore } from '@/store';
import { DAW_CLIP_TRIM } from '@/utils/constants';
import type { TimelineSound, TrimRange } from '@/types/audio';
import { resolveSnap, type SnapMode } from './daw-snap';
import { computeTrimEdit, startMsAfterTrimReset, type TrimEdge, type TrimEditResult } from './daw-trim';
import { resolveVariantSoundIdByPrompt } from '@/lib/audio/utils/variant-sound-id';
import { iterationKey } from '@/lib/audio/utils/iteration-keys';
import { ensureTrackMaterialized, CLICK_THRESHOLD_PX, SNAP_MAGNET_PX, type ClipDescriptor } from './useClipGesture';

/** A clip about to be trimmed: its timeline slot plus the window of its source it plays. */
export interface TrimTarget extends ClipDescriptor {
  /** Current kept window (fractions of the source). Untrimmed = `{ start: 0, end: 1 }`. */
  trim: TrimRange;
  /** Untrimmed source buffer length (ms). */
  sourceDurationMs: number;
}

/** Live preview of the clip being trimmed — nothing is written to the store until pointer-up. */
export interface TrimPreview extends TrimEditResult {
  clipKey: string;
}

interface UseClipTrimGestureArgs {
  soundsRef: React.RefObject<TimelineSound[]>;
  pxPerSecondRef: React.RefObject<number>;
  snapModeRef: React.RefObject<SnapMode>;
  gridStepSecRef: React.RefObject<number>;
  playheadMsRef: React.RefObject<number>;
  /** Every rendered clip, keyed by clipKey — sibling edges are snap targets. */
  clipRegistryRef: React.RefObject<Map<string, ClipDescriptor>>;
}

/** Edge-drag trimming for a single DAW clip. One instance lives in DAWDock. */
export function useClipTrimGesture({
  soundsRef,
  pxPerSecondRef,
  snapModeRef,
  gridStepSecRef,
  playheadMsRef,
  clipRegistryRef,
}: UseClipTrimGestureArgs) {
  const [trimPreview, setTrimPreview] = useState<TrimPreview | null>(null);
  const activeRef = useRef(false);

  const beginTrim = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, target: TrimTarget, edge: TrimEdge) => {
      if (e.button !== 0 || target.sourceDurationMs <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      activeRef.current = true;

      const startClientX = e.clientX;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);

      // Snap targets: edges of the other clips on this track (fixed for the gesture).
      const neighborEdgesSec: number[] = [];
      clipRegistryRef.current?.forEach((desc, key) => {
        if (desc.soundId === target.soundId && key !== target.clipKey) {
          neighborEdgesSec.push(desc.startMs / 1000, (desc.startMs + desc.durationMs) / 1000);
        }
      });

      const compute = (clientX: number, bypassSnap: boolean): TrimEditResult => {
        const pxPerSecond = pxPerSecondRef.current ?? 10;
        return computeTrimEdit({
          edge,
          trim: target.trim,
          sourceMs: target.sourceDurationMs,
          startMs: target.startMs,
          deltaMs: ((clientX - startClientX) / pxPerSecond) * 1000,
          minDurationMs: DAW_CLIP_TRIM.MIN_DURATION_MS,
          snapSec: (rawSec) => resolveSnap(rawSec, {
            mode: snapModeRef.current ?? 'on',
            pxPerSecond,
            gridStepSec: gridStepSecRef.current ?? 1,
            magnetPx: SNAP_MAGNET_PX,
            playheadSec: (playheadMsRef.current ?? 0) / 1000,
            neighborEdgesSec,
            bypass: bypassSnap,
          }),
        });
      };

      const handleMove = (ev: PointerEvent) => {
        if (!activeRef.current) return;
        setTrimPreview({ clipKey: target.clipKey, ...compute(ev.clientX, ev.altKey) });
      };

      const endTrim = (ev: PointerEvent) => {
        activeRef.current = false;
        try { el.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
        el.removeEventListener('pointermove', handleMove);
        el.removeEventListener('pointerup', endTrim);
        el.removeEventListener('pointercancel', endTrim);
        setTrimPreview(null);
        if (ev.type === 'pointercancel') return;
        if (Math.abs(ev.clientX - startClientX) <= CLICK_THRESHOLD_PX) return;

        const result = compute(ev.clientX, ev.altKey);
        const store = useAudioControlsStore.getState();
        const sound = soundsRef.current?.find((s) => s.id === target.soundId);
        const cardIdx = sound?.cardIndex ?? sound?.promptIndex;

        // Materializing an auto track + the trim (+ start move) = one undo entry.
        pauseStore('audioControls');
        try {
          ensureTrackMaterialized(soundsRef, target.soundId);
          if (edge === 'start' && cardIdx !== undefined) {
            // The clip start no longer satisfies its trigger formula — same as a
            // manual drag, the user's placement wins over the parametric link.
            useSoundscapeStore.getState().clearOrchestrateTrigger(cardIdx, target.iterationIndex);
          }
          store.setIterationTrim(
            target.soundId,
            target.iterationIndex,
            result.trim,
            edge === 'start' ? result.startMs / 1000 : undefined,
          );
        } finally {
          commitStore('audioControls');
        }
      };

      el.addEventListener('pointermove', handleMove);
      el.addEventListener('pointerup', endTrim);
      el.addEventListener('pointercancel', endTrim);
    },
    [soundsRef, pxPerSecondRef, snapModeRef, gridStepSecRef, playheadMsRef, clipRegistryRef],
  );

  /**
   * Drop one clip's trim override so it follows its card trim again. The clip
   * start shifts back by the trimmed-off head so the audio stays put.
   */
  const resetTrim = useCallback((soundId: string, iterationIndex: number) => {
    const store = useAudioControlsStore.getState();
    const key = iterationKey(soundId, iterationIndex);
    const clipTrim = store.iterationTrims[key];
    if (!clipTrim) return;

    const sound = soundsRef.current?.find((s) => s.id === soundId);
    const i = sound?.scheduledIterationOriginalIndices?.indexOf(iterationIndex) ?? iterationIndex;
    const startMs = sound?.scheduledIterations[i];
    const sourceMs = sound?.iterationSourceDurationsMs?.[i];
    let newStartSec: number | undefined;
    if (sound && startMs !== undefined && sourceMs) {
      const variantSoundId = resolveVariantSoundIdByPrompt(
        soundId,
        store.iterationLinks[key]?.variantIndex ?? 0,
        sound.promptIndex,
        useSoundscapeStore.getState().generatedSounds,
      );
      const fallback = store.soundTrims[variantSoundId];
      if ((fallback?.start ?? 0) !== clipTrim.start) {
        newStartSec = startMsAfterTrimReset(startMs, clipTrim, fallback, sourceMs) / 1000;
      }
    }

    pauseStore('audioControls');
    try {
      if (newStartSec !== undefined) ensureTrackMaterialized(soundsRef, soundId);
      store.setIterationTrim(soundId, iterationIndex, null, newStartSec);
    } finally {
      commitStore('audioControls');
    }
  }, [soundsRef]);

  return { trimPreview, isTrimming: trimPreview !== null, beginTrim, resetTrim };
}

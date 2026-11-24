'use client';

import { useEffect, useRef, useState } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { generateLoopTimestamps } from '@/lib/audio/utils/timeline-utils';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { AUDIO_PLAYBACK, UI_INTERVAL_SLIDER, UI_VARIABILITY_SLIDER } from '@/utils/constants';

interface IntervalSettingsPanelProps {
  soundId: string;
  /** Per-iteration clip durations (seconds) used to space the loop. */
  durationSecPerIteration: number[];
  /** Fallback duration when no per-iteration durations are available. */
  fallbackDurationSec: number;
  /** Interval the panel opens with (the track's current/interval_seconds). */
  seedIntervalSeconds: number;
  /** Schedule that existed when the panel opened — restored on Cancel. `undefined` = track was auto. */
  initialSchedule?: number[];
  timelineDurationMs: number;
  onClose: () => void;
  /** Variability the panel opens with (a recurring activity's LLM spread). Default 0. */
  seedJitterSeconds?: number;
  /**
   * Recurring activity: apply interval / variability to its trigger chain instead
   * of writing timestamps (the panel then leaves the schedule untouched on open).
   */
  onApply?: (intervalSec: number, jitterSec: number) => void;
  /** Restore whatever `onApply` changed (Cancel). */
  onCancel?: () => void;
}

/**
 * IntervalSettingsPanel
 *
 * Transient "Interval settings" panel shown in its own row directly below a DAW
 * track header. Recomputes that track's timestamps live (loop from t=0 with
 * interval ± variability) as the sliders are dragged, writing them into
 * `soundTimestamps` in real time — so the timeline clips update while dragging.
 * Slider drags are batched into a single undo step. Cancel restores the schedule
 * the track had when the panel was opened.
 */
export function IntervalSettingsPanel({
  soundId,
  durationSecPerIteration,
  fallbackDurationSec,
  seedIntervalSeconds,
  initialSchedule,
  timelineDurationMs,
  onClose,
  seedJitterSeconds = 0,
  onApply,
  onCancel,
}: IntervalSettingsPanelProps) {
  const [intervalSec, setIntervalSec] = useState(seedIntervalSeconds);
  const [jitterSec, setJitterSec] = useState(seedJitterSeconds);
  // A recurring activity's chain lives on the sound card (soundscape store);
  // a plain track's schedule in the audio store — group the drag's undo there.
  const undoStoreId = onApply ? 'soundscape' : 'audioControls';

  const recompute = (interval: number, jitter: number) => {
    if (onApply) {
      onApply(interval, jitter);
      return;
    }
    const ts = generateLoopTimestamps({
      soundId,
      durationSecPerIteration: durationSecPerIteration.length > 0 ? durationSecPerIteration : undefined,
      fallbackDurationSec,
      intervalSec: interval,
      jitterSec: jitter,
      timelineSec: timelineDurationMs / 1000,
    });
    useAudioControlsStore.getState().handleTimestampsChange(soundId, ts);
  };

  // Apply the seeded distribution as soon as the panel opens — otherwise the
  // timeline only updates once a slider is dragged.
  // A recurring activity opens on its own (LLM) rhythm and only changes once a
  // slider moves.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (onApply) return;
    recompute(seedIntervalSeconds, seedJitterSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-update on every drag step; one undo entry per drag (pause/commit).
  const intervalSlider = useBatchedSlider<number>(
    undoStoreId,
    (v) => {
      const rounded = Math.round(v * 10) / 10;
      setIntervalSec(rounded);
      recompute(rounded, jitterSec);
    },
  );

  const jitterSlider = useBatchedSlider<number>(
    undoStoreId,
    (v) => {
      const rounded = Math.round(v * 10) / 10;
      setJitterSec(rounded);
      recompute(intervalSec, rounded);
    },
  );

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
      onClose();
      return;
    }
    const store = useAudioControlsStore.getState();
    if (initialSchedule !== undefined) {
      store.handleTimestampsChange(soundId, initialSchedule);
    } else {
      store.clearSoundTimestampsEntry(soundId);
    }
    onClose();
  };

  return (
    <ConfirmDialog
      message="Interval settings"
      confirmLabel="Done"
      cancelLabel="Cancel"
      solidBackground
      onCancel={handleCancel}
      onConfirm={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <RangeSlider
          label="Interval"
          value={intervalSec}
          min={UI_INTERVAL_SLIDER.MIN}
          max={UI_INTERVAL_SLIDER.MAX}
          step={UI_INTERVAL_SLIDER.STEP}
          unit="s"
          precision={1}
          defaultValue={AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS}
          hoverText="Time between sound repetitions. 0 = back-to-back continuous loop. Double-click to reset."
          onDragStart={intervalSlider.onDragStart}
          onChange={intervalSlider.onChange}
          onChangeCommitted={intervalSlider.onCommit}
        />
        <RangeSlider
          label="Variability"
          value={jitterSec}
          min={UI_VARIABILITY_SLIDER.MIN}
          max={UI_VARIABILITY_SLIDER.MAX}
          step={UI_VARIABILITY_SLIDER.STEP}
          unit="s"
          precision={1}
          defaultValue={0}
          hoverText="Each repetition fires at its interval ± a deterministic offset of up to this. Double-click to reset to 0."
          onDragStart={jitterSlider.onDragStart}
          onChange={jitterSlider.onChange}
          onChangeCommitted={jitterSlider.onCommit}
        />
      </div>
    </ConfirmDialog>
  );
}

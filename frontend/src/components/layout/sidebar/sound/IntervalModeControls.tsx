'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { AUDIO_PLAYBACK, UI_INTERVAL_SLIDER, UI_VARIABILITY_SLIDER } from '@/utils/constants';

/**
 * IntervalModeControls
 *
 * Per-track "Interval mode" collapsible group rendered on a generated sound
 * card (below the Position widget / above the variant bar) while the track is
 * in interval mode. Replaces the old vertical "Int." slider with a horizontal
 * RangeSlider and moves jitter onto the track itself as a "Variability" slider
 * (applies to this card/track and all of its variants) — replacing the removed
 * global Jitter control in Settings.
 *
 * Both sliders are batched via useBatchedSlider('audioControls', …) so a drag
 * produces a single undo step, matching the volume slider behaviour.
 *
 * Usage:
 * ```tsx
 * <IntervalModeControls
 *   intervalSeconds={intervalSeconds}
 *   onIntervalChange={(s) => handleIntervalChange(cardSoundId, s)}
 *   jitterSeconds={jitterSeconds}
 *   onJitterChange={(s) => setSoundIntervalJitter(cardSoundId, s)}
 * />
 * ```
 */
export interface IntervalModeControlsProps {
  intervalSeconds: number;
  onIntervalChange: (seconds: number) => void;
  jitterSeconds: number;
  onJitterChange: (seconds: number) => void;
  /** Recolors labels/sliders for legibility on the solid-blue generated card. Defaults to true. */
  onBlueBackground?: boolean;
}

export function IntervalModeControls({
  intervalSeconds,
  onIntervalChange,
  jitterSeconds,
  onJitterChange,
  onBlueBackground = true,
}: IntervalModeControlsProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Local drag state so the sliders feel live; the store is only written on commit.
  const [tempInterval, setTempInterval] = useState(intervalSeconds);
  const [tempJitter, setTempJitter] = useState(jitterSeconds);

  useEffect(() => { setTempInterval(intervalSeconds); }, [intervalSeconds]);
  useEffect(() => { setTempJitter(jitterSeconds); }, [jitterSeconds]);

  const intervalBatched = useBatchedSlider<number>(
    'audioControls',
    (v) => setTempInterval(Math.round(v * 10) / 10),
    (v) => onIntervalChange(Math.round(v * 10) / 10),
  );

  const jitterBatched = useBatchedSlider<number>(
    'audioControls',
    (v) => setTempJitter(v),
    (v) => onJitterChange(v),
  );

  const headerColor = onBlueBackground
    ? { color: 'var(--color-on-blue-muted)' }
    : { color: 'var(--color-secondary-hover)' };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1 w-full text-left text-[9px] uppercase tracking-wider hover:opacity-80 transition-opacity"
        aria-expanded={isExpanded}
        style={headerColor}
      >
        {isExpanded ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronRight size={11} className="shrink-0" />
        )}
        <span>Interval mode</span>
      </button>
      {isExpanded && (
        <div className="flex flex-col gap-1.5">
          <RangeSlider
            label="Interval"
            value={tempInterval}
            min={UI_INTERVAL_SLIDER.MIN}
            max={UI_INTERVAL_SLIDER.MAX}
            step={UI_INTERVAL_SLIDER.STEP}
            unit="s"
            precision={1}
            defaultValue={AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS}
            hoverText="Time between sound repetitions in the timeline. Set to 0 for a continuous loop. Double-click to reset."
            onBlueBackground={onBlueBackground}
            onDragStart={intervalBatched.onDragStart}
            onChange={intervalBatched.onChange}
            onChangeCommitted={intervalBatched.onCommit}
          />
          <RangeSlider
            label="Variability"
            value={tempJitter}
            min={UI_VARIABILITY_SLIDER.MIN}
            max={UI_VARIABILITY_SLIDER.MAX}
            step={UI_VARIABILITY_SLIDER.STEP}
            unit="s"
            precision={1}
            defaultValue={0}
            hoverText="Each repetition of this sound fires at its base interval ± a random offset of up to Variability (between -Variability and +Variability). Applies to this track and all its variants. Double-click to reset to 0."
            onBlueBackground={onBlueBackground}
            onDragStart={jitterBatched.onDragStart}
            onChange={jitterBatched.onChange}
            onChangeCommitted={jitterBatched.onCommit}
          />
        </div>
      )}
    </div>
  );
}

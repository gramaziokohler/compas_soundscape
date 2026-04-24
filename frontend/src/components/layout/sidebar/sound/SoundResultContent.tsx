'use client';

import { useState, useEffect } from 'react';
import type { SoundEvent } from '@/types';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/utils/constants';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * SoundResultContent Component
 *
 * Renders the playback controls for a generated sound.
 * Shows waveform, volume slider, interval slider, and variant selector.
 *
 * This is the `afterContent` for the Sound Card component.
 */

export interface SoundResultContentProps {
  generatedSound: SoundEvent;
  index: number;
  variants: SoundEvent[];
  selectedVariantIdx: number;
  isPreviewPlaying: boolean;
  isMuted: boolean;
  /** Silent mode: waveform renders visually but produces no audio (prevents double playback) */
  silent?: boolean;
  soundVolumes: { [soundId: string]: number };
  soundIntervals: { [soundId: string]: number };
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
}

export function SoundResultContent({
  generatedSound,
  index,
  variants,
  selectedVariantIdx,
  isPreviewPlaying,
  isMuted,
  silent = false,
  soundVolumes,
  soundIntervals,
  onPreviewPlayPause,
  onPreviewStop,
  onVolumeChange,
  onIntervalChange,
  onVariantChange,
}: SoundResultContentProps) {
  // Volume and interval from live state
  const currentVolumeDb = soundVolumes[generatedSound.id] ?? generatedSound.volume_db ?? 70;
  const currentIntervalSeconds = soundIntervals[generatedSound.id] ?? generatedSound.interval_seconds ?? 30;

  // Local state for sliders (visual feedback while dragging — no store write until release)
  const [tempVolumeDb, setTempVolumeDb] = useState(currentVolumeDb);
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(currentIntervalSeconds);

  // Sync temp values with store when they change externally (e.g. undo/redo)
  useEffect(() => { setTempVolumeDb(currentVolumeDb); }, [currentVolumeDb]);
  useEffect(() => { setTempIntervalSeconds(currentIntervalSeconds); }, [currentIntervalSeconds]);

  // Batched slider — only one undo step per full drag gesture
  const volumeSlider = useBatchedSlider<number>(
    'audioControls',
    (v) => setTempVolumeDb(UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN)),
    onVolumeChange
      ? (v) => onVolumeChange(generatedSound.id, UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN))
      : undefined,
  );

  const intervalSlider = useBatchedSlider<number>(
    'audioControls',
    (v) => setTempIntervalSeconds(Math.round(v * UI_INTERVAL_SLIDER.MAX)),
    onIntervalChange
      ? (v) => onIntervalChange(generatedSound.id, Math.round(v * UI_INTERVAL_SLIDER.MAX))
      : undefined,
  );

  return (
    <div className="flex gap-3 min-w-0">
      {/* Waveform area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <SoundCardWaveSurfer
          audioUrl={generatedSound.url}
          volumeDb={currentVolumeDb}
          isPlaying={isPreviewPlaying}
          isMuted={isMuted}
          silent={silent}
          soundId={generatedSound.id}
          onPlayPause={() => onPreviewPlayPause?.(generatedSound.id)}
          onStop={() => onPreviewStop?.(generatedSound.id)}
        />

        {/* Variant Selector - bottom left under waveform */}
        {variants.length > 1 && onVariantChange && (
          <div className="flex gap-1 mt-1 overflow-x-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}>
            {variants.map((_, idx) => (
              <button
                key={idx}
                onClick={() => onVariantChange(index, idx)}
                className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 ${
                  idx === selectedVariantIdx
                    ? 'text-white'
                    : 'bg-secondary text-secondary-light'
                }`}
                style={idx === selectedVariantIdx ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Vertical sliders container */}
      <div className="flex gap-2">
        {/* Interval slider */}
        {onIntervalChange && (
          <div
            className="flex flex-col items-center"
            title="Playback interval: Time between sound repetitions in the timeline. Set to 0 for continuous loop."
          >
            <span className="text-[10px] mb-1 text-secondary-hover">
              {tempIntervalSeconds === 0 ? '∞' : `${tempIntervalSeconds}s`}
            </span>
            <VerticalVolumeSlider
              value={tempIntervalSeconds / UI_INTERVAL_SLIDER.MAX}
              onDragStart={intervalSlider.onDragStart}
              onChange={intervalSlider.onChange}
              onChangeCommitted={intervalSlider.onCommit}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Int.</span>
          </div>
        )}

        {/* Volume slider */}
        {onVolumeChange && (
          <div
            className="flex flex-col items-center"
            title="Volume level: Controls the sound pressure level (SPL) in decibels for spatial audio playback."
          >
            <span className="text-[10px] mb-1 text-secondary-hover">
              {tempVolumeDb.toFixed(0)}dB
            </span>
            <VerticalVolumeSlider
              value={(tempVolumeDb - UI_VOLUME_SLIDER.MIN) / (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN)}
              onDragStart={volumeSlider.onDragStart}
              onChange={volumeSlider.onChange}
              onChangeCommitted={volumeSlider.onCommit}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Vol.</span>
          </div>
        )}
      </div>
    </div>
  );
}


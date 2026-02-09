'use client';

import { useState, useEffect } from 'react';
import type { SoundEvent } from '@/types';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/lib/constants';

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

  // Local state for interval slider (visual feedback while dragging)
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(currentIntervalSeconds);

  // Sync temp interval with actual interval when it changes externally
  useEffect(() => {
    setTempIntervalSeconds(currentIntervalSeconds);
  }, [currentIntervalSeconds]);

  return (
    <div className="flex gap-3">
      {/* Waveform area */}
      <div className="flex-1">
        <SoundCardWaveSurfer
          audioUrl={generatedSound.url}
          volumeDb={currentVolumeDb}
          isPlaying={isPreviewPlaying}
          isMuted={isMuted}
          silent={silent}
          onPlayPause={() => onPreviewPlayPause?.(generatedSound.id)}
          onStop={() => onPreviewStop?.(generatedSound.id)}
        />

        {/* Variant Selector - bottom left under waveform */}
        {variants.length > 1 && onVariantChange && (
          <div className="flex gap-1 mt-1">
            {variants.map((_, idx) => (
              <button
                key={idx}
                onClick={() => onVariantChange(index, idx)}
                className={`w-5 h-5 text-[10px] rounded transition-colors ${
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
              onChange={(v) => setTempIntervalSeconds(Math.round(v * UI_INTERVAL_SLIDER.MAX))}
              onChangeCommitted={(v) => onIntervalChange(generatedSound.id, Math.round(v * UI_INTERVAL_SLIDER.MAX))}
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
              {currentVolumeDb.toFixed(0)}dB
            </span>
            <VerticalVolumeSlider
              value={(currentVolumeDb - UI_VOLUME_SLIDER.MIN) / (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN)}
              onChange={(v) => onVolumeChange(generatedSound.id, UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN))}
            />
            <span className="text-[10px] mt-1 text-secondary-hover">Vol.</span>
          </div>
        )}
      </div>
    </div>
  );
}

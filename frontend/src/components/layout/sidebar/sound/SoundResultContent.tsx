'use client';

import type { SoundEvent } from '@/types';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { SoundCardBody } from './SoundCardBody';

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
  /** Per-sound scheduling mode: 'interval' (default) or 'timestamps'. */
  schedulingMode?: 'interval' | 'timestamps';
  /** Per-sound explicit timestamps in seconds (used when schedulingMode is 'timestamps'). */
  soundTimestamps?: { [soundId: string]: number[] };
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onSchedulingModeChange?: (soundId: string, mode: 'interval' | 'timestamps') => void;
  onTimestampsChange?: (soundId: string, timestamps: number[]) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
  onUpdatePosition?: (soundId: string, position: [number, number, number]) => void;
  onUnlinkEntity?: () => void;
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
  schedulingMode = 'interval',
  soundTimestamps,
  onPreviewPlayPause,
  onPreviewStop,
  onVolumeChange,
  onIntervalChange,
  onSchedulingModeChange: _onSchedulingModeChange,
  onTimestampsChange,
  onVariantChange,
  onUpdatePosition,
  onUnlinkEntity,
}: SoundResultContentProps) {
  // Volume and interval from live state
  const currentVolumeDb = soundVolumes[generatedSound.id] ?? generatedSound.volume_db ?? 70;
  const currentIntervalSeconds = soundIntervals[generatedSound.id] ?? generatedSound.interval_seconds ?? 30;

  // Resolve current timestamps: prefer store, then fall back to SoundEvent.timestamps (MM:SS → seconds)
  const currentTimestamps: number[] = soundTimestamps?.[generatedSound.id] ??
    generatedSound.timestamps?.map((t) => {
      const [mm, ss] = t.split(':').map(Number);
      return (mm ?? 0) * 60 + (ss ?? 0);
    }) ?? [];

  // Variant selector (post-gen only)
  const variantSelector =
    variants.length > 1 && onVariantChange ? (
      <div
        className="flex gap-1 overflow-x-auto flex-shrink-0"
        style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}
      >
        {variants.map((_, idx) => (
          <button
            key={idx}
            onClick={() => onVariantChange(index, idx)}
            className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 ${
              idx === selectedVariantIdx ? 'text-white' : 'bg-secondary text-secondary-light'
            }`}
            style={idx === selectedVariantIdx ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
          >
            {idx + 1}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <SoundCardBody
      mainContent={
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
      }
      extraContent={variantSelector}
      volumeDb={currentVolumeDb}
      intervalSeconds={currentIntervalSeconds}
      schedulingMode={schedulingMode}
      timestamps={currentTimestamps}
      position={generatedSound.position}
      entityIndex={generatedSound.entity_index}
      onVolumeChange={onVolumeChange ? (db) => onVolumeChange(generatedSound.id, db) : undefined}
      onIntervalChange={onIntervalChange ? (s) => onIntervalChange(generatedSound.id, s) : undefined}
      onTimestampsChange={onTimestampsChange ? (ts) => onTimestampsChange(generatedSound.id, ts) : undefined}
      onUpdatePosition={onUpdatePosition ? (pos) => onUpdatePosition(generatedSound.id, pos) : undefined}
      onUnlinkEntity={onUnlinkEntity}
      storeContext="audioControls"
    />
  );
}


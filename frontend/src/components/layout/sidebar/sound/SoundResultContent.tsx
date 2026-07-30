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
  onMute?: (soundId: string) => void;
  /** Whether a new variant is being generated for this card. */
  isRegenerating?: boolean;
  /** The index of the variant that is currently being generated (variants.length). */
  pendingVariantIdx?: number;
  /** Callback to add a new variant (trigger regeneration). */
  onAddVariant?: (index: number) => void;
  /** Callback to delete a variant. Only shown when >1 variant exists. */
  onDeleteVariant?: (promptIndex: number, variantIdx: number) => void;
  /** When true, the variant selector bar (A/B/C + add + delete) is visible. */
  showVariantSelector?: boolean;
}

/** Spinner icon reused across the variant bar. */
function SpinnerIcon() {
  return (
    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
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
  onMute,
  isRegenerating = false,
  pendingVariantIdx: _pendingVariantIdx,
  onAddVariant,
  onDeleteVariant,
  showVariantSelector = true,
}: SoundResultContentProps) {
  const isShowingPending = isRegenerating && selectedVariantIdx === _pendingVariantIdx;

  // Volume and interval from live state
  const currentVolumeDb = soundVolumes[generatedSound.id] ?? generatedSound.volume_db ?? 70;
  const currentIntervalSeconds = soundIntervals[generatedSound.id] ?? generatedSound.interval_seconds ?? 30;

  // Resolve current timestamps: prefer store, then fall back to SoundEvent.timestamps (MM:SS → seconds)
  const currentTimestamps: number[] = soundTimestamps?.[generatedSound.id] ??
    generatedSound.timestamps?.map((t) => {
      const [mm, ss] = t.split(':').map(Number);
      return (mm ?? 0) * 60 + (ss ?? 0);
    }) ?? [];

  // Variant selector — only shown when enabled and onVariantChange is provided
  const pendingIdx = _pendingVariantIdx ?? variants.length;
  const canAddVariant = onAddVariant && !isRegenerating;

  const variantSelector = (showVariantSelector && onVariantChange) ? (
    <div
      className="flex gap-1 overflow-x-auto flex-shrink-0"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}
    >
      {/* Existing variants */}
      {variants.map((v, idx) => {
        const showDelete = variants.length > 1 && onDeleteVariant;
        return (
          <div key={v.id || idx} className="relative flex-shrink-0 group">
            <button
              onClick={() => onVariantChange(index, idx)}
              title={String.fromCharCode(65 + idx)}
              className={`w-5 h-5 text-[10px] leading-none rounded transition-colors flex items-center justify-center ${
                idx === selectedVariantIdx ? 'text-white' : 'bg-secondary text-secondary-light'
              }`}
              style={idx === selectedVariantIdx ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
            >
              {String.fromCharCode(65 + idx)}
            </button>
            {showDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteVariant(index, idx);
                }}
                title="Delete variant"
                className="absolute -top-0 -right-0 w-2 h-2 rounded-full bg-error text-white text-[8px] leading-none opacity-0 group-hover:opacity-100 hover:scale-150 transition-all flex items-center justify-center"
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      {/* Pending variant (regenerating) */}
      {isRegenerating && (
        <button
          key="pending"
          onClick={() => onVariantChange(index, pendingIdx)}
          title={String.fromCharCode(65 + pendingIdx)}
          className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 flex items-center justify-center ${
            pendingIdx === selectedVariantIdx ? 'text-white' : 'bg-secondary text-secondary-light'
          }`}
          style={pendingIdx === selectedVariantIdx ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
        >
          {pendingIdx === selectedVariantIdx ? (
            <SpinnerIcon />
          ) : (
            <span className="text-[8px]">{String.fromCharCode(65 + pendingIdx)}</span>
          )}
        </button>
      )}

      {/* Add variant button */}
      {canAddVariant && (
        <button
          key="add"
          onClick={() => onAddVariant(index)}
          title="Generate new variant"
          className="w-5 h-5 text-[10px] leading-none rounded bg-secondary text-secondary-light hover:text-white hover:opacity-80 transition-colors flex-shrink-0 flex items-center justify-center"
        >
          +
        </button>
      )}
    </div>
  ) : null;

  // When showing the pending variant (regenerating), render a progress placeholder
  if (isShowingPending) {
    return (
      <SoundCardBody
        mainContent={
          <div className="flex items-center gap-2 py-1 px-2">
            <SpinnerIcon />
            <span className="text-xs text-foreground">
              Generating new variant...
            </span>
          </div>
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
        isMuted={isMuted}
        onMuteChange={onMute ? (muted: boolean) => {
          if (muted !== isMuted) onMute(generatedSound.id);
        } : undefined}
        storeContext="audioControls"
      />
    );
  }

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
      isMuted={isMuted}
      onMuteChange={onMute ? (muted: boolean) => {
        if (muted !== isMuted) onMute(generatedSound.id);
      } : undefined}
      storeContext="audioControls"
    />
  );
}

'use client';

import { useState } from 'react';
import type { SoundEvent } from '@/types';
import { DEFAULT_DBFS } from '@/utils/constants';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { SoundCardBody } from './SoundCardBody';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { HelperHint } from '@/components/ui/HelperHint';

/**
 * SoundResultContent Component
 *
 * Renders the playback controls for a generated sound.
 * Shows waveform, volume slider, interval slider.
 * The letter-square variant selector is rendered by the Card component
 * (see Card `variants` / `showVariantsPostGen`), not here.
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
  onVolumeChange?: (soundId: string, volumeDbfs: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onSchedulingModeChange?: (soundId: string, mode: 'interval' | 'timestamps') => void;
  onTimestampsChange?: (soundId: string, timestamps: number[]) => void;
  onUpdatePosition?: (soundId: string, position: [number, number, number]) => void;
  onUnlinkEntity?: () => void;
  onMute?: (soundId: string) => void;
  /** Whether a new variant is being generated for this card. */
  isRegenerating?: boolean;
  /** The index of the variant that is currently being generated (variants.length). */
  pendingVariantIdx?: number;
}

/** Spinner icon reused across the pending-variant placeholder. */
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
  onUpdatePosition,
  onUnlinkEntity,
  onMute,
  isRegenerating = false,
  pendingVariantIdx: _pendingVariantIdx,
}: SoundResultContentProps) {
  const isShowingPending = isRegenerating && selectedVariantIdx === _pendingVariantIdx;

  // Unlink confirmation — clicking the link/unlink button asks first.
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);

  const unlinkConfirm = showUnlinkConfirm && onUnlinkEntity ? (
    <ConfirmDialog
      message="Unlink sound from this entity? Its position will become manually editable."
      confirmLabel="Unlink"
      onConfirm={() => { setShowUnlinkConfirm(false); onUnlinkEntity(); }}
      onCancel={() => setShowUnlinkConfirm(false)}
      onBlueBackground
    />
  ) : null;

  // Vanishing viewer message that fades away automatically (HelperHint).
  const unlinkHint = (
    <HelperHint
      text={showUnlinkConfirm ? 'Separating the sound from the 3D entity…' : null}
    />
  );

  // Volume and interval from live state
  const currentVolumeDbfs = soundVolumes[generatedSound.id] ?? generatedSound.volume_dbfs ?? DEFAULT_DBFS;
  // The WAV is calibrated to this level — the preview gain is applied relative to it.
  const baseVolumeDbfs = generatedSound.volume_dbfs ?? DEFAULT_DBFS;
  const currentIntervalSeconds = soundIntervals[generatedSound.id] ?? generatedSound.interval_seconds ?? 30;

  // Resolve current timestamps: prefer store, then fall back to SoundEvent.timestamps (MM:SS → seconds)
  const currentTimestamps: number[] = soundTimestamps?.[generatedSound.id] ??
    generatedSound.timestamps?.map((t) => {
      const [mm, ss] = t.split(':').map(Number);
      return (mm ?? 0) * 60 + (ss ?? 0);
    }) ?? [];

  // When showing the pending variant (regenerating), render a progress placeholder
  if (isShowingPending) {
    return (
      <>
        {unlinkConfirm}
        {unlinkHint}
        <SoundCardBody
        mainContent={
          <div className="flex items-center gap-2 py-1 px-2">
            <SpinnerIcon />
            <span className="text-xs text-foreground">
              Generating new variant...
            </span>
          </div>
        }
        volumeDbfs={currentVolumeDbfs}
        intervalSeconds={currentIntervalSeconds}
        schedulingMode={schedulingMode}
        timestamps={currentTimestamps}
        position={generatedSound.position}
        entityIndex={generatedSound.entity_index}
        onVolumeChange={onVolumeChange ? (dbfs) => onVolumeChange(generatedSound.id, dbfs) : undefined}
        onIntervalChange={onIntervalChange ? (s) => onIntervalChange(generatedSound.id, s) : undefined}
        onTimestampsChange={onTimestampsChange ? (ts) => onTimestampsChange(generatedSound.id, ts) : undefined}
        onUpdatePosition={onUpdatePosition ? (pos) => onUpdatePosition(generatedSound.id, pos) : undefined}
        onUnlinkEntity={onUnlinkEntity ? () => setShowUnlinkConfirm(true) : undefined}
        isMuted={isMuted}
        onMuteChange={onMute ? (muted: boolean) => {
          if (muted !== isMuted) onMute(generatedSound.id);
        } : undefined}
        storeContext="audioControls"
        onBlueBackground
      />
      </>
    );
  }

  return (
    <>
      {unlinkConfirm}
      {unlinkHint}
      <SoundCardBody
      mainContent={
        <SoundCardWaveSurfer
          audioUrl={generatedSound.url}
          volumeDbfs={currentVolumeDbfs}
          baseVolumeDbfs={baseVolumeDbfs}
          isPlaying={isPreviewPlaying}
          isMuted={isMuted}
          silent={silent}
          soundId={generatedSound.id}
          onPlayPause={() => onPreviewPlayPause?.(generatedSound.id)}
          onStop={() => onPreviewStop?.(generatedSound.id)}
        />
      }
      volumeDbfs={currentVolumeDbfs}
      intervalSeconds={currentIntervalSeconds}
      schedulingMode={schedulingMode}
      timestamps={currentTimestamps}
      position={generatedSound.position}
      entityIndex={generatedSound.entity_index}
      onVolumeChange={onVolumeChange ? (dbfs) => onVolumeChange(generatedSound.id, dbfs) : undefined}
      onIntervalChange={onIntervalChange ? (s) => onIntervalChange(generatedSound.id, s) : undefined}
      onTimestampsChange={onTimestampsChange ? (ts) => onTimestampsChange(generatedSound.id, ts) : undefined}
      onUpdatePosition={onUpdatePosition ? (pos) => onUpdatePosition(generatedSound.id, pos) : undefined}
      onUnlinkEntity={onUnlinkEntity ? () => setShowUnlinkConfirm(true) : undefined}
      isMuted={isMuted}
      onMuteChange={onMute ? (muted: boolean) => {
        if (muted !== isMuted) onMute(generatedSound.id);
      } : undefined}
      storeContext="audioControls"
      onBlueBackground
    />
    </>
  );
}

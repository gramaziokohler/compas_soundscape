'use client';

import { useState } from 'react';
import type { SoundEvent } from '@/types';
import { DEFAULT_DBFS } from '@/utils/constants';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { SoundCardBody } from './SoundCardBody';
import { IntervalModeControls } from './IntervalModeControls';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { HelperHint } from '@/components/ui/HelperHint';

/**
 * SoundResultContent Component
 *
 * Renders the playback controls for a generated sound.
 * Shows waveform, volume slider, and — when the track is in interval mode —
 * the per-track "Interval mode" controls (interval + variability), rendered in
 * the card's left column (below the Position widget, left of the volume slider).
 *
 * Track/card-level scheduling values (schedulingMode, interval, variability)
 * are keyed by `cardSoundId` (the card's primary sound id) so they apply to
 * the whole card and all of its variants, regardless of which variant is
 * currently selected.
 *
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
  /** Per-track variability (jitter) in seconds, keyed by the card/track sound id. */
  soundIntervalJitter: { [soundId: string]: number };
  /** Track/card-level scheduling mode: 'interval' (default) or 'timestamps'. */
  schedulingMode?: 'interval' | 'timestamps';
  /** Primary (track) sound id of this card — track-level settings key. */
  cardSoundId?: string;
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDbfs: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onIntervalJitterChange?: (soundId: string, seconds: number) => void;
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
  soundIntervalJitter,
  schedulingMode = 'interval',
  cardSoundId,
  onPreviewPlayPause,
  onPreviewStop,
  onVolumeChange,
  onIntervalChange,
  onIntervalJitterChange,
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

  // Volume from live state (per selected variant, mirrors card preview).
  const currentVolumeDbfs = soundVolumes[generatedSound.id] ?? generatedSound.volume_dbfs ?? DEFAULT_DBFS;
  // The WAV is calibrated to this level — the preview gain is applied relative to it.
  const baseVolumeDbfs = generatedSound.volume_dbfs ?? DEFAULT_DBFS;

  // Track/card-level interval + variability — keyed by the card's primary
  // (track) sound id so the values match the DAW timeline track and apply to
  // every variant of this card. Fall back to the selected variant's id when no
  // card id is resolved.
  const trackId = cardSoundId ?? generatedSound.id;
  const currentIntervalSeconds = soundIntervals[trackId] ?? generatedSound.interval_seconds ?? 30;
  const currentJitterSeconds = soundIntervalJitter[trackId] ?? 0;

  // Interval-mode controls group — only in interval mode and only when the
  // store writes are wired up. Slotted into the card's LEFT column (below the
  // waveform + position widget, i.e. left of the volume slider) via
  // SoundCardBody's `leftColumnFooter`.
  const intervalModeControls =
    schedulingMode === 'interval' && onIntervalChange && onIntervalJitterChange ? (
      <IntervalModeControls
        intervalSeconds={currentIntervalSeconds}
        onIntervalChange={(s) => onIntervalChange(trackId, s)}
        jitterSeconds={currentJitterSeconds}
        onJitterChange={(s) => onIntervalJitterChange(trackId, s)}
      />
    ) : null;

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
            <span className="text-xs text-on-blue">
              Generating new variant...
            </span>
          </div>
        }
        volumeDbfs={currentVolumeDbfs}
        position={generatedSound.position}
        entityIndex={generatedSound.entity_index}
        onVolumeChange={onVolumeChange ? (dbfs) => onVolumeChange(generatedSound.id, dbfs) : undefined}
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
      position={generatedSound.position}
      entityIndex={generatedSound.entity_index}
      onVolumeChange={onVolumeChange ? (dbfs) => onVolumeChange(generatedSound.id, dbfs) : undefined}
      onUpdatePosition={onUpdatePosition ? (pos) => onUpdatePosition(generatedSound.id, pos) : undefined}
      onUnlinkEntity={onUnlinkEntity ? () => setShowUnlinkConfirm(true) : undefined}
      isMuted={isMuted}
      onMuteChange={onMute ? (muted: boolean) => {
        if (muted !== isMuted) onMute(generatedSound.id);
      } : undefined}
      storeContext="audioControls"
      onBlueBackground
      leftColumnFooter={intervalModeControls}
    />
    </>
  );
}

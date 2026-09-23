'use client';

import type { SoundGenerationConfig } from '@/types';
import { DEFAULT_DBFS } from '@/utils/constants';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';
import { registerPreviewInstance, seekPreviewInstances } from '@/lib/audio/previewRegistry';

/**
 * SampleAudioMode Component
 *
 * Configuration UI for sample audio mode.
 * Displays pre-loaded sample audio with waveform visualization.
 */

export interface SampleAudioModeProps {
  config: SoundGenerationConfig;
  index: number;
  onClearUploadedAudio?: (index: number) => void;
  /** Controlled preview state — owned by the parent so previews are mutually exclusive. */
  isPreviewPlaying?: boolean;
  onPreviewPlayPause?: () => void;
  onPreviewStop?: () => void;
  /** Silent mode: waveform renders visually but produces no audio (prevents double playback). */
  silent?: boolean;
}

export function SampleAudioMode({
  config,
  index,
  onClearUploadedAudio,
  isPreviewPlaying = false,
  onPreviewPlayPause,
  onPreviewStop,
  silent = false,
}: SampleAudioModeProps) {
  const handleClearAudio = () => {
    onPreviewStop?.();
    onClearUploadedAudio?.(index);
  };

  return (
    <>
      {config.uploadedAudioUrl && config.uploadedAudioInfo && (
        <div className="relative">
          <WaveSurferPlayer
            audioUrl={config.uploadedAudioUrl}
            volumeDbfs={DEFAULT_DBFS}
            isPlaying={isPreviewPlaying}
            silent={silent}
            onPlayPause={() => onPreviewPlayPause?.()}
            onStop={(ws) => {
              if (ws) ws.seekTo(0);
              onPreviewStop?.();
            }}
            onSeek={(t) => seekPreviewInstances(`pregen:${index}`, t)}
            onWavesurferReady={(ws) => registerPreviewInstance(`pregen:${index}`, ws)}
          />
        </div>
      )}
    </>
  );
}

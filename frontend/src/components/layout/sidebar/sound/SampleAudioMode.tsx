'use client';

import type { SoundGenerationConfig } from '@/types';
import { DEFAULT_DBFS } from '@/utils/constants';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';
import { registerPreviewInstance } from '@/lib/audio/previewRegistry';

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
}

export function SampleAudioMode({
  config,
  index,
  onClearUploadedAudio,
  isPreviewPlaying = false,
  onPreviewPlayPause,
  onPreviewStop,
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
            onPlayPause={() => onPreviewPlayPause?.()}
            onStop={(ws) => {
              if (ws) ws.seekTo(0);
              onPreviewStop?.();
            }}
            onWavesurferReady={(ws) => registerPreviewInstance(`pregen:${index}`, ws)}
          />
          <button
            onClick={handleClearAudio}
            className="absolute top-1 right-1 bg-black/70 hover:bg-red-600 text-white w-5 h-5 flex items-center justify-center rounded text-xs transition-colors z-10"
            title="Remove audio"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

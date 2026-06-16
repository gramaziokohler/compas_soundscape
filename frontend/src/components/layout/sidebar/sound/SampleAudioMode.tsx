'use client';

import { useState } from 'react';
import type { SoundGenerationConfig } from '@/types';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';

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
}

export function SampleAudioMode({
  config,
  index,
  onClearUploadedAudio,
}: SampleAudioModeProps) {
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const handleClearAudio = () => {
    setIsPreviewPlaying(false);
    onClearUploadedAudio?.(index);
  };

  return (
    <>
      {config.uploadedAudioUrl && config.uploadedAudioInfo && (
        <div className="relative">
          <WaveSurferPlayer
            audioUrl={config.uploadedAudioUrl}
            volumeDb={70}
            isPlaying={isPreviewPlaying}
            onPlayPause={() => setIsPreviewPlaying((v) => !v)}
            onStop={(ws) => {
              if (ws) ws.seekTo(0);
              setIsPreviewPlaying(false);
            }}
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

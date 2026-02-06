'use client';

import type { SoundGenerationConfig } from '@/types';
import { AudioWaveformDisplay } from '@/components/audio/AudioWaveformDisplay';

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
  const handleClearAudio = () => {
    onClearUploadedAudio?.(index);
  };

  return (
    <div className="space-y-2">
      {config.uploadedAudioBuffer && config.uploadedAudioInfo && (
        <AudioWaveformDisplay
          audioBuffer={config.uploadedAudioBuffer}
          audioInfo={config.uploadedAudioInfo}
        />
      )}

      <button
        onClick={handleClearAudio}
        className="w-full text-xs py-1.5 px-3 text-white rounded-lg bg-secondary-hover hover:opacity-80 transition-colors"
      >
        Clear Sample Audio
      </button>
    </div>
  );
}

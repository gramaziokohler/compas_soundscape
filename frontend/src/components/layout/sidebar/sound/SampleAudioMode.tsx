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
    <>
      {config.uploadedAudioBuffer && config.uploadedAudioInfo && (
        <AudioWaveformDisplay
          audioBuffer={config.uploadedAudioBuffer}
          audioInfo={config.uploadedAudioInfo}
          onClear={handleClearAudio}
          compact
        />
      )}
    </>
  );
}

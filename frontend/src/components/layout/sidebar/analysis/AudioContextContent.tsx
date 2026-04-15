'use client';

import { useState } from 'react';
import type { AudioAnalysisConfig } from '@/types/analysis';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { AudioWaveformDisplay } from '@/components/audio/AudioWaveformDisplay';
import { UI_COLORS, AUDIO_FILE_EXTENSIONS, AUDIO_VISUALIZATION, NUM_SOUNDS_MAX, NUM_SOUNDS_MIN } from '@/utils/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * AudioContextContent Component
 * 
 * UI for audio analysis configuration (before generation)
 * Uses sed_service.py backend for sound event detection
 */

interface AudioContextContentProps {
  config: AudioAnalysisConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<AudioAnalysisConfig>) => void;
}

export function AudioContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig
}: AudioContextContentProps) {
  // File upload state
  const [isDragging, setIsDragging] = useState(false);

  const hasAudioFile = config.audioFile !== null;

  // Batched slider — one undo step per drag gesture
  const numSoundsSlider = useBatchedSlider<number>('analysis', (v) =>
    onUpdateConfig(index, { numSounds: v }),
  );

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    // Update config - useEffect in page.tsx will handle loading buffer
    onUpdateConfig(index, { audioFile: file });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    // Update config - useEffect in page.tsx will handle loading buffer
    onUpdateConfig(index, { audioFile: file });
    
    // Reset input
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* File upload area - only show if no audio loaded */}
      {!hasAudioFile && (
        <FileUploadArea
          file={config.audioFile}
          isDragging={isDragging}
          acceptedFormats="audio/*,.wav,.mp3,.ogg,.flac"
          acceptedExtensions={AUDIO_FILE_EXTENSIONS.join(', ')}
          onFileChange={handleFileChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          inputId={`audio-upload-${index}`}
          multiple={false}
        />
      )}

      {/* Audio loaded UI */}
      {hasAudioFile && (
        <div className="space-y-2">
          {/* Show waveform if available */}
          {config.audioBuffer && config.audioInfo && AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY && (
            <AudioWaveformDisplay
              audioBuffer={config.audioBuffer}
              audioInfo={config.audioInfo}
            />
          )}

          {/* Audio file info */}
          <div className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            {config.audioFile?.name || 'Audio File'}
          </div>

          {/* Number of sounds */}
          <RangeSlider
            label="Number of sounds: "
            value={config.numSounds ?? NUM_SOUNDS_MIN}
            min={NUM_SOUNDS_MIN}
            max={NUM_SOUNDS_MAX}
            step={1}
            onDragStart={numSoundsSlider.onDragStart}
            onChange={numSoundsSlider.onChange}
            onChangeCommitted={numSoundsSlider.onCommit}
          />

          {/* Note: Action button is rendered by Card component */}
        </div>
      )}
    </div>
  );
}

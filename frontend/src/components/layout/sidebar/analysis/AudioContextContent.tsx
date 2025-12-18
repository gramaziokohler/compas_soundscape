'use client';

import { useState } from 'react';
import type { AudioAnalysisConfig } from '@/types/analysis';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { AudioWaveformDisplay } from '@/components/audio/AudioWaveformDisplay';
import { UI_COLORS, UI_BUTTON, AUDIO_FILE_EXTENSIONS, AUDIO_VISUALIZATION } from '@/lib/constants';

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
  onAnalyze: (index: number) => void;
}

export function AudioContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
  onAnalyze
}: AudioContextContentProps) {
  // File upload state
  const [isDragging, setIsDragging] = useState(false);

  const hasAudioFile = config.audioFile !== null;

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
          <div className="text-sm font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            {config.audioFile?.name || 'Audio File'}
          </div>

          {/* Number of sounds slider */}
          <div>
            <label className="text-xs mb-2 block" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              Number of sounds: <span style={{ color: UI_COLORS.PRIMARY, fontWeight: 'bold' }}>{config.numSounds}</span>
            </label>
            <input
              type="range"
              value={config.numSounds}
              onChange={(e) => onUpdateConfig(index, { numSounds: parseInt(e.target.value) })}
              min="1"
              max="30"
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              <span>1</span>
              <span>30</span>
            </div>
          </div>

          {/* Analyze Sound Events button */}
          <button
            onClick={() => onAnalyze(index)}
            disabled={isAnalyzing}
            className="w-full text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            style={{
              borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
              padding: UI_BUTTON.PADDING_MD,
              fontSize: UI_BUTTON.FONT_SIZE,
              fontWeight: UI_BUTTON.FONT_WEIGHT,
              backgroundColor: UI_COLORS.PRIMARY
            }}
            onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
            onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
          >
            {isAnalyzing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing...
              </>
            ) : (
              'Analyze Sound Events'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import type { AudioAnalysisConfig } from '@/types/analysis';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';
import { AUDIO_FILE_EXTENSIONS, DEFAULT_DBFS } from '@/utils/constants';

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
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const hasAudioFile = config.audioFile !== null;

  // Create blob URL from audio file for WaveSurfer
  useEffect(() => {
    if (config.audioFile) {
      const url = URL.createObjectURL(config.audioFile);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setAudioUrl('');
  }, [config.audioFile]);

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
          {/* Show WaveSurfer waveform/spectrogram */}
          {audioUrl && config.audioInfo && (
            <WaveSurferPlayer
              audioUrl={audioUrl}
              volumeDbfs={DEFAULT_DBFS}
              isPlaying={isPreviewPlaying}
              onPlayPause={() => setIsPreviewPlaying((v) => !v)}
              onStop={(ws) => {
                if (ws) ws.seekTo(0);
                setIsPreviewPlaying(false);
              }}
            />
          )}

          {/* Note: Action button is rendered by Card component */}
        </div>
      )}
    </div>
  );
}

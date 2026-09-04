'use client';

import { useState, useEffect } from 'react';
import type { AudioAnalysisConfig } from '@/types/analysis';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';
import { registerPreviewInstance } from '@/lib/audio/previewRegistry';
import { Spinner } from '@/components/ui/Spinner';
import { Notice } from '@/components/ui/Notice';
import { useAnalysisStore } from '@/store';
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
  /** Controlled preview state — owned by the parent so previews are mutually exclusive. */
  isPreviewPlaying?: boolean;
  onPreviewPlayPause?: () => void;
  onPreviewStop?: () => void;
}

export function AudioContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
  isPreviewPlaying = false,
  onPreviewPlayPause,
  onPreviewStop,
}: AudioContextContentProps) {
  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');

  const hasAudioFile = config.audioFile !== null;

  // Restore status for saved audio-context source files — while the store is
  // re-fetching + decoding the persisted WAV the card must show a loading state
  // instead of a misleading "upload a new file" dropzone.
  const rehydratingAudioConfigs = useAnalysisStore((s) => s.rehydratingAudioConfigs);
  const audioRehydrateFailedConfigs = useAnalysisStore((s) => s.audioRehydrateFailedConfigs);
  const isRestoringAudio = rehydratingAudioConfigs.has(index);
  const audioRestoreFailed = audioRehydrateFailedConfigs.has(index);
  const savedAudioPending = !hasAudioFile && !!config.persistedAudioFilename;

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

  const fileUploadArea = (
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
  );

  return (
    <div className="card-stack">
      {/* File upload area / restore state - only show if no audio loaded */}
      {!hasAudioFile && (
        <>
          {savedAudioPending && isRestoringAudio && (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-6 text-xs"
              style={{
                borderColor: 'var(--color-border-strong)',
                color: 'var(--color-secondary-hover)',
              }}
            >
              <Spinner size={14} />
              Restoring saved audio file…
            </div>
          )}

          {savedAudioPending && !isRestoringAudio && audioRestoreFailed && (
            <div className="card-stack--md">
              <Notice
                type="warning"
                message="The saved audio file could not be reloaded — upload it again to analyse it."
              />
              {fileUploadArea}
            </div>
          )}

          {(!savedAudioPending || (!isRestoringAudio && !audioRestoreFailed)) &&
            fileUploadArea}
        </>
      )}

      {/* Audio loaded UI */}
      {hasAudioFile && (
        <div className="card-stack--md">
          {/* Show WaveSurfer waveform/spectrogram */}
          {audioUrl && config.audioInfo && (
            <WaveSurferPlayer
              audioUrl={audioUrl}
              volumeDbfs={DEFAULT_DBFS}
              isPlaying={isPreviewPlaying}
              onPlayPause={() => onPreviewPlayPause?.()}
              onStop={(ws) => {
                if (ws) ws.seekTo(0);
                onPreviewStop?.();
              }}
              onWavesurferReady={(ws) => registerPreviewInstance(`context-audio:${index}`, ws)}
            />
          )}

          {/* Note: Action button is rendered by Card component */}
        </div>
      )}
    </div>
  );
}

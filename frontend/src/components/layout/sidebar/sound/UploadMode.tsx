'use client';

import { useState } from 'react';
import type { SoundGenerationConfig } from '@/types';
import { DEFAULT_DBFS } from '@/utils/constants';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { WaveSurferPlayer } from '@/components/audio/WaveSurferPlayer';
import { registerPreviewInstance } from '@/lib/audio/previewRegistry';

/**
 * UploadMode Component
 *
 * Configuration UI for uploading audio files directly.
 * Supports drag-and-drop and file picker.
 */

export interface UploadModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUploadAudio?: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio?: (index: number) => void;
  /** Controlled preview state — owned by the parent so previews are mutually exclusive. */
  isPreviewPlaying?: boolean;
  onPreviewPlayPause?: () => void;
  onPreviewStop?: () => void;
}

export function UploadMode({
  config,
  index,
  onUploadAudio,
  onClearUploadedAudio,
  isPreviewPlaying = false,
  onPreviewPlayPause,
  onPreviewStop,
}: UploadModeProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const hasUploadedAudio = config.uploadedAudioInfo !== undefined;

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
    if (files.length === 0 || !onUploadAudio) return;

    const file = files[0];
    setUploadFile(file);
    await onUploadAudio(index, file);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !onUploadAudio) return;

    const file = files[0];
    setUploadFile(file);
    await onUploadAudio(index, file);
    e.target.value = "";
  };

  const handleClearAudio = () => {
    setUploadFile(null);
    onPreviewStop?.();
    onClearUploadedAudio?.(index);
  };

  if (!hasUploadedAudio) {
    return (
      <FileUploadArea
        file={uploadFile}
        isDragging={isDragging}
        acceptedFormats="audio/*,.wav,.mp3,.ogg,.flac"
        acceptedExtensions=".wav, .mp3, .ogg, .flac"
        onFileChange={handleFileChange}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        inputId={`sound-upload-${index}`}
        multiple={false}
      />
    );
  }

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
        </div>
      )}
    </>
  );
}

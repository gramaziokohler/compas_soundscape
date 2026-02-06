'use client';

import { useState } from 'react';
import type { SoundGenerationConfig } from '@/types';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { AudioWaveformDisplay } from '@/components/audio/AudioWaveformDisplay';

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
}

export function UploadMode({
  config,
  index,
  onUploadAudio,
  onClearUploadedAudio,
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
        Clear Uploaded Audio
      </button>
    </div>
  );
}

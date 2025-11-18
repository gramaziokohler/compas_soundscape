import { useState } from "react";
import type { AuralizationConfig } from "@/types/audio";
import { getIRInfo } from "@/lib/audio/ir-utils";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import type { SEDAudioInfo } from "@/types";
import { UI_COLORS } from "@/lib/constants";

interface AuralizationSectionProps {
  config: AuralizationConfig;
  isLoading: boolean;
  error: string | null;
  onToggleAuralization: (enabled: boolean) => void;
  onToggleNormalize: (normalize: boolean) => void;
  onLoadImpulseResponse: (file: File) => Promise<void>;
  onClearImpulseResponse: () => void;
}

/**
 * AuralizationSection Component
 *
 * Collapsible UI component for auralization controls in the sidebar.
 * Features:
 * - Collapsible interface (like Advanced Options)
 * - Import custom impulse responses
 * - Toggle auralization on/off (auto-enabled on IR import)
 * - Toggle normalization (off by default)
 * - Display IR information
 * - Clear IR with grey button
 */
export function AuralizationSection({
  config,
  isLoading,
  error,
  onToggleAuralization,
  onToggleNormalize,
  onLoadImpulseResponse,
  onClearImpulseResponse
}: AuralizationSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

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

    const file = e.dataTransfer.files[0];
    if (file) {
      setUploadFile(file);
      await onLoadImpulseResponse(file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      await onLoadImpulseResponse(file);
      // Reset input so same file can be selected again
      e.target.value = "";
    }
  };

  const irInfo = getIRInfo(config.impulseResponseBuffer);
  const hasIR = config.impulseResponseBuffer !== null;

  // Convert IR buffer info to SEDAudioInfo format for waveform display
  const irAudioInfo: SEDAudioInfo | null = config.impulseResponseBuffer ? {
    duration: config.impulseResponseBuffer.duration,
    sample_rate: config.impulseResponseBuffer.sampleRate,
    num_samples: config.impulseResponseBuffer.length,
    channels: config.impulseResponseBuffer.numberOfChannels === 1
      ? "Mono"
      : config.impulseResponseBuffer.numberOfChannels === 2
      ? "Stereo"
      : `${config.impulseResponseBuffer.numberOfChannels} ch`,
    filename: config.impulseResponseFilename || "Impulse Response"
  } : null;

  return (
    <div className="flex flex-col gap-3">
      {/* File Upload Area - Only show when no IR is loaded */}
      {!hasIR && !isLoading && (
        <FileUploadArea
          file={uploadFile}
          isDragging={isDragging}
          acceptedFormats="audio/*,.wav,.mp3,.ogg,.flac"
          acceptedExtensions=".wav, .mp3, .ogg, .flac"
          onFileChange={handleFileChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          inputId="auralization-ir-upload"
        />
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <svg className="animate-spin h-6 w-6" style={{ color: UI_COLORS.PRIMARY }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-2 text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>Loading IR...</span>
        </div>
      )}

      {/* IR Information and Controls - Only show when IR is loaded */}
      {hasIR && irInfo && (
        <>
          {/* Enable Auralization Checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enableAuralization"
              checked={config.enabled}
              onChange={(e) => onToggleAuralization(e.target.checked)}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
            <label
              htmlFor="enableAuralization"
              className="text-sm font-medium cursor-pointer"
              style={{ color: UI_COLORS.NEUTRAL_700 }}
            >
              Enable Auralization
            </label>
          </div>

          {/* Normalize IR Checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="normalizeIR"
              checked={config.normalize}
              onChange={(e) => onToggleNormalize(e.target.checked)}
              className="w-4 h-4 accent-primary cursor-pointer"
            />
            <label
              htmlFor="normalizeIR"
              className="text-sm cursor-pointer"
              style={{ color: UI_COLORS.NEUTRAL_700 }}
            >
              Normalize IR
            </label>
          </div>

          {/* Waveform Display */}
          {config.impulseResponseBuffer && irAudioInfo && (
            <AudioWaveformDisplay
              audioBuffer={config.impulseResponseBuffer}
              audioInfo={irAudioInfo}
            />
          )}

          {/* Clear IR Button - Grey color */}
          <button
            onClick={onClearImpulseResponse}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_500}
            className="w-full text-xs py-1.5 px-3 text-white rounded transition-colors"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_500,
              borderRadius: '8px'
            }}
          >
            Clear IR
          </button>
        </>
      )}

      {/* Error Message */}
      {error && (
        <div 
          className="text-xs rounded p-2"
          style={{
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.ERROR
          }}
        >
          {error}
        </div>
      )}

      {/* Help Text - Only show when no IR is loaded */}
      {!hasIR && !error && (
        <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Import an impulse response file (WAV, MP3, OGG) to apply room acoustics and spatial audio to your sounds.
        </div>
      )}
    </div>
  );
}

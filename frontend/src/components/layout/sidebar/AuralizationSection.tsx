import { useState } from "react";
import type { AuralizationConfig } from "@/hooks/useAuralization";
import { getIRInfo } from "@/lib/audio/impulse-response";
import { FileUploadArea } from "@/components/controls/FileUploadArea";

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
          <svg className="animate-spin h-6 w-6 text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading IR...</span>
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
              className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
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
              className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
            >
              Normalize IR
            </label>
          </div>

          {/* IR Info Display */}
          <div className="bg-white dark:bg-gray-800 rounded p-2">
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="font-mono">{irInfo.duration}</span>
              </div>
              <div className="flex justify-between">
                <span>Sample Rate:</span>
                <span className="font-mono">{irInfo.sampleRate}</span>
              </div>
              <div className="flex justify-between">
                <span>Channels:</span>
                <span className="font-mono">{irInfo.channels}</span>
              </div>
              <div className="flex justify-between">
                <span>Samples:</span>
                <span className="font-mono">{irInfo.samples}</span>
              </div>
            </div>
          </div>

          {/* Clear IR Button - Grey color */}
          <button
            onClick={onClearImpulseResponse}
            className="w-full text-xs py-1.5 px-3 bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
          >
            Clear IR
          </button>
        </>
      )}

      {/* Error Message */}
      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Help Text - Only show when no IR is loaded */}
      {!hasIR && !error && (
        <div className="text-xs text-gray-500 dark:text-gray-400">
          Import an impulse response file (WAV, MP3, OGG) to apply room acoustics and spatial audio to your sounds.
        </div>
      )}
    </div>
  );
}

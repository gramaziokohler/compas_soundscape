"use client";

import { useState, useEffect } from "react";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { apiService } from "@/services/api";
import type { ImpulseResponseMetadata } from "@/types/audio";
import type { AuralizationConfig } from "@/hooks/useAuralization";
import type { SEDAudioInfo } from "@/types";
import { calculateRT60, formatRT60, type RT60Result } from "@/lib/audio/rt60-analysis";
import { UI_COLORS, UI_CARD } from "@/lib/constants";

interface ImpulseResponseUploadProps {
  onSelectIR: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  onToggleNormalize: (enabled: boolean) => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
}

/**
 * ImpulseResponseUpload Component
 *
 * Manages server-side impulse response library with upload capability.
 *
 * Features:
 * - List all IRs from server
 * - Upload new IR files (auto-processes multi-channel)
 * - Format detection and labeling (Mono, Binaural, FOA, TOA)
 * - Channel count display
 * - Selection and download
 * - Delete IRs
 * - Clear/deselect current IR
 *
 * @param onSelectIR - Callback when IR is selected (downloads and loads it)
 * @param onClearIR - Callback to clear/deselect current IR
 * @param selectedIRId - Currently selected IR ID
 * @param auralizationConfig - Current auralization configuration (for visualization)
 */
export function ImpulseResponseUpload({
  onSelectIR,
  onClearIR,
  onToggleNormalize,
  selectedIRId,
  auralizationConfig
}: ImpulseResponseUploadProps) {
  const [impulseResponses, setImpulseResponses] = useState<ImpulseResponseMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  
  // RT60 cache: Map from IR ID to RT60 result (calculated on-demand)
  const [rt60Cache, setRt60Cache] = useState<Map<string, RT60Result | null>>(new Map());
  
  // RT60 for currently loaded IR
  const [currentIRRT60, setCurrentIRRT60] = useState<RT60Result | null>(null);

  // File upload state - supports multiple files
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  
  // Calculate RT60 for currently loaded IR buffer
  useEffect(() => {
    if (auralizationConfig.impulseResponseBuffer && selectedIRId) {
      const rt60 = calculateRT60(auralizationConfig.impulseResponseBuffer);
      setCurrentIRRT60(rt60);
      
      // Cache the RT60 for this IR ID
      setRt60Cache(prev => {
        const newCache = new Map(prev);
        newCache.set(selectedIRId, rt60);
        return newCache;
      });
      
      console.log('[RT60] Calculated for loaded IR:', formatRT60(rt60));
    } else {
      setCurrentIRRT60(null);
    }
  }, [auralizationConfig.impulseResponseBuffer, selectedIRId]);

  // Load IR list on mount
  useEffect(() => {
    loadImpulseResponses();
  }, []);

  const loadImpulseResponses = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const irs = await apiService.listImpulseResponses();
      setImpulseResponses(irs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load impulse responses');
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      let lastMetadata: ImpulseResponseMetadata | null = null;

      // Upload each file
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const name = uploadFiles.length === 1 && uploadName.trim()
          ? uploadName.trim()
          : file.name.replace(/\.[^/.]+$/, '');

        setUploadProgress(`Uploading ${i + 1} of ${uploadFiles.length}...`);

        const metadata = await apiService.uploadImpulseResponse(file, name);
        lastMetadata = metadata;
      }

      setUploadProgress('All uploads complete!');

      // Reload list
      await loadImpulseResponses();

      // Clear upload form
      setUploadFiles([]);
      setUploadName('');

      // Auto-select the last uploaded IR
      if (lastMetadata) {
        await handleSelectIR(lastMetadata);
      }

      // Clear progress message after a delay
      setTimeout(() => setUploadProgress(''), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectIR = async (ir: ImpulseResponseMetadata) => {
    try {
      setError(null);

      // If clicking on already-selected IR, deselect it
      if (selectedIRId === ir.id) {
        onClearIR();
        return;
      }

      await onSelectIR(ir);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load IR');
    }
  };

  const handleDeleteIR = async (irId: string, irName: string) => {
    try {
      setError(null);
      await apiService.deleteImpulseResponse(irId);
      await loadImpulseResponses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete IR');
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setUploadFiles(files);
      // Only set name if single file
      if (files.length === 1) {
        setUploadName(files[0].name.replace(/\.[^/.]+$/, ''));
      } else {
        setUploadName('');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      setUploadFiles(fileArray);
      // Only set name if single file
      if (fileArray.length === 1) {
        setUploadName(fileArray[0].name.replace(/\.[^/.]+$/, ''));
      } else {
        setUploadName('');
      }
      e.target.value = "";
    }
  };

  /**
   * Get format badge color and label
   */
  const getFormatBadge = (format: string) => {
    const badges = {
      mono: { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200', label: 'Mono' },
      binaural: { color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200', label: 'Binaural' },
      foa: { color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200', label: 'FOA' },
      toa: { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', label: 'TOA' }
    };

    return badges[format as keyof typeof badges] || { color: 'bg-gray-100 text-gray-800', label: format };
  };

  /**
   * Format channel count as human-readable string
   */
  const formatChannelLabel = (channelCount: number): string => {
    if (channelCount === 1) return "Mono";
    if (channelCount === 2) return "Stereo";
    if (channelCount === 4) return "4-Channel (FOA)";
    if (channelCount === 16) return "16-Channel (TOA)";
    return `${channelCount}-Channel`;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Loaded IR Visualization */}
      {auralizationConfig.impulseResponseBuffer && auralizationConfig.impulseResponseFilename && (
        <div 
          className="rounded-lg"
          style={{
            padding: `${UI_CARD.PADDING}px`,
            backgroundColor: 'white',
            borderColor: UI_COLORS.NEUTRAL_300,
            borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
            borderStyle: 'solid',
            borderRadius: `${UI_CARD.BORDER_RADIUS}px`
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Current IR: {auralizationConfig.impulseResponseFilename}
              </h3>
              {currentIRRT60 !== null && (
                <p className="text-xs mt-1" style={{ color: UI_COLORS.SECONDARY }}>
                  RT60: {formatRT60(currentIRRT60)}{currentIRRT60.isLowQuality && ' (not sure, low quality IR)'}
                </p>
              )}
            </div>
            <button
              onClick={onClearIR}
              className="text-xs transition-colors"
              style={{ color: UI_COLORS.NEUTRAL_600 }}
              onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.ERROR}
              onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.NEUTRAL_600}
              title="Clear/deselect IR (disable auralization)"
            >
              Clear
            </button>
          </div>
          <AudioWaveformDisplay
            audioBuffer={auralizationConfig.impulseResponseBuffer}
            audioInfo={{
              filename: auralizationConfig.impulseResponseFilename,
              sample_rate: auralizationConfig.impulseResponseBuffer.sampleRate,
              channels: formatChannelLabel(auralizationConfig.impulseResponseBuffer.numberOfChannels),
              duration: auralizationConfig.impulseResponseBuffer.duration,
              num_samples: auralizationConfig.impulseResponseBuffer.length
            }}
            enableWaveform={true}
          />
        </div>
      )}

      {/* Upload Section */}
      <div 
        className="rounded-lg"
        style={{
          padding: `${UI_CARD.PADDING}px`,
          backgroundColor: 'white',
          borderColor: UI_COLORS.NEUTRAL_300,
          borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
          borderStyle: 'solid',
          borderRadius: `${UI_CARD.BORDER_RADIUS}px`
        }}
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
          Upload New IR
        </h3>

        <FileUploadArea
          file={uploadFiles.length > 0 ? uploadFiles[0] : null}
          isDragging={isDragging}
          acceptedFormats="audio/wav,.wav"
          acceptedExtensions=".wav"
          onFileChange={handleFileChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          inputId="ir-file-upload"
          multiple={true}
        />

        {uploadFiles.length > 0 && (
          <div className="mt-3 space-y-2">
            {uploadFiles.length > 1 && (
              <div 
                className="text-xs rounded"
                style={{
                  padding: `${UI_CARD.PADDING - 4}px`,
                  backgroundColor: UI_COLORS.INFO_LIGHT,
                  borderColor: UI_COLORS.INFO,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid',
                  color: UI_COLORS.INFO_HOVER
                }}
              >
                📁 {uploadFiles.length} files selected
              </div>
            )}

            {uploadFiles.length === 1 && (
              <input
                type="text"
                placeholder="IR Name (optional)"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded bg-white text-gray-900"
                style={{
                  borderColor: UI_COLORS.NEUTRAL_300,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid',
                  borderRadius: `${UI_CARD.BORDER_RADIUS}px`
                }}
              />
            )}

            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="w-full py-2 px-4 text-sm font-medium text-white rounded transition-colors disabled:opacity-40"
              style={{
                backgroundColor: UI_COLORS.PRIMARY,
                borderRadius: `${UI_CARD.BORDER_RADIUS}px`
              }}
              onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
              onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
            >
              {isUploading ? uploadProgress : `Upload & Process ${uploadFiles.length > 1 ? `(${uploadFiles.length} files)` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div 
          className="text-xs rounded"
          style={{
            padding: `${UI_CARD.PADDING - 4}px`,
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
            borderStyle: 'solid',
            color: UI_COLORS.ERROR
          }}
        >
          {error}
        </div>
      )}

      {/* IR Library List - Only show when IRs exist */}
      {impulseResponses.length > 0 && (
        <div 
          className="rounded-lg"
          style={{
            padding: `${UI_CARD.PADDING}px`,
            backgroundColor: 'white',
            borderColor: UI_COLORS.NEUTRAL_300,
            borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
            borderStyle: 'solid',
            borderRadius: `${UI_CARD.BORDER_RADIUS}px`
          }}
        >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            IR Library ({impulseResponses.length})
          </h3>
          <button
            onClick={loadImpulseResponses}
            disabled={isLoading}
            className="text-xs transition-colors disabled:opacity-40"
            style={{ color: UI_COLORS.PRIMARY }}
            onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.color = UI_COLORS.PRIMARY_HOVER)}
            onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.color = UI_COLORS.PRIMARY)}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto">
          {impulseResponses.length === 0 ? (
            <div className="text-xs text-center py-4" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              No impulse responses yet. Upload one above!
            </div>
          ) : (
            impulseResponses.map((ir) => {
              const badge = getFormatBadge(ir.format);
              const isSelected = selectedIRId === ir.id;
              const rt60 = isSelected ? currentIRRT60 : rt60Cache.get(ir.id);

              return (
                <div
                  key={ir.id}
                  className={`p-3 rounded cursor-pointer transition-colors`}
                  style={{
                    borderColor: isSelected ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_200,
                    borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                    borderStyle: 'solid',
                    backgroundColor: isSelected ? `${UI_COLORS.PRIMARY}10` : 'transparent',
                    borderRadius: `${UI_CARD.BORDER_RADIUS}px`
                  }}
                  onClick={() => handleSelectIR(ir)}
                  onMouseEnter={(e) => !isSelected && (e.currentTarget.style.borderColor = UI_COLORS.NEUTRAL_300)}
                  onMouseLeave={(e) => !isSelected && (e.currentTarget.style.borderColor = UI_COLORS.NEUTRAL_200)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {ir.name}
                      </div>

                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {ir.sampleRate} Hz
                        </span>
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {ir.duration.toFixed(2)}s
                        </span>
                        {rt60 !== null && rt60 !== undefined && (
                          <span className="text-xs font-medium" style={{ color: UI_COLORS.SECONDARY }}>
                            RT60: {formatRT60(rt60)}
                          </span>
                        )}
                        {ir.originalChannels !== ir.channels && (
                          <span className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                            (from {ir.originalChannels}ch)
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteIR(ir.id, ir.name);
                      }}
                      className="transition-colors"
                      style={{ color: UI_COLORS.NEUTRAL_400 }}
                      onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.ERROR}
                      onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.NEUTRAL_400}
                      title="Delete IR"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  {isSelected && (
                    <div className="mt-2 text-xs" style={{ color: UI_COLORS.PRIMARY }}>
                      ✓ Currently loaded
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      {/* IR Normalization Toggle */}
      <div 
        className="rounded-lg"
        style={{
          padding: `${UI_CARD.PADDING}px`,
          backgroundColor: 'white',
          borderColor: UI_COLORS.NEUTRAL_300,
          borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
          borderStyle: 'solid',
          borderRadius: `${UI_CARD.BORDER_RADIUS}px`
        }}
      >
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={auralizationConfig.normalize}
            onChange={(e) => onToggleNormalize(e.target.checked)}
            className="w-4 h-4 rounded focus:ring-2 accent-primary"
          />
          <div className="flex-1">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Normalize IR
            </span>
            <p className="text-xs mt-0.5" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              Scale impulse response to -6dB headroom (prevents clipping with multiple sources)
            </p>
          </div>
        </label>
      </div>

      {/* Help Text */}
      <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        <strong>Supported formats:</strong> Mono (1-ch), Binaural (2-ch), FOA (4-ch), TOA (16-ch)
        <br />
        Multi-channel files (8-32ch) are auto-extracted to FOA or TOA.
      </div>
    </div>
  );
}

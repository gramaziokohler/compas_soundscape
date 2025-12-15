"use client";

import { useState, useEffect, useRef } from "react";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { apiService } from "@/services/api";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import type { ImpulseResponseMetadata, AuralizationConfig } from "@/types/audio";
import type { SEDAudioInfo } from "@/types";
import { UI_COLORS, UI_CARD, API_BASE_URL } from "@/lib/constants";

interface ImpulseResponseUploadProps {
  onSelectIR: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
  simulationResults?: string | null;
  refreshTrigger?: number;
  simulationIRIds?: string[]; // If provided, only show IRs with these IDs in the library
  isSimulationMode?: boolean; // NEW: Disable selection in simulation mode (source-receiver pairs)
}

/**
 * ImpulseResponseUpload Component
 *
 * Manages server-side impulse response library with upload capability.
 * One IR must always be selected in Precise Acoustics mode.
 *
 * Features:
 * - List all IRs from server
 * - Upload new IR files (auto-processes multi-channel)
 * - Format detection and labeling (Mono, Binaural, FOA, TOA)
 * - Channel count display
 * - Selection (no deselection - one must always be active)
 * - Delete IRs (auto-selects another if deleting current)
 *
 * @param onSelectIR - Callback when IR is selected (downloads and loads it)
 * @param onClearIR - Callback to clear IR (only used internally when no IRs remain)
 * @param selectedIRId - Currently selected IR ID
 * @param auralizationConfig - Current auralization configuration (for visualization)
 */
export function ImpulseResponseUpload({
  onSelectIR,
  onClearIR,
  selectedIRId,
  auralizationConfig,
  simulationResults = null,
  refreshTrigger = 0,
  simulationIRIds = undefined,
  isSimulationMode = false
}: ImpulseResponseUploadProps) {
  const handleError = useApiErrorHandler();
  const [impulseResponses, setImpulseResponses] = useState<ImpulseResponseMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  // Buffer cache: Map from IR ID to AudioBuffer (for waveform display on hover)
  const [bufferCache, setBufferCache] = useState<Map<string, AudioBuffer>>(new Map());

  // File upload state for drag-and-drop area
  const [isDragging, setIsDragging] = useState(false);

  // Hidden file input ref for IR Library Upload button
  const irLibraryFileInputRef = useRef<HTMLInputElement>(null);

  // Hover state for waveform overlay
  const [hoveredIRId, setHoveredIRId] = useState<string | null>(null);
  const [hoveredIRBuffer, setHoveredIRBuffer] = useState<AudioBuffer | null>(null);
  const [overlayPosition, setOverlayPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [isOverlayHovered, setIsOverlayHovered] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load IR list on mount and when refreshTrigger changes
  useEffect(() => {
    loadImpulseResponses();
  }, [refreshTrigger]);

  const loadImpulseResponses = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const irs = await apiService.listImpulseResponses();
      // Filter to show only simulation's IRs if in simulation context
      const filteredIRs = simulationIRIds
        ? irs.filter(ir => simulationIRIds.includes(ir.id))
        : irs;

      setImpulseResponses(filteredIRs);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load impulse responses';
      setError(errorMessage);
      handleError(err, errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectIR = async (ir: ImpulseResponseMetadata) => {
    // Prevent selection in simulation mode
    if (isSimulationMode) {
      console.warn('[ImpulseResponseUpload] IR selection disabled in simulation mode');
      return;
    }

    try {
      setError(null);

      // If clicking on already-selected IR, do nothing (no deselection allowed)
      if (selectedIRId === ir.id) {
        return;
      }

      await onSelectIR(ir);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load IR';
      setError(errorMessage);
      handleError(err, errorMessage);
    }
  };

  // Load IR buffer for waveform display (on hover)
  const loadIRBuffer = async (ir: ImpulseResponseMetadata): Promise<AudioBuffer | null> => {
    // Check cache first
    const cached = bufferCache.get(ir.id);
    if (cached) {
      return cached;
    }

    try {
      // Build full URL from IR metadata (url is relative like "/static/impulse_responses/file.wav")
      const fullUrl = `${API_BASE_URL}${ir.url}`;

      // Download the IR file
      const response = await fetch(fullUrl);
      if (!response.ok) {
        throw new Error(`Failed to download IR: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Cache the buffer
      setBufferCache(prev => {
        const newCache = new Map(prev);
        newCache.set(ir.id, audioBuffer);
        return newCache;
      });

      return audioBuffer;
    } catch (err) {
      console.error(`Failed to load IR buffer for ${ir.name}:`, err);
      return null;
    }
  };

  const handleDeleteIR = async (irId: string, irName: string) => {
    try {
      setError(null);

      const wasSelected = selectedIRId === irId;

      await apiService.deleteImpulseResponse(irId);
      await loadImpulseResponses();

      // If we deleted the selected IR, auto-select another one if available
      if (wasSelected) {
        const remainingIRs = impulseResponses.filter(ir => ir.id !== irId);
        if (remainingIRs.length > 0) {
          await onSelectIR(remainingIRs[0]);
        } else {
          onClearIR(); // No IRs left, clear selection
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete IR';
      setError(errorMessage);
      handleError(err, errorMessage);
    }
  };

  // Upload files directly without confirmation
  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      let lastMetadata: ImpulseResponseMetadata | null = null;

      // Upload each file
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        const name = file.name.replace(/\.[^/.]+$/, '');

        setUploadProgress(`Uploading ${i + 1} of ${fileArray.length}...`);

        const metadata = await apiService.uploadImpulseResponse(file, name);
        lastMetadata = metadata;
      }

      setUploadProgress('All uploads complete!');

      // Reload list
      await loadImpulseResponses();

      // Auto-select the last uploaded IR
      if (lastMetadata) {
        await handleSelectIR(lastMetadata);
      }

      // Clear progress message after a delay
      setTimeout(() => setUploadProgress(''), 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      handleError(err, errorMessage);
      setUploadProgress('');
    } finally {
      setIsUploading(false);
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

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
      e.target.value = ""; // Clear input so same file can be uploaded again
    }
  };

  // Handler for IR Library Upload button - uploads directly without confirmation
  const handleIRLibraryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
      e.target.value = ""; // Clear input so same file can be uploaded again
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

      {/* Upload Section - Only show when no IRs exist in library */}
      {impulseResponses.length === 0 && (
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
            file={null}
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

          {isUploading && (
            <div className="mt-3 text-xs text-center" style={{ color: UI_COLORS.PRIMARY }}>
              {uploadProgress}
            </div>
          )}
        </div>
      )}

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

      >

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: simulationResults ? 'white' : undefined }}>
            Impulse Responses ({impulseResponses.length})
          </h3>
          <button
            onClick={() => irLibraryFileInputRef.current?.click()}
            disabled={isUploading}
            className="text-xs transition-colors disabled:opacity-40"
            style={{ color: UI_COLORS.PRIMARY }}
            onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.color = UI_COLORS.PRIMARY_HOVER)}
            onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.color = UI_COLORS.PRIMARY)}
          >
            {isUploading ? uploadProgress : 'Upload'}
          </button>
          {/* Hidden file input for IR Library Upload button */}
          <input
            ref={irLibraryFileInputRef}
            type="file"
            accept="audio/wav,.wav"
            multiple
            onChange={handleIRLibraryUpload}
            style={{ display: 'none' }}
          />
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto relative">
          {impulseResponses.length === 0 ? (
            <div className="text-xs text-center py-4" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              No impulse responses yet. Click Upload to add one!
            </div>
          ) : (
            impulseResponses.map((ir) => {
              const badge = getFormatBadge(ir.format);
              const isSelected = selectedIRId === ir.id;

              return (
                <div
                  key={ir.id}
                  className={`p-3 rounded transition-colors relative ${isSimulationMode ? 'opacity-50' : 'cursor-pointer'}`}
                  style={{
                    borderColor: isSelected ? UI_COLORS.PRIMARY : (simulationResults ? UI_COLORS.NEUTRAL_700 : UI_COLORS.NEUTRAL_200),
                    borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                    borderStyle: 'solid',
                    backgroundColor: isSelected ? `${UI_COLORS.PRIMARY}10` : 'transparent',
                    borderRadius: `${UI_CARD.BORDER_RADIUS}px`,
                    cursor: isSimulationMode ? 'not-allowed' : 'pointer'
                  }}
                  onClick={() => !isSimulationMode && handleSelectIR(ir)}
                  onMouseEnter={async (e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = simulationResults ? UI_COLORS.NEUTRAL_600 : UI_COLORS.NEUTRAL_300;
                    }

                    // Cancel any pending hide timeout
                    if (hideTimeoutRef.current) {
                      clearTimeout(hideTimeoutRef.current);
                      hideTimeoutRef.current = null;
                    }

                    setHoveredIRId(ir.id);

                    // Calculate position for fixed overlay - to the right and centered
                    const rect = e.currentTarget.getBoundingClientRect();
                    setOverlayPosition({
                      top: rect.top + (rect.height / 2), // Center vertically
                      left: rect.right + 16, // 16px gap to the right
                      width: 0 // Will be auto-sized to content
                    });

                    // Load buffer for waveform display
                    const buffer = await loadIRBuffer(ir);
                    setHoveredIRBuffer(buffer);
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = simulationResults ? UI_COLORS.NEUTRAL_700 : UI_COLORS.NEUTRAL_200;
                    }
                    // Only hide if not hovering over the overlay
                    hideTimeoutRef.current = setTimeout(() => {
                      if (!isOverlayHovered) {
                        setHoveredIRId(null);
                        setHoveredIRBuffer(null);
                        setOverlayPosition(null);
                      }
                      hideTimeoutRef.current = null;
                    }, 100);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: simulationResults ? 'white' : undefined }}>
                        {ir.name}
                      </div>

                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${badge.color}`}>
                          {badge.label}
                        </span>
                        <span className="text-xs" style={{ color: simulationResults ? UI_COLORS.NEUTRAL_400 : undefined }}>
                          {ir.sampleRate} Hz
                        </span>
                        <span className="text-xs" style={{ color: simulationResults ? UI_COLORS.NEUTRAL_400 : undefined }}>
                          {ir.duration.toFixed(2)}s
                        </span>
                        {ir.originalChannels !== ir.channels && (
                          <span className="text-xs" style={{ color: simulationResults ? UI_COLORS.NEUTRAL_400 : UI_COLORS.NEUTRAL_500 }}>
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

      {/* Waveform Overlay - Rendered as fixed position to the right of IR card */}
      {hoveredIRId && hoveredIRBuffer && overlayPosition && (
        <div
          className="fixed shadow-2xl"
          style={{
            top: `${overlayPosition.top}px`,
            left: `${overlayPosition.left}px`,
            transform: 'translateY(-50%)', // Center vertically relative to the IR card
            zIndex: 9999, // High z-index to appear above ThreeScene
            width: 'fit-content',
            maxWidth: '90vw' // Prevent overflow on small screens
          }}
          onMouseEnter={() => setIsOverlayHovered(true)}
          onMouseLeave={() => {
            setIsOverlayHovered(false);
            setHoveredIRId(null);
            setHoveredIRBuffer(null);
            setOverlayPosition(null);
          }}
        >
          <AudioWaveformDisplay
            audioBuffer={hoveredIRBuffer}
            audioInfo={{
              filename: impulseResponses.find(ir => ir.id === hoveredIRId)?.name || 'Impulse Response',
              sample_rate: hoveredIRBuffer.sampleRate,
              channels: formatChannelLabel(hoveredIRBuffer.numberOfChannels),
              duration: hoveredIRBuffer.duration,
              num_samples: hoveredIRBuffer.length
            }}
            enableWaveform={true}
            hideTextInfo={true}
          />
        </div>
      )}

      {/* Help Text - Only show when no simulation results */}
      {!simulationResults && (
        <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          <strong>Supported formats:</strong> Mono (1-ch), Binaural (2-ch), FOA (4-ch), TOA (16-ch)
          <br />
          Multi-channel files (8-32ch) are auto-extracted to FOA or TOA.
        </div>
      )}
    </div>
  );
}

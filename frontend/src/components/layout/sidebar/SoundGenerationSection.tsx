import { useState, useEffect, useRef } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import type { SoundGenerationMode } from "@/types";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { trimDisplayName } from "@/lib/utils";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { UI_COLORS, UI_CARD, UI_BUTTON, UI_TABS, AUDIO_MODEL_TANGOFLUX, AUDIO_MODEL_AUDIOLDM2, AUDIO_MODEL_NAMES } from "@/lib/constants";

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onBatchAddConfigs,
  onRemoveConfig,
  onUpdateConfig,
  onModeChange,
  onSetActiveTab,
  onGenerate,
  onStopGeneration,
  generatedSounds,
  globalDuration,
  globalSteps,
  globalNegativePrompt,
  applyDenoising,
  audioModel,
  onGlobalDurationChange,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onAudioModelChange,
  onReprocessSounds,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect,
  modelEntities = [],
  onStartLinkingEntity,
  onCancelLinkingEntity,
  isLinkingEntity = false,
  linkingConfigIndex = null
}: SoundGenerationSectionProps) {
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const prevGeneratedSoundsLengthRef = useRef(0);
  
  // Horizontal scroll for sound config tabs
  const tabsScrollRef = useHorizontalScroll<HTMLDivElement>();

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // State for inline title editing
  const [editingTabIndex, setEditingTabIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  
  // State for denoising confirmation dialog
  const [showDenoisingConfirm, setShowDenoisingConfirm] = useState(false);
  const [pendingDenoisingValue, setPendingDenoisingValue] = useState<boolean>(false);

  // Auto-collapse advanced options when sound generation completes
  useEffect(() => {
    const prevLength = prevGeneratedSoundsLengthRef.current;
    const currentLength = generatedSounds.length;

    // If sounds were just generated (went from 0 or less to more)
    if (currentLength > 0 && prevLength === 0) {
      setShowAdvancedOptions(false);
    }

    prevGeneratedSoundsLengthRef.current = currentLength;
  }, [generatedSounds.length]);

  // Helper function to get display name for a config index (trimmed to 5 words max)
  const getDisplayName = (index: number): string => {
    // First priority: display_name from the config itself (from text generation)
    const config = soundConfigs[index];
    if (config?.display_name) {
      return trimDisplayName(config.display_name);
    }

    // Second priority: display_name from generated sounds (from overlays)
    const sound = generatedSounds.find(s => s.prompt_index === index);
    if (sound?.display_name) {
      return trimDisplayName(sound.display_name);
    }

    // Fallback: generic name
    return `Sound ${index + 1}`;
  };

  // Get current config and mode
  const currentConfig = soundConfigs[activeSoundConfigTab];
  const currentMode = currentConfig?.mode || 'text-to-audio';
  const hasUploadedAudio = currentConfig?.uploadedAudioInfo !== undefined;

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

    // Store the starting tab index
    const startingTabIndex = activeSoundConfigTab;

    // Batch create all necessary tabs (one for each file after the first)
    if (files.length > 1) {
      onBatchAddConfigs(files.length - 1);
    }

    // Wait for React to batch update the state
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now upload each file to its tab
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tabIndex = i === 0 ? startingTabIndex : startingTabIndex + i;

      setUploadFile(file);
      await onUploadAudio(tabIndex, file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Store the starting tab index
    const startingTabIndex = activeSoundConfigTab;

    // Batch create all necessary tabs (one for each file after the first)
    if (fileArray.length > 1) {
      onBatchAddConfigs(fileArray.length - 1);
    }

    // Wait for React to batch update the state
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now upload each file to its tab
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const tabIndex = i === 0 ? startingTabIndex : startingTabIndex + i;

      setUploadFile(file);
      await onUploadAudio(tabIndex, file);
    }

    // Reset input so same files can be selected again
    e.target.value = "";
  };

  const handleClearAudio = () => {
    setUploadFile(null);
    onClearUploadedAudio(activeSoundConfigTab);
  };

  // Inline title editing handlers
  const handleDoubleClick = (index: number) => {
    setEditingTabIndex(index);
    setEditingValue(getDisplayName(index));
  };

  const handleEditSave = () => {
    if (editingTabIndex !== null && editingValue.trim()) {
      onUpdateConfig(editingTabIndex, 'display_name', editingValue.trim());
    }
    setEditingTabIndex(null);
  };

  const handleEditCancel = () => {
    setEditingTabIndex(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  };

  // Denoising checkbox change handler
  const handleDenoisingChange = (checked: boolean) => {
    // If sounds are already generated, show confirmation dialog
    if (generatedSounds.length > 0) {
      setPendingDenoisingValue(checked);
      setShowDenoisingConfirm(true);
    } else {
      // No sounds generated yet, just update the setting
      onApplyDenoisingChange(checked);
    }
  };

  // Confirm denoising change and reprocess sounds
  const handleConfirmDenoising = async () => {
    onApplyDenoisingChange(pendingDenoisingValue);
    setShowDenoisingConfirm(false);
    
    // Reprocess existing sounds if the callback is provided
    if (onReprocessSounds) {
      await onReprocessSounds(pendingDenoisingValue);
    }
  };

  // Cancel denoising change
  const handleCancelDenoising = () => {
    setShowDenoisingConfirm(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>Generate sounds from text descriptions</p>

      {/* Sound titles Tabs */}
      <div ref={tabsScrollRef} className="flex gap-1 overflow-x-auto pb-1">
        {soundConfigs.map((_, index) => (
          <div key={index} className="relative group flex-shrink-0">
            {editingTabIndex === index ? (
              /* Edit mode: Inline input */
              <input
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={handleEditSave}
                onKeyDown={handleEditKeyDown}
                autoFocus
                className="px-3 py-1 text-xs font-medium rounded-t outline-none"
                style={{
                  width: '120px',
                  backgroundColor: activeSoundConfigTab === index ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_300,
                  color: activeSoundConfigTab === index ? 'white' : UI_COLORS.NEUTRAL_700
                }}
              />
            ) : (
              /* View mode: Button with hover pencil */
              <button
                onClick={() => onSetActiveTab(index)}
                onDoubleClick={() => handleDoubleClick(index)}
                onMouseEnter={(e) => {
                  if (activeSoundConfigTab !== index) {
                    e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeSoundConfigTab !== index) {
                    e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_300;
                  }
                }}
                className="px-3 py-1 text-xs font-medium rounded-t transition-colors flex items-center gap-1 max-w-[120px]"
                style={{
                  backgroundColor: activeSoundConfigTab === index ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_300,
                  color: activeSoundConfigTab === index ? 'white' : UI_COLORS.NEUTRAL_700
                }}
                title={`${getDisplayName(index)} (Double-click to edit)`}
              >
                <span className="truncate">{getDisplayName(index)}</span>
                <span className="text-[10px] opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0">✏️</span>
              </button>
            )}
          </div>
        ))}
        <button
          onClick={onAddConfig}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_300}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200}
          className="px-3 py-1 text-xs font-medium rounded-t transition-colors"
          style={{
            backgroundColor: UI_COLORS.NEUTRAL_200,
            color: UI_COLORS.NEUTRAL_700
          }}
          title="Add new sound"
        >
          +
        </button>
      </div>

      {/* Sound configs Tab */}
      {soundConfigs[activeSoundConfigTab] && (
        <div 
          className="rounded"
          style={{
            padding: `${UI_CARD.PADDING}px`,
            backgroundColor: UI_COLORS.NEUTRAL_50,
            borderRadius: `${UI_CARD.BORDER_RADIUS}px`
          }}
        >
          <div className="flex justify-between items-center mb-3">
            {/* Mode dropdown - left side */}
            <div className="flex items-center gap-2">
              <label className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>Mode:</label>
              <select
                value={currentMode}
                onChange={(e) => onModeChange(activeSoundConfigTab, e.target.value as SoundGenerationMode)}
                className="text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
                style={{
                  backgroundColor: UI_COLORS.PRIMARY
                }}
              >
                <option value="text-to-audio">Text-to-Audio Generation</option>
                <option value="upload">Upload File</option>
                <option value="library">Sound Library Search</option>
                <option value="sample-audio">Sample Audio</option>
              </select>
            </div>

            {/* Action buttons - right side */}
            <div className="flex items-center gap-1">
              {/* Link to entity button - only show if model has entities */}
              {modelEntities.length > 0 && (
                <button
                  onClick={() => {
                    if (isLinkingEntity && linkingConfigIndex === activeSoundConfigTab) {
                      onCancelLinkingEntity?.();
                    } else {
                      onStartLinkingEntity?.(activeSoundConfigTab);
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (!(isLinkingEntity && linkingConfigIndex === activeSoundConfigTab)) {
                      if (soundConfigs[activeSoundConfigTab]?.entity) {
                        e.currentTarget.style.backgroundColor = `${UI_COLORS.SUCCESS}10`;
                      } else {
                        e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_100;
                      }
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!(isLinkingEntity && linkingConfigIndex === activeSoundConfigTab)) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                  style={{
                    backgroundColor: isLinkingEntity && linkingConfigIndex === activeSoundConfigTab ? UI_COLORS.PRIMARY : 'transparent',
                    color: isLinkingEntity && linkingConfigIndex === activeSoundConfigTab 
                      ? 'white' 
                      : soundConfigs[activeSoundConfigTab]?.entity 
                      ? UI_COLORS.SUCCESS 
                      : UI_COLORS.NEUTRAL_500
                  }}
                  title={
                    isLinkingEntity && linkingConfigIndex === activeSoundConfigTab
                      ? 'Cancel linking'
                      : soundConfigs[activeSoundConfigTab]?.entity
                      ? `Linked to entity ${soundConfigs[activeSoundConfigTab].entity.index}`
                      : 'Link to entity'
                  }
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                </button>
              )}

              {/* Remove button */}
              {soundConfigs.length > 1 && (
                <button
                  onClick={() => onRemoveConfig(activeSoundConfigTab)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = UI_COLORS.ERROR;
                    e.currentTarget.style.backgroundColor = `${UI_COLORS.ERROR}10`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = UI_COLORS.PRIMARY;
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  className="w-6 h-6 flex items-center justify-center text-lg rounded-full transition-colors"
                  style={{
                    color: UI_COLORS.PRIMARY
                  }}
                  title="Remove sound"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* Entity linking status message */}
          {isLinkingEntity && linkingConfigIndex === activeSoundConfigTab && (
            <div 
              className="mb-3 rounded text-xs"
              style={{
                padding: '8px',
                backgroundColor: UI_COLORS.INFO_LIGHT,
                borderColor: UI_COLORS.INFO,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px',
                color: UI_COLORS.INFO
              }}
            >
              <div className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Click on an entity in the 3D view to link this sound</span>
              </div>
            </div>
          )}

          {/* Linked entity info */}
          {soundConfigs[activeSoundConfigTab]?.entity && (
            <div 
              className="mb-3 rounded text-xs"
              style={{
                padding: '8px',
                backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                borderColor: UI_COLORS.SUCCESS,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px',
                color: UI_COLORS.SUCCESS
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>
                    Linked to entity: {soundConfigs[activeSoundConfigTab].entity.name || `Entity ${soundConfigs[activeSoundConfigTab].entity.index}`}
                  </span>
                </div>
                <button
                  onClick={() => onUpdateConfig(activeSoundConfigTab, 'entity' as any, undefined as any)}
                  onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.SUCCESS}
                  onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.SUCCESS}
                  style={{ color: UI_COLORS.SUCCESS }}
                  title="Unlink entity"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {/* Conditional UI based on mode */}
          {currentMode === 'text-to-audio' && (
            <>
              {/* Text-to-Audio Generation UI */}
              <textarea
                value={soundConfigs[activeSoundConfigTab].prompt}
                onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'prompt', e.target.value)}
                onKeyDown={(e) => {
                  if (e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault();
                    if (!isSoundGenerating) {
                      onGenerate();
                    }
                  }
                }}
                placeholder="e.g., Hammer hitting wooden table"
                className="w-full h-16 p-2 text-sm rounded mb-2"
                style={{
                  backgroundColor: 'white',
                  borderColor: UI_COLORS.NEUTRAL_300,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderRadius: '8px'
                }}
                rows={2}
              />

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>Duration: {soundConfigs[activeSoundConfigTab].duration}s</label>
                  <input
                    type="range"
                    value={soundConfigs[activeSoundConfigTab].duration}
                    onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'duration', parseInt(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
                    min="1"
                    max="30"
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>Guidance: {((soundConfigs[activeSoundConfigTab].guidance_scale ?? 4.5) / 10).toFixed(1)}</label>
                  <input
                    type="range"
                    value={soundConfigs[activeSoundConfigTab].guidance_scale ?? 4.5}
                    onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'guidance_scale', parseFloat(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
                    min="0"
                    max="10"
                    step="0.5"
                  />
                </div>
              </div>

              <div className="mb-2">
                <label className="text-xs block mb-1" style={{ color: UI_COLORS.NEUTRAL_700 }}>Number of variants: {soundConfigs[activeSoundConfigTab].seed_copies}</label>
                <input
                  type="range"
                  value={soundConfigs[activeSoundConfigTab].seed_copies}
                  onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'seed_copies', parseInt(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
                  style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
                  min="1"
                  max="5"
                />
              </div>
            </>
          )}

          {currentMode === 'upload' && (
            <>
              {/* Upload File UI */}
              {!hasUploadedAudio ? (
                <FileUploadArea
                  file={uploadFile}
                  isDragging={isDragging}
                  acceptedFormats="audio/*,.wav,.mp3,.ogg,.flac"
                  acceptedExtensions=".wav, .mp3, .ogg, .flac"
                  onFileChange={handleFileChange}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  inputId={`sound-upload-${activeSoundConfigTab}`}
                  multiple={true}
                />
              ) : (
                <div className="space-y-2">
                  {/* Waveform Display */}
                  {currentConfig.uploadedAudioBuffer && currentConfig.uploadedAudioInfo && (
                    <AudioWaveformDisplay
                      audioBuffer={currentConfig.uploadedAudioBuffer}
                      audioInfo={currentConfig.uploadedAudioInfo}
                    />
                  )}

                  {/* Clear audio button */}
                  <button
                    onClick={handleClearAudio}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_500}
                    className="w-full text-xs py-1.5 px-3 text-white rounded transition-colors"
                    style={{
                      backgroundColor: UI_COLORS.NEUTRAL_500,
                      borderRadius: '8px'
                    }}
                  >
                    Clear Uploaded Audio
                  </button>
                </div>
              )}
            </>
          )}

          {currentMode === 'library' && (
            <>
              {/* Sound Library Search UI */}
              <div className="space-y-2">
                {/* Search Input */}
                <div className="flex gap-2">
                  <textarea
                    value={soundConfigs[activeSoundConfigTab].prompt}
                    onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'prompt', e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        if (currentConfig.prompt.trim() && !currentConfig.librarySearchState?.isSearching) {
                          onLibrarySearch(activeSoundConfigTab);
                        }
                      }
                    }}
                    placeholder="e.g., Urban traffic, birds chirping, footsteps"
                    className="flex-1 h-12 p-2 text-sm rounded"
                    style={{
                      backgroundColor: 'white',
                      borderColor: UI_COLORS.NEUTRAL_300,
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderRadius: '8px'
                    }}
                    rows={2}
                  />
                  <button
                    onClick={() => onLibrarySearch(activeSoundConfigTab)}
                    disabled={!currentConfig.prompt.trim() || currentConfig.librarySearchState?.isSearching}
                    onMouseEnter={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.opacity = '0.8';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!e.currentTarget.disabled) {
                        e.currentTarget.style.opacity = '1';
                      }
                    }}
                    className="px-4 py-2 text-xs font-medium text-white rounded transition-colors disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: !currentConfig.prompt.trim() || currentConfig.librarySearchState?.isSearching ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
                      borderRadius: '8px',
                      opacity: !currentConfig.prompt.trim() || currentConfig.librarySearchState?.isSearching ? 0.4 : 1
                    }}
                  >
                    {currentConfig.librarySearchState?.isSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {/* Search Results */}
                {currentConfig.librarySearchState?.results && currentConfig.librarySearchState.results.length > 0 && (
                  <div
                    className="rounded p-2 max-h-64 overflow-y-auto"
                    style={{
                      backgroundColor: 'white',
                      borderRadius: '8px'
                    }}
                  >
                    <p className="text-xs font-medium mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                      Found {currentConfig.librarySearchState.results.length} results:
                    </p>
                    <div className="space-y-1">
                      {currentConfig.librarySearchState.results.map((result) => (
                        <button
                          key={result.location}
                          onClick={() => onLibrarySoundSelect(activeSoundConfigTab, result)}
                          onMouseEnter={(e) => {
                            if (currentConfig.selectedLibrarySound?.location !== result.location) {
                              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (currentConfig.selectedLibrarySound?.location !== result.location) {
                              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_100;
                            }
                          }}
                          className="w-full text-left p-2 rounded text-xs transition-colors"
                          style={{
                            backgroundColor: currentConfig.selectedLibrarySound?.location === result.location ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_100,
                            color: currentConfig.selectedLibrarySound?.location === result.location ? 'white' : UI_COLORS.NEUTRAL_700,
                            borderRadius: '8px'
                          }}
                        >
                          <div className="font-medium truncate">{result.description}</div>
                          <div className="text-[10px] opacity-75 flex justify-between mt-0.5">
                            <span>{result.category}</span>
                            <span>{result.duration}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* No Results Message */}
                {currentConfig.librarySearchState?.results && currentConfig.librarySearchState.results.length === 0 && !currentConfig.librarySearchState.isSearching && (
                  <p className="text-xs text-center py-4" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    No sounds found. Try a different search term.
                  </p>
                )}

                {/* Error Message */}
                {currentConfig.librarySearchState?.error && (
                  <p
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
                    {currentConfig.librarySearchState.error}
                  </p>
                )}

                {/* Help Text */}
                {!currentConfig.librarySearchState?.results && !currentConfig.librarySearchState?.isSearching && (
                  <p className="text-xs italic" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    Enter search terms and click "Search" to find sounds from the BBC Sound Effects library
                  </p>
                )}
              </div>
            </>
          )}

          {currentMode === 'sample-audio' && (
            <>
              {/* Sample Audio UI */}
              <div className="space-y-2">
                {/* Waveform Display */}
                {currentConfig.uploadedAudioBuffer && currentConfig.uploadedAudioInfo && (
                  <AudioWaveformDisplay
                    audioBuffer={currentConfig.uploadedAudioBuffer}
                    audioInfo={currentConfig.uploadedAudioInfo}
                  />
                )}

                {/* Clear audio button */}
                <button
                  onClick={handleClearAudio}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_500}
                  className="w-full text-xs py-1.5 px-3 text-white rounded transition-colors"
                  style={{
                    backgroundColor: UI_COLORS.NEUTRAL_500,
                    borderRadius: '8px'
                  }}
                >
                  Clear Sample Audio
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Generate button and Stop button */}
      <div className="flex gap-2">
        <button
          onClick={onGenerate}
          disabled={isSoundGenerating}
          onMouseEnter={(e) => {
            if (!isSoundGenerating) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isSoundGenerating) {
              e.currentTarget.style.opacity = '1';
            }
          }}
          className="flex-1 text-white transition-colors"
          style={{
            borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
            padding: UI_BUTTON.PADDING_MD,
            fontSize: UI_BUTTON.FONT_SIZE,
            fontWeight: UI_BUTTON.FONT_WEIGHT,
            backgroundColor: isSoundGenerating ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            opacity: isSoundGenerating ? 0.4 : 1,
            cursor: isSoundGenerating ? 'not-allowed' : 'pointer'
          }}
        >
          {isSoundGenerating ? 'Generating Sounds...' : 'Generate Sounds'}
        </button>

        {/* Stop button - only visible when generating */}
        {isSoundGenerating && (
          <button
            onClick={onStopGeneration}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.ERROR}
            className="w-10 h-10 rounded text-white font-bold transition-colors flex items-center justify-center"
            style={{
              backgroundColor: UI_COLORS.ERROR,
              borderRadius: '8px'
            }}
            title="Stop generation"
            aria-label="Stop generation"
          >
            <span className="text-lg leading-none">■</span>
          </button>
        )}
      </div>

      {soundGenError && (
        <div 
          className="p-3 text-sm rounded"
          style={{
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.ERROR
          }}
        >
          {soundGenError}
        </div>
      )}

      {/* Advanced Options - Collapsible, hidden by default, only show before generation */}
      <div 
        className="rounded"
        style={{
          backgroundColor: UI_COLORS.NEUTRAL_50,
          borderRadius: '8px'
        }}
      >
        <button
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_100}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          className="w-full p-3 flex items-center justify-between text-sm font-semibold transition-colors rounded"
          style={{
            color: UI_COLORS.NEUTRAL_700
          }}
        >
          <span>Advanced Options</span>
          <span className="text-xs">{showAdvancedOptions ? '▼' : '▶'}</span>
        </button>

        {showAdvancedOptions && (
          <div className="p-3 pt-0 space-y-3">
            {/* Background Noise Removal - Standalone */}
            <div className="relative">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyDenoising}
                  onChange={(e) => handleDenoisingChange(e.target.checked)}
                  className="w-4 h-4 accent-primary cursor-pointer"
                />
                <span className="text-sm font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                  Remove Background Noise
                </span>
              </label>
              <p className="text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                Apply noise reduction to clean up generated sounds
              </p>
              
              {/* Confirmation Dialog */}
              {showDenoisingConfirm && (
                <div 
                  className="mt-2 p-3 rounded-lg"
                  style={{
                    backgroundColor: UI_COLORS.WARNING_LIGHT,
                    borderColor: UI_COLORS.WARNING,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderRadius: '8px'
                  }}
                >
                  <p className="text-xs mb-2" style={{ color: UI_COLORS.WARNING }}>
                    {pendingDenoisingValue 
                      ? "Apply noise reduction to all existing sounds?"
                      : "Remove noise reduction from all existing sounds?"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmDenoising}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                      className="flex-1 px-3 py-1.5 text-xs font-medium text-white rounded transition-colors"
                      style={{
                        backgroundColor: UI_COLORS.PRIMARY,
                        borderRadius: '8px'
                      }}
                    >
                      Yes, modify sounds
                    </button>
                    <button
                      onClick={handleCancelDenoising}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_300}
                      className="flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors"
                      style={{
                        backgroundColor: UI_COLORS.NEUTRAL_300,
                        color: UI_COLORS.NEUTRAL_800,
                        borderRadius: '8px'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Audio Model Selection */}
            <div
              className="rounded-lg p-3"
              style={{
                backgroundColor: 'white',
                borderRadius: '8px'
              }}
            >
              <h4 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: UI_COLORS.NEUTRAL_600 }}>
                Audio Generation Model
              </h4>

              <div>
                <label className="text-sm font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                  Select Model
                </label>
                <select
                  value={audioModel}
                  onChange={(e) => onAudioModelChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  style={{
                    backgroundColor: 'white',
                    borderColor: UI_COLORS.NEUTRAL_300,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderRadius: '8px',
                    color: UI_COLORS.NEUTRAL_700
                  }}
                >
                  <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
                  <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
                </select>
                <p className="text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                  {audioModel === AUDIO_MODEL_TANGOFLUX
                    ? "TangoFlux: Fast, high-quality text-to-audio generation (default)"
                    : "AudioLDM2: Alternative model with different audio characteristics"
                  }
                </p>
              </div>
            </div>

            {/* Text-to-Audio Parameters Group */}
            <div
              className="rounded-lg p-3"
              style={{
                backgroundColor: 'white',
                borderRadius: '8px'
              }}
            >
              <h4 className="text-xs font-semibold mb-3 uppercase tracking-wide" style={{ color: UI_COLORS.NEUTRAL_600 }}>
                Text-to-Audio Parameters
              </h4>
              
              <div className="space-y-3">
                {/* Global Duration Slider */}
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                    Global Duration: {globalDuration}s
                  </label>
                  <input
                    type="range"
                    value={globalDuration}
                    onChange={(e) => onGlobalDurationChange(parseInt(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
                    min="1"
                    max="30"
                  />
                  <p className="text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    Applies to all sound tabs
                  </p>
                </div>

                {/* Diffusion Steps Slider */}
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                    Diffusion Steps: {globalSteps}
                  </label>
                  <input
                    type="range"
                    value={globalSteps}
                    onChange={(e) => onGlobalStepsChange(parseInt(e.target.value))}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
                    style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
                    min="10"
                    max="100"
                    step="5"
                  />
                  <p className="text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    Higher steps = better quality but slower generation
                  </p>
                </div>

                {/* Global Negative Prompt */}
                <div>
                  <label className="text-sm font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                    Global Negative Prompt
                  </label>
                  <textarea
                    value={globalNegativePrompt}
                    onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault();
                        if (!isSoundGenerating) {
                          onGenerate();
                        }
                      }
                    }}
                    placeholder="e.g., distorted, reverb, echo"
                    className="w-full p-2 text-xs rounded"
                    style={{
                      backgroundColor: 'white',
                      borderColor: UI_COLORS.NEUTRAL_300,
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderRadius: '8px'
                    }}
                    rows={2}
                  />
                  <p className="text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                    Terms to avoid in all generated sounds
                  </p>
                </div>
              </div>
            </div>


          </div>
        )}
      </div>
    </div>
  );
}

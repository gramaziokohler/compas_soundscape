import { useState, useEffect, useRef } from "react";
import type { SoundGenerationSectionProps } from "@/types/components";
import type { SoundGenerationMode } from "@/types";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { trimDisplayName } from "@/lib/utils";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onModeChange,
  onSetActiveTab,
  onGenerate,
  generatedSounds,
  globalDuration,
  globalSteps,
  globalNegativePrompt,
  applyDenoising,
  onGlobalDurationChange,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onReprocessSounds,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect
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

    const file = e.dataTransfer.files[0];
    if (file) {
      setUploadFile(file);
      await onUploadAudio(activeSoundConfigTab, file);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      await onUploadAudio(activeSoundConfigTab, file);
      // Reset input so same file can be selected again
      e.target.value = "";
    }
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
      <p className="text-sm text-gray-600 dark:text-gray-400">Generate sounds from text descriptions</p>

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
                className={`px-3 py-1 text-xs font-medium rounded-t outline-none ${
                  activeSoundConfigTab === index
                    ? 'bg-primary text-white'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300'
                }`}
                style={{ width: '120px' }}
              />
            ) : (
              /* View mode: Button with hover pencil */
              <button
                onClick={() => onSetActiveTab(index)}
                onDoubleClick={() => handleDoubleClick(index)}
                className={`px-3 py-1 text-xs font-medium rounded-t transition-colors flex items-center gap-1 max-w-[120px] ${
                  activeSoundConfigTab === index
                    ? 'bg-primary text-white'
                    : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500'
                }`}
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
          className="px-3 py-1 text-xs font-medium bg-gray-200 dark:bg-gray-700 rounded-t hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          title="Add new sound"
        >
          +
        </button>
      </div>

      {/* Sound configs Tab */}
      {soundConfigs[activeSoundConfigTab] && (
        <div className="p-3 border rounded bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
          <div className="flex justify-between items-center mb-3">
            {/* Mode dropdown - left side */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600 dark:text-gray-400">Mode:</label>
              <select
                value={currentMode}
                onChange={(e) => onModeChange(activeSoundConfigTab, e.target.value as SoundGenerationMode)}
                className="text-xs px-2 py-1 text-white bg-primary dark:bg-gray-800 border dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-white"
              >
                <option value="text-to-audio">Text-to-Audio Generation</option>
                <option value="upload">Upload File</option>
                <option value="library">Sound Library Search</option>
              </select>
            </div>

            {/* Remove button - right side */}
            {soundConfigs.length > 1 && (
              <button
                onClick={() => onRemoveConfig(activeSoundConfigTab)}
                className="w-6 h-6 flex items-center justify-center text-lg text-primary hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                title="Remove sound"
              >
                ×
              </button>
            )}
          </div>

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
                className="w-full h-16 p-2 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 mb-2"
                rows={2}
              />

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="text-xs block mb-1">Duration: {soundConfigs[activeSoundConfigTab].duration}s</label>
                  <input
                    type="range"
                    value={soundConfigs[activeSoundConfigTab].duration}
                    onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'duration', parseInt(e.target.value))}
                    className="w-full accent-primary"
                    min="1"
                    max="30"
                  />
                </div>
                <div>
                  <label className="text-xs block mb-1">Guidance: {((soundConfigs[activeSoundConfigTab].guidance_scale ?? 4.5) / 10).toFixed(1)}</label>
                  <input
                    type="range"
                    value={soundConfigs[activeSoundConfigTab].guidance_scale ?? 4.5}
                    onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'guidance_scale', parseFloat(e.target.value))}
                    className="w-full accent-primary"
                    min="0"
                    max="10"
                    step="0.5"
                  />
                </div>
              </div>

              <div className="mb-2">
                <label className="text-xs block mb-1">Number of variants: {soundConfigs[activeSoundConfigTab].seed_copies}</label>
                <input
                  type="range"
                  value={soundConfigs[activeSoundConfigTab].seed_copies}
                  onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'seed_copies', parseInt(e.target.value))}
                  className="w-full accent-primary"
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
                    className="w-full text-xs py-1.5 px-3 bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
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
                    className="flex-1 h-12 p-2 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    rows={2}
                  />
                  <button
                    onClick={() => onLibrarySearch(activeSoundConfigTab)}
                    disabled={!currentConfig.prompt.trim() || currentConfig.librarySearchState?.isSearching}
                    className="px-4 py-2 text-xs font-medium bg-primary hover:bg-primary-hover text-white rounded transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {currentConfig.librarySearchState?.isSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>

                {/* Search Results */}
                {currentConfig.librarySearchState?.results && currentConfig.librarySearchState.results.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded p-2 max-h-64 overflow-y-auto">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Found {currentConfig.librarySearchState.results.length} results:
                    </p>
                    <div className="space-y-1">
                      {currentConfig.librarySearchState.results.map((result) => (
                        <button
                          key={result.location}
                          onClick={() => onLibrarySoundSelect(activeSoundConfigTab, result)}
                          className={`w-full text-left p-2 rounded text-xs transition-colors ${
                            currentConfig.selectedLibrarySound?.location === result.location
                              ? 'bg-primary text-white'
                              : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
                          }`}
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
                    No sounds found. Try a different search term.
                  </p>
                )}

                {/* Error Message */}
                {currentConfig.librarySearchState?.error && (
                  <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-2">
                    {currentConfig.librarySearchState.error}
                  </p>
                )}

                {/* Help Text */}
                {!currentConfig.librarySearchState?.results && !currentConfig.librarySearchState?.isSearching && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                    Enter search terms and click "Search" to find sounds from the BBC Sound Effects library
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={onGenerate}
        disabled={isSoundGenerating}
        className={`w-full py-2 px-4 text-white font-semibold rounded transition-colors ${
          isSoundGenerating
            ? 'bg-gray-300 dark:bg-gray-700'
            : 'bg-primary hover:bg-primary-hover'
        }`}
      >
        {isSoundGenerating ? 'Generating Sounds...' : 'Generate Sounds'}
      </button>

      {soundGenError && (
        <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          {soundGenError}
        </div>
      )}

      {/* Advanced Options - Collapsible, hidden by default, only show before generation */}
      <div className="border rounded bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
        <button
          onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
          className="w-full p-3 flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors rounded"
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
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Remove Background Noise
                </span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Apply noise reduction to clean up generated sounds
              </p>
              
              {/* Confirmation Dialog */}
              {showDenoisingConfirm && (
                <div className="mt-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                  <p className="text-xs text-yellow-800 dark:text-yellow-300 mb-2">
                    {pendingDenoisingValue 
                      ? "Apply noise reduction to all existing sounds?"
                      : "Remove noise reduction from all existing sounds?"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleConfirmDenoising}
                      className="flex-1 px-3 py-1.5 text-xs font-medium bg-primary hover:bg-primary-hover text-white rounded transition-colors"
                    >
                      Yes, modify sounds
                    </button>
                    <button
                      onClick={handleCancelDenoising}
                      className="flex-1 px-3 py-1.5 text-xs font-medium bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>


            {/* Text-to-Audio Parameters Group */}
            <div className="border border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-800">
              <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
                Text-to-Audio Parameters
              </h4>
              
              <div className="space-y-3">
                {/* Global Duration Slider */}
                <div>
                  <label className="text-sm font-medium block mb-2 text-gray-700 dark:text-gray-300">
                    Global Duration: {globalDuration}s
                  </label>
                  <input
                    type="range"
                    value={globalDuration}
                    onChange={(e) => onGlobalDurationChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600 accent-primary"
                    min="1"
                    max="30"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Applies to all sound tabs
                  </p>
                </div>

                {/* Diffusion Steps Slider */}
                <div>
                  <label className="text-sm font-medium block mb-2 text-gray-700 dark:text-gray-300">
                    Diffusion Steps: {globalSteps}
                  </label>
                  <input
                    type="range"
                    value={globalSteps}
                    onChange={(e) => onGlobalStepsChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-600 accent-primary"
                    min="10"
                    max="100"
                    step="5"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Higher steps = better quality but slower generation
                  </p>
                </div>

                {/* Global Negative Prompt */}
                <div>
                  <label className="text-sm font-medium block mb-2 text-gray-700 dark:text-gray-300">
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
                    className="w-full p-2 text-xs border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                    rows={2}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
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

import type { ModelLoadSectionProps } from "@/types/components";
import { isAudioFile, is3DModelFile, formatConfidence } from "@/lib/audio/audio-info";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { AUDIO_VISUALIZATION, MODEL_FILE_EXTENSIONS, AUDIO_FILE_EXTENSIONS, UI_COLORS, UI_CARD, UI_BUTTON } from "@/lib/constants";

export function ModelLoadSection({
  modelEntities,
  activeLoadTab,
  modelFile,
  audioFile,
  isDragging,
  isUploading,
  isAnalyzingModel,
  uploadError,
  analysisProgress,
  useModelAsContext,
  isSEDAnalyzing = false,
  sedAudioInfo = null,
  sedAudioBuffer = null,
  sedDetectedSounds = [],
  sedError = null,
  sedAnalysisOptions = { analyze_amplitudes: true, analyze_durations: true, analyze_frequencies: false },
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onUploadModel,
  onLoadSampleIfc,
  setActiveLoadTab,
  setUseModelAsContext,
  onAnalyzeSoundEvents,
  onToggleSEDOption,
  onLoadSoundsFromSED,
  // New props for entity analysis
  selectedDiverseEntities = [],
  isAnalyzingEntities = false,
  llmProgress = '',
  numSounds = 5,
  onAnalyzeModel,
  onStopGeneration
}: ModelLoadSectionProps) {
  // Has SED analysis completed successfully?
  const hasSEDResults = sedDetectedSounds && sedDetectedSounds.length > 0;
  const hasModelLoaded = modelEntities.length > 0;
  const hasAudioFile = audioFile !== null;

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        Context (3D model or sound recording)
      </p>
      <div className="flex flex-col gap-4">
        {/* Show upload area only when neither file is in process and at least one type is not loaded */}
        {!isUploading && !isAnalyzingModel && !isSEDAnalyzing && (!hasModelLoaded || !hasAudioFile) && (
          <>
            {activeLoadTab === 'upload' && (
              <div className="flex flex-col gap-2">
                <div
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                  className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                    isDragging
                      ? 'border-primary bg-primary-light'
                      : 'border-gray-300 dark:border-gray-600 hover:border-primary'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    {modelFile || audioFile ? (
                      <>
                        <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {modelFile?.name || audioFile?.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {audioFile ? '🎵 Audio file' : modelFile ? '🏗️ 3D model' : '📄 File'}
                        </p>
                        <label
                          htmlFor="file-upload"
                          className="cursor-pointer font-medium text-xs text-primary hover:text-primary-hover"
                        >
                          Choose different file
                        </label>
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          Drag & drop or
                        </p>
                        <label
                          htmlFor="file-upload"
                          className="cursor-pointer font-medium text-xs text-primary hover:text-primary-hover"
                        >
                          Browse ({[...MODEL_FILE_EXTENSIONS, '.wav', '.mp3'].join(', ')})
                        </label>
                      </>
                    )}
                    <input
                      id="file-upload"
                      type="file"
                      onChange={onFileChange}
                      accept={[...MODEL_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS].join(',')}
                      className="hidden"
                    />
                  </div>
                </div>

                {uploadError && (
                  <div
                    className="rounded text-xs"
                    style={{
                      padding: `${UI_CARD.PADDING - 4}px`,
                      backgroundColor: UI_COLORS.ERROR_LIGHT,
                      borderColor: UI_COLORS.ERROR,
                      borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                      borderStyle: 'solid',
                      color: UI_COLORS.ERROR
                    }}
                  >
                    {uploadError}
                  </div>
                )}
              </div>
            )}

            {activeLoadTab === 'sample' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={onLoadSampleIfc}
                  disabled={isUploading || isAnalyzingModel}
                  className="w-full text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
                  style={{
                    borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
                    padding: UI_BUTTON.PADDING_MD,
                    fontSize: UI_BUTTON.FONT_SIZE,
                    fontWeight: UI_BUTTON.FONT_WEIGHT,
                    backgroundColor: UI_COLORS.PRIMARY
                  }}
                  onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
                  onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
                >
                  {isUploading || isAnalyzingModel ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      {isUploading ? "Loading..." : "Analyzing..."}
                    </>
                  ) : (
                    "Load Duplex Sample"
                  )}
                </button>

                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useModelAsContext}
                    onChange={(e) => setUseModelAsContext(e.target.checked)}
                    className="w-4 h-4 rounded focus:ring-2 accent-primary"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    Use model as context for sound generation
                  </span>
                </label>

                {isAnalyzingModel && analysisProgress && (
                  <div
                    className="rounded text-xs"
                    style={{
                      padding: `${UI_CARD.PADDING - 4}px`,
                      backgroundColor: UI_COLORS.INFO_LIGHT,
                      borderColor: UI_COLORS.INFO,
                      borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                      borderStyle: 'solid',
                      color: UI_COLORS.INFO_HOVER
                    }}
                  >
                    🔍 {analysisProgress}
                  </div>
                )}

                {!useModelAsContext && !isUploading && (
                  <div
                    className="rounded text-xs"
                    style={{
                      padding: `${UI_CARD.PADDING - 4}px`,
                      backgroundColor: UI_COLORS.WARNING_LIGHT,
                      borderColor: UI_COLORS.WARNING,
                      borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                      borderStyle: 'solid',
                      color: UI_COLORS.WARNING_HOVER
                    }}
                  >
                    ℹ️ Model will be used for positioning only
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Loaded 3D Model UI */}
        {hasModelLoaded && (
          <div className="flex flex-col gap-2">
            {/* Only show "Model loaded" message if not analyzing and no entities selected */}
            {!isAnalyzingEntities && selectedDiverseEntities.length === 0 && (
              <div
                className="rounded-lg"
                style={{
                  padding: `${UI_CARD.PADDING}px`,
                  backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                  borderColor: UI_COLORS.SUCCESS,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid',
                  borderRadius: `${UI_CARD.BORDER_RADIUS}px`
                }}
              >
                <p className="text-xs font-semibold" style={{ color: UI_COLORS.SUCCESS }}>
                  ✓ Model loaded with {modelEntities.length} objects
                </p>
              </div>
            )}

            {/* Analyze 3D Model button - Always show, label changes based on state */}
            <button
              onClick={onAnalyzeModel}
              disabled={isAnalyzingEntities}
              className="w-full text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
              style={{
                borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
                padding: UI_BUTTON.PADDING_MD,
                fontSize: UI_BUTTON.FONT_SIZE,
                fontWeight: UI_BUTTON.FONT_WEIGHT,
                backgroundColor: UI_COLORS.PRIMARY
              }}
              onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
              onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
            >
              {isAnalyzingEntities ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Analyzing...
                </>
              ) : selectedDiverseEntities.length > 0 ? (
                `Re-analyze 3D Model (${numSounds} diverse objects)`
              ) : (
                `Analyze 3D Model (${numSounds} diverse objects)`
              )}
            </button>

            {/* Progress message during analysis */}
            {isAnalyzingEntities && llmProgress && (
              <div
                className="rounded text-xs"
                style={{
                  padding: `${UI_CARD.PADDING - 4}px`,
                  backgroundColor: UI_COLORS.INFO_LIGHT,
                  borderColor: UI_COLORS.INFO,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid',
                  color: UI_COLORS.INFO_HOVER
                }}
              >
                🔍 {llmProgress}
              </div>
            )}

            {/* Analysis complete - show success message and checkbox */}
            {selectedDiverseEntities.length > 0 && !isAnalyzingEntities && (
              <>
                <div
                  className="rounded-lg"
                  style={{
                    padding: `${UI_CARD.PADDING}px`,
                    backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                    borderColor: UI_COLORS.SUCCESS,
                    borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                    borderStyle: 'solid'
                  }}
                >
                  <p className="text-xs font-semibold" style={{ color: UI_COLORS.SUCCESS }}>
                    ✨ {selectedDiverseEntities.length} diverse objects selected
                  </p>
                </div>

                <label className="flex items-center gap-2 px-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useModelAsContext}
                    onChange={(e) => setUseModelAsContext(e.target.checked)}
                    className="w-4 h-4 rounded focus:ring-2 accent-primary"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    Use model as context for sound generation
                  </span>
                </label>

                {!useModelAsContext && (
                  <div
                    className="rounded text-xs"
                    style={{
                      padding: `${UI_CARD.PADDING - 4}px`,
                      backgroundColor: UI_COLORS.WARNING_LIGHT,
                      borderColor: UI_COLORS.WARNING,
                      borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                      borderStyle: 'solid',
                      color: UI_COLORS.WARNING_HOVER
                    }}
                  >
                    ℹ️ Model will be used for positioning only
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Loaded Audio File UI - Show selected file waiting for analysis OR show analysis results */}
        {hasAudioFile && (
          <div className="flex flex-col gap-2">
            {/* Show audio info immediately if available */}
            {sedAudioInfo && sedAudioBuffer && AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY && (
              <AudioWaveformDisplay
                audioBuffer={sedAudioBuffer}
                audioInfo={sedAudioInfo}
              />
            )}

            {/* Analysis options before analysis */}
            {!hasSEDResults && (
              <div
                className="rounded-lg"
                style={{
                  padding: `${UI_CARD.PADDING}px`,
                  backgroundColor: UI_COLORS.NEUTRAL_100,
                  borderColor: UI_COLORS.NEUTRAL_300,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid'
                }}
              >
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Analysis Options</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sedAnalysisOptions.analyze_amplitudes}
                      onChange={(e) => onToggleSEDOption?.('analyze_amplitudes', e.target.checked)}
                      className="w-4 h-4 rounded focus:ring-2 accent-primary"
                    />
                    <span className="text-xs text-gray-700 dark:text-gray-300">
                      Analyze amplitudes (dB levels)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sedAnalysisOptions.analyze_durations}
                      onChange={(e) => onToggleSEDOption?.('analyze_durations', e.target.checked)}
                      className="w-4 h-4 rounded focus:ring-2 accent-primary"
                    />
                    <span className="text-xs text-gray-700 dark:text-gray-300">
                      Analyze temporal durations
                    </span>
                  </label>
                </div>
              </div>
            )}

            {/* Main action button */}
            <div className="flex gap-2">
              <button
                onClick={onAnalyzeSoundEvents}
                disabled={isSEDAnalyzing}
                className={`${hasSEDResults ? 'flex-1' : 'w-full'} text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40`}
                style={{
                  borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
                  padding: UI_BUTTON.PADDING_MD,
                  fontSize: UI_BUTTON.FONT_SIZE,
                  fontWeight: UI_BUTTON.FONT_WEIGHT,
                  backgroundColor: UI_COLORS.PRIMARY
                }}
                onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
                onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
              >
                {isSEDAnalyzing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Analyzing sounds...
                  </>
                ) : (
                  "Analyze Sound Events"
                )}
              </button>

              {hasSEDResults && (
                <button
                  onClick={onLoadSoundsFromSED}
                  className="flex-1 text-white transition-colors"
                  style={{
                    borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
                    padding: UI_BUTTON.PADDING_MD,
                    fontSize: UI_BUTTON.FONT_SIZE,
                    fontWeight: UI_BUTTON.FONT_WEIGHT,
                    backgroundColor: UI_COLORS.SUCCESS
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS_HOVER}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS}
                  title="Load detected sounds into generation tab"
                >
                  Load Sounds →
                </button>
              )}
            </div>

            {/* SED Error Display */}
            {sedError && !hasSEDResults && (
              <div
                className="rounded-lg"
                style={{
                  padding: `${UI_CARD.PADDING}px`,
                  backgroundColor: UI_COLORS.ERROR_LIGHT,
                  borderColor: UI_COLORS.ERROR,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid'
                }}
              >
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: UI_COLORS.ERROR }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-xs font-semibold mb-1" style={{ color: UI_COLORS.ERROR }}>Analysis Failed</p>
                    <p className="text-xs" style={{ color: UI_COLORS.ERROR_HOVER }}>{sedError}</p>
                  </div>
                </div>
              </div>
            )}

            {/* SED Results Display */}
            {hasSEDResults && (
              <div
                className="rounded-lg"
                style={{
                  padding: `${UI_CARD.PADDING}px`,
                  backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                  borderColor: UI_COLORS.SUCCESS,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid'
                }}
              >
                <p className="text-xs font-semibold mb-2 flex items-center" style={{ color: UI_COLORS.SUCCESS }}>
                  <span className="mr-2">✨</span>
                  Detected Sound Events:
                </p>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {sedDetectedSounds.map((sound, idx) => (
                    <div key={idx} className="text-xs flex justify-between items-center gap-2" style={{ color: UI_COLORS.SUCCESS_HOVER }}>
                      <span className="flex-1">{sound.name}</span>
                      <div className="flex items-center gap-2 font-mono text-right">
                        <span>{formatConfidence(sound.confidence)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Progress/Loading UI for model being uploaded */}
        {modelFile && !hasModelLoaded && (isUploading || isAnalyzingModel) && (
          <div className="flex flex-col gap-2">
            <div
              className="rounded-lg"
              style={{
                padding: `${UI_CARD.PADDING}px`,
                backgroundColor: UI_COLORS.INFO_LIGHT,
                borderColor: UI_COLORS.INFO,
                borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                borderStyle: 'solid'
              }}
            >
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" style={{ color: UI_COLORS.INFO }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <p className="text-xs font-semibold" style={{ color: UI_COLORS.INFO }}>
                  {isUploading ? "Loading model..." : "Analyzing model..."}
                </p>
              </div>
            </div>

            {analysisProgress && (
              <div
                className="rounded text-xs"
                style={{
                  padding: `${UI_CARD.PADDING - 4}px`,
                  backgroundColor: UI_COLORS.INFO_LIGHT,
                  borderColor: UI_COLORS.INFO,
                  borderWidth: `${UI_CARD.BORDER_WIDTH}px`,
                  borderStyle: 'solid',
                  color: UI_COLORS.INFO_HOVER
                }}
              >
                🔍 {analysisProgress}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

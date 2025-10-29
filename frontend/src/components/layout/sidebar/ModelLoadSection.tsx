import type { ModelLoadSectionProps } from "@/types/components";
import { isAudioFile, is3DModelFile, formatConfidence } from "@/lib/audio/audio-info";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { AUDIO_VISUALIZATION, MODEL_FILE_EXTENSIONS, AUDIO_FILE_EXTENSIONS } from "@/lib/constants";

export function ModelLoadSection({
  modelEntities,
  activeLoadTab,
  file,
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
  onUpload,
  onLoadSampleIfc,
  onClearModel,
  setActiveLoadTab,
  setUseModelAsContext,
  onAnalyzeSoundEvents,
  onToggleSEDOption,
  onLoadSoundsFromSED
}: ModelLoadSectionProps) {
  // Determine file type: null, 'model', or 'audio'
  const fileType = file ? (isAudioFile(file.name) ? 'audio' : is3DModelFile(file.name) ? 'model' : null) : null;
  const isAudio = fileType === 'audio';
  const isModel = fileType === 'model';

  // Has SED analysis completed successfully?
  const hasSEDResults = sedDetectedSounds && sedDetectedSounds.length > 0;

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
        Context (3D model or sound recording)
      </p>
      <div>
        {modelEntities.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-xs text-green-800 dark:text-green-300 font-semibold">
                ✓ Model loaded with {modelEntities.length} objects
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
              <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                ℹ️ Model will be used for positioning only
              </div>
            )}

            <button
              onClick={onClearModel}
              className="w-full rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium py-2 text-xs hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Load Another Model
            </button>
          </div>
        ) : (
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
                    {file ? (
                      <>
                        <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {isAudio ? '🎵 Audio file' : isModel ? '🏗️ 3D model' : '📄 File'}
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

                {/* Show audio waveform if audio file is selected (appears immediately) */}
                {file && isAudio && sedAudioInfo && sedAudioBuffer && AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY && (
                  <AudioWaveformDisplay
                    audioBuffer={sedAudioBuffer}
                    audioInfo={sedAudioInfo}
                  />
                )}

                {/* Fallback: Show text-only audio info if waveform is disabled */}
                {file && isAudio && sedAudioInfo && !hasSEDResults && !AUDIO_VISUALIZATION.ENABLE_WAVEFORM_DISPLAY && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">Audio Information</p>
                    <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                      <div className="flex justify-between">
                        <span>Duration:</span>
                        <span className="font-mono">{sedAudioInfo.duration.toFixed(2)}s</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sample Rate:</span>
                        <span className="font-mono">{sedAudioInfo.sample_rate} Hz</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Channels:</span>
                        <span className="font-mono">{sedAudioInfo.channels}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* SED Analysis Options (only for audio files, before analysis) */}
                {file && isAudio && !hasSEDResults && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg">
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

                {/* Main Action Button and Load Sounds button layout */}
                <div className="flex gap-2">
                  <button
                    onClick={isAudio ? onAnalyzeSoundEvents : onUpload}
                    disabled={isUploading || isAnalyzingModel || isSEDAnalyzing || !file}
                    className={`${hasSEDResults && isAudio ? 'flex-1' : 'w-full'} rounded-md text-white font-medium py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-gray-400 disabled:hover:bg-gray-400 flex items-center justify-center gap-2 transition-colors`}
                  >
                    {isUploading || isAnalyzingModel || isSEDAnalyzing ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {isSEDAnalyzing ? "Analyzing sounds..." : isUploading ? "Loading..." : "Analyzing..."}
                      </>
                    ) : (
                      <>
                        {isAudio ? "Analyze Sound Events" : "Load Model"}
                      </>
                    )}
                  </button>

                  {hasSEDResults && isAudio && (
                    <button
                      onClick={onLoadSoundsFromSED}
                      className="flex-1 rounded-md bg-green-600 hover:bg-green-700 text-white font-medium py-2 text-sm transition-colors"
                      title="Load detected sounds into generation tab"
                    >
                      Load Sounds →
                    </button>
                  )}
                </div>

                {/* Model-specific checkbox (only for 3D models) */}
                {file && isModel && !isUploading && (
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
                )}

                {/* Progress indicator */}
                {(isAnalyzingModel || isSEDAnalyzing) && analysisProgress && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                    🔍 {analysisProgress}
                  </div>
                )}

                {/* Warning for model positioning only */}
                {file && isModel && !useModelAsContext && !isUploading && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    ℹ️ Model will be used for positioning only
                  </div>
                )}

                {/* SED Error Display - Friendly error message */}
                {sedError && file && isAudio && !hasSEDResults && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <svg className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-red-800 dark:text-red-300 mb-1">Analysis Failed</p>
                        <p className="text-xs text-red-700 dark:text-red-300">{sedError}</p>
                        {/* Show format helper only for loading/audio errors, not analysis errors */}
                        {(sedError.toLowerCase().includes('load') ||
                          sedError.toLowerCase().includes('corrupt') ||
                          sedError.toLowerCase().includes('format') ||
                          sedError.toLowerCase().includes('audio file') ||
                          sedError.toLowerCase().includes('0 samples')) && (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                            💡 Try: Checking your audio file format, ensuring it's not corrupted, or using a 16kHz WAV file
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* SED Results Display - Scrollable like Text Generation */}
                {hasSEDResults && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2 flex items-center">
                      <span className="mr-2">✨</span>
                      Detected Sound Events:
                    </p>
                    {/* Scrollable container matching TextGenerationSection style */}
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {sedDetectedSounds.map((sound, idx) => (
                        <div key={idx} className="text-xs text-green-700 dark:text-green-300 flex justify-between items-center gap-2">
                          <span className="flex-1">{sound.name}</span>
                          <div className="flex items-center gap-2 font-mono text-right">
                            <span>{formatConfidence(sound.confidence)}</span>
                            {/* {sedAnalysisOptions?.analyzeAmplitudes && sound.avg_amplitude_db !== null && (
                              <span className="text-green-600 dark:text-green-400">
                                ({sound.avg_amplitude_db.toFixed(1)} dB)
                              </span> */}
                            {/* )} */}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeLoadTab === 'sample' && (
              <div className="flex flex-col gap-2">
                <button
                  onClick={onLoadSampleIfc}
                  disabled={isUploading || isAnalyzingModel}
                  className="w-full rounded-md text-white font-medium py-2 text-sm bg-primary hover:bg-primary-hover disabled:bg-gray-400 disabled:hover:bg-gray-400 flex items-center justify-center gap-2 transition-colors"
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
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
                    🔍 {analysisProgress}
                  </div>
                )}

                {!useModelAsContext && !isUploading && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs text-yellow-700 dark:text-yellow-300">
                    ℹ️ Model will be used for positioning only
                  </div>
                )}
              </div>
            )}

            {uploadError && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600">
                {uploadError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

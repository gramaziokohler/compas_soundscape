import type { TextGenerationSectionProps } from "@/types/components";

export function TextGenerationSection({
  modelEntities,
  aiPrompt,
  numSounds,
  isGenerating,
  isAnalyzingModel,
  llmProgress,
  aiError,
  aiResponse,
  showConfirmLoadSounds,
  analysisProgress,
  setAiPrompt,
  setNumSounds,
  onGenerateText,
  onLoadSoundsToGeneration
}: TextGenerationSectionProps) {
  return (
    <>
      <div>
        <label className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Number of sounds: <span className="text-[#F500B8] font-bold">{numSounds}</span>
        </label>
        <input
          type="range"
          value={numSounds}
          onChange={(e) => setNumSounds(parseInt(e.target.value))}
          min="1"
          max="30"
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-primary"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1</span>
          <span>30</span>
        </div>
      </div>

      <div>
        <label htmlFor="ai-prompt" className="text-sm text-gray-600 font-medium block dark:text-gray-400 mb-2">
          {modelEntities.length > 0 ? 'Space Description (Optional)' : 'Space Description (Optional)'}
        </label>
        <textarea
          id="ai-prompt"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              e.preventDefault();
              if (!isGenerating && (modelEntities.length > 0 || aiPrompt.trim())) {
                onGenerateText();
              }
            }
          }}
          placeholder={
            modelEntities.length > 0
              ? "e.g., a busy office in the afternoon (combines with model)"
              : "e.g., an office space in the afternoon"
          }
          className="w-full h-20 p-2 text-sm border rounded bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-[#F500B8]"
          rows={3}
        />
      </div>

      {/* Generate button and Load button layout */}
      <div className="flex gap-2">
        <button
          onClick={onGenerateText}
          disabled={isGenerating || (modelEntities.length === 0 && !aiPrompt.trim())}
          className={`flex-1 rounded-full text-white font-medium h-10 transition-colors ${
            isGenerating || (modelEntities.length === 0 && !aiPrompt.trim())
              ? 'bg-gray-400'
              : 'bg-primary hover:bg-primary-hover'
          }`}
        >
          {isGenerating ? "Generating..." : showConfirmLoadSounds ? "Generate Ideas " : "Generate Sound Ideas"}
        </button>

        {showConfirmLoadSounds && (
          <button
            onClick={onLoadSoundsToGeneration}
            className="flex-1 rounded-full bg-green-600 text-white font-medium h-10 hover:bg-green-700 transition-colors"
            title="Load sound ideas into generation tab"
          >
            Load Sounds →
          </button>
        )}
      </div>

      {isAnalyzingModel && (
        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300">
          ⏳ {analysisProgress}
        </div>
      )}

      {llmProgress && (
        <div className="p-2 bg-purple-50 dark:bg-purple-900/20 rounded text-xs text-purple-700 dark:text-purple-300">
          🔄 {llmProgress}
        </div>
      )}

      {aiError && (
        <div className="p-3 bg-red-50 rounded-lg">
          <p className="text-red-600 text-sm">{aiError}</p>
        </div>
      )}

      {aiResponse && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg max-h-64 overflow-y-auto">
          <h4 className="text-xs font-semibold mb-2 text-green-800 dark:text-green-300 flex items-center">
            <span className="mr-2">✨</span>
            Generated Sound Ideas:
          </h4>
          <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{aiResponse}</div>
        </div>
      )}
    </>
  );
}

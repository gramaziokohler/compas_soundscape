import type { TextGenerationSectionProps } from "@/types/components";
import { UI_COLORS, UI_BUTTON } from "@/lib/constants";

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
  onStopGeneration,
  onLoadSoundsToGeneration
}: TextGenerationSectionProps) {
  return (
    <>
      <div>
        <label className="text-sm mb-2" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          Number of sounds: <span style={{ color: UI_COLORS.PRIMARY, fontWeight: 'bold' }}>{numSounds}</span>
        </label>
        <input
          type="range"
          value={numSounds}
          onChange={(e) => setNumSounds(parseInt(e.target.value))}
          min="1"
          max="30"
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
          style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
        />
        <div className="flex justify-between text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
          <span>1</span>
          <span>30</span>
        </div>
      </div>

      <div>
        <label htmlFor="ai-prompt" className="text-sm font-medium block mb-2" style={{ color: UI_COLORS.NEUTRAL_500 }}>
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
          className="w-full h-20 p-2 text-sm rounded"
          style={{
            backgroundColor: UI_COLORS.NEUTRAL_50,
            borderColor: UI_COLORS.NEUTRAL_300,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px'
          }}
          rows={3}
        />
      </div>

      {/* Generate button and Load button layout */}
      <div className="flex gap-2">
        <button
          onClick={onGenerateText}
          disabled={isGenerating || (modelEntities.length === 0 && !aiPrompt.trim())}
          onMouseEnter={(e) => {
            if (!isGenerating && (modelEntities.length > 0 || aiPrompt.trim())) {
              e.currentTarget.style.opacity = '0.8';
            }
          }}
          onMouseLeave={(e) => {
            if (!isGenerating && (modelEntities.length > 0 || aiPrompt.trim())) {
              e.currentTarget.style.opacity = '1';
            }
          }}
          className="flex-1 text-white transition-colors"
          style={{
            borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
            padding: UI_BUTTON.PADDING_MD,
            fontSize: UI_BUTTON.FONT_SIZE,
            fontWeight: UI_BUTTON.FONT_WEIGHT,
            backgroundColor: isGenerating || (modelEntities.length === 0 && !aiPrompt.trim()) ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
            opacity: isGenerating || (modelEntities.length === 0 && !aiPrompt.trim()) ? 0.4 : 1,
            cursor: isGenerating || (modelEntities.length === 0 && !aiPrompt.trim()) ? 'not-allowed' : 'pointer'
          }}
        >
          {isGenerating ? "Generating..." : showConfirmLoadSounds ? "Generate Ideas " : "Generate Sound Ideas"}
        </button>

        {/* Stop button - only visible when generating */}
        {isGenerating && (
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

        {showConfirmLoadSounds && !isGenerating && (
          <button
            onClick={onLoadSoundsToGeneration}
            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            className="flex-1 rounded-md text-white font-medium py-2 text-sm transition-colors"
            style={{
              backgroundColor: UI_COLORS.SUCCESS,
              borderRadius: '9999px'
            }}
            title="Load sound ideas into generation tab"
          >
            Load Sounds →
          </button>
        )}
      </div>

      {isAnalyzingModel && (
        <div 
          className="p-2 rounded text-xs"
          style={{
            backgroundColor: UI_COLORS.INFO_LIGHT,
            borderColor: UI_COLORS.INFO,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.INFO
          }}
        >
          ⏳ {analysisProgress}
        </div>
      )}

      {llmProgress && (
        <div 
          className="p-2 rounded text-xs"
          style={{
            backgroundColor: `${UI_COLORS.PRIMARY}10`,
            borderColor: UI_COLORS.PRIMARY,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.PRIMARY
          }}
        >
          🔄 {llmProgress}
        </div>
      )}

      {aiError && (
        <div 
          className="p-3 rounded-lg"
          style={{
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.ERROR
          }}
        >
          <p className="text-sm">{aiError}</p>
        </div>
      )}

      {aiResponse && (
        <div 
          className="p-3 rounded-lg max-h-64 overflow-y-auto"
          style={{
            backgroundColor: UI_COLORS.SUCCESS_LIGHT,
            borderColor: UI_COLORS.SUCCESS,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px'
          }}
        >
          <h4 className="text-xs font-semibold mb-2 flex items-center" style={{ color: UI_COLORS.SUCCESS }}>
            <span className="mr-2">✨</span>
            Generated Sound Ideas:
          </h4>
          <div className="text-xs whitespace-pre-wrap" style={{ color: UI_COLORS.NEUTRAL_700 }}>{aiResponse}</div>
        </div>
      )}
    </>
  );
}

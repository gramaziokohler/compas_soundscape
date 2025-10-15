import { useState, useEffect, useRef } from "react";
import { SoundGenerationConfig, SoundEvent } from "@/types";

interface SoundGenerationSectionProps {
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  isSoundGenerating: boolean;
  soundGenError: string | null;
  onAddConfig: () => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onSetActiveTab: (index: number) => void;
  onGenerate: () => void;
  generatedSounds: SoundEvent[];
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  onGlobalDurationChange: (duration: number) => void;
  onGlobalStepsChange: (steps: number) => void;
  onGlobalNegativePromptChange: (prompt: string) => void;
  onApplyDenoisingChange: (apply: boolean) => void;
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
}

export function SoundGenerationSection({
  soundConfigs,
  activeSoundConfigTab,
  isSoundGenerating,
  soundGenError,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
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
  onPlayAll,
  onPauseAll,
  onStopAll
}: SoundGenerationSectionProps) {
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const prevGeneratedSoundsLengthRef = useRef(0);

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

  // Helper function to get display name for a config index
  const getDisplayName = (index: number): string => {
    // First priority: display_name from the config itself (from text generation)
    const config = soundConfigs[index];
    if (config?.display_name) {
      return config.display_name;
    }

    // Second priority: display_name from generated sounds (from overlays)
    const sound = generatedSounds.find(s => s.prompt_index === index);
    if (sound?.display_name) {
      return sound.display_name;
    }

    // Fallback: generic name
    return `Sound ${index + 1}`;
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-600 dark:text-gray-400">Generate sounds from text descriptions</p>

      {/* Sound titles Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {soundConfigs.map((_, index) => (
          <button
            key={index}
            onClick={() => onSetActiveTab(index)}
            className={`px-3 py-1 text-xs font-medium rounded-t transition-colors whitespace-nowrap ${
              activeSoundConfigTab === index
                ? 'bg-primary text-white'
                : 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500'
            }`}
          >
            {getDisplayName(index)}
          </button>
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
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold">Sound {activeSoundConfigTab + 1}</span>
            {soundConfigs.length > 1 && (
              <button
                onClick={() => onRemoveConfig(activeSoundConfigTab)}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Remove
              </button>
            )}
          </div>

          <textarea
            value={soundConfigs[activeSoundConfigTab].prompt}
            onChange={(e) => onUpdateConfig(activeSoundConfigTab, 'prompt', e.target.value)}
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
              <label className="text-xs block mb-1">Guidance: {(soundConfigs[activeSoundConfigTab].guidance_scale / 10).toFixed(1)}</label>
              <input
                type="range"
                value={soundConfigs[activeSoundConfigTab].guidance_scale}
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
      {/*generatedSounds.length === 0 && ( */
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
                  placeholder="e.g., distorted, reverb, echo"
                  className="w-full p-2 text-xs border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600"
                  rows={2}
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Terms to avoid in all generated sounds
                </p>
              </div>

              {/* Background Noise Removal Checkbox */}
              <div>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyDenoising}
                    onChange={(e) => onApplyDenoisingChange(e.target.checked)}
                    className="w-4 h-4 accent-primary cursor-pointer"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Remove Background Noise
                  </span>
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Apply noise reduction to clean up generated sounds
                </p>
              </div>
            </div>
          )}
        </div>
      }

      {generatedSounds.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="text-sm font-semibold">Playback Controls</div>
          <div className="flex gap-2">
            <button
              onClick={onPlayAll}
              className="flex-1 py-1.5 px-3 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded transition-colors"
            >
              Play All
            </button>
            <button
              onClick={onPauseAll}
              className="flex-1 py-1.5 px-3 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium rounded transition-colors"
            >
              Pause All
            </button>
            <button
              onClick={onStopAll}
              className="flex-1 py-1.5 px-3 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
            >
              Stop All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


"use client";

import { RangeSlider } from "@/components/ui/RangeSlider";
import { UI_COLORS, UI_BORDER_RADIUS, AUDIO_MODEL_TANGOFLUX, AUDIO_MODEL_AUDIOLDM2, AUDIO_MODEL_NAMES } from "@/lib/constants";

interface AdvancedSettingsSectionProps {
  // Sound generation props
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  normalizeImpulseResponses: boolean;
  audioModel: string;
  onGlobalDurationChange: (value: number) => void;
  onGlobalStepsChange: (value: number) => void;
  onGlobalNegativePromptChange: (value: string) => void;
  onApplyDenoisingChange: (value: boolean) => void;
  onNormalizeImpulseResponsesChange: (value: boolean) => void;
  onAudioModelChange: (value: string) => void;
  onResetToDefaults: () => void;
  // 3D Scene props
  showAxesHelper: boolean;
  onShowAxesHelperChange: (value: boolean) => void;
}

/**
 * AdvancedSettingsSection Component
 *
 * Advanced settings section for the sidebar.
 * Contains sound generation and 3D scene configuration options.
 *
 * Features:
 * - Audio generation model selection
 * - Global sound parameters (duration, steps, negative prompt)
 * - Audio processing toggles (noise removal, IR normalization)
 * - 3D scene visualization options
 */
export function AdvancedSettingsSection({
  globalDuration,
  globalSteps,
  globalNegativePrompt,
  applyDenoising,
  normalizeImpulseResponses,
  audioModel,
  onGlobalDurationChange,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onNormalizeImpulseResponsesChange,
  onAudioModelChange,
  onResetToDefaults,
  showAxesHelper,
  onShowAxesHelperChange
}: AdvancedSettingsSectionProps) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Advanced Settings</h3>
        <button
          onClick={onResetToDefaults}
          className="text-xs transition-colors"
          style={{ color: UI_COLORS.PRIMARY }}
          onMouseEnter={(e) => e.currentTarget.style.color = UI_COLORS.PRIMARY_HOVER}
          onMouseLeave={(e) => e.currentTarget.style.color = UI_COLORS.PRIMARY}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>

      {/* Audio Generation Model */}
      <div>
        <h4 className="text-xs font-medium mb-2 text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Audio Generation Model
        </h4>
        <select
          value={audioModel}
          onChange={(e) => onAudioModelChange(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
          style={{
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            accentColor: UI_COLORS.PRIMARY
          }}
        >
          <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
          <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
        </select>
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
          {audioModel === AUDIO_MODEL_TANGOFLUX
            ? "Fast, high-quality text-to-audio generation (default)"
            : "Alternative model with different characteristics"
          }
        </p>
      </div>

      {/* Text-to-Audio Parameters */}
      <div>
        {/* Global Duration */}
        <RangeSlider
          label="Global Duration (s): "
          value={globalDuration}
          min={1}
          max={30}
          step={1}
          onChange={(value) => onGlobalDurationChange(value)}
          hoverText="Applies to all sound tabs"
        />

        {/* Diffusion Steps */}
        <RangeSlider
          label="Diffusion Steps: "
          value={globalSteps}
          min={10}
          max={100}
          step={5}
          onChange={(value) => onGlobalStepsChange(value)}
          hoverText="Higher steps = better quality but slower"
        />
        
        {/* Global Negative Prompt */}
        <div>
          <label className="block text-sm mb-1 text-gray-700 dark:text-gray-300">
            Global Negative Prompt
          </label>
          <textarea
            value={globalNegativePrompt}
            onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
            placeholder="e.g., distorted, reverb, echo"
            className="w-full px-3 py-2 text-sm rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 resize-none placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-gray-400 dark:focus:border-gray-500 focus:outline-none transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            rows={2}
          />
          <p className="text-xs mt-1 text-gray-500 dark:text-gray-400">
            Terms to avoid in all generated sounds
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* Audio Processing */}
      <div>
        <h4 className="text-xs font-medium mb-2 text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          Audio Processing
        </h4>

        {/* Background Noise Removal */}
        <label className="flex items-start cursor-pointer group mb-3">
          <input
            type="checkbox"
            checked={applyDenoising}
            onChange={(e) => onApplyDenoisingChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
            style={{ accentColor: UI_COLORS.PRIMARY }}
          />
          <div className="ml-3 flex-1">
            <span className="text-sm text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              Remove Background Noise
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Apply noise reduction to clean up sounds
            </p>
          </div>
        </label>

        {/* Normalize Impulse Responses */}
        <label className="flex items-start cursor-pointer group">
          <input
            type="checkbox"
            checked={normalizeImpulseResponses}
            onChange={(e) => onNormalizeImpulseResponsesChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
            style={{ accentColor: UI_COLORS.PRIMARY }}
          />
          <div className="ml-3 flex-1">
            <span className="text-sm text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              Normalize Impulse Responses
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Scale impulse response to -6dB headroom
            </p>
          </div>
        </label>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-200 dark:border-gray-700" />

      {/* 3D Scene */}
      <div>
        <h4 className="text-xs font-medium mb-2 text-gray-700 dark:text-gray-300 uppercase tracking-wide">
          3D Scene
        </h4>

        {/* Show Axes Helper */}
        <label className="flex items-start cursor-pointer group">
          <input
            type="checkbox"
            checked={showAxesHelper}
            onChange={(e) => onShowAxesHelperChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 cursor-pointer"
            style={{ accentColor: UI_COLORS.PRIMARY }}
          />
          <div className="ml-3 flex-1">
            <span className="text-sm text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              Show Axes Helper
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Red (X), Green (Y), and Blue (Z)
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

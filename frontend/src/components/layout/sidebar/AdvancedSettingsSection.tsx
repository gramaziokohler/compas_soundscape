"use client";

import { RangeSlider } from "@/components/ui/RangeSlider";
import { UI_COLORS, UI_BORDER_RADIUS, AUDIO_MODEL_TANGOFLUX, AUDIO_MODEL_AUDIOLDM2, AUDIO_MODEL_NAMES } from "@/utils/constants";

interface AdvancedSettingsSectionProps {
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
  showAxesHelper: boolean;
  onShowAxesHelperChange: (value: boolean) => void;
}

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
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-gray-900 dark:text-white">Advanced Settings</h3>
        <button
          onClick={onResetToDefaults}
          className="text-xs transition-colors hover:opacity-80"
          style={{ color: UI_COLORS.PRIMARY }}
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>

      <div>
        <h4 className="text-[10px] font-bold mb-1 text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Audio Generation Model
        </h4>
        <select
          value={audioModel}
          onChange={(e) => onAudioModelChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors focus:outline-none focus:ring-1"
          style={{
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            accentColor: UI_COLORS.PRIMARY
          }}
        >
          <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
          <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
        </select>
        <p className="text-[10px] mt-1 text-gray-500 dark:text-gray-400 leading-tight">
          {audioModel === AUDIO_MODEL_TANGOFLUX
            ? "Fast, high-quality text-to-audio generation (default)"
            : "Alternative model with different characteristics"
          }
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <RangeSlider
          label="Global Duration (s): "
          value={globalDuration}
          min={1}
          max={30}
          step={1}
          onChange={onGlobalDurationChange}
          hoverText="Applies to all sound tabs"
        />

        <RangeSlider
          label="Diffusion Steps: "
          value={globalSteps}
          min={10}
          max={100}
          step={5}
          onChange={onGlobalStepsChange}
          hoverText="Higher steps = better quality but slower"
        />
        
        <div className="mt-1">
          <label className="block text-[10px] font-medium mb-1 text-gray-700 dark:text-gray-300">
            Global Negative Prompt
          </label>
          <textarea
            value={globalNegativePrompt}
            onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
            placeholder="e.g., distorted, reverb, echo"
            className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 resize-none placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-gray-400 dark:focus:border-gray-500 focus:outline-none transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            rows={2}
          />
        </div>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 my-0.5" />

      <div>
        <h4 className="text-[10px] font-bold mb-1.5 text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Audio Processing
        </h4>

        <div className="flex flex-col gap-2">
          <label className="flex items-start cursor-pointer group">
            <input
              type="checkbox"
              checked={applyDenoising}
              onChange={(e) => onApplyDenoisingChange(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: UI_COLORS.PRIMARY }}
            />
            <div className="ml-2 flex-1 leading-none">
              <span className="text-xs font-medium text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                Remove Background Noise
              </span>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                Apply noise reduction
              </p>
            </div>
          </label>

          <label className="flex items-start cursor-pointer group">
            <input
              type="checkbox"
              checked={normalizeImpulseResponses}
              onChange={(e) => onNormalizeImpulseResponsesChange(e.target.checked)}
              className="mt-0.5 w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: UI_COLORS.PRIMARY }}
            />
            <div className="ml-2 flex-1 leading-none">
              <span className="text-xs font-medium text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                Normalize Impulse Responses
              </span>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                Scale IR to -6dB headroom
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* <div className="border-t border-gray-200 dark:border-gray-700 my-0.5" /> */}
{/* 
      <div>
        <h4 className="text-[10px] font-bold mb-1.5 text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          3D Scene
        </h4>
        <label className="flex items-start cursor-pointer group">
          <input
            type="checkbox"
            checked={showAxesHelper}
            onChange={(e) => onShowAxesHelperChange(e.target.checked)}
            className="mt-0.5 w-3.5 h-3.5 cursor-pointer"
            style={{ accentColor: UI_COLORS.PRIMARY }}
          />
          <div className="ml-2 flex-1 leading-none">
            <span className="text-xs font-medium text-gray-900 dark:text-white group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
              Show Axes Helper
            </span>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              Red (X), Green (Y), Blue (Z)
            </p>
          </div>
        </label>
      </div> */}
    </div>
  );
}
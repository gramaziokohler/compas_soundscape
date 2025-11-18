"use client";

import { UI_OVERLAY, UI_COLORS, UI_SPACING, UI_BORDER_RADIUS, AUDIO_MODEL_TANGOFLUX, AUDIO_MODEL_AUDIOLDM2, AUDIO_MODEL_NAMES } from "@/lib/constants";

interface AdvancedSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
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
}

/**
 * AdvancedSettingsPanel Component
 *
 * Advanced settings panel for sound generation and 3D scene configuration.
 * Positioned in top-right corner when open.
 *
 * Features:
 * - Sound generation parameters (duration, steps, negative prompt)
 * - Audio model selection (TangoFlux, AudioLDM2)
 * - Background noise removal toggle
 * - Consistent overlay styling with UI design system
 * - All changes apply immediately (no Apply button)
 *
 * Usage:
 * ```tsx
 * <AdvancedSettingsPanel
 *   isOpen={isSettingsOpen}
 *   onClose={() => setIsSettingsOpen(false)}
 *   globalDuration={globalDuration}
 *   globalSteps={globalSteps}
 *   globalNegativePrompt={globalNegativePrompt}
 *   applyDenoising={applyDenoising}
 *   audioModel={audioModel}
 *   onGlobalDurationChange={setGlobalDuration}
 *   onGlobalStepsChange={setGlobalSteps}
 *   onGlobalNegativePromptChange={setGlobalNegativePrompt}
 *   onApplyDenoisingChange={setApplyDenoising}
 *   onAudioModelChange={setAudioModel}
 *   onResetToDefaults={handleResetToDefaults}
 * />
 * ```
 */
export function AdvancedSettingsPanel({
  isOpen,
  onClose,
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
  onResetToDefaults
}: AdvancedSettingsPanelProps) {
  if (!isOpen) return null;

  return (
    <div
      className="absolute top-6 right-6 pointer-events-auto z-50 backdrop-blur-sm shadow-lg"
      style={{
        backgroundColor: UI_OVERLAY.BACKGROUND,
        borderRadius: `${UI_BORDER_RADIUS.MD}px`,
        borderColor: UI_OVERLAY.BORDER_COLOR,
        borderWidth: '1px',
        borderStyle: 'solid',
        padding: `${UI_SPACING.MD}px`,
        width: '280px',
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium text-sm">Advanced Settings</h3>
        <div className="flex items-center gap-2">
          {/* Reset Button - styled like Upload button */}
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
          {/* Close Button */}
          <button
            onClick={onClose}
            className="text-white hover:text-gray-300 transition-colors"
            title="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Section: Audio Generation Model */}
      <div className="mb-4">
        <h4 className="text-white text-xs font-medium mb-2 opacity-70 uppercase tracking-wide">
          Audio Generation Model
        </h4>

        <div className="mb-2">
          <select
            value={audioModel}
            onChange={(e) => onAudioModelChange(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded bg-black/40 text-white border border-white/20 cursor-pointer hover:border-white/40 transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
            <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
          </select>
          <p className="text-white text-[10px] mt-1 opacity-50">
            {audioModel === AUDIO_MODEL_TANGOFLUX
              ? "Fast, high-quality text-to-audio generation (default)"
              : "Alternative model with different characteristics"
            }
          </p>
        </div>
      </div>

      {/* Section: Text-to-Audio Parameters */}
      <div className="mb-4">

        {/* Global Duration Slider */}
        <div className="mb-3">
          <label className="flex items-center justify-between text-white text-xs mb-1">
            <span className="opacity-70">Global Duration</span>
            <span className="font-medium">{globalDuration}s</span>
          </label>
          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={globalDuration}
            onChange={(e) => onGlobalDurationChange(parseInt(e.target.value))}
            className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
            style={{
              accentColor: UI_COLORS.PRIMARY
            }}
          />
          <p className="text-white text-[10px] mt-1 opacity-50">
            Applies to all sound tabs
          </p>
        </div>

        {/* Diffusion Steps Slider */}
        <div className="mb-3">
          <label className="flex items-center justify-between text-white text-xs mb-1">
            <span className="opacity-70">Diffusion Steps</span>
            <span className="font-medium">{globalSteps}</span>
          </label>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={globalSteps}
            onChange={(e) => onGlobalStepsChange(parseInt(e.target.value))}
            className="w-full h-1 bg-white/20 rounded-full appearance-none cursor-pointer"
            style={{
              accentColor: UI_COLORS.PRIMARY
            }}
          />
          <p className="text-white text-[10px] mt-1 opacity-50">
            Higher steps = better quality but slower
          </p>
        </div>

        {/* Global Negative Prompt */}
        <div>
          <label className="block text-white text-xs mb-1 opacity-70">
            Global Negative Prompt
          </label>
          <textarea
            value={globalNegativePrompt}
            onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
            placeholder="e.g., distorted, reverb, echo"
            className="w-full px-2 py-1.5 text-xs rounded bg-black/40 text-white border border-white/20 resize-none placeholder:text-white/30 focus:border-white/40 focus:outline-none transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            rows={2}
          />
          <p className="text-white text-[10px] mt-1 opacity-50">
            Terms to avoid in all generated sounds
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/20 my-3" />

      {/* Section: Audio Processing */}
      <div className="mb-2">
        <h4 className="text-white text-xs font-medium mb-2 opacity-70 uppercase tracking-wide">
          Audio Processing
        </h4>

        {/* Background Noise Removal Checkbox */}
        <label className="flex items-center cursor-pointer group">
          <input
            type="checkbox"
            checked={applyDenoising}
            onChange={(e) => onApplyDenoisingChange(e.target.checked)}
            className="w-4 h-4 accent-[#F500B8] cursor-pointer"
          />
          <span className="ml-2 text-white text-xs group-hover:text-gray-300 transition-colors">
            Remove Background Noise
          </span>
        </label>
        <p className="text-white text-[10px] mt-1 ml-6 opacity-50">
          Apply noise reduction to clean up sounds
        </p>

        {/* Normalize Impulse Responses Checkbox */}
        <label className="flex items-center cursor-pointer group">
          <input
            type="checkbox"
            checked={normalizeImpulseResponses}
            onChange={(e) => onNormalizeImpulseResponsesChange(e.target.checked)}
            className="w-4 h-4 accent-[#F500B8] cursor-pointer"
          />
          <span className="ml-2 text-white text-xs group-hover:text-gray-300 transition-colors">
            Normalize Impulse Responses
          </span>
        </label>
        <p className="text-white text-[10px] mt-1 ml-6 opacity-50">
          Scale impulse response to -6dB headroom
        </p>

      </div>
    </div>
  );
}

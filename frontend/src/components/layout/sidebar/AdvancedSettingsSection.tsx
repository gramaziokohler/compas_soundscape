"use client";

import { useState, useEffect, useRef } from "react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { apiService } from "@/services/api";
import type { TokenStatus, LLMProviders } from "@/services/api";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import { setElevenLabsApiKey, isElevenLabsKeySet } from "@/services/elevenlabs.mts";
import { useServiceVersions } from "@/hooks/useServiceVersions";
import {
  UI_COLORS,
  UI_BORDER_RADIUS,
  AUDIO_MODEL_TANGOFLUX,
  AUDIO_MODEL_AUDIOLDM2,
  AUDIO_MODEL_ELEVENLABS,
  AUDIO_MODEL_NAMES,
  LLM_MODEL_GEMINI_FLASH,
  LLM_MODEL_GEMINI_PRO,
  LLM_MODEL_GEMINI_3_FLASH,
  LLM_MODEL_GEMINI_3_PRO,
  LLM_MODEL_OPENAI,
  LLM_MODEL_ANTHROPIC,
  LLM_MODEL_NAMES,
  LLM_MODEL_TO_PROVIDER,
} from "@/utils/constants";

function isProviderInstalled(modelKey: string, llmProviders: LLMProviders | null): boolean {
  if (!llmProviders) return true;
  const key = LLM_MODEL_TO_PROVIDER[modelKey];
  if (!key) return true;
  return llmProviders[key as keyof LLMProviders]?.installed ?? true;
}

interface AdvancedSettingsSectionProps {
  globalDuration: number;
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  normalizeImpulseResponses: boolean;
  audioModel: string;
  llmModel: string;
  onGlobalDurationChange: (value: number) => void;
  onGlobalStepsChange: (value: number) => void;
  onGlobalNegativePromptChange: (value: string) => void;
  onApplyDenoisingChange: (value: boolean) => void;
  onNormalizeImpulseResponsesChange: (value: boolean) => void;
  onAudioModelChange: (value: string) => void;
  onLlmModelChange: (value: string) => void;
  onResetToDefaults: () => void;
  showAxesHelper: boolean;
  onShowAxesHelperChange: (value: boolean) => void;
}

// ── Accordion wrapper ─────────────────────────────────────────────────────────

function AccordionSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="border border-gray-200 dark:border-gray-700"
      style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2 py-1.5 text-left bg-primary dark:bg-gray-800 hover:bg-primary-light dark:hover:bg-primary-light transition-colors"
        style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
      >
        <h4 className="text-[10px] font-bold text-white dark:text-gray-400 uppercase tracking-wider">
          {title}
        </h4>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform"
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            color: UI_COLORS.NEUTRAL_400,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t border-gray-200 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Token input ───────────────────────────────────────────────────────────────

function TokenInput({
  label,
  value,
  onChange,
  isSet,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isSet: boolean;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (!v) setShow(false);
    onChange(v);
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-gray-700 dark:text-gray-300">{label}</label>
        {isSet && !value && (
          <span
            className="text-[9px] px-1 rounded"
            style={{ background: UI_COLORS.SUCCESS + "22", color: UI_COLORS.SUCCESS }}
          >
            set
          </span>
        )}
      </div>
      <div className="relative flex items-center">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={handleChange}
          placeholder={isSet ? "(already set — leave blank to keep)" : (placeholder ?? "Paste token here")}
          className={`w-full px-2 py-1 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-gray-400 transition-colors ${value ? "pr-7" : ""}`}
          style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        />
        {value && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 text-gray-400 hover:text-gray-600 transition-colors"
            title={show ? "Hide" : "Show"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {show ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              ) : (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tokens section ────────────────────────────────────────────────────────────

function TokensSection() {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [speckleToken, setSpeckleToken] = useState("");
  const [speckleProject, setSpeckleProject] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [elevenlabsSet, setElevenlabsSet] = useState(() => isElevenLabsKeySet());

  const savedRef = useRef({ speckle: "", google: "", openai: "", anthropic: "", elevenlabs: "" });

  useEffect(() => {
    apiService.getTokenStatus().then((s) => {
      setStatus(s);
      setSpeckleProject(s.speckle_project_name);
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const update: Record<string, string> = {};
      if (speckleToken) update.speckle_token = speckleToken;
      if (speckleProject && status && speckleProject !== status.speckle_project_name)
        update.speckle_project_name = speckleProject;
      if (googleKey) update.google_api_key = googleKey;
      if (openaiKey) update.openai_api_key = openaiKey;
      if (anthropicKey) update.anthropic_api_key = anthropicKey;

      if (Object.keys(update).length > 0) {
        const newStatus = await apiService.updateTokens(update);
        setStatus(newStatus);
        setSpeckleProject(newStatus.speckle_project_name);
      }

      if (elevenlabsKey) {
        setElevenLabsApiKey(elevenlabsKey);
        setElevenlabsSet(true);
      }

      savedRef.current = { speckle: speckleToken, google: googleKey, openai: openaiKey, anthropic: anthropicKey, elevenlabs: elevenlabsKey };
      setSaveMsg("Saved");
    } catch {
      setSaveMsg("Error saving");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const { speckle: sv, google: gv, openai: ov, anthropic: av, elevenlabs: ev } = savedRef.current;
  const hasChanges =
    speckleToken !== sv || googleKey !== gv || openaiKey !== ov || anthropicKey !== av || elevenlabsKey !== ev ||
    (status !== null && speckleProject !== status.speckle_project_name);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Speckle
          <a href="https://app.speckle.systems" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline" style={{ color: UI_COLORS.PRIMARY }}>
            app.speckle.systems ↗
          </a>
        </h4>
        <TokenInput label="SPECKLE_TOKEN" value={speckleToken} onChange={setSpeckleToken} isSet={status?.speckle_token_set ?? false} />
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-gray-700 dark:text-gray-300">SPECKLE_PROJECT_NAME</label>
          <input
            type="text"
            value={speckleProject}
            onChange={(e) => setSpeckleProject(e.target.value)}
            placeholder="soundscape-viewer"
            className="w-full px-2 py-1 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 focus:outline-none focus:border-gray-400 transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Google AI
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline" style={{ color: UI_COLORS.PRIMARY }}>
            aistudio.google.com ↗
          </a>
        </h4>
        <TokenInput label="GOOGLE_API_KEY" value={googleKey} onChange={setGoogleKey} isSet={status?.google_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          OpenAI
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline" style={{ color: UI_COLORS.PRIMARY }}>
            platform.openai.com ↗
          </a>
        </h4>
        <TokenInput label="OPENAI_API_KEY" value={openaiKey} onChange={setOpenaiKey} isSet={status?.openai_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Anthropic
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline" style={{ color: UI_COLORS.PRIMARY }}>
            console.anthropic.com ↗
          </a>
        </h4>
        <TokenInput label="ANTHROPIC_API_KEY" value={anthropicKey} onChange={setAnthropicKey} isSet={status?.anthropic_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          ElevenLabs
          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline" style={{ color: UI_COLORS.PRIMARY }}>
            elevenlabs.io ↗
          </a>
        </h4>
        <TokenInput label="ELEVENLABS_API_KEY" value={elevenlabsKey} onChange={setElevenlabsKey} isSet={elevenlabsSet} />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
          style={{ background: UI_COLORS.PRIMARY, color: "white", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        >
          {saving ? "Saving…" : "Apply Tokens"}
        </button>
        {saveMsg && (
          <span className="text-[10px]" style={{ color: saveMsg === "Saved" ? UI_COLORS.SUCCESS : UI_COLORS.ERROR }}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdvancedSettingsSection({
  globalDuration,
  globalSteps,
  globalNegativePrompt,
  applyDenoising,
  normalizeImpulseResponses,
  audioModel,
  llmModel,
  onGlobalDurationChange,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onNormalizeImpulseResponsesChange,
  onAudioModelChange,
  onLlmModelChange,
  onResetToDefaults,
  showAxesHelper,
  onShowAxesHelperChange,
}: AdvancedSettingsSectionProps) {
  const [tokensExpanded, setTokensExpanded] = useState(false);
  const [llmExpanded, setLlmExpanded] = useState(false);
  const [audioExpanded, setAudioExpanded] = useState(false);

  const serviceVersions = useServiceVersions();
  const llmProviders = serviceVersions?.llm_providers ?? null;

  const tokenSettingsTrigger = useTextGenerationStore((s) => s.tokenSettingsTrigger);
  useEffect(() => {
    if (tokenSettingsTrigger > 0) setTokensExpanded(true);
  }, [tokenSettingsTrigger]);

  return (
    <div className="flex flex-col gap-2 w-full">
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

      <AccordionSection title="API Tokens" expanded={tokensExpanded} onToggle={() => setTokensExpanded((e) => !e)}>
        <TokensSection />
      </AccordionSection>

      <AccordionSection title="LLM Models" expanded={llmExpanded} onToggle={() => setLlmExpanded((e) => !e)}>
        <select
          value={llmModel}
          onChange={(e) => onLlmModelChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors focus:outline-none focus:ring-1"
          style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px`, accentColor: UI_COLORS.PRIMARY }}
        >
          {[
            LLM_MODEL_GEMINI_3_PRO,
            LLM_MODEL_GEMINI_3_FLASH,
            LLM_MODEL_GEMINI_PRO,
            LLM_MODEL_GEMINI_FLASH,
            LLM_MODEL_OPENAI,
            LLM_MODEL_ANTHROPIC,
          ].map((m) => {
            const installed = isProviderInstalled(m, llmProviders);
            return (
              <option key={m} value={m} disabled={!installed}>
                {LLM_MODEL_NAMES[m]}{!installed ? " (not installed)" : ""}
              </option>
            );
          })}
        </select>
      </AccordionSection>

      <AccordionSection title="Audio Models" expanded={audioExpanded} onToggle={() => setAudioExpanded((e) => !e)}>
        <div className="flex flex-col gap-2">
          <select
            value={audioModel}
            onChange={(e) => onAudioModelChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors focus:outline-none focus:ring-1"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px`, accentColor: UI_COLORS.PRIMARY }}
          >
            <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
            <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
            <option value={AUDIO_MODEL_ELEVENLABS}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_ELEVENLABS]}</option>
          </select>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight">
            {audioModel === AUDIO_MODEL_TANGOFLUX
              ? "Fast, high-quality text-to-audio generation (default)"
              : audioModel === AUDIO_MODEL_ELEVENLABS
              ? "Cloud-based sound effects via ElevenLabs — requires NEXT_PUBLIC_ELEVENLABS_API_KEY"
              : "Alternative model with different characteristics"}
          </p>

          <RangeSlider
            label="Global Duration (s): "
            value={globalDuration}
            min={1}
            max={30}
            step={1}
            onChange={onGlobalDurationChange}
            hoverText={
              audioModel === AUDIO_MODEL_ELEVENLABS
                ? "ElevenLabs accepts 0.5–22 s; values outside this range use auto-detect"
                : "Applies to all sound tabs"
            }
          />

          {audioModel !== AUDIO_MODEL_ELEVENLABS && (
            <>
              <RangeSlider
                label="Diffusion Steps: "
                value={globalSteps}
                min={10}
                max={100}
                step={5}
                onChange={onGlobalStepsChange}
                hoverText="Higher steps = better quality but slower"
              />
              <div>
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
            </>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <h4 className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Audio Processing
            </h4>
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
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Apply noise reduction</p>
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
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Scale IR to -6dB headroom</p>
              </div>
            </label>
          </div>
        </div>
      </AccordionSection>
    </div>
  );
}

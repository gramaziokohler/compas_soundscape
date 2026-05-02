"use client";

import { useState, useEffect, useRef } from "react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { CheckboxField } from "@/components/ui/CheckboxField";
import { apiService } from "@/services/api";
import type { TokenStatus, LLMProviders } from "@/services/api";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import { setElevenLabsApiKey, isElevenLabsKeySet } from "@/services/elevenlabs.mts";
import { useServiceVersions } from "@/hooks/useServiceVersions";
import { useAudioControlsStore } from "@/store/audioControlsStore";
import { useUIStore } from "@/store/uiStore";
import { AUDIO_PLAYBACK } from "@/utils/constants";
import {
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
  DEFAULT_LISTENER_ORIENTATION,
  DEFAULT_SPEED_OF_SOUND,
  SPEED_OF_SOUND_MIN,
  SPEED_OF_SOUND_MAX,
  CHORAS_DE_DEFAULT_LC,
  CHORAS_DE_LC_MIN,
  CHORAS_DE_LC_MAX,
  DEFAULT_SPL_DB,
  SPL_MIN,
  SPL_MAX,
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
  showLabelSprites: boolean;
  onShowLabelSpritesChange: (value: boolean) => void;
  showHoveringHighlight: boolean;
  onShowHoveringHighlightChange: (value: boolean) => void;
  showSoundSpheres: boolean;
  onShowSoundSpheresChange: (value: boolean) => void;
  showSceneListeners: boolean;
  onShowSceneListenersChange: (value: boolean) => void;
  listenerOrientation: { x: number; y: number; z: number };
  onListenerOrientationChange: (orientation: { x: number; y: number; z: number }) => void;
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
      className="border border-secondary-light"
      style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2 py-1.5 text-left bg-primary hover:bg-primary-hover transition-colors"
        style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
      >
        <h4 className="text-[10px] font-bold text-white uppercase tracking-wider">
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
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t border-secondary-light">
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
        <label className="text-[10px] font-medium text-foreground">{label}</label>
        {isSet && !value && (
          <span
            className="text-[9px] px-1 rounded"
            style={{ background: 'color-mix(in srgb, var(--color-success) 13%, transparent)', color: 'var(--color-success)' }}
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
          className={`w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors ${value ? "pr-7" : ""}`}
          style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        />
        {value && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1.5 text-secondary-hover hover:text-foreground transition-colors"
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
      setTimeout(() => {
        if (window.confirm("Reload the page to apply the new tokens? (unsaved data will be lost)")) {
          window.location.reload();
        }
      }, 800);
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
        <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
          Speckle
          <a href="https://app.speckle.systems" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline text-primary" target="_blank" rel="noopener noreferrer">
            app.speckle.systems ↗
          </a>
        </h4>
        <TokenInput label="SPECKLE_TOKEN" value={speckleToken} onChange={setSpeckleToken} isSet={status?.speckle_token_set ?? false} />
        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-foreground">SPECKLE_PROJECT_NAME</label>
          <input
            type="text"
            value={speckleProject}
            onChange={(e) => setSpeckleProject(e.target.value)}
            placeholder="soundscape-viewer"
            className="w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
          Google AI
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline text-primary" target="_blank" rel="noopener noreferrer">
            aistudio.google.com ↗
          </a>
        </h4>
        <TokenInput label="GOOGLE_API_KEY" value={googleKey} onChange={setGoogleKey} isSet={status?.google_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
          OpenAI
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline text-primary" target="_blank" rel="noopener noreferrer">
            platform.openai.com ↗
          </a>
        </h4>
        <TokenInput label="OPENAI_API_KEY" value={openaiKey} onChange={setOpenaiKey} isSet={status?.openai_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
          Anthropic
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline text-primary" target="_blank" rel="noopener noreferrer">
            console.anthropic.com ↗
          </a>
        </h4>
        <TokenInput label="ANTHROPIC_API_KEY" value={anthropicKey} onChange={setAnthropicKey} isSet={status?.anthropic_api_key_set ?? false} />
      </div>

      <div className="flex flex-col gap-1">
        <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
          ElevenLabs
          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer"
            className="ml-1 normal-case font-normal hover:underline text-primary" target="_blank" rel="noopener noreferrer">
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
          style={{ background: 'var(--color-primary)', color: "white", borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        >
          {saving ? "Saving…" : "Apply Tokens"}
        </button>
        {saveMsg && (
          <span className="text-[10px]" style={{ color: saveMsg === "Saved" ? 'var(--color-success)' : 'var(--color-error)' }}>
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
  showLabelSprites,
  onShowLabelSpritesChange,
  showHoveringHighlight,
  onShowHoveringHighlightChange,
  showSoundSpheres,
  onShowSoundSpheresChange,
  showSceneListeners,
  onShowSceneListenersChange,
  listenerOrientation,
  onListenerOrientationChange,
}: AdvancedSettingsSectionProps) {
  const [viewerExpanded, setViewerExpanded] = useState(false);
  const [acousticExpanded, setAcousticExpanded] = useState(false);
  const [tokensExpanded, setTokensExpanded] = useState(false);
  const [llmExpanded, setLlmExpanded] = useState(false);
  const [audioExpanded, setAudioExpanded] = useState(false);
  const [soundRenderingExpanded, setSoundRenderingExpanded] = useState(false);

  const serviceVersions = useServiceVersions();
  const llmProviders = serviceVersions?.llm_providers ?? null;

  const tokenSettingsTrigger = useTextGenerationStore((s) => s.tokenSettingsTrigger);
  useEffect(() => {
    if (tokenSettingsTrigger > 0) setTokensExpanded(true);
  }, [tokenSettingsTrigger]);

  const intervalJitterSeconds = useAudioControlsStore((s) => s.intervalJitterSeconds);
  const setIntervalJitter = useAudioControlsStore((s) => s.setIntervalJitter);
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const setTimelineDurationMs = useAudioControlsStore((s) => s.setTimelineDurationMs);
  const globalBaseSplDb = useAudioControlsStore((s) => s.globalBaseSplDb);
  const setGlobalBaseSplDb = useAudioControlsStore((s) => s.setGlobalBaseSplDb);

  const globalSoundSpeed = useUIStore((s) => s.globalSoundSpeed);
  const setGlobalSoundSpeed = useUIStore((s) => s.setGlobalSoundSpeed);
  const globalMeshLc = useUIStore((s) => s.globalMeshLc);
  const setGlobalMeshLc = useUIStore((s) => s.setGlobalMeshLc);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Advanced Settings</h3>
        <button
          onClick={onResetToDefaults}
          className="text-xs transition-colors hover:opacity-80 text-primary"
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>

      <AccordionSection title="Viewer" expanded={viewerExpanded} onToggle={() => setViewerExpanded((e) => !e)}>
        <div className="flex flex-col gap-1 pt-1">
          <CheckboxField checked={showAxesHelper} onChange={onShowAxesHelperChange} label="Show axes helper" />
          <CheckboxField checked={showLabelSprites} onChange={onShowLabelSpritesChange} label="Show label sprites" />
          <CheckboxField checked={showHoveringHighlight} onChange={onShowHoveringHighlightChange} label="Hovering highlight" />
          <CheckboxField checked={showSoundSpheres} onChange={onShowSoundSpheresChange} label="Show sound spheres" />
          <CheckboxField checked={showSceneListeners} onChange={onShowSceneListenersChange} label="Show listeners" />
        </div>
      </AccordionSection>

      <AccordionSection title="Acoustic simulation" expanded={acousticExpanded} onToggle={() => setAcousticExpanded((e) => !e)}>
        <div className="flex flex-col gap-2 pt-1">
          <RangeSlider
            label="Sound speed (m/s): "
            value={globalSoundSpeed}
            min={SPEED_OF_SOUND_MIN}
            max={SPEED_OF_SOUND_MAX}
            step={1}
            onChange={setGlobalSoundSpeed}
            defaultValue={DEFAULT_SPEED_OF_SOUND}
            formatValue={(v) => `${v} m/s`}
            hoverText="Applied to all simulation engines (Choras DE/DG, pyroomacoustics, Resonance Audio). Double-click to reset to 343 m/s."
          />
          <RangeSlider
            label="Mesh length (lc): "
            value={globalMeshLc}
            min={CHORAS_DE_LC_MIN}
            max={CHORAS_DE_LC_MAX}
            step={0.1}
            onChange={setGlobalMeshLc}
            defaultValue={CHORAS_DE_DEFAULT_LC}
            formatValue={(v) => `${v.toFixed(1)} m`}
            hoverText="Characteristic mesh length for DE method. Double-click to reset to 1.5 m."
          />
        </div>
      </AccordionSection>

      <AccordionSection title="API Tokens" expanded={tokensExpanded} onToggle={() => setTokensExpanded((e) => !e)}>
        <TokensSection />
      </AccordionSection>

      <AccordionSection title="LLM Models" expanded={llmExpanded} onToggle={() => setLlmExpanded((e) => !e)}>
        <select
          value={llmModel}
          onChange={(e) => onLlmModelChange(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light cursor-pointer hover:border-secondary-hover transition-colors focus:outline-none focus:ring-1"
          style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px`, accentColor: 'var(--color-primary)' }}
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

      <AccordionSection title="Sound Rendering" expanded={soundRenderingExpanded} onToggle={() => setSoundRenderingExpanded((e) => !e)}>
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-col gap-1.5">
            <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
              Listener orientation
            </h4>
            <div className="flex gap-2">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div
                  key={axis}
                  className="flex-1 flex flex-col gap-0.5"
                  title={`Double-click to reset (default: ${DEFAULT_LISTENER_ORIENTATION[axis]})`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-secondary-hover uppercase">{axis}</span>
                    <span className="text-[10px] font-bold text-primary">
                      {listenerOrientation[axis].toFixed(1)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={listenerOrientation[axis]}
                    onChange={(e) =>
                      onListenerOrientationChange({ ...listenerOrientation, [axis]: parseFloat(e.target.value) })
                    }
                    onDoubleClick={() =>
                      onListenerOrientationChange({ ...listenerOrientation, [axis]: DEFAULT_LISTENER_ORIENTATION[axis] })
                    }
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-secondary-light"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <h4 className="text-[10px] font-bold text-secondary-hover uppercase tracking-wider">
              Playback timing
            </h4>
            <RangeSlider
              label="Interval Jitter (s): "
              value={intervalJitterSeconds}
              min={0}
              max={15}
              step={0.5}
              onChange={setIntervalJitter}
              defaultValue={AUDIO_PLAYBACK.DEFAULT_INTERVAL_JITTER_SECONDS}
              hoverText="Each iteration fires at its base interval ± a random offset drawn from [0, jitter]. Also controls the stagger between sounds on Play All. Double-click to reset."
            />
            <RangeSlider
              label="Timeline Length (s): "
              value={timelineDurationMs / 1_000}
              min={30}
              max={600}
              step={30}
              onChange={(v) => setTimelineDurationMs(v * 1_000)}
              defaultValue={AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS / 1_000}
              hoverText="Fixed length of the visual and audio timeline in seconds. Sounds that extend past this boundary are trimmed. Double-click to reset to 180 s (3 min)."
            />
          </div>
        </div>
      </AccordionSection>

      <AccordionSection title="Audio Models" expanded={audioExpanded} onToggle={() => setAudioExpanded((e) => !e)}>
        <div className="flex flex-col gap-2">
          <RangeSlider
            label="Base SPL (dB): "
            value={globalBaseSplDb}
            min={SPL_MIN}
            max={SPL_MAX}
            step={1}
            onChange={setGlobalBaseSplDb}
            defaultValue={DEFAULT_SPL_DB}
            hoverText="Reference SPL level used in audio calibration for all generated sounds. Double-click to reset to 70 dB."
          />
          <select
            value={audioModel}
            onChange={(e) => onAudioModelChange(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light cursor-pointer hover:border-secondary-hover transition-colors focus:outline-none focus:ring-1"
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px`, accentColor: 'var(--color-primary)' }}
          >
            <option value={AUDIO_MODEL_TANGOFLUX}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX]}</option>
            <option value={AUDIO_MODEL_AUDIOLDM2}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2]}</option>
            <option value={AUDIO_MODEL_ELEVENLABS}>{AUDIO_MODEL_NAMES[AUDIO_MODEL_ELEVENLABS]}</option>
          </select>
          <p className="text-[10px] text-secondary-hover leading-tight">
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
                <label className="block text-[10px] font-medium mb-1 text-foreground">
                  Global Negative Prompt
                </label>
                <textarea
                  value={globalNegativePrompt}
                  onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
                  placeholder="e.g., distorted, reverb, echo"
                  className="w-full px-2 py-1.5 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light resize-none placeholder:text-secondary-hover focus:border-primary focus:outline-none transition-colors"
                  style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                  rows={2}
                />
              </div>
            </>
          )}

        </div>
      </AccordionSection>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Box,
  Brain,
  AudioLines,
  type LucideIcon,
} from "lucide-react";
import { RangeSlider } from "@/components/ui/RangeSlider";
import { CheckboxField } from "@/components/ui/CheckboxField";
import { CardSelect } from "@/components/ui/CardSelect";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SearchBar } from "@/components/ui/SearchBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiService } from "@/services/api";
import type { TokenStatus, LLMProviders } from "@/services/api";
import type { SoundscapeStats } from "@/types/soundscape";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import { useSoundscapeStore } from "@/store";
import { setElevenLabsApiKey, isElevenLabsKeySet } from "@/services/elevenlabs";
import { useServiceVersions } from "@/hooks/useServiceVersions";
import { useAudioControlsStore } from "@/store/audioControlsStore";
import { useUIStore } from "@/store/uiStore";
import { AUDIO_PLAYBACK } from "@/utils/constants";
import type { ColorThemePreference } from "@/utils/color-theme";
import {
  UI_BORDER_RADIUS,
  AUDIO_MODEL_TANGOFLUX,
  AUDIO_MODEL_AUDIOLDM2,
  AUDIO_MODEL_ELEVENLABS,
  AUDIO_MODEL_NAMES,
  AUDIO_MODEL_DESCRIPTIONS,
  TTS_AVAILABLE_MODELS,
  TTS_MODEL_NAMES,
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
  DEFAULT_DBFS,
  DBFS_MIN,
  DBFS_MAX,
  MAXIMUM_FOLEY_SOUNDS_MIN,
  MAXIMUM_FOLEY_SOUNDS_MAX,
  DEFAULT_MAXIMUM_FOLEY_SOUNDS,
  DEFAULT_DIFFUSION_STEPS,
} from "@/utils/constants";

function isProviderInstalled(modelKey: string, llmProviders: LLMProviders | null): boolean {
  if (!llmProviders) return true;
  const key = LLM_MODEL_TO_PROVIDER[modelKey];
  if (!key) return true;
  return llmProviders[key as keyof LLMProviders]?.installed ?? true;
}

export interface AdvancedSettingsSectionProps {
  globalSteps: number;
  globalNegativePrompt: string;
  applyDenoising: boolean;
  trimSilence: boolean;
  applyNoiseReduction: boolean;
  normalizeImpulseResponses: boolean;
  audioModel: string;
  llmModel: string;
  onGlobalStepsChange: (value: number) => void;
  onGlobalNegativePromptChange: (value: string) => void;
  onApplyDenoisingChange: (value: boolean) => void;
  onTrimSilenceChange: (value: boolean) => void;
  onApplyNoiseReductionChange: (value: boolean) => void;
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
  showScenarioParcours: boolean;
  onShowScenarioParcoursChange: (value: boolean) => void;
  showGroundGrid: boolean;
  onShowGroundGridChange: (value: boolean) => void;
  groundGridSpacing: number;
  onGroundGridSpacingChange: (value: number) => void;
  groundGridColor: string;
  onGroundGridColorChange: (value: string) => void;
  listenerOrientation: { x: number; y: number; z: number };
  onListenerOrientationChange: (orientation: { x: number; y: number; z: number }) => void;
  onDeleteHistory: () => void;
}

// ── Section key type ──────────────────────────────────────────────────────────

type SectionKey = 'display' | 'acoustic' | 'tokens' | 'llm' | 'rendering' | 'history';

const SECTION_LABELS: Record<SectionKey, string> = {
  display: 'Display',
  acoustic: 'Acoustic',
  tokens: 'API Tokens',
  llm: 'Models',
  rendering: 'Audio settings',
  history: 'History',
};

const SECTION_KEYS: SectionKey[] = ['display', 'acoustic', 'tokens', 'llm', 'rendering', 'history'];

type SettingKey =
  | 'label-sprites' | 'hovering-highlight' | 'sound-spheres' | 'listeners' | 'ground-grid'
  | 'scenario-parcours' | 'appearance'
  | 'grid-spacing' | 'grid-color'
  | 'sound-speed' | 'mesh-length'
  | 'tokens'
  | 'llm-model' | 'tts-model' | 'tts-language' | 'audio-model'
  | 'diffusion-steps' | 'negative-prompt' | 'noise-reduction' | 'trim-silence'
  | 'listener-orientation' | 'jitter' | 'timeline' | 'spectrograms'
  | 'base-spl' | 'max-foley'
  | 'auto-save' | 'delete-history';

interface SettingEntry {
  section: SectionKey;
  key: SettingKey;
  terms: string[];
}

const SETTINGS: SettingEntry[] = [
  { section: 'display', key: 'appearance', terms: ['appearance', 'theme', 'light', 'dark', 'color scheme', 'mode'] },
  { section: 'display', key: 'label-sprites', terms: ['label sprites', 'label', 'sprite'] },
  { section: 'display', key: 'hovering-highlight', terms: ['hovering highlight', 'hover', 'highlight'] },
  { section: 'display', key: 'sound-spheres', terms: ['sound spheres', 'sphere'] },
  { section: 'display', key: 'listeners', terms: ['listeners', 'listener'] },
  { section: 'display', key: 'scenario-parcours', terms: ['scenario parcours', 'parcours', 'scenario', 'arrow', 'path'] },
  { section: 'display', key: 'ground-grid', terms: ['ground grid', 'grid'] },
  { section: 'display', key: 'grid-spacing', terms: ['grid spacing', 'spacing', 'grid'] },
  { section: 'display', key: 'grid-color', terms: ['grid color', 'color', 'grid'] },

  { section: 'acoustic', key: 'sound-speed', terms: ['sound speed', 'speed', 'velocity'] },
  { section: 'acoustic', key: 'mesh-length', terms: ['mesh length', 'lc', 'characteristic length', 'mesh'] },

  { section: 'tokens', key: 'tokens', terms: ['speckle', 'google', 'openai', 'anthropic', 'elevenlabs', 'token', 'api key', 'project name', 'apply tokens'] },

  { section: 'llm', key: 'llm-model', terms: ['llm', 'llm model', 'models', 'language model', 'gemini', 'openai', 'anthropic', 'chatgpt', 'claude'] },
  { section: 'llm', key: 'tts-model', terms: ['tts', 'tts model', 'speech', 'text to speech', 'gemini tts'] },
  { section: 'llm', key: 'tts-language', terms: ['tts language', 'language', 'voice', 'accent'] },
  { section: 'llm', key: 'audio-model', terms: ['text-to-audio', 'audio model', 'tangoflux', 'audioldm', 'elevenlabs', 'generator'] },
  { section: 'llm', key: 'diffusion-steps', terms: ['diffusion steps', 'steps', 'inference', 'text-to-audio settings'] },
  { section: 'llm', key: 'negative-prompt', terms: ['negative prompt', 'prompt', 'text-to-audio settings'] },
  { section: 'llm', key: 'noise-reduction', terms: ['noise reduction', 'denoising', 'noise', 'reduction', 'text-to-audio settings'] },
  { section: 'llm', key: 'trim-silence', terms: ['trim silence', 'silence', 'trim', 'text-to-audio settings'] },

  { section: 'rendering', key: 'listener-orientation', terms: ['listener orientation', 'orientation', 'listener', 'x', 'y', 'z'] },
  { section: 'rendering', key: 'jitter', terms: ['jitter', 'interval jitter', 'time', 'stagger', 'timeline settings'] },
  { section: 'rendering', key: 'timeline', terms: ['timeline', 'duration', 'time', 'timeline settings'] },
  { section: 'rendering', key: 'spectrograms', terms: ['spectrograms', 'spectrogram'] },
  { section: 'rendering', key: 'base-spl', terms: ['base level', 'base spl', 'spl', 'volume', 'db', 'decibel'] },
  { section: 'rendering', key: 'max-foley', terms: ['max sounds', 'max foley', 'foley', 'maximum sounds', 'prompt'] },

  { section: 'history', key: 'auto-save', terms: ['autosave', 'auto-save', 'soundscape', 'auto save', 'persist'] },
  { section: 'history', key: 'delete-history', terms: ['delete history', 'clear history', 'delete', 'history', 'reset project'] },
];

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
    <div className="relative flex items-center">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={handleChange}
        aria-label={label}
        placeholder={isSet ? "Already set — leave blank to keep" : (placeholder ?? "Paste token here")}
        className={`w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors ${value ? "pr-7" : ""} ${isSet ? "placeholder:text-[9px] placeholder:text-blue-text" : "placeholder:text-secondary-hover"}`}
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
  );
}

function searchMatches(query: string, terms: string[]): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  const words = q.split(/\s+/);
  return terms.some((t) => words.some((w) => t.toLowerCase().includes(w)));
}

function TokenGroup({
  title,
  href,
  icon: LinkIcon,
  isSet,
  searchQuery = "",
  searchTerms = [],
  children,
}: {
  title: string;
  href: string;
  icon: LucideIcon;
  isSet: boolean;
  searchQuery?: string;
  searchTerms?: string[];
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const forceExpanded = searchMatches(searchQuery, [title, ...searchTerms]);
  const isOpen = forceExpanded || expanded;

  const headerColor = isSet ? "text-blue-text" : "text-secondary-hover";

  return (
    <div className="flex flex-col gap-1">
      <div className={`flex items-center gap-1 ${headerColor}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
          aria-expanded={isOpen}
        >
          {isOpen
            ? <ChevronDown size={11} className="shrink-0" />
            : <ChevronRight size={11} className="shrink-0" />}
          <span className="text-[9px] uppercase tracking-wider">{title}</span>
        </button>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 hover:opacity-70 transition-opacity"
          title={href}
          aria-label={`Open ${title} key page`}
        >
          <LinkIcon size={12} strokeWidth={2} />
        </a>
        {isSet && (
          <Check size={12} strokeWidth={2.5} className="shrink-0 text-blue-text" aria-label="Token set" />
        )}
      </div>
      {isOpen && (
        <div className="flex flex-col gap-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

function CollapsibleGroup({
  title,
  forceExpanded = false,
  children,
}: {
  title: string;
  forceExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = forceExpanded || expanded;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 w-full text-left text-[9px] uppercase tracking-wider text-secondary-hover hover:opacity-80 transition-opacity"
        aria-expanded={isOpen}
      >
        {isOpen
          ? <ChevronDown size={11} className="shrink-0" />
          : <ChevronRight size={11} className="shrink-0" />}
        <span>{title}</span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Tokens section ────────────────────────────────────────────────────────────

function TokensSection({ searchQuery = "" }: { searchQuery?: string }) {
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiService.getTokenStatus().then((s) => {
      setStatus(s);
      setSpeckleProject(s.speckle_project_name);
    }).catch(() => {}).finally(() => setLoaded(true));
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

  if (!loaded) {
    return <p className="text-[10px] text-secondary-hover">Loading tokens…</p>;
  }

  const speckleSet = status?.speckle_token_set ?? false;
  const googleSet = status?.google_api_key_set ?? false;
  const openaiSet = status?.openai_api_key_set ?? false;
  const anthropicSet = status?.anthropic_api_key_set ?? false;

  return (
    <div className="flex flex-col gap-2">
      <TokenGroup title="Speckle" href="https://app.speckle.systems" icon={Box} isSet={speckleSet} searchQuery={searchQuery} searchTerms={["speckle", "project name", "token", "api key"]}>
        <TokenInput label="SPECKLE_TOKEN" value={speckleToken} onChange={setSpeckleToken} isSet={speckleSet} />
        <input
          type="text"
          value={speckleProject}
          onChange={(e) => setSpeckleProject(e.target.value)}
          aria-label="SPECKLE_PROJECT_NAME"
          placeholder="soundscape-viewer"
          className="w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors placeholder:text-secondary-hover"
          style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        />
      </TokenGroup>

      <TokenGroup title="Google AI" href="https://aistudio.google.com/app/apikey" icon={Brain} isSet={googleSet} searchQuery={searchQuery} searchTerms={["google", "token", "api key"]}>
        <TokenInput label="GOOGLE_API_KEY" value={googleKey} onChange={setGoogleKey} isSet={googleSet} />
      </TokenGroup>

      <TokenGroup title="OpenAI" href="https://platform.openai.com/api-keys" icon={Brain} isSet={openaiSet} searchQuery={searchQuery} searchTerms={["openai", "token", "api key"]}>
        <TokenInput label="OPENAI_API_KEY" value={openaiKey} onChange={setOpenaiKey} isSet={openaiSet} />
      </TokenGroup>

      <TokenGroup title="Anthropic" href="https://console.anthropic.com/settings/keys" icon={Brain} isSet={anthropicSet} searchQuery={searchQuery} searchTerms={["anthropic", "token", "api key"]}>
        <TokenInput label="ANTHROPIC_API_KEY" value={anthropicKey} onChange={setAnthropicKey} isSet={anthropicSet} />
      </TokenGroup>

      <TokenGroup title="ElevenLabs" href="https://elevenlabs.io/app/settings/api-keys" icon={AudioLines} isSet={elevenlabsSet} searchQuery={searchQuery} searchTerms={["elevenlabs", "token", "api key"]}>
        <TokenInput label="ELEVENLABS_API_KEY" value={elevenlabsKey} onChange={setElevenlabsKey} isSet={elevenlabsSet} />
      </TokenGroup>

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
  globalSteps,
  globalNegativePrompt,
  applyDenoising,
  trimSilence,
  applyNoiseReduction,
  normalizeImpulseResponses,
  audioModel,
  llmModel,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onTrimSilenceChange,
  onApplyNoiseReductionChange,
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
  showScenarioParcours,
  onShowScenarioParcoursChange,
  showGroundGrid,
  onShowGroundGridChange,
  groundGridSpacing,
  onGroundGridSpacingChange,
  groundGridColor,
  onGroundGridColorChange,
  listenerOrientation,
  onListenerOrientationChange,
  onDeleteHistory,
}: AdvancedSettingsSectionProps) {
  const [activeSection, setActiveSection] = useState<SectionKey>(SECTION_KEYS[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [soundscapeStats, setSoundscapeStats] = useState<SoundscapeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const isSearchActive = searchQuery.trim().length > 0;

  const { matchingSections, visibleKeys } = useMemo(() => {
    if (!isSearchActive) {
      return { matchingSections: SECTION_KEYS, visibleKeys: new Set<SettingKey>() };
    }
    const q = searchQuery.toLowerCase().trim();
    const words = q.split(/\s+/);
    const sections = new Set<SectionKey>();
    const keys = new Set<SettingKey>();

    for (const entry of SETTINGS) {
      const label = SECTION_LABELS[entry.section].toLowerCase();
      const entryMatches =
        words.some((w) => label.includes(w)) ||
        entry.terms.some((t) => words.some((w) => t.toLowerCase().includes(w)));

      if (entryMatches) {
        sections.add(entry.section);
        keys.add(entry.key);
      }
    }

    return {
      matchingSections: Array.from(sections),
      visibleKeys: keys,
    };
  }, [searchQuery, isSearchActive]);

  useEffect(() => {
    if (isSearchActive && matchingSections.length > 0 && !matchingSections.includes(activeSection)) {
      setActiveSection(matchingSections[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchingSections, isSearchActive]);

  const isVisible = useCallback(
    (...keys: SettingKey[]) => {
      if (!isSearchActive) return true;
      return keys.some((k) => visibleKeys.has(k));
    },
    [isSearchActive, visibleKeys],
  );

  const serviceVersions = useServiceVersions();
  const llmProviders = serviceVersions?.llm_providers ?? null;

  const tokenSettingsTrigger = useTextGenerationStore((s) => s.tokenSettingsTrigger);
  useEffect(() => {
    if (tokenSettingsTrigger > 0) setActiveSection('tokens');
  }, [tokenSettingsTrigger]);

  const intervalJitterSeconds = useAudioControlsStore((s) => s.intervalJitterSeconds);
  const setIntervalJitter = useAudioControlsStore((s) => s.setIntervalJitter);
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const setTimelineDurationMs = useAudioControlsStore((s) => s.setTimelineDurationMs);
  const globalBaseDbfs = useAudioControlsStore((s) => s.globalBaseDbfs);
  const setGlobalBaseDbfs = useAudioControlsStore((s) => s.setGlobalBaseDbfs);
  const maximumFoleySounds = useAudioControlsStore((s) => s.maximumFoleySounds);
  const setMaximumFoleySounds = useAudioControlsStore((s) => s.setMaximumFoleySounds);

  const ttsLanguage = useAudioControlsStore((s) => s.ttsLanguage);
  const setTtsLanguage = useAudioControlsStore((s) => s.setTtsLanguage);
  const ttsModel = useSoundscapeStore((s) => s.ttsModel);
  const setTtsModel = useSoundscapeStore((s) => s.setTtsModel);

  const globalSoundSpeed = useUIStore((s) => s.globalSoundSpeed);
  const setGlobalSoundSpeed = useUIStore((s) => s.setGlobalSoundSpeed);
  const globalMeshLc = useUIStore((s) => s.globalMeshLc);
  const setGlobalMeshLc = useUIStore((s) => s.setGlobalMeshLc);
  const showSpectrograms = useUIStore((s) => s.showSpectrograms);
  const setShowSpectrograms = useUIStore((s) => s.setShowSpectrograms);
  const enableAutoSave = useUIStore((s) => s.enableAutoSave);
  const setEnableAutoSave = useUIStore((s) => s.setEnableAutoSave);
  const colorTheme = useUIStore((s) => s.colorTheme);
  const setColorTheme = useUIStore((s) => s.setColorTheme);

  useEffect(() => {
    if (activeSection !== 'history' || soundscapeStats !== null) return;
    const modelId = useUIStore.getState().globalSpeckleData?.model_id;
    if (!modelId) return;
    setStatsLoading(true);
    apiService.getSoundscapeStats(modelId).then((stats) => {
      setSoundscapeStats(stats);
    }).catch(() => {}).finally(() => {
      setStatsLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between mb-0.5 gap-2">
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search settings..."
          className="flex-1 min-w-0"
        />
        <button
          onClick={onResetToDefaults}
          className="text-[10px] transition-opacity hover:opacity-60 text-secondary-hover shrink-0"
          title="Reset to defaults"
        >
          Reset
        </button>
      </div>

      {/* Two-column layout: left nav + right content */}
      <div className="flex gap-2 w-full min-h-0">

        {/* Left: vertical menu */}
        <nav className="flex flex-col gap-0.5 shrink-0">
          {SECTION_KEYS.filter((k) => matchingSections.includes(k)).map((key) => {
            const isActive = activeSection === key;
            return (
              <button
                key={key}
                onClick={() => { if (!isActive) setActiveSection(key); }}
                className="text-left px-1 py-0.5 text-[10px] transition-colors rounded-sm whitespace-nowrap"
                style={{
                  color: isActive ? 'var(--color-primary)' : 'var(--color-secondary-hover)',
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {SECTION_LABELS[key]}
              </button>
            );
          })}
        </nav>

        {/* Divider */}
        <div className="w-px bg-secondary-light shrink-0 self-stretch" />

        {/* Right: content */}
        <div className="flex-1 min-w-0">
          {activeSection === 'display' && (
            <div className="flex flex-col gap-1">
              {isVisible('appearance') && (
                <div className="flex flex-col gap-2 py-0.5">
                  <span className="text-[10px] whitespace-nowrap tracking-wider text-secondary-hover">View mode</span>
                  <CardSelect
                    compact
                    value={colorTheme}
                    onChange={(v) => setColorTheme(v as ColorThemePreference)}
                    options={[
                      { value: 'system', label: 'System' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                </div>
              )}
              {/* <CheckboxField checked={showAxesHelper} onChange={onShowAxesHelperChange} label="Show axes helper" /> */}
              {isVisible('label-sprites') && (
                <CheckboxField checked={showLabelSprites} onChange={onShowLabelSpritesChange} label="Show label sprites" />
              )}
              {isVisible('hovering-highlight') && (
                <CheckboxField checked={showHoveringHighlight} onChange={onShowHoveringHighlightChange} label="Hovering highlight" />
              )}
              {isVisible('sound-spheres') && (
                <CheckboxField checked={showSoundSpheres} onChange={onShowSoundSpheresChange} label="Show sound spheres" />
              )}
              {isVisible('listeners') && (
                <CheckboxField checked={showSceneListeners} onChange={onShowSceneListenersChange} label="Show listeners" />
              )}
              {isVisible('scenario-parcours') && (
                <CheckboxField
                  checked={showScenarioParcours}
                  onChange={onShowScenarioParcoursChange}
                  label="Show scenario parcours"
                />
              )}
              {isVisible('ground-grid') && (
                <CheckboxField checked={showGroundGrid} onChange={onShowGroundGridChange} label="Show ground grid" />
              )}
              {showGroundGrid && isVisible('grid-spacing', 'grid-color') && (
                <div className="flex flex-col gap-1 pl-2 border-l border-secondary-light">
                  {isVisible('grid-spacing') && (
                    <RangeSlider
                      label="Spacing"
                      value={groundGridSpacing}
                      min={0.5}
                      max={50}
                      step={0.5}
                      unit="m"
                      onChange={onGroundGridSpacingChange}
                      defaultValue={5}
                      hoverText="Distance between grid lines in metres. Double-click to reset to 5 m."
                    />
                  )}
                  {isVisible('grid-color') && (
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] text-foreground">Color</label>
                      <input
                        type="color"
                        value={groundGridColor}
                        onChange={(e) => onGroundGridColorChange(e.target.value)}
                        className="w-8 h-5 cursor-pointer rounded border border-secondary-light bg-transparent"
                        title="Grid line color"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeSection === 'acoustic' && (
            <div className="flex flex-col gap-2">
              {isVisible('sound-speed') && (
                <RangeSlider
                  label="Sound speed"
                  value={globalSoundSpeed}
                  min={SPEED_OF_SOUND_MIN}
                  max={SPEED_OF_SOUND_MAX}
                  step={1}
                  unit="m/s"
                  onChange={setGlobalSoundSpeed}
                  defaultValue={DEFAULT_SPEED_OF_SOUND}
                  hoverText="Applied to all simulation engines (Choras DE/DG, pyroomacoustics, Resonance Audio). Double-click to reset to 343 m/s."
                />
              )}
              {isVisible('mesh-length') && (
                <RangeSlider
                  label="Mesh length (lc)"
                  value={globalMeshLc}
                  min={CHORAS_DE_LC_MIN}
                  max={CHORAS_DE_LC_MAX}
                  step={0.1}
                  unit="m"
                  onChange={setGlobalMeshLc}
                  defaultValue={CHORAS_DE_DEFAULT_LC}
                  hoverText="Characteristic mesh length for DE method. Double-click to reset to 1.5 m."
                />
              )}
            </div>
          )}

          {activeSection === 'tokens' && (
            isVisible('tokens') && <TokensSection searchQuery={searchQuery} />
          )}

          {activeSection === 'llm' && (
            <div className="flex flex-col gap-2">
              {isVisible('llm-model') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-secondary-hover">LLM model</label>
                  <CardSelect
                    value={llmModel}
                    onChange={onLlmModelChange}
                    options={[
                      LLM_MODEL_GEMINI_3_PRO,
                      LLM_MODEL_GEMINI_3_FLASH,
                      LLM_MODEL_GEMINI_PRO,
                      LLM_MODEL_GEMINI_FLASH,
                      LLM_MODEL_OPENAI,
                      LLM_MODEL_ANTHROPIC,
                    ].map((m) => {
                      const installed = isProviderInstalled(m, llmProviders);
                      return {
                        value: m,
                        label: `${LLM_MODEL_NAMES[m]}${!installed ? " (not installed)" : ""}`,
                        disabled: !installed,
                      };
                    })}
                  />
                </div>
              )}
              {isVisible('tts-model') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-secondary-hover">TTS Model</label>
                  <CardSelect
                    forceMenu
                    value={ttsModel}
                    onChange={setTtsModel}
                    options={TTS_AVAILABLE_MODELS.map((m) => ({
                      value: m,
                      label: TTS_MODEL_NAMES[m],
                    }))}
                  />
                </div>
              )}
              {isVisible('tts-language') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-secondary-hover">TTS Language</label>
                  <input
                    type="text"
                    value={ttsLanguage}
                    onChange={(e) => setTtsLanguage(e.target.value)}
                    placeholder="e.g. English with a slightly german accent"
                    className="w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors"
                    style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                  />
                </div>
              )}
              {isVisible('audio-model') && (
                <div className="flex flex-col gap-0.5">
                  <label className="text-[10px] text-secondary-hover">Text-to-audio Model</label>
                  <CardSelect
                    forceMenu
                    value={audioModel}
                    onChange={onAudioModelChange}
                    options={[
                      {
                        value: AUDIO_MODEL_TANGOFLUX,
                        label: AUDIO_MODEL_NAMES[AUDIO_MODEL_TANGOFLUX],
                        title: AUDIO_MODEL_DESCRIPTIONS[AUDIO_MODEL_TANGOFLUX],
                      },
                      {
                        value: AUDIO_MODEL_AUDIOLDM2,
                        label: AUDIO_MODEL_NAMES[AUDIO_MODEL_AUDIOLDM2],
                        title: AUDIO_MODEL_DESCRIPTIONS[AUDIO_MODEL_AUDIOLDM2],
                      },
                      {
                        value: AUDIO_MODEL_ELEVENLABS,
                        label: AUDIO_MODEL_NAMES[AUDIO_MODEL_ELEVENLABS],
                        title: AUDIO_MODEL_DESCRIPTIONS[AUDIO_MODEL_ELEVENLABS],
                      },
                    ]}
                  />
                </div>
              )}
              {isVisible('diffusion-steps', 'negative-prompt', 'noise-reduction', 'trim-silence') && (
                <CollapsibleGroup title="Text-to-audio settings" forceExpanded={isSearchActive}>
                  {audioModel !== AUDIO_MODEL_ELEVENLABS && isVisible('diffusion-steps') && (
                    <RangeSlider
                      label="Diffusion Steps"
                      value={globalSteps}
                      min={10}
                      max={100}
                      step={5}
                      defaultValue={DEFAULT_DIFFUSION_STEPS}
                      onChange={onGlobalStepsChange}
                      hoverText="Higher steps = better quality but slower"
                    />
                  )}
                  {audioModel !== AUDIO_MODEL_ELEVENLABS && isVisible('negative-prompt') && (
                    <div>
                      <label className="block text-[10px] mb-1 text-foreground">Negative Prompt</label>
                      <textarea
                        value={globalNegativePrompt}
                        onChange={(e) => onGlobalNegativePromptChange(e.target.value)}
                        placeholder="e.g., distorted, reverb, echo"
                        className="w-full px-2 py-1.5 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light resize-none placeholder:text-secondary-hover focus:border-primary focus:outline-none transition-colors"
                        style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                        rows={2}
                      />
                    </div>
                  )}
                  {isVisible('noise-reduction') && (
                    <CheckboxField
                      checked={applyNoiseReduction}
                      onChange={onApplyNoiseReductionChange}
                      label="Apply noise reduction"
                    />
                  )}
                  {applyNoiseReduction && isVisible('trim-silence') && (
                    <CheckboxField
                      checked={trimSilence}
                      onChange={onTrimSilenceChange}
                      label="Trim silence"
                    />
                  )}
                </CollapsibleGroup>
              )}
            </div>
          )}

          {activeSection === 'rendering' && (
            <div className="flex flex-col gap-2">
              {isVisible('base-spl') && (
                <RangeSlider
                  label="Base Level"
                  value={globalBaseDbfs}
                  min={DBFS_MIN}
                  max={DBFS_MAX}
                  step={1}
                  unit="dBFS"
                  onChange={setGlobalBaseDbfs}
                  defaultValue={DEFAULT_DBFS}
                  hoverText="Reference level in dBFS used in audio calibration for all generated sounds. Double-click to reset to -18 dBFS."
                />
              )}
              {isVisible('jitter', 'timeline') && (
                <CollapsibleGroup title="Timeline settings" forceExpanded={isSearchActive}>
                  {isVisible('jitter') && (
                    <RangeSlider
                      label="Jitter"
                      value={intervalJitterSeconds}
                      min={0}
                      max={15}
                      step={0.5}
                      unit="s"
                      onChange={setIntervalJitter}
                      defaultValue={AUDIO_PLAYBACK.DEFAULT_INTERVAL_JITTER_SECONDS}
                      hoverText="Each iteration fires at its base interval ± a random offset drawn from [0, jitter]. Also controls the stagger between sounds on Play All. Double-click to reset."
                    />
                  )}
                  {isVisible('timeline') && (
                    <RangeSlider
                      label="Duration"
                      value={timelineDurationMs / 1_000}
                      min={30}
                      max={600}
                      step={30}
                      unit="s"
                      onChange={(v) => setTimelineDurationMs(v * 1_000)}
                      defaultValue={AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS / 1_000}
                      hoverText="Fixed length of the visual and audio timeline in seconds. Sounds that extend past this boundary are trimmed. Double-click to reset to 180 s (3 min)."
                    />
                  )}
                </CollapsibleGroup>
              )}
              {isVisible('spectrograms') && (
                <CheckboxField
                  checked={showSpectrograms}
                  onChange={setShowSpectrograms}
                  label="Show spectrograms"
                />
              )}
              {isVisible('max-foley') && (
                <RangeSlider
                  label="Max sounds"
                  min={MAXIMUM_FOLEY_SOUNDS_MIN}
                  max={MAXIMUM_FOLEY_SOUNDS_MAX}
                  step={1}
                  value={maximumFoleySounds}
                  defaultValue={DEFAULT_MAXIMUM_FOLEY_SOUNDS}
                  onChange={setMaximumFoleySounds}
                  hoverText="Maximum generated sounds per prompt"
                />
              )}
              {isVisible('listener-orientation') && (
                <CollapsibleGroup title="Listener orientation" forceExpanded={isSearchActive}>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <RangeSlider
                      key={axis}
                      label={axis.toUpperCase()}
                      value={listenerOrientation[axis]}
                      min={-1}
                      max={1}
                      step={0.1}
                      defaultValue={DEFAULT_LISTENER_ORIENTATION[axis]}
                      onChange={(v) => onListenerOrientationChange({ ...listenerOrientation, [axis]: v })}
                    />
                  ))}
                </CollapsibleGroup>
              )}              
            </div>
          )}

          {activeSection === 'history' && (
            <div className="flex flex-col gap-2">
              {isVisible('auto-save') && (
                <CheckboxField
                  checked={enableAutoSave}
                  onChange={setEnableAutoSave}
                  label="Autosave"
                />
              )}
              {isVisible('delete-history') && (
                <div className="flex flex-col gap-1.5">
                  {soundscapeStats?.found ? (
                    <div
                      className="flex flex-col gap-1 p-1.5 rounded text-[10px] leading-tight"
                      style={{
                        background: 'var(--color-secondary-lighter)',
                        borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                      }}
                    >
                      {soundscapeStats.model_name && (
                        <div className="font-medium text-foreground">
                          {soundscapeStats.model_name}
                        </div>
                      )}
                      {soundscapeStats.created_at && (
                        <div className="text-secondary-hover">
                          Saved {new Date(soundscapeStats.created_at).toLocaleDateString()}
                          {soundscapeStats.last_modified && soundscapeStats.last_modified !== soundscapeStats.created_at
                            ? ` \u00b7 Updated ${new Date(soundscapeStats.last_modified).toLocaleDateString()}`
                            : ''}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        {soundscapeStats.sound_configs > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.sound_configs} config{soundscapeStats.sound_configs !== 1 ? 's' : ''}
                          </span>
                        )}
                        {soundscapeStats.sound_events > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.sound_events} sound{soundscapeStats.sound_events !== 1 ? 's' : ''}
                          </span>
                        )}
                        {soundscapeStats.audio_files > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.audio_files} audio file{soundscapeStats.audio_files !== 1 ? 's' : ''} ({soundscapeStats.audio_size_formatted})
                          </span>
                        )}
                        {soundscapeStats.ir_files > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.ir_files} IR{soundscapeStats.ir_files !== 1 ? 's' : ''} ({soundscapeStats.ir_size_formatted})
                          </span>
                        )}
                        {soundscapeStats.receivers > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.receivers} receiver{soundscapeStats.receivers !== 1 ? 's' : ''}
                          </span>
                        )}
                        {soundscapeStats.simulation_configs > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.simulation_configs} simulation{soundscapeStats.simulation_configs !== 1 ? 's' : ''}
                          </span>
                        )}
                        {soundscapeStats.analysis_cards > 0 && (
                          <span className="text-secondary-hover">
                            {soundscapeStats.analysis_cards} analysis card{soundscapeStats.analysis_cards !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      {soundscapeStats.total_size_bytes > 0 && (
                        <div className="text-secondary-hover">
                          Total: {soundscapeStats.total_size_formatted}
                        </div>
                      )}
                    </div>
                  ) : statsLoading ? (
                    <p className="text-[10px] text-secondary-hover">Loading saved data info...</p>
                  ) : (
                    <EmptyState message="No saved data found for this project." />
                  )}
                  {showDeleteConfirm ? (
                    <ConfirmDialog
                      message="Delete all saved history for this project?"
                      confirmLabel="Delete"
                      variant="danger"
                      disabled={deleting}
                      onConfirm={() => {
                        setDeleting(true);
                        onDeleteHistory();
                      }}
                      onCancel={() => setShowDeleteConfirm(false)}
                    />
                  ) : (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="py-1.5 text-xs font-medium rounded transition-colors"
                      style={{
                        background: 'color-mix(in srgb, var(--color-error) 15%, transparent)',
                        color: 'var(--color-error)',
                        border: '1px solid var(--color-error)',
                        borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                      }}
                    >
                      Delete project history
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

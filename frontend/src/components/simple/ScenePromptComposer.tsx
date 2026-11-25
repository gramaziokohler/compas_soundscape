'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { EditableCycleChip } from '@/components/ui/EditableCycleChip';
import { EditableTextChip } from '@/components/ui/EditableTextChip';
import { ImagePreviewButton } from '@/components/ui/ImagePreviewButton';
import { NestedMenu, type NestedMenuItem } from '@/components/ui/NestedMenu';
import { TtsLanguageStatus } from '@/components/ui/TtsLanguageStatus';
import { useTtsLanguageResolver } from '@/hooks/useTtsLanguageResolver';
import { defaultSceneOptions, useAudioControlsStore, useSoundscapeStore, useUIStore } from '@/store';
import { chooseModel } from '@/lib/user-preferences-sync';
import type { SceneWorkflowOptions } from '@/types/sceneWorkflow';
import {
  AUDIO_MODEL_NAMES,
  FOLEY_SOUND_DETAIL_HINT,
  FOLEY_SOUND_DETAIL_OPTIONS,
  IMAGE_PREVIEW,
  LLM_MODEL_NAMES,
  SCENARIO_TIMELINE,
  SCENE_LIVELINESS_HINT,
  SCENE_LIVELINESS_OPTIONS,
  SIMPLE_MODE,
} from '@/utils/constants';
import { isModEnter } from '@/lib/shortcuts/keyboard-utils';
import { blobToDataUrl } from '@/utils/dataUrl';
import { formatSceneDuration, MS_PER_SECOND } from '@/utils/sceneWorkflow';

const DURATION_OPTIONS_S = SIMPLE_MODE.DURATION_OPTIONS_MS.map((ms) => ms / MS_PER_SECOND);
const formatDuration = (s: number) => formatSceneDuration(s * MS_PER_SECOND);

/** Files the composer accepts as a reference image (SIMPLE_MODE.IMAGE_ACCEPT). */
const IMAGE_TYPES = SIMPLE_MODE.IMAGE_ACCEPT.split(',');
const isImageFile = (file: File) => IMAGE_TYPES.includes(file.type);
const hasDraggedFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

export interface ScenePromptComposerProps {
  onSubmit: (prompt: string, options: SceneWorkflowOptions) => void;
  onClose: () => void;
}

/**
 * ScenePromptComposer Component
 *
 * Minimal AI-prompt box for a new sound scene: free-text description, the three
 * everyday options as chips (speech, speech language, duration — click cycles,
 * double-click types an exact value), and a "+" that opens a multi-level menu for
 * the rest (text-to-audio model, LLM, scenario plausibility, foley sound detail,
 * reference image). The number of people is not asked: the scenarist infers it
 * from the prompt ("2 people and 3 children", "no voices"…). A reference image can
 * also be dropped or pasted on the composer; it grounds the scenario, and a fresh
 * model analysis when a model is loaded. Enter sends, Shift+Enter adds a new line,
 * Escape closes. The prompt may be left empty with a model loaded or an image
 * attached — the scenario is then imagined from the model analysis / the image.
 *
 * Usage:
 * ```tsx
 * <ScenePromptComposer onSubmit={startScene} onClose={close} />
 * ```
 */
export function ScenePromptComposer({ onSubmit, onClose }: ScenePromptComposerProps) {
  const hasModel = useUIStore((s) => !!s.globalSpeckleData);
  // Empty speechLanguage = keep the app-wide TTS language (English by default).
  const appSpeechLanguage = useAudioControlsStore((s) => s.ttsLanguage);
  // Checks a committed speech language against the voice library / custom voices.
  const languageResolver = useTtsLanguageResolver();
  // Models are the Advanced Settings ones, read live: the Home composer can mount
  // before the user preferences load, so a snapshot at mount would go stale.
  // Picking one here changes (and persists) the Advanced Settings model.
  const audioModel = useSoundscapeStore((s) => s.audioModel);
  const llmModel = useSoundscapeStore((s) => s.llmModel);

  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<SceneWorkflowOptions>(() => defaultSceneOptions());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const patch = (p: Partial<SceneWorkflowOptions>) => setOptions((o) => ({ ...o, ...p }));
  // With a model loaded or an image attached, the scenario can be built without text.
  const canSend = prompt.trim().length > 0 || hasModel || !!options.image;
  // Speech on = allowed; the scenarist still decides whether anyone talks.
  const speechOn = options.includeSpeech;
  // Atmosphere chip: click cycles calm → normal → lively.
  const livelinessIdx = Math.max(0, SCENE_LIVELINESS_OPTIONS.findIndex((o) => o.value === options.liveliness));
  const livelinessOption = SCENE_LIVELINESS_OPTIONS[livelinessIdx];
  const nextLivelinessOption = SCENE_LIVELINESS_OPTIONS[(livelinessIdx + 1) % SCENE_LIVELINESS_OPTIONS.length];
  const nextLiveliness = nextLivelinessOption.value;
  const nextLivelinessLabel = nextLivelinessOption.label;
  const speechLanguage = options.speechLanguage || appSpeechLanguage;

  const submit = () => {
    if (!canSend) return;
    onSubmit(prompt.trim(), {
      ...options,
      audioModel,
      llmModel,
      includeSpeech: speechOn,
      speechLanguage: options.speechLanguage.trim(),
      reanalyze: hasModel && options.reanalyze,
    });
    setPrompt('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter submits even while an options menu is open (app-wide prompt shortcut).
    if (isModEnter(e)) {
      e.preventDefault();
      submit();
      return;
    }
    if (menu) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const attachImage = async (file: File) => {
    if (!isImageFile(file)) return;
    const dataUrl = await blobToDataUrl(file);
    // With a model, the image helps through a fresh model analysis — on by default.
    patch({ image: { name: file.name, dataUrl }, reanalyze: true });
    inputRef.current?.focus();
  };

  const handleImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void attachImage(file);
  };

  // Drag events stop here: on the Home stage a window-level drop listener
  // would otherwise take the image for a 3D model upload.
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleDragEnterLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e)) return;
    e.stopPropagation();
    // Moving onto a child of the composer is not leaving the composer.
    if (e.type === 'dragleave' && e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(e.type === 'dragenter');
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(isImageFile);
    if (file) void attachImage(file);
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files).find(isImageFile);
    if (!file) return; // plain text pastes as usual
    e.preventDefault();
    void attachImage(file);
  };

  const setSpeechLanguage = (v: string) => {
    patch({ speechLanguage: v });
    void languageResolver.resolve(v || appSpeechLanguage);
  };

  const menuItems: NestedMenuItem[] = [
    {
      kind: 'submenu',
      key: 'audio-model',
      label: 'Text-to-audio model',
      hint: AUDIO_MODEL_NAMES[audioModel],
      items: SIMPLE_MODE.AUDIO_MODEL_OPTIONS.map((m) => ({
        kind: 'radio' as const,
        key: m,
        label: AUDIO_MODEL_NAMES[m] ?? m,
        checked: audioModel === m,
        onSelect: () => chooseModel('audioModel', m),
      })),
    },
    {
      kind: 'submenu',
      key: 'llm-model',
      label: 'LLM model',
      hint: LLM_MODEL_NAMES[llmModel],
      items: SIMPLE_MODE.LLM_MODEL_OPTIONS.map((m) => ({
        kind: 'radio' as const,
        key: m,
        label: LLM_MODEL_NAMES[m] ?? m,
        checked: llmModel === m,
        onSelect: () => chooseModel('llmModel', m),
      })),
    },
    {
      kind: 'submenu',
      key: 'scenario',
      label: 'Scenario',
      hint: `Plausibility ${options.likeliness}/${SIMPLE_MODE.SCENARIO_LIKELINESS_MAX}`,
      items: [
        {
          kind: 'stepper',
          key: 'likeliness',
          label: 'Plausibility',
          value: options.likeliness,
          min: SIMPLE_MODE.SCENARIO_LIKELINESS_MIN,
          max: SIMPLE_MODE.SCENARIO_LIKELINESS_MAX,
          onChange: (v) => patch({ likeliness: v }),
        },
      ],
    },
    {
      kind: 'submenu',
      key: 'sound-detail',
      label: 'Sound detail',
      hint: FOLEY_SOUND_DETAIL_OPTIONS.find((o) => o.value === options.soundDetail)?.label,
      title: FOLEY_SOUND_DETAIL_HINT,
      items: FOLEY_SOUND_DETAIL_OPTIONS.map((o) => ({
        kind: 'radio' as const,
        key: o.value,
        label: o.label,
        title: o.title,
        checked: options.soundDetail === o.value,
        onSelect: () => patch({ soundDetail: o.value }),
      })),
    },
    {
      kind: 'submenu',
      key: 'liveliness',
      label: 'Atmosphere',
      hint: livelinessOption.label,
      title: SCENE_LIVELINESS_HINT,
      items: SCENE_LIVELINESS_OPTIONS.map((o) => ({
        kind: 'radio' as const,
        key: o.value,
        label: o.label,
        title: o.title,
        checked: options.liveliness === o.value,
        onSelect: () => patch({ liveliness: o.value }),
      })),
    },
    { kind: 'separator', key: 'sep-image' },
    {
      kind: 'action',
      key: 'image',
      label: options.image ? 'Replace image…' : 'Add an image…',
      hint: options.image?.name,
      onSelect: () => fileRef.current?.click(),
    },
    ...(options.image
      ? ([{ kind: 'action', key: 'remove-image', label: 'Remove image', onSelect: () => patch({ image: null }) }] as NestedMenuItem[])
      : []),
    // Re-analysis needs a model; without one the image grounds the scenario directly.
    ...(hasModel
      ? ([
          {
            kind: 'toggle',
            key: 'reanalyze',
            label: 'Re-run model analysis',
            checked: options.reanalyze,
            onChange: (v: boolean) => patch({ reanalyze: v }),
          },
        ] as NestedMenuItem[])
      : []),
  ];

  return (
    <div
      className={`flex flex-col gap-2 ${dragOver ? 'bubble-composer--drop' : ''}`}
      onDragEnter={handleDragEnterLeave}
      onDragLeave={handleDragEnterLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <textarea
        ref={inputRef}
        className="bubble-composer__input"
        rows={3}
        maxLength={SIMPLE_MODE.COMPOSER_MAX_PROMPT}
        placeholder={hasModel
          ? 'A busy restaurant at 10 a.m., staff setting tables… or leave empty to imagine one from the model. Drop a picture to guide it.'
          : 'A quiet library on a rainy afternoon… or drop a picture of a place'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        aria-label="Describe the sound scene"
      />
      <input ref={fileRef} type="file" accept={SIMPLE_MODE.IMAGE_ACCEPT} className="hidden" onChange={handleImage} />
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`bubble-chip ${speechOn ? 'bubble-chip--on' : ''}`}
          onClick={() => patch({ includeSpeech: !options.includeSpeech })}
          aria-pressed={speechOn}
          title={speechOn
            ? 'Voices and conversations when people in the scene would talk (write "no voices" to skip them)'
            : 'No voices in the scene'}
        >
          {speechOn ? '+ Speech' : 'No speech'}
        </button>
        <EditableTextChip
          value={speechLanguage}
          placeholder={SIMPLE_MODE.SPEECH_LANGUAGE_PLACEHOLDER}
          title="Language of the voices (any language or dialect)"
          disabled={!speechOn}
          onChange={setSpeechLanguage}
        />
        <EditableCycleChip
          value={options.durationMs / MS_PER_SECOND}
          options={DURATION_OPTIONS_S}
          min={SCENARIO_TIMELINE.MIN_SECONDS}
          max={SCENARIO_TIMELINE.MAX_SECONDS}
          format={formatDuration}
          unit="s"
          title="Length of the generated scene"
          onChange={(s) => patch({ durationMs: s * MS_PER_SECOND })}
        />
        <button
          type="button"
          className="bubble-chip"
          onClick={() => patch({ liveliness: nextLiveliness })}
          title={`Atmosphere: ${livelinessOption.title}. Click for ${nextLivelinessLabel}.`}
        >
          {livelinessOption.label}
        </button>
        <button
          type="button"
          className={`bubble-chip bubble-chip--icon ${menu ? 'bubble-chip--on' : ''}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu((m) => (m ? null : { x: rect.left, y: rect.bottom + 4 }));
          }}
          aria-label="More options"
          data-nested-menu=""
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          title="More options"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
        </button>
        {options.image && (
          // The whole chip enlarges the image; only the × removes it.
          <span className="bubble-chip bubble-chip--on bubble-chip--split">
            <ImagePreviewButton
              src={options.image.dataUrl}
              name={options.image.name}
              size={IMAGE_PREVIEW.CHIP_THUMB_PX}
              square
              className="bubble-chip__main"
            >
              <span className="max-w-[80px] truncate">{options.image.name}</span>
            </ImagePreviewButton>
            <button
              type="button"
              className="bubble-chip__remove"
              onClick={() => patch({ image: null })}
              aria-label="Remove image"
              title="Remove image"
            >
              ×
            </button>
          </span>
        )}
        <button
          type="button"
          className="bubble-send ml-auto"
          onClick={submit}
          disabled={!canSend}
          aria-label="Generate scene"
          title={prompt.trim()
            ? 'Generate scene (Enter)'
            : options.image
              ? 'Generate a scene from the image (Enter)'
              : 'Generate a scene from the model (Enter)'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {speechOn && <TtsLanguageStatus resolver={languageResolver} />}
      {menu && <NestedMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

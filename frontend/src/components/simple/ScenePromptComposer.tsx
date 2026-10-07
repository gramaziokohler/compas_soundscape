'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { EditableCycleChip } from '@/components/ui/EditableCycleChip';
import { NestedMenu, type NestedMenuItem } from '@/components/ui/NestedMenu';
import { TtsLanguageStatus } from '@/components/ui/TtsLanguageStatus';
import { useTtsLanguageResolver } from '@/hooks/useTtsLanguageResolver';
import { defaultSceneOptions, useAudioControlsStore, useUIStore } from '@/store';
import type { SceneWorkflowOptions } from '@/types/sceneWorkflow';
import { AUDIO_MODEL_NAMES, LLM_MODEL_NAMES, SCENARIO_TIMELINE, SIMPLE_MODE } from '@/utils/constants';
import { isModEnter } from '@/lib/shortcuts/keyboard-utils';
import { formatSceneDuration, MS_PER_SECOND } from '@/utils/sceneWorkflow';

const DURATION_OPTIONS_S = SIMPLE_MODE.DURATION_OPTIONS_MS.map((ms) => ms / MS_PER_SECOND);
const formatPeople = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const formatDuration = (s: number) => formatSceneDuration(s * MS_PER_SECOND);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export interface ScenePromptComposerProps {
  /** A scene is already running — the new one will be queued. */
  willQueue: boolean;
  onSubmit: (prompt: string, options: SceneWorkflowOptions) => void;
  onClose: () => void;
}

/**
 * ScenePromptComposer Component
 *
 * Minimal AI-prompt box for a new sound scene: free-text description, the three
 * everyday options as chips (speech, people, duration — click cycles, double-click
 * types an exact value; no people means no speech), and a "+" that opens a
 * multi-level menu for the rest (text-to-audio model, LLM, scenario
 * plausibility, free-text speech language, reference image — used by
 * the scenario, and by a fresh model analysis when a model is loaded). Enter sends,
 * Shift+Enter adds a new line, Escape closes. With a model loaded the prompt may be
 * left empty — the scenario is then imagined from the model analysis alone.
 *
 * Usage:
 * ```tsx
 * <ScenePromptComposer willQueue={isBusy} onSubmit={startScene} onClose={close} />
 * ```
 */
export function ScenePromptComposer({ willQueue, onSubmit, onClose }: ScenePromptComposerProps) {
  const hasModel = useUIStore((s) => !!s.globalSpeckleData);
  // Empty speechLanguage = keep the app-wide TTS language (English by default).
  const appSpeechLanguage = useAudioControlsStore((s) => s.ttsLanguage);
  // Checks a committed speech language against the voice library / custom voices.
  const languageResolver = useTtsLanguageResolver();

  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<SceneWorkflowOptions>(() => defaultSceneOptions());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const patch = (p: Partial<SceneWorkflowOptions>) => setOptions((o) => ({ ...o, ...p }));
  // With a model loaded the scenario can be built from the model analysis alone.
  const canSend = prompt.trim().length > 0 || hasModel;
  // Speech needs people; the speech preference is kept for when people return.
  const hasPeople = options.peopleCount > 0;
  const speechOn = options.includeSpeech && hasPeople;

  const submit = () => {
    if (!canSend) return;
    onSubmit(prompt.trim(), {
      ...options,
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

  const handleImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await readAsDataUrl(file);
    // A reference image only helps through a fresh model analysis — on by default.
    patch({ image: { name: file.name, dataUrl }, reanalyze: true });
  };

  const menuItems: NestedMenuItem[] = [
    {
      kind: 'submenu',
      key: 'audio-model',
      label: 'Text-to-audio model',
      hint: AUDIO_MODEL_NAMES[options.audioModel],
      items: SIMPLE_MODE.AUDIO_MODEL_OPTIONS.map((m) => ({
        kind: 'radio' as const,
        key: m,
        label: AUDIO_MODEL_NAMES[m] ?? m,
        checked: options.audioModel === m,
        onSelect: () => patch({ audioModel: m }),
      })),
    },
    {
      kind: 'submenu',
      key: 'llm-model',
      label: 'LLM model',
      hint: LLM_MODEL_NAMES[options.llmModel],
      items: SIMPLE_MODE.LLM_MODEL_OPTIONS.map((m) => ({
        kind: 'radio' as const,
        key: m,
        label: LLM_MODEL_NAMES[m] ?? m,
        checked: options.llmModel === m,
        onSelect: () => patch({ llmModel: m }),
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
      kind: 'text',
      key: 'language',
      label: 'Speech language',
      value: options.speechLanguage || appSpeechLanguage,
      placeholder: SIMPLE_MODE.SPEECH_LANGUAGE_PLACEHOLDER,
      onCommit: (v) => {
        patch({ speechLanguage: v });
        void languageResolver.resolve(v || appSpeechLanguage);
      },
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
    <div className="flex flex-col gap-2">
      <textarea
        ref={inputRef}
        className="bubble-composer__input"
        rows={3}
        maxLength={SIMPLE_MODE.COMPOSER_MAX_PROMPT}
        placeholder={hasModel
          ? 'A busy restaurant at 10 a.m., staff setting tables… or leave empty to imagine one from the model'
          : 'A quiet library on a rainy afternoon…'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Describe the sound scene"
      />
      <input ref={fileRef} type="file" accept={SIMPLE_MODE.IMAGE_ACCEPT} className="hidden" onChange={handleImage} />
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`bubble-chip ${speechOn ? 'bubble-chip--on' : ''}`}
          onClick={() => patch({ includeSpeech: !options.includeSpeech })}
          disabled={!hasPeople}
          aria-pressed={speechOn}
          title={hasPeople ? 'Add voices and conversations to the scene' : 'No people in the scene — no speech'}
        >
          {speechOn ? '+ Speech' : 'No speech'}
        </button>
        <EditableCycleChip
          value={options.peopleCount}
          options={SIMPLE_MODE.PEOPLE_OPTIONS}
          min={SIMPLE_MODE.SCENARIO_PEOPLE_MIN}
          max={SIMPLE_MODE.SCENARIO_PEOPLE_MAX}
          format={formatPeople}
          title="Number of people in the scene"
          onChange={(v) => patch({ peopleCount: v })}
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
          <span className="bubble-chip bubble-chip--on" title={options.image.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={options.image.dataUrl} alt="" width={14} height={14} style={{ borderRadius: 3, objectFit: 'cover' }} />
            <span className="max-w-[80px] truncate">{options.image.name}</span>
            <button type="button" onClick={() => patch({ image: null })} aria-label="Remove image">×</button>
          </span>
        )}
        <button
          type="button"
          className="bubble-send ml-auto"
          onClick={submit}
          disabled={!canSend}
          aria-label={willQueue ? 'Queue scene' : 'Generate scene'}
          title={willQueue
            ? 'Queue — starts when the current scene finishes'
            : prompt.trim() ? 'Generate scene (Enter)' : 'Generate a scene from the model (Enter)'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {speechOn && <TtsLanguageStatus resolver={languageResolver} />}
      {willQueue && <div className="bubble-step__meta">A scene is generating — this one will start right after.</div>}
      {menu && <NestedMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { NestedMenu, type NestedMenuItem } from '@/components/ui/NestedMenu';
import { TtsLanguageStatus } from '@/components/ui/TtsLanguageStatus';
import { useTtsLanguageResolver } from '@/hooks/useTtsLanguageResolver';
import { defaultSceneOptions, useAudioControlsStore, useUIStore } from '@/store';
import type { SceneQuality, SceneWorkflowOptions } from '@/types/sceneWorkflow';
import { AUDIO_MODEL_NAMES, LLM_MODEL_NAMES, SIMPLE_MODE } from '@/utils/constants';

const QUALITIES: SceneQuality[] = ['fast', 'precise'];

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`;
}

/** Next value in a list, wrapping around (chip click-to-cycle). */
function cycle<T>(list: readonly T[], current: T): T {
  const i = list.indexOf(current);
  return list[(i + 1) % list.length];
}

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
 * everyday options as chips (speech, fast/precise, duration), and a "+" that
 * opens a multi-level menu for the rest (text-to-audio model, LLM, scenario
 * people / plausibility, free-text speech language, reference image — used by
 * the scenario, and by a fresh model analysis when a model is loaded). Enter sends,
 * Shift+Enter adds a new line, Escape closes.
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
  const canSend = prompt.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSubmit(prompt.trim(), {
      ...options,
      speechLanguage: options.speechLanguage.trim(),
      reanalyze: hasModel && options.reanalyze,
    });
    setPrompt('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      hint: `${options.peopleCount} people`,
      items: [
        {
          kind: 'stepper',
          key: 'people',
          label: 'People',
          value: options.peopleCount,
          min: SIMPLE_MODE.SCENARIO_PEOPLE_MIN,
          max: SIMPLE_MODE.SCENARIO_PEOPLE_MAX,
          onChange: (v) => patch({ peopleCount: v }),
        },
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
        placeholder={hasModel ? 'A busy restaurant at 10 a.m., staff setting tables…' : 'A quiet library on a rainy afternoon…'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Describe the sound scene"
      />
      <input ref={fileRef} type="file" accept={SIMPLE_MODE.IMAGE_ACCEPT} className="hidden" onChange={handleImage} />
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`bubble-chip ${options.includeSpeech ? 'bubble-chip--on' : ''}`}
          onClick={() => patch({ includeSpeech: !options.includeSpeech })}
          aria-pressed={options.includeSpeech}
          title="Add voices and conversations to the scene"
        >
          {options.includeSpeech ? '+ Speech' : 'No speech'}
        </button>
        <button
          type="button"
          className="bubble-chip"
          onClick={() => patch({ quality: cycle(QUALITIES, options.quality) })}
          title="Fast generates quicker with fewer diffusion steps; Precise uses the full step count"
        >
          {SIMPLE_MODE.QUALITY_PRESETS[options.quality].label}
        </button>
        <button
          type="button"
          className="bubble-chip"
          onClick={() => patch({ durationMs: cycle(SIMPLE_MODE.DURATION_OPTIONS_MS, options.durationMs) })}
          title="Length of the generated scene"
        >
          {formatDuration(options.durationMs)}
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
          title={willQueue ? 'Queue — starts when the current scene finishes' : 'Generate scene (Enter)'}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {options.includeSpeech && <TtsLanguageStatus resolver={languageResolver} />}
      {willQueue && <div className="bubble-step__meta">A scene is generating — this one will start right after.</div>}
      {menu && <NestedMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

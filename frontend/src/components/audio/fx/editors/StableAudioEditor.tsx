'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { notifyError, pauseStore, commitStore, useSoundFxStore } from '@/store';
import {
  STABLE_AUDIO_MODES,
  STABLE_AUDIO_DEFAULT_STEPS,
  STABLE_AUDIO_DEFAULT_GUIDANCE,
  STABLE_AUDIO_GUIDANCE_MIN,
  STABLE_AUDIO_GUIDANCE_MAX,
  STABLE_AUDIO_GUIDANCE_STEP,
  STABLE_AUDIO_DEFAULT_STRENGTH,
  STABLE_AUDIO_EXTEND_DEFAULT_SECONDS,
  STABLE_AUDIO_EXTEND_MAX_SECONDS,
} from '@/utils/constants';
import type { FxChain, StableAudioModeName, StableAudioParams } from '@/lib/audio/fx/fx-types';
import {
  generateStableAudio,
  getStableAudioSource,
  stableAudioSignature,
} from '@/lib/audio/fx/stable-audio-render';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { FxParamSlider } from './FxParamSlider';

interface StableAudioEditorProps {
  soundId: string;
  instanceId: string;
  mode: StableAudioModeName;
  params: StableAudioParams;
  onLive: (params: StableAudioParams) => void;
  onCommit: (params: StableAudioParams) => void;
}

const PLACEHOLDERS: Record<StableAudioModeName, string> = {
  restyle: 'e.g., same sound but metallic and reverberant',
  inpaint: 'e.g., a heavy wooden door slamming shut',
  extend: 'e.g., keep the same ambience and continue gently',
};

export function StableAudioEditor({ soundId, instanceId, mode, params, onLive, onCommit }: StableAudioEditorProps) {
  const chains = useSoundFxStore((s) => s.chains);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [advanced, setAdvanced] = useState(false);

  const sourceDuration = getStableAudioSource(soundId)?.duration ?? 0;

  const preChain: FxChain = useMemo(() => {
    const chain = chains[soundId];
    if (!chain) return { instances: [], outputGainDb: 0 };
    const idx = chain.instances.findIndex((i) => i.instanceId === instanceId);
    return { instances: idx >= 0 ? chain.instances.slice(0, idx) : [], outputGainDb: 0 };
  }, [chains, soundId, instanceId]);

  const currentSignature = useMemo(
    () => stableAudioSignature(params, preChain, mode),
    [params, preChain, mode],
  );
  const isStale = Boolean(params.renderedUrl) && params.renderedSignature !== currentSignature;

  const set = (patch: Partial<StableAudioParams>, commit: boolean) => {
    const next = { ...params, ...patch } as StableAudioParams;
    if (commit) onCommit(next);
    else onLive(next);
  };

  const canGenerate =
    !busy &&
    sourceDuration > 0 &&
    (mode !== STABLE_AUDIO_MODES.INPAINT || params.regions.length > 0);

  const handleGenerate = async () => {
    const srcBuffer = getStableAudioSource(soundId);
    if (!srcBuffer) {
      notifyError('Load a sound before generating');
      return;
    }
    if (mode === STABLE_AUDIO_MODES.INPAINT && params.regions.length === 0) {
      notifyError('Draw at least one region on the waveform to inpaint');
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const url = await generateStableAudio({
        soundId,
        mode,
        params,
        preChain,
        sourceBuffer: srcBuffer,
        onProgress: (p) => setProgress(p),
      });
      onCommit({ ...params, renderedUrl: url, renderedSignature: currentSignature });
    } catch (err) {
      console.error('[StableAudio] generate failed', err);
      notifyError(err instanceof Error ? err.message : 'Stable Audio generation failed');
    } finally {
      setBusy(false);
    }
  };

  const extendsSeconds = params.duration > 0
    ? params.duration
    : sourceDuration + STABLE_AUDIO_EXTEND_DEFAULT_SECONDS;

  return (
    <div className="card-stack">
      <textarea
        value={params.prompt}
        onChange={(e) => set({ prompt: e.target.value }, false)}
        onFocus={() => pauseStore('soundFx')}
        onBlur={() => commitStore('soundFx')}
        placeholder={PLACEHOLDERS[mode]}
        className="w-full h-14 p-2 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:outline-none resize-none"
        rows={2}
      />

      {mode === STABLE_AUDIO_MODES.RESTYLE && (
        <FxParamSlider
          label="Transformation"
          value={params.strength}
          min={0}
          max={1}
          step={0.01}
          defaultValue={STABLE_AUDIO_DEFAULT_STRENGTH}
          onLive={(v) => set({ strength: v }, false)}
          onCommit={(v) => set({ strength: v }, true)}
        />
      )}

      {mode === STABLE_AUDIO_MODES.INPAINT && (
        <p className="text-[10px] text-secondary-hover">
          Drag one or more regions on the waveform above — each highlighted region will be
          regenerated and blended back in.{params.regions.length > 0 ? ` (${params.regions.length})` : ''}
        </p>
      )}

      {mode === STABLE_AUDIO_MODES.EXTEND && (
        <>
          <FxParamSlider
            label="New length"
            value={Math.round(extendsSeconds * 10) / 10}
            min={Math.max(1, Math.round((sourceDuration + 0.5) * 10) / 10)}
            max={Math.min(STABLE_AUDIO_EXTEND_MAX_SECONDS, Math.round((sourceDuration + 60) * 10) / 10)}
            step={0.5}
            unit="s"
            defaultValue={Math.round((sourceDuration + STABLE_AUDIO_EXTEND_DEFAULT_SECONDS) * 10) / 10}
            onLive={(v) => set({ duration: v }, false)}
            onCommit={(v) => set({ duration: v }, true)}
          />
          <p className="text-[10px] text-secondary-hover">
            Continues the clip past its end ({sourceDuration.toFixed(1)}s).
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1.5 text-left text-[10px] text-secondary-hover hover:text-foreground transition-colors"
      >
        {advanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>Stable Audio settings</span>
      </button>
      {advanced && (
        <div className="card-collapse-body">
          <FxParamSlider
            label="Steps"
            value={params.steps}
            min={4}
            max={50}
            step={1}
            defaultValue={STABLE_AUDIO_DEFAULT_STEPS}
            onLive={(v) => set({ steps: Math.round(v) }, false)}
            onCommit={(v) => set({ steps: Math.round(v) }, true)}
          />
          <FxParamSlider
            label="Guidance"
            value={params.guidance}
            min={STABLE_AUDIO_GUIDANCE_MIN}
            max={STABLE_AUDIO_GUIDANCE_MAX}
            step={STABLE_AUDIO_GUIDANCE_STEP}
            defaultValue={STABLE_AUDIO_DEFAULT_GUIDANCE}
            onLive={(v) => set({ guidance: v }, false)}
            onCommit={(v) => set({ guidance: v }, true)}
          />
          <div className="card-field--row">
            <label className="text-[10px] text-secondary-hover">Seed</label>
            <input
              type="number"
              value={params.seed}
              onChange={(e) => set({ seed: Number(e.target.value) }, true)}
              className="w-24 px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={!canGenerate}
          onClick={() => void handleGenerate()}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
          style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)' }}
        >
          {busy ? <Spinner /> : <Sparkles size={12} />}
          {busy ? `Generating ${progress}%` : params.renderedUrl ? 'Regenerate' : 'Generate'}
        </button>
        {params.renderedUrl && (
          isStale
            ? <Badge variant="warning" size="sm">Out of date</Badge>
            : <Badge variant="success" size="sm">Ready</Badge>
        )}
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import type { CleanParams, CompressorParams, DelayParams, DriveParams, FxChain, FxInstance, GainParams, GateParams, LimiterParams, NoiseReductionParams, PitchParams, StableAudioParams, TrimSilenceParams } from '@/lib/audio/fx/fx-types';
import { stableAudioModeFor } from '@/lib/audio/fx/fx-types';
import { SOUND_FX } from '@/utils/constants';
import { notifyError, useSoundFxStore } from '@/store';
import { getStableAudioSource } from '@/lib/audio/fx/stable-audio-render';
import { processServerPost, serverPostSignature, type ServerPostInstance } from '@/lib/audio/fx/server-post-render';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '@/components/ui/Badge';
import { EqEditor } from './EqEditor';
import { StableAudioEditor } from './StableAudioEditor';
import { FxParamSlider } from './FxParamSlider';

interface FxInstanceEditorProps {
  soundId: string;
  instance: FxInstance;
  analyser: AnalyserNode | null;
  sampleRate: number;
  onLive: (params: FxInstance['params']) => void;
  onCommit: (params: FxInstance['params']) => void;
}

export function FxInstanceEditor({ soundId, instance, analyser, sampleRate, onLive, onCommit }: FxInstanceEditorProps) {
  switch (instance.type) {
    case 'eq':
      return (
        <EqEditor
          params={instance.params}
          analyser={analyser}
          sampleRate={sampleRate}
          onLive={onLive}
          onCommit={onCommit}
        />
      );
    case 'clean':
      return <CleanEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'gate':
      return <GateEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'saturation':
    case 'distortion':
      return <DriveEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'compressor':
      return <CompressorEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'limiter':
      return <LimiterEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'delay':
      return <DelayEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'pitch':
      return <PitchEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'gain':
      return <GainEditor params={instance.params} onLive={onLive} onCommit={onCommit} />;
    case 'noiseReduction':
      return (
        <NoiseReductionEditor
          soundId={soundId}
          instanceId={instance.instanceId}
          params={instance.params}
          onLive={onLive as (p: NoiseReductionParams) => void}
          onCommit={onCommit as (p: NoiseReductionParams) => void}
        />
      );
    case 'trimSilence':
      return (
        <TrimSilenceEditor
          soundId={soundId}
          instanceId={instance.instanceId}
          params={instance.params}
          onLive={onLive as (p: TrimSilenceParams) => void}
          onCommit={onCommit as (p: TrimSilenceParams) => void}
        />
      );
    case 'stableAudioRestyle':
    case 'stableAudioInpaint':
    case 'stableAudioExtend':
      return (
        <StableAudioEditor
          soundId={soundId}
          instanceId={instance.instanceId}
          mode={stableAudioModeFor(instance.type)}
          params={instance.params as StableAudioParams}
          onLive={onLive as (p: StableAudioParams) => void}
          onCommit={onCommit as (p: StableAudioParams) => void}
        />
      );
  }
}

function CleanEditor({ params, onLive, onCommit }: { params: CleanParams; onLive: (p: CleanParams) => void; onCommit: (p: CleanParams) => void }) {
  const set = (patch: Partial<CleanParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="High-pass" value={params.highpassHz} min={20} max={20000} step={1} unit="Hz" defaultValue={20} onLive={(v) => set({ highpassHz: v }, false)} onCommit={(v) => set({ highpassHz: v }, true)} />
      <FxParamSlider label="Low-pass" value={params.lowpassHz} min={20} max={20000} step={1} unit="Hz" defaultValue={20000} onLive={(v) => set({ lowpassHz: v }, false)} onCommit={(v) => set({ lowpassHz: v }, true)} />
    </div>
  );
}

function GateEditor({ params, onLive, onCommit }: { params: GateParams; onLive: (p: GateParams) => void; onCommit: (p: GateParams) => void }) {
  const set = (patch: Partial<GateParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="Threshold" value={params.thresholdDb} min={-80} max={0} step={0.5} unit="dB" defaultValue={-40} onLive={(v) => set({ thresholdDb: v }, false)} onCommit={(v) => set({ thresholdDb: v }, true)} />
      <FxParamSlider label="Attack" value={params.attackMs} min={0.1} max={30} step={0.1} unit="ms" defaultValue={2} onLive={(v) => set({ attackMs: v }, false)} onCommit={(v) => set({ attackMs: v }, true)} />
      <FxParamSlider label="Hold" value={params.holdMs} min={0} max={200} step={1} unit="ms" defaultValue={40} onLive={(v) => set({ holdMs: v }, false)} onCommit={(v) => set({ holdMs: v }, true)} />
      <FxParamSlider label="Release" value={params.releaseMs} min={5} max={400} step={1} unit="ms" defaultValue={80} onLive={(v) => set({ releaseMs: v }, false)} onCommit={(v) => set({ releaseMs: v }, true)} />
    </div>
  );
}

function DriveEditor({ params, onLive, onCommit }: { params: DriveParams; onLive: (p: DriveParams) => void; onCommit: (p: DriveParams) => void }) {
  const set = (patch: Partial<DriveParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="Drive" value={params.drive} min={0} max={1} step={0.01} defaultValue={0.25} onLive={(v) => set({ drive: v }, false)} onCommit={(v) => set({ drive: v }, true)} />
      <FxParamSlider label="Tone" value={params.toneHz} min={800} max={12000} step={10} unit="Hz" defaultValue={6000} onLive={(v) => set({ toneHz: v }, false)} onCommit={(v) => set({ toneHz: v }, true)} />
      <FxParamSlider label="Mix" value={params.mix} min={0} max={1} step={0.01} defaultValue={0.5} onLive={(v) => set({ mix: v }, false)} onCommit={(v) => set({ mix: v }, true)} />
    </div>
  );
}

function CompressorEditor({ params, onLive, onCommit }: { params: CompressorParams; onLive: (p: CompressorParams) => void; onCommit: (p: CompressorParams) => void }) {
  const set = (patch: Partial<CompressorParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="Threshold" value={params.thresholdDb} min={-48} max={0} step={0.5} unit="dB" defaultValue={-18} onLive={(v) => set({ thresholdDb: v }, false)} onCommit={(v) => set({ thresholdDb: v }, true)} />
      <FxParamSlider label="Ratio" value={params.ratio} min={1} max={12} step={0.1} defaultValue={3} onLive={(v) => set({ ratio: v }, false)} onCommit={(v) => set({ ratio: v }, true)} />
      <FxParamSlider label="Attack" value={params.attackMs} min={0} max={80} step={0.5} unit="ms" defaultValue={8} onLive={(v) => set({ attackMs: v }, false)} onCommit={(v) => set({ attackMs: v }, true)} />
      <FxParamSlider label="Release" value={params.releaseMs} min={20} max={400} step={1} unit="ms" defaultValue={80} onLive={(v) => set({ releaseMs: v }, false)} onCommit={(v) => set({ releaseMs: v }, true)} />
      <FxParamSlider label="Makeup" value={params.makeupDb} min={0} max={12} step={0.5} unit="dB" defaultValue={0} onLive={(v) => set({ makeupDb: v }, false)} onCommit={(v) => set({ makeupDb: v }, true)} />
    </div>
  );
}

function LimiterEditor({ params, onLive, onCommit }: { params: LimiterParams; onLive: (p: LimiterParams) => void; onCommit: (p: LimiterParams) => void }) {
  const set = (patch: Partial<LimiterParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="Ceiling" value={params.thresholdDb} min={-24} max={0} step={0.1} unit="dB" defaultValue={-1} onLive={(v) => set({ thresholdDb: v }, false)} onCommit={(v) => set({ thresholdDb: v }, true)} />
      <FxParamSlider label="Release" value={params.releaseMs} min={10} max={400} step={1} unit="ms" defaultValue={60} onLive={(v) => set({ releaseMs: v }, false)} onCommit={(v) => set({ releaseMs: v }, true)} />
    </div>
  );
}

function DelayEditor({ params, onLive, onCommit }: { params: DelayParams; onLive: (p: DelayParams) => void; onCommit: (p: DelayParams) => void }) {
  const set = (patch: Partial<DelayParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <div className="card-stack">
      <FxParamSlider label="Time" value={params.timeMs} min={5} max={500} step={1} unit="ms" defaultValue={80} onLive={(v) => set({ timeMs: v }, false)} onCommit={(v) => set({ timeMs: v }, true)} />
      <FxParamSlider label="Feedback" value={params.feedback} min={0} max={0.9} step={0.01} defaultValue={0.2} onLive={(v) => set({ feedback: v }, false)} onCommit={(v) => set({ feedback: v }, true)} />
      <FxParamSlider label="Mix" value={params.mix} min={0} max={1} step={0.01} defaultValue={0.18} onLive={(v) => set({ mix: v }, false)} onCommit={(v) => set({ mix: v }, true)} />
    </div>
  );
}

function PitchEditor({ params, onLive, onCommit }: { params: PitchParams; onLive: (p: PitchParams) => void; onCommit: (p: PitchParams) => void }) {
  const set = (patch: Partial<PitchParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <FxParamSlider label="Semitones" value={params.semitones} min={-12} max={12} step={1} defaultValue={0} onLive={(v) => set({ semitones: v }, false)} onCommit={(v) => set({ semitones: v }, true)} />
  );
}

function GainEditor({ params, onLive, onCommit }: { params: GainParams; onLive: (p: GainParams) => void; onCommit: (p: GainParams) => void }) {
  const set = (patch: Partial<GainParams>, commit: boolean) => {
    const next = { ...params, ...patch };
    onLive(next);
    if (commit) onCommit(next);
  };
  return (
    <FxParamSlider label="Gain" value={params.gainDb} min={-24} max={12} step={0.5} unit="dB" defaultValue={0} onLive={(v) => set({ gainDb: v }, false)} onCommit={(v) => set({ gainDb: v }, true)} />
  );
}

/** Instances of the chain before the given stage (its server render input). */
function usePreChain(soundId: string, instanceId: string): FxChain {
  const chains = useSoundFxStore((s) => s.chains);
  return useMemo(() => {
    const chain = chains[soundId];
    if (!chain) return { instances: [], outputGainDb: 0 };
    const idx = chain.instances.findIndex((i) => i.instanceId === instanceId);
    return { instances: idx >= 0 ? chain.instances.slice(0, idx) : [], outputGainDb: 0 };
  }, [chains, soundId, instanceId]);
}

/**
 * Process + cache button shared by the backend post-effect editors. On success
 * the caller merges the returned URL + signature into its params.
 */
function ServerPostProcessRow({
  soundId,
  instance,
  preChain,
  signature,
  onProcessed,
}: {
  soundId: string;
  instance: ServerPostInstance;
  preChain: FxChain;
  signature: string;
  onProcessed: (renderedUrl: string, renderedSignature: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const params = instance.params;
  const isStale = Boolean(params.renderedUrl) && params.renderedSignature !== signature;

  const handleProcess = async () => {
    const srcBuffer = getStableAudioSource(soundId);
    if (!srcBuffer) {
      notifyError('Load a sound before processing');
      return;
    }
    setBusy(true);
    try {
      const url = await processServerPost({ instance, preChain, sourceBuffer: srcBuffer });
      onProcessed(url, signature);
    } catch (err) {
      console.error('[fx] server post-effect failed', err);
      notifyError(err instanceof Error ? err.message : 'Post-processing failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleProcess()}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
        style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)' }}
      >
        {busy ? <Spinner /> : null}
        {busy ? 'Processing' : params.renderedUrl ? 'Re-process' : 'Process'}
      </button>
      {params.renderedUrl && (
        isStale
          ? <Badge variant="warning" size="sm">Out of date</Badge>
          : <Badge variant="success" size="sm">Ready</Badge>
      )}
    </div>
  );
}

function NoiseReductionEditor({
  soundId,
  instanceId,
  params,
  onLive,
  onCommit,
}: {
  soundId: string;
  instanceId: string;
  params: NoiseReductionParams;
  onLive: (p: NoiseReductionParams) => void;
  onCommit: (p: NoiseReductionParams) => void;
}) {
  const preChain = usePreChain(soundId, instanceId);
  const instance = useMemo<ServerPostInstance>(
    () => ({ instanceId, type: 'noiseReduction', enabled: true, params }),
    [instanceId, params],
  );
  const signature = useMemo(() => serverPostSignature(instance, preChain), [instance, preChain]);

  const set = (reduction: number, commit: boolean) => {
    const next = { ...params, reduction };
    if (commit) onCommit(next);
    else onLive(next);
  };

  return (
    <div className="card-stack">
      <FxParamSlider
        label="Reduction"
        value={params.reduction}
        min={SOUND_FX.NOISE_REDUCTION_MIN}
        max={SOUND_FX.NOISE_REDUCTION_MAX}
        step={SOUND_FX.NOISE_REDUCTION_STEP}
        defaultValue={SOUND_FX.NOISE_REDUCTION_DEFAULT}
        onLive={(v) => set(v, false)}
        onCommit={(v) => set(v, true)}
      />
      <ServerPostProcessRow
        soundId={soundId}
        instance={instance}
        preChain={preChain}
        signature={signature}
        onProcessed={(url, sig) => onCommit({ ...params, renderedUrl: url, renderedSignature: sig })}
      />
    </div>
  );
}

function TrimSilenceEditor({
  soundId,
  instanceId,
  params,
  onCommit,
}: {
  soundId: string;
  instanceId: string;
  params: TrimSilenceParams;
  onLive: (p: TrimSilenceParams) => void;
  onCommit: (p: TrimSilenceParams) => void;
}) {
  const preChain = usePreChain(soundId, instanceId);
  const instance = useMemo<ServerPostInstance>(
    () => ({ instanceId, type: 'trimSilence', enabled: true, params }),
    [instanceId, params],
  );
  const signature = useMemo(() => serverPostSignature(instance, preChain), [instance, preChain]);

  return (
    <div className="card-stack">
      <p className="text-[10px] text-secondary-hover">
        Crops the clip to its longest continuous sound, removing leading and trailing silence.
      </p>
      <ServerPostProcessRow
        soundId={soundId}
        instance={instance}
        preChain={preChain}
        signature={signature}
        onProcessed={(url, sig) => onCommit({ ...params, renderedUrl: url, renderedSignature: sig })}
      />
    </div>
  );
}

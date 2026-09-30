import { useEffect, useMemo, useState } from 'react';
import { useAnalysisStore, useAudioControlsStore, useSoundscapeStore } from '@/store';
import type { SoundScene } from '@/types/sceneWorkflow';
import { SIMPLE_MODE } from '@/utils/constants';
import { getSceneSoundIndices } from '@/utils/sceneWorkflow';
import { computeSceneEnvelope, type SceneWaveformSource } from '@/lib/audio/scene-waveform';

/**
 * Loudness envelope (0..1 per bin) of a scene's generated sounds over its
 * timeline, for the waveform-ring bubble icon. Null while nothing is generated
 * or decoding. Recomputes only when the scene's generated sound set changes.
 *
 * Usage:
 * ```tsx
 * const envelope = useSceneWaveform(scene);
 * <WaveformRing values={envelope} size={36} />
 * ```
 */
export function useSceneWaveform(scene: SoundScene): number[] | null {
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const analysisConfig = useAnalysisStore((s) => s.analysisConfigs[scene.usageIndex]);
  const fallbackDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);

  const durationMs =
    analysisConfig?.type === 'scenario' ? analysisConfig.timelineDurationMs : fallbackDurationMs;

  // One source per generated sound card (its first variant), described by a
  // stable key so the effect below only reruns when the audio actually changes.
  const { sources, key } = useMemo(() => {
    const out: SceneWaveformSource[] = [];
    for (const i of getSceneSoundIndices(soundConfigs, scene.usageIndex)) {
      const cfg = soundConfigs[i];
      const event = generatedSounds.find((e) =>
        cfg.config_id && e.config_id ? e.config_id === cfg.config_id : e.prompt_index === i,
      );
      if (!event?.url) continue;
      out.push({
        url: event.url,
        timestamps: event.timestamps ?? cfg.timestamps,
        intervalSeconds: event.current_interval_seconds ?? event.interval_seconds ?? cfg.interval_seconds,
        dbfs: event.current_volume_dbfs ?? event.volume_dbfs ?? cfg.dbfs,
      });
    }
    return { sources: out, key: `${durationMs}|${out.map((s) => s.url).join('|')}` };
  }, [soundConfigs, generatedSounds, scene.usageIndex, durationMs]);

  const [envelope, setEnvelope] = useState<number[] | null>(null);

  useEffect(() => {
    if (sources.length === 0) {
      setEnvelope(null);
      return;
    }
    let active = true;
    computeSceneEnvelope(sources, durationMs, SIMPLE_MODE.WAVEFORM_BINS).then((env) => {
      if (active) setEnvelope(env);
    });
    return () => {
      active = false;
    };
    // `key` captures every input that matters; `sources` identity changes too often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return envelope;
}

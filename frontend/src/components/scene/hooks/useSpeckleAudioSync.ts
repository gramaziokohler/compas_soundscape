import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { DEFAULT_DBFS } from '@/utils/constants';
import { computeMuteSolo } from '@/lib/audio/utils/mute-solo';
import { isConfigGlobal } from '@/lib/audio/utils/global-source';
import { findCardIndexForSound } from '@/utils/sound-card-match';
import type { SoundEvent } from '@/types';

export function useSpeckleAudioSync({
  audioOrchestrator,
  soundscapeData,
  soundVolumes,
  mutedSounds,
  soloedSounds,
  globalSoundSpeed,
}: {
  audioOrchestrator: any;
  soundscapeData: SoundEvent[] | null;
  soundVolumes: Record<string, number>;
  mutedSounds: Set<string>;
  soloedSounds: Set<string>;
  globalSoundSpeed: number;
}) {
  // Calibration anchor: every generated/processed WAV is normalized to this
  // level, so playback gain = target − globalBaseDbfs. This is what makes the
  // orchestrator's per-sound SPL (stored in event.volume_dbfs) audible instead
  // of every source playing at the uniform anchor.
  const globalBaseDbfs = useAudioControlsStore((s) => s.globalBaseDbfs);
  // Each background card's own "Global" toggle lives on its config.
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  // Re-run the global sync once the sphere manager exists (it may come up after the data).
  const coordinator = useSpeckleEngineStore((s) => s.coordinator);

  // ============================================================================
  // Effect - Apply Volume Changes (dBFS-based)
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      // A track's fader writes soundVolumes keyed by the PRIMARY (lowest copy_index)
      // sound id. A clip overridden to a different variant plays a sibling event with
      // its own id, so it wouldn't otherwise see the fader move — resolve one override
      // per prompt_index group and apply it to every sibling that doesn't have its own.
      const promptVolumeOverride = new Map<number, number>();
      soundscapeData.forEach((se) => {
        const pi = (se as any).prompt_index ?? 0;
        if (soundVolumes[se.id] !== undefined && !promptVolumeOverride.has(pi)) {
          promptVolumeOverride.set(pi, soundVolumes[se.id]);
        }
      });

      soundscapeData.forEach((soundEvent) => {
        const pi = (soundEvent as any).prompt_index ?? 0;
        const targetVolumeDbfs = soundVolumes[soundEvent.id] ?? promptVolumeOverride.get(pi) ?? soundEvent.volume_dbfs ?? DEFAULT_DBFS;

        const dbDiff = targetVolumeDbfs - globalBaseDbfs;
        const gainFactor = Math.pow(10, dbDiff / 20);
        const clampedGain = Math.max(0.0, Math.min(10.0, gainFactor));

        audioOrchestrator.setSourceVolume(soundEvent.id, clampedGain);
      });
    }
  }, [soundVolumes, soundscapeData, audioOrchestrator, globalBaseDbfs]);

  // ============================================================================
  // Effect - Push Mute/Solo State (audio engine + spheres)
  // ============================================================================
  // soundscapeData is the active scene's data (page.tsx filters it with the
  // same isCardInActiveScene predicate useMuteSolo uses), so the engine and
  // the UI resolve mute/solo over the same tracks. The whole silenced set is
  // pushed; the orchestrator and sphere manager keep it and apply it to every
  // source / mesh / light created afterwards.
  useEffect(() => {
    const { silencedIds, silencedPrompts } = computeMuteSolo(soundscapeData ?? [], mutedSounds, soloedSounds);
    audioOrchestrator?.setSilencedSources(silencedIds);
    coordinator?.getSoundSphereManager()?.setSilencedPrompts(silencedPrompts);
  }, [mutedSounds, soloedSounds, soundscapeData, audioOrchestrator, coordinator]);

  // ============================================================================
  // Effect - Global (non-spatial) background sounds
  // ============================================================================
  // Every variant of a background card whose "Global" toggle is on plays as a
  // global bed and its sphere is hidden. Positions are never touched, so turning
  // the toggle off re-spatializes the sound and shows its sphere where it was.
  useEffect(() => {
    if (!soundscapeData) return;
    const globalIds = new Set<string>();
    soundscapeData.forEach((soundEvent) => {
      const config = soundConfigs[findCardIndexForSound(soundEvent, soundConfigs)];
      const isGlobal = isConfigGlobal({
        category: config?.category ?? soundEvent.category,
        global_playback: config?.global_playback,
      });
      audioOrchestrator?.setSourceGlobal(soundEvent.id, isGlobal);
      if (isGlobal) globalIds.add(soundEvent.id);
    });
    coordinator?.getSoundSphereManager()?.setHiddenSounds(globalIds);
  }, [soundConfigs, soundscapeData, audioOrchestrator, coordinator]);

  // ============================================================================
  // Effect - Speed of Sound
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator) {
      audioOrchestrator.setSpeedOfSound(globalSoundSpeed);
    }
  }, [globalSoundSpeed, audioOrchestrator]);
}

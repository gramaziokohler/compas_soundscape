import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { DEFAULT_DBFS } from '@/utils/constants';
import type { SoundEvent } from '@/types';

export function useSpeckleAudioSync({
  audioOrchestrator,
  soundscapeData,
  soundVolumes,
  mutedSounds,
  soloedSound,
  globalSoundSpeed,
}: {
  audioOrchestrator: any;
  soundscapeData: SoundEvent[] | null;
  soundVolumes: Record<string, number>;
  mutedSounds: Set<string>;
  soloedSound: string | null;
  globalSoundSpeed: number;
}) {
  // ============================================================================
  // Effect - Apply Volume Changes (dBFS-based)
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      soundscapeData.forEach((soundEvent) => {
        const targetVolumeDbfs = soundVolumes[soundEvent.id] ?? soundEvent.volume_dbfs ?? DEFAULT_DBFS;
        const baseVolumeDbfs = soundEvent.volume_dbfs ?? DEFAULT_DBFS;

        const dbDiff = targetVolumeDbfs - baseVolumeDbfs;
        const gainFactor = Math.pow(10, dbDiff / 20);
        const clampedGain = Math.max(0.0, Math.min(10.0, gainFactor));

        audioOrchestrator.setSourceVolume(soundEvent.id, clampedGain);
      });
    }
  }, [soundVolumes, soundscapeData, audioOrchestrator]);

  // ============================================================================
  // Effect - Apply Mute/Solo States
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      const { coordinator } = useSpeckleEngineStore.getState();
      const soundSphereManager = coordinator?.getSoundSphereManager();

      soundscapeData.forEach((soundEvent) => {
        let shouldBeMuted = mutedSounds.has(soundEvent.id);

        if (soloedSound !== null) {
          shouldBeMuted = soundEvent.id !== soloedSound;
        }

        audioOrchestrator.setSourceMute(soundEvent.id, shouldBeMuted);
        soundSphereManager?.setSourceMuted(soundEvent.id, shouldBeMuted);
      });
    }
  }, [mutedSounds, soloedSound, soundscapeData, audioOrchestrator]);

  // ============================================================================
  // Effect - Speed of Sound
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator) {
      audioOrchestrator.setSpeedOfSound(globalSoundSpeed);
    }
  }, [globalSoundSpeed, audioOrchestrator]);
}

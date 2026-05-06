import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
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
  // Effect - Apply Volume Changes (dB-based)
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      soundscapeData.forEach((soundEvent) => {
        const targetVolumeDb = soundVolumes[soundEvent.id] ?? soundEvent.volume_db ?? 70;
        const baseVolumeDb = soundEvent.volume_db ?? 70;

        const dbDiff = targetVolumeDb - baseVolumeDb;
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

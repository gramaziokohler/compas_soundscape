import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAudioControlsStore } from '@/store/audioControlsStore';
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
  // Calibration anchor: every generated/processed WAV is normalized to this
  // level, so playback gain = target − globalBaseDbfs. This is what makes the
  // orchestrator's per-sound SPL (stored in event.volume_dbfs) audible instead
  // of every source playing at the uniform anchor.
  const globalBaseDbfs = useAudioControlsStore((s) => s.globalBaseDbfs);

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
  // Effect - Apply Mute/Solo States
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      const { coordinator } = useSpeckleEngineStore.getState();
      const soundSphereManager = coordinator?.getSoundSphereManager();

      // Per-prompt effective mute: a card is dimmed when ANY of its variants is
      // muted, or when solo mode is active and none of its variants is soloed.
      const promptMuted = new Map<number, boolean>();

      soundscapeData.forEach((soundEvent) => {
        let shouldBeMuted = mutedSounds.has(soundEvent.id);

        if (soloedSound !== null) {
          shouldBeMuted = soundEvent.id !== soloedSound;
        }

        audioOrchestrator.setSourceMute(soundEvent.id, shouldBeMuted);
        soundSphereManager?.setSourceMuted(soundEvent.id, shouldBeMuted);

        const promptIdx = (soundEvent as any).prompt_index ?? 0;
        const isCardMuted = promptMuted.get(promptIdx) ?? false;
        promptMuted.set(promptIdx, isCardMuted || shouldBeMuted);
      });

      promptMuted.forEach((muted, promptIdx) => {
        soundSphereManager?.setPromptMuted(promptIdx, muted);
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

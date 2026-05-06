'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAcousticsSimulationStore } from '@/store';
import {
  extractTimelineSoundsFromData,
} from '@/lib/audio/utils/timeline-utils';
import {
  exportSoundscapeToWav,
  type SoundscapeExportConfig,
} from '@/lib/audio/SoundscapeExporter';
import { UI_TIMING } from '@/utils/constants';
import type { SoundEvent } from '@/types';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { TimelineSound } from '@/types/audio';

interface TimelineProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  selectedVariants: any;
  soundIntervals: any;
  soundTrims: any;
  intervalJitterSeconds: number;
  timelineDurationMs: number;
  audioOrchestrator: AudioOrchestrator | null;
  soundVolumes: Record<string, number>;
  mutedSounds: Set<string>;
  soloedSound: string | null;
  listenerOrientation: { x: number; y: number; z: number };
}

interface TimelineResult {
  timelineSounds: TimelineSound[];
  soundMetadataReady: boolean;
  showTimeline: boolean;
  setShowTimeline: React.Dispatch<React.SetStateAction<boolean>>;
  handleRefreshTimeline: () => void;
  handleDownloadTimeline: () => Promise<void>;
}

export function useSpeckleTimeline({
  isViewerReady,
  soundscapeData,
  selectedVariants,
  soundIntervals,
  soundTrims,
  intervalJitterSeconds,
  timelineDurationMs,
  audioOrchestrator,
  soundVolumes,
  mutedSounds,
  soloedSound,
  listenerOrientation,
}: TimelineProps): TimelineResult {
  const [timelineSounds, setTimelineSounds] = useState<TimelineSound[]>([]);
  const [soundMetadataReady, setSoundMetadataReady] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);

  // ============================================================================
  // Effect - Update Timeline (debounced)
  // ============================================================================
  useEffect(() => {
    if (!soundscapeData || soundscapeData.length === 0) {
      setTimelineSounds([]);
      setSoundMetadataReady(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      const { coordinator } = useSpeckleEngineStore.getState();
      const soundSphereManager = coordinator?.getSoundSphereManager();

      if (soundSphereManager) {
        const soundMetadata = soundSphereManager.getAllAudioSources();
        const uniquePromptCount = new Set(soundscapeData.map(s => s.prompt_index ?? 0)).size;

        if (soundMetadata && soundMetadata.size >= uniquePromptCount) {
          const sounds = extractTimelineSoundsFromData(
            soundMetadata,
            soundIntervals,
            timelineDurationMs,
            soundscapeData ?? undefined,
            soundTrims,
            intervalJitterSeconds
          );
          setTimelineSounds(sounds);
          setSoundMetadataReady(true);
        } else {
          setSoundMetadataReady(false);
        }
      }
    }, UI_TIMING.UPDATE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // soundMetadataReady is included so the effect re-runs when polling marks it ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundscapeData, selectedVariants, soundIntervals, soundTrims, soundMetadataReady, intervalJitterSeconds, timelineDurationMs]);

  // ============================================================================
  // Effect - Poll for Sound Metadata Readiness
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !soundscapeData || soundscapeData.length === 0) return;
    if (soundMetadataReady) return;

    const intervalId = setInterval(() => {
      const { coordinator } = useSpeckleEngineStore.getState();
      const soundSphereManager = coordinator?.getSoundSphereManager();
      if (soundSphereManager) {
        const soundMetadata = soundSphereManager.getAllAudioSources();
        const uniquePromptCount = new Set(soundscapeData.map(s => s.prompt_index ?? 0)).size;
        if (soundMetadata && soundMetadata.size >= uniquePromptCount) {
          setSoundMetadataReady(true);
          clearInterval(intervalId);
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [isViewerReady, soundscapeData, soundMetadataReady]);

  // Auto-open the timeline whenever sounds become available
  useEffect(() => {
    if (timelineSounds.length > 0) {
      setShowTimeline(true);
    }
  }, [timelineSounds.length]);

  // ============================================================================
  // Callback - Refresh Timeline
  // ============================================================================
  const handleRefreshTimeline = useCallback(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    const soundSphereManager = coordinator?.getSoundSphereManager();
    if (!soundSphereManager) return;

    const soundMetadata = soundSphereManager.getAllAudioSources();
    if (soundMetadata && soundMetadata.size > 0) {
      const sounds = extractTimelineSoundsFromData(
        soundMetadata,
        soundIntervals,
        timelineDurationMs,
        soundscapeData ?? undefined,
        soundTrims,
        intervalJitterSeconds
      );
      setTimelineSounds(sounds);
      console.log('[useSpeckleTimeline] 🔄 Timeline refreshed:', sounds.length, 'sounds');
    }
  }, [soundIntervals, soundTrims, soundscapeData, intervalJitterSeconds, timelineDurationMs]);

  // ============================================================================
  // Callback - Download Soundscape as WAV
  // ============================================================================
  const handleDownloadTimeline = useCallback(async () => {
    if (!audioOrchestrator || timelineSounds.length === 0) {
      console.warn('[useSpeckleTimeline] Cannot export: no orchestrator or no timeline sounds');
      return;
    }

    try {
      const exportState = audioOrchestrator.getExportState();

      const soundGains = new Map<string, number>();
      timelineSounds.forEach((ts) => {
        const soundEvent = soundscapeData?.find((s) => s.id === ts.id);
        const baseVolumeDb = soundEvent?.volume_db ?? 70;
        const targetVolumeDb = soundVolumes[ts.id] ?? baseVolumeDb;
        const dbDiff = targetVolumeDb - baseVolumeDb;
        const gain = Math.pow(10, dbDiff / 20);
        soundGains.set(ts.id, Math.max(0, Math.min(10, gain)));
      });

      const { simulationConfigs, activeSimulationIndex } = useAcousticsSimulationStore.getState();
      const activeSimulation =
        activeSimulationIndex !== null ? simulationConfigs[activeSimulationIndex] : null;

      const config: SoundscapeExportConfig = {
        ...exportState,
        globalListenerOrientation: listenerOrientation,
        soundGains,
        mutedSounds,
        soloedSound,
        simulationName: activeSimulation?.display_name ?? null,
      };

      await exportSoundscapeToWav(timelineSounds, timelineDurationMs, config);
      console.log('[useSpeckleTimeline] ✅ Soundscape exported successfully');
    } catch (err) {
      console.error('[useSpeckleTimeline] ❌ Export failed:', err);
      throw err;
    }
  }, [
    audioOrchestrator,
    timelineSounds,
    timelineDurationMs,
    soundscapeData,
    soundVolumes,
    mutedSounds,
    soloedSound,
    listenerOrientation,
  ]);

  return {
    timelineSounds,
    soundMetadataReady,
    showTimeline,
    setShowTimeline,
    handleRefreshTimeline,
    handleDownloadTimeline,
  };
}

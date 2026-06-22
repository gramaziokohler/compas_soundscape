'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAcousticsSimulationStore, useAudioControlsStore, useSoundscapeStore } from '@/store';
import {
  extractTimelineSoundsFromData,
} from '@/lib/audio/utils/timeline-utils';
import {
  exportSoundscapeToWav,
  type SoundscapeExportConfig,
  type ExportFormat,
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
  handleDownloadTimeline: (format: ExportFormat) => Promise<void>;
  isBakingSchedule: boolean;
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

  // Subscribe to scheduling mode + timestamps so the timeline rerenders when they change
  const soundSchedulingModes    = useAudioControlsStore((s) => s.soundSchedulingModes);
  const soundTimestamps         = useAudioControlsStore((s) => s.soundTimestamps);
  const soundIterationDurations = useAudioControlsStore((s) => s.soundIterationDurations);
  const isBakingSchedule        = useAudioControlsStore((s) => s.isBakingSchedule);
  const iterationLinks          = useAudioControlsStore((s) => s.iterationLinks);
  const soundBufferDurations    = useAudioControlsStore((s) => s.soundBufferDurations);
  const setIterationLink      = useAudioControlsStore((s) => s.setIterationLink);
  const soundConfigs          = useSoundscapeStore((s) => s.soundConfigs);

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
        const generatedPrompts = soundscapeData.filter((s: any) => !s.isPending);
        const generatedPromptCount = new Set(generatedPrompts.map((s: any) => s.prompt_index ?? 0)).size;

        if (generatedPromptCount === 0 || (soundMetadata && soundMetadata.size >= generatedPromptCount)) {
          const sounds = extractTimelineSoundsFromData(
            soundMetadata,
            soundIntervals,
            timelineDurationMs,
            soundscapeData ?? undefined,
            soundTrims,
            intervalJitterSeconds,
            soundSchedulingModes,
            soundTimestamps,
            soundIterationDurations,
            iterationLinks,
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
  }, [soundscapeData, selectedVariants, soundIntervals, soundTrims, soundMetadataReady, intervalJitterSeconds, timelineDurationMs, soundSchedulingModes, soundTimestamps, soundIterationDurations, isBakingSchedule, iterationLinks, soundBufferDurations]);

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
        const generatedSounds = soundscapeData.filter((s: any) => !(s as any).isPending);
        // Wait for ALL variant sources to be loaded (not just one per prompt),
        // so that per-iteration variant waveform URLs resolve correctly.
        if (generatedSounds.length === 0 || (soundMetadata && soundMetadata.size >= generatedSounds.length)) {
          setSoundMetadataReady(true);
          clearInterval(intervalId);
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [isViewerReady, soundscapeData, soundMetadataReady]);

  // ============================================================================
  // Effect - Auto-link unlinked iterations to entity 1 when sound has multiple entities
  // ============================================================================
  useEffect(() => {
    if (timelineSounds.length === 0) return;

    for (const sound of timelineSounds) {
      const promptIndex = sound.promptIndex;
      if (promptIndex === undefined) continue;

      const config = soundConfigs[promptIndex];
      if (!config?.entities || config.entities.length <= 1) continue;

      const firstEntity = config.entities[0];
      const entityPosition: [number, number, number] | undefined =
        firstEntity.bounds?.center
          ? [firstEntity.bounds.center[0], firstEntity.bounds.center[1], firstEntity.bounds.center[2]]
          : firstEntity.position && firstEntity.position.length >= 3
            ? [firstEntity.position[0], firstEntity.position[1], firstEntity.position[2]]
            : undefined;

      const nodeId = firstEntity.nodeId || firstEntity.id;
      if (!nodeId) continue;

      for (let i = 0; i < sound.scheduledIterations.length; i++) {
        const originalIdx = sound.scheduledIterationOriginalIndices?.[i] ?? i;
        const linkKey = `${sound.id}-${originalIdx}`;
        const existingLink = iterationLinks[linkKey];
        if (existingLink?.entityNodeId) continue;

        setIterationLink(sound.id, originalIdx, {
          entityNodeId: nodeId,
          entityPosition,
          entityIndex: 0,
        });
      }
    }
    // Intentionally exclude iterationLinks from deps to avoid re-running after each set.
    // The existingLink check prevents re-linking already-linked iterations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineSounds, soundConfigs, setIterationLink]);

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
        intervalJitterSeconds,
        soundSchedulingModes,
        soundTimestamps,
        soundIterationDurations,
        iterationLinks,
      );
      setTimelineSounds(sounds);
      console.log('[useSpeckleTimeline] 🔄 Timeline refreshed:', sounds.length, 'sounds');
    }
  }, [soundIntervals, soundTrims, soundscapeData, intervalJitterSeconds, timelineDurationMs, soundSchedulingModes, soundTimestamps, soundIterationDurations, iterationLinks]);

  // ============================================================================
  // Callback - Download Soundscape as WAV
  // ============================================================================
  const handleDownloadTimeline = useCallback(async (format: ExportFormat) => {
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
        exportFormat: format,
        globalListenerOrientation: listenerOrientation,
        soundGains,
        mutedSounds,
        soloedSound,
        soundTrims,
        iterationLinks,
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
    soundTrims,
    listenerOrientation,
  ]);

  return {
    timelineSounds,
    soundMetadataReady,
    showTimeline,
    setShowTimeline,
    handleRefreshTimeline,
    handleDownloadTimeline,
    isBakingSchedule,
  };
}

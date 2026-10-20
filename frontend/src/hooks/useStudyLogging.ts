'use client';

import { useEffect, useRef } from 'react';
import packageJson from '../../package.json';
import {
  useAcousticsSimulationStore,
  useAudioControlsStore,
  useModelVersionStore,
  useStudyStore,
  useUIStore,
  addUndoStepListener,
} from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import {
  disposeStudyLogger,
  initStudyLogger,
  isStudyFeatureEnabled,
  logStudyEvent,
  setStudyContextProvider,
} from '@/lib/study/studyLogger';
import { registerStudySnapshotSource } from '@/lib/study/snapshot';
import {
  setStudyListeningContextProvider,
  startStudyListening,
  stopStudyListening,
} from '@/lib/study/listeningTracker';
import { installStudyEditTracker } from '@/lib/study/editTracker';
import { installStudyLongTaskMonitor } from '@/lib/study/perfMonitor';
import {
  classifyListenerId,
  readStudyEnvelopeContext,
  readStudyListener,
  readStudyListeningContext,
  readStudySnapshotFingerprint,
  type StudyListenerSelection,
} from '@/lib/study/storeReaders';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

export interface UseStudyLoggingOptions {
  /** Live orchestrator (for playing sources / engine mode). */
  orchestrator: AudioOrchestrator | null;
  /** Builds the design-state snapshot (page.tsx buildSavePayload wrapper). */
  buildSnapshot: () => unknown;
  /** Listener selection — FPS state is local to page.tsx. */
  listener: StudyListenerSelection;
  /** Powered grid listener (its points shown), if any. */
  activeGridListenerId: string | null;
}

type Unsubscribe = () => void;

/** True when any timeline sound is in the 'playing' state. */
function isTimelinePlaying(states: Record<string, string>): boolean {
  for (const id in states) if (states[id] === 'playing') return true;
  return false;
}

/**
 * Study logging lifecycle — mounted once in page.tsx.
 *
 * Resolves GET /api/study/config; when study logging is OFF nothing below the
 * config check runs (no subscriptions, no listeners — plan gate R7). When ON it
 * registers the context providers and observes the stores with field-level
 * `!==` checks (no work unless that field changed):
 *   listening sessions (timeline + card previews), render mode, IR selection,
 *   active simulation, model / version changes, UI mode, listener changes,
 *   edits via the undo registry (feature state_diff), long tasks, visibility.
 */
export function useStudyLogging(options: UseStudyLoggingOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    const disposers: Unsubscribe[] = [];

    void initStudyLogger().then((config) => {
      if (cancelled || !config) return;
      useStudyStore.getState().setStudyEnabled(true, config.pseudonym);

      setStudyContextProvider(readStudyEnvelopeContext);
      setStudyListeningContextProvider(() =>
        readStudyListeningContext(optionsRef.current.orchestrator, optionsRef.current.listener),
      );
      registerStudySnapshotSource(() => optionsRef.current.buildSnapshot(), readStudySnapshotFingerprint);

      logStudyEvent('session.start', {
        app_version: packageJson.version,
        user_agent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        features: { ...config.features },
      });

      // ── Visibility ──
      const onVisibility = () => logStudyEvent('session.visibility', { state: document.visibilityState });
      document.addEventListener('visibilitychange', onVisibility);
      disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

      // ── Listening: timeline + card previews ──
      disposers.push(
        useAudioControlsStore.subscribe((state, prev) => {
          if (state.individualSoundStates !== prev.individualSoundStates) {
            const now = isTimelinePlaying(state.individualSoundStates);
            const was = isTimelinePlaying(prev.individualSoundStates);
            if (now && !was) startStudyListening('timeline');
            else if (!now && was) {
              const paused = Object.values(state.individualSoundStates).includes('paused');
              stopStudyListening(paused ? 'paused' : 'stopped');
            }
          }
          if (state.previewingSoundId !== prev.previewingSoundId) {
            if (state.previewingSoundId) startStudyListening('preview', state.previewingSoundId);
            else if (prev.previewingSoundId) stopStudyListening('preview_stopped');
          }
        }),
      );

      // ── Rendering / auralization / UI mode ──
      disposers.push(
        useUIStore.subscribe((state, prev) => {
          if (state.audioRenderingMode !== prev.audioRenderingMode) {
            logStudyEvent('render.mode', { from: prev.audioRenderingMode, to: state.audioRenderingMode });
          }
          if (state.selectedIRId !== prev.selectedIRId) {
            logStudyEvent('ir.select', { ir_id: state.selectedIRId, name: state.selectedIRMetadata?.name ?? null });
          }
          if (state.uiMode !== prev.uiMode) logStudyEvent('ui.mode', { from: prev.uiMode, to: state.uiMode });
          const model = (state.globalSpeckleData as { model_id?: string } | null)?.model_id ?? null;
          const prevModel = (prev.globalSpeckleData as { model_id?: string } | null)?.model_id ?? null;
          if (model !== prevModel) logStudyEvent('model.open', { model_id: model, previous_model_id: prevModel });
        }),
      );

      disposers.push(
        useAcousticsSimulationStore.subscribe((state, prev) => {
          if (state.activeSimulationIndex === prev.activeSimulationIndex) return;
          const idx = state.activeSimulationIndex;
          const config = idx !== null ? state.simulationConfigs[idx] : undefined;
          logStudyEvent('sim.activate', {
            index: idx,
            engine: config?.type ?? null,
            name: (config as { name?: string } | undefined)?.name ?? null,
          });
        }),
      );

      // ── Model versions ──
      disposers.push(
        useModelVersionStore.subscribe((state, prev) => {
          if (state.pinnedVersionId !== prev.pinnedVersionId || state.viewerReloadNonce !== prev.viewerReloadNonce) {
            logStudyEvent('model.version_switch', {
              from_version_id: state.previousVersionId,
              to_version_id: state.pinnedVersionId,
            });
          }
        }),
      );
      disposers.push(
        useSpeckleEngineStore.subscribe((state, prev) => {
          if (state.loadedModelVersionId === prev.loadedModelVersionId) return;
          logStudyEvent('model.version_loaded', {
            version_id: state.loadedModelVersionId,
            previous_version_id: prev.loadedModelVersionId,
            created_at: state.loadedModelVersionCreatedAt,
          });
        }),
      );

      // ── Edits (risk gate R3) and self-monitoring ──
      if (isStudyFeatureEnabled('state_diff')) disposers.push(installStudyEditTracker(addUndoStepListener));
      disposers.push(installStudyLongTaskMonitor());
    });

    return () => {
      cancelled = true;
      stopStudyListening('unmount');
      disposers.forEach((d) => d());
      setStudyContextProvider(null);
      setStudyListeningContextProvider(null);
      registerStudySnapshotSource(null, null);
      disposeStudyLogger();
    };
  }, []);

  // ── Listener changes (FPS at a receiver / grid point, back to free camera) ──
  const { fpsActive, activeListenerId } = options.listener;
  const prevListenerRef = useRef<StudyListenerSelection>({ fpsActive: false, activeListenerId: null });
  useEffect(() => {
    const prev = prevListenerRef.current;
    prevListenerRef.current = { fpsActive, activeListenerId };
    if (!useStudyStore.getState().enabled) return;
    const wasIn = prev.fpsActive && !!prev.activeListenerId;
    const isIn = fpsActive && !!activeListenerId;
    if (wasIn && (!isIn || prev.activeListenerId !== activeListenerId)) {
      logStudyEvent('listener.exit', { kind: classifyListenerId(prev.activeListenerId), id: prev.activeListenerId });
    }
    if (isIn && (!wasIn || prev.activeListenerId !== activeListenerId)) {
      logStudyEvent('listener.enter', { listener: readStudyListener({ fpsActive, activeListenerId }) });
    }
  }, [fpsActive, activeListenerId]);

  const { activeGridListenerId } = options;
  const prevGridRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevGridRef.current;
    prevGridRef.current = activeGridListenerId;
    if (prev === activeGridListenerId || !useStudyStore.getState().enabled) return;
    logStudyEvent('listener.grid_power', { grid_id: activeGridListenerId, previous_grid_id: prev });
  }, [activeGridListenerId]);
}

"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { SpeckleScene } from "@/components/scene/SpeckleScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { AdvancedSettingsPanel } from "@/components/scene/AdvancedSettingsPanel";
import { ErrorToast } from "@/components/ui/ErrorToast";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { useObjectSelectionPhase } from "@/hooks/useObjectSelectionPhase";
import { buildEntityFromObjectId, resolveStableEntityId, resolveEntityByNameLayer } from "@/lib/three/speckle-entity-utils";
import {
  useAudioControlsStore,
  useFileUploadStore,
  useSoundscapeStore,
  useAnalysisStore,
  useSpeckleStore,
  useReceiversStore,
  useModalImpactStore,
  useAcousticsSimulationStore,
  usePyroomAcousticsStore,
  useChorasStore,
  useSEDStore,
  useRoomMaterialsStore,
  useRightSidebarStore,
  useAcousticLayerStore,
  useUIStore,
  useGridListenersStore,
  useErrorsStore,
  useCardFlowStore,
  useWorkspaceStore,
  useAreaDrawingStore,
  notifyError,
} from "@/store";
import { useSpeckleEngineStore } from "@/store/speckleEngineStore";
import * as THREE from "three";
import { useAudioNormalization } from "@/hooks/useAudioNormalization";
import { useAudioOrchestrator } from "@/hooks/useAudioOrchestrator";
import { useAudioOutputDeviceSync } from "@/hooks/useAudioOutputDeviceSync";
import { applyOutputDevice } from "@/lib/audio/output-device";
import { useViewportScale } from "@/hooks/useViewportScale";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useJobRecovery } from "@/hooks/useJobRecovery";
import { useModelVersionWatcher } from "@/hooks/useModelVersionWatcher";
import { apiService } from "@/services/api";
import { API_BASE_URL, DEFAULT_DBFS, DEFAULT_NUM_SOUNDS, RECEIVER_CONFIG, SPIRAL_PLACEMENT, DEFAULT_LISTENER_ORIENTATION, TTS_DEFAULT_LANGUAGE, DEFAULT_MAXIMUM_FOLEY_SOUNDS, SANDBOX_MODEL_ID, SANDBOX_SAMPLE_SPHERE_POSITION, DEFAULT_DURATION_SECONDS, DEFAULT_DIFFUSION_STEPS, MODEL_VERSION_WATCH } from "@/utils/constants";
import { loadAudioFile } from "@/lib/audio/utils/audio-upload";
import { parseAuthoredSeconds } from "@/lib/audio/utils/timeline-utils";
import { getCameraFrontSpiralPosition } from "@/lib/three/spiral-placement";
import type { LoadTab, SoundGenerationConfig, SoundEvent } from "@/types";
import type { SoundscapeData } from "@/types/soundscape";
import type { AcousticSimulationMode } from "@/types/audio";
import type { AudioAnalysisConfig, AnalysisConfig } from "@/types/analysis";
import { CARD_TYPE_LABELS } from "@/types/card";
import type { SelectedGeometry, AcousticMaterial } from "@/types/materials";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";
import { buildSoundscapeSavePayload, restoreSoundscapeState, getBlobUrlSounds, buildAnalysisStateSave, restoreAnalysisState } from "@/utils/soundscape-serializer";
import { getStoredJobs, recordInflightJob } from "@/lib/job-tracker";
import { PrivacyNotice } from "@/components/layout/PrivacyNotice";
import { ImportSandboxModal } from "@/components/scene/ImportSandboxModal";
import { NewModelVersionModal } from "@/components/scene/NewModelVersionModal";
import { HomeProjectModal } from "@/components/scene/HomeProjectModal";

/**
 * Build a map from applicationId (Rhino GUID) → current Speckle tree ID.
 * Walks the raw WorldTree nodes recursively. Used to remap entity links
 * from saved soundscapes (Speckle IDs change on every commit, but
 * applicationId stays stable).
 */
function buildAppIdMap(node: any, map: Map<string, string> = new Map()): Map<string, string> {
  if (!node) return map;
  const raw = node?.raw || node?.model?.raw;
  const treeId: string | undefined = node?.model?.id || raw?.id;
  const appId: string | undefined = raw?.applicationId;
  if (appId && treeId) {
    map.set(appId, treeId);
  }
  const children = node?.model?.children || node?.children || [];
  for (const child of children) {
    buildAppIdMap(child, map);
  }
  return map;
}

let _viewerLoadComplete = false;

// Set when a model was opened from the Home page (as opposed to a refresh of an
// existing ?model_id= session). In that case the camera must default to the
// model's bounding box instead of restoring a previously saved POV.
let _fitCameraToBoundingBoxOnLoad = false;

// Deterministic Home-stage placeholder card names (used by the seed and to
// distinguish the untouched seed from real user work).
const SANDBOX_CONTEXT_NAME = 'Placeholder context';
const SANDBOX_USAGE_NAME = 'Placeholder usage';

/**
 * Collapse every floating panel — Settings, Object Explorer, and the DAW
 * timeline. Applied on every model open and every page load/refresh so the
 * stage always starts reduced, overriding any persisted open state.
 */
function collapseFloatingPanels() {
  const ui = useUIStore.getState();
  ui.setShowAdvancedSettings(false);
  ui.setShowObjectExplorer(false);
  ui.setShowTimeline(false);
  // Collapse every simulation card in the right sidebar too.
  ui.setExpandedSimulationTabIndex(null);
}

function applyRestoredSoundscapePayload(
  data: SoundscapeData,
  audioBaseUrl: string,
  irBaseUrl: string | undefined,
  suppressOrchestrateBakeRef: { current: boolean },
) {
  const restored = restoreSoundscapeState(data, audioBaseUrl, irBaseUrl);
  const soundGen = useSoundscapeStore.getState();
  if (restored.soundEvents.length > 0) {
    suppressOrchestrateBakeRef.current = true;
  }
  soundGen.restoreSoundscape(restored.soundConfigs, restored.soundEvents, {
    duration: restored.globalSettings.duration,
    steps: restored.globalSettings.steps,
    negativePrompt: restored.globalSettings.negativePrompt,
    audioModel: restored.globalSettings.audioModel,
    ttsModel: restored.globalSettings.ttsModel,
    orchestrateSoundsEnabled: restored.globalSettings.orchestrateSoundsEnabled,
  });
  void soundGen.rehydrateSampleAudioConfigs();
  useAudioControlsStore.getState().restoreVolumes(restored.soundVolumes);
  useAudioControlsStore.getState().restoreSoundTimestamps(restored.soundTimestamps);

  let maxEndSec = 0;
  for (const timestamps of Object.values(restored.soundTimestamps)) {
    for (const ts of timestamps) maxEndSec = Math.max(maxEndSec, ts + 10);
  }
  if (maxEndSec > 0) {
    const audioDurMs = Math.ceil((maxEndSec + 10) / 30) * 30 * 1000;
    const currentDurMs = useAudioControlsStore.getState().timelineDurationMs;
    if (audioDurMs > currentDurMs) {
      useAudioControlsStore.getState().setTimelineDurationMs(audioDurMs);
    }
  }

  useAudioControlsStore.getState().restoreIterationLinks(restored.iterationLinks);
  useAudioControlsStore.getState().restoreMuteSolo(restored.mutedSounds, restored.soloedSound);
  useAudioControlsStore.getState().restoreExclusions(restored.excludedIterations, restored.exclusionReasons);

  if (restored.receivers.length > 0) {
    useReceiversStore.getState().restoreReceivers(restored.receivers, restored.selectedReceiverId);
  }
  if (restored.gridListeners.length > 0) {
    useGridListenersStore.getState().restoreGridListeners(restored.gridListeners);
  }
  if (restored.simulationConfigs.length > 0) {
    restored.simulationConfigs.forEach(config => {
      if (config.type === 'pyroomacoustics' && config.simulationInstanceId) {
        usePyroomAcousticsStore.getState().seedInstance(config.simulationInstanceId, {});
      }
      if (config.type === 'choras' && config.simulationInstanceId) {
        useChorasStore.getState().seedInstance(config.simulationInstanceId, {});
      }
    });
    useAcousticsSimulationStore.getState().restoreSimulationState(
      restored.simulationConfigs,
      restored.activeSimulationIndex,
    );
  }
  if (data.analysis_state) {
    const analysisRestored = restoreAnalysisState(data.analysis_state);
    useAnalysisStore.getState().restoreAnalysisState({
      analysisConfigs: analysisRestored.analysisConfigs,
      analysisResults: analysisRestored.analysisResults,
      activeTab: analysisRestored.activeTab,
    });
    useAreaDrawingStore.getState().hydrateFromConfigs(analysisRestored.analysisConfigs);
    useAnalysisStore.getState().rehydrateAudioContextSources(audioBaseUrl);
    if (analysisRestored.soundConfigParentIndices.size > 0) {
      const storeState = useSoundscapeStore.getState();
      const configs = storeState.soundConfigs.map((c, i) => {
        const parent = analysisRestored.soundConfigParentIndices.get(i);
        return parent !== undefined ? { ...c, parentUsageOriginalIndex: parent } : c;
      });
      useSoundscapeStore.setState({ soundConfigs: configs });
    }
    if (analysisRestored.cardFlowState) {
      const cf = analysisRestored.cardFlowState;
      useCardFlowStore.setState({
        contextAdvanced: new Set(cf.contextAdvanced),
        usageAdvanced: new Set(cf.usageAdvanced),
        contextToUsageMap: new Map(Object.entries(cf.contextToUsage).map(([k, v]) => [Number(k), v])),
        usageToSoundMap: new Map(Object.entries(cf.usageToSound).map(([k, v]) => [Number(k), v])),
      });
      if (cf.usageAdvanced.length > 0) {
        useUIStore.getState().setActiveSoundParentIndex(cf.usageAdvanced[0]);
      }
    }
  }
  if (restored.resonanceAudioConfig) {
    const rcfg = restored.resonanceAudioConfig;
    useRoomMaterialsStore.setState({
      roomDimensions: rcfg.roomDimensions,
      roomMaterials: rcfg.roomMaterials,
    });
  }
}

/**
 * All IR library ids referenced by a simulation config (import-irs card +
 * simulation-imported IRs), combining `importedIRIds` and the mapping metadata.
 */
function collectSimulationIRIds(config: unknown): Set<string> {
  const ids = new Set<string>();
  const cfg = config as {
    importedIRIds?: string[];
    sourceReceiverIRMapping?: Record<string, Record<string, { id?: string }>>;
  } | null | undefined;
  if (!cfg) return ids;
  for (const id of cfg.importedIRIds ?? []) if (id) ids.add(id);
  for (const receiverMap of Object.values(cfg.sourceReceiverIRMapping ?? {})) {
    for (const meta of Object.values(receiverMap ?? {})) {
      if (meta?.id) ids.add(meta.id);
    }
  }
  return ids;
}

function HomeContent() {
  useUndoRedo();
  // ── Refresh survival ─────────────────────────────────────────────────────
  // Use window.location.search directly (not useSearchParams) because
  // useSearchParams can return empty values during SSR/hydration in Next.js,
  // causing the bootstrap to never fire on a cold page refresh.
  const router = useRouter();
  const bootstrappedRef = useRef(false);

  // 2. Job recovery — resume in-flight jobs that survived a page refresh
  const { hasInflightJobs } = useJobRecovery();

  // 3. Model version watcher — offer to switch when a newer version is published
  const modelVersion = useModelVersionWatcher();
  // Switching does a full page reload; no async work to await here.
  const handleSwitchToLatestVersion = useCallback(() => {
    modelVersion.switchToLatest();
  }, [modelVersion]);

  // Loading the Home stage starts from a clean layout: sidebars collapsed and
  // every floating panel (settings, object explorer, timeline) hidden. Auto-save
  // is disabled on Home so the sandbox is always rebuilt deterministically.
  const resetHomeLayout = () => {
    const ui = useUIStore.getState();
    collapseFloatingPanels();
    // Home is always conceptually in the Sounds step so the pending Sample
    // sphere (and any restored sounds) render.
    ui.setIsInSoundsStep(true);
    ui.setIsLeftSidebarExpanded(false);
    ui.setLeftSidebarExpandCommand(false);
    ui.setEnableAutoSave(false);
    useRightSidebarStore.getState().requestCollapse();
  };

  // Deterministic Home stage. Every load rebuilds the SAME scene from scratch:
  // a placeholder Context card, a placeholder Usage card, and a pending Sample
  // sound card parented to that usage. Because the parentage matches the active
  // usage index, the sample's sphere and its sidebar card stay linked and stable
  // across refreshes. The bundled clip loads in the background.
  const seedSandboxSampleScene = () => {
    const contextCard = { type: 'freeform', display_name: SANDBOX_CONTEXT_NAME } as unknown as AnalysisConfig;
    const usageCard = {
      type: 'freeform',
      display_name: SANDBOX_USAGE_NAME,
      parentContextOriginalIndex: 0,
    } as unknown as AnalysisConfig;

    useAnalysisStore.getState().restoreAnalysisState({
      analysisConfigs: [contextCard, usageCard],
      analysisResults: [],
      activeTab: 1,
    });

    const sampleConfig: SoundGenerationConfig = {
      prompt: 'Sample',
      display_name: 'Sample',
      duration: DEFAULT_DURATION_SECONDS,
      negative_prompt: '',
      seed_copies: 1,
      steps: DEFAULT_DIFFUSION_STEPS,
      type: 'sample-audio',
      pinned: true,
      position: [...SANDBOX_SAMPLE_SPHERE_POSITION] as [number, number, number],
      parentUsageOriginalIndex: 1,
    };
    useSoundscapeStore.getState().restoreSoundscape([sampleConfig], [], {});

    useCardFlowStore.setState({
      contextAdvanced: new Set([0]),
      usageAdvanced: new Set([1]),
      contextToUsageMap: new Map([[0, [1]]]),
      usageToSoundMap: new Map([[1, [0]]]),
      activeContextOriginalIndex: 0,
      activeUsageOriginalIndex: 1,
    });

    const ui = useUIStore.getState();
    ui.setIsInSoundsStep(true);
    ui.setActiveSoundParentIndex(1);
    ui.setEnableAutoSave(false);
    // Fresh stage → no active No-model project.
    ui.setHomeProject(null);

    void (async () => {
      try {
        const result = await loadAudioFile(await apiService.loadSampleAudio());
        useSoundscapeStore.setState((s) => {
          // The stage may have been replaced while the sample clip was loading
          // (e.g. a saved model opened from Home) — only apply to the seed Sample
          // config so the restored soundscape's first config is never clobbered.
          const first = s.soundConfigs[0];
          if (!first || first.type !== 'sample-audio' || first.display_name !== 'Sample') {
            return {};
          }
          return {
            soundConfigs: s.soundConfigs.map((c, i) =>
              i === 0
                ? {
                    ...c,
                    uploadedAudioBuffer: result.audioBuffer,
                    uploadedAudioInfo: result.audioInfo,
                    uploadedAudioUrl: result.audioUrl,
                  }
                : c,
            ),
          };
        });
      } catch (error) {
        console.warn('[page:sandbox] Failed to load sample audio', error);
      }
    })();
  };

  useEffect(() => {
    if (bootstrappedRef.current) return;
    // Only read the URL on the client — window is not available during SSR
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlModelId = params.get('model_id');
    const homeProjectId = params.get('home');
    if (!urlModelId) {
      bootstrappedRef.current = true;
      resetHomeLayout();
      // Loading a saved Homepage project onto the sandbox stage (no Speckle
      // geometry). Otherwise the Home stage is rebuilt deterministically.
      if (homeProjectId) {
        setIsBootstrappingModel(true);
        apiService.loadSoundscapeFromSpeckle(homeProjectId).then((loadResponse) => {
          if (loadResponse.found && loadResponse.soundscape_data) {
            const audioBaseUrl = `${API_BASE_URL}${loadResponse.audio_base_url}`;
            const irBaseUrl = loadResponse.ir_base_url || undefined;
            applyRestoredSoundscapePayload(
              loadResponse.soundscape_data,
              audioBaseUrl,
              irBaseUrl,
              suppressOrchestrateBakeRef,
            );
            // A loaded No-model project is the active project → enables the
            // Home button and auto-save.
            useUIStore.getState().setHomeProject({
              modelId: homeProjectId,
              name: loadResponse.soundscape_data.model_name || homeProjectId,
            });
          }
          // Sync the mounted Sidebar to the restored usage parent, then collapse.
          setStepAdvanceTrigger((t) => t + 1);
          useUIStore.getState().setLeftSidebarExpandCommand(false);
          setIsBootstrappingModel(false);
          console.log('[page:bootstrap] Homepage project loaded:', homeProjectId);
        }).catch((err) => {
          console.warn('[page:bootstrap] Failed to load homepage project:', err);
          resetDomainForFreshModel();
          seedSandboxSampleScene();
          setIsBootstrappingModel(false);
        });
        return;
      }
      // Fresh Home stage — rebuilt from scratch every load so it is always
      // identical and the sphere/card link is stable.
      resetDomainForFreshModel();
      seedSandboxSampleScene();
      // Sync the mounted Sidebar to the seeded usage parent, then keep it
      // collapsed (resetHomeLayout already set the command; this re-applies it
      // after the step-advance temporarily expands it).
      setStepAdvanceTrigger((t) => t + 1);
      useUIStore.getState().setLeftSidebarExpandCommand(false);
      console.log('[page:bootstrap] Sandbox stage seeded');
      return;
    }

    const gsd = useUIStore.getState().globalSpeckleData;
    if (gsd !== null) return; // model already loaded via normal flow
    bootstrappedRef.current = true;
    // Opening a model / refreshing a model page always starts reduced.
    collapseFloatingPanels();
    // Show a loading state (not the Home model browser) while the model loads.
    setIsBootstrappingModel(true);

    console.log('[page:bootstrap] Loading soundscape for model_id from URL:', urlModelId);
    apiService.loadSoundscapeFromSpeckle(urlModelId, useWorkspaceStore.getState().workspace?.id).then(loadResponse => {
      if (loadResponse.requires_invite) {
        notifyError(
          'This project belongs to a private workspace. Ask a member for an invite link to collaborate.',
          'warning',
        );
      }
      if (!loadResponse.found || !loadResponse.soundscape_data) {
        console.log('[page:bootstrap] No saved soundscape found for', urlModelId, '- looking up model from Speckle API');
        apiService.getSpeckleModels().then(speckleResponse => {
          const model = speckleResponse.models.find(m => m.id === urlModelId);
          if (!model || !model.latest_version) {
            console.log('[page:bootstrap] Model not found in Speckle project:', urlModelId);
            setIsBootstrappingModel(false);
            return;
          }
          const v = model.latest_version;
          const speckleData = {
            model_id: model.id,
            version_id: v.id,
            file_id: '',
            url: `https://app.speckle.systems/projects/${speckleResponse.project_id}/models/${model.id}`,
            object_id: v.referenced_object ?? v.id,
            display_name: model.display_name ?? model.name,
            auth_token: speckleResponse.auth_token || undefined,
          };
          useUIStore.getState().setGlobalSpeckleData(speckleData);
          useUIStore.getState().setSpeckleModelUrl(speckleData.url);
          if (speckleData.display_name) {
            setModelFileName(speckleData.display_name);
          }
          console.log('[page:bootstrap] Viewer reconstructed from Speckle API for', urlModelId);
        }).catch(err => {
          console.error('[page:bootstrap] Failed to look up model from Speckle API:', err);
          setIsBootstrappingModel(false);
        });
        return;
      }

      const data = loadResponse.soundscape_data;
      const audioBaseUrl = `${API_BASE_URL}${loadResponse.audio_base_url}`;
      const irBaseUrl = loadResponse.ir_base_url || undefined;
      if (loadResponse.missing_audio_filenames?.length) {
        notifyError(
          `${loadResponse.missing_audio_filenames.length} saved sound file(s) could not be found on the server and were skipped.`,
          'warning',
        );
      }

      // Reconstruct SpeckleData from the saved fields so the viewer can load geometry
      if (data.project_id) {
        const speckleData = {
          model_id: data.model_id,
          version_id: data.version_id || '',
          file_id: '',
          url: `https://app.speckle.systems/projects/${data.project_id}/models/${data.model_id}`,
          object_id: '',
          display_name: data.model_name || data.model_id,
          auth_token: data.auth_token || undefined,
        };
        useUIStore.getState().setGlobalSpeckleData(speckleData);
        useUIStore.getState().setSpeckleModelUrl(speckleData.url);
        if (speckleData.display_name) {
          setModelFileName(speckleData.display_name);
        }
      }

      applyRestoredSoundscapePayload(data, audioBaseUrl, irBaseUrl, suppressOrchestrateBakeRef);
      console.log('[page:bootstrap] Soundscape restored from URL param');
      setIsBootstrappingModel(false);
    }).catch(err => {
      console.error('[page:bootstrap] Failed to load soundscape:', err);
      setIsBootstrappingModel(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Autosave — debounced save on domain state mutations
  // Uses a ref for the save handler so it can be called before it's defined
  const saveSoundscapeRef = useRef<(() => Promise<void>) | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveEnabledRef = useRef(true);
  const lastSaveSourceRef = useRef<string>('manual');
  // Snapshot of the most recent save payload so a 409 conflict can offer a
  // "download my changes" escape hatch instead of silently discarding edits.
  const lastSavePayloadRef = useRef<{ modelId: string; savedAt: number; payload: unknown } | null>(null);
  useEffect(() => {
    const unsubUI = useUIStore.subscribe((_state, _prev) => {
      autosaveEnabledRef.current = _state.enableAutoSave;
    });
    const scheduleAutosave = (source?: string) => {
      // Read live store state instead of the render closure — this effect only
      // runs once at mount (deps=[]), so a captured `globalSpeckleData` variable
      // would be frozen at its mount-time value (null on a cold refresh) forever.
      const liveModelId = useUIStore.getState().globalSpeckleData?.model_id ?? SANDBOX_MODEL_ID;
      // Nothing to autosave on the fresh Home sandbox: no model and no loaded
      // "No-model" project.
      const uiState = useUIStore.getState();
      if (!uiState.globalSpeckleData && !uiState.homeProject) return;
      if (!autosaveEnabledRef.current) return;
      // Viewers are read-only: never attempt a save (the backend would reject it).
      if (useWorkspaceStore.getState().workspace?.role === 'viewer') return;
      // Shared-session guard: when other members are active on the same
      // workspace, pause autosave so concurrent writes don't clobber each other.
      if (useWorkspaceStore.getState().presence > 1) return;
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        lastSaveSourceRef.current = 'autosave';
        saveSoundscapeRef.current?.();
      }, 3000);
    };
    const unsubSoundscape = useSoundscapeStore.subscribe(() => scheduleAutosave('soundscapeStore'));
    const unsubAudio = useAudioControlsStore.subscribe(() => scheduleAutosave('audioControlsStore'));
    const unsubReceivers = useReceiversStore.subscribe(() => scheduleAutosave('receiversStore'));
    const unsubGridListeners = useGridListenersStore.subscribe(() => scheduleAutosave('gridListenersStore'));
    const unsubSim = useAcousticsSimulationStore.subscribe(() => scheduleAutosave('acousticsSimulationStore'));
    const unsubAnalysis = useAnalysisStore.subscribe(() => scheduleAutosave('analysisStore'));
    return () => {
      unsubUI();
      unsubSoundscape();
      unsubAudio();
      unsubReceivers();
      unsubGridListeners();
      unsubSim();
      unsubAnalysis();
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Workspace/collaboration state (shared sessions): load the active workspace
  // and start the presence heartbeat.
  useEffect(() => {
    void useWorkspaceStore.getState().init();
  }, []);

  // Accept an invite link (?invite=<token>): join the shared workspace, then
  // strip the token from the URL so it is not bookmarked/reshared accidentally.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (!token) return;
    void (async () => {
      try {
        await useWorkspaceStore.getState().init();
        await useWorkspaceStore.getState().join(token);
        notifyError("Joined the shared workspace.", "info");
      } catch (err) {
        notifyError(err instanceof Error ? err.message : "Failed to join workspace", "warning");
      } finally {
        params.delete("invite");
        const qs = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      }
    })();
  }, []);

  const fileUpload = useFileUploadStore();
  const handleApiError = useApiErrorHandler();
  const addError = useErrorsStore((s) => s.addError);
  const soundGen = useSoundscapeStore();

  // Sync generated sounds and configs to audioControlsStore
  const syncGeneratedSounds = useAudioControlsStore((s) => s.syncGeneratedSounds);
  const syncSoundConfigs = useAudioControlsStore((s) => s.syncSoundConfigs);
  const iterationLinks = useAudioControlsStore((s) => s.iterationLinks);
  const soundTimestampsForCount = useAudioControlsStore((s) => s.soundTimestamps);
  useEffect(() => {
    syncGeneratedSounds(soundGen.generatedSounds);
  }, [soundGen.generatedSounds, syncGeneratedSounds]);
  useEffect(() => {
    syncSoundConfigs(soundGen.soundConfigs);
  }, [soundGen.soundConfigs, syncSoundConfigs]);

  // Auto-initialize an explicit schedule for freshly generated sounds that carry
  // authored foley timestamps (MM:SS). Tracks WITHOUT authored timestamps stay
  // "auto" — the timeline derives a default loop from interval_seconds. Tracks
  // that already have a stored schedule (incl. a cleared []) are never touched,
  // so manual DAW edits survive. Runs whenever generatedSounds changes.
  useEffect(() => {
    const audioStore = useAudioControlsStore.getState();
    soundGen.generatedSounds.forEach((sound: any) => {
      if (!sound.timestamps?.length) return;
      if (audioStore.soundTimestamps[sound.id] !== undefined) return;
      const timestampsSec = (sound.timestamps as unknown[]).map(parseAuthoredSeconds);
      console.log('[page:autoInit] materializing authored ts for', sound.id, ':', timestampsSec);
      audioStore.handleTimestampsChange(sound.id, timestampsSec);
    });
  }, [soundGen.generatedSounds]);

  // Re-bake orchestrate schedule and iteration links whenever sounds finish generating.
  // Both operations need the generated sound IDs which only exist post-generation.
  // Explicitly sync BOTH _generatedSounds and _soundConfigs before running the bake so that
  // the results are not affected by whether the separate syncGeneratedSounds effect has run yet.
  //
  // When restoring a saved soundscape we already have the exact baked timestamps + iteration
  // links, so a one-shot suppression flag skips the auto-rebake to avoid clobbering them.
  const suppressOrchestrateBakeRef = useRef(false);
  useEffect(() => {
    if (!soundGen.generatedSounds.length) return;
    if (suppressOrchestrateBakeRef.current) {
      suppressOrchestrateBakeRef.current = false;
      return;
    }
    const hasOrchestrate = soundGen.soundConfigs.some((c: SoundGenerationConfig) => c.orchestrateMeta);
    if (hasOrchestrate) {
      const audioStore = useAudioControlsStore.getState();
      audioStore.syncGeneratedSounds(soundGen.generatedSounds);
      audioStore.syncSoundConfigs(soundGen.soundConfigs);
      // During active generation, suppress mid-gen bakes — the final bake runs
      // once when generation completes.
      if (!audioStore._generationInProgress) {
        audioStore.bakeOrchestrateSchedule();
      }
      audioStore.setOrchestrateIterationLinks(soundGen.soundConfigs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundGen.generatedSounds]);

  const analysis = useAnalysisStore();

  const cardFlow = useCardFlowStore();

  // Speckle store — replaces SpeckleViewerContext + SpeckleSelectionModeContext
  const {
    linkObjectToSound,
    unlinkObjectFromSound,
    linkedObjectIds,
    setSelectedEntity,
    setModelFileName,
    getViewerRef,
    worldTreeVersion,
  } = useSpeckleStore();
  // Non-reactive compat shim — .current always returns latest viewer via getter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const viewerRef = useMemo<{ current: ReturnType<typeof getViewerRef> }>(() => ({
    get current() { return getViewerRef(); }
  }), []);

  // WorldTree readiness: poll until the tree has root children.
  // Used by entity-link effects and analysis entity population.
  const [worldTreeReady, setWorldTreeReady] = useState(false);

  useEffect(() => {
    if (!viewerRef?.current) return;

    const checkInterval = setInterval(() => {
      const worldTree = viewerRef.current?.getWorldTree();
      const worldTreeAny = worldTree as any;
      const children = worldTreeAny?.tree?._root?.children ||
                      worldTreeAny?._root?.children ||
                      worldTreeAny?.root?.children ||
                      worldTreeAny?.children;

      if (children && children.length > 0) {
        console.log('[page.tsx] WorldTree ready with', children.length, 'root nodes');
        setWorldTreeReady(true);
        clearInterval(checkInterval);
      }
    }, 500);

    return () => clearInterval(checkInterval);
  }, [viewerRef?.current]);

  // Map applicationId (Rhino GUID) → current Speckle tree ID.
  // Rebuilt when worldTree becomes ready AND on every worldTreeVersion bump (a new
  // model version loaded / in-place reload), so late-arriving nodes are included.
  // Used to remap entity links from saved soundscapes (Speckle object IDs change on
  // every commit, applicationId stays stable).
  const appIdToTreeIdMap = useMemo<Map<string, string>>(() => {
    if (!worldTreeReady || !viewerRef?.current) return new Map();
    const worldTree = viewerRef.current.getWorldTree() as any;
    const root = worldTree?.tree?._root || worldTree?._root || worldTree?.root || worldTree;
    return buildAppIdMap(root);
  }, [worldTreeReady, worldTreeVersion]);

  /**
   * Resolve a persisted entity to a current tree id:
   *  1. applicationId → current tree id (the stable path), else
   *  2. name + layer fallback (object replaced but name/layer still present), else
   *  3. the entity's stored node/id (unchanged model).
   * Returns null when nothing resolves.
   */
  const resolveEntityObjectId = useCallback((ent: any): string | null => {
    let objectId = ent?.nodeId || ent?.id;
    if (ent?.applicationId && appIdToTreeIdMap.size > 0) {
      const mapped = appIdToTreeIdMap.get(ent.applicationId);
      if (mapped) return mapped;
    }
    try {
      const worldTree = viewerRef.current?.getWorldTree();
      if (worldTree && ent?.name) {
        const node = resolveEntityByNameLayer(worldTree, ent.name, ent.layer);
        if (node) {
          const treeId = node?.model?.id || node?.raw?.id || node?.id;
          if (treeId) return treeId;
        }
      }
    } catch { /* ignore */ }
    return objectId || null;
  }, [appIdToTreeIdMap, viewerRef]);

  // ============================================================================
  // Refresh loaded entity links after a model (re)load:
  //  - objects that moved → re-derive bounds and move the sound marker/audio
  //  - objects that were deleted → detach the sound, reverting it to a free sphere
  // ============================================================================
  const refreshEntityLinksAndPositions = useCallback(() => {
    const worldTree = viewerRef.current?.getWorldTree?.();
    if (!worldTree) return;
    const configs = useSoundscapeStore.getState().soundConfigs;
    if (!configs.some((c) => c.entities?.length)) return;

    const mapReady = appIdToTreeIdMap.size > 0;
    let movedCount = 0;
    let detachedCount = 0;

    configs.forEach((config, index) => {
      if (!config.entities?.length) return;
      let changed = false;
      // entity.index → new center, only for entities whose object actually moved.
      const movedCenters = new Map<number, [number, number, number]>();
      const survivors: any[] = [];

      config.entities.forEach((ent: any, entIdx: number) => {
        const resolvedId = resolveEntityObjectId(ent);
        // buildEntityFromObjectId returns null ONLY when the node is absent from the
        // tree (not merely missing a render view), so it is a reliable existence check.
        const fresh = resolvedId ? buildEntityFromObjectId(worldTree, resolvedId, []) : null;

        if (!fresh) {
          // AppId map not populated yet → don't misclassify valid links as deleted.
          if (ent.applicationId && !mapReady) {
            survivors.push(ent);
            return;
          }
          // Object genuinely gone → drop it (changed so the config is rewritten).
          changed = true;
          return;
        }

        const newCenter: number[] | undefined = fresh.bounds?.center || fresh.position;
        if (!newCenter) {
          survivors.push(ent);
          return;
        }
        const oldCenter: number[] | undefined = ent.bounds?.center || ent.position;
        const isZero = newCenter.every((v) => Math.abs(v) < 1e-6);
        if (isZero && !(oldCenter && oldCenter.every((v) => Math.abs(v) < 1e-6))) {
          survivors.push(ent);
          return;
        }
        const moved =
          !oldCenter || oldCenter.some((v, i) => Math.abs(v - (newCenter[i] ?? 0)) > 1e-4);
        const identityChanged =
          (fresh.name && fresh.name !== ent.name) ||
          (fresh.applicationId && fresh.applicationId !== ent.applicationId);
        if (!moved && !identityChanged) {
          survivors.push(ent);
          return;
        }
        changed = true;
        if (moved) {
          movedCenters.set(
            ent.index ?? entIdx,
            [newCenter[0], newCenter[1], newCenter[2]] as [number, number, number],
          );
        }
        survivors.push({
          ...ent,
          name: fresh.name || ent.name,
          layer: fresh.layer || ent.layer,
          position: newCenter,
          bounds: fresh.bounds || ent.bounds,
          applicationId: fresh.applicationId || ent.applicationId,
        });
      });

      if (!changed) return;

      const soundsForPrompt = () =>
        useSoundscapeStore
          .getState()
          .generatedSounds.filter(
            (s: any) =>
              s.prompt_index === index ||
              (s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === index),
          );

      if (survivors.length === 0) {
        // Every linked object is gone → revert the sound to a free sphere.
        useSoundscapeStore.getState().handleDetachSoundFromEntity(index);
        soundsForPrompt().forEach((s: any) =>
          useAudioControlsStore.getState().clearAllIterationLinksForSound(s.id),
        );
        detachedCount++;
        return;
      }

      useSoundscapeStore.getState().handleUpdateConfig(index, 'entities', survivors);
      if (movedCenters.size === 0) return;
      movedCount++;
      const fallbackCenter = movedCenters.values().next().value as
        | [number, number, number]
        | undefined;
      soundsForPrompt().forEach((s: any) => {
        const center =
          (s.entity_index !== undefined && movedCenters.get(s.entity_index)) || fallbackCenter;
        if (center) useSoundscapeStore.getState().updateSoundPosition(s.id, center);
      });
    });

    // Refresh per-iteration link positions so the DAW per-entity markers and any
    // persisted snapshots follow the moved object.
    useAudioControlsStore.getState().refreshIterationEntityPositions();

    if (movedCount > 0 || detachedCount > 0) {
      console.log(
        `[page:entity-refresh] v${worldTreeVersion} map=${appIdToTreeIdMap.size} ` +
          `moved=${movedCount} detached=${detachedCount}`,
      );
    }
  }, [appIdToTreeIdMap, resolveEntityObjectId, viewerRef, worldTreeVersion]);

  useEffect(() => {
    if (!worldTreeReady) return;
    refreshEntityLinksAndPositions();
  }, [worldTreeReady, worldTreeVersion, refreshEntityLinksAndPositions]);

  const sed = useSEDStore();

  // MAIN AUDIO SYSTEM: Handles all 6 audio modes (Flat Anechoic, ShoeBox Acoustics, Spatial Anechoic, Mono IR, Stereo IR, Ambisonic IR)
  const audioOrchestrator = useAudioOrchestrator();
  
  // Store orchestrator in ref for stable callback access
  const orchestratorRef = useRef(audioOrchestrator.orchestrator);
  useEffect(() => {
    orchestratorRef.current = audioOrchestrator.orchestrator;
  }, [audioOrchestrator.orchestrator]);

  // Route every speaker-reaching audio path (orchestrator, modal impact, card
  // previews) to the device chosen in Audio settings. Registered targets pick
  // up the current device automatically, so this only fires on user changes.
  const outputDeviceId = useAudioControlsStore((s) => s.outputDeviceId);
  useEffect(() => {
    applyOutputDevice(outputDeviceId);
  }, [outputDeviceId]);

  // Fall back to the system default when the selected device is unplugged.
  useAudioOutputDeviceSync();

  // Audio feature hooks (modular, integrate with orchestrator)
  const audioNormalization = useAudioNormalization(audioOrchestrator.orchestrator);
  const roomMaterials = useRoomMaterialsStore();

  const receivers = useReceiversStore();
  const gridListeners = useGridListenersStore();

  // Trigger AudioOrchestrator update when selected receiver changes (replaces onReceiverSelected callback)
  useEffect(() => {
    if (!receivers.selectedReceiverId || !orchestratorRef.current) return;
    orchestratorRef.current.updateActiveReceiver(receivers.selectedReceiverId).catch(console.error);
  }, [receivers.selectedReceiverId]);

  // Receiver spiral placement tracking — persists last camera-front position and count
  const lastReceiverCameraFrontRef = useRef<[number, number, number] | null>(null);
  const receiversAtCameraFrontRef = useRef<number>(0);
  const modalImpact = useModalImpactStore();
  const acousticsSimulation = useAcousticsSimulationStore();

  // UI state — from uiStore (replaces local useState calls)
  const {
    activeLoadTab, setActiveLoadTab,
    selectedIRId, setSelectedIRId,
    selectedIRMetadata, setSelectedIRMetadata,
    irRefreshTrigger, triggerIRRefresh,
    showBoundingBox, setShowBoundingBox,
    refreshBoundingBoxTrigger, triggerBoundingBoxRefresh,
    audioRenderingMode, setAudioRenderingMode,
    useSpeckleViewer,
    speckleModelUrl, setSpeckleModelUrl,
    globalModelFile, setGlobalModelFile,
    globalSpeckleData, setGlobalSpeckleData,
    isUploadingGlobalModel, setIsUploadingGlobalModel,
    isSavingSoundscape, setIsSavingSoundscape,
    homeProject,
    isLeftSidebarExpanded, setIsLeftSidebarExpanded,
    speckleBounds, setSpeckleBounds,
    hoveredIRSourceReceiver, setHoveredIRSourceReceiver,
    showAxesHelper, setShowAxesHelper,
    showLabelSprites, setShowLabelSprites,
    showHoveringHighlight, setShowHoveringHighlight,
    showSoundSpheres, setShowSoundSpheres,
    showPlayingHighlight, setShowPlayingHighlight,
    showSceneListeners, setShowSceneListeners,
    showAdvancedSettings, setShowAdvancedSettings,
    showGroundGrid, setShowGroundGrid,
    groundGridSpacing, setGroundGridSpacing,
    groundGridColor, setGroundGridColor,
    setGlobalSoundSpeed,
    setGlobalMeshLc,
  } = useUIStore();
  // roomScale lives in acousticsSimulationStore so undo/redo works for Resonance Audio
  const roomScale = useAcousticsSimulationStore((s) => s.roomScale);
  const setRoomScale = useAcousticsSimulationStore((s) => s.setRoomScale);
  const { isExpanded: isRightSidebarExpanded } = useRightSidebarStore();

  // Sidebar resize widths — kept in sync via callbacks from each sidebar
  const [leftSidebarContentWidth, setLeftSidebarContentWidth] = useState<number | undefined>(undefined);
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number | undefined>(undefined);

  // True while the ?model_id= URL bootstrap is fetching the saved soundscape /
  // model data. Used to show a loading state instead of the Home model browser
  // on a refresh of an existing model page.
  //
  // Always initialise to `false` — never read `window.location` in a useState
  // initializer. The server has no `window`, so a URL-derived initial value
  // renders `false` on the server but `true` on the client's first render,
  // producing a hydration mismatch (server: no loading overlay; client: overlay).
  // The bootstrap effect below flips it to `true` after mount.
  const [isBootstrappingModel, setIsBootstrappingModel] = useState(false);

  // Homepage project save/reload modal.
  const [showHomeProjectModal, setShowHomeProjectModal] = useState(false);
  const [isSavingHomeProject, setIsSavingHomeProject] = useState(false);

  // Sync model bounding box → Resonance Audio room bounds
  useEffect(() => {
    if (!speckleBounds || !audioOrchestrator.orchestrator) return;
    audioOrchestrator.orchestrator.updateResonanceRoomBounds(
      speckleBounds.min,
      speckleBounds.max
    );
  }, [speckleBounds, audioOrchestrator.orchestrator]);

  // Sync room materials → Resonance Audio engine.
  // Re-runs on material edits, undo/redo, soundscape restore, and mode entry into
  // resonance so the ShoeBox acoustics always match the persisted store value.
  useEffect(() => {
    if (!audioOrchestrator.orchestrator) return;
    audioOrchestrator.orchestrator.updateResonanceRoomMaterials(roomMaterials.roomMaterials);
  }, [audioOrchestrator.orchestrator, audioOrchestrator.status?.currentMode, roomMaterials.roomMaterials]);

  // Sync room dimensions → Resonance Audio engine (same trigger surface as above).
  useEffect(() => {
    if (!audioOrchestrator.orchestrator) return;
    audioOrchestrator.orchestrator.updateResonanceRoomDimensions(roomMaterials.roomDimensions);
  }, [audioOrchestrator.orchestrator, audioOrchestrator.status?.currentMode, roomMaterials.roomDimensions]);

  // When roomScale changes (including after undo/redo), trigger a bounding box re-render
  useEffect(() => {
    if (showBoundingBox) {
      triggerBoundingBoxRefresh();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomScale]);

  // IR hover handler
  const handleIRHover = useCallback((sourceId: string | null, receiverId: string | null) => {
    setHoveredIRSourceReceiver(sourceId && receiverId ? { sourceId, receiverId } : null);
  }, [setHoveredIRSourceReceiver]);

  // Simulation-time positions from the active (expanded) simulation card.
  // Used by SpeckleScene as the source of truth for IR hover line and position mismatch.
  const activeSimulationPositions = useMemo(() => {
    const idx = acousticsSimulation.activeSimulationIndex;
    if (idx === null) return null;
    const cfg = acousticsSimulation.simulationConfigs[idx] as any;
    return (cfg?.simulationPositions as {
      sources: Record<string, [number, number, number]>;
      receivers: Record<string, [number, number, number]>;
    } | undefined) ?? null;
  }, [acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs]);

  // Shared camera save helper — called by both autosave and beforeunload.
  // Writes directly to localStorage because Zustand's persist middleware
  // subscriber may not fire in time during page unload (React 18 batching).
  const CAMERA_STORAGE_KEY = 'compas-camera-state';
  const saveCameraToStore = useCallback(() => {
    const engine = useSpeckleEngineStore.getState();
    const viewer = engine.viewer;
    if (!viewer) {
      return;
    }
    if (!_viewerLoadComplete) {
      console.log('[page:camera:save] Skipped — viewer load not complete');
      return;
    }
    try {
      const cam = viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
      if (!cam || !(cam as any).isPerspectiveCamera) {
        console.log('[page:camera:save] Skipped — camera not available or not PerspectiveCamera', !!cam, (cam as any)?.isPerspectiveCamera);
        return;
      }
      const pos: [number, number, number] = [cam.position.x, cam.position.y, cam.position.z];
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const target: [number, number, number] = [
        cam.position.x + dir.x * 10,
        cam.position.y + dir.y * 10,
        cam.position.z + dir.z * 10,
      ];
      const up: [number, number, number] = [cam.up.x, cam.up.y, cam.up.z];

      // Capture orbit target from CameraController so restore preserves orbit center
      let orbitTarget: [number, number, number] | null = null;
      const cc = engine.cameraController;
      if (cc) {
        const t = (cc as any).controls?.target;
        if (t) orbitTarget = [t.x, t.y, t.z];
      }

      // Write to Zustand + directly to localStorage for reliability
      useUIStore.getState().setCameraState(pos, target);
      try {
        localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify({ pos, target, up, orbitTarget }));
      } catch (e) {
        // localStorage may be full or unavailable
      }
    } catch (e) {
      console.warn('[page:camera:save] Error:', e);
    }
  }, []);

  // Periodically save camera state (every 5s) so it's always recent even
  // if no autosave or beforeunload fires.
  useEffect(() => {
    const interval = setInterval(saveCameraToStore, 5000);
    return () => clearInterval(interval);
  }, [saveCameraToStore]);

  // Save camera POV on beforeunload so it survives a page refresh
  useEffect(() => {
    window.addEventListener('beforeunload', saveCameraToStore);
    return () => window.removeEventListener('beforeunload', saveCameraToStore);
  }, [saveCameraToStore]);

  // Reset the viewer-load-complete gate when model is unloaded (e.g. going to homepage)
  useEffect(() => {
    if (!globalSpeckleData) {
      _viewerLoadComplete = false;
    }
  }, [globalSpeckleData]);

  // Once the model data is available, the viewer loading overlay takes over
  useEffect(() => {
    if (globalSpeckleData) {
      setIsBootstrappingModel(false);
    }
    // Auto-save is off on the fresh Home sandbox and on again once a model or a
    // saved "No-model" project is open.
    useUIStore.getState().setEnableAutoSave(globalSpeckleData !== null || homeProject !== null);
  }, [globalSpeckleData, homeProject]);

  // Callback when Speckle viewer is loaded
    const handleSpeckleViewerLoaded = useCallback((viewer: import('@speckle/viewer').Viewer) => {
    _viewerLoadComplete = true;
    console.log('[page:camera:restore] Viewer loaded');

    // Sandbox has no Speckle worldBox — the placeholder hook frames the room.
    if (!useUIStore.getState().globalSpeckleData) {
      return;
    }

    // When a model was opened from the Home page, ignore any camera POV saved
    // for a previously-loaded model and frame the new model's bounding box.
    // A refresh of an existing ?model_id= session keeps restoring the saved POV.
    let fitToBoundingBox = _fitCameraToBoundingBoxOnLoad;
    _fitCameraToBoundingBoxOnLoad = false;
    // "Switch to latest version" reloads the page and stashes a one-shot flag so
    // the new version is framed to its bounding box instead of the old POV.
    try {
      if (sessionStorage.getItem(MODEL_VERSION_WATCH.FIT_CAMERA_ON_NEXT_LOAD_KEY) === '1') {
        sessionStorage.removeItem(MODEL_VERSION_WATCH.FIT_CAMERA_ON_NEXT_LOAD_KEY);
        fitToBoundingBox = true;
      }
    } catch { /* sessionStorage unavailable */ }
    if (fitToBoundingBox) {
      console.log('[page:camera:restore] Model opened from Home — ignoring saved POV, fitting to bounding box');
      useUIStore.getState().setCameraState(null, null);
      try {
        localStorage.removeItem('compas-camera-state');
      } catch (e) { /* ignore */ }
    }

    // Try Zustand store first (may have been rehydrated), then fall back to direct localStorage
    let savedPos = fitToBoundingBox ? null : useUIStore.getState().cameraPosition;
    let savedTarget = fitToBoundingBox ? null : useUIStore.getState().cameraTarget;
    let savedUp: [number, number, number] | undefined;
    let savedOrbitTarget: [number, number, number] | undefined;
    if ((!savedPos || !savedTarget) && !fitToBoundingBox) {
      try {
        const raw = localStorage.getItem('compas-camera-state');
        if (raw) {
          const parsed = JSON.parse(raw);
          savedPos = parsed.pos;
          savedTarget = parsed.target;
          savedUp = parsed.up;
          savedOrbitTarget = parsed.orbitTarget;
          if (savedPos && savedTarget) {
            useUIStore.getState().setCameraState(savedPos, savedTarget);
            console.log('[page:camera:restore] Read camera from direct localStorage');
          }
        }
      } catch (e) { /* ignore */ }
    }
    console.log('[page:camera:restore] Final state:', {
      hasPosition: !!savedPos,
      position: savedPos,
      hasTarget: !!savedTarget,
      target: savedTarget,
    });
    if (savedPos && savedTarget) {
      setTimeout(() => {
        try {
          const cam = viewer.getRenderer().renderingCamera;
          if (!cam) {
            console.warn('[page:camera:restore] renderingCamera is null');
            return;
          }
          if (!(cam as any).isPerspectiveCamera) {
            console.warn('[page:camera:restore] Camera is not PerspectiveCamera, type:', (cam as any).type);
            return;
          }

          // Use fromPositionAndTarget to sync both the Three.js camera and the
          // Speckle CameraController's internal orbit controls state. Using
          // controls.fromPositionAndTarget() instead of manual cam.position.set() +
          // cam.lookAt() fixes two bugs:
          //   1. Roll: cam.lookAt() uses camera.up = (0,1,0) (Three.js Y-up default)
          //      but Speckle models are Z-up (0,0,1). fromPositionAndTarget respects
          //      the controls' internal up which is Z-up.
          //   2. Click-reset: manual camera changes don't sync the CameraController's
          //      internal spherical coordinates. On first click, the controller
          //      recalculates from stale state and snaps back to the bounding-box fit.
          const cc = useSpeckleEngineStore.getState().cameraController;
          const ccControls = (cc as any)?.controls;
          if (ccControls?.fromPositionAndTarget) {
            const ot = savedOrbitTarget || savedTarget;
            ccControls.fromPositionAndTarget(
              new THREE.Vector3(savedPos[0], savedPos[1], savedPos[2]),
              new THREE.Vector3(ot[0], ot[1], ot[2])
            );
            // Ensure camera.up is restored for edge cases where the controls' up
            // doesn't match the saved orientation
            if (savedUp) {
              cam.up.set(savedUp[0], savedUp[1], savedUp[2]);
            }
          } else {
            // Fallback: direct camera manipulation (backward compat)
            if (savedUp) {
              cam.up.set(savedUp[0], savedUp[1], savedUp[2]);
            }
            cam.position.set(savedPos[0], savedPos[1], savedPos[2]);
            const dx = savedTarget[0] - savedPos[0];
            const dy = savedTarget[1] - savedPos[1];
            const dz = savedTarget[2] - savedPos[2];
            if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.001) {
              (cam as any).lookAt(savedTarget[0], savedTarget[1], savedTarget[2]);
            }
          }

          viewer.requestRender(8);
          console.log('[page:camera:restore] Applied camera — pos:', savedPos.map((v: number) => v.toFixed(1)), 'target:', savedTarget.map((v: number) => v.toFixed(1)));
        } catch (e) {
          console.warn('[page:camera:restore] Error:', e);
        }
      }, 800);
    } else {
      console.log('[page:camera:restore] No saved camera state — fitting to model bounding box');
      setTimeout(() => {
        const cc = useSpeckleEngineStore.getState().cameraController;
        if (cc?.setCameraView) {
          cc.setCameraView([], true);
          viewer.requestRender(8);
          console.log('[page:camera:restore] Applied auto-fit to all objects');
        } else {
          console.warn('[page:camera:restore] CameraController not available for auto-fit');
        }
      }, 800);
    }
  }, []);
   
  // Sync audioRenderingMode with orchestrator only when IR state changes
  useEffect(() => {
    if (!audioOrchestrator.status) return;

    const isIRActive = audioOrchestrator.status.isIRActive;

    // When IR becomes active, force to 'precise' mode
    if (isIRActive && audioRenderingMode !== 'precise') {
      setAudioRenderingMode('precise');
    }
    // Note: Don't override user's selection of 'precise' when no IR is loaded
    // They may be about to upload an IR
  }, [audioOrchestrator.status?.isIRActive]);

  const prevOrchestratorModeRef = useRef<string | undefined>(undefined);

  // Auto-show/hide bounding box on ResonanceMode transitions only
  useEffect(() => {
    if (!audioOrchestrator.status) return;

    const currentMode = audioOrchestrator.status.currentMode;
    const prevMode = prevOrchestratorModeRef.current;
    prevOrchestratorModeRef.current = currentMode;

    if (prevMode === currentMode) return;

    if (currentMode === 'no_ir_resonance') {
      setShowBoundingBox(true);
    } else if (prevMode === 'no_ir_resonance') {
      setShowBoundingBox(false);
    }
  }, [audioOrchestrator.status?.currentMode]);

  // Helper: check if a simulation config has a source-receiver IR mapping (completed simulation)
  const getSimIRMapping = useCallback((index: number | null) => {
    if (index === null) return null;
    const config = acousticsSimulation.simulationConfigs[index];
    if (!config || (config.type !== 'pyroomacoustics' && config.type !== 'import-irs')) return null;
    const mapping = (config as any).sourceReceiverIRMapping || null;
    return mapping && Object.keys(mapping).length > 0 ? mapping : null;
  }, [acousticsSimulation.simulationConfigs]);

  // Set source-receiver IR mapping when simulation completes (PyroomAcoustics)
  // Uses hot-swap (no stop) when already in IR mode and switching between completed simulations
  const prevIRMappingIndexRef = useRef<number | null>(acousticsSimulation.activeSimulationIndex);

  useEffect(() => {
    if (!audioOrchestrator.orchestrator) return;

    // Check if active simulation is Pyroomacoustics and has source-receiver mapping
    if (acousticsSimulation.activeSimulationIndex !== null) {
      const activeConfig = acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex];

      if (activeConfig && (activeConfig.type === 'pyroomacoustics' || activeConfig.type === 'choras' || activeConfig.type === 'import-irs')) {
        const simConfig = activeConfig as any;
        const simulationMode = activeConfig.type === 'import-irs' ? 'pyroomacoustics' : activeConfig.type as AcousticSimulationMode;

        // If simulation has source-receiver IR mapping, pass it to AudioOrchestrator
        if (simConfig.sourceReceiverIRMapping) {
          const initialReceiverId = receivers.receivers.length > 0 ? receivers.receivers[0].id : undefined;
          // Actual simulation-time source coordinates — lets the orchestrator resolve a
          // new sound's IR by distance to the recorded position, not grid-cell equality.
          const simulationSourcePositions = simConfig.simulationPositions?.sources;

          // Determine if we can hot-swap: already in AMBISONIC_IR mode and previous sim also had IR mapping
          const prevMapping = getSimIRMapping(prevIRMappingIndexRef.current);
          const currentMode = audioOrchestrator.orchestrator.getCurrentMode();
          const canHotSwap = prevMapping !== null && currentMode === 'ambisonic_ir';

          if (canHotSwap) {
            console.log('[Page] Hot-swapping IR mapping (no stop)', {
              simulationId: activeConfig.id,
              sourceCount: Object.keys(simConfig.sourceReceiverIRMapping).length
            });
            audioOrchestrator.orchestrator.hotSwapSourceReceiverIRMapping(
              simConfig.sourceReceiverIRMapping,
              simulationMode,
              initialReceiverId,
              simulationSourcePositions
            ).then(() => {
              console.log('[Page] ✅ IR mapping hot-swapped successfully');
            }).catch(error => {
              console.error('[Page] ❌ Failed to hot-swap IR mapping:', error);
            });
          } else {
            console.log('[Page] Setting source-receiver IR mapping from simulation', {
              simulationId: activeConfig.id,
              hasMapping: !!simConfig.sourceReceiverIRMapping,
              sourceCount: Object.keys(simConfig.sourceReceiverIRMapping).length
            });
            audioOrchestrator.orchestrator.setSourceReceiverIRMapping(
              simConfig.sourceReceiverIRMapping,
              simulationMode,
              initialReceiverId,
              simulationSourcePositions
            ).then(() => {
              console.log('[Page] ✅ Source-receiver IR mapping applied successfully');
            }).catch(error => {
              console.error('[Page] ❌ Failed to set source-receiver IR mapping:', error);
            });
          }
        }
      }
    }

    prevIRMappingIndexRef.current = acousticsSimulation.activeSimulationIndex;
  }, [
    audioOrchestrator.orchestrator,
    acousticsSimulation.activeSimulationIndex,
    acousticsSimulation.simulationConfigs,
    receivers.receivers,
    getSimIRMapping
  ]);

  // Log simulation-tab switches. Playback is intentionally NOT stopped here:
  // switching cards changes the acoustic rendering, which is handed over
  // seamlessly by the AudioOrchestrator graph-changed event (Transport re-dispatch).
  const prevActiveIndexRef = useRef<number | null>(acousticsSimulation.activeSimulationIndex);

  useEffect(() => {
    const prevIndex = prevActiveIndexRef.current;
    const currentIndex = acousticsSimulation.activeSimulationIndex;

    if (prevIndex !== null && prevIndex !== currentIndex) {
      const prevMapping = getSimIRMapping(prevIndex);
      const currentMapping = getSimIRMapping(currentIndex);

      if (prevMapping && currentMapping) {
        console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, hot-swapping IRs (no stop)`);
      } else {
        console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, seamless mode handover`);
      }
    }

    // Update ref for next comparison
    prevActiveIndexRef.current = currentIndex;
  }, [acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs, getSimIRMapping]);
  
  // Entity linking state
  const [isLinkingEntity, setIsLinkingEntity] = useState(false);
  const [linkingConfigIndex, setLinkingConfigIndex] = useState<number | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);

  // Material assignment state (NEW)
  const [selectedGeometry, setSelectedGeometry] = useState<SelectedGeometry | null>(null);
  const [hoveredGeometry, setHoveredGeometry] = useState<SelectedGeometry | null>(null);
  const [modelType, setModelType] = useState<'3dm' | 'obj' | 'ifc' | null>(null);

  // Go to receiver state (triggers first-person view at specific receiver)
  const [goToReceiverId, setGoToReceiverId] = useState<string | null>(null);
  // Go to a grid listener point directly by position (when no receiver mesh exists)
  const [goToPosition, setGoToPosition] = useState<[number, number, number] | null>(null);
  // Receiver ID paired with goToPosition — needed to load the correct IRs
  const [goToPositionReceiverId, setGoToPositionReceiverId] = useState<string | null>(null);

  // FPS mode tracking (true while inside first-person view)
  const [isFPSModeActive, setIsFPSModeActive] = useState(false);

  // Active IR group to highlight/scroll in the simulation card
  const [activeIRGroupId, setActiveIRGroupId] = useState<string | null>(null);

  // Step advance trigger for left sidebar (increment to advance to Sounds step)
  const [stepAdvanceTrigger, setStepAdvanceTrigger] = useState(0);

  // FPS mode programmatic exit trigger (increment to exit first-person mode)
  const [exitFPSTrigger, setExitFPSTrigger] = useState(0);

  // Forced expanded listener card — derived from active go-to target (single listeners only)
  const goToExpandedSingleListenerId = useMemo(() => {
    if (!activeIRGroupId) return null;
    return receivers.receivers.some((r) => r.id === activeIRGroupId) ? activeIRGroupId : null;
  }, [activeIRGroupId, receivers.receivers]);

  // Collapse all listener cards trigger (from FPS exit via Escape or go-to toggle off)
  const [collapseListenerCardTrigger, setCollapseListenerCardTrigger] = useState(0);

  // Expanded grid listener ID (controls which grid's points are rendered in 3D)
  const [expandedGridListenerId, setExpandedGridListenerId] = useState<string | null>(null);

  // FPS listener orientation: offset direction from receiver position used as look-at target
  const [listenerOrientation, setListenerOrientation] = useState<{ x: number; y: number; z: number }>(
    { ...DEFAULT_LISTENER_ORIENTATION }
  );

  // Detect model type from file extension and set model filename in context
  useEffect(() => {
    const modelFile = fileUpload.modelFile || globalModelFile;
    if (modelFile) {
      const fileName = modelFile.name.toLowerCase();
      console.log('[page.tsx] Setting model filename in context:', modelFile.name);
      if (fileName.endsWith('.3dm')) {
        setModelType('3dm');
      } else if (fileName.endsWith('.obj')) {
        setModelType('obj');
      } else if (fileName.endsWith('.ifc')) {
        setModelType('ifc');
      } else {
        setModelType(null);
      }
      // Update model filename in Speckle viewer context
      setModelFileName(modelFile.name);
    } else {
      console.log('[page.tsx] Clearing model filename from context');
      setModelType(null);
      setModelFileName(null);
    }
  }, [fileUpload.modelFile, globalModelFile, setModelFileName]);

  // ============================================================================
  // Effect - Register Entity-Sound Links When Sounds Are Generated
  // This ensures filtering colors are applied for entity-linked sounds from Analysis
  // ============================================================================
  useEffect(() => {
    if (!soundGen.generatedSounds || soundGen.generatedSounds.length === 0) {
      return;
    }

    // For each generated sound, check if its config has entity data
    soundGen.generatedSounds.forEach((sound: any) => {
      const promptIndex = sound.prompt_index;
      if (promptIndex === undefined) return;

      // Verify the sound still exists in soundscapeData (source of truth).
      // generatedSounds syncs from soundscapeData asynchronously, so after a reset
      // it may still contain stale entries that would incorrectly re-register as generated.
      const stillInSoundscape = soundGen.soundscapeData?.some(
        (s: any) => s.prompt_index === promptIndex
      );
      if (!stillInSoundscape) return;

      const config = soundGen.soundConfigs[promptIndex];
      if (!config?.entities?.length) return;

      // Resolve and register each entity in the config
      for (const ent of config.entities) {
        // Resolve the stable object ID to the current Speckle tree ID (appId, then
        // name+layer fallback). Speckle content hashes change on every commit.
        const objectId = resolveEntityObjectId(ent);
        if (!objectId) continue;

        // Register the entity-sound link in SpeckleSelectionModeContext
        // Pass hasGeneratedSound=true since this effect runs for generated sounds
        linkObjectToSound(objectId, promptIndex, true);
      }
    });
  }, [soundGen.generatedSounds, soundGen.soundConfigs, soundGen.soundscapeData, linkObjectToSound, resolveEntityObjectId]);

  // ============================================================================
  // Effect - Apply Pre-Gen Entity Selection After Generation
  // When the user selected a non-default entity in pre-gen mode, correct
  // entity_index on the generated sound to match the selection.
  // ============================================================================
  useEffect(() => {
    if (!soundGen.generatedSounds || soundGen.generatedSounds.length === 0) return;
    const pending = { ...preGenActiveEntityRef.current };
    if (Object.keys(pending).length === 0) return;

    for (const [configIdxStr, entityArrIdx] of Object.entries(pending)) {
      const configIdx = Number(configIdxStr);
      const config = soundGen.soundConfigs[configIdx];
      const entity = config?.entities?.[entityArrIdx];
      if (!entity) continue;
      const pos: [number, number, number] = entity.bounds?.center
        ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]]
        : entity.position && entity.position.length >= 3
          ? [entity.position[0], entity.position[1], entity.position[2]]
          : [0, 0, 0];
      const genSound = soundGen.generatedSounds.find(s =>
        s.prompt_index === configIdx ||
        (s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === configIdx)
      );
      if (genSound) {
        soundGen.selectLinkedEntity(genSound.id, entity.index ?? entityArrIdx, pos);
      }
      delete preGenActiveEntityRef.current[configIdx];
    }
  }, [soundGen.generatedSounds, soundGen.soundConfigs]);

  // ============================================================================
  // Effect - Register Pending Entity Links for Sound Configs (light pink)
  // When configs arrive with pre-attached entity data (e.g. from Analysis tab),
  // register them as pending links so the entity gets light pink coloring.
  // ============================================================================
  useEffect(() => {
    soundGen.soundConfigs.forEach((config, index) => {
      if (!config.entities?.length) return;
      for (const ent of config.entities) {
        // Resolve the stable id to the current Speckle tree ID (appId → tree id,
        // then name+layer fallback).
        const objectId = resolveEntityObjectId(ent);
        if (!objectId || linkedObjectIds.has(objectId)) continue;
        // Register as pending (no generated sound yet) → light pink
        linkObjectToSound(objectId, index);
      }
    });
  }, [soundGen.soundConfigs, linkedObjectIds, linkObjectToSound, resolveEntityObjectId]);

  // ============================================================================
  // Effect - Unlink objects that no longer have an entity in their sound config
  // This fires after undo/redo so the pink coloring is removed when a card's
  // entity link is reverted or the card itself disappears.
  // ============================================================================
  useEffect(() => {
    const currentObjectSoundLinks = useSpeckleStore.getState().objectSoundLinks;
    currentObjectSoundLinks.forEach((tabIndex, objectId) => {
      const config = soundGen.soundConfigs[tabIndex];
      // Check if any entity in config.entities matches this objectId
      const hasMatchingEntity = config?.entities?.some((ent: any) => {
        return resolveEntityObjectId(ent) === objectId;
      });
      // If the config is gone or no entity matches, unlink
      if (!config || !hasMatchingEntity) {
        unlinkObjectFromSound(objectId);
      }
    });
  }, [soundGen.soundConfigs, unlinkObjectFromSound, resolveEntityObjectId]);

  // Handler: Reset bounding box to its original model-derived size
  const handleRefreshBoundingBox = useCallback(() => {
    setRoomScale({ x: 1, y: 1, z: 1 });
    triggerBoundingBoxRefresh();
  }, [setRoomScale, triggerBoundingBoxRefresh]);

  // Active parent filter from UIStore (set by Sidebar when Sounds step is active)
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);

  // Re-apply Speckle entity highlight colors when the Sounds step is entered or exited.
  // applyFilterColors internally reads activeSoundParentIndex from UIStore to decide
  // whether to show entity link colors.
  useEffect(() => {
    useSpeckleStore.getState().applyFilterColors();
  }, [activeSoundParentIndex, isInSoundsStep]);

  // ── Active-scenario → DAW timeline binding ─────────────────────────────────────
  // Each scenario card owns its sound-scene timeline length (scenario.timelineDurationMs,
  // set via the Duration slider on the scenario card). While that scenario is the active
  // sound section, its duration drives the single DAW timeline store value. Switching to
  // another scenario section therefore re-bounds the DAW to that section's own duration.
  // Non-scenario sections (or "all sounds") keep the global store value. Writes from the
  // DAW (inline edit, bake auto-extend) are persisted back to the scenario by
  // setTimelineDurationMs, so this effect never fights user edits.
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const setTimelineDurationMs = useAudioControlsStore((s) => s.setTimelineDurationMs);
  const activeScenarioDurationMs = useMemo(() => {
    if (activeSoundParentIndex === null || activeSoundParentIndex === undefined) return null;
    const cfg = analysis.analysisConfigs[activeSoundParentIndex];
    if (!cfg || cfg.type !== 'scenario') return null;
    return cfg.timelineDurationMs;
  }, [activeSoundParentIndex, analysis.analysisConfigs]);
  useEffect(() => {
    if (activeScenarioDurationMs === null) return;
    if (activeScenarioDurationMs === timelineDurationMs) return;
    setTimelineDurationMs(activeScenarioDurationMs);
  }, [activeScenarioDurationMs, timelineDurationMs, setTimelineDurationMs]);

  // ── Unified soundscape data ────────────────────────────────────────────────────
  // One entry per visible sound config for the active parent.
  // Before generation: lightweight isPending placeholder (light-colored sphere).
  // After generation: the real SoundEvent from the server.
  // Returns [] when not in the Sounds step so the scene shows no sound spheres
  // outside the Sounds step. When in Sounds step with no parent (skipped flow),
  // shows sounds with parentUsageOriginalIndex === undefined.
  const unifiedSoundscapeData = useMemo(() => {
    if (!isInSoundsStep) return [];

    // Collect ALL generated events per prompt (all variants), not just the last one.
    // Previously a plain Map.set() kept only the last event (last-wins), so the
    // SoundSphereManager only ever received one variant per prompt and could not
    // register the others.  This caused playAll to target a source ID that was
    // never loaded in the orchestrator.
    const generatedByPrompt = new Map<number, any[]>();
    (soundGen.generatedSounds ?? []).forEach((s: any) => {
      if (s.prompt_index !== undefined) {
        if (!generatedByPrompt.has(s.prompt_index)) generatedByPrompt.set(s.prompt_index, []);
        generatedByPrompt.get(s.prompt_index)!.push(s);

        // For speech-line TTS sounds (prompt_index = cardIndex * 10000 + lineIdx),
        // also index by card index so the card-level lookup finds them.
        if (s.prompt_index >= 10000) {
          const cardIdx = Math.floor(s.prompt_index / 10000);
          if (!generatedByPrompt.has(cardIdx)) generatedByPrompt.set(cardIdx, []);
          generatedByPrompt.get(cardIdx)!.push(s);
        }
      }
    });

    // flatMap so that prompts with multiple variants expand to N entries while
    // prompts still pending produce exactly one placeholder entry.
    return soundGen.soundConfigs
      .flatMap((config, index) => {
        // When activeSoundParentIndex is set, only show sounds matching that parent.
        // When null (e.g., after auto-advance from restore), show all sounds
        // including parented ones — otherwise restored soundscapes lose their 3D spheres.
        if (activeSoundParentIndex !== null
            && config.parentUsageOriginalIndex !== activeSoundParentIndex
        ) return [];

        if (generatedByPrompt.has(index)) {
          const events = generatedByPrompt.get(index)!;
          const extraEntries: any[] = [];
          let extraLabelCounter = 0;
          for (const event of events) {
            const linkedIterEntries = Object.entries(iterationLinks)
              .filter(([k, v]) => k.startsWith(`${event.id}-`) && v.entityPosition);

            const seenPositions = new Set<string>();
            const defaultPosKey = event.position
              ? `${event.position[0]},${event.position[1]},${event.position[2]}`
              : '';

            for (const [iterKey, link] of linkedIterEntries) {
              if (!link.entityPosition) continue;
              const posKey = `${link.entityPosition![0]},${link.entityPosition![1]},${link.entityPosition![2]}`;
              if (seenPositions.has(posKey)) continue;
              seenPositions.add(posKey);

              extraEntries.push({
                ...event,
                id: `${event.id}_iter_${(link.entityNodeId || iterKey).slice(0, 8)}`,
                position: link.entityPosition,
                entity_index: link.entityIndex !== undefined
                  ? link.entityIndex
                  : -(10000 + index * 100 + extraLabelCounter++),
              });
            }

            // If iterations are linked, determine if there are unlinked ones.
            // Only add default .pos1 when unlinked iterations exist.
            if (linkedIterEntries.length > 0 && defaultPosKey && !seenPositions.has(defaultPosKey)) {
              const timestampsCount = soundTimestampsForCount[event.id]?.length;
              const totalIters = timestampsCount != null && timestampsCount > 0
                ? timestampsCount
                : linkedIterEntries.length;
              if (linkedIterEntries.length < totalIters) {
                seenPositions.add(defaultPosKey);
                extraEntries.push({
                  ...event,
                  id: `${event.id}_iter_default`,
                  position: event.position,
                  entity_index: 0,
                });
              }
            }
          }

          return [...events, ...extraEntries];
        }

        // Pending placeholder — resolve position:
        //   1. Explicit config.position (set by user entity selection)  2. Entity bounding-box center  3. [0,0,0]
        let position: [number, number, number] = [0, 0, 0];
        if (config.position) {
          position = config.position as [number, number, number];
        } else if (config.entities?.length) {
          const ec = config.entities[0];
          if (ec.bounds?.center) {
            position = [ec.bounds.center[0], ec.bounds.center[1], ec.bounds.center[2]];
          } else if (ec.position && ec.position.length >= 3) {
            position = [ec.position[0], ec.position[1], ec.position[2]] as [number, number, number];
          }
        }

        // entity_index: non-undefined routes sphere manager to label-only branch (no mesh).
        // Use -(index+1) as a sentinel for foley entities with no numeric index.
        const entity_index: number | undefined = config.entities?.length
          ? (config.entities[0].index ?? -(index + 1))
          : undefined;

        return [{
          id: `pending_${index}`,
          url: '',
          position,
          geometry: { vertices: [] as number[][], faces: [] as number[][] },
          display_name: config.display_name || config.prompt || `Sound ${index + 1}`,
          prompt_index: index,
          isPending: true,
          entity_index,
          // Only the deterministic Home Sample is pinned (it carries
          // config.pinned + SANDBOX_SAMPLE_SPHERE_POSITION). Other sounds —
          // including user-added sample-audio cards — must follow the normal
          // camera-front placement, so pin by flag, never by card type.
          ...(config.pinned ? { pinned: true } : {}),
        }];
      });
  }, [soundGen.soundConfigs, soundGen.generatedSounds, soundGen.soundscapeData, activeSoundParentIndex, isInSoundsStep, iterationLinks, soundTimestampsForCount]);

  // Handler: Extract SED audio segments and inject them as upload-type sound cards
  const handleAudioExtract = useCallback(async (config: AudioAnalysisConfig, originalIndex: number) => {
    if (!config.audioFile) return;
    const result = analysis.analysisResults.find((r) => r.configIndex === originalIndex);
    if (!result) return;
    const selectedPrompts = result.prompts.filter((p) => p.selected);
    if (selectedPrompts.length === 0) return;

    const segmentsList = selectedPrompts
      .map((p) => ({ name: p.text, detection_segments: p.metadata?.detection_segments ?? [] }))
      .filter((s) => s.detection_segments.length > 0);
    if (segmentsList.length === 0) return;

    const formData = new FormData();
    formData.append('file', config.audioFile);
    formData.append('segments_json', JSON.stringify(segmentsList));
    formData.append('apply_noise_reduction', String(config.applyNoiseReduction ?? false));
    formData.append('target_dbfs', String(selectedPrompts[0]?.metadata?.dbfs ?? DEFAULT_DBFS));

    const res = await fetch(`${API_BASE_URL}/api/extract-sed-segments`, { method: 'POST', body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).detail || 'Extraction failed');
    }
    const data = await res.json();
    const sounds = (data.sounds as any[]).map((s: any, si: number) => ({
      name: s.name,
      dbfs: selectedPrompts[si]?.metadata?.dbfs,
      interval_seconds: selectedPrompts[si]?.metadata?.interval_seconds,
      variants: s.variants,
    }));
    // Link extracted sounds to a real placeholder usage card parented to the
    // audio context (instead of the old negative-namespace bypass key). The
    // placeholder inherits the audio context card's own title.
    const usageIdx = analysis.ensureUsageCardForContext(
      originalIndex,
      config.display_name || CARD_TYPE_LABELS['audio'],
    );
    soundGen.injectExtractedSEDSounds(sounds, usageIdx);
    console.log(`[handleAudioExtract] Injected ${sounds.length} sounds from audio card ${originalIndex} (usageCard=${usageIdx})`);
  }, [analysis.analysisResults, analysis.ensureUsageCardForContext, soundGen]);
  const handleSendAnalysisToGeneration = useCallback((parentUsageIndex?: number) => {
    analysis.handleSendToSoundGeneration((prompts) => {
      // Resolve a full entity object from a Speckle tree ID by searching the world tree.
      // objectsInvolved from the foley LLM contains Speckle tree IDs, so we can search directly.
      const resolveEntityFromTreeId = (treeId: string, fallbackPosition?: [number, number, number]): any => {
        const viewer = viewerRef.current;
        if (!viewer) return { id: treeId, nodeId: treeId };
        let worldTree: any;
        try { worldTree = viewer.getWorldTree(); } catch { /* ignore */ }
        if (!worldTree) return { id: treeId, nodeId: treeId };

        // Depth-first search through the world tree for the node matching treeId
        const checkNode = (node: any): any => {
          const nodeId = node?.raw?.id || node?.model?.id || node?.id;
          if (nodeId === treeId) return node;
          const children = node?.model?.children || node?.children;
          if (children) {
            for (const child of children) {
              const found = checkNode(child);
              if (found) return found;
            }
          }
          return null;
        };
        const rootChildren =
          worldTree.tree?._root?.children ||
          worldTree._root?.children ||
          worldTree.root?.children ||
          worldTree.children;
        let objectData: any = null;
        if (rootChildren) {
          for (const child of rootChildren) {
            objectData = checkNode(child);
            if (objectData) break;
          }
        }

        const objectName: string | undefined =
          objectData?.model?.name || objectData?.raw?.name || undefined;
        const speckleType: string | undefined =
          objectData?.raw?.speckle_type || undefined;
        const applicationId: string | undefined =
          objectData?.raw?.applicationId || undefined;

        let position: [number, number, number] = [0, 0, 0];
        let entityBounds: any;
        try {
          const renderView = objectData?.model?.renderView || objectData?.renderView;
          if (renderView?.aabb) {
            const aabb = renderView.aabb as any;
            const cx = (aabb.min.x + aabb.max.x) / 2;
            const cy = (aabb.min.y + aabb.max.y) / 2;
            const cz = (aabb.min.z + aabb.max.z) / 2;
            position = [cx, cy, cz];
            entityBounds = {
              min: [aabb.min.x, aabb.min.y, aabb.min.z] as [number, number, number],
              max: [aabb.max.x, aabb.max.y, aabb.max.z] as [number, number, number],
              center: position,
            };
          }
        } catch { /* ignore */ }

        // If the viewer couldn't provide bounds, use the foley position as fallback
        if (!entityBounds && fallbackPosition) {
          position = fallbackPosition;
          entityBounds = {
            min: [fallbackPosition[0] - 0.5, fallbackPosition[1] - 0.5, fallbackPosition[2] - 0.5] as [number, number, number],
            max: [fallbackPosition[0] + 0.5, fallbackPosition[1] + 0.5, fallbackPosition[2] + 0.5] as [number, number, number],
            center: fallbackPosition,
          };
        }

        return {
          id: treeId,
          nodeId: treeId,
          applicationId,
          name: objectName,
          type: speckleType,
          position,
          bounds: entityBounds,
        };
      };

      // Convert text prompts to sound configs
      const newConfigs = prompts.map(p => {
        const normalizedCategory = (p.metadata?.category || '').toLowerCase().replace(/[\s-]+/g, '_');
        const isBackground = normalizedCategory === 'background' || normalizedCategory === 'background_sound';
        const orchestrateMeta = p.metadata?.orchestrateMeta;
        const scenarioSource = p.metadata?.scenarioSource;
        const isSpeech = orchestrateMeta?.isSpeech
          || scenarioSource?.isSpeech
          || normalizedCategory === 'speech';
        const variantCount = orchestrateMeta?.variants?.length
          ? Math.max(...orchestrateMeta.variants, 1)
          : (scenarioSource?.copyCount ?? 1);

        // Resolve entities: orchestrateMeta.allObjectIds, or scenarioSource.objectsInvolved,
        // or the prompt's resolved analysis group(s) — each group expands to ALL its object ids.
        const resolvedEntities = (() => {
          const allIds = orchestrateMeta?.allObjectIds?.length
            ? orchestrateMeta.allObjectIds
            : (scenarioSource?.objectsInvolved?.length ? scenarioSource.objectsInvolved : null);
          if (allIds && allIds.length) {
            return allIds.map((objId: string) => {
              const primaryRaw = { id: objId, foleyPosition: p.position };
              return resolveEntityFromTreeId(objId, primaryRaw.foleyPosition);
            }).filter(Boolean);
          }

          const groupEntities = (p.entities ?? (p.entity ? [p.entity] : [])).filter(Boolean);
          if (groupEntities.length === 0) return undefined;

          const expanded: any[] = [];
          for (const ent of groupEntities) {
            const ids: string[] = Array.isArray(ent.object_ids) && ent.object_ids.length
              ? ent.object_ids
              : (ent.id ? [ent.id] : []);
            if (ids.length === 0) continue;
            const groupBounds = ent.bounds;
            const fallbackPos: [number, number, number] | undefined = groupBounds?.center
              ? [groupBounds.center[0], groupBounds.center[1], groupBounds.center[2]]
              : (Array.isArray(ent.position) && ent.position.length >= 3
                  ? [ent.position[0], ent.position[1], ent.position[2]]
                  : p.position);
            for (const objId of ids) {
              const resolved = resolveEntityFromTreeId(objId, fallbackPos);
              if (!resolved) continue;
              expanded.push({
                ...resolved,
                groupName: ent.name,
                sourceGroupIndex: ent.index,
                bounds: resolved.bounds ?? groupBounds,
                position: resolved.position
                  ?? (groupBounds?.center
                      ? [groupBounds.center[0], groupBounds.center[1], groupBounds.center[2]]
                      : fallbackPos),
              });
            }
          }
          return expanded.length ? expanded : undefined;
        })();

        const config: SoundGenerationConfig = {
          prompt: isSpeech
            ? (orchestrateMeta?.speechLines?.[0] || scenarioSource?.speechLines?.[0] || scenarioSource?.script || p.text)
            : p.text,
          duration: isBackground ? 10 : (p.metadata?.duration_seconds ?? 10),
          guidance_scale: 4.5,
          negative_prompt: '',
          seed_copies: variantCount,
          steps: useSoundscapeStore.getState().globalSteps,
          dbfs: p.metadata?.dbfs ?? DEFAULT_DBFS,
          interval_seconds: isBackground ? 0 : (p.metadata?.interval_seconds ?? 5),
          display_name: p.displayName || (p.text.length > 50 ? p.text.substring(0, 47) + '...' : p.text),
          entities: resolvedEntities,
          entity: resolvedEntities?.[0], // backward compat
          type: isSpeech ? 'text-to-speech' : undefined,
          voice_name: isSpeech ? (orchestrateMeta?.voiceName || scenarioSource?.voiceName || 'Kore') : undefined,
          ...(p.position && !resolvedEntities?.length ? { position: p.position } : {}),
          ...(!isBackground && p.metadata?.timestamps?.length ? { timestamps: p.metadata.timestamps } : {}),
          ...(p.metadata?.category ? { category: p.metadata.category } : {}),
          ...(parentUsageIndex !== undefined ? { parentUsageOriginalIndex: parentUsageIndex } : {}),
          ...(orchestrateMeta ? {
            orchestrateMeta: {
              orchestrateId: orchestrateMeta.orchestrateId,
              entryId: orchestrateMeta.entryId,
              trigger: orchestrateMeta.trigger,
              variants: orchestrateMeta.variants,
              allObjectIds: orchestrateMeta.allObjectIds,
              speechLines: orchestrateMeta.speechLines,
              isSpeech: orchestrateMeta.isSpeech,
              voiceName: orchestrateMeta.voiceName,
              timestamps: orchestrateMeta.timestamps,
            },
          } : {}),
          ...(scenarioSource ? { scenarioSource } : {}),
        };
        return config;
      });

      console.log('[Analysis→SoundGen] Converted configs with metadata:', 
        newConfigs.map(c => ({ prompt: c.prompt.substring(0, 30), duration: c.duration, dbfs: c.dbfs, interval_seconds: c.interval_seconds, hasEntities: !!c.entities?.length })));

      // Add to sound generation
      soundGen.setSoundConfigsFromPrompts(newConfigs);

      // Scenario-derived cards default the "orchestrate sounds" toggle ON, so a
      // freshly-created scenario sound section orchestrates on its first generate.
      if (newConfigs.some((c) => c.scenarioSource)) {
        soundGen.setOrchestrateSoundsEnabled(true);
      }
      
      // Set up orchestrate iteration links and initial schedule bake
      const hasOrchestrateMeta = newConfigs.some(c => c.orchestrateMeta);
      if (hasOrchestrateMeta) {
        const audioStore = useAudioControlsStore.getState();
        audioStore.syncSoundConfigs(newConfigs);
        audioStore.setOrchestrateIterationLinks(newConfigs);
        audioStore.bakeOrchestrateSchedule();
      }
      
      // Advance to Sounds step in sidebar
      setStepAdvanceTrigger(t => t + 1);

      console.log(`Loaded ${newConfigs.length} prompts from analysis to sound generation`);
    }, parentUsageIndex);
  }, [analysis, soundGen]);

  // Handler: Add analysis config with global model inheritance
  const handleAddAnalysisConfig = useCallback((type: import('@/types/card').CardType) => {
    // For model-analysis configs, pass globalSpeckleData so a new card inherits the loaded model
    if (type === 'model-analysis' && globalSpeckleData) {
      analysis.handleAddConfig(type, globalSpeckleData);
    } else {
      analysis.handleAddConfig(type);
    }
  }, [analysis, globalSpeckleData]);

  // Handler: Analyze sound events when audio file is uploaded
  const handleAnalyzeSoundEvents = useCallback(async () => {
    if (!fileUpload.audioFile) return;

    try {
      // Use numSounds from text generation settings
      await sed.analyzeSoundEvents(fileUpload.audioFile, DEFAULT_NUM_SOUNDS);
      console.log('✓ Sound event analysis complete');
    } catch (error) {
      console.error('Failed to analyze sound events:', error);
    }
  }, [fileUpload.audioFile, sed]);

  // Handler: Load detected sounds to sound generation tab
  const handleLoadSoundsFromSED = useCallback(() => {
    // Format SED results as sound configs
    const newConfigs = sed.formatForSoundGeneration(soundGen.globalSteps);

    // Add the sound configs (appends to existing configs)
    soundGen.setSoundConfigsFromPrompts(newConfigs);

    // Advance to Sounds step in sidebar
    setStepAdvanceTrigger(t => t + 1);

    console.log(`Loaded ${newConfigs.length} sounds from SED analysis`);
  }, [sed, soundGen]);

  // ============================================================================
  // Home stage → model transition
  // ============================================================================
  type SpeckleModelSelectPayload = {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
    display_name?: string;
  };

  interface HomeElementsSnapshot {
    configs: SoundGenerationConfig[];
    events: SoundEvent[];
    receivers: ReturnType<typeof useReceiversStore.getState>['receivers'];
    gridListeners: ReturnType<typeof useGridListenersStore.getState>['gridListeners'];
  }

  // Pending model switch awaiting the user's import / start-fresh choice.
  const [pendingModelSwitch, setPendingModelSwitch] = useState<{
    speckleData: SpeckleModelSelectPayload;
    home: HomeElementsSnapshot;
    isUpload: boolean;
  } | null>(null);
  const [isApplyingModelSwitch, setIsApplyingModelSwitch] = useState(false);

  /** The bundled Sample card is the Home default — it is not "work to import". */
  const isDefaultSampleConfig = (c: SoundGenerationConfig) =>
    c.type === 'sample-audio' && c.display_name === 'Sample';

  /** The two deterministic placeholder cards created on every fresh Home stage. */
  const isSeedPlaceholderAnalysis = (c: AnalysisConfig) =>
    c.type === 'freeform' &&
    (c.display_name === SANDBOX_CONTEXT_NAME || c.display_name === SANDBOX_USAGE_NAME);

  /** Snapshot the importable Home elements (excludes the default Sample). */
  const captureHomeElements = (): HomeElementsSnapshot => {
    const sc = useSoundscapeStore.getState();
    return {
      configs: sc.soundConfigs.filter((c) => !isDefaultSampleConfig(c)),
      events: (sc.generatedSounds ?? []).filter((e: { pinned?: boolean }) => !e.pinned) as SoundEvent[],
      receivers: [...useReceiversStore.getState().receivers],
      gridListeners: [...useGridListenersStore.getState().gridListeners],
    };
  };

  /**
   * True when the Home stage holds something worth importing — i.e. anything
   * beyond the deterministic seed (Sample card + placeholder context/usage).
   */
  const homeHasImportableWork = (): boolean => {
    const home = captureHomeElements();
    const hasNonSeedAnalysis = useAnalysisStore
      .getState()
      .analysisConfigs.some((c) => !isSeedPlaceholderAnalysis(c));
    return (
      home.configs.length > 0 ||
      home.events.length > 0 ||
      home.receivers.length > 0 ||
      home.gridListeners.length > 0 ||
      useAcousticsSimulationStore.getState().simulationConfigs.length > 0 ||
      hasNonSeedAnalysis
    );
  };

  /** Empty every domain store so a model opens without the Home elements. */
  const resetDomainForFreshModel = () => {
    useSoundscapeStore.getState().restoreSoundscape([], [], {});
    useReceiversStore.getState().clearReceivers();
    useGridListenersStore.getState().restoreGridListeners([]);
    useAcousticsSimulationStore.getState().restoreSimulationState([], null);
    useAnalysisStore.getState().restoreAnalysisState({
      analysisConfigs: [],
      analysisResults: [],
      activeTab: 0,
    });
    const audio = useAudioControlsStore.getState();
    audio.stopAll();
    audio.restoreVolumes({});
    audio.restoreSoundTimestamps({});
    audio.restoreIterationLinks({});
    audio.restoreExclusions({}, {});
    audio.restoreMuteSolo([], null);
    useAcousticLayerStore.getState().clearAcousticLayer();
  };

  /**
   * Append the captured Home elements onto whatever the model now holds.
   * Sounds/configs are offset + re-keyed so they never collide with the model's
   * saved entries. Simulations/analysis are intentionally not imported.
   */
  const mergeHomeElements = (home: HomeElementsSnapshot) => {
    const sc = useSoundscapeStore.getState();
    const offset = sc.soundConfigs.length;
    const baseEvents = (sc.soundscapeData ?? []) as SoundEvent[];

    const remappedConfigs = home.configs.map((c) => ({
      ...c,
      // Home nesting (context/usage parents) does not exist in this model.
      parentUsageOriginalIndex: undefined,
    }));
    const remappedEvents = home.events.map((e) => ({
      ...e,
      id: `imported_${e.id}`,
      prompt_index: (e.prompt_index ?? 0) + offset,
    }));
    const mergedEvents = [...baseEvents, ...remappedEvents];
    useSoundscapeStore.setState({
      soundConfigs: [...sc.soundConfigs, ...remappedConfigs],
      generatedSounds: mergedEvents,
      soundscapeData: mergedEvents.length > 0 ? mergedEvents : null,
    });

    if (home.receivers.length > 0) {
      const rc = useReceiversStore.getState();
      rc.restoreReceivers([...rc.receivers, ...home.receivers], rc.selectedReceiverId);
    }
    if (home.gridListeners.length > 0) {
      const gl = useGridListenersStore.getState();
      gl.restoreGridListeners([...gl.gridListeners, ...home.gridListeners]);
    }
    // Show every imported sound (ungrouped) rather than filtering to the model's
    // first usage chain, which would hide them.
    useUIStore.getState().setActiveSoundParentIndex(null);
  };

  // Handler: Upload model file from right sidebar (direct Speckle upload, bypasses useAnalysis)
  const handleRightSidebarModelUpload = useCallback(async (file: File) => {
    console.log('[page.tsx] Model file dropped in right sidebar:', file.name);

    if (isUploadingGlobalModel) {
      console.log('[page.tsx] Global upload already in progress');
      return;
    }

    setIsUploadingGlobalModel(true);

    try {
      // Upload directly to backend for Speckle conversion
      const uploadResponse = await apiService.uploadFile(file);

      // Extract speckle data from response
      // (`apiService.uploadFile` already waited for Speckle ingestion, so version_id
      // / object_id are resolved by the time we get here.)
      const speckleData = 'speckle' in uploadResponse ? uploadResponse.speckle : undefined;

      if (speckleData) {
        console.log('[page.tsx] Model uploaded to Speckle:', speckleData.url);
        setGlobalModelFile(file);
        // Route through the shared select flow so the Home import prompt applies.
        await handleSpeckleModelSelect(speckleData, true);
      } else {
        console.warn('[page.tsx] No Speckle data in upload response');
        setGlobalModelFile(null);
      }
    } catch (error) {
      console.error('[page.tsx] Failed to upload model:', error);
      handleApiError(error, 'Failed to upload model');
      setGlobalModelFile(null);
    } finally {
      setIsUploadingGlobalModel(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUploadingGlobalModel, handleApiError]);

  // Load an existing Speckle model directly (no upload needed)
  const handleSpeckleModelSelect = useCallback(async (speckleData: SpeckleModelSelectPayload, isUpload = false) => {
    console.log('[page.tsx] Speckle model selected:', speckleData.url);
    // Home stage: if there is work worth keeping, ask the user before switching.
    if (homeHasImportableWork()) {
      setPendingModelSwitch({ speckleData, home: captureHomeElements(), isUpload });
      return;
    }
    // Opening a model from the Home page frames its bounding box on load -
    // do NOT restore a camera POV saved for a previously-loaded model.
    _fitCameraToBoundingBoxOnLoad = true;
    // Opening a model always starts with the floating panels reduced.
    collapseFloatingPanels();
    setGlobalSpeckleData(speckleData);
    setSpeckleModelUrl(speckleData.url);
    // A Speckle model is now the active project.
    useUIStore.getState().setHomeProject(null);
    if (speckleData.display_name) {
      setModelFileName(speckleData.display_name);
    }

    // Persist model_id in URL so a page refresh can restore this session
    router.replace(`/?model_id=${encodeURIComponent(speckleData.model_id)}`, { scroll: false });

    // Seed-aware: the deterministic Home stage (placeholder context/usage + the
    // bundled Sample card) is NOT "work" — it must never be kept in place of the
    // model's saved soundscape. Genuine Home work already short-circuited above
    // via `homeHasImportableWork()`, so reaching here means only the seed remains.
    // (Raw store counts would wrongly count the seed, leaving the Home sample
    // scene loaded instead of the saved soundscape.)
    const sandboxHasWork = homeHasImportableWork();

    // Auto-load saved soundscape for this model unless the sandbox already has work
    try {
      if (sandboxHasWork) {
        console.log('[page.tsx] Keeping in-memory sandbox work after Speckle model load');
        lastSaveSourceRef.current = 'autosave';
        void saveSoundscapeRef.current?.();
        return;
      }
      const loadResponse = await apiService.loadSoundscapeFromSpeckle(speckleData.model_id, useWorkspaceStore.getState().workspace?.id);
      if (loadResponse.requires_invite) {
        notifyError(
          'This project belongs to a private workspace. Ask a member for an invite link to collaborate.',
          'warning',
        );
      }
      if (loadResponse.found && loadResponse.soundscape_data) {
        console.log('[page.tsx] Restoring saved soundscape:', loadResponse.soundscape_data);
        const audioBaseUrl = `${API_BASE_URL}${loadResponse.audio_base_url}`;
        // IR base URL is kept as a relative path (e.g. "/soundscapes/{model_id}/ir_files")
        // because AudioOrchestrator prepends the host when fetching IR files
        const irBaseUrl = loadResponse.ir_base_url || undefined;
        const restored = restoreSoundscapeState(loadResponse.soundscape_data, audioBaseUrl, irBaseUrl);
        if (loadResponse.missing_audio_filenames?.length) {
          notifyError(
            `${loadResponse.missing_audio_filenames.length} saved sound file(s) could not be found on the server and were skipped.`,
            'warning',
          );
        }

        // We restore the exact baked timestamps + iteration links below, so suppress the
        // one-shot auto-rebake that the generatedSounds change would otherwise trigger.
        // Only arm it when there are events to restore, so the bake effect is guaranteed
        // to run (and consume the flag) instead of leaving it armed for a later generation.
        if (restored.soundEvents.length > 0) {
          suppressOrchestrateBakeRef.current = true;
        }

        // Atomically restore all soundscape state (configs + events + settings)
        soundGen.restoreSoundscape(
          restored.soundConfigs,
          restored.soundEvents,
          {
            duration: restored.globalSettings.duration,
            steps: restored.globalSettings.steps,
            negativePrompt: restored.globalSettings.negativePrompt,
            audioModel: restored.globalSettings.audioModel,
            ttsModel: restored.globalSettings.ttsModel,
            orchestrateSoundsEnabled: restored.globalSettings.orchestrateSoundsEnabled,
          }
        );

        // sample-audio cards lost their (blob) clip on refresh — reload the bundled sample.
        void soundGen.rehydrateSampleAudioConfigs();

        // Restore user-adjusted volume values
        useAudioControlsStore.getState().restoreVolumes(restored.soundVolumes);

        // Restore stored per-track schedules. Only baked/edited tracks have an
        // entry — the rest stay "auto" and re-derive a default loop from
        // interval_seconds.
        useAudioControlsStore.getState().restoreSoundTimestamps(restored.soundTimestamps);
        console.log('[DEBUG-LOAD] after restoreSoundTimestamps:');
        console.log('[DEBUG-LOAD]   timestamps keys:', Object.keys(useAudioControlsStore.getState().soundTimestamps));

        // Extend timeline duration to accommodate all restored timestamps
        // (bakeOrchestrateSchedule is suppressed during load, so auto-extend
        //  doesn't fire — we must do it here so iterations beyond the default
        //  60 s are not filtered out by extractTimelineSoundsFromData.)
        let maxEndSec = 0;
        for (const timestamps of Object.values(restored.soundTimestamps)) {
          for (const ts of timestamps) {
            maxEndSec = Math.max(maxEndSec, ts + 10); // 10 s default per-sound duration
          }
        }
        if (maxEndSec > 0) {
          const audioDurMs = Math.ceil((maxEndSec + 10) / 30) * 30 * 1000;
          const currentDurMs = useAudioControlsStore.getState().timelineDurationMs;
          console.log('[page:load] timeline — maxEndSec:', maxEndSec.toFixed(1),
            'computedDurMs:', audioDurMs, 'currentDurMs:', currentDurMs);
          if (audioDurMs > currentDurMs) {
            useAudioControlsStore.getState().setTimelineDurationMs(audioDurMs);
            console.log('[page:load] extended timeline from', currentDurMs, 'to', audioDurMs);
          }
        }

        // Restore the parametric per-iteration variant/entity links between sounds.
        useAudioControlsStore.getState().restoreIterationLinks(
          restored.iterationLinks,
        );

        // Restore DAW mute/solo states
        useAudioControlsStore.getState().restoreMuteSolo(
          restored.mutedSounds,
          restored.soloedSound,
        );

        // Restore persisted solver exclusions (marks in the DAW timeline).
        useAudioControlsStore.getState().restoreExclusions(
          restored.excludedIterations,
          restored.exclusionReasons,
        );

        console.log('[DEBUG-LOAD] after restoreIterationLinks + restoreMuteSolo:');
        const postLinks = useAudioControlsStore.getState().iterationLinks;
        console.log('[DEBUG-LOAD]   iterationLinks keys:', Object.keys(postLinks).length);
        for (const [k, v] of Object.entries(postLinks)) {
          console.log(`[DEBUG-LOAD]   link[${k}] = ${JSON.stringify(v)}`);
        }
        console.log('[DEBUG-LOAD]   mutedSounds:', [...useAudioControlsStore.getState().mutedSounds]);
        console.log('[DEBUG-LOAD]   soloedSound:', useAudioControlsStore.getState().soloedSound);

        // Restore receivers
        if (restored.receivers.length > 0) {
          receivers.restoreReceivers(restored.receivers, restored.selectedReceiverId);
          console.log(`[page.tsx] Restored ${restored.receivers.length} receivers`);
        }

        // Restore grid listeners
        if (restored.gridListeners.length > 0) {
          gridListeners.restoreGridListeners(restored.gridListeners);
          console.log(`[page.tsx] Restored ${restored.gridListeners.length} grid listeners`);
        }

        // Restore simulation state
        if (restored.simulationConfigs.length > 0) {
          // Seed pyroom persistent states BEFORE restoring configs
          // so that when hooks mount they find the correct saved state
          restored.simulationConfigs.forEach(config => {
            if (config.type === 'pyroomacoustics' && config.simulationInstanceId) {
              const pyConfig = config as any;
              usePyroomAcousticsStore.getState().seedInstance(config.simulationInstanceId, {
                simulationSettings: pyConfig.settings,
                simulationResults: pyConfig.simulationResults,
                currentSimulationId: pyConfig.currentSimulationId,
                importedIRIds: pyConfig.importedIRIds,
                sourceReceiverIRMapping: pyConfig.sourceReceiverIRMapping,
                irImported: !!(pyConfig.importedIRIds?.length),
              });
            }
          });

          acousticsSimulation.restoreSimulationState(
            restored.simulationConfigs,
            restored.activeSimulationIndex,
          );
          console.log(
            `[page.tsx] Restored ${restored.simulationConfigs.length} simulations, ` +
            `active index: ${restored.activeSimulationIndex}`
          );
        }

        // Restore resonance audio config (room materials, dimensions, ambisonic order)
        if (restored.resonanceAudioConfig) {
          const rac = restored.resonanceAudioConfig;
          useRoomMaterialsStore.getState().updateRoomMaterials(rac.roomMaterials);
          useRoomMaterialsStore.getState().updateRoomDimensions(rac.roomDimensions);
          if (rac.ambisonicOrder) {
            await audioOrchestrator.setAmbisonicOrder(rac.ambisonicOrder as 1 | 2 | 3);
          }
          if (rac.enabled) {
            audioOrchestrator.setNoIRPreference('resonance');
          }
          console.log('[page.tsx] Restored resonance audio config');
        }

        console.log(
          `[page.tsx] Restored ${restored.soundConfigs.length} configs, ` +
          `${restored.soundEvents.length} events`
        );

        // Restore analysis state (cards, results)
        if (loadResponse.soundscape_data.analysis_state) {
          const analysisRestored = restoreAnalysisState(loadResponse.soundscape_data.analysis_state);
          console.log('[DEBUG-LOAD-ANALYSIS] restored configs:', analysisRestored.analysisConfigs.length,
            'results:', analysisRestored.analysisResults.length,
            'parentIndices:', analysisRestored.soundConfigParentIndices.size,
            'cardFlow:', analysisRestored.cardFlowState ? `${analysisRestored.cardFlowState.contextAdvanced.length}c/${analysisRestored.cardFlowState.usageAdvanced.length}u ctx→use:${Object.keys(analysisRestored.cardFlowState.contextToUsage).length} use→snd:${Object.keys(analysisRestored.cardFlowState.usageToSound).length}` : 'null');
          analysis.restoreAnalysisState({
            analysisConfigs: analysisRestored.analysisConfigs,
            analysisResults: analysisRestored.analysisResults,
            activeTab: analysisRestored.activeTab,
          });
          useAreaDrawingStore.getState().hydrateFromConfigs(analysisRestored.analysisConfigs);
          // Rebuild persisted audio-context source Files so the SED waveform/results
          // render after a model reload (the original File object is not JSON-serializable).
          analysis.rehydrateAudioContextSources(audioBaseUrl);
          // Rebuild parentUsageOriginalIndex on sound configs from hierarchical save data
          if (analysisRestored.soundConfigParentIndices.size > 0) {
            const storeState = useSoundscapeStore.getState();
            const configs = storeState.soundConfigs.map((c, i) => {
              const parent = analysisRestored.soundConfigParentIndices.get(i);
              return parent !== undefined ? { ...c, parentUsageOriginalIndex: parent } as typeof c : c;
            });
            useSoundscapeStore.setState({ soundConfigs: configs });
          }
          // Restore breadcrumb navigation state and auto-navigate to the first
          // context→usage→sounds chain so only relevant child cards are shown.
          if (analysisRestored.cardFlowState) {
            const cf = analysisRestored.cardFlowState;
            useCardFlowStore.setState({
              contextAdvanced: new Set(cf.contextAdvanced),
              usageAdvanced: new Set(cf.usageAdvanced),
              contextToUsageMap: new Map(Object.entries(cf.contextToUsage).map(([k, v]) => [Number(k), v])),
              usageToSoundMap: new Map(Object.entries(cf.usageToSound).map(([k, v]) => [Number(k), v])),
            });
            // Find the first usage card that has child sounds and pre-set it
            // as the active sound parent so the sidebar filters to only its children.
            // usageAdvanced holds usage card indices, which match parentUsageOriginalIndex
            // on sound configs (contextAdvanced holds context card indices, which don't match).
            if (cf.usageAdvanced.length > 0) {
              useUIStore.getState().setActiveSoundParentIndex(cf.usageAdvanced[0]);
            }
            // Auto-advance to Sounds step — sidebar will pick up activeSoundParentIndex
            setStepAdvanceTrigger(t => t + 1);
          }
          console.log(`[page.tsx] Restored analysis state: ${analysisRestored.analysisConfigs.length} cards, active tab ${analysisRestored.activeTab}`);
        }
      }
    } catch (err) {
      console.warn('[page.tsx] Failed to auto-load soundscape:', err);
    }
  }, [
    soundGen.restoreSoundscape,
    receivers.restoreReceivers,
    acousticsSimulation.restoreSimulationState,
    analysis.restoreAnalysisState,
    audioOrchestrator.setAmbisonicOrder,
    audioOrchestrator.setNoIRPreference,
  ]);

  // Resolve the Home import prompt: import / start fresh / cancel.
  const handleImportDecision = useCallback(async (choice: 'import' | 'fresh' | 'cancel') => {
    const pending = pendingModelSwitch;
    if (!pending) return;
    if (choice === 'cancel') {
      setPendingModelSwitch(null);
      return;
    }
    setIsApplyingModelSwitch(true);
    setPendingModelSwitch(null);
    try {
      if (choice === 'import') {
        // Persist the Home stage first so nothing is lost, then load the model
        // base and append the Home elements on top.
        lastSaveSourceRef.current = 'autosave';
        await saveSoundscapeRef.current?.();
        const home = pending.home;
        resetDomainForFreshModel();
        await handleSpeckleModelSelect(pending.speckleData, pending.isUpload);
        mergeHomeElements(home);
        lastSaveSourceRef.current = 'autosave';
        saveSoundscapeRef.current?.();
      } else {
        resetDomainForFreshModel();
        await handleSpeckleModelSelect(pending.speckleData, pending.isUpload);
      }
    } finally {
      setIsApplyingModelSwitch(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingModelSwitch, handleSpeckleModelSelect]);

  // Memoized resonance audio config (used by save/restore, derived from multiple stores)
  const resonanceAudioConfig = useMemo(() => ({
    enabled: audioOrchestrator.status?.currentMode === 'no_ir_resonance',
    ambisonicOrder: audioOrchestrator.status?.ambisonicOrder || 1,
    roomDimensions: roomMaterials.roomDimensions,
    roomMaterials: roomMaterials.roomMaterials,
  }), [
    audioOrchestrator.status?.currentMode,
    audioOrchestrator.status?.ambisonicOrder,
    roomMaterials.roomDimensions,
    roomMaterials.roomMaterials,
  ]);

  // Save current soundscape state to Speckle + local storage
  const handleSaveSoundscape = useCallback(async (overrides?: { modelId?: string; modelName?: string }) => {
    const uiState = useUIStore.getState();
    const activeHomeProject = uiState.homeProject;
    // A loaded Speckle model always wins; the No-model project only applies when
    // no model is open.
    const overrideModelId =
      overrides?.modelId ?? (uiState.globalSpeckleData ? undefined : activeHomeProject?.modelId);
    // Nothing to save on the fresh Home sandbox (no model, no No-model project).
    if (!overrideModelId && !uiState.globalSpeckleData) return;
    const saveSource = lastSaveSourceRef.current;
    lastSaveSourceRef.current = 'manual';
    // Save camera POV alongside every soundscape save
    saveCameraToStore();
    const modelId = overrideModelId ?? globalSpeckleData?.model_id ?? SANDBOX_MODEL_ID;
    const modelName =
      overrides?.modelName ??
      (uiState.globalSpeckleData ? modelId : activeHomeProject?.name ?? modelId);
    if (isSavingSoundscape) return;
    setIsSavingSoundscape(true);
    try {
      // 1. Upload blob-URL audio files (library/uploaded sounds) to the server
      const blobSounds = getBlobUrlSounds(soundGen.soundscapeData ?? []);
      const uploadedFilenames: Record<string, string> = {};

      if (blobSounds.length > 0) {
        console.log(`[page.tsx] Uploading ${blobSounds.length} blob audio file(s) to server...`);
        const uploadPromises = blobSounds.map(async (event) => {
          try {
            const response = await fetch(event.url);
            const blob = await response.blob();
            const result = await apiService.uploadSoundscapeAudio(modelId, event.id, blob);
            uploadedFilenames[event.id] = result.filename;
            console.log(`[page.tsx] Uploaded blob audio: ${event.display_name} -> ${result.filename}`);
          } catch (err) {
            console.warn(`[page.tsx] Failed to upload blob audio for ${event.id}:`, err);
          }
        });
        await Promise.all(uploadPromises);
      }

      // 2. Persist audio-context source files that don't have a persisted copy yet, so the
      // SED waveform + detected-sounds results can be rebuilt after a refresh. This covers
      // cards whose audio was loaded before persistence existed and never re-saved.
      const liveAnalysis = useAnalysisStore.getState();
      for (let i = 0; i < liveAnalysis.analysisConfigs.length; i++) {
        const cfg = liveAnalysis.analysisConfigs[i] as AudioAnalysisConfig;
        if (cfg?.type !== 'audio' || !cfg.audioFile || cfg.persistedAudioFilename) continue;
        try {
          const { filename } = await apiService.uploadSoundscapeAudio(
            modelId,
            `ctx-audio-${i}-${Date.now()}`,
            cfg.audioFile,
          );
          useAnalysisStore
            .getState()
            .handleUpdateConfig(i, { persistedAudioFilename: filename } as Partial<AnalysisConfig>);
        } catch (err) {
          console.warn(`[page:save] Failed to persist audio context source for config ${i}:`, err);
        }
      }

      // Build analysis state (serialize cards, results, pending configs) — read the live
      // store so the just-persisted audio filenames are included in this save.
      const cardFlowState = useCardFlowStore.getState();
      const saveAnalysisState = useAnalysisStore.getState();
      const analysisStateData = buildAnalysisStateSave(
        saveAnalysisState.analysisConfigs,
        saveAnalysisState.analysisResults,
        saveAnalysisState.activeAnalysisTab,
        soundGen.soundConfigs.map(c => ({ parentUsageOriginalIndex: (c as any).parentUsageOriginalIndex })),
        {
          contextAdvanced: [...cardFlowState.contextAdvanced],
          usageAdvanced: [...cardFlowState.usageAdvanced],
          contextToUsage: Object.fromEntries(cardFlowState.contextToUsageMap),
          usageToSound: Object.fromEntries(cardFlowState.usageToSoundMap),
        },
      );

      // 3. Build save payload (with server filenames for blob sounds + simulation state)
      const saveTimestamps = useAudioControlsStore.getState().soundTimestamps;
      console.log('[page:save] saving soundTimestamps, keys:', Object.keys(saveTimestamps).length,
        'entries:', Object.entries(saveTimestamps).map(([k, v]) => `${k}:${v?.length ?? 0}ts`).join(' '));
      const saveLinks = useAudioControlsStore.getState().iterationLinks;
      const saveMuted = [...useAudioControlsStore.getState().mutedSounds];
      const saveSoloed = useAudioControlsStore.getState().soloedSound;
      console.log('[DEBUG-SAVE] === save payload debug ===');
      console.log('[DEBUG-SAVE] mutedSounds:', JSON.stringify(saveMuted));
      console.log('[DEBUG-SAVE] soloedSound:', JSON.stringify(saveSoloed));
      console.log('[DEBUG-SAVE] soundTimestamps keys:', Object.keys(saveTimestamps));
      console.log('[DEBUG-SAVE] iterationLinks:', JSON.stringify(Object.keys(saveLinks)));
      for (const [k, v] of Object.entries(saveLinks)) {
        console.log(`[DEBUG-SAVE]   link[${k}] =`, JSON.stringify(v));
      }
      console.log('[DEBUG-SAVE] soundscapeData (events) count:', soundGen.soundscapeData?.length ?? 0);
      if (soundGen.soundscapeData) {
        for (const ev of soundGen.soundscapeData.slice(0, 5)) {
          console.log(`[DEBUG-SAVE]   event id=${ev.id} promptIdx=${ev.prompt_index} category=${(ev as any).category} copy_index=${(ev as any).copy_index}`);
        }
      }
      console.log('[DEBUG-SAVE] soundConfigs count:', soundGen.soundConfigs.length);
      for (const c of soundGen.soundConfigs) {
        console.log(`[DEBUG-SAVE]   config prompt="${(c as any).prompt}" category="${(c as any).category}" type="${(c as any).type}"`);
      }
      const payload = buildSoundscapeSavePayload(
        modelId,
        modelName,
        soundGen.soundConfigs,
        soundGen.soundscapeData ?? [],
        {
          duration: soundGen.globalDuration,
          steps: soundGen.globalSteps,
          negativePrompt: soundGen.globalNegativePrompt,
          audioModel: soundGen.audioModel,
          ttsModel: soundGen.ttsModel,
          orchestrateSoundsEnabled: soundGen.orchestrateSoundsEnabled,
        },
        useAudioControlsStore.getState().soundVolumes,
        uploadedFilenames,
        receivers.receivers,
        gridListeners.gridListeners,
        receivers.selectedReceiverId,
        acousticsSimulation.simulationConfigs,
        acousticsSimulation.activeSimulationIndex,
        resonanceAudioConfig,
        useAudioControlsStore.getState().soundTimestamps,
        useAudioControlsStore.getState().iterationLinks,
        [...useAudioControlsStore.getState().mutedSounds],
        useAudioControlsStore.getState().soloedSound,
        useAudioControlsStore.getState().excludedIterations,
        useAudioControlsStore.getState().exclusionReasons,
      );

      // Embed analysis state in the soundscape data
      payload.soundscape_data.analysis_state = analysisStateData.analysis_state;

      // Persist project_id and version_id so the URL bootstrap can reconstruct the viewer
      if (globalSpeckleData?.url) {
        const urlMatch = globalSpeckleData.url.match(/\/projects\/([^/]+)\/models\/([^/@]+)(?:@([^/?]+))?/);
        if (urlMatch) {
          payload.soundscape_data.project_id = urlMatch[1] || '';
          payload.soundscape_data.version_id = globalSpeckleData.version_id || urlMatch[3] || '';
        }
      }
      // Persist auth_token for non-public Speckle streams
      if (globalSpeckleData?.auth_token) {
        payload.soundscape_data.auth_token = globalSpeckleData.auth_token;
      }

      // Attach analysis/scenario IDs for backend file persistence
      payload.analysis_ids = analysisStateData.analysis_ids.length > 0 ? analysisStateData.analysis_ids : undefined;
      payload.scenario_ids = analysisStateData.scenario_ids.length > 0 ? analysisStateData.scenario_ids : undefined;

      // Optimistic-concurrency token for shared workspaces. The backend rejects
      // the save with 409 if another member has written since we last loaded.
      payload.base_revision = useWorkspaceStore.getState().revision;

      // 4. Save Soundscape
      lastSavePayloadRef.current = { modelId, savedAt: Date.now(), payload };
      const result = await apiService.saveSoundscapeToSpeckle(payload);
      if (typeof result.revision === 'number') {
        useWorkspaceStore.setState({ revision: result.revision });
      }
      console.log('[page.tsx] Soundscape saved:', result.message);
    } catch (err) {
      const conflictRevision = (err as { conflictRevision?: number }).conflictRevision;
      if (conflictRevision !== undefined) {
        useWorkspaceStore.setState({ conflictRevision });
        console.warn('[page.tsx] Save rejected (workspace changed); refreshing.', conflictRevision);
        notifyError(
          'This shared workspace changed while you were editing. Your changes were not saved \u2014 reload to get the latest version.',
          'warning',
          {
            label: 'Download my changes',
            onClick: () => {
              const snap = lastSavePayloadRef.current;
              if (!snap) return;
              const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `soundscape-unsaved-${snap.modelId}.json`;
              a.click();
              URL.revokeObjectURL(url);
            },
          },
        );
        void useWorkspaceStore.getState().refresh();
        return;
      }
      console.error('[page.tsx] Failed to save soundscape:', err);
      handleApiError(err, 'Failed to save soundscape');
    } finally {
      setIsSavingSoundscape(false);
    }
  }, [
    globalSpeckleData,
    soundGen.soundscapeData,
    soundGen.soundConfigs,
    soundGen.globalDuration,
    soundGen.globalSteps,
    soundGen.globalNegativePrompt,
    soundGen.audioModel,
    soundGen.ttsModel,
    receivers.receivers,
    receivers.selectedReceiverId,
    gridListeners.gridListeners,
    acousticsSimulation.simulationConfigs,
    acousticsSimulation.activeSimulationIndex,
    isSavingSoundscape,
    handleApiError,
    analysis.analysisConfigs,
    analysis.analysisResults,
    analysis.activeAnalysisTab,
    resonanceAudioConfig,
  ]);

  // Keep the autosave ref in sync with the latest save handler
  saveSoundscapeRef.current = handleSaveSoundscape;

  // Save the Home sandbox as a named local "Homepage project" (home-<slug>).
  const handleSaveHomeProject = useCallback(async (name: string) => {
    const slug =
      name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    const modelId = `home-${slug}`;
    setIsSavingHomeProject(true);
    try {
      await handleSaveSoundscape({ modelId, modelName: name });
      // The saved project becomes the active one → Home button + auto-save on.
      useUIStore.getState().setHomeProject({ modelId, name });
    } finally {
      setIsSavingHomeProject(false);
      setShowHomeProjectModal(false);
    }
  }, [handleSaveSoundscape]);

  // Reload a saved Homepage project onto the sandbox stage via the URL bootstrap.
  const handleOpenHomeProject = useCallback((modelId: string) => {
    setShowHomeProjectModal(false);
    window.location.href = `/?home=${encodeURIComponent(modelId)}`;
  }, []);

  // Wrapped file change handler to clear SED results and load audio info
  const handleFileChangeWithSEDClear = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    fileUpload.handleFileChange(e);

    // Only clear SED results if it's an audio file (to replace previous audio)
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check if it's an audio file by extension
      const isAudio = /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(selectedFile.name);
      if (isAudio) {
        sed.clearSEDResults();
        await sed.loadAudioInfo(selectedFile);
      }
    }
  }, [fileUpload, sed]);

  // Note: model upload for context cards is handled at load time (global Speckle data).

  // Handle sound deletion
  const handleDeleteSound = useCallback((soundId: string, promptIdx: number) => {
    if (!soundGen.soundscapeData) return;

    // Filter out all sounds with this prompt index
    const updatedSounds = soundGen.soundscapeData.filter(
      sound => (sound as any).prompt_index !== promptIdx
    );

    soundGen.setSoundscapeData(updatedSounds.length > 0 ? updatedSounds : null);
  }, [soundGen]);

  // Handle sound config removal — unlinks entity color before deleting the card
  const handleRemoveSoundConfig = useCallback((index: number) => {
    // Unlink all entities from Speckle filtering before removing the config
    const config = soundGen.soundConfigs[index];
    for (const ent of config?.entities || []) {
      const objectId = resolveEntityObjectId(ent);
      if (objectId) unlinkObjectFromSound(objectId);
    }
    soundGen.handleRemoveConfig(index);
  }, [soundGen.soundConfigs, soundGen.handleRemoveConfig, unlinkObjectFromSound, resolveEntityObjectId]);

  // Handle sound reset (remove generated sound but keep config)
  // Downgrades entity color from full pink → light pink
  const handleResetSound = useCallback((soundId: string, promptIndex: number) => {

    // Downgrade entity color from generated (full pink) to pending (light pink)
    const config = soundGen.soundConfigs[promptIndex];
    for (const ent of config?.entities || []) {
      const objectId = resolveEntityObjectId(ent);
      if (objectId) {
        // Re-link with hasGeneratedSound=false to downgrade color
        linkObjectToSound(objectId, promptIndex, false);
      }
    }

    // Filter out sounds with this prompt index using current state from store
    const currentSoundscapeData = useSoundscapeStore.getState().soundscapeData;
    if (currentSoundscapeData) {
      const updatedSounds = currentSoundscapeData.filter(
        (sound: any) => sound.prompt_index !== promptIndex
      );
      soundGen.setSoundscapeData(updatedSounds.length > 0 ? updatedSounds : null);
    }

    // Reset the sound config atomically (clears display_name, uploaded audio, library search, etc.)
    soundGen.handleResetSoundConfig(promptIndex);
  }, [soundGen.soundConfigs, soundGen.setSoundscapeData, soundGen.handleResetSoundConfig, linkObjectToSound, resolveEntityObjectId]);

  // Handle sound card selection from ThreeScene (sound sphere click)
  const handleSelectSoundCard = useCallback((promptIndex: number) => {
    // Expand the card in the left sidebar
    setSelectedCardIndex(promptIndex);

    // Expand the left sidebar and reveal the Sounds step so the clicked
    // sound's card is actually visible (the mounted Sidebar reacts to the
    // soundsNavTrigger, not to setIsLeftSidebarExpanded alone).
    setIsLeftSidebarExpanded(true);
    useUIStore.getState().triggerSoundsNav();

    // Set selectedEntity with objectType 'Sound' → triggers right sidebar expansion
    const sound = soundGen.generatedSounds.find(s => s.prompt_index === promptIndex);
    const soundName = sound?.display_name || sound?.prompt || `Sound #${promptIndex + 1}`;

    setSelectedEntity({
      objectId: `sound_prompt_${promptIndex}`,
      objectName: soundName,
      objectType: 'Sound',
      soundData: { promptIndex },
    });
  }, [soundGen.generatedSounds, setSelectedEntity]);

  // Entity linking handlers
  const handleStartLinkingEntity = useCallback((configIndex: number) => {
    setIsLinkingEntity(true);
    setLinkingConfigIndex(configIndex);
    delete preGenActiveEntityRef.current[configIndex];
    // Start with a clean slate — never commit a stale selection from a previous interaction.
    useSpeckleStore.getState().clearViewerSelection();
  }, []);

  const handleCancelLinkingEntity = useCallback(() => {
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
    useSpeckleStore.getState().clearViewerSelection();
  }, []);

  const handleFinishLinkingEntity = useCallback(() => {
    const configIndex = linkingConfigIndex;
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
    // Exit linking BEFORE reading the selection so the whole commit is one atomic
    // "Done" — the clicked selection already accumulated in selectedObjectIds.
    const selectedIds = useSpeckleStore.getState().selectedObjectIds;
    useSpeckleStore.getState().clearViewerSelection();
    if (configIndex === null || selectedIds.length === 0) return;

    // Resolve the selected Speckle ids → full sound entities (position/bounds from
    // the world tree), reusing the shared builder.
    let worldTree: any = null;
    try { worldTree = viewerRef.current?.getWorldTree() ?? null; } catch { /* ignore */ }

    const currentConfig = soundGen.soundConfigs[configIndex];
    const existingEntities: any[] = currentConfig?.entities || [];
    // Dedupe by stable identity (applicationId) AND current tree id, so clicking a
    // display mesh whose host is already linked does not create a duplicate.
    const existingIds = new Set<string>();
    existingEntities.forEach((e: any) => {
      if (e.applicationId) existingIds.add(e.applicationId);
      const current = resolveEntityObjectId(e);
      if (current) existingIds.add(current);
      if (e.nodeId) existingIds.add(e.nodeId);
      if (e.id) existingIds.add(e.id);
    });

    // Dedupe against already-linked entities, then append each new one.
    const newEntities: any[] = [];
    for (const id of selectedIds) {
      if (existingIds.has(id)) continue;
      const entity = worldTree
        ? buildEntityFromObjectId(worldTree, id, [...existingEntities, ...newEntities])
        : null;
      if (!entity) continue;
      const stableKey = entity.applicationId || entity.nodeId || entity.id;
      if (stableKey && existingIds.has(stableKey)) continue;
      if (stableKey) existingIds.add(stableKey);
      newEntities.push(entity);
    }
    if (newEntities.length === 0) return;

    // Append all new entities (first position unchanged → generated sound position stays).
    for (const entity of newEntities) {
      soundGen.handleAttachSoundToEntity(configIndex, entity, true);
    }
    // Link in Speckle context so object↔sound highlight + icon state update.
    for (const entity of newEntities) {
      const objectId = resolveEntityObjectId(entity);
      if (objectId) linkObjectToSound(objectId, configIndex);
    }
  }, [
    linkingConfigIndex,
    soundGen,
    linkObjectToSound,
    resolveEntityObjectId,
  ]);

  // Enter commits the multi-selection, Escape cancels (grid-listener behaviour).
  // Typing-sensitive: a focused prompt textarea must not trigger Enter-commit.
  useObjectSelectionPhase({
    active: isLinkingEntity && linkingConfigIndex !== null,
    hasConfirmedSelection: false,
    onCommit: () => { handleFinishLinkingEntity(); return true; },
    onEscape: () => handleCancelLinkingEntity(),
    ignoreTyping: true,
    deps: [handleFinishLinkingEntity, handleCancelLinkingEntity, linkingConfigIndex],
  });

  // Track pre-gen entity selections to preserve after generation
  const preGenActiveEntityRef = useRef<Record<number, number>>({});

  const handleSelectLinkedEntity = useCallback((configIndex: number, entityArrayIdx: number) => {
    const config = soundGen.soundConfigs[configIndex];
    if (!config?.entities || entityArrayIdx >= config.entities.length) return;
    const entity = config.entities[entityArrayIdx];
    if (!entity) return;
    const pos: [number, number, number] = entity.bounds?.center
      ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]]
      : entity.position && entity.position.length >= 3
        ? [entity.position[0], entity.position[1], entity.position[2]]
        : [0, 0, 0];
    const generatedSound = soundGen.generatedSounds.find(s =>
      s.prompt_index === configIndex ||
      (s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === configIndex)
    );
    if (generatedSound) {
      soundGen.selectLinkedEntity(generatedSound.id, entity.index ?? entityArrayIdx, pos);
    } else {
      soundGen.handleUpdateConfig(configIndex, 'position', pos);
      preGenActiveEntityRef.current[configIndex] = entityArrayIdx;
    }
  }, [soundGen]);

  const handleClearLinkedEntities = useCallback((configIndex: number) => {
    const config = soundGen.soundConfigs[configIndex];
    if (!config?.entities?.length) return;
    for (const ent of config.entities) {
      const objectId = resolveEntityObjectId(ent);
      if (objectId) unlinkObjectFromSound(objectId);
    }
    soundGen.handleDetachSoundFromEntity(configIndex);
    delete preGenActiveEntityRef.current[configIndex];
    // Also clear iteration links so link icons disappear from timeline
    const genSound = soundGen.generatedSounds.find(s =>
      s.prompt_index === configIndex ||
      (s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === configIndex)
    );
    if (genSound) {
      useAudioControlsStore.getState().clearAllIterationLinksForSound(genSound.id);
    }
  }, [soundGen, unlinkObjectFromSound, resolveEntityObjectId]);

  /**
   * Detach sound from entity and create sound sphere
   * Used from entity overlay link button when clicking green (linked) state
   */
  const handleDetachSound = useCallback((entity: any) => {
    // Find the config linked to this entity
    const configIndex = soundGen.soundConfigs.findIndex(config =>
      config.entities?.some((e: any) => e.index === entity.index)
    );

    if (configIndex === -1) {
      console.warn('[handleDetachSound] No sound config found for entity', entity.index);
      return;
    }

    // Unlink the entity from the sound config AND update soundscape data
    // This will create a sound sphere in ThreeScene
    soundGen.handleDetachSoundFromEntity(configIndex);
  }, [soundGen]);

  /**
   * Wrapper for handleUpdateConfig (kept for prop compatibility)
   */
  const handleUpdateSoundConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: any) => {
    soundGen.handleUpdateConfig(index, field, value);
  }, [soundGen]);

  /**
   * Handle selection of IR from server library
   * Downloads the IR and loads it into auralization AND audio orchestrator
   */
  const handleSelectIRFromLibrary = useCallback(async (irMetadata: any) => {
    try {
      // Build full URL (irMetadata.url is relative like "/static/impulse_responses/file.wav")
      const fullUrl = `${API_BASE_URL}${irMetadata.url}`;

      // Download the IR file from the server
      const response = await fetch(fullUrl);
      if (!response.ok) {
        throw new Error(`Failed to download IR: ${response.statusText}`);
      }

      const blob = await response.blob();
      const file = new File([blob], irMetadata.name, { type: 'audio/wav' });

      // Load into AudioOrchestrator (handles all IR processing)
      await audioOrchestrator.loadImpulseResponse(file);

      // Select the IR to activate it (triggers mode switch)
      await audioOrchestrator.selectImpulseResponse();

      // Update selected IR ID and store full metadata for reload
      setSelectedIRId(irMetadata.id);
      setSelectedIRMetadata(irMetadata);
    } catch (error) {
      console.error('[Auralization Page] Error loading IR from library:', error);
      throw error;
    }
  }, [audioOrchestrator]);

  /**
   * Handle IR imported from Choras simulation
   * Triggers a refresh of the IR library list
   */
  const handleIRImported = useCallback(() => {
    // Increment trigger to force ImpulseResponseUpload to reload its list
    triggerIRRefresh();
    console.log('[Page] IR imported from Choras simulation, triggering IR library refresh');
  }, []);

  /**
   * Clear/deselect the current IR (disable auralization)
   */
  const handleClearIR = useCallback(() => {
    audioOrchestrator.clearImpulseResponse();
    setSelectedIRId(null);
    setSelectedIRMetadata(null);
  }, [audioOrchestrator]);

  /**
   * Handle IR gain (linear peak-offset) changes from import-irs advanced settings.
   */
  const handleIRGainChange = useCallback((_index: number, gainOffset: number) => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator && typeof (orchestrator as any).setIRGain === 'function') {
      (orchestrator as any).setIRGain(gainOffset);
    }
  }, []);

  const handleIRNormalizeChange = useCallback((_index: number, enabled: boolean) => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator && typeof (orchestrator as any).setNormalize === 'function') {
      (orchestrator as any).setNormalize(enabled);
    }
  }, []);

  // Re-apply the active card's persisted IR gain/normalize whenever the active card
  // or its config changes — otherwise the values only take effect while dragging.
  //
  // The IR peak-offset gain is a GLOBAL control on the mode, but its value is
  // per-card. Applying a leftover import-irs offset (e.g. -0.87) to a pyroom/choras
  // IR with a different natural peak drives (peak + offset)/peak to <= 0, i.e. the
  // gain node mutes and the convolution goes silent. So always re-apply the ACTIVE
  // card's values, defaulting to 0/off when the card does not define them.
  useEffect(() => {
    const idx = acousticsSimulation.activeSimulationIndex;
    if (idx === null) return;
    const cfg = acousticsSimulation.simulationConfigs[idx] as {
      type?: string;
      irGain?: number;
      irNormalizeEnabled?: boolean;
    } | undefined;
    if (!cfg) return;
    const orchestrator = audioOrchestrator.orchestrator;
    if (!orchestrator) return;
    if (typeof (orchestrator as any).setNormalize === 'function') {
      (orchestrator as any).setNormalize(!!cfg.irNormalizeEnabled);
    }
    if (typeof (orchestrator as any).setIRGain === 'function') {
      (orchestrator as any).setIRGain(cfg.irGain ?? 0);
    }
  }, [audioOrchestrator.orchestrator, acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs]);

  /**
   * Toggle IR normalization
   */
  const handleToggleNormalize = useCallback((enabled: boolean) => {
    audioNormalization.toggleNormalize(enabled);
  }, [audioNormalization]);

  const handleResetAdvancedSettings = useCallback(() => {
    soundGen.handleResetToDefaults();
    audioNormalization.reset();
    setShowAxesHelper(false);
    setListenerOrientation({ ...DEFAULT_LISTENER_ORIENTATION });
    setShowLabelSprites(true);
    setShowHoveringHighlight(true);
    setShowSoundSpheres(true);
    setShowSceneListeners(true);
    useUIStore.getState().setShowScenarioParcours(false);
    setGlobalSoundSpeed(343);
    setGlobalMeshLc(1.5);
    const audio = useAudioControlsStore.getState();
    audio.resetGlobalBaseDbfs();
    audio.setTtsLanguage(TTS_DEFAULT_LANGUAGE);
    audio.resetTimelineDurationMs();
    audio.setMaximumFoleySounds(DEFAULT_MAXIMUM_FOLEY_SOUNDS);
    useUIStore.getState().setEnableAutoSave(true);
    setShowGroundGrid(false);
    setGroundGridSpacing(2);
    setGroundGridColor('');
    useUIStore.getState().setShowGroundGridLabels(true);
  }, [soundGen.handleResetToDefaults, audioNormalization.reset,
      setShowLabelSprites, setShowHoveringHighlight, setShowSoundSpheres, setShowSceneListeners,
      setGlobalSoundSpeed, setGlobalMeshLc,
      setShowGroundGrid, setGroundGridSpacing, setGroundGridColor]);

  const handleDeleteHistory = useCallback(async () => {
    // Fall back to the reserved sandbox id so Home-stage history can be deleted
    // too (autosave/stats already use this fallback).
    const modelId =
      useUIStore.getState().globalSpeckleData?.model_id ?? SANDBOX_MODEL_ID;
    if (!modelId) return;
    try {
      await apiService.deleteSoundscapeHistory(modelId);
    } catch {
      // proceed with reload even if API fails
    }
    // The acoustic region is persisted separately from the project soundscape —
    // reset it so a deleted project does not resurrect its assigned layers.
    useAcousticLayerStore.getState().clearAcousticLayer();
    try { localStorage.removeItem('compas-acoustic-layer'); } catch { /* ignore */ }
    window.location.reload();
  }, []);

  /**
   * Remove a simulation card, then delete the IRs it exclusively owned from the
   * backend library. Scoped to 'import-irs' cards and reference-counted against
   * the remaining configs so IRs still used elsewhere are never removed.
   * (Kept out of the store action, which is temporal/undoable.)
   */
  const handleRemoveSimulationConfig = useCallback((index: number) => {
    const store = useAcousticsSimulationStore.getState();
    const target = store.simulationConfigs[index];
    const ids = target && target.type === 'import-irs' ? collectSimulationIRIds(target) : new Set<string>();

    store.handleRemoveConfig(index);

    if (ids.size === 0) return;

    const stillReferenced = new Set<string>();
    for (const cfg of useAcousticsSimulationStore.getState().simulationConfigs) {
      for (const id of collectSimulationIRIds(cfg)) stillReferenced.add(id);
    }
    const toDelete = Array.from(ids).filter((id) => !stillReferenced.has(id));
    if (toDelete.length === 0) return;

    void Promise.allSettled(toDelete.map((id) => apiService.deleteImpulseResponse(id)))
      .then(() => triggerIRRefresh());
  }, [triggerIRRefresh]);

  // Handler: Material assignment selection (NEW)
  const handleSelectGeometry = useCallback((selection: SelectedGeometry | null) => {
    setSelectedGeometry(selection);
  }, []);

  // Handler: Geometry hover (NEW - for hover highlighting)
  const handleHoverGeometry = useCallback((selection: SelectedGeometry | null) => {
    setHoveredGeometry(selection);
  }, []);

  // Handler: Face selected in 3D scene (NEW)
  const handleFaceSelected = useCallback((faceIndex: number, entityIndex: number) => {
    console.log('[Page] handleFaceSelected called:', { faceIndex, entityIndex });
    if (faceIndex === -1) {
      // Deselected
      console.log('[Page] Deselecting face');
      handleSelectGeometry(null);
    } else if (faceIndex === -2) {
      // Special signal: select entity instead of face (for large entities)
      const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
      const layerId = entity?.layer || 'Default';

      const selection: SelectedGeometry = {
        type: 'entity',
        entityIndex,
        layerId
      };
      console.log('[Page] Setting selectedGeometry (entity):', selection);
      handleSelectGeometry(selection);
    } else {
      // Face selected - find the layer if applicable
      const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
      // Use 'Default' for entities without a layer (matches MaterialAssignmentUI grouping)
      const layerId = entity?.layer || 'Default';

      const selection: SelectedGeometry = {
        type: 'face',
        faceIndex,
        entityIndex,
        layerId
      };
      console.log('[Page] Setting selectedGeometry:', selection);
      handleSelectGeometry(selection);
    }
  }, [fileUpload.modelEntities, handleSelectGeometry]);

  // Handler: Material assignment (NEW)
  const [materialAssignments, setMaterialAssignments] = useState<Map<string, { selection: SelectedGeometry, material: AcousticMaterial | null }>>(new Map());

  const handleAssignMaterial = useCallback((selection: SelectedGeometry, material: AcousticMaterial | null) => {
    console.log('[Page] Material assigned:', { selection, material });

    // Store assignment with a unique key (legacy - kept for compatibility)
    const key = `${selection.type}-${selection.layerId ?? ''}-${selection.entityIndex ?? ''}-${selection.faceIndex ?? ''}`;
    setMaterialAssignments(prev => {
      const newMap = new Map(prev);
      newMap.set(key, { selection, material });
      return newMap;
    });

    // Update the active simulation's faceToMaterialMap for immediate 3D coloring
    if (acousticsSimulation.activeSimulationIndex !== null) {
      const activeConfig = acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex];

      if (activeConfig && (activeConfig as any).faceToMaterialMap) {
        const updatedMap = new Map((activeConfig as any).faceToMaterialMap);

        // Get the geometry data to find all faces affected by this assignment
        const geometryData = fileUpload.geometryData;

        // Strip prefix from material ID (choras_/pyroom_) to match backend format
        const materialId = material ? (
          material.id.startsWith('choras_') ? material.id.substring(7) :
          material.id.startsWith('pyroom_') ? material.id.substring(7) :
          material.id
        ) : null;

        if (selection.type === 'face' && selection.faceIndex !== undefined) {
          // Single face assignment
          if (materialId) {
            updatedMap.set(selection.faceIndex, materialId);
          } else {
            updatedMap.delete(selection.faceIndex);
          }
        } else if (selection.type === 'entity' && selection.entityIndex !== undefined && geometryData?.face_entity_map) {
          // Entity-level assignment: update all faces of this entity
          geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
            if (entityIndex === selection.entityIndex) {
              if (materialId) {
                updatedMap.set(faceIndex, materialId);
              } else {
                updatedMap.delete(faceIndex);
              }
            }
          });
        } else if (selection.type === 'layer' && selection.layerId && geometryData?.face_entity_map) {
          // Layer-level assignment: update all faces of entities in this layer
          geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
            const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
            if (entity && entity.layer === selection.layerId) {
              if (materialId) {
                updatedMap.set(faceIndex, materialId);
              } else {
                updatedMap.delete(faceIndex);
              }
            }
          });
        } else if (selection.type === 'global' && geometryData?.faces) {
          // Global assignment: update all faces
          if (materialId) {
            for (let i = 0; i < geometryData.faces.length; i++) {
              updatedMap.set(i, materialId);
            }
          } else {
            updatedMap.clear();
          }
        }

        // Update the simulation config with the new faceToMaterialMap
        acousticsSimulation.handleUpdateConfig(acousticsSimulation.activeSimulationIndex, {
          faceToMaterialMap: updatedMap
        } as any);

        console.log('[Page] Updated active simulation faceToMaterialMap:', {
          simulationIndex: acousticsSimulation.activeSimulationIndex,
          mapSize: updatedMap.size,
          selection,
          material: material?.name,
          materialId: materialId,
          originalId: material?.id
        });
      }
    }
  }, [acousticsSimulation, fileUpload.geometryData, fileUpload.modelEntities]);

  // Handler: Audio Rendering Mode Change (unified handler for all 3 modes)
  const handleAudioRenderingModeChange = useCallback(async (mode: AudioRenderingMode) => {
    // Playback is intentionally NOT stopped here: acoustic-rendering changes are
    // handed over seamlessly by the AudioOrchestrator graph-changed event, which
    // re-dispatches the Transport onto the new mode. Stopping was what made audio
    // cut out when expanding/collapsing cards or switching simulations.
    setAudioRenderingMode(mode);
    console.log('[Page] Audio rendering mode changed to:', mode);

    // When switching away from 'precise' mode, clear the loaded IR (but keep metadata for reload)
    if (mode !== 'precise' && audioOrchestrator.status?.isIRActive) {
      audioOrchestrator.clearImpulseResponse();
      // NOTE: We keep selectedIRId and selectedIRMetadata for reload when returning to precise mode
    }

    // Update AudioOrchestrator's no-IR preference (only for non-IR modes)
    if (mode === 'anechoic' || mode === 'resonance') {
      audioOrchestrator.setNoIRPreference(mode);
    }

    // When switching TO 'precise' mode with a previously selected IR, reload it
    if (mode === 'precise' && selectedIRMetadata && !audioOrchestrator.status?.isIRActive) {
      try {
        console.log('[Page] Reloading previously selected IR:', selectedIRMetadata.name);
        await handleSelectIRFromLibrary(selectedIRMetadata);
      } catch (error) {
        console.error('[Page] Failed to reload IR:', error);
      }
    }
  }, [audioOrchestrator, selectedIRMetadata, handleSelectIRFromLibrary]);

  // Handler: Update Output Decoder (Removed - binaural is default)
  const handleUpdateOutputDecoder = useCallback((decoder: 'binaural' | 'stereo') => {
    // REMOVED - Output decoder toggle removed from UI
    // Binaural (HRTF) is now the default and only option
    console.log('[Page] Output decoder changed to:', decoder, '(binaural-only now)');
  }, []);

  // Create compatibility config objects for components that still expect them
  const irState = audioOrchestrator.getIRState();
  const auralizationConfig = {
    enabled: audioOrchestrator.status?.isIRActive || false,
    impulseResponseUrl: null,
    impulseResponseBuffer: irState.buffer || null,
    impulseResponseFilename: irState.filename || null,
    normalize: audioNormalization.normalize
  };

  // Handler: Room materials update
  const handleUpdateRoomMaterials = useCallback((materials: any) => {
    roomMaterials.updateRoomMaterials(materials);
  }, [roomMaterials]);

  // Handler: Receiver Mode Change (from ThreeScene)
  const handleReceiverModeChange = useCallback((isActive: boolean, receiverId: string | null) => {
    const hasReceivers = receivers.receivers.length > 0;
    console.log('[Page] Receiver mode changed:', { isActive, receiverId, hasReceivers });
    audioOrchestrator.setReceiverMode(isActive, receiverId || undefined, hasReceivers);
  }, [audioOrchestrator, receivers.receivers.length]);

  // Exit go-to-listener / FPS mode and optionally collapse listener cards
  const exitGoToListenerMode = useCallback((collapseCards = true) => {
    setActiveIRGroupId(null);
    setIsFPSModeActive(false);
    setGoToReceiverId(null);
    setGoToPosition(null);
    setGoToPositionReceiverId(null);
    setExitFPSTrigger((t) => t + 1);
    setExpandedGridListenerId(null);
    if (collapseCards) setCollapseListenerCardTrigger((t) => t + 1);
    audioOrchestrator.setReceiverMode(false, undefined, receivers.receivers.length > 0);
  }, [audioOrchestrator, receivers.receivers.length]);

  // Handler: Go To Receiver (activates first-person view at receiver position)
  const handleGoToReceiver = useCallback((receiverId: string) => {
    if (activeIRGroupId === receiverId) {
      exitGoToListenerMode(true);
      return;
    }

    setActiveIRGroupId(receiverId);

    const activeSimulation = acousticsSimulation.activeSimulationIndex !== null
      ? acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex]
      : null;
    const activeMapping = activeSimulation
      ? (activeSimulation as any).sourceReceiverIRMapping as Record<string, Record<string, unknown>> | undefined
      : undefined;

    if (activeMapping) {
      const hasMissingIR = Object.keys(activeMapping).some((sourceId) => !activeMapping[sourceId]?.[receiverId]);
      if (hasMissingIR) {
        addError('You have to import an ir, auralization is disabled', 'warning');
      }
    }

    // Try regular receivers first
    const receiver = receivers.receivers.find(r => r.id === receiverId);
    if (receiver) {
      setGoToReceiverId(receiverId);
      setIsFPSModeActive(true);
      audioOrchestrator.setReceiverMode(true, receiverId, true);
      setExpandedGridListenerId(null);
      return;
    }

    // Try grid listener points: ID format is `${gridListenerId}-${index}`
    const lastDash = receiverId.lastIndexOf('-');
    if (lastDash > 0) {
      const parentId = receiverId.substring(0, lastDash);
      const pointIdx = parseInt(receiverId.substring(lastDash + 1), 10);
      const gridListener = gridListeners.gridListeners.find(g => g.id === parentId);
      if (gridListener && !isNaN(pointIdx) && gridListener.points[pointIdx]) {
        setGoToPosition(gridListener.points[pointIdx]);
        setGoToPositionReceiverId(receiverId);
        setIsFPSModeActive(true);
        audioOrchestrator.setReceiverMode(true, receiverId, true);
        setExpandedGridListenerId(parentId);
        return;
      }
    }

    console.warn('[Page] handleGoToReceiver: Receiver not found:', receiverId);
  }, [activeIRGroupId, exitGoToListenerMode, receivers.receivers, gridListeners.gridListeners, audioOrchestrator, acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs, addError]);

  // Handler: Receiver mesh double-clicked in 3D scene → enter FPS + expand listener card
  const handleReceiverDoubleClickedInScene = useCallback((receiverId: string) => {
    handleGoToReceiver(receiverId);
  }, [handleGoToReceiver]);

  // Keyboard navigation between IR groups while in FPS mode (Shift+ArrowRight / Shift+ArrowLeft)
  useEffect(() => {
    if (!isFPSModeActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();

      // Combined eligible list: single receivers + grid listener points (both non-hidden)
      const eligibleIds: string[] = [
        ...receivers.receivers
          .filter(r => !r.hiddenForSimulation)
          .map(r => r.id),
        ...gridListeners.gridListeners
          .filter(g => !g.hiddenForSimulation && g.showListeners && g.points.length > 0)
          .flatMap(g => g.points.map((_, i) => `${g.id}-${i}`)),
      ];
      if (eligibleIds.length < 2) return;

      const currentIndex = eligibleIds.indexOf(activeIRGroupId ?? '');
      const nextIndex =
        e.key === 'ArrowLeft'
          ? currentIndex >= eligibleIds.length - 1 ? 0 : currentIndex + 1
          : currentIndex <= 0 ? eligibleIds.length - 1 : currentIndex - 1;

      const nextId = eligibleIds[nextIndex];
      if (!nextId) return;

      handleGoToReceiver(nextId);
    };

    // Capture phase so Speckle's camera controls (which stopPropagation on arrow keys) can't block this
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFPSModeActive, activeIRGroupId, receivers.receivers, gridListeners.gridListeners, handleGoToReceiver]);

  /**
   * Add a receiver in front of the current camera.
   * When multiple receivers are added without moving the camera, they are placed
   * in a spiral pattern around the first camera-front position.
   * Falls back to the hook's default position if the camera is unavailable.
   */
  const handleAddReceiver = useCallback((type: string) => {
    let position: [number, number, number] | undefined;
    const viewer = viewerRef?.current;
    if (viewer) {
      try {
        // Access the active THREE.Camera from the Speckle renderer
        const camera = (viewer as any).getRenderer().renderingCamera;
        if (camera?.matrixWorld && camera?.position) {
          // Camera looks down its -Z axis; column 2 of matrixWorld is the backward vector
          const mx: number[] = camera.matrixWorld.elements;
          const dx = -mx[8], dy = -mx[9], dz = -mx[10];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const d = RECEIVER_CONFIG.CAMERA_PLACEMENT_DISTANCE_M;
          const cameraFront: [number, number, number] = [
            camera.position.x + (dx / len) * d,
            camera.position.y + (dy / len) * d,
            camera.position.z + (dz / len) * d,
          ];

          // Check if camera moved significantly since last receiver placement
          const lastFront = lastReceiverCameraFrontRef.current;
          const distSq = lastFront
            ? (cameraFront[0] - lastFront[0]) ** 2 +
              (cameraFront[1] - lastFront[1]) ** 2 +
              (cameraFront[2] - lastFront[2]) ** 2
            : Infinity;
          const cameraMoved = distSq > SPIRAL_PLACEMENT.CAMERA_MOVE_THRESHOLD ** 2;

          if (cameraMoved) {
            // Reset spiral — camera is at a new position
            lastReceiverCameraFrontRef.current = cameraFront;
            receiversAtCameraFrontRef.current = 0;
          }

          // Place this receiver at the next spiral slot around the anchor point
          const anchor = lastReceiverCameraFrontRef.current!;
          const idx = receiversAtCameraFrontRef.current;
          position = getCameraFrontSpiralPosition(anchor, idx);
          receiversAtCameraFrontRef.current += 1;
        }
      } catch {
        // Camera not ready — fall through to hook default
      }
    }

    // Derive yaw from the current listenerOrientation (look-at direction vector).
    // listenerOrientation.{x,y,z} = look-at offset from receiver position.
    const { x: lx, y: ly, z: lz } = listenerOrientation;
    const dirLen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    const yaw = Math.atan2(-lx / dirLen, -ly / dirLen);

    receivers.addReceiver(type, position, yaw);
  }, [viewerRef, receivers.addReceiver, listenerOrientation]);

  // Reset go-to triggers after being processed (allows re-triggering same receiver)
  useEffect(() => {
    if (goToReceiverId) {
      const timer = setTimeout(() => setGoToReceiverId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [goToReceiverId]);
  useEffect(() => {
    if (goToPosition) {
      const timer = setTimeout(() => setGoToPosition(null), 100);
      return () => clearTimeout(timer);
    }
  }, [goToPosition]);
  useEffect(() => {
    if (goToPositionReceiverId) {
      const timer = setTimeout(() => setGoToPositionReceiverId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [goToPositionReceiverId]);

  // Compute bounding box for a list of Speckle object IDs using the renderer's
  // native resolution (world-tree lookup + render-view AABB union). A manual
  // walk of batch renderViews cannot match these ids — renderView.renderData.id
  // is a different hash space than the selected object ids.
  const computeBoundsForObjectIds = useCallback(
    (objectIds: string[]): { min: [number, number, number]; max: [number, number, number] } | null => {
      const viewer = viewerRef?.current;
      if (!viewer || objectIds.length === 0) return null;
      try {
        const r = (viewer as any).getRenderer();
        if (typeof r?.boxFromObjects !== 'function') return null;
        const box: THREE.Box3 = r.boxFromObjects(objectIds);
        if (!box || box.isEmpty?.()) return null;
        return {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        };
      } catch (e) {
        console.error('[computeBoundsForObjectIds]', e);
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Visible grid listener points: ALL grids with showListeners=true (collapse only hides gradient map)
  const visibleGridListenerPoints = useMemo<[number, number, number][]>(() => {
    const all: [number, number, number][] = [];
    for (const grid of gridListeners.gridListeners) {
      if (grid.showListeners && grid.points.length > 0) {
        all.push(...grid.points);
      }
    }
    return all;
  }, [gridListeners.gridListeners]);

  // Point IDs parallel to visibleGridListenerPoints for double-click routing
  const visibleGridListenerPointIds = useMemo<string[]>(() => {
    const all: string[] = [];
    for (const grid of gridListeners.gridListeners) {
      if (grid.showListeners && grid.points.length > 0) {
        grid.points.forEach((_, i) => all.push(`${grid.id}-${i}`));
      }
    }
    return all;
  }, [gridListeners.gridListeners]);

  // Sync receiver count with AudioOrchestrator when receivers are added/removed
  useEffect(() => {
    if (!audioOrchestrator.isInitialized || !audioOrchestrator.status) return;

    const hasReceivers = receivers.receivers.length > 0;
    const isReceiverModeActive = audioOrchestrator.status.isReceiverModeActive;

    // Update orchestrator about receiver existence (preserving current active state)
    // This ensures warning messages update when receivers are created/deleted
    audioOrchestrator.setReceiverMode(isReceiverModeActive, undefined, hasReceivers);
  }, [receivers.receivers.length, audioOrchestrator.isInitialized]);

  // Cleanup on unmount — skip destructive cleanup when recovering in-flight jobs
  // or when restoring a saved soundscape (bootstrap). The load endpoint already
  // restores IR/audio files to temp, and cleanup would delete them.
  useEffect(() => {
    if (hasInflightJobs) {
      console.log('[page:cleanup] Skipping cleanup — in-flight jobs being recovered');
      return;
    }
    if (bootstrappedRef.current) {
      console.log('[page:cleanup] Skipping cleanup — soundscape restored from URL');
      return;
    }
    apiService.cleanupGeneratedSounds();
    // Also cleanup impulse responses on page load/refresh
    fetch(`${API_BASE_URL}/api/impulse-responses`).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        // Delete all IRs on startup for clean state
        for (const ir of data.impulse_responses) {
          try {
            await apiService.deleteImpulseResponse(ir.id);
          } catch (error) {
            console.warn('Failed to cleanup IR:', ir.id, error);
          }
        }
      }
    }).catch(() => {
      // Ignore errors during cleanup
    });
    
    return () => {
      // Unmount-time cleanup must be guarded: if a soundscape was restored from
      // URL (bootstrap) the load endpoint just copied files back into temp/, and
      // the beacon would delete them again before they are re-saved. Also skip
      // while in-flight jobs are being recovered (read live, not the stale
      // closure value). Only clean when no restore happened and no jobs remain.
      if (bootstrappedRef.current) {
        console.log('[page:cleanup] Skipping unmount cleanup — soundscape restored from URL');
        return;
      }
      if (getStoredJobs().length > 0) {
        console.log('[page:cleanup] Skipping unmount cleanup — in-flight jobs present');
        return;
      }
      navigator.sendBeacon(`${API_BASE_URL}/api/cleanup-generated-sounds`);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      <PrivacyNotice />
      {/* Home stage → model import prompt */}
      <ImportSandboxModal
        open={pendingModelSwitch !== null}
        modelName={
          pendingModelSwitch?.speckleData.display_name ||
          pendingModelSwitch?.speckleData.model_id ||
          'this model'
        }
        summary={{
          sounds: pendingModelSwitch?.home.configs.length ?? 0,
          listeners: pendingModelSwitch?.home.receivers.length ?? 0,
          gridListeners: pendingModelSwitch?.home.gridListeners.length ?? 0,
        }}
        busy={isApplyingModelSwitch}
        onImport={() => { void handleImportDecision('import'); }}
        onStartFresh={() => { void handleImportDecision('fresh'); }}
        onCancel={() => { void handleImportDecision('cancel'); }}
      />

      {/* Save / reload the Home sandbox as a named Homepage project */}
      <HomeProjectModal
        open={showHomeProjectModal}
        onClose={() => setShowHomeProjectModal(false)}
        onSave={(name) => { void handleSaveHomeProject(name); }}
        onLoad={handleOpenHomeProject}
        busy={isSavingHomeProject}
      />

      {/* A newer version of the open Speckle model has been published */}
      <NewModelVersionModal
        open={modelVersion.pending !== null}
        modelName={modelVersion.modelName || 'this model'}
        createdAt={modelVersion.pending?.created_at}
        authorName={modelVersion.pending?.author_name}
        message={modelVersion.pending?.message}
        busy={modelVersion.busy}
        onSwitch={handleSwitchToLatestVersion}
        onKeepCurrent={modelVersion.dismiss}
      />

      {/* Main 3D Scene - Fixed at screen center, full size, lowest z-index */}
      <main className="absolute inset-0">
        {/* Viewer Toggle Button - Top Left */}
        <div className="absolute top-4 left-4 z-50">
        </div>

        {/* Toggle between Speckle Scene and Three.js Scene */}
        {useSpeckleViewer ? (
          <SpeckleScene
            speckleData={globalSpeckleData}
            onViewerLoaded={handleSpeckleViewerLoaded}
            isBootstrappingModel={isBootstrappingModel}
            hasNewModelVersion={modelVersion.hasUpdate && modelVersion.pending === null}
            onSwitchToLatest={handleSwitchToLatestVersion}
            // Audio system props
            audioOrchestrator={audioOrchestrator.orchestrator}
            audioContext={audioOrchestrator.audioContext}
            audioRenderingMode={audioRenderingMode}
            selectedIRId={selectedIRId}
            auralizationConfig={auralizationConfig}
            // Soundscape data (filtered to active parent when Sounds step is active)
            soundscapeData={unifiedSoundscapeData}
            scaleForSounds={fileUpload.scaleForSounds}
            // Receivers
            receivers={receivers.receivers}
            selectedReceiverId={receivers.selectedReceiverId}
            onUpdateReceiverPosition={receivers.updateReceiverPosition}
            onReceiverSelected={receivers.selectReceiver}
            onReceiverModeChange={handleReceiverModeChange}
            goToReceiverId={goToReceiverId}
            goToPosition={goToPosition}
            goToPositionReceiverId={goToPositionReceiverId}
            gridListenerPoints={visibleGridListenerPoints}
            gridListenerPointIds={visibleGridListenerPointIds}
            expandedGridListenerId={expandedGridListenerId}
            listenerOrientation={listenerOrientation}
            // Sound sphere position update (for simulation sync when dragging)
            onUpdateSoundPosition={(soundId, position) => {
              if (soundId.startsWith('pending_')) {
                const idx = parseInt(soundId.slice('pending_'.length), 10);
                if (!isNaN(idx)) soundGen.handleUpdateConfig(idx, 'position', position);
              } else {
                soundGen.updateSoundPosition(soundId, position);
              }
            }}
            // Sound card selection (for expand/highlight logic)
            selectedCardIndex={selectedCardIndex}
            onSelectSoundCard={handleSelectSoundCard}
            // Entity linking (sound-to-Speckle-object linking)
            isLinkingEntity={isLinkingEntity}
            linkingConfigIndex={linkingConfigIndex}
            // Resonance Audio (ShoeBox Acoustics)
            resonanceAudioConfig={resonanceAudioConfig}
            showBoundingBox={showBoundingBox}
            refreshBoundingBoxTrigger={refreshBoundingBoxTrigger}
            roomScale={roomScale}
            // Callback when Speckle viewer computes model bounds (for sound sphere placement)
            onBoundsComputed={setSpeckleBounds}
            // Sidebar states for control button and timeline positioning
            isLeftSidebarExpanded={isLeftSidebarExpanded}
            isRightSidebarExpanded={isRightSidebarExpanded}
            leftSidebarContentWidth={leftSidebarContentWidth}
            rightSidebarWidth={rightSidebarWidth}
            // IR hover line (source-receiver pair)
            hoveredIRSourceReceiver={hoveredIRSourceReceiver}
            // Simulation-time positions (source of truth for IR hover line and mismatch coloring)
            activeSimulationPositions={activeSimulationPositions}
            // Model file upload (for empty state in scene)
            modelFile={globalModelFile}
            onModelFileChange={handleRightSidebarModelUpload}
            isUploadingModel={isUploadingGlobalModel}
            // Load existing Speckle model (for empty state model browser)
            onSpeckleModelSelect={handleSpeckleModelSelect}
            // Soundscape persistence
            onSaveSoundscape={
              globalSpeckleData ? handleSaveSoundscape : () => setShowHomeProjectModal(true)
            }
            isSavingSoundscape={isSavingSoundscape}
            // FPS mode programmatic exit
            exitFPSTrigger={exitFPSTrigger}
            // Receiver mesh double-click → expand listener card + enter FPS mode
            onReceiverDoubleClicked={handleReceiverDoubleClickedInScene}
            // FPS exit via Escape → collapse listener card
            onFPSExited={() => exitGoToListenerMode(true)}
            className="w-full h-full"
          />
        ) : (
          /* ThreeScene is deprecated - SpeckleScene is the default viewer */
          <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-400">
            <div className="text-center">
              <p className="text-lg mb-2">Three.js Viewer (Deprecated)</p>
              <p className="text-sm">Please use SpeckleScene viewer instead.</p>
            </div>
          </div>
        )}
        {/* Left Sidebar - Overlays on top of scene */}
        <Sidebar
        // File upload props
        audioFile={fileUpload.audioFile}
        uploadError={fileUpload.uploadError}
        isUploading={fileUpload.isUploading}
        isDragging={fileUpload.isDragging}
        modelEntities={fileUpload.modelEntities}
        isAnalyzingModel={fileUpload.isAnalyzingModel}
        analysisProgress={fileUpload.analysisProgress}
        onFileChange={handleFileChangeWithSEDClear}
        onDragOver={fileUpload.handleDragOver}
        onDragLeave={fileUpload.handleDragLeave}
        onDrop={fileUpload.handleDrop}
        onUploadModel={fileUpload.handleUploadModel}
        onLoadSampleIfc={() => {}}
        activeLoadTab={activeLoadTab}
        setActiveLoadTab={setActiveLoadTab}
        onWidthChange={setLeftSidebarContentWidth}

        // SED props
        isSEDAnalyzing={sed.isSEDAnalyzing}
        sedAudioInfo={sed.sedAudioInfo}
        sedAudioBuffer={sed.sedAudioBuffer}
        sedDetectedSounds={sed.sedDetectedSounds}
        sedError={sed.sedError}
        sedAnalysisOptions={sed.sedAnalysisOptions}
        onAnalyzeSoundEvents={handleAnalyzeSoundEvents}
        onToggleSEDOption={sed.toggleSEDOption}
        onLoadSoundsFromSED={handleLoadSoundsFromSED}

        // Sound generation props
        soundConfigs={soundGen.soundConfigs}
        activeSoundConfigTab={soundGen.activeSoundConfigTab}
        isSoundGenerating={soundGen.isSoundGenerating}
        generatedSounds={soundGen.generatedSounds}
        globalDuration={soundGen.globalDuration}
        globalSteps={soundGen.globalSteps}
        globalNegativePrompt={soundGen.globalNegativePrompt}
        applyDenoising={soundGen.applyDenoising}
        trimSilence={soundGen.trimSilence}
        applyNoiseReduction={soundGen.applyNoiseReduction}
        audioModel={soundGen.audioModel}
        llmModel={soundGen.llmModel}
        setActiveSoundConfigTab={soundGen.setActiveSoundConfigTab}
        onAddSoundConfig={soundGen.handleAddConfig}
        onBatchAddSoundConfigs={soundGen.handleBatchAddConfigs}
        onRemoveSoundConfig={handleRemoveSoundConfig}
        onUpdateSoundConfig={handleUpdateSoundConfig}
        onSoundTypeChange={soundGen.handleTypeChange}
        onGenerateSounds={soundGen.handleGenerate}
        onGenerateSingleSound={soundGen.handleGenerateSingle}
        onGenerateFilteredSounds={soundGen.handleGenerateFiltered}
        onStopSoundGeneration={soundGen.handleStopGeneration}
        onGlobalDurationChange={soundGen.handleGlobalDurationChange}
        onGlobalStepsChange={soundGen.handleGlobalStepsChange}
        onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
        onApplyDenoisingChange={soundGen.setApplyDenoising}
        onTrimSilenceChange={soundGen.setTrimSilence}
        onApplyNoiseReductionChange={soundGen.setApplyNoiseReduction}
        onAudioModelChange={soundGen.setAudioModel}
        onLlmModelChange={soundGen.setLlmModel}
        onReprocessSounds={soundGen.handleReprocessSounds}
        onUploadAudio={soundGen.handleUploadAudio}
        onClearUploadedAudio={soundGen.handleClearUploadedAudio}
        onLibrarySearch={soundGen.handleLibrarySearch}
        onLibrarySoundSelect={soundGen.handleLibrarySoundSelect}
        onCatalogSoundSelect={soundGen.handleCatalogSoundSelect}
        onStartLinkingEntity={handleStartLinkingEntity}
        onCancelLinkingEntity={handleCancelLinkingEntity}
        onFinishLinkingEntity={handleFinishLinkingEntity}
        onSelectLinkedEntity={handleSelectLinkedEntity}
        onClearLinkedEntities={handleClearLinkedEntities}
        isLinkingEntity={isLinkingEntity}
        linkingConfigIndex={linkingConfigIndex}
        useSpeckleViewer={useSpeckleViewer}
        onResetSound={handleResetSound}
        onDuplicateConfig={soundGen.handleDuplicateConfig}
        onRegenerateSingle={soundGen.handleRegenerateSingle}
        onDeleteVariant={soundGen.handleDeleteVariant}
        onSelectSoundCard={handleSelectSoundCard}
        selectedCardIndex={selectedCardIndex}
        onSoundCardCollapsed={() => setSelectedCardIndex(null)}
        // Analysis props
        analysisConfigs={analysis.analysisConfigs}
        stepAdvanceTrigger={stepAdvanceTrigger}
        isAnalyzing={analysis.isAnalyzing}
        analysisResult={analysis.analysisResults}
        hasGlobalModelLoaded={globalSpeckleData !== null}
        onAddAnalysisConfig={handleAddAnalysisConfig}
        onRemoveAnalysisConfig={analysis.handleRemoveConfig}
        onUpdateAnalysisConfig={analysis.handleUpdateConfig}
        onAnalyze={analysis.handleAnalyze}
        onStop={analysis.handleStopAnalysis}
        onTogglePromptSelection={analysis.handleTogglePromptSelection}
        onSendToSoundGeneration={handleSendAnalysisToGeneration}
        onResetAnalysis={analysis.handleReset}
        onAudioExtract={handleAudioExtract}
        
        // Advanced settings props
        normalizeImpulseResponses={auralizationConfig.normalize}
        showAxesHelper={showAxesHelper}
        onNormalizeImpulseResponsesChange={handleToggleNormalize}
        onShowAxesHelperChange={setShowAxesHelper}
        showLabelSprites={showLabelSprites}
        onShowLabelSpritesChange={setShowLabelSprites}
        showHoveringHighlight={showHoveringHighlight}
        onShowHoveringHighlightChange={setShowHoveringHighlight}
        showSoundSpheres={showSoundSpheres}
        onShowSoundSpheresChange={setShowSoundSpheres}
        showPlayingHighlight={showPlayingHighlight}
        onShowPlayingHighlightChange={setShowPlayingHighlight}
        showSceneListeners={showSceneListeners}
        onShowSceneListenersChange={setShowSceneListeners}
        showGroundGrid={showGroundGrid}
        onShowGroundGridChange={setShowGroundGrid}
        groundGridSpacing={groundGridSpacing}
        onGroundGridSpacingChange={setGroundGridSpacing}
        groundGridColor={groundGridColor}
        onGroundGridColorChange={setGroundGridColor}
        onResetAdvancedSettings={handleResetAdvancedSettings}
        listenerOrientation={listenerOrientation}
        onListenerOrientationChange={setListenerOrientation}
      />

      {/* Advanced Settings floating panel */}
      <AdvancedSettingsPanel
        isVisible={showAdvancedSettings}
        onClose={() => setShowAdvancedSettings(false)}
        globalSteps={soundGen.globalSteps}
        globalNegativePrompt={soundGen.globalNegativePrompt}
        applyDenoising={soundGen.applyDenoising}
        trimSilence={soundGen.trimSilence}
        applyNoiseReduction={soundGen.applyNoiseReduction}
        normalizeImpulseResponses={auralizationConfig.normalize}
        audioModel={soundGen.audioModel}
        llmModel={soundGen.llmModel}
        onGlobalStepsChange={soundGen.handleGlobalStepsChange}
        onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
        onApplyDenoisingChange={soundGen.setApplyDenoising}
        onTrimSilenceChange={soundGen.setTrimSilence}
        onApplyNoiseReductionChange={soundGen.setApplyNoiseReduction}
        onNormalizeImpulseResponsesChange={handleToggleNormalize}
        onAudioModelChange={soundGen.setAudioModel}
        onLlmModelChange={soundGen.setLlmModel}
        onResetToDefaults={handleResetAdvancedSettings}
        showAxesHelper={showAxesHelper}
        onShowAxesHelperChange={setShowAxesHelper}
        showLabelSprites={showLabelSprites}
        onShowLabelSpritesChange={setShowLabelSprites}
        showHoveringHighlight={showHoveringHighlight}
        onShowHoveringHighlightChange={setShowHoveringHighlight}
        showSoundSpheres={showSoundSpheres}
        onShowSoundSpheresChange={setShowSoundSpheres}
        showPlayingHighlight={showPlayingHighlight}
        onShowPlayingHighlightChange={setShowPlayingHighlight}
        showSceneListeners={showSceneListeners}
        onShowSceneListenersChange={setShowSceneListeners}
        showGroundGrid={showGroundGrid}
        onShowGroundGridChange={setShowGroundGrid}
        groundGridSpacing={groundGridSpacing}
        onGroundGridSpacingChange={setGroundGridSpacing}
        groundGridColor={groundGridColor}
        onGroundGridColorChange={setGroundGridColor}
        listenerOrientation={listenerOrientation}
        onListenerOrientationChange={setListenerOrientation}
        onDeleteHistory={handleDeleteHistory}
      />

      {/* Right Sidebar - Acoustics + Listeners */}
      <RightSidebar
        isVisible={useSpeckleViewer}
        onWidthChange={setRightSidebarWidth}
        // IR Library props
        onSelectIRFromLibrary={handleSelectIRFromLibrary}
        onClearIR={handleClearIR}
        selectedIRId={selectedIRId}
        auralizationConfig={auralizationConfig}
        // Receiver props
        receivers={receivers.receivers}
        onAddReceiver={handleAddReceiver}
        onDeleteReceiver={receivers.removeReceiver}
        onUpdateReceiverName={receivers.updateReceiverName}
        onUpdateReceiverPosition={receivers.updateReceiverPosition}
        onGoToReceiver={handleGoToReceiver}
        onToggleReceiverHiddenForSimulation={receivers.toggleReceiverHiddenForSimulation}
        onExitFPS={() => exitGoToListenerMode(false)}
        isFPSModeActive={isFPSModeActive}
        forcedActiveGroupId={activeIRGroupId}
        forcedExpandedListenerId={goToExpandedSingleListenerId}
        collapseListenerCardTrigger={collapseListenerCardTrigger}
        // Grid listener props
        gridListeners={gridListeners.gridListeners}
        onAddGridListener={() => gridListeners.addGridListener()}
        onDeleteGridListener={gridListeners.removeGridListener}
        onComputeBounds={computeBoundsForObjectIds}
        expandedGridListenerId={expandedGridListenerId}
        onExpandedGridListenerChange={setExpandedGridListenerId}
        // ShoeBox Acoustics props
        resonanceAudioConfig={resonanceAudioConfig}
        onToggleResonanceAudio={() => {}}
        onUpdateRoomMaterials={handleUpdateRoomMaterials}
        hasGeometry={fileUpload.geometryData !== null}
        showBoundingBox={showBoundingBox}
        onToggleBoundingBox={setShowBoundingBox}
        onRefreshBoundingBox={handleRefreshBoundingBox}
        roomScale={roomScale}
        onRoomScaleChange={setRoomScale}
        // Audio Orchestrator props
        audioRenderingMode={audioRenderingMode}
        onAudioRenderingModeChange={handleAudioRenderingModeChange}
        // Material assignment props
        modelType={modelType}
        modelEntities={fileUpload.modelEntities}
        geometryData={fileUpload.geometryData}
        selectedGeometry={selectedGeometry}
        onSelectGeometry={handleSelectGeometry}
        onHoverGeometry={handleHoverGeometry}
        onAssignMaterial={handleAssignMaterial}
        modelFile={fileUpload.modelFile}
        speckleData={globalSpeckleData}
        soundscapeData={soundGen.soundscapeData}
        onIRImported={handleIRImported}
        irRefreshTrigger={irRefreshTrigger}
        // Acoustics simulation state
        simulationConfigs={acousticsSimulation.simulationConfigs}
        activeSimulationIndex={acousticsSimulation.activeSimulationIndex}
        onAddSimulationConfig={acousticsSimulation.handleAddConfig}
        onRemoveSimulationConfig={handleRemoveSimulationConfig}
        onUpdateSimulationConfig={acousticsSimulation.handleUpdateConfig}
        onSetActiveSimulation={acousticsSimulation.handleSetActiveSimulation}
        onUpdateSimulationName={acousticsSimulation.handleUpdateSimulationName}
        onIRHover={handleIRHover}
        fpsExitTrigger={collapseListenerCardTrigger}
        onIRGainChange={handleIRGainChange}
        onIRNormalizeChange={handleIRNormalizeChange}
        listenerOrientation={listenerOrientation}
      />
      </main>
    </div>
  );
}

export default function Home() {
  // Track the CSS-pixel viewport once at the app root (outside Suspense, before
  // child mount effects that read fluid panel sizes). Updates utils/scale.ts and
  // the --ui-vw / --ui-vh / --ui-dvh CSS vars for the whole UI.
  useViewportScale();

  // Zustand persist rehydration — must run OUTSIDE Suspense so it fires
  // BEFORE child mount effects (Sidebar, Timeline, Explorer on mount read
  // the store and expect rehydration to have completed).
  useEffect(() => {
    (useUIStore as any).persist?.rehydrate?.();
    (useCardFlowStore as any).persist?.rehydrate?.();
    (useAudioControlsStore as any).persist?.rehydrate?.();
    (useRightSidebarStore as any).persist?.rehydrate?.();
    (useAcousticLayerStore as any).persist?.rehydrate?.();
    // Rehydration restores the persisted open/closed state of the floating
    // panels. Collapse them again AFTER rehydrate so a page load or refresh
    // always starts with Settings, Object Explorer, and the DAW timeline
    // reduced — regardless of what was persisted.
    collapseFloatingPanels();
  }, []);

  return (
    <>
      <ErrorToast />
      <Suspense fallback={null}>
        <HomeContent />
      </Suspense>
    </>
  );
}

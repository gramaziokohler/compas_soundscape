"use client";

import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { SpeckleScene } from "@/components/scene/SpeckleScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { AdvancedSettingsPanel } from "@/components/scene/AdvancedSettingsPanel";
import { ErrorToast } from "@/components/ui/ErrorToast";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import {
  useAudioControlsStore,
  useFileUploadStore,
  useTextGenerationStore,
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
} from "@/store";
import { useSpeckleEngineStore } from "@/store/speckleEngineStore";
import * as THREE from "three";
import { useAudioNormalization } from "@/hooks/useAudioNormalization";
import { useAudioOrchestrator } from "@/hooks/useAudioOrchestrator";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useJobRecovery } from "@/hooks/useJobRecovery";
import { apiService } from "@/services/api";
import { API_BASE_URL, DEFAULT_DBFS, RECEIVER_CONFIG, SPIRAL_PLACEMENT, DEFAULT_LISTENER_ORIENTATION } from "@/utils/constants";
import { getCameraFrontSpiralPosition } from "@/lib/three/spiral-placement";
import type { LoadTab, SoundGenerationConfig } from "@/types";
import type { AudioAnalysisConfig } from "@/types/analysis";
import type { SelectedGeometry, AcousticMaterial } from "@/types/materials";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";
import { buildSoundscapeSavePayload, restoreSoundscapeState, getBlobUrlSounds, buildAnalysisStateSave, restoreAnalysisState } from "@/utils/soundscape-serializer";
import { recordInflightJob } from "@/lib/job-tracker";

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

  useEffect(() => {
    if (bootstrappedRef.current) return;
    // Only read the URL on the client — window is not available during SSR
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlModelId = params.get('model_id');
    if (!urlModelId) return;

    const gsd = useUIStore.getState().globalSpeckleData;
    if (gsd !== null) return; // model already loaded via normal flow
    bootstrappedRef.current = true;

    console.log('[page:bootstrap] Loading soundscape for model_id from URL:', urlModelId);
    apiService.loadSoundscapeFromSpeckle(urlModelId).then(loadResponse => {
      if (!loadResponse.found || !loadResponse.soundscape_data) {
        console.log('[page:bootstrap] No saved soundscape found for', urlModelId, '- looking up model from Speckle API');
        apiService.getSpeckleModels().then(speckleResponse => {
          const model = speckleResponse.models.find(m => m.id === urlModelId);
          if (!model || !model.latest_version) {
            console.log('[page:bootstrap] Model not found in Speckle project:', urlModelId);
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
        });
        return;
      }

      const data = loadResponse.soundscape_data;
      const audioBaseUrl = `${API_BASE_URL}${loadResponse.audio_base_url}`;
      const irBaseUrl = loadResponse.ir_base_url || undefined;

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

      // Mirror handleSpeckleModelSelect restore flow
      const restored = restoreSoundscapeState(data, audioBaseUrl, irBaseUrl);
      if (restored.soundEvents.length > 0) {
        suppressOrchestrateBakeRef.current = true;
      }
      soundGen.restoreSoundscape(restored.soundConfigs, restored.soundEvents, {
        negativePrompt: restored.globalSettings.negativePrompt,
        audioModel: restored.globalSettings.audioModel,
      });
      useAudioControlsStore.getState().restoreVolumeAndIntervals(restored.soundVolumes, restored.soundIntervals);
      useAudioControlsStore.getState().restoreSchedulingModes(restored.soundSchedulingModes, restored.soundTimestamps);

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

      if (restored.receivers.length > 0) {
        receivers.restoreReceivers(restored.receivers, restored.selectedReceiverId);
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
        acousticsSimulation.restoreSimulationState(
          restored.simulationConfigs,
          restored.activeSimulationIndex,
        );
      }
      if (data.analysis_state) {
        const analysisRestored = restoreAnalysisState(data.analysis_state);
        analysis.restoreAnalysisState({
          analysisConfigs: analysisRestored.analysisConfigs,
          analysisResults: analysisRestored.analysisResults,
          activeTab: analysisRestored.activeTab,
        });
        if (analysisRestored.pendingSoundConfigs.length > 0) {
          textGen.setPendingSoundConfigs(analysisRestored.pendingSoundConfigs);
        }
        if (analysisRestored.soundConfigParentIndices.size > 0) {
          const storeState = useSoundscapeStore.getState();
          const configs = storeState.soundConfigs.map((c: any, i: number) => {
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
      console.log('[page:bootstrap] Soundscape restored from URL param');
    }).catch(err => {
      console.error('[page:bootstrap] Failed to load soundscape:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Autosave — debounced save on domain state mutations
  // Uses a ref for the save handler so it can be called before it's defined
  const saveSoundscapeRef = useRef<(() => Promise<void>) | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveEnabledRef = useRef(true);
  const lastSaveSourceRef = useRef<string>('manual');
  useEffect(() => {
    const unsubUI = useUIStore.subscribe((_state, _prev) => {
      autosaveEnabledRef.current = _state.enableAutoSave;
    });
    const scheduleAutosave = (source?: string) => {
      // Read live store state instead of the render closure — this effect only
      // runs once at mount (deps=[]), so a captured `globalSpeckleData` variable
      // would be frozen at its mount-time value (null on a cold refresh) forever.
      const liveModelId = useUIStore.getState().globalSpeckleData?.model_id ?? null;
      if (!autosaveEnabledRef.current) return;
      if (!liveModelId) return;
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(() => {
        lastSaveSourceRef.current = 'autosave';
        saveSoundscapeRef.current?.();
      }, 3000);
    };
    const unsubSoundscape = useSoundscapeStore.subscribe(() => scheduleAutosave('soundscapeStore'));
    const unsubAudio = useAudioControlsStore.subscribe(() => scheduleAutosave('audioControlsStore'));
    const unsubReceivers = useReceiversStore.subscribe(() => scheduleAutosave('receiversStore'));
    const unsubSim = useAcousticsSimulationStore.subscribe(() => scheduleAutosave('acousticsSimulationStore'));
    const unsubAnalysis = useAnalysisStore.subscribe(() => scheduleAutosave('analysisStore'));
    return () => {
      unsubUI();
      unsubSoundscape();
      unsubAudio();
      unsubReceivers();
      unsubSim();
      unsubAnalysis();
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileUpload = useFileUploadStore();
  const handleApiError = useApiErrorHandler();
  const addError = useErrorsStore((s) => s.addError);
  const textGen = useTextGenerationStore();
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

  // Auto-initialize timestamp scheduling for sounds that carry foley timestamps.
  // Runs whenever generatedSounds changes; uses getState() to avoid store subscriptions.
  useEffect(() => {
    const audioStore = useAudioControlsStore.getState();
    soundGen.generatedSounds.forEach((sound: any) => {
      if (!sound.timestamps?.length) return;
      if (audioStore.soundSchedulingModes[sound.id]) {
        console.log('[page:autoInit] SKIP — mode already set for', sound.id, 'mode:', audioStore.soundSchedulingModes[sound.id]);
        return;
      }
      const timestampsSec = (sound.timestamps as string[]).map((t) => {
        const [mm, ss] = t.split(':').map(Number);
        return (mm ?? 0) * 60 + (ss ?? 0);
      });
      console.log('[page:autoInit] OVERWRITING ts for', sound.id, 'from foley timestamps:', timestampsSec);
      audioStore.handleSchedulingModeChange(sound.id, 'timestamps');
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
    diverseSelectedObjectIds,
    addToDiverseSelection,
    removeFromDiverseSelection,
    setModelFileName,
    getViewerRef,
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
  // Rebuilt when worldTree becomes ready. Used to remap entity links from saved soundscapes
  // (Speckle object IDs change on every commit, applicationId stays stable).
  const appIdToTreeIdMap = useMemo<Map<string, string>>(() => {
    if (!worldTreeReady || !viewerRef?.current) return new Map();
    const worldTree = viewerRef.current.getWorldTree() as any;
    const root = worldTree?.tree?._root || worldTree?._root || worldTree?.root || worldTree;
    return buildAppIdMap(root);
  }, [worldTreeReady]);

  const sed = useSEDStore();

  // MAIN AUDIO SYSTEM: Handles all 6 audio modes (Flat Anechoic, ShoeBox Acoustics, Spatial Anechoic, Mono IR, Stereo IR, Ambisonic IR)
  const audioOrchestrator = useAudioOrchestrator();
  
  // Store orchestrator in ref for stable callback access
  const orchestratorRef = useRef(audioOrchestrator.orchestrator);
  useEffect(() => {
    orchestratorRef.current = audioOrchestrator.orchestrator;
  }, [audioOrchestrator.orchestrator]);

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
    isLeftSidebarExpanded, setIsLeftSidebarExpanded,
    speckleBounds, setSpeckleBounds,
    hoveredIRSourceReceiver, setHoveredIRSourceReceiver,
    showAxesHelper, setShowAxesHelper,
    showLabelSprites, setShowLabelSprites,
    showHoveringHighlight, setShowHoveringHighlight,
    showSoundSpheres, setShowSoundSpheres,
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

  // Sync model bounding box → Resonance Audio room bounds
  useEffect(() => {
    if (!speckleBounds || !audioOrchestrator.orchestrator) return;
    audioOrchestrator.orchestrator.updateResonanceRoomBounds(
      speckleBounds.min,
      speckleBounds.max
    );
  }, [speckleBounds, audioOrchestrator.orchestrator]);

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

  // Callback when Speckle viewer is loaded
  const handleSpeckleViewerLoaded = useCallback((viewer: import('@speckle/viewer').Viewer) => {
    _viewerLoadComplete = true;
    console.log('[page:camera:restore] Viewer loaded');
    // Try Zustand store first (may have been rehydrated), then fall back to direct localStorage
    let savedPos = useUIStore.getState().cameraPosition;
    let savedTarget = useUIStore.getState().cameraTarget;
    let savedUp: [number, number, number] | undefined;
    let savedOrbitTarget: [number, number, number] | undefined;
    if (!savedPos || !savedTarget) {
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

      if (activeConfig && (activeConfig.type === 'pyroomacoustics' || activeConfig.type === 'import-irs')) {
        const simConfig = activeConfig as any;
        const simulationMode = activeConfig.type === 'import-irs' ? 'pyroomacoustics' : activeConfig.type;

        // If simulation has source-receiver IR mapping, pass it to AudioOrchestrator
        if (simConfig.sourceReceiverIRMapping) {
          const initialReceiverId = receivers.receivers.length > 0 ? receivers.receivers[0].id : undefined;

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
              initialReceiverId
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
              initialReceiverId
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

  // Stop timeline when switching between simulation tabs
  // Skip stopping when both old and new simulations are completed (hot-swap or seamless switch)
  const prevActiveIndexRef = useRef<number | null>(acousticsSimulation.activeSimulationIndex);

  useEffect(() => {
    const prevIndex = prevActiveIndexRef.current;
    const currentIndex = acousticsSimulation.activeSimulationIndex;

    // Only stop if we're actually switching between simulations (not on initial mount)
    if (prevIndex !== null && prevIndex !== currentIndex) {
      // Check if both old and new simulations have IR mappings — if so, just hot-swap IRs
      const prevMapping = getSimIRMapping(prevIndex);
      const currentMapping = getSimIRMapping(currentIndex);

      if (prevMapping && currentMapping) {
        console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, hot-swapping IRs (no stop)`);
      } else {
        // Don't stop when switching between two completed simulations — the IR will update
        // seamlessly via the auto-select IR effect. Only stop when turning off audio
        // (currentIndex === null) or switching to/from a non-completed card.
        const prevConfig = acousticsSimulation.simulationConfigs[prevIndex];
        const currentConfig = currentIndex !== null ? acousticsSimulation.simulationConfigs[currentIndex] : null;
        const bothCompleted = prevConfig?.state === 'completed' && currentConfig?.state === 'completed';

        if (bothCompleted) {
          console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, both completed - no stop`);
        } else {
          console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, stopping timeline`);
          useAudioControlsStore.getState().stopAll();
        }
      }
    }

    // Update ref for next comparison
    prevActiveIndexRef.current = currentIndex;
  }, [acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs, getSimIRMapping]);
  
  // Entity linking state
  const [isLinkingEntity, setIsLinkingEntity] = useState(false);
  const [linkingConfigIndex, setLinkingConfigIndex] = useState<number | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);

  // Track shift-key for append-entity mode (shift+click adds to entities[], plain click replaces)
  const isShiftHeldRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftHeldRef.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') isShiftHeldRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

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

  // Forced expanded listener card (from scene mesh double-click)
  const [forcedExpandedListenerId, setForcedExpandedListenerId] = useState<string | null>(null);

  // Collapse all listener cards trigger (from FPS exit via Escape)
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

  // Clear analyzed entities when model changes
  useEffect(() => {
    // Clear the analysis when new model is loaded or model is unloaded
    textGen.handleClearAnalysis();
  }, [fileUpload.modelFile, fileUpload.modelEntities.length]);

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
        // Resolve the object ID: if the entity has an applicationId (Rhino GUID from saved data),
        // remap it to the current Speckle tree ID. Speckle IDs change on every commit.
        let objectId = ent.nodeId || ent.id;
        if (ent.applicationId && appIdToTreeIdMap.size > 0) {
          objectId = appIdToTreeIdMap.get(ent.applicationId) || objectId;
        }
        if (!objectId) continue;

        // Register the entity-sound link in SpeckleSelectionModeContext
        // Pass hasGeneratedSound=true since this effect runs for generated sounds
        linkObjectToSound(objectId, promptIndex, true);
      }
    });
  }, [soundGen.generatedSounds, soundGen.soundConfigs, soundGen.soundscapeData, linkObjectToSound, appIdToTreeIdMap]);

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
        // Resolve applicationId (Rhino GUID) to current Speckle tree ID
        let objectId = ent.nodeId || ent.id;
        if (ent.applicationId && appIdToTreeIdMap.size > 0) {
          objectId = appIdToTreeIdMap.get(ent.applicationId) || objectId;
        }
        if (!objectId || linkedObjectIds.has(objectId)) continue;
        // Register as pending (no generated sound yet) → light pink
        linkObjectToSound(objectId, index);
      }
    });
  }, [soundGen.soundConfigs, linkedObjectIds, linkObjectToSound, appIdToTreeIdMap]);

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
        let configObjectId = ent.nodeId || ent.id;
        if (ent.applicationId && appIdToTreeIdMap.size > 0) {
          configObjectId = appIdToTreeIdMap.get(ent.applicationId) || configObjectId;
        }
        return configObjectId === objectId;
      });
      // If the config is gone or no entity matches, unlink
      if (!config || !hasMatchingEntity) {
        unlinkObjectFromSound(objectId);
      }
    });
  }, [soundGen.soundConfigs, unlinkObjectFromSound, appIdToTreeIdMap]);

  // Handler: Reset bounding box to its original model-derived size
  const handleRefreshBoundingBox = useCallback(() => {
    setRoomScale({ x: 1, y: 1, z: 1 });
    triggerBoundingBoxRefresh();
  }, [setRoomScale, triggerBoundingBoxRefresh]);

  // Load sounds from text generation into sound generation tab
  const handleLoadSoundsToGeneration = useCallback(() => {
    if (textGen.pendingSoundConfigs.length > 0) {
      soundGen.setSoundConfigsFromPrompts(textGen.pendingSoundConfigs);
      setStepAdvanceTrigger(t => t + 1);
      // Don't clear pendingSoundConfigs - allow loading multiple times
    }
  }, [textGen.pendingSoundConfigs, soundGen]);

  // Active parent filter from UIStore (set by Sidebar when Sounds step is active)
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);

  // Re-apply Speckle entity highlight colors when the Sounds step is entered or exited.
  // applyFilterColors internally reads activeSoundParentIndex from UIStore to decide
  // whether to show entity link colors.
  useEffect(() => {
    useSpeckleStore.getState().applyFilterColors();
  }, [activeSoundParentIndex, isInSoundsStep]);

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
    soundGen.injectExtractedSEDSounds(sounds, -(originalIndex + 1));
    console.log(`[handleAudioExtract] Injected ${sounds.length} sounds from audio card ${originalIndex} (parentKey=${-(originalIndex + 1)})`);
  }, [analysis.analysisResults, soundGen]);
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
        const isSpeech = orchestrateMeta?.isSpeech || normalizedCategory === 'speech';
        const variantCount = orchestrateMeta?.variants?.length
          ? Math.max(...orchestrateMeta.variants, 1)
          : 1;

        // Resolve entities: for orchestrateMeta with allObjectIds, resolve all of them
        const resolvedEntities = (() => {
          if (orchestrateMeta?.allObjectIds?.length) {
            return orchestrateMeta.allObjectIds.map((objId: string) => {
              const primaryRaw = { id: objId, foleyPosition: p.position };
              return resolveEntityFromTreeId(objId, primaryRaw.foleyPosition);
            }).filter(Boolean);
          }
          const primaryRaw = p.entities?.[0] ?? p.entity;
          if (!primaryRaw?.id) return undefined;
          const resolved = resolveEntityFromTreeId(primaryRaw.id, primaryRaw.foleyPosition);
          return resolved ? [resolved] : undefined;
        })();

        const config: SoundGenerationConfig = {
          prompt: isSpeech ? (orchestrateMeta?.speechLines?.[0] || p.text) : p.text,
          duration: isBackground ? 10 : (p.metadata?.duration_seconds ?? 10),
          guidance_scale: 4.5,
          negative_prompt: '',
          seed_copies: variantCount,
          steps: 25,
          dbfs: p.metadata?.dbfs ?? DEFAULT_DBFS,
          interval_seconds: isBackground ? 0 : (p.metadata?.interval_seconds ?? 5),
          display_name: p.displayName || (p.text.length > 50 ? p.text.substring(0, 47) + '...' : p.text),
          entities: resolvedEntities,
          entity: resolvedEntities?.[0], // backward compat
          type: isSpeech ? 'text-to-speech' : undefined,
          voice_name: isSpeech ? (orchestrateMeta?.voiceName || 'Kore') : undefined,
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
        };
        return config;
      });

      console.log('[Analysis→SoundGen] Converted configs with metadata:', 
        newConfigs.map(c => ({ prompt: c.prompt.substring(0, 30), duration: c.duration, dbfs: c.dbfs, interval_seconds: c.interval_seconds, hasEntities: !!c.entities?.length })));

      // Add to sound generation
      soundGen.setSoundConfigsFromPrompts(newConfigs);
      
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

  // Handler: Analyze with context data (passes diverse selection + viewerRef to useAnalysis)
  const handleAnalyzeWithContext = useCallback((index: number) => {
    return analysis.handleAnalyze(index, {
      diverseObjectIds: diverseSelectedObjectIds,
      viewerRef: viewerRef
    });
  }, [analysis.handleAnalyze, diverseSelectedObjectIds, viewerRef]);

  // Handler: Add analysis config with global model inheritance
  const handleAddAnalysisConfig = useCallback((type: import('@/types/card').CardType) => {
    // For 3D model configs, pass globalSpeckleData so new card inherits the loaded model
    if ((type === '3d-model' || type === 'model-analysis') && globalSpeckleData) {
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
      await sed.analyzeSoundEvents(fileUpload.audioFile, textGen.numSounds);
      console.log('✓ Sound event analysis complete');
    } catch (error) {
      console.error('Failed to analyze sound events:', error);
    }
  }, [fileUpload.audioFile, textGen.numSounds, sed]);

  // Handler: Load detected sounds to sound generation tab
  const handleLoadSoundsFromSED = useCallback(() => {
    // Format SED results as sound configs
    const newConfigs = sed.formatForSoundGeneration();

    // Add the sound configs (appends to existing configs)
    soundGen.setSoundConfigsFromPrompts(newConfigs);

    // Advance to Sounds step in sidebar
    setStepAdvanceTrigger(t => t + 1);

    console.log(`Loaded ${newConfigs.length} sounds from SED analysis`);
  }, [sed, soundGen, textGen]);

  // Handler: Upload model file from right sidebar (direct Speckle upload, bypasses useAnalysis)
  const handleRightSidebarModelUpload = useCallback(async (file: File) => {
    console.log('[page.tsx] Model file dropped in right sidebar:', file.name);

    if (isUploadingGlobalModel) {
      console.log('[page.tsx] Global upload already in progress');
      return;
    }

    setIsUploadingGlobalModel(true);
    setGlobalModelFile(file);

    try {
      // Upload directly to backend for Speckle conversion
      const uploadResponse = await apiService.uploadFile(file);

      // Extract speckle data from response
      const speckleData = 'speckle' in uploadResponse ? uploadResponse.speckle : undefined;

      if (speckleData) {
        console.log('[page.tsx] Model uploaded to Speckle:', speckleData.url);
        setGlobalSpeckleData(speckleData);
        setSpeckleModelUrl(speckleData.url);
        router.replace(`/?model_id=${encodeURIComponent(speckleData.model_id)}`, { scroll: false });
      } else {
        console.warn('[page.tsx] No Speckle data in upload response');
      }
    } catch (error) {
      console.error('[page.tsx] Failed to upload model:', error);
      handleApiError(error, 'Failed to upload model');
      setGlobalModelFile(null);
    } finally {
      setIsUploadingGlobalModel(false);
    }
  }, [isUploadingGlobalModel, handleApiError]);

  // Load an existing Speckle model directly (no upload needed)
  const handleSpeckleModelSelect = useCallback(async (speckleData: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
    display_name?: string;
  }) => {
    console.log('[page.tsx] Speckle model selected:', speckleData.url);
    setGlobalSpeckleData(speckleData);
    setSpeckleModelUrl(speckleData.url);
    if (speckleData.display_name) {
      setModelFileName(speckleData.display_name);
    }

    // Persist model_id in URL so a page refresh can restore this session
    router.replace(`/?model_id=${encodeURIComponent(speckleData.model_id)}`, { scroll: false });

    // Auto-load saved soundscape for this model
    try {
      const loadResponse = await apiService.loadSoundscapeFromSpeckle(speckleData.model_id);
      if (loadResponse.found && loadResponse.soundscape_data) {
        console.log('[page.tsx] Restoring saved soundscape:', loadResponse.soundscape_data);
        const audioBaseUrl = `${API_BASE_URL}${loadResponse.audio_base_url}`;
        // IR base URL is kept as a relative path (e.g. "/soundscapes/{model_id}/ir_files")
        // because AudioOrchestrator prepends the host when fetching IR files
        const irBaseUrl = loadResponse.ir_base_url || undefined;
        const restored = restoreSoundscapeState(loadResponse.soundscape_data, audioBaseUrl, irBaseUrl);

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
            negativePrompt: restored.globalSettings.negativePrompt,
            audioModel: restored.globalSettings.audioModel,
          }
        );

        // Restore user-adjusted volume and interval values
        useAudioControlsStore.getState().restoreVolumeAndIntervals(
          restored.soundVolumes,
          restored.soundIntervals,
        );

        // Restore per-track timeline scheduling modes + timestamps (defaults to
        // "timestamps" mode for any track whose mode wasn't saved).
        useAudioControlsStore.getState().restoreSchedulingModes(
          restored.soundSchedulingModes,
          restored.soundTimestamps,
        );
        console.log('[DEBUG-LOAD] after restoreSchedulingModes:');
        console.log('[DEBUG-LOAD]   modes:', JSON.stringify(useAudioControlsStore.getState().soundSchedulingModes));
        console.log('[DEBUG-LOAD]   timestamps keys:', Object.keys(useAudioControlsStore.getState().soundTimestamps));
        for (const [k, v] of Object.entries(useAudioControlsStore.getState().soundSchedulingModes)) {
          if (v === 'interval') {
            console.log(`[DEBUG-LOAD]   INTERVAL track: ${k} mode=${v} tsCount=${useAudioControlsStore.getState().soundTimestamps[k]?.length ?? 0}`);
          }
        }

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

        // Restore analysis state (cards, results, pending sound configs)
        if (loadResponse.soundscape_data.analysis_state) {
          const analysisRestored = restoreAnalysisState(loadResponse.soundscape_data.analysis_state);
          console.log('[DEBUG-LOAD-ANALYSIS] restored configs:', analysisRestored.analysisConfigs.length,
            'results:', analysisRestored.analysisResults.length,
            'pendingSounds:', analysisRestored.pendingSoundConfigs.length,
            'parentIndices:', analysisRestored.soundConfigParentIndices.size,
            'cardFlow:', analysisRestored.cardFlowState ? `${analysisRestored.cardFlowState.contextAdvanced.length}c/${analysisRestored.cardFlowState.usageAdvanced.length}u ctx→use:${Object.keys(analysisRestored.cardFlowState.contextToUsage).length} use→snd:${Object.keys(analysisRestored.cardFlowState.usageToSound).length}` : 'null');
          analysis.restoreAnalysisState({
            analysisConfigs: analysisRestored.analysisConfigs,
            analysisResults: analysisRestored.analysisResults,
            activeTab: analysisRestored.activeTab,
          });
          if (analysisRestored.pendingSoundConfigs.length > 0) {
            textGen.setPendingSoundConfigs(analysisRestored.pendingSoundConfigs);
          }
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
    textGen.setPendingSoundConfigs,
    audioOrchestrator.setAmbisonicOrder,
    audioOrchestrator.setNoIRPreference,
  ]);

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
  const handleSaveSoundscape = useCallback(async () => {
    const saveSource = lastSaveSourceRef.current;
    lastSaveSourceRef.current = 'manual';
    // Save camera POV alongside every soundscape save
    saveCameraToStore();
    if (!globalSpeckleData?.model_id) return;
    if (isSavingSoundscape) return;

    const modelId = globalSpeckleData.model_id;
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

      // 2. Build analysis state (serialize cards, results, pending configs)
      const cardFlowState = useCardFlowStore.getState();
      const analysisStateData = buildAnalysisStateSave(
        analysis.analysisConfigs,
        analysis.analysisResults,
        textGen.pendingSoundConfigs,
        analysis.activeAnalysisTab,
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
      const saveModes = useAudioControlsStore.getState().soundSchedulingModes;
      const saveLinks = useAudioControlsStore.getState().iterationLinks;
      const saveMuted = [...useAudioControlsStore.getState().mutedSounds];
      const saveSoloed = useAudioControlsStore.getState().soloedSound;
      console.log('[DEBUG-SAVE] === save payload debug ===');
      console.log('[DEBUG-SAVE] mutedSounds:', JSON.stringify(saveMuted));
      console.log('[DEBUG-SAVE] soloedSound:', JSON.stringify(saveSoloed));
      console.log('[DEBUG-SAVE] soundSchedulingModes:', JSON.stringify(saveModes));
      console.log('[DEBUG-SAVE] soundTimestamps keys:', Object.keys(saveTimestamps));
      console.log('[DEBUG-SAVE] iterationLinks:', JSON.stringify(Object.keys(saveLinks)));
      for (const [k, v] of Object.entries(saveLinks)) {
        console.log(`[DEBUG-SAVE]   link[${k}] =`, JSON.stringify(v));
      }
      console.log('[DEBUG-SAVE] soundscapeData (events) count:', soundGen.soundscapeData?.length ?? 0);
      if (soundGen.soundscapeData) {
        for (const ev of soundGen.soundscapeData.slice(0, 5)) {
          console.log(`[DEBUG-SAVE]   event id=${ev.id} promptIdx=${ev.prompt_index} category=${(ev as any).category} copy_index=${(ev as any).copy_index} sched=${ev.scheduling_mode}`);
        }
      }
      console.log('[DEBUG-SAVE] soundConfigs count:', soundGen.soundConfigs.length);
      for (const c of soundGen.soundConfigs) {
        console.log(`[DEBUG-SAVE]   config prompt="${(c as any).prompt}" category="${(c as any).category}" type="${(c as any).type}"`);
      }
      const payload = buildSoundscapeSavePayload(
        modelId,
        modelId, // model_name - use model_id as fallback
        soundGen.soundConfigs,
        soundGen.soundscapeData ?? [],
        {
          duration: soundGen.globalDuration,
          steps: soundGen.globalSteps,
          negativePrompt: soundGen.globalNegativePrompt,
          audioModel: soundGen.audioModel,
        },
        useAudioControlsStore.getState().soundVolumes,
        useAudioControlsStore.getState().soundIntervals,
        uploadedFilenames,
        receivers.receivers,
        receivers.selectedReceiverId,
        acousticsSimulation.simulationConfigs,
        acousticsSimulation.activeSimulationIndex,
        resonanceAudioConfig,
        useAudioControlsStore.getState().soundSchedulingModes,
        useAudioControlsStore.getState().soundTimestamps,
        useAudioControlsStore.getState().iterationLinks,
        [...useAudioControlsStore.getState().mutedSounds],
        useAudioControlsStore.getState().soloedSound,
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

      // 4. Save Soundscape
      const result = await apiService.saveSoundscapeToSpeckle(payload);
      console.log('[page.tsx] Soundscape saved:', result.message);
    } catch (err) {
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
    receivers.receivers,
    receivers.selectedReceiverId,
    acousticsSimulation.simulationConfigs,
    acousticsSimulation.activeSimulationIndex,
    isSavingSoundscape,
    handleApiError,
    analysis.analysisConfigs,
    analysis.analysisResults,
    analysis.activeAnalysisTab,
    textGen.pendingSoundConfigs,
    resonanceAudioConfig,
  ]);

  // Keep the autosave ref in sync with the latest save handler
  saveSoundscapeRef.current = handleSaveSoundscape;

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

  // Note: Auto-upload is handled by the analysis.handleModelFileUpload in the effect below
  // This prevents duplicate uploads

  // Track configs that need file upload (model without speckleData, audio without buffer)
  // This avoids re-running on unrelated config changes (e.g. slider moves)
  const configsNeedingUpload = useMemo(() => {
    return analysis.analysisConfigs
      .map((config, index) => ({ config, index }))
      .filter(({ config }) =>
        (config.type === '3d-model' && config.modelFile && !config.speckleData) ||
        (config.type === 'audio' && config.audioFile && !config.audioBuffer)
      );
  }, [analysis.analysisConfigs]);

  // Auto-upload files when added to analysis configs
  useEffect(() => {
    configsNeedingUpload.forEach(({ config, index }) => {
      if (config.type === '3d-model' && config.modelFile && !config.speckleData) {
        const worldTree = viewerRef?.current?.getWorldTree();
        console.log('[page.tsx] Auto-uploading model file for config', index);
        analysis.handleModelFileUpload(index, config.modelFile, worldTree);
      } else if (config.type === 'audio' && config.audioFile && !config.audioBuffer) {
        analysis.handleAudioFileUpload(index, config.audioFile);
      }
    });
  }, [configsNeedingUpload, viewerRef]);

  // Populate entities from worldTree when it becomes available
  // (worldTreeReady state + poll effect + appIdToTreeIdMap are declared
  //  earlier in the component, before entity-link effects that depend on them)

  // Only track 3D model configs that need entity population (speckleData present, entities empty)
  // This avoids re-running on every slider/config change
  const modelConfigsNeedingEntities = useMemo(() => {
    return analysis.analysisConfigs
      .map((config, index) => ({ config, index }))
      .filter(({ config }) =>
        config.type === '3d-model' && config.speckleData && config.modelEntities.length === 0
      );
  }, [analysis.analysisConfigs]);

  useEffect(() => {
    if (!viewerRef?.current || !worldTreeReady) return;
    if (modelConfigsNeedingEntities.length === 0) return;

    const worldTree = viewerRef.current.getWorldTree();
    if (!worldTree) return;

    console.log('[page.tsx] WorldTree available, populating entities for', modelConfigsNeedingEntities.length, 'configs');

    modelConfigsNeedingEntities.forEach(({ index }) => {
      analysis.handleUpdateEntitiesFromWorldTree(index, worldTree);
    });
  }, [modelConfigsNeedingEntities, worldTreeReady, analysis.handleUpdateEntitiesFromWorldTree]);

  // Extract the latest 3D model config to derive stable sync keys.
  // The useMemo returns a new object only when sync-relevant fields change,
  // not on every slider/numSounds tweak.
  const latestModelConfig = useMemo(() => {
    const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model');
    if (modelConfigs.length === 0) return null;
    return modelConfigs[modelConfigs.length - 1] as import('@/types/analysis').ModelAnalysisConfig;
  }, [analysis.analysisConfigs]);

  // Derive individual stable values so the sync effect only fires when they change
  const syncGeometryData = latestModelConfig?.geometryData;
  const syncModelFile = latestModelConfig?.modelFile;
  const syncModelEntitiesLen = latestModelConfig?.modelEntities.length ?? 0;
  const syncSpeckleUrl = latestModelConfig?.speckleData?.url;
  const syncDiverseLen = latestModelConfig?.selectedDiverseEntities.length ?? 0;

  // Sync analysis model to main fileUpload state (for ThreeScene)
  useEffect(() => {
    if (!latestModelConfig) return;

    // Only sync if we have geometry data and it's different from current
    if (latestModelConfig.geometryData && latestModelConfig.geometryData !== fileUpload.geometryData) {
      fileUpload.processGeometry(latestModelConfig.geometryData);
    }

    // Sync model file if different
    if (latestModelConfig.modelFile && latestModelConfig.modelFile !== fileUpload.modelFile) {
      fileUpload.setModelFile(latestModelConfig.modelFile);
    }

    // Sync entities if available and different
    if (latestModelConfig.modelEntities.length > 0 &&
        JSON.stringify(latestModelConfig.modelEntities) !== JSON.stringify(fileUpload.modelEntities)) {
      fileUpload.setModelEntities(latestModelConfig.modelEntities);
    }

    // Sync speckle data for Speckle viewer
    if (latestModelConfig.speckleData && latestModelConfig.speckleData.url !== speckleModelUrl) {
      console.log('[page.tsx] Setting Speckle model URL:', latestModelConfig.speckleData.url);
      setSpeckleModelUrl(latestModelConfig.speckleData.url);
    }

    // Sync selectedDiverseEntities to textGen for ThreeScene highlighting
    if (latestModelConfig.selectedDiverseEntities.length > 0 &&
        JSON.stringify(latestModelConfig.selectedDiverseEntities) !== JSON.stringify(textGen.selectedDiverseEntities)) {
      textGen.setSelectedDiverseEntities(latestModelConfig.selectedDiverseEntities);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- use derived primitives as deps, not full config
  }, [syncGeometryData, syncModelFile, syncModelEntitiesLen, syncSpeckleUrl, syncDiverseLen, speckleModelUrl]);

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
      let objectId = ent.nodeId || ent.id;
      if (ent.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(ent.applicationId) || objectId;
      }
      if (objectId) unlinkObjectFromSound(objectId);
    }
    soundGen.handleRemoveConfig(index);
  }, [soundGen.soundConfigs, soundGen.handleRemoveConfig, unlinkObjectFromSound, appIdToTreeIdMap]);

  // Handle sound reset (remove generated sound but keep config)
  // Downgrades entity color from full pink → light pink
  const handleResetSound = useCallback((soundId: string, promptIndex: number) => {

    // Downgrade entity color from generated (full pink) to pending (light pink)
    const config = soundGen.soundConfigs[promptIndex];
    for (const ent of config?.entities || []) {
      let objectId = ent.nodeId || ent.id;
      if (ent.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(ent.applicationId) || objectId;
      }
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
  }, [soundGen.soundConfigs, soundGen.setSoundscapeData, soundGen.handleResetSoundConfig, linkObjectToSound, appIdToTreeIdMap]);

  // Handle sound card selection from ThreeScene (sound sphere click)
  const handleSelectSoundCard = useCallback((promptIndex: number) => {
    // Expand the card in the left sidebar
    setSelectedCardIndex(promptIndex);

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

  /**
   * Helper: Get current selectedDiverseEntities from analysis config
   */
  const getSelectedDiverseEntities = useCallback(() => {
    const modelConfig = analysis.analysisConfigs.find(c => c.type === '3d-model');
    return modelConfig?.type === '3d-model' ? modelConfig.selectedDiverseEntities : [];
  }, [analysis.analysisConfigs]);

  /**
   * Helper: Update selectedDiverseEntities in analysis config
   */
  const updateSelectedDiverseEntities = useCallback((entities: any[]) => {
    const modelConfigIndex = analysis.analysisConfigs.findIndex(c => c.type === '3d-model');
    if (modelConfigIndex !== -1) {
      analysis.handleUpdateConfig(modelConfigIndex, { selectedDiverseEntities: entities });
    }
  }, [analysis]);

  // Entity linking handlers
  const handleStartLinkingEntity = useCallback((configIndex: number) => {
    setIsLinkingEntity(true);
    setLinkingConfigIndex(configIndex);
    delete preGenActiveEntityRef.current[configIndex];
  }, []);

  const handleCancelLinkingEntity = useCallback(() => {
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
  }, []);

  const handleFinishLinkingEntity = useCallback(() => {
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
  }, []);

  const handleEntityLinked = useCallback((entity: any) => {
    if (linkingConfigIndex !== null) {
      const currentConfig = soundGen.soundConfigs[linkingConfigIndex];
      const previousEntities = currentConfig?.entities || [];

      // If entity is null (clicked on empty space) — ignore in multi-select mode
      if (entity === null) return;

      const objectId = entity.nodeId || entity.id;

      // Check if this entity is already linked — toggle it off
      const existingIdx = previousEntities.findIndex(
        (e: any) => (e.nodeId || e.id) === objectId
      );

      if (existingIdx >= 0) {
        // Unlink this specific entity
        const updatedEntities = previousEntities.filter((_, i) => i !== existingIdx);
        if (updatedEntities.length === 0) {
          soundGen.handleDetachSoundFromEntity(linkingConfigIndex);
        } else {
          soundGen.handleUpdateConfig(linkingConfigIndex, 'entities', updatedEntities);
          // If we removed the first entity (primary position), reposition to new first
          if (existingIdx === 0) {
            const newFirst = updatedEntities[0];
            const pos: [number, number, number] = newFirst.bounds?.center
              ? [newFirst.bounds.center[0], newFirst.bounds.center[1], newFirst.bounds.center[2]]
              : newFirst.position && newFirst.position.length >= 3
                ? [newFirst.position[0], newFirst.position[1], newFirst.position[2]]
                : [0, 0, 0];
            const generatedSound = soundGen.generatedSounds.find(s =>
              s.prompt_index === linkingConfigIndex ||
              (s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === linkingConfigIndex)
            );
            if (generatedSound) {
              soundGen.selectLinkedEntity(generatedSound.id, newFirst.index ?? 0, pos);
            }
          }
        }
        if (objectId) unlinkObjectFromSound(objectId);
        // Remove from diverse highlights
        const selectedEntities = getSelectedDiverseEntities();
        const updated = selectedEntities.filter(
          (e: any) => (e.nodeId || e.id) !== objectId
        );
        updateSelectedDiverseEntities(updated);
        return;
      }

      // Append this entity (multi-select by default)
      soundGen.handleAttachSoundToEntity(linkingConfigIndex, entity, true);

      // Link in Speckle context if it's a Speckle object
      if (objectId) linkObjectToSound(objectId, linkingConfigIndex);

      // Add new entity to diverse selection highlights
      const selectedEntities = getSelectedDiverseEntities();
      if (!selectedEntities.find((e: any) => (e.nodeId || e.id) === objectId)) {
        updateSelectedDiverseEntities([...selectedEntities, entity]);
      }
    }
  }, [linkingConfigIndex, soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities, linkObjectToSound, unlinkObjectFromSound]);

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
      let objectId = ent.nodeId || ent.id;
      if (ent.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(ent.applicationId) || objectId;
      }
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
  }, [soundGen, unlinkObjectFromSound, appIdToTreeIdMap]);

  /**
   * Toggle entity in diverse selection (for LLM prompts)
   * Used from entity overlay link button: grey <-> pink
   * Works with both Three.js entities (index) and Speckle objects (nodeId/id)
   *
   * Uses SpeckleSelectionModeContext directly so it works even without a 3D Model card.
   * The Model3DContextContent sync effect will update the card config if one exists.
   */
  const handleToggleDiverseSelection = useCallback((entity: any) => {
    const entityId = entity.nodeId || entity.id;

    if (entityId) {
      // Speckle object: use context methods directly
      const isCurrentlySelected = diverseSelectedObjectIds.has(entityId);

      if (isCurrentlySelected) {
        removeFromDiverseSelection(entityId);
      } else {
        addToDiverseSelection(entityId);
      }
    } else {
      // Three.js entity (legacy): fall back to config-based approach
      const selectedEntities = getSelectedDiverseEntities();
      const isCurrentlySelected = selectedEntities.some(e => e.index === entity.index);

      if (isCurrentlySelected) {
        updateSelectedDiverseEntities(selectedEntities.filter(e => e.index !== entity.index));
      } else {
        updateSelectedDiverseEntities([...selectedEntities, entity]);
      }
    }
  }, [diverseSelectedObjectIds, addToDiverseSelection, removeFromDiverseSelection, getSelectedDiverseEntities, updateSelectedDiverseEntities]);

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

    // Add entity to diverse selection (pink highlight)
    const selectedEntities = getSelectedDiverseEntities();
    if (!selectedEntities.some(e => e.index === entity.index)) {
      updateSelectedDiverseEntities([...selectedEntities, entity]);
    }
  }, [soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities]);

  /**
   * Wrapper for handleUpdateConfig that handles entity unlinking
   * When an entity is unlinked (set to undefined), also remove it from highlights
   */
  const handleUpdateSoundConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: any) => {
    // Check if we're unlinking entities
    if (field === 'entities' && (!value || (Array.isArray(value) && value.length === 0))) {
      const currentConfig = soundGen.soundConfigs[index];
      const previousEntities = currentConfig?.entities || [];

      // Remove all previous entities from highlights
      if (previousEntities.length) {
        const selectedEntities = getSelectedDiverseEntities();
        const updatedEntities = selectedEntities.filter(
          (e: any) => !previousEntities.some((pe: any) => pe.index === e.index)
        );
        updateSelectedDiverseEntities(updatedEntities);
      }
    }

    // Call the original handler
    soundGen.handleUpdateConfig(index, field, value);
  }, [soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities]);

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
   * Handle IR gain changes from import-irs advanced settings.
   */
  const handleIRGainChange = useCallback((_index: number, gainDb: number) => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator && typeof (orchestrator as any).setIRGain === 'function') {
      (orchestrator as any).setIRGain(gainDb);
    }
  }, []);

  const handleIRNormalizeChange = useCallback((_index: number, enabled: boolean) => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator && typeof (orchestrator as any).setNormalize === 'function') {
      (orchestrator as any).setNormalize(enabled);
    }
  }, []);

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
    setGlobalSoundSpeed(343);
    setGlobalMeshLc(1.5);
    useAudioControlsStore.getState().resetGlobalBaseDbfs();
    setShowGroundGrid(false);
    setGroundGridSpacing(2);
    setGroundGridColor('#888888');
  }, [soundGen.handleResetToDefaults, audioNormalization.reset,
      setShowLabelSprites, setShowHoveringHighlight, setShowSoundSpheres, setShowSceneListeners,
      setGlobalSoundSpeed, setGlobalMeshLc,
      setShowGroundGrid, setGroundGridSpacing, setGroundGridColor]);

  const handleDeleteHistory = useCallback(async () => {
    const modelId = useUIStore.getState().globalSpeckleData?.model_id;
    if (!modelId) return;
    try {
      await apiService.deleteSoundscapeHistory(modelId);
    } catch {
      // proceed with reload even if API fails
    }
    window.location.reload();
  }, []);

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
    // Stop playback before switching modes to ensure clean state
    if (useAudioControlsStore.getState().isAnyPlaying()) {
      useAudioControlsStore.getState().stopAll();
    }

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

  // Handler: Go To Receiver (activates first-person view at receiver position)
  const handleGoToReceiver = useCallback((receiverId: string) => {
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
        return;
      }
    }

    console.warn('[Page] handleGoToReceiver: Receiver not found:', receiverId);
  }, [receivers.receivers, gridListeners.gridListeners, audioOrchestrator, acousticsSimulation.activeSimulationIndex, acousticsSimulation.simulationConfigs, addError]);

  // Handler: Receiver mesh double-clicked in 3D scene →
  //   switch to Listeners tab + expand card for single listeners; for grid points just enter FPS
  const handleReceiverDoubleClickedInScene = useCallback((receiverId: string) => {
    const isGridPoint = gridListeners.gridListeners.some(g => receiverId.startsWith(g.id + '-'));
    if (!isGridPoint) {
      setForcedExpandedListenerId(receiverId);
      setTimeout(() => setForcedExpandedListenerId(null), 200);
    }
    handleGoToReceiver(receiverId);
  }, [handleGoToReceiver, gridListeners.gridListeners]);

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

      // Expand listener card only for single receivers (grid points have no card)
      if (receivers.receivers.some(r => r.id === nextId)) {
        setForcedExpandedListenerId(nextId);
        setTimeout(() => setForcedExpandedListenerId(null), 200);
      }

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
      navigator.sendBeacon(`${API_BASE_URL}/api/cleanup-generated-sounds`);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      {/* Main 3D Scene - Fixed at screen center, full size, lowest z-index */}
      <main className="absolute inset-0">
        {/* Viewer Toggle Button - Top Left */}
        <div className="absolute top-4 left-4 z-50">
        </div>

        {/* Toggle between Speckle Scene and Three.js Scene */}
        {useSpeckleViewer ? (
          <SpeckleScene
            speckleData={(() => {
              // Priority: config with speckleData > globalSpeckleData
              const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model') as import('@/types/analysis').ModelAnalysisConfig[];
              // Find the latest config that actually has speckleData
              const configWithSpeckle = [...modelConfigs].reverse().find(c => c.speckleData !== undefined);
              if (configWithSpeckle?.speckleData) {
                return configWithSpeckle.speckleData;
              }
              // Fall back to globally loaded model
              return globalSpeckleData;
            })()}
            onViewerLoaded={handleSpeckleViewerLoaded}
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
            // Sound Linking (entity linking from SoundCard to Speckle object)
            entitiesWithLinkedSounds={(() => {
              const linked = new Set<number>();
              // Only highlight entities when in the Sounds step
              if (!isInSoundsStep) return linked;
              soundGen.soundConfigs.forEach((config) => {
                // Match same parent logic as unifiedSoundscapeData
                if (activeSoundParentIndex !== null
                  ? config.parentUsageOriginalIndex !== activeSoundParentIndex
                  : config.parentUsageOriginalIndex !== undefined && config.parentUsageOriginalIndex !== null
                ) return;
                if (config.entity && config.entity.id !== undefined) {
                  const entityIndex = typeof config.entity.id === 'number'
                    ? config.entity.id
                    : parseInt(config.entity.id, 10);
                  if (!isNaN(entityIndex)) {
                    linked.add(entityIndex);
                  }
                }
              });
              return linked;
            })()}
            onToggleDiverseSelection={handleToggleDiverseSelection}
            // Sound card selection (for expand/highlight logic)
            selectedCardIndex={selectedCardIndex}
            onSelectSoundCard={handleSelectSoundCard}
            // Entity linking (sound-to-Speckle-object linking)
            isLinkingEntity={isLinkingEntity}
            linkingConfigIndex={linkingConfigIndex}
            onEntityLinked={handleEntityLinked}
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
            onSaveSoundscape={handleSaveSoundscape}
            isSavingSoundscape={isSavingSoundscape}
            // FPS mode programmatic exit
            exitFPSTrigger={exitFPSTrigger}
            // Receiver mesh double-click → expand listener card + enter FPS mode
            onReceiverDoubleClicked={handleReceiverDoubleClickedInScene}
            // FPS exit via Escape → collapse listener card
            onFPSExited={() => { setCollapseListenerCardTrigger(t => t + 1); setIsFPSModeActive(false); setActiveIRGroupId(null); }}
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
      </main>

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
        useModelAsContext={fileUpload.useModelAsContext}
        onFileChange={handleFileChangeWithSEDClear}
        onDragOver={fileUpload.handleDragOver}
        onDragLeave={fileUpload.handleDragLeave}
        onDrop={fileUpload.handleDrop}
        onUploadModel={fileUpload.handleUploadModel}
        onLoadSampleIfc={() => {}}
        setUseModelAsContext={fileUpload.setUseModelAsContext}
        activeLoadTab={activeLoadTab}
        setActiveLoadTab={setActiveLoadTab}

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

        // Text generation props
        aiPrompt={textGen.aiPrompt}
        numSounds={textGen.numSounds}
        isGenerating={textGen.isGenerating}
        aiError={textGen.aiError}
        aiResponse={textGen.aiResponse}
        llmProgress={textGen.llmProgress}
        showConfirmLoadSounds={textGen.showConfirmLoadSounds}
        pendingSoundConfigs={textGen.pendingSoundConfigs}
        selectedDiverseEntities={textGen.selectedDiverseEntities}
        isAnalyzingEntities={textGen.isAnalyzingEntities}
        setAiPrompt={textGen.setAiPrompt}
        setNumSounds={textGen.setNumSounds}
        onGenerateText={textGen.handleGenerateText}
        onAnalyzeModel={textGen.handleAnalyzeModel}
        onStopGeneration={textGen.handleStopGeneration}
        onLoadSoundsToGeneration={handleLoadSoundsToGeneration}

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
        // Analysis props
        analysisConfigs={analysis.analysisConfigs}
        stepAdvanceTrigger={stepAdvanceTrigger}
        isAnalyzing={analysis.isAnalyzing}
        analysisResult={analysis.analysisResults}
        hasGlobalModelLoaded={globalSpeckleData !== null}
        onAddAnalysisConfig={handleAddAnalysisConfig}
        onRemoveAnalysisConfig={analysis.handleRemoveConfig}
        onUpdateAnalysisConfig={analysis.handleUpdateConfig}
        onAnalyze={handleAnalyzeWithContext}
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
        globalDuration={soundGen.globalDuration}
        globalSteps={soundGen.globalSteps}
        globalNegativePrompt={soundGen.globalNegativePrompt}
        applyDenoising={soundGen.applyDenoising}
        trimSilence={soundGen.trimSilence}
        applyNoiseReduction={soundGen.applyNoiseReduction}
        normalizeImpulseResponses={auralizationConfig.normalize}
        audioModel={soundGen.audioModel}
        llmModel={soundGen.llmModel}
        onGlobalDurationChange={soundGen.handleGlobalDurationChange}
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
        onExitFPS={() => setExitFPSTrigger(t => t + 1)}
        isFPSModeActive={isFPSModeActive}
        forcedActiveGroupId={activeIRGroupId}
        forcedExpandedListenerId={forcedExpandedListenerId}
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
        speckleData={(() => {
          const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model') as import('@/types/analysis').ModelAnalysisConfig[];
          const configWithSpeckle = [...modelConfigs].reverse().find(c => c.speckleData !== undefined);
          if (configWithSpeckle?.speckleData) return configWithSpeckle.speckleData;
          return globalSpeckleData;
        })()}
        soundscapeData={soundGen.soundscapeData}
        onIRImported={handleIRImported}
        irRefreshTrigger={irRefreshTrigger}
        // Acoustics simulation state
        simulationConfigs={acousticsSimulation.simulationConfigs}
        activeSimulationIndex={acousticsSimulation.activeSimulationIndex}
        onAddSimulationConfig={acousticsSimulation.handleAddConfig}
        onRemoveSimulationConfig={acousticsSimulation.handleRemoveConfig}
        onUpdateSimulationConfig={acousticsSimulation.handleUpdateConfig}
        onSetActiveSimulation={acousticsSimulation.handleSetActiveSimulation}
        onUpdateSimulationName={acousticsSimulation.handleUpdateSimulationName}
        onIRHover={handleIRHover}
        fpsExitTrigger={collapseListenerCardTrigger}
        onIRGainChange={handleIRGainChange}
        onIRNormalizeChange={handleIRNormalizeChange}
        listenerOrientation={listenerOrientation}
      />
    </div>
  );
}

export default function Home() {
  // Zustand persist rehydration — must run OUTSIDE Suspense so it fires
  // BEFORE child mount effects (Sidebar, Timeline, Explorer on mount read
  // the store and expect rehydration to have completed).
  useEffect(() => {
    (useUIStore as any).persist?.rehydrate?.();
    (useCardFlowStore as any).persist?.rehydrate?.();
    (useAudioControlsStore as any).persist?.rehydrate?.();
    (useRightSidebarStore as any).persist?.rehydrate?.();
    (useAcousticLayerStore as any).persist?.rehydrate?.();

    // On homepage (no model_id URL), force panels collapsed/hidden.
    const urlModelId = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('model_id') : null;
    if (!urlModelId) {
      useUIStore.getState().setIsLeftSidebarExpanded(false);
      useUIStore.getState().setShowTimeline(false);
      useUIStore.getState().setShowObjectExplorer(false);
      useRightSidebarStore.getState().requestCollapse();
    }
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

"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { SpeckleScene } from "@/components/scene/SpeckleScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
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
  useSEDStore,
  useRoomMaterialsStore,
  useRightSidebarStore,
  useUIStore,
  useGridListenersStore,
} from "@/store";
import * as THREE from "three";
import { useAudioNormalization } from "@/hooks/useAudioNormalization";
import { useAudioOrchestrator } from "@/hooks/useAudioOrchestrator";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { apiService } from "@/services/api";
import { API_BASE_URL, RECEIVER_CONFIG, SPIRAL_PLACEMENT } from "@/utils/constants";
import { getCameraFrontSpiralPosition } from "@/lib/three/spiral-placement";
import type { LoadTab, SoundGenerationConfig } from "@/types";
import type { SelectedGeometry, AcousticMaterial } from "@/types/materials";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";
import { buildSoundscapeSavePayload, restoreSoundscapeState, getBlobUrlSounds } from "@/utils/soundscape-serializer";

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

function HomeContent() {
  useUndoRedo();

  const fileUpload = useFileUploadStore();
  const handleApiError = useApiErrorHandler();
  const textGen = useTextGenerationStore();
  const soundGen = useSoundscapeStore();

  // Sync generated sounds to store so audioControlsStore can access them
  const syncGeneratedSounds = useAudioControlsStore((s) => s.syncGeneratedSounds);
  useEffect(() => {
    syncGeneratedSounds(soundGen.generatedSounds);
  }, [soundGen.generatedSounds, syncGeneratedSounds]);

  const analysis = useAnalysisStore();

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

  // Callback when Speckle viewer is loaded
  const handleSpeckleViewerLoaded = useCallback((viewer: import('@speckle/viewer').Viewer) => {
    console.log('Speckle viewer loaded:', viewer);
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

  // Auto-hide bounding box when not in ResonanceMode
  useEffect(() => {
    if (!audioOrchestrator.status) return;

    const currentMode = audioOrchestrator.status.currentMode;

    // Only show bounding box in ResonanceMode (no_ir_resonance)
    if (currentMode !== 'no_ir_resonance' && showBoundingBox) {
      setShowBoundingBox(false);
    }
  }, [audioOrchestrator.status?.currentMode, showBoundingBox]);

  // Helper: check if a simulation config has a source-receiver IR mapping (completed simulation)
  const getSimIRMapping = useCallback((index: number | null) => {
    if (index === null) return null;
    const config = acousticsSimulation.simulationConfigs[index];
    if (!config || config.type !== 'pyroomacoustics') return null;
    return (config as any).sourceReceiverIRMapping || null;
  }, [acousticsSimulation.simulationConfigs]);

  // Set source-receiver IR mapping when simulation completes (PyroomAcoustics)
  // Uses hot-swap (no stop) when already in IR mode and switching between completed simulations
  const prevIRMappingIndexRef = useRef<number | null>(acousticsSimulation.activeSimulationIndex);

  useEffect(() => {
    if (!audioOrchestrator.orchestrator) return;

    // Check if active simulation is Pyroomacoustics and has source-receiver mapping
    if (acousticsSimulation.activeSimulationIndex !== null) {
      const activeConfig = acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex];

      if (activeConfig && activeConfig.type === 'pyroomacoustics') {
        const pyroomConfig = activeConfig as any;

        // If simulation has source-receiver IR mapping, pass it to AudioOrchestrator
        if (pyroomConfig.sourceReceiverIRMapping) {
          const initialReceiverId = receivers.receivers.length > 0 ? receivers.receivers[0].id : undefined;

          // Determine if we can hot-swap: already in AMBISONIC_IR mode and previous sim also had IR mapping
          const prevMapping = getSimIRMapping(prevIRMappingIndexRef.current);
          const currentMode = audioOrchestrator.orchestrator.getCurrentMode();
          const canHotSwap = prevMapping !== null && currentMode === 'ambisonic_ir';

          if (canHotSwap) {
            console.log('[Page] Hot-swapping IR mapping (no stop)', {
              simulationId: activeConfig.id,
              sourceCount: Object.keys(pyroomConfig.sourceReceiverIRMapping).length
            });
            audioOrchestrator.orchestrator.hotSwapSourceReceiverIRMapping(
              pyroomConfig.sourceReceiverIRMapping,
              'pyroomacoustics',
              initialReceiverId
            ).then(() => {
              console.log('[Page] ✅ IR mapping hot-swapped successfully');
            }).catch(error => {
              console.error('[Page] ❌ Failed to hot-swap IR mapping:', error);
            });
          } else {
            console.log('[Page] Setting source-receiver IR mapping from simulation', {
              simulationId: activeConfig.id,
              hasMapping: !!pyroomConfig.sourceReceiverIRMapping,
              sourceCount: Object.keys(pyroomConfig.sourceReceiverIRMapping).length
            });
            audioOrchestrator.orchestrator.setSourceReceiverIRMapping(
              pyroomConfig.sourceReceiverIRMapping,
              'pyroomacoustics',
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

  // FPS mode programmatic exit trigger (increment to exit first-person mode)
  const [exitFPSTrigger, setExitFPSTrigger] = useState(0);

  // Forced expanded listener card (from scene mesh double-click)
  const [forcedExpandedListenerId, setForcedExpandedListenerId] = useState<string | null>(null);

  // Collapse all listener cards trigger (from FPS exit via Escape)
  const [collapseListenerCardTrigger, setCollapseListenerCardTrigger] = useState(0);

  // Expanded grid listener ID (controls which grid's points are rendered in 3D)
  const [expandedGridListenerId, setExpandedGridListenerId] = useState<string | null>(null);

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
      if (!config?.entity) return;

      // Resolve the object ID: if the entity has an applicationId (Rhino GUID from saved data),
      // remap it to the current Speckle tree ID. Speckle IDs change on every commit.
      let objectId = config.entity.nodeId || config.entity.id;
      if (config.entity.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(config.entity.applicationId) || objectId;
      }
      if (!objectId) return;

      // Register the entity-sound link in SpeckleSelectionModeContext
      // Pass hasGeneratedSound=true since this effect runs for generated sounds
      linkObjectToSound(objectId, promptIndex, true);
    });
  }, [soundGen.generatedSounds, soundGen.soundConfigs, soundGen.soundscapeData, linkObjectToSound, appIdToTreeIdMap]);

  // ============================================================================
  // Effect - Register Pending Entity Links for Sound Configs (light pink)
  // When configs arrive with pre-attached entity data (e.g. from Analysis tab),
  // register them as pending links so the entity gets light pink coloring.
  // ============================================================================
  useEffect(() => {
    soundGen.soundConfigs.forEach((config, index) => {
      if (!config.entity) return;
      // Resolve applicationId (Rhino GUID) to current Speckle tree ID
      let objectId = config.entity.nodeId || config.entity.id;
      if (config.entity.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(config.entity.applicationId) || objectId;
      }
      if (!objectId || linkedObjectIds.has(objectId)) return;
      // Register as pending (no generated sound yet) → light pink
      linkObjectToSound(objectId, index);
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
      let configObjectId = config?.entity?.nodeId || config?.entity?.id;
      // Resolve applicationId to current tree ID for comparison
      if (config?.entity?.applicationId && appIdToTreeIdMap.size > 0) {
        configObjectId = appIdToTreeIdMap.get(config.entity.applicationId) || configObjectId;
      }
      // If the config is gone or its entity no longer matches, unlink
      if (!config || !configObjectId || configObjectId !== objectId) {
        unlinkObjectFromSound(objectId);
      }
    });
  }, [soundGen.soundConfigs, unlinkObjectFromSound, appIdToTreeIdMap]);

  // Handler: Refresh bounding box calculation from sound sources
  const handleRefreshBoundingBox = useCallback(() => {
    triggerBoundingBoxRefresh();
    console.log('[Page] Triggering bounding box refresh');
  }, []);

  // Load sounds from text generation into sound generation tab
  const handleLoadSoundsToGeneration = useCallback(() => {
    if (textGen.pendingSoundConfigs.length > 0) {
      soundGen.setSoundConfigsFromPrompts(textGen.pendingSoundConfigs);
      textGen.setActiveAiTab('sound');
      // Don't clear pendingSoundConfigs - allow loading multiple times
    }
  }, [textGen.pendingSoundConfigs, soundGen, textGen]);

  // Handler: Send analysis prompts to sound generation
  const handleSendAnalysisToGeneration = useCallback(() => {
    analysis.handleSendToSoundGeneration((prompts) => {
      // Convert text prompts to sound configs
      const newConfigs = prompts.map(p => ({
        prompt: p.text,
        duration: p.metadata?.duration_seconds ?? 10, // Use duration from metadata
        guidance_scale: 4.5,
        negative_prompt: '',
        seed_copies: 1,
        steps: 100,
        spl_db: p.metadata?.spl_db ?? 60, // Default SPL if not provided
        interval_seconds: p.metadata?.interval_seconds ?? 5, // Default interval if not provided
        display_name: p.text.length > 50 ? p.text.substring(0, 47) + '...' : p.text,
        // Preserve entity association for 3D model sounds, or use area-drawn position
        entity: p.entity || (p.position ? { position: p.position, index: undefined } : undefined)
      }));

      console.log('[Analysis→SoundGen] Converted configs with metadata:', 
        newConfigs.map(c => ({ prompt: c.prompt.substring(0, 30), duration: c.duration, spl_db: c.spl_db, interval_seconds: c.interval_seconds, hasEntity: !!c.entity })));

      // Add to sound generation
      soundGen.setSoundConfigsFromPrompts(newConfigs);
      
      // Switch to sound generation tab
      textGen.setActiveAiTab('sound');

      console.log(`Loaded ${newConfigs.length} prompts from analysis to sound generation`);
    });
  }, [analysis, soundGen, textGen]);

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
    if (type === '3d-model' && globalSpeckleData) {
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

    // Switch to sound generation tab
    textGen.setActiveAiTab('sound');

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

        console.log(
          `[page.tsx] Restored ${restored.soundConfigs.length} configs, ` +
          `${restored.soundEvents.length} events`
        );
      }
    } catch (err) {
      console.warn('[page.tsx] Failed to auto-load soundscape:', err);
    }
  }, [
    soundGen.restoreSoundscape,
    receivers.restoreReceivers,
    acousticsSimulation.restoreSimulationState,
  ]);

  // Save current soundscape state to Speckle + local storage
  const handleSaveSoundscape = useCallback(async () => {
    if (!globalSpeckleData?.model_id || !soundGen.soundscapeData?.length) return;
    if (isSavingSoundscape) return;

    const modelId = globalSpeckleData.model_id;
    setIsSavingSoundscape(true);
    try {
      // 1. Upload blob-URL audio files (library/uploaded sounds) to the server
      const blobSounds = getBlobUrlSounds(soundGen.soundscapeData);
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

      // 2. Build save payload (with server filenames for blob sounds + simulation state)
      const payload = buildSoundscapeSavePayload(
        modelId,
        modelId, // model_name - use model_id as fallback
        soundGen.soundConfigs,
        soundGen.soundscapeData,
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
      );

      // 3. Save to Speckle + local
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
  ]);

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
    // Unlink entity from Speckle filtering before removing the config
    const config = soundGen.soundConfigs[index];
    if (config?.entity) {
      let objectId = config.entity.nodeId || config.entity.id;
      if (config.entity.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(config.entity.applicationId) || objectId;
      }
      if (objectId) {
        unlinkObjectFromSound(objectId);
      }
    }
    soundGen.handleRemoveConfig(index);
  }, [soundGen.soundConfigs, soundGen.handleRemoveConfig, unlinkObjectFromSound, appIdToTreeIdMap]);

  // Handle sound reset (remove generated sound but keep config)
  // Downgrades entity color from full pink → light pink
  const handleResetSound = useCallback((soundId: string, promptIndex: number) => {

    // Downgrade entity color from generated (full pink) to pending (light pink)
    const config = soundGen.soundConfigs[promptIndex];
    if (config?.entity) {
      let objectId = config.entity.nodeId || config.entity.id;
      if (config.entity.applicationId && appIdToTreeIdMap.size > 0) {
        objectId = appIdToTreeIdMap.get(config.entity.applicationId) || objectId;
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
    // Only expand the card in the left sidebar if already on the Sounds tab
    if (textGen.activeAiTab === 'sound') {
      setSelectedCardIndex(promptIndex);
    }

    // Set selectedEntity with objectType 'Sound' → triggers right sidebar expansion
    const sound = soundGen.generatedSounds.find(s => s.prompt_index === promptIndex);
    const soundName = sound?.display_name || sound?.prompt || `Sound #${promptIndex + 1}`;

    setSelectedEntity({
      objectId: `sound_prompt_${promptIndex}`,
      objectName: soundName,
      objectType: 'Sound',
      soundData: { promptIndex },
    });
  }, [textGen.activeAiTab, soundGen.generatedSounds, setSelectedEntity]);

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
  }, []);

  const handleCancelLinkingEntity = useCallback(() => {
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
  }, []);

  const handleEntityLinked = useCallback((entity: any) => {
    if (linkingConfigIndex !== null) {
      const currentConfig = soundGen.soundConfigs[linkingConfigIndex];
      const previousEntity = currentConfig?.entity;

      // If entity is null (clicked on empty space)
      if (entity === null) {
        // If there's a currently linked entity, unlink it
        if (previousEntity) {
          // Detach sound from entity (creates sound sphere, updates soundscapeData)
          soundGen.handleDetachSoundFromEntity(linkingConfigIndex);
          
          // Unlink from Speckle context if it's a Speckle object
          const objectId = previousEntity.nodeId || previousEntity.id;
          if (objectId) {
            unlinkObjectFromSound(objectId);
          }

          // Remove the previous entity from highlights
          const selectedEntities = getSelectedDiverseEntities();
          const updatedEntities = selectedEntities.filter(
            e => e.index !== previousEntity.index
          );
          updateSelectedDiverseEntities(updatedEntities);
        }

        // Exit linking mode (whether we unlinked or not)
        setIsLinkingEntity(false);
        setLinkingConfigIndex(null);
        return;
      }

      // Entity is not null - link the new entity
      // This will destroy sound sphere (if exists) and move overlay to entity
      soundGen.handleAttachSoundToEntity(linkingConfigIndex, entity);
      
      // Link in Speckle context if it's a Speckle object
      const objectId = entity.nodeId || entity.id;
      if (objectId) {
        linkObjectToSound(objectId, linkingConfigIndex);
      }

      // Update diverse selection to highlight the new entity
      let updatedEntities = [...getSelectedDiverseEntities()];

      // Remove the previous entity from highlights if it exists
      if (previousEntity) {
        updatedEntities = updatedEntities.filter(e => e.index !== previousEntity.index);
        
        // Unlink previous Speckle object
        const prevObjectId = previousEntity.nodeId || previousEntity.id;
        if (prevObjectId) {
          unlinkObjectFromSound(prevObjectId);
        }
      }

      // Add the new entity to highlights if not already present
      if (!updatedEntities.find(e => e.index === entity.index)) {
        updatedEntities.push(entity);
      }

      updateSelectedDiverseEntities(updatedEntities);

      setIsLinkingEntity(false);
      setLinkingConfigIndex(null);
    }
  }, [linkingConfigIndex, soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities, linkObjectToSound, unlinkObjectFromSound]);

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
    const configIndex = soundGen.soundConfigs.findIndex(config => config.entity?.index === entity.index);

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
    // Check if we're unlinking an entity
    if (field === 'entity' && value === undefined) {
      const currentConfig = soundGen.soundConfigs[index];
      const previousEntity = currentConfig?.entity;

      // If there was a previous entity, remove it from highlights
      if (previousEntity) {
        const selectedEntities = getSelectedDiverseEntities();
        const updatedEntities = selectedEntities.filter(
          e => e.index !== previousEntity.index
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
   * Toggle IR normalization
   */
  const handleToggleNormalize = useCallback((enabled: boolean) => {
    audioNormalization.toggleNormalize(enabled);
  }, [audioNormalization]);

  const handleResetAdvancedSettings = useCallback(() => {
    soundGen.handleResetToDefaults();
    audioNormalization.reset();
    setShowAxesHelper(false);
  }, [soundGen.handleResetToDefaults, audioNormalization.reset]);

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

  const resonanceAudioConfig = {
    enabled: audioOrchestrator.status?.currentMode === 'no_ir_resonance',
    ambisonicOrder: audioOrchestrator.status?.ambisonicOrder || 1,
    roomDimensions: roomMaterials.roomDimensions,
    roomMaterials: roomMaterials.roomMaterials
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
  }, [receivers.receivers, gridListeners.gridListeners, audioOrchestrator]);

  // Handler: Receiver mesh double-clicked in 3D scene →
  //   switch to Listeners tab + expand card for single listeners; for grid points just enter FPS
  const handleReceiverDoubleClickedInScene = useCallback((receiverId: string) => {
    const isGridPoint = gridListeners.gridListeners.some(g => receiverId.startsWith(g.id + '-'));
    if (!isGridPoint) {
      textGen.setActiveAiTab('listeners');
      setForcedExpandedListenerId(receiverId);
      setTimeout(() => setForcedExpandedListenerId(null), 200);
    }
    handleGoToReceiver(receiverId);
  }, [textGen, handleGoToReceiver, gridListeners.gridListeners]);

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
    receivers.addReceiver(type, position);
  }, [viewerRef, receivers.addReceiver]);

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

  // Compute bounding box for a list of Speckle object IDs using batch render views
  const computeBoundsForObjectIds = useCallback(
    (objectIds: string[]): { min: [number, number, number]; max: [number, number, number] } | null => {
      const viewer = viewerRef?.current;
      if (!viewer || objectIds.length === 0) return null;
      try {
        const r = (viewer as any).getRenderer();
        const bIds: string[] = (r as any).getBatchIds?.() ?? [];
        const idSet = new Set(objectIds);
        const unionBox = new THREE.Box3();
        let hasBox = false;
        for (const bid of bIds) {
          const b = (r as any).getBatch?.(bid);
          if (!b) continue;
          for (const rv of (b.renderViews ?? [])) {
            const objId: string | undefined = rv.renderData?.id;
            if (!objId || !idSet.has(objId)) continue;
            const aabb = rv.aabb as THREE.Box3 | undefined;
            if (!aabb) continue;
            unionBox.union(aabb);
            hasBox = true;
          }
        }
        if (!hasBox) return null;
        return {
          min: [unionBox.min.x, unionBox.min.y, unionBox.min.z],
          max: [unionBox.max.x, unionBox.max.y, unionBox.max.z],
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

  // Cleanup on unmount
  useEffect(() => {
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
    <div className="relative w-screen h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      {/* Main 3D Scene - Fixed at screen center, full size, lowest z-index */}
      <main className="absolute inset-0 z-0">
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
            // Soundscape data
            soundscapeData={soundGen.soundscapeData}
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
            // Sound sphere position update (for simulation sync when dragging)
            onUpdateSoundPosition={soundGen.updateSoundPosition}
            // Sound Linking (entity linking from SoundCard to Speckle object)
            entitiesWithLinkedSounds={(() => {
              // Build set of entity indices that have sounds linked
              const linked = new Set<number>();
              soundGen.soundConfigs.forEach((config) => {
                if (config.entity && config.entity.id !== undefined) {
                  // Parse entity index from entity.id if numeric
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
          <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
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
        modelFile={fileUpload.modelFile}
        speckleData={(() => {
          // Priority: config with speckleData > globalSpeckleData
          const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model') as import('@/types/analysis').ModelAnalysisConfig[];
          const configWithSpeckle = [...modelConfigs].reverse().find(c => c.speckleData !== undefined);
          if (configWithSpeckle?.speckleData) {
            return configWithSpeckle.speckleData;
          }
          return globalSpeckleData;
        })()}
        audioFile={fileUpload.audioFile}
        geometryData={fileUpload.geometryData}
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
        soundGenError={soundGen.soundGenError}
        generatedSounds={soundGen.generatedSounds}
        globalDuration={soundGen.globalDuration}
        globalSteps={soundGen.globalSteps}
        globalNegativePrompt={soundGen.globalNegativePrompt}
        applyDenoising={soundGen.applyDenoising}
        audioModel={soundGen.audioModel}
        llmModel={soundGen.llmModel}
        setActiveSoundConfigTab={soundGen.setActiveSoundConfigTab}
        onAddSoundConfig={soundGen.handleAddConfig}
        onBatchAddSoundConfigs={soundGen.handleBatchAddConfigs}
        onRemoveSoundConfig={handleRemoveSoundConfig}
        onUpdateSoundConfig={handleUpdateSoundConfig}
        onSoundTypeChange={soundGen.handleTypeChange}
        onGenerateSounds={soundGen.handleGenerate}
        onStopSoundGeneration={soundGen.handleStopGeneration}
        onGlobalDurationChange={soundGen.handleGlobalDurationChange}
        onGlobalStepsChange={soundGen.handleGlobalStepsChange}
        onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
        onApplyDenoisingChange={soundGen.setApplyDenoising}
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
        isLinkingEntity={isLinkingEntity}
        linkingConfigIndex={linkingConfigIndex}
        useSpeckleViewer={useSpeckleViewer}
        onResetSound={handleResetSound}
        onDuplicateConfig={soundGen.handleDuplicateConfig}
        onSelectSoundCard={handleSelectSoundCard}
        selectedCardIndex={selectedCardIndex}
        // AI tab props
        activeAiTab={textGen.activeAiTab}
        setActiveAiTab={textGen.setActiveAiTab}

        // Soundscape data
        soundscapeData={soundGen.soundscapeData}

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
        onToggleResonanceAudio={() => {}} // No-op: mode switching handled by audioRenderingMode
        onUpdateRoomMaterials={handleUpdateRoomMaterials}
        hasGeometry={fileUpload.geometryData !== null}
        showBoundingBox={showBoundingBox}
        onToggleBoundingBox={setShowBoundingBox}
        onRefreshBoundingBox={handleRefreshBoundingBox}
        roomScale={roomScale}
        onRoomScaleChange={setRoomScale}

        // Audio Orchestrator props (TODO: Phase 1-6)
        audioRenderingMode={audioRenderingMode}
        onAudioRenderingModeChange={handleAudioRenderingModeChange}

        // Material assignment props (NEW)
        modelType={modelType}
        selectedGeometry={selectedGeometry}
        onSelectGeometry={handleSelectGeometry}
        onHoverGeometry={handleHoverGeometry}
        onAssignMaterial={handleAssignMaterial}
        onIRImported={handleIRImported}
        irRefreshTrigger={irRefreshTrigger}

        // Acoustics simulation state (passed down to avoid duplicate hook calls)
        simulationConfigs={acousticsSimulation.simulationConfigs}
        activeSimulationIndex={acousticsSimulation.activeSimulationIndex}
        expandedTabIndex={acousticsSimulation.expandedTabIndex}
        onAddSimulationConfig={acousticsSimulation.handleAddConfig}
        onRemoveSimulationConfig={acousticsSimulation.handleRemoveConfig}
        onUpdateSimulationConfig={acousticsSimulation.handleUpdateConfig}
        onSetActiveSimulation={acousticsSimulation.handleSetActiveSimulation}
        onUpdateSimulationName={acousticsSimulation.handleUpdateSimulationName}
        onToggleExpandSimulation={acousticsSimulation.handleToggleExpand}
        onIRHover={handleIRHover}

        // Analysis props
        analysisConfigs={analysis.analysisConfigs}
        activeAnalysisTab={analysis.activeAnalysisTab}
        isAnalyzing={analysis.isAnalyzing}
        analysisError={analysis.analysisError}
        analysisResult={analysis.analysisResults}
        hasGlobalModelLoaded={globalSpeckleData !== null}
        onAddAnalysisConfig={handleAddAnalysisConfig}
        onRemoveAnalysisConfig={analysis.handleRemoveConfig}
        onUpdateAnalysisConfig={analysis.handleUpdateConfig}
        onSetActiveAnalysisTab={analysis.setActiveAnalysisTab}
        onAnalyze={handleAnalyzeWithContext}
        onStop={analysis.handleStopAnalysis}
        onTogglePromptSelection={analysis.handleTogglePromptSelection}
        onSendToSoundGeneration={handleSendAnalysisToGeneration}
        onResetAnalysis={analysis.handleReset}
        
        // Advanced settings props
        normalizeImpulseResponses={auralizationConfig.normalize}
        showAxesHelper={showAxesHelper}
        onNormalizeImpulseResponsesChange={handleToggleNormalize}
        onShowAxesHelperChange={setShowAxesHelper}
        onResetAdvancedSettings={handleResetAdvancedSettings}
        // Sidebar expanded state callback
        onExpandedChange={setIsLeftSidebarExpanded}
        onWidthChange={setLeftSidebarContentWidth}
      />

      {/* Right Sidebar - 3D Model Import / Object Explorer */}
      <RightSidebar
        isVisible={useSpeckleViewer}
        onGoToReceiver={handleGoToReceiver}
        generatedSounds={soundGen.generatedSounds}
        onWidthChange={setRightSidebarWidth}
      />
    </div>
  );
}

export default function Home() {
  return (
    <>
      <ErrorToast />
      <HomeContent />
    </>
  );
}

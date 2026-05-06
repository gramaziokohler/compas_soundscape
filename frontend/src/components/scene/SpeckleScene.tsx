'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { PlaybackControls } from '@/components/controls/PlaybackControls';
import { ControlsInfo } from '@/components/layout/sidebar/ControlsInfo';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { useSpeckleStore, useAcousticsSimulationStore, useGridListenersStore } from '@/store';
import { useUIStore } from '@/store/uiStore';
import { useTextGenerationStore } from '@/store/textGenerationStore';
import { apiService } from '@/services/api';
import { useSpeckleTree } from '@/hooks/useSpeckleTree';
import { useAudioControlsStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { Viewer, CameraController, SelectionExtension, FilteringExtension } from '@speckle/viewer';
import type * as THREE from 'three';
// Custom hooks (Phase 1-4 refactor)
import { useSpeckleViewerInit } from '@/components/scene/hooks/useSpeckleViewerInit';
import { useSpeckleFPS } from '@/components/scene/hooks/useSpeckleFPS';
import { useSpeckleAreaDrawing } from '@/components/scene/hooks/useSpeckleAreaDrawing';
import { useSpeckleSelection } from '@/components/scene/hooks/useSpeckleSelection';
import { useSpeckleTimeline } from '@/components/scene/hooks/useSpeckleTimeline';
import { useSpeckleAudioSync } from '@/components/scene/hooks/useSpeckleAudioSync';
import { useSpeckleDarkMode } from '@/components/scene/hooks/useSpeckleDarkMode';
import { useSpeckleBoundingBox } from '@/components/scene/hooks/useSpeckleBoundingBox';
// Phase 5 hooks
import { useSpeckleSoundSpheres } from '@/components/scene/hooks/useSpeckleSoundSpheres';
import { useSpeckleSceneObjects } from '@/components/scene/hooks/useSpeckleSceneObjects';
import { useSpeckleSoundHighlight } from '@/components/scene/hooks/useSpeckleSoundHighlight';
import { useSpeckleSimulationMismatch } from '@/components/scene/hooks/useSpeckleSimulationMismatch';
import { useSpeckleIRHoverLine } from '@/components/scene/hooks/useSpeckleIRHoverLine';
import { useSpeckleObjectOverlay } from '@/components/scene/hooks/useSpeckleObjectOverlay';
import { useSpeckleCoordinatorCallbacks } from '@/components/scene/hooks/useSpeckleCoordinatorCallbacks';
import { useSpeckleBoundingBoxGumball } from '@/components/scene/hooks/useSpeckleBoundingBoxGumball';
// Phase 5 JSX sub-components
import { SceneViewModeToolbar } from '@/components/scene/SceneViewModeToolbar';
import { SceneFPSOverlay } from '@/components/scene/SceneFPSOverlay';
import { SceneEmptyState } from '@/components/scene/SceneEmptyState';
import { SceneTimeline } from '@/components/scene/SceneTimeline';
import { SceneControlButtons } from '@/components/scene/SceneControlButtons';
import { UI_RIGHT_SIDEBAR, UI_VERTICAL_TABS } from '@/utils/constants';
import type { SoundEvent, ReceiverData } from '@/types';
import type { AuralizationConfig } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

// Left sidebar content width when expanded (matches Sidebar.tsx: 20rem = 320px)
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;

/**
 * Props for SpeckleScene component
 *
 * SpeckleScene integrates Speckle viewer with audio workflow:
 * - Sound spheres, receivers, spatial audio
 * - Timeline playback and synchronization
 * - First-person mode navigation
 */
interface SpeckleSceneProps {
  /** Speckle viewer URL */
  viewer_url?: string;
  /** Alternative: pass full speckleData object from backend */
  speckleData?: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
  };

  // Audio system props
  audioOrchestrator: AudioOrchestrator | null;
  audioContext: AudioContext | null;
  audioRenderingMode?: string;
  selectedIRId?: string | null;
  auralizationConfig?: AuralizationConfig;

  // Soundscape data
  soundscapeData: SoundEvent[] | null;
  scaleForSounds: number;

  // Receivers
  receivers: ReceiverData[];
  selectedReceiverId: string | null;
  onUpdateReceiverPosition?: (receiverId: string, position: [number, number, number]) => void;
  onReceiverSelected?: (receiverId: string) => void;
  onReceiverModeChange?: (isActive: boolean, receiverId: string | null) => void;
  goToReceiverId?: string | null;
  /** Directly enter FPS mode at this position (used for grid listener points that have no mesh). */
  goToPosition?: [number, number, number] | null;
  /** Receiver ID corresponding to goToPosition — used to load correct IRs. */
  goToPositionReceiverId?: string | null;
  /** Grid listener points to render (all grids with showListeners=true, combined). */
  gridListenerPoints?: [number, number, number][];
  /** Point IDs parallel to gridListenerPoints — e.g. "gridA-0", "gridA-1", "gridB-0". */
  gridListenerPointIds?: string[];
  /** ID of the currently expanded grid listener (kept for legacy IR-routing fallback). */
  expandedGridListenerId?: string | null;
  /** Direction offset from listener position used as FPS look-at target. Defaults to (0,1,0). */
  listenerOrientation?: { x: number; y: number; z: number };

  // Sound sphere position update (for simulation sync)
  onUpdateSoundPosition?: (soundId: string, position: [number, number, number]) => void;

  // Analysis - Diverse Entity Highlighting (NEW)
  selectedDiverseEntities?: any[]; // Entities selected for sound generation
  entitiesWithLinkedSounds?: Set<number>; // Entity indices that have sounds linked
  onToggleDiverseSelection?: (entity: any) => void; // Toggle entity in diverse selection

  // Sound card selection (for expand/highlight logic)
  selectedCardIndex?: number | null; // Currently selected sound card index
  onSelectSoundCard?: (promptIndex: number) => void; // Callback to select sound card

  // Entity linking (sound-to-Speckle-object linking)
  isLinkingEntity?: boolean; // Whether we're in entity linking mode
  linkingConfigIndex?: number | null; // Index of the sound config being linked
  onEntityLinked?: (entity: any) => void; // Callback when a Speckle object is clicked in linking mode

  // Playback controls
  // (onPlayAll/onPauseAll/onStopAll/isAnyPlaying are now read from audioControlsStore)

  // Resonance Audio (ShoeBox Acoustics) - NEW
  resonanceAudioConfig?: import('@/types/audio').ResonanceAudioConfig;
  showBoundingBox?: boolean;
  refreshBoundingBoxTrigger?: number;
  roomScale?: { x: number; y: number; z: number };
  onRoomScaleChange?: (scale: { x: number; y: number; z: number }) => void;

  // Callback when viewer is loaded
  onViewerLoaded?: (viewer: Viewer) => void;

  // Callback when bounds are computed from Speckle viewer (for sound sphere placement during generation)
  onBoundsComputed?: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;

  // Sidebar expanded states - adjusts timeline and control positions
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;
  /** Exact left sidebar content-panel width (px). Overrides the hardcoded fallback. */
  leftSidebarContentWidth?: number;
  /** Exact right sidebar total width (px). Overrides the hardcoded fallback. */
  rightSidebarWidth?: number;

  // IR hover line visualization (source-receiver pair)
  hoveredIRSourceReceiver?: { sourceId: string; receiverId: string } | null;

  // Simulation-time positions (source of truth for IR hover line and mismatch coloring)
  activeSimulationPositions?: {
    sources: Record<string, [number, number, number]>;
    receivers: Record<string, [number, number, number]>;
  } | null;

  // Model file upload (for empty state)
  modelFile?: File | null;
  onModelFileChange?: (file: File) => void;

  // Load existing Speckle model (for empty state model browser)
  onSpeckleModelSelect?: (speckleData: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string;
    object_id: string;
    auth_token?: string;
    display_name?: string;
  }) => void;

  // Soundscape persistence (save to Speckle)
  onSaveSoundscape?: () => void;
  isSavingSoundscape?: boolean;

  // FPS mode exit trigger: increment to programmatically exit first-person mode
  exitFPSTrigger?: number;

  // Callback when a receiver mesh is double-clicked in the scene
  onReceiverDoubleClicked?: (receiverId: string) => void;

  // Callback fired when FPS mode is exited (Escape or dblclick)
  onFPSExited?: () => void;

  className?: string;
}

/**
 * SpeckleScene Component
 *
 * Integrates Speckle viewer with audio workflow (sound spheres, receivers, timeline).
 * Uses SpeckleAudioCoordinator to orchestrate all audio components.
 */
export function SpeckleScene({
  viewer_url,
  speckleData,
  audioOrchestrator,
  audioContext,
  audioRenderingMode = 'anechoic',
  selectedIRId,
  auralizationConfig,
  soundscapeData,
  scaleForSounds,
  receivers,
  selectedReceiverId,
  onUpdateReceiverPosition,
  onReceiverSelected,
  onReceiverModeChange,
  goToReceiverId,
  goToPosition,
  goToPositionReceiverId,
  gridListenerPoints = [],
  gridListenerPointIds = [],
  expandedGridListenerId,
  listenerOrientation = { x: 0, y: 1, z: 0 },
  onUpdateSoundPosition,
  selectedDiverseEntities = [],
  entitiesWithLinkedSounds = new Set(),
  onToggleDiverseSelection,
  selectedCardIndex = null,
  onSelectSoundCard,
  isLinkingEntity = false,
  linkingConfigIndex = null,
  onEntityLinked,
  resonanceAudioConfig,
  showBoundingBox ,
  refreshBoundingBoxTrigger = 0,
  roomScale = { x: 1, y: 1, z: 1 },
  onRoomScaleChange,
  onViewerLoaded,
  onBoundsComputed,
  isLeftSidebarExpanded = true,
  isRightSidebarExpanded = true,
  leftSidebarContentWidth,
  rightSidebarWidth,
  hoveredIRSourceReceiver = null,
  activeSimulationPositions = null,
  modelFile = null,
  onModelFileChange,
  onSpeckleModelSelect,
  onSaveSoundscape,
  isSavingSoundscape = false,
  exitFPSTrigger,
  onReceiverDoubleClicked,
  onFPSExited,
  className,
}: SpeckleSceneProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Viewer ref — SpeckleScene owns it; registering into store for cross-component access
  const { getViewerRef: _getViewerRef, setViewer, incrementWorldTreeVersion, selectedEntity, setSelectedEntity, setSelectedObjectIds, applyFilterColors, getObjectLinkState, linkedObjectIds, setFilteringEnabled, viewMode, setViewMode } = useSpeckleStore();

  // Grid listeners — needed for IR hover line position lookup
  const gridListeners = useGridListenersStore((s) => s.gridListeners);

  // Gradient map overlay
  const activeGradientMap = useUIStore((s) => s.activeGradientMap);

  // Viewer display toggles
  const showLabelSprites = useUIStore((s) => s.showLabelSprites);
  const showHoveringHighlight = useUIStore((s) => s.showHoveringHighlight);
  const showSoundSpheres = useUIStore((s) => s.showSoundSpheres);
  const showSceneListeners = useUIStore((s) => s.showSceneListeners);
  const globalSoundSpeed = useUIStore((s) => s.globalSoundSpeed);
  const gradientMapManagerRef = useRef<GradientMapManager | null>(null);

  // Local refs synced from engine store — remaining effects use .current pattern unchanged
  const viewerRef = useRef<Viewer | null>(null);
  const coordinatorRef = useRef<SpeckleAudioCoordinator | null>(null);
  const selectionExtensionRef = useRef<SelectionExtension | null>(null);
  const filteringExtensionRef = useRef<FilteringExtension | null>(null);
  const boundingBoxManagerRef = useRef<BoundingBoxManager | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);

  // Set to true when Play All is pressed; playTimeline() fires after scheduling completes
  const playAfterSchedulingRef = useRef<boolean>(false);

  // ── Audio controls from store ──
  const selectedVariants     = useAudioControlsStore((s) => s.selectedVariants);
  const individualSoundStates = useAudioControlsStore((s) => s.individualSoundStates);
  const soundVolumes            = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals          = useAudioControlsStore((s) => s.soundIntervals);
  const soundTrims              = useAudioControlsStore((s) => s.soundTrims);
  const intervalJitterSeconds   = useAudioControlsStore((s) => s.intervalJitterSeconds);
  const timelineDurationMs      = useAudioControlsStore((s) => s.timelineDurationMs);
  const mutedSounds          = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound          = useAudioControlsStore((s) => s.soloedSound);
  const isAnyPlaying         = useAudioControlsStore((s) =>
    Object.values(s.individualSoundStates).some((st) => st === 'playing')
  );
  const storePlayAll  = useAudioControlsStore((s) => s.playAll);
  const storePauseAll = useAudioControlsStore((s) => s.pauseAll);
  const storeStopAll  = useAudioControlsStore((s) => s.stopAll);

  const [refreshKey, setRefreshKey] = useState(0);

  // Derived: dark mode is active only in 'dark' view mode
  const isDarkMode = viewMode === 'dark';
  // Non-reactive refs — read by hover patch set up in useSpeckleViewerInit
  const isDarkModeRef = useRef(false);
  const isAcousticModeRef = useRef(false);
  const showHoveringHighlightRef = useRef(true);

  const [selectedSpeckleObjectIds, setSelectedSpeckleObjectIds] = useState<string[]>([]);
  // Flag to skip the deselection effect when a sound sphere click clears Speckle selection
  const skipDeselectionRef = useRef(false);

  // File upload drag state (for empty state)
  const [isDragging, setIsDragging] = useState(false);
  const [speckleTokenSet, setSpeckleTokenSet] = useState<boolean | null>(null);

  const modelUrl = viewer_url || speckleData?.url;

  // ============================================================================
  // Phase 1-4 Hook Invocations
  // ============================================================================

  // ── Viewer Init ──
  const { isViewerReady, isLoading, error, worldTree } = useSpeckleViewerInit({
    containerRef,
    modelUrl,
    speckleData,
    audioOrchestrator,
    audioContext,
    scaleForSounds,
    onViewerLoaded,
    refreshKey,
    isDarkModeRef,
    isAcousticModeRef,
    showHoveringHighlightRef,
  });

  // Sync local refs from engine store so remaining in-scene effects use .current unchanged
  useEffect(() => {
    const unsub = useSpeckleEngineStore.subscribe((state) => {
      viewerRef.current = state.viewer;
      coordinatorRef.current = state.coordinator;
      selectionExtensionRef.current = state.selectionExtension;
      filteringExtensionRef.current = state.filteringExtension;
      boundingBoxManagerRef.current = state.boundingBoxManager;
      cameraControllerRef.current = state.cameraController;
      playbackSchedulerRef.current = state.playbackScheduler;
    });
    return unsub;
  }, []);

  // ── FPS Navigation ──
  const { isFirstPersonMode, setIsFirstPersonMode } = useSpeckleFPS({
    isViewerReady,
    containerRef,
    exitFPSTrigger,
    goToReceiverId,
    goToPosition,
    goToPositionReceiverId,
    listenerOrientation,
    receivers,
    soundscapeData,
    selectedReceiverId,
    onReceiverModeChange,
    onFPSExited,
    onReceiverDoubleClicked,
  });

  // ── Area Drawing ──
  useSpeckleAreaDrawing({ isViewerReady, containerRef });

  // ── Object Selection ──
  useSpeckleSelection({
    worldTree,
    selectedSpeckleObjectIds,
    setSelectedSpeckleObjectIds,
    setSelectedEntity,
    setSelectedObjectIds,
    getObjectLinkState,
    isViewerReady,
    selectedEntity,
    skipDeselectionRef,
  });

  // ── Timeline ──
  const {
    timelineSounds, soundMetadataReady, showTimeline, setShowTimeline,
    handleRefreshTimeline, handleDownloadTimeline,
  } = useSpeckleTimeline({
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
  });

  // ── Audio Sync ──
  useSpeckleAudioSync({
    audioOrchestrator,
    soundscapeData,
    soundVolumes,
    mutedSounds,
    soloedSound,
    globalSoundSpeed,
  });

  // ── Dark Mode ──
  useSpeckleDarkMode({
    isDarkMode,
    isViewerReady,
    linkedObjectIds,
    worldTree,
    applyFilterColors,
    isDarkModeRef,
  });

  // ── Bounding Box Gumball ── (Phase 5 — owns draggedBoundsOverride state)
  const { draggedBoundsOverride } = useSpeckleBoundingBoxGumball({
    isViewerReady,
    showBoundingBox,
    containerRef,
    resonanceAudioConfig,
    onBoundsComputed,
    roomScale,
    refreshBoundingBoxTrigger,
  });

  // ── Bounding Box ──
  useSpeckleBoundingBox({
    isViewerReady,
    soundscapeData,
    showBoundingBox,
    resonanceAudioConfig,
    refreshBoundingBoxTrigger,
    onBoundsComputed,
    roomScale,
    draggedBoundsOverride,
  });

  // Use Speckle tree hook for selection handling
  useSpeckleTree(worldTree);

  // ============================================================================
  // Phase 5 Hook Invocations
  // ============================================================================

  // ── Coordinator Callbacks ──
  useSpeckleCoordinatorCallbacks({
    isViewerReady,
    soundscapeData,
    onSelectSoundCard,
    isLinkingEntity,
    onEntityLinked,
    worldTree,
    getObjectLinkState,
    onUpdateReceiverPosition,
    onUpdateSoundPosition,
    applyFilterColors,
    receivers,
    setSelectedEntity,
    selectedDiverseEntities,
    setSelectedSpeckleObjectIds,
    skipDeselectionRef,
  });

  // ── Sound Spheres ──
  useSpeckleSoundSpheres({
    isViewerReady,
    soundscapeData,
    selectedVariants,
    scaleForSounds,
    auralizationConfig,
  });

  // ── Scene Objects (receivers + grid listeners) ──
  useSpeckleSceneObjects({
    isViewerReady,
    receivers,
    soundscapeData,
    isFirstPersonMode,
    gridListenerPoints,
    gridListenerPointIds,
    expandedGridListenerId,
  });

  // ── Sound Sphere Highlight + Zoom ──
  useSpeckleSoundHighlight({
    isViewerReady,
    selectedCardIndex: selectedCardIndex ?? null,
    soundscapeData,
    selectedVariants,
  });

  // ── IR Hover Line ──
  useSpeckleIRHoverLine({
    hoveredIRSourceReceiver,
    receivers,
    gridListeners,
    soundscapeData,
    activeSimulationPositions,
  });

  // ── Simulation Mismatch Coloring ──
  useSpeckleSimulationMismatch({
    isViewerReady,
    activeSimulationPositions,
    soundscapeData,
    receivers,
  });

  // ── Selected Object Overlay ──
  useSpeckleObjectOverlay({
    isViewerReady,
    selectedSpeckleObjectIds,
    worldTree,
  });

  // ============================================================================
  // Effect - Sync viewMode → filteringEnabled in context
  // ============================================================================
  useEffect(() => {
    setFilteringEnabled(viewMode === 'acoustic');
  }, [viewMode, setFilteringEnabled]);

  // Keep isAcousticModeRef in sync so hover patch reads current value
  useEffect(() => {
    isAcousticModeRef.current = viewMode === 'acoustic';
  }, [viewMode]);

  // ============================================================================
  // Effect - Re-assert IBL intensity when entering Acoustic mode
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current) return;
    if (viewMode !== 'acoustic') return;

    const timer = setTimeout(() => {
      const r = viewerRef.current?.getRenderer();
      if (!r) return;

      let targetIbl = 1;
      try {
        const bIds: string[] = (r as any).getBatchIds();
        for (const bid of bIds) {
          const b = (r as any).getBatch(bid);
          if (b?.batchMaterial?.envMapIntensity !== undefined) {
            targetIbl = b.batchMaterial.envMapIntensity;
            break;
          }
        }
      } catch { /* non-critical */ }

      r.indirectIBLIntensity = targetIbl;
      r.needsRender = true;
    }, 300);

    return () => clearTimeout(timer);
  }, [viewMode, isViewerReady]);

  // ============================================================================
  // Speckle token check (for empty state conditional rendering)
  // ============================================================================
  const tokenSettingsTrigger = useTextGenerationStore(s => s.tokenSettingsTrigger);
  useEffect(() => {
    apiService.getTokenStatus().then(s => setSpeckleTokenSet(s.speckle_token_set)).catch(() => setSpeckleTokenSet(false));
  }, [tokenSettingsTrigger]);

  // ============================================================================
  // File upload handlers (for empty state)
  // ============================================================================
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    onModelFileChange?.(files[0]);
  }, [onModelFileChange]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onModelFileChange?.(files[0]);
    e.target.value = "";
  }, [onModelFileChange]);

  // ============================================================================
  // Effect - Update Audio Orchestrator
  // ============================================================================
  useEffect(() => {
    if (coordinatorRef.current && audioOrchestrator) {
      coordinatorRef.current.setAudioOrchestrator(audioOrchestrator);
    }
  }, [audioOrchestrator]);

  // ============================================================================
  // Effect - Compute and Report Bounds When Viewer Ready
  // This ensures bounds are available for sound generation before any sounds exist
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current || !boundingBoxManagerRef.current) {
      return;
    }

    // Compute bounds from Speckle viewer
    const bounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);

    if (bounds && onBoundsComputed) {
      console.log('[SpeckleScene] ✅ Reporting initial bounds to parent:', bounds);
      onBoundsComputed(bounds);
    }
  }, [isViewerReady, onBoundsComputed]);

  // (coordinator callbacks extracted to useSpeckleCoordinatorCallbacks)
  // ============================================================================
  // Effect - Update Sound Spheres  [EXTRACTED - kept here as comment marker]
  // ============================================================================
  // (sound spheres extracted to useSpeckleSoundSpheres)

  // (scene objects extracted to useSpeckleSceneObjects)

  // (sound highlight + zoom extracted to useSpeckleSoundHighlight)

  // ============================================================================
  // NOTE: Diverse selection is managed by SpeckleSelectionModeContext
  // ============================================================================
  // The context's FilteringExtension automatically colors:
  // - Green: Objects in diverseSelectedObjectIds (diverse selection)
  // - Pink: Objects in linkedObjectIds (sound-linked)
  //
  // User interactions (EntityInfoBox link button) update context directly.
  // Model3DContextContent syncs context state to config for analysis.
  // No sync from props to context needed - context is source of truth.

  // ============================================================================
  // Timeline Playback Hook
  // ============================================================================

  const stopTimelineRef = useRef<(() => void) | null>(null);

  const handleTimelineEnd = useCallback(() => {
    storeStopAll();
    stopTimelineRef.current?.();
  }, [storeStopAll]);

  const { playbackState, play: playTimeline, pause: pauseTimeline, stop: stopTimeline, seekTo } = useTimelinePlayback({
    sounds: timelineSounds,
    duration: timelineDurationMs,
    onEnd: handleTimelineEnd
  });

  useEffect(() => {
    stopTimelineRef.current = stopTimeline;
  }, [stopTimeline]);

  // ============================================================================
  // Effect - Control Individual Sound Playback
  // ============================================================================
  useEffect(() => {
    const playbackScheduler = playbackSchedulerRef.current;
    const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
    if (!playbackScheduler || !soundSphereManager) return;

    const soundMetadata = soundSphereManager.getAllAudioSources();

    (async () => {
      await playbackScheduler.updateSoundPlayback(
        soundMetadata,
        individualSoundStates,
        soundIntervals,
        timelineSounds
      );

      if (playAfterSchedulingRef.current) {
        playAfterSchedulingRef.current = false;
        playTimeline();
      }
    })();
  }, [individualSoundStates, soundIntervals, playTimeline]);

  // ============================================================================
  // Effects - Viewer Visibility Settings
  // ============================================================================
  useEffect(() => { showHoveringHighlightRef.current = showHoveringHighlight; }, [showHoveringHighlight]);


  useEffect(() => {
    coordinatorRef.current?.getSoundSphereManager()?.setSoundSpheresVisible(showSoundSpheres);
  }, [showSoundSpheres]);

  useEffect(() => {
    coordinatorRef.current?.getSoundSphereManager()?.setLabelSpritesVisible(showLabelSprites);
    coordinatorRef.current?.getReceiverManager()?.setLabelSpritesVisible(showLabelSprites);
  }, [showLabelSprites]);

  useEffect(() => {
    coordinatorRef.current?.getReceiverManager()?.setReceiversVisible(showSceneListeners);
    coordinatorRef.current?.getGridReceiverManager()?.setVisible(showSceneListeners);
  }, [showSceneListeners]);

  // ============================================================================
  // Refresh Scene Handler (hard reinitialize — same as a page reload for the viewer)
  // ============================================================================
  const handleRefreshScene = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // ============================================================================
  // Reset Zoom Handler (using Speckle CameraController)
  // ============================================================================
  const handleResetZoom = useCallback(() => {
    if (!cameraControllerRef.current || !viewerRef.current) {
      console.warn('[SpeckleScene] Cannot reset zoom - camera controller or viewer not ready');
      return;
    }

    try {
      // Use setCameraView with undefined objectIds to fit all objects
      // This uses the CameraController's default fit-to-all behavior
      cameraControllerRef.current.setCameraView([], true);
      console.log('[SpeckleScene] Camera reset to fit all objects');
    } catch (error) {
      console.error('[SpeckleScene] Error resetting camera:', error);
    }
  }, []);

  // ============================================================================
  // Playback Control Handlers (controlling both audio and timeline)
  // ============================================================================
  const handlePlayAll = useCallback(async () => {
    console.log('[SpeckleScene] Play All clicked');
    const isPausedResume = !playbackState.isPlaying && playbackState.currentTime > 0;

    if (isPausedResume) {
      // Resume from pause: seek restores audio, then start cursor immediately
      const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
      if (playbackSchedulerRef.current && soundSphereManager) {
        const currentStates = useAudioControlsStore.getState().individualSoundStates;
        const playingStates: Record<string, string> = { ...currentStates };
        Object.keys(playingStates).forEach((id) => {
          if (playingStates[id] === 'paused') playingStates[id] = 'playing';
        });

        const soundMetadata = soundSphereManager.getAllAudioSources();
        await playbackSchedulerRef.current.seekToTime(
          playbackState.currentTime,
          soundMetadata,
          playingStates as any,
          soundIntervals,
          timelineSounds
        );
      }
      // Start timeline cursor (preserves currentTime)
      playTimeline();
      // Update store states (updateSoundPlayback will skip — prevStates synced by seekToTime)
      storePlayAll();
      return;
    }

    // Fresh start: defer playTimeline() until after scheduleSound() calls complete.
    // The updateSoundPlayback effect reads this flag and starts the cursor post-scheduling.
    playAfterSchedulingRef.current = true;
    console.debug('[SpeckleScene] Fresh play — deferring cursor until scheduling complete');
    storePlayAll();
  }, [playTimeline, storePlayAll, playbackState.isPlaying, playbackState.currentTime, soundIntervals]);

  const handlePauseAll = useCallback(() => {
    // Pause timeline cursor
    pauseTimeline();
    // Notify store to update sound states
    storePauseAll();
  }, [pauseTimeline, storePauseAll]);

  const handleStopAll = useCallback(() => {
    // Notify store to update sound states FIRST
    storeStopAll();
    // Reset timeline cursor to start
    stopTimeline();
  }, [stopTimeline, storeStopAll]);

  const handleToggleAuralization = useCallback(() => {
    const { simulationConfigs, activeSimulationIndex, handleSetActiveSimulation } = useAcousticsSimulationStore.getState();
    if (activeSimulationIndex !== null) {
      // Disable then immediately re-enable the same card (reset cycle)
      const savedIndex = activeSimulationIndex;
      handleSetActiveSimulation(null);
      setTimeout(() => {
        handleSetActiveSimulation(savedIndex);
      }, 350);
    } else {
      // Nothing active — try to activate the first completed card
      const restoreIndex = simulationConfigs.findIndex(c => c.state === 'completed');
      if (restoreIndex >= 0) {
        handleSetActiveSimulation(restoreIndex);
        if (viewMode !== 'dark') setViewMode('acoustic');
      }
    }
  }, [viewMode, setViewMode]);

  const handleSeek = useCallback(async (timeMs: number) => {
    const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
    if (!playbackSchedulerRef.current || !soundSphereManager) return;

    // Get sound metadata
    const soundMetadata = soundSphereManager.getAllAudioSources();

    // Update timeline cursor position
    seekTo(timeMs);

    // Update audio playback to match new timeline position
    await playbackSchedulerRef.current.seekToTime(
      timeMs,
      soundMetadata,
      individualSoundStates,
      soundIntervals,
      timelineSounds
    );
  }, [seekTo, individualSoundStates, soundIntervals]);

  // ============================================================================
  // Effect - Sync Timeline Playback with Individual Sounds
  // ============================================================================
  useEffect(() => {
    const anySoundPlaying = Object.values(individualSoundStates).some(state => state === 'playing');
    const anySoundPaused = Object.values(individualSoundStates).some(state => state === 'paused');
    const allSoundsStopped = Object.values(individualSoundStates).every(state => state === 'stopped' || state === undefined);

    // When the timeline ends naturally it sets isPlaying=false AND currentTime=duration.
    // Restarting here would create an infinite loop before handleTimelineEnd fires.
    const timelineAtEnd = playbackState.currentTime >= timelineDurationMs;

    if (anySoundPlaying && !playbackState.isPlaying && !timelineAtEnd) {
      if (!playAfterSchedulingRef.current) playTimeline();
    } else if (!anySoundPlaying && anySoundPaused && playbackState.isPlaying) {
      pauseTimeline();
    } else if (allSoundsStopped && (playbackState.isPlaying || playbackState.currentTime > 0)) {
      stopTimeline();
    }
  }, [individualSoundStates, playbackState.isPlaying, playbackState.currentTime, playTimeline, pauseTimeline, stopTimeline, timelineDurationMs]);

  // (object overlay extracted to useSpeckleObjectOverlay)

  // (IR hover line extracted to useSpeckleIRHoverLine)
  // (simulation mismatch extracted to useSpeckleSimulationMismatch)

  // ── Gradient map overlay ──────────────────────────────────────────────────
  useEffect(() => {
    const scene = viewerRef.current?.getRenderer().scene as THREE.Scene | undefined;
    if (!scene || !isViewerReady) return;

    if (!gradientMapManagerRef.current) {
      gradientMapManagerRef.current = new GradientMapManager(scene);
    }

    if (activeGradientMap) {
      gradientMapManagerRef.current.update(activeGradientMap);
    } else {
      gradientMapManagerRef.current.clear();
    }
    viewerRef.current?.requestRender();

    return () => {
      gradientMapManagerRef.current?.clear();
      viewerRef.current?.requestRender();
    };
  }, [activeGradientMap, isViewerReady]);

  // (bounding box gumball extracted to useSpeckleBoundingBoxGumball)

  // ============================================================================
  // Render
  // ============================================================================

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div
      className={`relative w-full h-full ${className || ''}`}
      style={{ height: '100vh', backgroundColor: isDarkMode ? 'var(--background)' : undefined }}
    >
      {/* Viewer container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        id="speckle-scene-container"
      />

      {/* View Mode Toolbar */}
      {isViewerReady && (
        <SceneViewModeToolbar
          isRightSidebarExpanded={isRightSidebarExpanded}
          rightSidebarWidth={rightSidebarWidth}
        />
      )}

      {/* First-person overlay */}
      <SceneFPSOverlay
        isFirstPersonMode={isFirstPersonMode}
        isLeftSidebarExpanded={isLeftSidebarExpanded}
        isRightSidebarExpanded={isRightSidebarExpanded}
        leftSidebarContentWidth={leftSidebarContentWidth}
        rightSidebarWidth={rightSidebarWidth}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-background/50">
          <div className="flex flex-col items-center gap-3">
            <div
              className="animate-spin rounded-full border-4 border-t-transparent"
              style={{
                width: '48px',
                height: '48px',
                borderColor: 'var(--color-primary)',
                borderTopColor: 'transparent',
              }}
            />
            <p className="text-xs text-neutral-400">Loading model...</p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="text-center p-8">
            <div className="text-6xl mb-4">⚠️</div>
            <h3 className="text-xl font-semibold mb-2 text-error">Failed to Load Model</h3>
            <p className="text-sm text-neutral-400">{error}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!modelUrl && !isLoading && !error && (
        <SceneEmptyState
          modelFile={modelFile}
          isDragging={isDragging}
          speckleTokenSet={speckleTokenSet}
          onFileChange={handleFileChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onSpeckleModelSelect={onSpeckleModelSelect}
        />
      )}

      {/* Timeline */}
      {showTimeline && isViewerReady && timelineSounds.length > 0 && (
        <SceneTimeline
          sounds={timelineSounds}
          playbackState={playbackState}
          isLeftSidebarExpanded={isLeftSidebarExpanded}
          isRightSidebarExpanded={isRightSidebarExpanded}
          leftSidebarContentWidth={leftSidebarContentWidth}
          rightSidebarWidth={rightSidebarWidth}
          onSeek={handleSeek}
          onRefresh={handleRefreshTimeline}
          onDownload={handleDownloadTimeline}
        />
      )}

      {/* Playback Controls */}
      <PlaybackControls
        onPlayAll={handlePlayAll}
        onPauseAll={handlePauseAll}
        onStopAll={handleStopAll}
        onToggleAuralization={handleToggleAuralization}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
        isLeftSidebarExpanded={isLeftSidebarExpanded}
        isRightSidebarExpanded={isRightSidebarExpanded}
        leftSidebarContentWidth={leftSidebarContentWidth}
        rightSidebarWidth={rightSidebarWidth}
      />

      {/* 3D Controls Info */}
      {isViewerReady && <ControlsInfo />}

      {/* Control Buttons */}
      <SceneControlButtons
        isViewerReady={isViewerReady}
        isRightSidebarExpanded={isRightSidebarExpanded}
        rightSidebarWidth={rightSidebarWidth}
        audioOrchestrator={audioOrchestrator}
        soundscapeData={soundscapeData}
        speckleData={speckleData}
        isSavingSoundscape={isSavingSoundscape}
        showTimeline={showTimeline}
        onSaveSoundscape={onSaveSoundscape}
        onResetZoom={handleResetZoom}
        onRefreshScene={handleRefreshScene}
        onToggleTimeline={() => setShowTimeline(!showTimeline)}
      />
    </div>
  );
}
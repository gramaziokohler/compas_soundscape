'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { useTransportClock } from '@/hooks/useTransportClock';
import { useSpeckleStore, useAcousticsSimulationStore, useGridListenersStore, notifyError } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import { useUIStore, selectHasSaveTarget } from '@/store/uiStore';
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
import { useSpeckleAnalysisPreview } from '@/components/scene/hooks/useSpeckleAnalysisPreview';
import { useSpeckleSelection } from '@/components/scene/hooks/useSpeckleSelection';
import { useSpeckleTimeline } from '@/components/scene/hooks/useSpeckleTimeline';
import { useSpeckleAudioSync } from '@/components/scene/hooks/useSpeckleAudioSync';
import { useSpeckleDarkMode } from '@/components/scene/hooks/useSpeckleDarkMode';
import { useSpeckleBoundingBox } from '@/components/scene/hooks/useSpeckleBoundingBox';
// Phase 5 hooks
import { useSpeckleSoundSpheres } from '@/components/scene/hooks/useSpeckleSoundSpheres';
import { useSpeckleSceneObjects } from '@/components/scene/hooks/useSpeckleSceneObjects';
import { useSpeckleSoundHighlight } from '@/components/scene/hooks/useSpeckleSoundHighlight';
import { useSpecklePlayingVisuals } from '@/components/scene/hooks/useSpecklePlayingVisuals';
import { useSpeckleSimulationMismatch } from '@/components/scene/hooks/useSpeckleSimulationMismatch';
import { useSpeckleIRHoverLine } from '@/components/scene/hooks/useSpeckleIRHoverLine';
import { useSpeckleScenarioPreview } from '@/components/scene/hooks/useSpeckleScenarioPreview';
import { useSpeckleObjectOverlay } from '@/components/scene/hooks/useSpeckleObjectOverlay';
import { useSpeckleCoordinatorCallbacks } from '@/components/scene/hooks/useSpeckleCoordinatorCallbacks';
import { useSpeckleBoundingBoxGumball } from '@/components/scene/hooks/useSpeckleBoundingBoxGumball';
import { useSpeckleGroundGrid } from '@/components/scene/hooks/useSpeckleGroundGrid';
import { usePlaceholderRoom, getSandboxFramingBounds, getSandboxStageBounds, fitCameraToBounds } from '@/components/scene/hooks/usePlaceholderRoom';
import { useSpeckleHomeAutoRotate } from '@/components/scene/hooks/useSpeckleHomeAutoRotate';
import { useSceneShortcutTargets } from '@/components/scene/hooks/useSceneShortcutTargets';
import { useAcousticLayerIsolation } from '@/hooks/useAcousticLayerIsolation';
// Phase 5 JSX sub-components
import { SceneViewModeToolbar } from '@/components/scene/SceneViewModeToolbar';
import { SceneBottomBar } from '@/components/scene/SceneBottomBar';
import { SceneContextMenu } from '@/components/scene/SceneContextMenu';
import { useSceneContextMenu } from '@/components/scene/hooks/useSceneContextMenu';
import { HomeUploadPrompt } from '@/components/scene/HomeUploadPrompt';import { SpeckleModelModal } from '@/components/scene/SpeckleModelModal';
import { SceneTimeline } from '@/components/scene/SceneTimeline';
import { ObjectExplorerPanel } from '@/components/scene/ObjectExplorerPanel';
import { Spinner } from '@/components/ui/Spinner';
import { ModelUploadProgress } from './ModelUploadProgress';
import { HOME_STAGE, SCENE_BOTTOM_BAR, UI_RIGHT_SIDEBAR } from '@/utils/constants';
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

  // Sound card selection (for expand/highlight logic)
  selectedCardIndex?: number | null; // Currently selected sound card index
  onSelectSoundCard?: (promptIndex: number) => void; // Callback to select sound card

  // Entity linking (sound-to-Speckle-object linking)
  isLinkingEntity?: boolean; // Whether we're in entity linking mode
  linkingConfigIndex?: number | null; // Index of the sound config being linked

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

  // Soundscape persistence
  onSaveSoundscape?: () => void;
  isSavingSoundscape?: boolean;

  // FPS mode exit trigger: increment to programmatically exit first-person mode
  exitFPSTrigger?: number;

  // Callback when a receiver mesh is double-clicked in the scene
  onReceiverDoubleClicked?: (receiverId: string) => void;
  /** Listener mesh or grid listener point single-clicked → expand its card. */
  onListenerClicked?: (listenerOrPointId: string) => void;

  // Callback fired when FPS mode is exited (Escape or dblclick)
  onFPSExited?: () => void;

  /** True while the parent is uploading/converting the model file (before the viewer URL exists). */
  isUploadingModel?: boolean;

  /** True while the parent is bootstrapping the model from the ?model_id= URL param. */
  isBootstrappingModel?: boolean;

  /** True when a newer version of the open model exists but is not loaded yet. */
  hasNewModelVersion?: boolean;

  /** Reload the page to load the latest published version of the open model. */
  onSwitchToLatest?: () => void;

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
  selectedCardIndex = null,
  onSelectSoundCard,
  isLinkingEntity = false,
  linkingConfigIndex = null,
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
  onListenerClicked,
  onFPSExited,
  isUploadingModel = false,
  isBootstrappingModel = false,
  hasNewModelVersion = false,
  onSwitchToLatest,
  className,
}: SpeckleSceneProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Viewer ref — SpeckleScene owns it; registering into store for cross-component access
  const { getViewerRef: _getViewerRef, setViewer, incrementWorldTreeVersion, selectedEntity, setSelectedEntity, setSelectedObjectIds, applyFilterColors, getObjectLinkState, linkedObjectIds, setFilteringEnabled, viewMode, setViewMode } = useSpeckleStore();
  const selectedObjectIdsForHighlight = useSpeckleStore((s) => s.selectedObjectIds);

  // Grid listeners — needed for IR hover line position lookup
  const gridListeners = useGridListenersStore((s) => s.gridListeners);

  // Gradient map overlay
  const activeGradientMap = useUIStore((s) => s.activeGradientMap);
  // Active local "No-model" project (enables the Home button on the sandbox).

  // Viewer display toggles
  const showLabelSprites = useUIStore((s) => s.showLabelSprites);
  const showHoveringHighlight = useUIStore((s) => s.showHoveringHighlight);
  const showSoundSpheres = useUIStore((s) => s.showSoundSpheres);
  const showPlayingHighlight = useUIStore((s) => s.showPlayingHighlight);
  const showSceneListeners = useUIStore((s) => s.showSceneListeners);
  const globalSoundSpeed = useUIStore((s) => s.globalSoundSpeed);
  const showAdvancedSettings = useUIStore((s) => s.showAdvancedSettings);
  const setShowAdvancedSettings = useUIStore((s) => s.setShowAdvancedSettings);
  const timelineDockHeight = useUIStore((s) => s.timelineDock.height);
  const hoveredSoundCardIndex = useUIStore((s) => s.hoveredSoundCardIndex);
  // Effective autosave: only with a save target (model or saved Homepage project)
  // — the bare Home page always saves manually.
  const enableAutoSave = useUIStore((s) => s.enableAutoSave && selectHasSaveTarget(s));
  const gradientMapManagerRef = useRef<GradientMapManager | null>(null);

  // Local refs synced from engine store — remaining effects use .current pattern unchanged
  const viewerRef = useRef<Viewer | null>(null);
  const coordinatorRef = useRef<SpeckleAudioCoordinator | null>(null);
  const selectionExtensionRef = useRef<SelectionExtension | null>(null);
  const filteringExtensionRef = useRef<FilteringExtension | null>(null);
  const boundingBoxManagerRef = useRef<BoundingBoxManager | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);

  // ── Audio controls from store ──
  const selectedVariants     = useAudioControlsStore((s) => s.selectedVariants);
  const soundVolumes            = useAudioControlsStore((s) => s.soundVolumes);
  const soundTrims              = useAudioControlsStore((s) => s.soundTrims);
  const timelineDurationMs      = useAudioControlsStore((s) => s.timelineDurationMs);
  const mutedSounds          = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSounds         = useAudioControlsStore((s) => s.soloedSounds);
  const previewingSoundId    = useAudioControlsStore((s) => s.previewingSoundId);
  const storePlayAll  = useAudioControlsStore((s) => s.playAll);
  const storePauseAll = useAudioControlsStore((s) => s.pauseAll);
  const storeStopAll  = useAudioControlsStore((s) => s.stopAll);

  const [refreshKey, setRefreshKey] = useState(0);
  const showObjectExplorer = useUIStore((s) => s.showObjectExplorer);
  // Track whether the user explicitly closed the Object Explorer so we don't
  // re-open it automatically when expanding another acoustic simulation card.
  const userClosedExplorerRef = useRef(false);

  const handleCloseExplorer = useCallback(() => {
    userClosedExplorerRef.current = true;
    useUIStore.getState().setShowObjectExplorer(false);
  }, []);

  const handleToggleExplorer = useCallback(() => {
    useUIStore.getState().setShowObjectExplorer(!useUIStore.getState().showObjectExplorer);
    if (useUIStore.getState().showObjectExplorer) {
      userClosedExplorerRef.current = false;
    }
  }, []);

  const handleOpenExplorer = useCallback(() => {
    userClosedExplorerRef.current = false;
    useUIStore.getState().setShowObjectExplorer(true);
  }, []);

  // Auto-open the Object Explorer when acoustic material assignment activates,
  // since material/scattering columns live there. Only on the rising edge so a
  // manual close while active is respected — and never re-opens if the user
  // previously closed it.
  const acousticAssignmentActive = useAcousticMaterialStore((s) => s.isActive);
  const prevAcousticActiveRef = useRef(false);
  useEffect(() => {
    if (acousticAssignmentActive && !prevAcousticActiveRef.current && !userClosedExplorerRef.current && (viewer_url || speckleData?.url)) {
      useUIStore.getState().setShowObjectExplorer(true);
    }
    prevAcousticActiveRef.current = acousticAssignmentActive;
  }, [acousticAssignmentActive]);

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
  // True while a file is dragged over the whole Home window (brightens the grid).
  const [isDragOver, setIsDragOver] = useState(false);
  const [speckleTokenSet, setSpeckleTokenSet] = useState<boolean | null>(null);
  // Load-model dialog lives in uiStore so the Home prompt's "Upload" link can open it.
  const showLoadModelPanel = useUIStore((s) => s.showLoadModelPanel);
  const setShowLoadModelPanel = useUIStore((s) => s.setShowLoadModelPanel);
  const uiMode = useUIStore((s) => s.uiMode);

  // Instant loading feedback: set synchronously the moment a file is selected, before the
  // parent kicks off upload/conversion. Cleared once the parent's upload flag takes over,
  // the viewer becomes ready, or an error occurs.
  const [isPreparingModel, setIsPreparingModel] = useState(false);

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
    isBootstrappingModel,
    isDarkModeRef,
    isAcousticModeRef,
    showHoveringHighlightRef,
  });

  const isSandbox = !modelUrl;
  usePlaceholderRoom({ isViewerReady, enabled: isSandbox });
  useSpeckleHomeAutoRotate({ isViewerReady, enabled: isSandbox });

  // Model load failures surface as a transient toast (replaces the old full-screen overlay)
  useEffect(() => {
    if (error) notifyError(error, 'error');
  }, [error]);

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
    selectedReceiverId,
    onReceiverModeChange,
    onFPSExited,
    onReceiverDoubleClicked,
  });

  // ── Right-click context menu ──
  const { menu: contextMenu, closeMenu: closeContextMenu } = useSceneContextMenu(containerRef);

  // ── Area Drawing ──
  useSpeckleAreaDrawing({ isViewerReady, containerRef });

  // ── Analysis Result Preview (text-card result phase) ──
  useSpeckleAnalysisPreview({ isViewerReady });

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
    timelineSounds, soundMetadataReady, showTimeline,
    handleDownloadTimeline,
    handleCloseTimeline, handleToggleTimeline,
  } = useSpeckleTimeline({
    isViewerReady,
    soundscapeData,
    selectedVariants,
    soundTrims,
    timelineDurationMs,
    audioOrchestrator,
    soundVolumes,
    mutedSounds,
    soloedSounds,
    listenerOrientation,
    isFirstPersonMode,
  });

  // ── Audio Sync ──
  useSpeckleAudioSync({
    audioOrchestrator,
    soundscapeData,
    soundVolumes,
    mutedSounds,
    soloedSounds,
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

  // ── Realtime playing visuals (sphere pulse + reactive lights) ──
  useSpecklePlayingVisuals({
    isViewerReady,
    audioOrchestrator,
    showPlayingHighlight,
    isDarkMode,
    soundscapeData,
    previewingSoundId,
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
    isSandbox,
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
    getObjectLinkState,
    onUpdateReceiverPosition,
    onUpdateSoundPosition,
    applyFilterColors,
    receivers,
    setSelectedEntity,
    setSelectedSpeckleObjectIds,
    skipDeselectionRef,
    onListenerClicked,
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

  // ── Simulation Mismatch Coloring ──
  // Runs BEFORE the highlight hook so it publishes userData.simMismatch flags
  // (and colors red mismatched spheres) before useSpeckleSoundHighlight resets
  // the remaining sphere colors / opacity. This ordering means the highlight
  // hook is the final authority for non-red sphere colors, so e.g. a drag that
  // triggers a soundscapeData change no longer resets spheres to blue.
  useSpeckleSimulationMismatch({
    isViewerReady,
    activeSimulationPositions,
    receivers,
    gridListeners,
    soundscapeData,
  });

  // ── Sound Sphere Highlight + Zoom ──
  useSpeckleSoundHighlight({
    isViewerReady,
    selectedCardIndex: selectedCardIndex ?? null,
    soundscapeData,
    selectedVariants,
    activeSimulationPositions,
    hoveredSoundCardIndex,
  });

  // ── IR Hover Line ──
  useSpeckleIRHoverLine({
    hoveredIRSourceReceiver,
    receivers,
    gridListeners,
    activeSimulationPositions,
  });

  // ── Scenario Preview (wireframe highlight + dashed-arrow parcours) ──
  useSpeckleScenarioPreview({ isViewerReady, worldTree });

  // ── Selected Object Overlay ──
  useSpeckleObjectOverlay({
    isViewerReady,
    selectedSpeckleObjectIds,
    worldTree,
  });

  // ── Ground Grid ──
  useSpeckleGroundGrid({ isViewerReady, isSandbox, isDragOver });

  // Loading a Speckle model disables the ground grid by default (it can be
  // re-enabled from Advanced Settings → Display).
  const prevModelUrlForGridRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevModelUrlForGridRef.current === modelUrl) return;
    prevModelUrlForGridRef.current = modelUrl;
    if (modelUrl) {
      useUIStore.getState().setShowGroundGrid(false);
    }
  }, [modelUrl]);

  // ============================================================================
  // Effect - Save viewMode to localStorage for refresh survival.
  // Gated behind a ref that is only enabled AFTER the restore effect completes,
  // so the initial 'default' from Speckle init doesn't overwrite the saved value.
  // ============================================================================
  const viewModeSaveEnabledRef = useRef(false);
  useEffect(() => {
    if (!viewModeSaveEnabledRef.current) return;
    try { localStorage.setItem('compas-view-mode', viewMode); } catch {}
  }, [viewMode]);

  // ============================================================================
  // Effect - Restore saved viewMode from localStorage on mount (after viewer ready).
  // Delay the switch by 300ms so Speckle filtering initializes in default mode first.
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady) return;
    try {
      const saved = localStorage.getItem('compas-view-mode');
      if (saved && saved !== 'default') {
        const timer = setTimeout(() => {
          setViewMode(saved as any);
        }, 300);
        // Enable save tracking after restore timer fires, not before
        viewModeSaveEnabledRef.current = true;
        return () => clearTimeout(timer);
      }
    } catch {}
    viewModeSaveEnabledRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isViewerReady]);
  useEffect(() => {
    setFilteringEnabled(viewMode === 'acoustic');
  }, [viewMode, setFilteringEnabled]);

  // Acoustic layer isolation — isolates the selected acoustic layer when viewMode='acoustic',
  // un-isolates when leaving acoustic mode, and auto-opens ObjectExplorer if no layer exists.
  useAcousticLayerIsolation(viewerRef, worldTree, viewMode);

  // Keep isAcousticModeRef in sync so hover patch reads current value
  useEffect(() => {
    isAcousticModeRef.current = viewMode === 'acoustic';
  }, [viewMode]);

  // Acoustic mode: re-assert the SelectionExtension highlight after a selection.
  // Acoustic visibility/colour re-application can drop the per-render-view
  // selection material, leaving a clicked surface unhighlighted in the viewport.
  useEffect(() => {
    if (viewMode !== 'acoustic') return;
    const ids = selectedObjectIdsForHighlight;
    if (!ids || ids.length === 0) return;
    const sel = selectionExtensionRef.current as unknown as { selectObjects?: (ids: string[]) => void } | null;
    if (!sel || typeof sel.selectObjects !== 'function') return;
    try {
      sel.selectObjects(ids);
      viewerRef.current?.requestRender();
    } catch { /* non-critical */ }
  }, [viewMode, selectedObjectIdsForHighlight]);

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
    setIsPreparingModel(true);
    onModelFileChange?.(files[0]);
  }, [onModelFileChange]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsPreparingModel(true);
    onModelFileChange?.(files[0]);
    e.target.value = "";
  }, [onModelFileChange]);

  // ============================================================================
  // Home stage — full-window drop zone.
  // The whole viewport is the drop target on the sandbox stage: dragging a file
  // anywhere brightens the grid, shows the landing-pad ring and swaps the hint
  // text. A depth counter absorbs the enter/leave churn from nested elements.
  // ============================================================================
  useEffect(() => {
    if (!isSandbox) return;
    let depth = 0;

    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setIsDragging(true);
      setIsDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Mandatory to allow the drop.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setIsDragging(false);
        setIsDragOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      depth = 0;
      e.preventDefault();
      setIsDragging(false);
      setIsDragOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      setIsPreparingModel(true);
      onModelFileChange?.(files[0]);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [isSandbox, onModelFileChange]);

  // Clear the instant-feedback flag once the parent upload flag takes over, the viewer is
  // ready, or an error occurred. The combined loading state below keeps the overlay visible
  // throughout the handoff so there is no flicker back to the empty state.
  useEffect(() => {
    if (modelUrl || isUploadingModel || isPreparingModel) {
      setShowLoadModelPanel(false);
    }
  }, [modelUrl, isUploadingModel, isPreparingModel]);

  useEffect(() => {
    if (isUploadingModel || isViewerReady || error) {
      setIsPreparingModel(false);
    }
  }, [isUploadingModel, isViewerReady, error]);

  // ============================================================================
  // Effect - Update Audio Orchestrator
  // The coordinator and scheduler are created asynchronously in useSpeckleViewerInit
  // (after the viewer loads), so the orchestrator may become ready before OR after them.
  // Watch both the orchestrator AND the store instances reactively so whichever arrives
  // last still gets the orchestrator injected. Otherwise the reversed ordering leaves the
  // freshly-created coordinator/scheduler stuck with a stale null orchestrator closure.
  // ============================================================================
  const engineCoordinator = useSpeckleEngineStore((s) => s.coordinator);
  const enginePlaybackScheduler = useSpeckleEngineStore((s) => s.playbackScheduler);
  useEffect(() => {
    if (audioOrchestrator && engineCoordinator) {
      engineCoordinator.setAudioOrchestrator(audioOrchestrator);
    }
    if (audioOrchestrator && enginePlaybackScheduler) {
      enginePlaybackScheduler.setAudioOrchestrator(audioOrchestrator);
    }
    // Sandbox viewer init often finishes before useAudioOrchestrator does.
    // Transport.play() no-ops without a context; inject it the same way as the orchestrator.
    if (audioContext && enginePlaybackScheduler) {
      enginePlaybackScheduler.setAudioContext(audioContext);
    }
  }, [audioOrchestrator, audioContext, engineCoordinator, enginePlaybackScheduler]);

  // Re-dispatch timeline playback whenever the audio graph is rebuilt (mode switch,
  // ambisonic-order change, IR order change) is owned by PlaybackSchedulerService:
  // it subscribes the Transport to the orchestrator's graph-changed event as soon
  // as the orchestrator is injected (see PlaybackSchedulerService.setAudioOrchestrator).

  // ============================================================================
  // Effect - Compute and Report Bounds When Viewer Ready
  // This ensures bounds are available for sound generation before any sounds exist
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current || !boundingBoxManagerRef.current) {
      return;
    }

    // The Home sandbox World only holds the expanded ground-grid stage box, not
    // real geometry — reporting it here would clobber the sound-fitted resonance
    // bounds owned by useSpeckleBoundingBox. Let that hook own the sandbox bounds.
    if (isSandbox) return;

    // Compute bounds from Speckle viewer
    const bounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);

    if (bounds && onBoundsComputed) {
      console.log('[SpeckleScene] ✅ Reporting initial bounds to parent:', bounds);
      onBoundsComputed(bounds);
    }
  }, [isViewerReady, onBoundsComputed, isSandbox]);

  // (coordinator callbacks extracted to useSpeckleCoordinatorCallbacks)
  // ============================================================================
  // Effect - Update Sound Spheres  [EXTRACTED - kept here as comment marker]
  // ============================================================================
  // (sound spheres extracted to useSpeckleSoundSpheres)

  // (scene objects extracted to useSpeckleSceneObjects)

  // (sound highlight + zoom extracted to useSpeckleSoundHighlight)

  // ============================================================================
  // NOTE: Object coloring (linked sounds / scenario + analysis preview) is
  // managed by speckleStore's FilteringExtension pipeline.
  // ============================================================================
  // The FilteringExtension automatically colors:
  // - Pink: Objects in linkedObjectIds (sound-linked)
  // - Light-warning: scenario / analysis result-phase preview objects
  //
  // User interactions (EntityInfoBox link button) update speckleStore directly.

  // ============================================================================
  // Transport Clock — thin React adapter around Transport (via PlaybackSchedulerService).
  // This hook only READS playback time (rAF-polled for the playhead/time readout);
  // Transport's own audio-clock lookahead loop is the only thing that starts/stops
  // audio and the only source of truth for "when". See useTransportClock.ts.
  // ============================================================================
  const { playbackState, play: playTimeline, pause: pauseTimeline, stop: stopTimeline, seekTo } = useTransportClock({
    scheduler: playbackSchedulerRef,
  });

  // Natural end-of-timeline: Transport stops itself and invokes this callback.
  useEffect(() => {
    enginePlaybackScheduler?.setOnEnd(() => storeStopAll());
    return () => enginePlaybackScheduler?.setOnEnd(null);
  }, [enginePlaybackScheduler, storeStopAll]);

  // ============================================================================
  // Effect - Push the current score (tracks/clips/durations) into the transport
  // whenever the timeline changes. Safe to call at any time, including mid-
  // playback — the transport's lookahead loop reads the score fresh every tick,
  // so structural edits made during playback take effect on the next tick with
  // no stop/restart needed.
  // ============================================================================
  useEffect(() => {
    const playbackScheduler = playbackSchedulerRef.current;
    const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
    if (!playbackScheduler || !soundSphereManager) return;

    const soundMetadata = soundSphereManager.getAllAudioSources();
    playbackScheduler.updateScore(timelineSounds, timelineDurationMs, soundMetadata);
  }, [timelineSounds, timelineDurationMs, enginePlaybackScheduler]);

  // ============================================================================
  // Effects - Viewer Visibility Settings
  // ============================================================================
  useEffect(() => { showHoveringHighlightRef.current = showHoveringHighlight; }, [showHoveringHighlight]);


  useEffect(() => {
    coordinatorRef.current?.getSoundSphereManager()?.setSoundSpheresVisible(showSoundSpheres);
    if (!showSoundSpheres) coordinatorRef.current?.deselectCustomObjectsOfType('sound');
  }, [showSoundSpheres]);

  useEffect(() => {
    // A label is shown only when labels are on AND its owner (sounds / listeners) is visible.
    // Entity-linked sounds have no sphere — their label is the click target, so hiding it
    // is what makes them unselectable.
    coordinatorRef.current?.getSoundSphereManager()?.setLabelSpritesVisible(showLabelSprites && showSoundSpheres);
    coordinatorRef.current?.getReceiverManager()?.setLabelSpritesVisible(showLabelSprites && showSceneListeners);
  }, [showLabelSprites, showSoundSpheres, showSceneListeners]);

  useEffect(() => {
    coordinatorRef.current?.getReceiverManager()?.setReceiversVisible(showSceneListeners);
    coordinatorRef.current?.getGridReceiverManager()?.setVisible(showSceneListeners);
    if (!showSceneListeners) coordinatorRef.current?.deselectCustomObjectsOfType('receiver');
  }, [showSceneListeners]);

  // ============================================================================
  // Refresh Scene Handler (hard reinitialize — same as a page reload for the viewer)
  // ============================================================================
  const handleRefreshScene = useCallback(() => {
    // A newer model version is available → reload the page so the latest version
    // (and its geometry) loads, instead of an in-place viewer re-init.
    if (hasNewModelVersion && onSwitchToLatest) {
      onSwitchToLatest();
      return;
    }
    setRefreshKey((k) => k + 1);
  }, [hasNewModelVersion, onSwitchToLatest]);

  // ============================================================================
  // Reset Zoom Handler (using Speckle CameraController)
  // ============================================================================
  const handleResetZoom = useCallback(() => {
    if (!cameraControllerRef.current || !viewerRef.current) {
      console.warn('[SpeckleScene] Cannot reset zoom - camera controller or viewer not ready');
      return;
    }

    try {
      if (isSandbox) {
        // Frame the whole Home grid, not just the placeholder room AABB.
        fitCameraToBounds(cameraControllerRef.current, getSandboxFramingBounds(), getSandboxStageBounds());
      } else {
        cameraControllerRef.current.setCameraView([], true);
      }
      viewerRef.current.requestRender(8);
      console.log('[SpeckleScene] Camera reset to fit all objects');
    } catch (error) {
      console.error('[SpeckleScene] Error resetting camera:', error);
    }
  }, [isSandbox]);

  // ============================================================================
  // Playback Control Handlers (controlling both audio and timeline)
  // ============================================================================
  const handlePlayAll = useCallback(() => {
    // Transport.play() resumes from wherever it was paused/stopped automatically —
    // no separate "resume" branch or seek-to-restore-audio dance needed; that was
    // only required by the old setTimeout-chain scheduler.
    playTimeline();
    storePlayAll();
  }, [playTimeline, storePlayAll]);

  const handlePauseAll = useCallback(() => {
    pauseTimeline();
    storePauseAll();
  }, [pauseTimeline, storePauseAll]);

  const handleStopAll = useCallback(() => {
    // Transport.stop() kills every in-flight voice unconditionally (not just the
    // primary source id per track), so this is a complete, synchronous silence —
    // no emergency-kill fallback needed.
    stopTimeline();
    storeStopAll();
  }, [stopTimeline, storeStopAll]);

  // Keyboard shortcuts (Space / Shift+Space / Home / F) — see hooks/useGlobalShortcuts.ts
  useSceneShortcutTargets({
    hasTimeline: timelineSounds.length > 0,
    isPlaying: playbackState.isPlaying,
    onPlay: handlePlayAll,
    onPause: handlePauseAll,
    onStop: handleStopAll,
    seekTo,
    cameraControllerRef,
    onResetZoom: handleResetZoom,
  });

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

  const handleSeek = useCallback((timeMs: number) => {
    // Seek is kill-and-restart inside Transport, never arithmetic reconstruction —
    // a single call is the complete operation, synchronously.
    seekTo(timeMs);
  }, [seekTo]);

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
  // Combined loading state: viewer init, parent upload/conversion, the instant
  // post-selection feedback, or a ?model_id= URL bootstrap in progress. Keeps the
  // spinner up for the whole select→upload→load chain.
  const isModelLoading = isLoading || isUploadingModel || isPreparingModel || isBootstrappingModel;

  // How much vertical space the docked DAW actually occupies at the bottom of the
  // scene. It lifts the floating scene controls only when the DAW panel is really
  // extended — i.e. the active sidebar holds at least one generated sound AND the
  // timeline is expanded — not merely because the "Show timeline" toggle is on.
  const dockBottomSpace = showTimeline && timelineSounds.length > 0 ? timelineDockHeight : 0;

  // Publish for overlays owned elsewhere (Simple-mode listener bubbles lift with the DAW).
  useEffect(() => {
    useUIStore.getState().setDawDockBottomSpace(dockBottomSpace);
  }, [dockBottomSpace]);

  return (
    <div
      className={`relative w-full h-full ${className || ''}`}
      style={{ height: '100vh', backgroundColor: isDarkMode ? 'black' : undefined }}
    >
      {/* Viewer container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        id="speckle-scene-container"
      />

      {/* View Mode Toolbar — hidden on the Home sandbox stage */}
      {isViewerReady && !isSandbox && <SceneViewModeToolbar />}

      {/* Loading overlay */}
      {isModelLoading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-background/90">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={48} />
            {isLoading || isBootstrappingModel
              ? <p className="text-xs text-primary">Loading model...</p>
              : <ModelUploadProgress />}
          </div>
        </div>
      )}

      {/* Home stage prompt (Expert mode) — in Simple mode it sits on top of the
          centred new-scene panel instead (HomeSceneComposer). */}
      {isSandbox && isViewerReady && !isModelLoading && uiMode === 'expert' && (
        <div
          className="absolute left-0 right-0 flex justify-center pointer-events-none z-20"
          style={{ bottom: SCENE_BOTTOM_BAR.HEIGHT + HOME_STAGE.PROMPT_BOTTOM_GAP }}
        >
          <HomeUploadPrompt />
        </div>
      )}

      {/* Centered Speckle / upload pop-up with a dimmed backdrop */}
      <SpeckleModelModal
        open={isSandbox && isViewerReady && showLoadModelPanel && !isModelLoading}
        onClose={() => setShowLoadModelPanel(false)}
        modelFile={modelFile}
        isDragging={isDragging}
        speckleTokenSet={speckleTokenSet}
        onFileChange={handleFileChange}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onSpeckleModelSelect={onSpeckleModelSelect}
        onLoadHomeProject={(modelId) => {
          window.location.href = `/?home=${encodeURIComponent(modelId)}`;
        }}
        isUploadingModel={isUploadingModel || isPreparingModel}
      />

      {/* Timeline — full DAW panel, or compact play/pause when the panel is hidden */}
      {isViewerReady && timelineSounds.length > 0 && (
        <SceneTimeline
          collapsed={!showTimeline}
          sounds={timelineSounds}
          playbackState={playbackState}
          isLeftSidebarExpanded={isLeftSidebarExpanded}
          isRightSidebarExpanded={isRightSidebarExpanded}
          leftSidebarContentWidth={leftSidebarContentWidth}
          rightSidebarWidth={rightSidebarWidth}
          onSeek={handleSeek}
          onDownload={handleDownloadTimeline}
          onClose={handleCloseTimeline}
          isAnyPlaying={playbackState.isPlaying}
          onSelectSoundCard={onSelectSoundCard}
          originalIRChannelCount={audioOrchestrator?.getIRState().channelCount ?? 0}
          playbackSchedulerRef={playbackSchedulerRef}
        />
      )}


      {/* Full-width bottom control bar — app / playback / view + system */}
      <SceneBottomBar
        isViewerReady={isViewerReady}
        isSandbox={isSandbox}
        isFirstPersonMode={isFirstPersonMode}
        enableAutoSave={enableAutoSave}
        isSavingSoundscape={!!isSavingSoundscape}
        onSaveSoundscape={onSaveSoundscape}
        hasTimeline={timelineSounds.length > 0}
        isPlaying={playbackState.isPlaying}
        currentTimeMs={playbackState.currentTime}
        durationMs={playbackState.duration}
        showTimeline={showTimeline}
        onPlay={handlePlayAll}
        onPause={handlePauseAll}
        onStop={handleStopAll}
        onToggleTimeline={handleToggleTimeline}
        audioOrchestrator={audioOrchestrator}
        onResetZoom={handleResetZoom}
        onRefreshScene={handleRefreshScene}
        showUpdateBadge={!!hasNewModelVersion}
        showObjectExplorer={showObjectExplorer}
        onToggleExplorer={handleToggleExplorer}
        showLoadModelPanel={showLoadModelPanel}
        onToggleLoadModel={() => setShowLoadModelPanel((open) => !open)}
        showAdvancedSettings={showAdvancedSettings}
        onToggleSettings={() => setShowAdvancedSettings(!showAdvancedSettings)}
      />

      {/* Object Explorer floating panel — always mounted so ObjectExplorer initializes (auto-hides Acoustics layer) on load */}
      <ObjectExplorerPanel
        isVisible={showObjectExplorer && !isSandbox}
        onClose={handleCloseExplorer}
        isRightSidebarExpanded={isRightSidebarExpanded}
        rightSidebarWidth={rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH}
      />

      {/* Right-click command menu — acts on the object the right-click selected */}
      {contextMenu && (
        <SceneContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hit={contextMenu.hit}
          onClose={closeContextMenu}
          onOpenExplorer={handleOpenExplorer}
          onRevealSound={onSelectSoundCard}
          onRevealListener={onListenerClicked}
          onEnterListener={onReceiverDoubleClicked}
        />
      )}
    </div>
  );
}
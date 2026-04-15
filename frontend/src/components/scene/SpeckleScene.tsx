'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import {
  Viewer,
  DefaultViewerParams,
  SpeckleLoader,
  UrlHelper,
  CameraController,
  SelectionExtension,
  FilteringExtension,
  GeometryType,
  StencilOutlineType,
} from '@speckle/viewer';
import { WaveSurferTimeline } from '@/components/audio/WaveSurferTimeline';
import { PlaybackControls } from '@/components/controls/PlaybackControls';
import { ControlsInfo } from '@/components/layout/sidebar/ControlsInfo';
import { SceneControlButton } from '@/components/ui/SceneControlButton';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { SpeckleModelBrowser } from '@/components/scene/SpeckleModelBrowser';
import { Icon } from '@/components/ui/Icon';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { UndoRedoToolbar } from '@/components/ui/UndoRedoToolbar';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { useSpeckleStore, useAreaDrawingStore, useAcousticsSimulationStore } from '@/store';
import { AreaDrawingManager } from '@/lib/three/area-drawing-manager';
import { useSpeckleTree, getHeaderAndSubheader } from '@/hooks/useSpeckleTree';
import { useAudioControlsStore } from '@/store';
import {
  extractTimelineSoundsFromData,
  calculateTimelineDurationFromData,
} from '@/lib/audio/utils/timeline-utils';
import {
  exportSoundscapeToWav,
  type SoundscapeExportConfig,
} from '@/lib/audio/SoundscapeExporter';
import {
  SPECKLE_VIEWER_RETRY,
  UI_COLORS,
  TIMELINE_LAYOUT,
  UI_TIMING,
  SCENE_FOG,
  SCENE_ENVIRONMENT,
  UI_SCENE_BUTTON,
  UI_RIGHT_SIDEBAR,
  UI_VERTICAL_TABS,
  MODEL_FILE_EXTENSIONS,
  DARK_MODE,
  RECEIVER_CONFIG,
  IR_HOVER_LINE,
} from '@/utils/constants';

// Left sidebar content width when expanded (matches Sidebar.tsx: 20rem = 320px)
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;
import type { SoundEvent, ReceiverData } from '@/types';
import type { AuralizationConfig } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { TimelineSound } from '@/types/audio';
import Image from "next/image";

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

  // Callback when viewer is loaded
  onViewerLoaded?: (viewer: Viewer) => void;

  // Callback when bounds are computed from Speckle viewer (for sound sphere placement during generation)
  onBoundsComputed?: (bounds: { min: [number, number, number]; max: [number, number, number] }) => void;

  // Sidebar expanded states - adjusts timeline and control positions
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;

  // IR hover line visualization (source-receiver pair)
  hoveredIRSourceReceiver?: { sourceId: string; receiverId: string } | null;

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
  showBoundingBox = false,
  refreshBoundingBoxTrigger = 0,
  roomScale = { x: 1, y: 1, z: 1 },
  onViewerLoaded,
  onBoundsComputed,
  isLeftSidebarExpanded = true,
  isRightSidebarExpanded = true,
  hoveredIRSourceReceiver = null,
  modelFile = null,
  onModelFileChange,
  onSpeckleModelSelect,
  onSaveSoundscape,
  isSavingSoundscape = false,
  className,
}: SpeckleSceneProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Viewer ref — SpeckleScene owns it; registering into store for cross-component access
  const { getViewerRef: _getViewerRef, setViewer, incrementWorldTreeVersion, selectedEntity, setSelectedEntity, setSelectedObjectIds, applyFilterColors, getObjectLinkState, linkedObjectIds, setFilteringEnabled, viewMode, setViewMode } = useSpeckleStore();
  const localViewerRef = useRef<Viewer | null>(null);
  const viewerRef = localViewerRef;
  
  // Area drawing store
  const areaDrawingCtx = useAreaDrawingStore();

  const coordinatorRef = useRef<SpeckleAudioCoordinator | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);
  const selectionExtensionRef = useRef<SelectionExtension | null>(null);
  const filteringExtensionRef = useRef<FilteringExtension | null>(null);
  const boundingBoxManagerRef = useRef<BoundingBoxManager | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const areaDrawingManagerRef = useRef<AreaDrawingManager | null>(null);
  const irHoverLineRef = useRef<THREE.Line | null>(null);

  // ── Audio controls from store ──
  const selectedVariants     = useAudioControlsStore((s) => s.selectedVariants);
  const individualSoundStates = useAudioControlsStore((s) => s.individualSoundStates);
  const soundVolumes         = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals       = useAudioControlsStore((s) => s.soundIntervals);
  const mutedSounds          = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound          = useAudioControlsStore((s) => s.soloedSound);
  const isAnyPlaying         = useAudioControlsStore((s) =>
    Object.values(s.individualSoundStates).some((st) => st === 'playing')
  );
  const storePlayAll  = useAudioControlsStore((s) => s.playAll);
  const storePauseAll = useAudioControlsStore((s) => s.pauseAll);
  const storeStopAll  = useAudioControlsStore((s) => s.stopAll);

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isFirstPersonMode, setIsFirstPersonMode] = useState(false);

  // Timeline state
  const [timelineSounds, setTimelineSounds] = useState<TimelineSound[]>([]);
  const [timelineDuration, setTimelineDuration] = useState(0);
  const [showTimeline, setShowTimeline] = useState(true);
  const [soundMetadataReady, setSoundMetadataReady] = useState(false);

  // Global volume state
  const [globalVolume, setGlobalVolume] = useState(0.8);
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

  // viewMode / setViewMode come from SpeckleSelectionModeContext (see destructuring above)
  // so AcousticsSection can drive mode switches without prop threading.
  // Derived: dark mode is active only in 'dark' view mode
  const isDarkMode = viewMode === 'dark';
  const isDarkModeRef = useRef(false); // Non-reactive ref for enforcement interval
  const isAcousticModeRef = useRef(false); // Non-reactive ref used by hover patch
  // Store original light values for restoration when dark mode is disabled
  const darkModeStateRef = useRef<{
    sunIntensity: number;
    iblIntensity: number;
    ambientLights: Array<{ light: THREE.AmbientLight; intensity: number }>;
    sceneBackground: THREE.Color | THREE.Texture | null;
    clearColor: THREE.Color;
    clearAlpha: number;
    entityPointLights: THREE.PointLight[];
    entityObjectIds: string[];    // Speckle object IDs of entity-linked objects
    entityRenderViews: any[];     // Render views for entity objects (blue emissive)
    entityEmissiveMat: THREE.MeshStandardMaterial | null; // Shared blue emissive material
    enforcementIntervalId: ReturnType<typeof setInterval> | null;
    pipelineShadowHookCleanup: (() => void) | null; // removes onBeforePipelineRender hook
  } | null>(null);

  // Selected object overlay state
  const [selectedObjectOverlay, setSelectedObjectOverlay] = useState<{
    x: number;
    y: number;
    visible: boolean;
    objectData: any;
  } | null>(null);
  // Ref to track previous overlay position and avoid unnecessary state updates
  const prevOverlayRef = useRef<{ x: number; y: number; visible: boolean } | null>(null);
  const [worldTree, setWorldTree] = useState<any>(null);
  const [selectedSpeckleObjectIds, setSelectedSpeckleObjectIds] = useState<string[]>([]);
  const prevSpeckleObjectIdsRef = useRef<string[]>([]);
  // Flag to skip the deselection effect when a sound sphere click clears Speckle selection
  // in the same render cycle (clearAllSelections → selectedSpeckleObjectIds=[])
  const skipDeselectionRef = useRef(false);

  // File upload drag state (for empty state)
  const [isDragging, setIsDragging] = useState(false);

  const modelUrl = viewer_url || speckleData?.url;

  // Use Speckle tree hook for selection handling (no need to use selectedObjectIds from hook)
  useSpeckleTree(worldTree);

  // Change detection refs (to avoid flooding console)
  const prevSoundscapeDataLengthRef = useRef<number>(0);
  const prevReceiversLengthRef = useRef<number>(0);
  const prevReceiverModeRef = useRef<{ isActive: boolean; receiverId: string | null }>({ isActive: false, receiverId: null });

  // Use ref for auralizationConfig to prevent infinite re-renders (same pattern as ThreeScene)
  const auralizationConfigRef = useRef<AuralizationConfig>(
    auralizationConfig || {
      enabled: false,
      impulseResponseUrl: null,
      impulseResponseBuffer: null,
      impulseResponseFilename: null,
      normalize: false,
    }
  );

  // Update ref when prop changes
  useEffect(() => {
    if (auralizationConfig) {
      auralizationConfigRef.current = auralizationConfig;
    }
  }, [auralizationConfig]);

  // ============================================================================
  // Effect - Sync viewMode → filteringEnabled in context
  // Acoustic: isolation ON | Default: isolation OFF | Dark: isolation OFF
  // ============================================================================
  useEffect(() => {
    setFilteringEnabled(viewMode === 'acoustic');
  }, [viewMode, setFilteringEnabled]);

  // Keep isAcousticModeRef in sync on every viewMode change so the hover patch
  // (set up once during init) can read the current value without re-registration.
  useEffect(() => {
    isAcousticModeRef.current = viewMode === 'acoustic';
  }, [viewMode]);

  // ============================================================================
  // Effect - Re-assert IBL intensity when entering Acoustic mode
  //
  // Fixes the Dark → Default → Acoustic sequence:
  //   1. Acoustic mode has isolation + color filters → singleton materials
  //      (meshColoredMaterial, meshGhostMaterial) are in batch.materials
  //   2. Switching to Dark mode: indirectIBLIntensity = 0 poisons ALL
  //      batch.materials (including singletons) with envMapIntensity = 0
  //   3. Switching to Default: resetMaterials() removes singletons from batches.
  //      indirectIBLIntensity restore only fixes batchMaterial (the only material
  //      left in batch). Singletons keep stale envMapIntensity = 0.
  //   4. Switching to Acoustic: filtering effects re-add singletons to batches.
  //      They still have envMapIntensity = 0 → interior faces render black.
  //
  // This effect runs after filtering effects have settled and re-asserts
  // indirectIBLIntensity on ALL batch.materials (now including singletons).
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current) return;
    if (viewMode !== 'acoustic') return;

    // Delay to let SpeckleSurfaceMaterialsSection effects run:
    //   - isolateObjects() adds ghost material to batch.materials
    //   - registerMaterialColors() → applyFilterColors() → setUserObjectColors()
    //     → setFilters() adds colored material to batch.materials
    // After these, singletons are in batch.materials and indirectIBLIntensity
    // will reach them.
    const timer = setTimeout(() => {
      const r = viewerRef.current?.getRenderer();
      if (!r) return;

      // Read the correct envMapIntensity from batchMaterial (always correct
      // because it was restored during dark mode disable step 6)
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
    setIsLoading(true);
  }, [onModelFileChange]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    onModelFileChange?.(files[0]);
    e.target.value = "";
    setIsLoading(true);
  }, [onModelFileChange]);

  // ============================================================================
  // Effect - Initialize Speckle Viewer
  // ============================================================================
  useEffect(() => {
    if (!modelUrl || !containerRef.current) return;

    const initViewer = async () => {
      setIsLoading(true);
      setError(null);
      setIsViewerReady(false);

      // Dispose existing viewer if URL changed
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Clear container
      while (containerRef.current!.firstChild) {
        containerRef.current!.removeChild(containerRef.current!.firstChild);
      }

      try {
        // Configure viewer params
        const params = DefaultViewerParams;
        params.showStats = false;
        params.verbose = false;

        // Create and initialize viewer
        const viewer = new Viewer(containerRef.current!, params);
        viewerRef.current = viewer;
        console.log('[SpeckleScene] Viewer created and stored in ref:', viewerRef);
        await viewer.init();

        // Add extensions
        const cameraController = viewer.createExtension(CameraController);
        const selectionExtension = viewer.createExtension(SelectionExtension);
        const filteringExtension = viewer.createExtension(FilteringExtension);

        // Configure selection extension with hover effect
        selectionExtension.options = {
          selectionMaterialData: {
            id: THREE.MathUtils.generateUUID(),
            color: 0x047efb,
            emissive: 0x000000,
            opacity: 1,
            roughness: 1,
            metalness: 0,
            vertexColors: false,
            lineWeight: 1,
            stencilOutlines: StencilOutlineType.OVERLAY,
            pointSize: 4,
          },
          hoverMaterialData: {
            id: THREE.MathUtils.generateUUID(),
            color: 0xffffff,
            emissive: 0x000000,
            opacity: 0.7,
            roughness: 1,
            metalness: 0,
            vertexColors: false,
            lineWeight: 2,
            stencilOutlines: StencilOutlineType.OVERLAY,
            pointSize: 4,
          },
        };

        // Patch applyHover to skip hover on hidden/non-isolated objects.
        // When a hidden object is the top hit, we need to find the next visible
        // object behind it from the full intersection list. We store the latest
        // intersection results by also patching the renderer's intersect method.
        let lastIntersections: any[] = [];
        const rendererIntersections = viewer.getRenderer().intersections;
        const origIntersect = rendererIntersections.intersect.bind(rendererIntersections);
        rendererIntersections.intersect = function (
          scene: any, camera: any, point: any, layers?: any, firstOnly?: boolean, clippingVolume?: any
        ) {
          const results = origIntersect(scene, camera, point, layers, firstOnly, clippingVolume);
          lastIntersections = results || [];
          return results;
        };

        const isFilteredOut = (rvId: string) => {
          const state = filteringExtension.filteringState;
          if (!rvId) return false;
          const isHidden = state?.hiddenObjects?.includes(rvId);
          const isExcludedByIsolation = (state?.isolatedObjects?.length ?? 0) > 0
            && !state?.isolatedObjects?.includes(rvId);
          return isHidden || isExcludedByIsolation;
        };

        const origApplyHover = (selectionExtension as any).applyHover.bind(selectionExtension);
        (selectionExtension as any).applyHover = function (renderView: any) {
          // Disable hover entirely in dark mode or acoustic mode
          if (isDarkModeRef.current || isAcousticModeRef.current) {
            origApplyHover(null);
            return;
          }
          if (renderView && isFilteredOut(renderView.renderData?.id)) {
            // The top hit is filtered — walk remaining intersections for a visible object
            const renderer = viewer.getRenderer();
            let fallback: any = null;
            for (let i = 0; i < lastIntersections.length; i++) {
              const pair = renderer.renderViewFromIntersection(lastIntersections[i]);
              if (!pair) continue;
              const rv = pair[0];
              if (rv && !isFilteredOut(rv.renderData?.id)) {
                fallback = rv;
                break;
              }
            }
            origApplyHover(fallback);
            return;
          }
          origApplyHover(renderView);
        };

        // Store extensions in refs for later use
        cameraControllerRef.current = cameraController;
        selectionExtensionRef.current = selectionExtension;
        filteringExtensionRef.current = filteringExtension;

        // Set object pick filter to prevent selection of hidden/non-isolated objects.
        // This is the first line of defense — mode-agnostic, covers both ObjectClicked
        // and ObjectDoubleClicked events at the Speckle renderer level.
        const speckleRenderer = viewer.getRenderer();
        const defaultPickFilter = (speckleRenderer as any).objectPickConfiguration?.pickedObjectsFilter;
        (speckleRenderer as any).objectPickConfiguration = {
          pickedObjectsFilter: ([renderView, material]: [any, any]) => {
            // Preserve Speckle's default filter (null materials, invisible, ghost, etc.)
            if (defaultPickFilter && !defaultPickFilter([renderView, material])) {
              return false;
            }
            // Reject hidden / non-isolated objects
            const objectId: string | undefined = renderView?.renderData?.id;
            if (!objectId) return true;
            return !isFilteredOut(objectId);
          },
        };

        console.log('[SpeckleScene] Extensions created:', {
          cameraController: !!cameraController,
          selectionExtension: !!selectionExtension,
          filteringExtension: !!filteringExtension
        });

        // Load Speckle model with retry logic
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS; attempt++) {
          try {
            // Suppress console errors during retries
            const originalError = console.error;
            console.error = () => {};

            let urls: string[] = [];
            try {
              urls = await UrlHelper.getResourceUrls(modelUrl, speckleData?.auth_token);
            } finally {
              console.error = originalError;
            }

            if (urls.length === 0) {
              throw new Error('Model still processing on server');
            }

            // Load the model
            for (const url of urls) {
              const loader = new SpeckleLoader(viewer.getWorldTree(), url, speckleData?.auth_token);
              await viewer.loadObject(loader, true);
            }

            // Success - initialize audio coordinator
            console.log('[SpeckleScene] Viewer loaded, initializing SpeckleAudioCoordinator...');

            const coordinator = new SpeckleAudioCoordinator(
              viewer,
              cameraController!,
              selectionExtension!,
              audioOrchestrator,
              audioContext
            );

            coordinator.initialize(scaleForSounds);
            coordinatorRef.current = coordinator;

            // Initialize bounding box manager
            const renderer = viewer.getRenderer();
            const scene = renderer.scene;
            if (scene) {
              console.log('[SpeckleScene] Initializing BoundingBoxManager with scene:', {
                sceneUUID: scene.uuid,
                sceneType: scene.type,
                sceneChildren: scene.children.length,
                rendererExists: !!renderer
              });
              const boundingBoxManager = new BoundingBoxManager(scene);
              boundingBoxManagerRef.current = boundingBoxManager;
              console.log('[SpeckleScene] BoundingBoxManager initialized');
            } else {
              console.error('[SpeckleScene] Failed to get scene from renderer!');
            }

            // Initialize playback scheduler
            const playbackScheduler = new PlaybackSchedulerService(audioOrchestrator, audioContext);
            playbackSchedulerRef.current = playbackScheduler;

            setIsLoading(false);
            setIsViewerReady(true);

            // Always start in Default mode regardless of any persisted state
            setViewMode('default');

            // Register viewer with selection mode context
            setViewer(viewer);

            // Load world tree for selection handling
            const tree = viewer.getWorldTree();
            if (tree) {
              console.log('[SpeckleScene] World tree loaded');
              setWorldTree(tree);
              // Signal to ObjectExplorer that the tree is ready
              incrementWorldTreeVersion();
            }

            // Notify parent
            if (onViewerLoaded) {
              console.log('[SpeckleScene] Calling onViewerLoaded callback with viewer:', viewer);
              onViewerLoaded(viewer);
            }

            console.log('[SpeckleScene] ✅ Initialization complete. Viewer ref:', viewerRef);
            return;
          } catch (error) {
            lastError = error as Error;

            if (attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS - 1) {
              await new Promise(resolve => setTimeout(resolve, SPECKLE_VIEWER_RETRY.RETRY_DELAY_MS));
            }
          }
        }

        // All retries failed
        setIsLoading(false);
        setError(`Failed to load model after ${SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS} attempts`);
      } catch (error) {
        console.error('[SpeckleScene] Initialization error:', error);
        setIsLoading(false);
        setError(`Failed to initialize viewer: ${(error as Error).message}`);
      }
    };

    initViewer();

    // Cleanup
    return () => {
      if (areaDrawingManagerRef.current) {
        areaDrawingManagerRef.current.dispose();
        areaDrawingManagerRef.current = null;
      }

      if (coordinatorRef.current) {
        coordinatorRef.current.dispose();
        coordinatorRef.current = null;
      }

      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }

      if (playbackSchedulerRef.current) {
        playbackSchedulerRef.current = null;
      }
    };
  }, [modelUrl, onViewerLoaded]);

  // ============================================================================
  // Effect - Initialize Area Drawing Manager
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current || !coordinatorRef.current) return;

    const adapter = coordinatorRef.current.getAdapter();
    if (!adapter) return;

    const manager = new AreaDrawingManager(
      viewerRef.current,
      adapter.getScene(),
      adapter.getCustomObjectsGroup()
    );
    areaDrawingManagerRef.current = manager;

    return () => {
      manager.dispose();
      areaDrawingManagerRef.current = null;
    };
  }, [isViewerReady]);

  // ============================================================================
  // Effect - Area Drawing Mode (event listeners on canvas)
  // ============================================================================
  useEffect(() => {
    const manager = areaDrawingManagerRef.current;
    if (!manager || !containerRef.current) return;

    const { isDrawing, drawingCardIndex } = areaDrawingCtx;

    if (!isDrawing || drawingCardIndex === null) {
      // Not drawing — ensure manager is cancelled and selection re-enabled
      if (manager.isDrawing) manager.cancelDrawing();
      if (selectionExtensionRef.current) {
        selectionExtensionRef.current.enabled = true;
      }
      return;
    }

    // Start drawing — disable SelectionExtension to prevent surface selection
    manager.startDrawing(drawingCardIndex, `Area ${drawingCardIndex + 1}`);
    if (selectionExtensionRef.current) {
      selectionExtensionRef.current.enabled = false;
    }

    // Canvas element
    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;

    const onPointerMove = (e: PointerEvent) => {
      manager.handlePointerMove(e);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const result = manager.handleClick(e);
      if (result) {
        areaDrawingCtx.finishDrawing(drawingCardIndex, result);
        manager.addCompletedArea(result, 'default');
      }
    };

    const onDblClick = (e: MouseEvent) => {
      e.stopPropagation();
      const result = manager.handleDoubleClick(e);
      if (result) {
        areaDrawingCtx.finishDrawing(drawingCardIndex, result);
        manager.addCompletedArea(result, 'default');
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      manager.handleRightClick(e);
    };

    // Use capture phase to intercept before SpeckleEventBridge
    canvas.addEventListener('pointermove', onPointerMove, true);
    canvas.addEventListener('click', onClick, true);
    canvas.addEventListener('dblclick', onDblClick, true);
    canvas.addEventListener('contextmenu', onContextMenu, true);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove, true);
      canvas.removeEventListener('click', onClick, true);
      canvas.removeEventListener('dblclick', onDblClick, true);
      canvas.removeEventListener('contextmenu', onContextMenu, true);
      // Re-enable selection when drawing effect cleans up
      if (selectionExtensionRef.current) {
        selectionExtensionRef.current.enabled = true;
      }
    };
  }, [areaDrawingCtx.isDrawing, areaDrawingCtx.drawingCardIndex, areaDrawingCtx.version]);

  // ============================================================================
  // Effect - Sync Completed Area Visuals
  // ============================================================================
  useEffect(() => {
    const manager = areaDrawingManagerRef.current;
    if (!manager) return;

    // Update visual states for all existing areas
    for (const [cardIndex, state] of areaDrawingCtx.areaVisualStates) {
      manager.updateAreaVisualState(cardIndex, state);
    }
  }, [areaDrawingCtx.version]);

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

  // ============================================================================
  // Effect - Setup Speckle Object Selection Callback
  // ============================================================================
  useEffect(() => {
    if (!coordinatorRef.current) return;

    // Set up callback to receive selected object IDs from Speckle viewer
    coordinatorRef.current.setOnSpeckleObjectSelected((objectIds: string[]) => {
      setSelectedSpeckleObjectIds(objectIds);

      // ENTITY LINKING MODE: When in linking mode and a Speckle object is clicked
      if (isLinkingEntity && onEntityLinked) {
        // If clicked on empty space (no object selected), pass null to unlink/cancel
        if (objectIds.length === 0) {
          console.log('[SpeckleScene] Empty space clicked in linking mode - unlinking');
          onEntityLinked(null);
          return;
        }

        const selectedId = objectIds[0];

        // Find object data from world tree to create entity
        let objectData: any = null;
        if (worldTree) {
          const findObjectInTree = (tree: any, id: string): any => {
            if (!tree) return null;

            const checkNode = (node: any): any => {
              const nodeId = node?.raw?.id || node?.model?.id || node?.id;
              if (nodeId === id) return node;

              const children = node?.model?.children || node?.children;
              if (children) {
                for (const child of children) {
                  const found = checkNode(child);
                  if (found) return found;
                }
              }
              return null;
            };

            const rootChildren = tree.tree?._root?.children || tree._root?.children || tree.root?.children || tree.children;
            if (rootChildren) {
              for (const child of rootChildren) {
                const found = checkNode(child);
                if (found) return found;
              }
            }
            return null;
          };

          objectData = findObjectInTree(worldTree, selectedId);
        }

        // Create entity data from Speckle object for linking
        const objectName = objectData?.model?.name || objectData?.raw?.name || 'Unnamed Object';
        const objectType = objectData?.raw?.speckle_type || 'Speckle Object';

        // Get bounds from Speckle viewer's render view (from world tree node)
        // The renderView contains accurate bounding box information for the object
        let position: [number, number, number] = [0, 0, 0];
        let entityBounds: { min: [number, number, number]; max: [number, number, number]; center: [number, number, number] } | undefined;

        try {
          // Get renderView from the tree node (contains bounds from Speckle Batch API)
          const renderView = objectData?.model?.renderView || objectData?.renderView;

          if (renderView?.aabb) {
            // renderView.aabb is a THREE.Box3 from the Speckle Batch API
            const aabb = renderView.aabb as THREE.Box3;
            const center = new THREE.Vector3();
            aabb.getCenter(center);

            position = [center.x, center.y, center.z];
            entityBounds = {
              min: [aabb.min.x, aabb.min.y, aabb.min.z],
              max: [aabb.max.x, aabb.max.y, aabb.max.z],
              center: position
            };

            console.log('[SpeckleScene] Got bounds from renderView.aabb:', {
              objectId: selectedId,
              center: position,
              min: entityBounds.min,
              max: entityBounds.max
            });
          }
        } catch (boundsError) {
          console.warn('[SpeckleScene] Could not get render bounds, falling back to raw data:', boundsError);
        }

        // Fallback: Try to get bounds from raw data if render bounds failed
        if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
          const rawBounds = objectData?.raw?.bounds || objectData?.model?.bounds;
          if (rawBounds && rawBounds.min && rawBounds.max) {
            position = [
              (rawBounds.min.x + rawBounds.max.x) / 2,
              (rawBounds.min.y + rawBounds.max.y) / 2,
              (rawBounds.min.z + rawBounds.max.z) / 2
            ];
            entityBounds = {
              min: [rawBounds.min.x, rawBounds.min.y, rawBounds.min.z],
              max: [rawBounds.max.x, rawBounds.max.y, rawBounds.max.z],
              center: position
            };
          }
        }

        // Fallback for parent layers: union all descendants' render-view bounding boxes.
        // A layer node has no renderView of its own but its leaf children do.
        if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
          const collectDescendantAabbs = (node: any): THREE.Box3[] => {
            const boxes: THREE.Box3[] = [];
            const rv = node?.model?.renderView || node?.renderView;
            if (rv?.aabb) {
              boxes.push(rv.aabb as THREE.Box3);
            }
            const children: any[] = node?.model?.children || node?.children || [];
            for (const child of children) {
              boxes.push(...collectDescendantAabbs(child));
            }
            return boxes;
          };

          const allBoxes = collectDescendantAabbs(objectData);
          if (allBoxes.length > 0) {
            const unionBox = new THREE.Box3();
            for (const box of allBoxes) {
              unionBox.union(box);
            }
            const center = new THREE.Vector3();
            unionBox.getCenter(center);
            position = [center.x, center.y, center.z];
            entityBounds = {
              min: [unionBox.min.x, unionBox.min.y, unionBox.min.z],
              max: [unionBox.max.x, unionBox.max.y, unionBox.max.z],
              center: position
            };
            console.log('[SpeckleScene] Got bounds by unioning', allBoxes.length, 'descendant aabbs for layer:', {
              objectId: selectedId,
              center: position
            });
          }
        }

        // Find next available entity index for Speckle objects
        // Use a unique index based on existing diverse entities
        const existingIndices = selectedDiverseEntities.map(e => e.index).filter(i => i !== undefined);
        const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;

        const entity = {
          index: nextIndex,
          type: objectType,
          name: objectName,
          position,
          bounds: entityBounds,
          // Speckle-specific fields for identification
          nodeId: selectedId,
          id: selectedId,
          // Stable Rhino GUID for cross-session persistence (Speckle IDs change on every commit)
          applicationId: objectData?.raw?.applicationId || undefined,
          speckle_type: objectType,
          raw: objectData?.raw
        };

        console.log('[SpeckleScene] Entity linked in linking mode:', {
          objectId: selectedId,
          entityIndex: entity.index,
          name: entity.name,
          position
        });

        onEntityLinked(entity);
        return;
      }

      // NORMAL SELECTION: When a Speckle object is clicked, check if it has a linked sound
      // and expand the corresponding sound card (same flow as sound sphere click)
      if (objectIds.length > 0 && onSelectSoundCard) {
        const selectedId = objectIds[0];

        // Use SpeckleSelectionModeContext to check if this object is linked to a sound
        const linkState = getObjectLinkState(selectedId);

        if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
          console.log('[SpeckleScene] Speckle object clicked with linked sound, selecting card:', linkState.linkedSoundIndex);
          onSelectSoundCard(linkState.linkedSoundIndex);
        }
      }

      // Re-apply filter colors ONLY when deselecting (clicking on empty space)
      // When selecting an object, SelectionExtension handles the highlight
      // and we don't want to override it with our colors
      if (objectIds.length === 0) {
        setTimeout(() => {
          applyFilterColors();
        }, 50);
      }
    });

    // Set up callback for sound sphere clicks to expand corresponding sound card
    coordinatorRef.current.setOnSoundSphereClicked((promptKey: string) => {
      if (!onSelectSoundCard) return;

      // Extract promptIndex from promptKey (format: 'prompt_0', 'prompt_1', etc.)
      const promptIndex = parseInt(promptKey.split('_')[1]);
      if (!isNaN(promptIndex)) {
        console.log('[SpeckleScene] Sound sphere clicked, selecting card:', promptIndex);
        // Skip the deselection effect — clearAllSelections sets selectedSpeckleObjectIds=[]
        // which would otherwise clear the selectedEntity we're about to set
        skipDeselectionRef.current = true;
        onSelectSoundCard(promptIndex);
      }
    });

    // Set up callback for receiver single-click to show info in EntityInfoPanel
    coordinatorRef.current.setOnReceiverSingleClicked((receiverId: string) => {
      const receiver = receivers.find(r => r.id === receiverId);
      if (receiver) {
        skipDeselectionRef.current = true;
        setSelectedEntity({
          objectId: receiver.id,
          objectName: receiver.name,
          objectType: 'Receiver',
          receiverData: { position: receiver.position },
        });
      }
    });

    // Set up callback for custom object deselection (clicking empty space after receiver/sound)
    coordinatorRef.current.setOnCustomObjectDeselected(() => {
      setSelectedEntity(null);
    });

    // Set up callback for receiver position updates (from drag)
    // This syncs the 3D mesh position back to React state so positions persist
    if (onUpdateReceiverPosition) {
      coordinatorRef.current.setOnReceiverPositionUpdated(onUpdateReceiverPosition);
    }

    // Set up callback for sound sphere position updates (from drag)
    // This syncs the 3D mesh position back to React state so simulations use updated positions
    if (onUpdateSoundPosition) {
      coordinatorRef.current.setOnSoundPositionUpdated(onUpdateSoundPosition);
    }
  }, [coordinatorRef.current, soundscapeData, onSelectSoundCard, isLinkingEntity, onEntityLinked, worldTree, getObjectLinkState, onUpdateReceiverPosition, onUpdateSoundPosition, applyFilterColors, receivers, setSelectedEntity]);

  // ============================================================================
  // Effect - Update Sound Spheres
  // ============================================================================
  useEffect(() => {
    if (!coordinatorRef.current || !isViewerReady || !boundingBoxManagerRef.current || !viewerRef.current) {
      return;
    }

    const currentLength = soundscapeData?.length || 0;
    const prevLength = prevSoundscapeDataLengthRef.current;

    // Track changes
    prevSoundscapeDataLengthRef.current = currentLength;

    // Bounding-box spiral placement removed — camera-based placement is the only strategy.
    // let effectiveBounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);
    // if (!effectiveBounds) {
    //   const soundPositions: THREE.Vector3[] = [];
    //   if (soundscapeData) {
    //     soundscapeData.forEach(sound => {
    //       if (sound.position) {
    //         soundPositions.push(new THREE.Vector3(...sound.position));
    //       }
    //     });
    //   }
    //   effectiveBounds = boundingBoxManagerRef.current.calculateEffectiveBounds(null, soundPositions);
    // }

    // Compute camera-front position for sound sphere placement
    let cameraFrontPosition: THREE.Vector3 | null = null;
    try {
      const camera = (viewerRef.current as any).getRenderer().renderingCamera;
      if (camera?.matrixWorld && camera?.position) {
        const mx: number[] = camera.matrixWorld.elements;
        const dx = -mx[8], dy = -mx[9], dz = -mx[10];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const d = RECEIVER_CONFIG.CAMERA_PLACEMENT_DISTANCE_M;
        cameraFrontPosition = new THREE.Vector3(
          camera.position.x + (dx / len) * d,
          camera.position.y + (dy / len) * d,
          camera.position.z + (dz / len) * d,
        );
      }
    } catch {
      // Camera not ready — sound falls through to its backend event position
    }

    // Use ref to prevent infinite loop (same pattern as ThreeScene)
    coordinatorRef.current.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfigRef.current,
      // effectiveBounds, // Bounding-box placement removed
      cameraFrontPosition
    );
  }, [isViewerReady, soundscapeData, selectedVariants, scaleForSounds]);

  // ============================================================================
  // Effect - Update Receivers
  // ============================================================================
  useEffect(() => {
    if (!coordinatorRef.current || !isViewerReady || !boundingBoxManagerRef.current || !viewerRef.current) {
      return;
    }

    const currentLength = receivers.length;
    prevReceiversLengthRef.current = currentLength;

    // Bounding-box spiral placement removed — receivers are placed via camera-based spiral in page.tsx.
    // let effectiveBounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);
    // if (!effectiveBounds) {
    //   const soundPositions: THREE.Vector3[] = [];
    //   if (soundscapeData) {
    //     soundscapeData.forEach(sound => {
    //       if (sound.position) soundPositions.push(new THREE.Vector3(...sound.position));
    //     });
    //   }
    //   effectiveBounds = boundingBoxManagerRef.current.calculateEffectiveBounds(null, soundPositions);
    // }

    // Receivers carry their own positions (set by camera-based spiral placement in page.tsx)
    coordinatorRef.current.updateReceivers(receivers);
  }, [isViewerReady, receivers, soundscapeData]);

  // ============================================================================
  // Effect - Highlight Selected Sound Sphere
  // ============================================================================
  // Note: Speckle object coloring (linked/diverse) is handled by the context's
  // FilteringExtension. This effect only handles sound sphere highlighting.
  useEffect(() => {
    if (!isViewerReady || !soundscapeData || !coordinatorRef.current) {
      return;
    }

    const soundSphereManager = coordinatorRef.current.getSoundSphereManager();
    if (!soundSphereManager) return;

    // Get all sphere meshes
    const sphereMeshes = soundSphereManager.getSoundSphereMeshes();

    // Reset all sphere colors to primary
    sphereMeshes.forEach(sphere => {
      const material = sphere.material as THREE.MeshStandardMaterial;
      if (material.color) {
        material.color.setHex(UI_COLORS.PRIMARY_HEX);
      }
    });

    // If a card is selected, highlight the corresponding sound sphere (if not entity-linked)
    if (selectedCardIndex !== null) {
      // Find the sound for the selected card
      const selectedSound = soundscapeData.find((sound: any) => {
        const promptIdx = (sound as any).prompt_index ?? 0;
        return promptIdx === selectedCardIndex;
      });

      if (selectedSound) {
        // Only highlight sphere if sound has no entity link
        // (Entity-linked sounds are colored via FilteringExtension in the context)
        if (selectedSound.entity_index === undefined || selectedSound.entity_index === null) {
          const sphere = sphereMeshes.find(s => s.userData.soundEvent?.id === selectedSound.id);
          if (sphere) {
            const material = sphere.material as THREE.MeshStandardMaterial;
            if (material.color) {
              material.color.setHex(parseInt(UI_COLORS.PRIMARY_HOVER.replace('#', ''), 16));
              material.needsUpdate = true;
              console.log('[SpeckleScene] Highlighting sound sphere for card:', selectedCardIndex);
            }
          }
        }
      }
    }

    // Request render update to show changes immediately
    if (viewerRef.current) {
      viewerRef.current.requestRender();
    }
  }, [isViewerReady, selectedCardIndex, soundscapeData, selectedVariants]);

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
  // Effect - Update Timeline
  // ============================================================================
  useEffect(() => {
    if (!soundscapeData || soundscapeData.length === 0) {
      setTimelineSounds([]);
      setTimelineDuration(0);
      setSoundMetadataReady(false);
      return;
    }

    // Debounce timeline updates
    const timeoutId = setTimeout(() => {
      // Get sound metadata from sound sphere manager via coordinator
      const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();

      if (soundSphereManager) {
        const soundMetadata = soundSphereManager.getAllAudioSources();

        if (soundMetadata && soundMetadata.size > 0) {
          const duration = calculateTimelineDurationFromData(soundMetadata, soundIntervals);
          const sounds = extractTimelineSoundsFromData(soundMetadata, soundIntervals, duration, soundscapeData ?? undefined);

          setTimelineSounds(sounds);
          setTimelineDuration(duration);
          setSoundMetadataReady(true);
        } else {
          // Metadata not ready yet, keep checking
          setSoundMetadataReady(false);
        }
      }
    }, UI_TIMING.UPDATE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // soundMetadataReady is included so the effect re-runs when the polling
    // marks metadata as ready (allowing timelineSounds to populate on the retry).
    // No feedback loop: React bails out of re-renders when the new state value
    // equals the old one (Object.is), so setSoundMetadataReady(false/true) with
    // the same value never triggers an extra run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundscapeData, selectedVariants, soundIntervals, soundMetadataReady]);

  // ============================================================================
  // Effect - Poll for Sound Metadata Readiness
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !soundscapeData || soundscapeData.length === 0) {
      return;
    }

    // If metadata is already marked ready, no need to poll.
    // The timeline effect will pick up soundscapeData changes on its own.
    if (soundMetadataReady) return;

    // Poll for sound metadata every 500ms until all sounds are loaded
    const intervalId = setInterval(() => {
      const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
      if (soundSphereManager) {
        const soundMetadata = soundSphereManager.getAllAudioSources();
        
        // Check if we have metadata for all sounds
        if (soundMetadata && soundMetadata.size > 0 && soundMetadata.size >= soundscapeData.length) {
          setSoundMetadataReady(true);
          clearInterval(intervalId); // Stop polling
        }
      }
    }, 500);

    // Cleanup
    return () => clearInterval(intervalId);
  }, [isViewerReady, soundscapeData, soundMetadataReady]);

  // Auto-open the timeline whenever sounds become available (e.g. after generation)
  useEffect(() => {
    if (timelineSounds.length > 0) {
      setShowTimeline(true);
    }
  }, [timelineSounds.length]);

  // ============================================================================
  // Callback - Refresh Timeline (reload all available sounds)
  // ============================================================================
  const handleRefreshTimeline = useCallback(() => {
    const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
    if (!soundSphereManager) return;

    const soundMetadata = soundSphereManager.getAllAudioSources();
    if (soundMetadata && soundMetadata.size > 0) {
      const duration = calculateTimelineDurationFromData(soundMetadata, soundIntervals);
      const sounds = extractTimelineSoundsFromData(soundMetadata, soundIntervals, duration, soundscapeData ?? undefined);

      setTimelineSounds(sounds);
      setTimelineDuration(duration);
      console.log('[SpeckleScene] 🔄 Timeline refreshed:', sounds.length, 'sounds, duration:', duration);
    }
  }, [soundIntervals, soundscapeData]);

  // ============================================================================
  // Callback - Download Soundscape as WAV
  // ============================================================================
  const handleDownloadTimeline = useCallback(async () => {
    if (!audioOrchestrator || timelineSounds.length === 0) {
      console.warn('[SpeckleScene] Cannot export: no orchestrator or no timeline sounds');
      return;
    }

    try {
      const exportState = audioOrchestrator.getExportState();

      // Compute linear gains for each sound from dB values stored in soundVolumes.
      // Matches the gain computation in the existing volume-sync effect.
      const soundGains = new Map<string, number>();
      timelineSounds.forEach((ts) => {
        const soundEvent = soundscapeData?.find((s) => s.id === ts.id);
        const baseVolumeDb   = soundEvent?.volume_db ?? 70;
        const targetVolumeDb = soundVolumes[ts.id] ?? baseVolumeDb;
        const dbDiff         = targetVolumeDb - baseVolumeDb;
        const gain           = Math.pow(10, dbDiff / 20);
        soundGains.set(ts.id, Math.max(0, Math.min(10, gain)));
      });

      const { simulationConfigs, activeSimulationIndex } = useAcousticsSimulationStore.getState();
      const activeSimulation = activeSimulationIndex !== null ? simulationConfigs[activeSimulationIndex] : null;

      const config: SoundscapeExportConfig = {
        ...exportState,
        soundGains,
        mutedSounds,
        soloedSound,
        simulationName: activeSimulation?.display_name ?? null,
      };

      const durationMs = timelineDuration > 0 ? timelineDuration : 180_000;

      await exportSoundscapeToWav(timelineSounds, durationMs, config);

      console.log('[SpeckleScene] ✅ Soundscape exported successfully');
    } catch (err) {
      console.error('[SpeckleScene] ❌ Export failed:', err);
      throw err; // re-throw so WaveSurferTimeline can show the error state
    }
  }, [audioOrchestrator, timelineSounds, timelineDuration, soundscapeData, soundVolumes, mutedSounds, soloedSound]);

  // ============================================================================
  // Timeline Playback Hook
  // ============================================================================
  const { playbackState, play: playTimeline, pause: pauseTimeline, stop: stopTimeline, seekTo } = useTimelinePlayback({
    sounds: timelineSounds,
    duration: timelineDuration
  });

  // ============================================================================
  // Effect - Control Individual Sound Playback
  // ============================================================================
  useEffect(() => {
    const playbackScheduler = playbackSchedulerRef.current;
    const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
    if (!playbackScheduler || !soundSphereManager) return;

    const soundMetadata = soundSphereManager.getAllAudioSources();

    // IMPORTANT: This runs AFTER updateSoundSpheres when variants change
    // By that time, old variant metadata have been removed
    // So we rely on updateSoundSpheres to stop any playing audio

    // CRITICAL: updateSoundPlayback is now async (for audio context resume)
    // Must await to ensure context is resumed before sounds are scheduled
    (async () => {
      await playbackScheduler.updateSoundPlayback(
        soundMetadata,
        individualSoundStates,
        soundIntervals
      );
    })();
  }, [individualSoundStates, soundIntervals]);

  // ============================================================================
  // Effect - Apply Volume Changes
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator && soundscapeData) {
      soundscapeData.forEach(soundEvent => {
        const targetVolumeDb = soundVolumes[soundEvent.id] ?? soundEvent.volume_db ?? 70;
        const baseVolumeDb = soundEvent.volume_db ?? 70;

        // Calculate volume difference in dB
        const dbDiff = targetVolumeDb - baseVolumeDb;

        // Convert dB difference to linear gain (0.0 to 1.0)
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
      soundscapeData.forEach(soundEvent => {
        // Determine if this sound should be muted
        let shouldBeMuted = mutedSounds.has(soundEvent.id);

        // If there's a soloed sound, mute everything except that sound
        if (soloedSound !== null) {
          shouldBeMuted = soundEvent.id !== soloedSound;
        }

        audioOrchestrator.setSourceMute(soundEvent.id, shouldBeMuted);
      });
    }
  }, [mutedSounds, soloedSound, soundscapeData, audioOrchestrator]);

  // ============================================================================
  // Effect - Bounding Box Visualization (Resonance Audio Room)
  // ============================================================================
  useEffect(() => {
    const boundingBoxManager = boundingBoxManagerRef.current;
    const viewer = viewerRef.current;
    
    if (!boundingBoxManager || !isViewerReady || !viewer) {
      return;
    }

    // Calculate effective bounds from Speckle viewer (primary method)
    let effectiveBounds = boundingBoxManager.calculateBoundsFromSpeckleBatches(viewer);

    // Fallback to auto-calculate from sound positions
    if (!effectiveBounds) {
      const soundPositions: THREE.Vector3[] = [];
      if (soundscapeData) {
        soundscapeData.forEach(sound => {
          if (sound.position) {
            soundPositions.push(new THREE.Vector3(...sound.position));
          }
        });
      }

      effectiveBounds = boundingBoxManager.calculateEffectiveBounds(
        null, // Legacy geometryBounds removed - Speckle viewer computes bounds
        soundPositions
      );
    }

    // Apply room scale around center of bounds
    let scaledBounds = effectiveBounds;
    if (effectiveBounds && (roomScale.x !== 1 || roomScale.y !== 1 || roomScale.z !== 1)) {
      const [minX, minY, minZ] = effectiveBounds.min;
      const [maxX, maxY, maxZ] = effectiveBounds.max;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      const halfW = ((maxX - minX) / 2) * roomScale.x;
      const halfH = ((maxY - minY) / 2) * roomScale.y;
      const halfD = ((maxZ - minZ) / 2) * roomScale.z;
      scaledBounds = {
        min: [cx - halfW, cy - halfH, cz - halfD],
        max: [cx + halfW, cy + halfH, cz + halfD]
      };
    }

    // Notify parent of computed bounds (scaled - for Resonance Audio room dimensions)
    if (scaledBounds && onBoundsComputed) {
      onBoundsComputed(scaledBounds);
    }

    // Update bounding box with scaled bounds
    const config = {
      roomMaterials: resonanceAudioConfig?.roomMaterials,
      visible: showBoundingBox && !!scaledBounds
    };

    boundingBoxManager.updateBoundingBox(scaledBounds, config);

    // Request render update to show changes - use multiple frames and RENDER_RESET flag
    if (viewerRef.current) {
      // Request render with RENDER_RESET flag (0b1000 = 8) to force complete re-render
      viewerRef.current.requestRender(8); // UpdateFlags.RENDER_RESET
      // Also request a few regular renders to ensure it shows up
      setTimeout(() => viewerRef.current?.requestRender(), 0);
      setTimeout(() => viewerRef.current?.requestRender(), 100);
      setTimeout(() => viewerRef.current?.requestRender(), 200);
    }
  }, [
    isViewerReady,
    soundscapeData,
    showBoundingBox,
    resonanceAudioConfig?.roomMaterials,
    refreshBoundingBoxTrigger,
    onBoundsComputed,
    roomScale
  ]);

  // ============================================================================
  // Effect - Dark Mode (Sound Source Lighting)
  // ============================================================================
  //
  // Bugs fixed:
  // - Speckle's FilteringExtension/SelectionExtension reset materials on click,
  //   selection, and isolate operations. A periodic enforcement interval re-applies
  //   dark mode state (lights, background, entity materials) every 150ms.
  // - Background uses both scene.background AND the WebGL renderer setClearColor
  //   to override the Speckle pipeline. scene.environment is left untouched;
  //   indirectIBLIntensity = 0 zeroes envMapIntensity on all mesh materials.
  // - Entity-linked objects use MeshBasicMaterial (unlit) applied via
  //   renderer.setMaterial() so they glow without scene lighting.
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current || !coordinatorRef.current) return;

    const viewer = viewerRef.current;
    const speckleRenderer = viewer.getRenderer();
    const scene = speckleRenderer.scene;
    const webglRenderer = speckleRenderer.renderer; // Underlying WebGLRenderer
    const soundSphereManager = coordinatorRef.current.getSoundSphereManager();
    const adapter = coordinatorRef.current.getAdapter();

    if (isDarkMode) {
      // --- ENABLE DARK MODE ---
      isDarkModeRef.current = true;

      // 1. Save original light state
      const sunLight = speckleRenderer.sunLight;
      const savedSunIntensity = sunLight.intensity;

      // Find ambient lights in the scene
      const ambientLights: Array<{ light: THREE.AmbientLight; intensity: number }> = [];
      scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.AmbientLight) {
          ambientLights.push({ light: obj, intensity: obj.intensity });
        }
      });

      // Save scene background and WebGL clear color.
      // NOTE: scene.environment is NOT saved/modified — indirectIBLIntensity = 0 is
      // sufficient to eliminate IBL contribution, and leaving the env map in place
      // avoids THREE.js shader program cache churn (USE_ENVMAP define toggling).
      const savedBackground = scene.background;
      const savedClearColor = new THREE.Color();
      webglRenderer.getClearColor(savedClearColor);
      const savedClearAlpha = webglRenderer.getClearAlpha();

      // Collect entity-linked object IDs from the SpeckleSelectionModeContext
      const entityObjectIds = Array.from(linkedObjectIds);

      // Collect render views for entity-linked objects (for emissive material)
      const entityRenderViews: any[] = [];
      if (worldTree && entityObjectIds.length > 0) {
        const findNodeAndCollectRvs = (node: any, targetId: string): boolean => {
          const nodeId = node?.raw?.id || node?.model?.id || node?.id;
          if (nodeId === targetId) {
            // Collect render views from this node and all descendants
            const collectRvs = (n: any) => {
              const rv = n?.model?.renderView;
              if (rv) entityRenderViews.push(rv);
              const children = n?.model?.children || n?.children;
              if (children) children.forEach((c: any) => collectRvs(c));
            };
            collectRvs(node);
            return true;
          }
          const children = node?.model?.children || node?.children;
          if (children) {
            for (const child of children) {
              if (findNodeAndCollectRvs(child, targetId)) return true;
            }
          }
          return false;
        };

        const rootChildren = worldTree.tree?._root?.children || worldTree._root?.children || worldTree.root?.children || worldTree.children;
        if (rootChildren) {
          entityObjectIds.forEach(objId => {
            for (const child of rootChildren) {
              if (findNodeAndCollectRvs(child, objId)) break;
            }
          });
        }
      }

      // Read current IBL intensity from a batch material (setter-only API, no getter)
      let savedIblIntensity = 1;
      try {
        const bIds: string[] = (speckleRenderer as any).getBatchIds();
        for (const bid of bIds) {
          const b = (speckleRenderer as any).getBatch(bid);
          if (b?.batchMaterial?.envMapIntensity !== undefined) {
            savedIblIntensity = b.batchMaterial.envMapIntensity;
            break;
          }
        }
      } catch { /* non-critical */ }

      darkModeStateRef.current = {
        sunIntensity: savedSunIntensity,
        iblIntensity: savedIblIntensity,
        ambientLights,
        sceneBackground: savedBackground as THREE.Color | THREE.Texture | null,
        clearColor: savedClearColor,
        clearAlpha: savedClearAlpha,
        entityPointLights: [],
        entityObjectIds,
        entityRenderViews,
        entityEmissiveMat: null, // set below after material creation
        enforcementIntervalId: null,
        pipelineShadowHookCleanup: null,
      };

      // ---------- Apply dark mode state ----------

      // Shared materials (reused across enforcement ticks — no allocation per tick)
      // Dark opaque: MeshStandardMaterial so objects respond to point lights AND
      // receive shadows. MeshBasicMaterial is unlit and has no shadow shader code,
      // so Speckle's InstancedMeshGroup.getCachedMaterial() would clone it into a
      // material that cannot receive shadows.
      const darkOpaqueMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a2e,
        side: THREE.DoubleSide,
        transparent: false,
        roughness: 0.85,
        metalness: 0.05,
      });
      // Blue emissive: entity-linked objects glow electric blue.
      // MeshStandardMaterial with high emissiveIntensity produces an HDR value that
      // Speckle's tone mapping clips/blooms into a bright glowing surface.
      // base color is black so only the emissive channel contributes (all lights are off).
      const entityEmissiveMat = new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(DARK_MODE.LIGHT_COLOR_HEX),
        emissiveIntensity: DARK_MODE.ENTITY_EMISSIVE_INTENSITY,
        roughness: 0,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      // Store on ref so the linkedObjectIds-change effect can reuse it without re-creating
      darkModeStateRef.current!.entityEmissiveMat = entityEmissiveMat;
      // Pre-allocated black color (avoids creating new Color on every tick)
      const blackColor = new THREE.Color(0x000000);

      // Helper: apply all dark mode overrides (used both initially and by enforcement)
      const applyDarkModeState = () => {
        if (!isDarkModeRef.current || !viewerRef.current) return;
        const r = viewerRef.current.getRenderer();
        const s = r.scene;

        // Kill all lights
        r.sunLight.intensity = 0;
        r.indirectIBLIntensity = 0;
        s.traverse((obj: THREE.Object3D) => {
          if (obj instanceof THREE.AmbientLight) obj.intensity = 0;
        });

        // Force black background everywhere.
        // Speckle's pipeline clears to transparent white (alpha=0) at the start of every
        // frame via setClearColor(0xFFFFFF, 0) + clear(). The canvas is transparent so
        // the CSS background of the wrapper div shows through — see isDarkMode style on
        // the outer div which sets backgroundColor:'#000000' to produce the black scene bg.
        // NOTE: Do NOT set scene.environment = null here. indirectIBLIntensity = 0 already
        // zeroes envMapIntensity on all mesh materials, eliminating IBL contribution.
        // Nulling the env map forces THREE.js to toggle the USE_ENVMAP shader define on
        // every dark-mode cycle, and after ~20-30 toggles the shader program cache
        // degrades, causing black interior faces in Acoustic filter mode.
        s.background = blackColor;
        r.renderer.setClearColor(0x000000, 0); // match transparent clear, just darker

        // 1. Override visible mesh batches with dark opaque material.
        //    Live batcher scan covers meshes added after dark mode was enabled.
        //    GeometryType.MESH excludes lines, points, text, shadow-catcher overlays.
        //    Four sets of render views are excluded so their own materials stay intact:
        //      - hidden objects  (FilteringExtension ghost/hidden draw-ranges)
        //      - non-isolated objects  (when isolation is active)
        //      - currently selected objects  (SelectionExtension highlight)
        //      - entity-linked objects  (receive blue emissive in step 2)
        const entityLinkedSet: Set<string> = new Set(
          darkModeStateRef.current?.entityObjectIds ?? []
        );
        try {
          const filterState = filteringExtensionRef.current?.filteringState;
          const hiddenSet: Set<string> | null = filterState?.hiddenObjects?.length
            ? new Set(filterState.hiddenObjects)
            : null;
          const isolatedSet: Set<string> | null = filterState?.isolatedObjects?.length
            ? new Set(filterState.isolatedObjects)
            : null;
          // getSelectedObjects() returns raw Speckle objects whose .id matches rv.renderData.id
          const selObjs = selectionExtensionRef.current?.getSelectedObjects() ?? [];
          const selectedSet: Set<string> | null = selObjs.length > 0
            ? new Set((selObjs as any[]).map((o) => o.id as string).filter(Boolean))
            : null;

          const needsFilter = hiddenSet || isolatedSet || selectedSet || entityLinkedSet.size > 0;

          const batchIds: string[] = (r as any).getBatchIds();
          for (const id of batchIds) {
            const batch = (r as any).getBatch(id);
            if (!batch || batch.geometryType !== GeometryType.MESH) continue;

            // When any filter is active, exclude render views that must keep their own material
            const rvs: any[] = needsFilter
              ? batch.renderViews.filter((rv: any) => {
                  const objId: string | undefined = rv.renderData?.id;
                  if (!objId) return true; // No ID: include to be safe
                  if (hiddenSet?.has(objId)) return false;              // Hidden: skip
                  if (isolatedSet && !isolatedSet.has(objId)) return false; // Non-isolated: skip
                  if (selectedSet?.has(objId)) return false;            // Selected: skip (preserve highlight)
                  if (entityLinkedSet.has(objId)) return false;         // Entity-linked: blue emissive in step 2
                  return true;
                })
              : batch.renderViews;

            if (rvs.length > 0) {
              r.setMaterial(rvs, darkOpaqueMat);
            }
          }
          // Re-apply selection highlight on top of dark materials.
          // SelectionExtension.selectObjects() highlights the object AND all its
          // descendants' render views, so parent-group children that just received
          // darkOpaqueMat will get the selection material painted back on top.
          // This runs synchronously (no render between setMaterial and selectObjects),
          // so there is no visible flicker.
          if (selObjs.length > 0) {
            try {
              const ids = (selObjs as any[]).map((o: any) => o.id as string).filter(Boolean);
              selectionExtensionRef.current?.selectObjects(ids);
            } catch { /* non-critical */ }
          }
        } catch {
          // Non-critical: batcher may be rebuilding
        }

        // 2. Apply blue emissive to entity-linked objects.
        //    Scan batches directly using rv.renderData.id (same ID space as linkedObjectIds /
        //    setUserObjectColors) — more reliable than WorldTree render-view lookup.
        if (entityLinkedSet.size > 0) {
          try {
            const entityRvs: any[] = [];
            const bIds: string[] = (r as any).getBatchIds();
            for (const bid of bIds) {
              const b = (r as any).getBatch(bid);
              if (!b || b.geometryType !== GeometryType.MESH) continue;
              for (const rv of b.renderViews) {
                const objId: string | undefined = rv.renderData?.id;
                if (objId && entityLinkedSet.has(objId)) entityRvs.push(rv);
              }
            }
            if (entityRvs.length > 0) {
              r.setMaterial(entityRvs, entityEmissiveMat);
            }
          } catch {
            // Non-critical: batcher may be rebuilding
          }
        }

        // Enforce sound sphere colors (guards against drag / render resets)
        if (coordinatorRef.current) {
          const ssm = coordinatorRef.current.getSoundSphereManager();
          if (ssm) ssm.enforceDarkModeColors();
        }

        // Trigger shadow map re-render (Speckle sets autoUpdate=false)
        r.shadowMapNeedsUpdate = true;
        r.needsRender = true;
      };

      // Initial application
      applyDarkModeState();

      // Hook each GEOMETRY pass's onBeforeRender so shadow maps are always re-rendered
      // with OPAQUE visibility (full scene) rather than the STENCIL visibility that the
      // preceding stencil pass leaves in place.
      //
      // Root cause: bs.render() calls passes in order [stencil, opaque, transparent, ...].
      //   1. onBeforePipelineRender fires → shadowMapNeedsUpdate = true
      //   2. Stencil pass: batcher.applyVisibility(getStencil())  → only selected objects
      //      renderer.render() → Three.js renders shadow maps with selected-only visibility
      //      → shadowMapNeedsUpdate = false
      //   3. OPAQUE pass: batcher.applyVisibility(getOpaque()) → all opaque objects
      //      renderer.render() → shadowMapNeedsUpdate already false → NO shadow update
      //      → result: shadow maps from step 2 (often empty) → no shadows visible
      //
      // Fix: hook onBeforeRender on every GEOMETRY pass.  It fires inside Os.render()
      // after bs.render() has already called batcher.applyVisibility for that pass,
      // but before the pass calls renderer.render(scene,camera).  So when the OPAQUE
      // pass's onBeforeRender fires, all opaque objects are visible → setting
      // shadowMapNeedsUpdate=true here makes Three.js render shadow maps correctly.
      //
      // The same pass instance is shared across dynamicStage/progressiveStage/passthroughStage,
      // so one hook covers all pipeline stages.
      const pipeline = speckleRenderer.pipeline as any;

      // Collect all unique passes across every stage
      const allStagePasses: any[] = [
        ...(pipeline.dynamicStage ?? []),
        ...(pipeline.progressiveStage ?? []),
        ...(pipeline.passthroughStage ?? []),
      ];
      const uniquePasses = [...new Set(allStagePasses)];
      const geometryPasses = uniquePasses.filter((p: any) => p.displayName === 'GEOMETRY');

      const passCleanups: Array<() => void> = [];
      geometryPasses.forEach((p: any) => {
        const origOnBeforeRender = p.onBeforeRender; // undefined by default
        p.onBeforeRender = () => {
          // Fires AFTER batcher.applyVisibility has been called for this pass,
          // so shadow maps are rendered with this pass's correct visibility.
          if (isDarkModeRef.current) speckleRenderer.shadowMapNeedsUpdate = true;
          origOnBeforeRender?.();
        };
        passCleanups.push(() => { p.onBeforeRender = origOnBeforeRender; });
      });

      darkModeStateRef.current!.pipelineShadowHookCleanup = () => {
        passCleanups.forEach(fn => fn());
      };

      // Enable dark mode on sound spheres (adds point lights + blue color)
      if (soundSphereManager) {
        soundSphereManager.enableDarkMode();
      }

      // Add point lights at entity positions
      if (soundSphereManager && adapter) {
        const entityPositions = soundSphereManager.getEntityLinkedSoundPositions();
        const customGroup = adapter.getCustomObjectsGroup();

        entityPositions.forEach(({ id, position }) => {
          const light = new THREE.PointLight(
            DARK_MODE.LIGHT_COLOR_HEX,
            DARK_MODE.ENTITY_LIGHT_INTENSITY,
            DARK_MODE.ENTITY_LIGHT_DISTANCE,
            DARK_MODE.POINT_LIGHT_DECAY
          );
          light.name = `DarkModeEntityLight_${id}`;
          light.position.set(position[0], position[1], position[2]);
          light.layers.enableAll();

          // Enable shadow casting so the entity's building blocks light from other sources
          light.castShadow = true;
          light.shadow.mapSize.width = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.mapSize.height = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.camera.near = DARK_MODE.SHADOW_CAMERA_NEAR;
          light.shadow.camera.far = DARK_MODE.ENTITY_LIGHT_DISTANCE;
          light.shadow.bias = DARK_MODE.SHADOW_BIAS;

          customGroup.add(light);
          darkModeStateRef.current!.entityPointLights.push(light);
        });
      }

      // Start enforcement interval: re-apply dark mode state periodically
      // This guards against Speckle's FilteringExtension, SelectionExtension,
      // and isolate operations resetting materials/lights on click or selection.
      const intervalId = setInterval(applyDarkModeState, 150);
      darkModeStateRef.current.enforcementIntervalId = intervalId;

      // Force render update
      viewer.requestRender(8); // RENDER_RESET
      setTimeout(() => viewer.requestRender(), 50);

      console.log('[SpeckleScene] Dark mode enabled', {
        entityObjects: entityObjectIds.length,
        entityRenderViews: entityRenderViews.length,
      });
    } else {
      // --- DISABLE DARK MODE ---
      isDarkModeRef.current = false;
      const saved = darkModeStateRef.current;
      if (!saved) return;

      // Stop enforcement interval
      if (saved.enforcementIntervalId) {
        clearInterval(saved.enforcementIntervalId);
      }

      // Remove pipeline shadow hook
      saved.pipelineShadowHookCleanup?.();

      // 1. Restore background + clear color.
      //    scene.environment was never modified (indirectIBLIntensity = 0 is sufficient),
      //    so no env map restoration is needed.
      scene.background = saved.sceneBackground;
      webglRenderer.setClearColor(saved.clearColor, saved.clearAlpha);

      // 2. Disable dark mode on sound spheres (removes point lights + restores color)
      if (soundSphereManager) {
        soundSphereManager.disableDarkMode();
      }

      // 3. Remove entity point lights
      if (adapter) {
        const customGroup = adapter.getCustomObjectsGroup();
        saved.entityPointLights.forEach(light => {
          customGroup.remove(light);
          light.dispose();
        });
      }

      // 4. Reset all object materials to original (reverts dark opaque + entity emissive overrides)
      try {
        speckleRenderer.resetMaterials();
      } catch {
        // Non-critical
      }

      // 5. Re-apply FilteringExtension hide/isolate state.
      //    resetMaterials() wipes batch draw-ranges but not the extension's own
      //    internal state, so hidden/isolated objects would briefly reappear.
      try {
        const fe = filteringExtensionRef.current;
        if (fe) {
          const fs = fe.filteringState;
          if (fs?.hiddenObjects?.length) {
            fe.hideObjects(fs.hiddenObjects, undefined, true, false);
          }
          if (fs?.isolatedObjects?.length) {
            fe.isolateObjects(fs.isolatedObjects, undefined, true, true);
          }
        }
      } catch {
        // Non-critical
      }

      // 6. Restore scene lights AFTER all material operations (steps 4-5).
      //    indirectIBLIntensity sets envMapIntensity on every batch.materials entry;
      //    it must run after resetMaterials() and isolateObjects() which create/reset
      //    draw-range materials — otherwise new materials get envMapIntensity=0 and
      //    interior (back-facing) surfaces render black due to missing IBL lighting.
      const sunLight = speckleRenderer.sunLight;
      sunLight.intensity = saved.sunIntensity;
      saved.ambientLights.forEach(({ light, intensity }) => { light.intensity = intensity; });
      speckleRenderer.indirectIBLIntensity = saved.iblIntensity;

      // 6b. Also restore envMapIntensity on singleton filter materials that are NOT
      //     currently in any batch.  During dark mode, indirectIBLIntensity = 0 set
      //     envMapIntensity = 0 on ALL batch.materials — including singletons like
      //     meshColoredMaterial and meshGhostMaterial.  resetMaterials() removes them
      //     from batches, so step 6's indirectIBLIntensity only fixes batchMaterial.
      //     If the user later enters Acoustic mode (Dark → Default → Acoustic), these
      //     singletons are re-added with stale envMapIntensity = 0 → black interior faces.
      try {
        const matModule = (speckleRenderer as any).batcher?.materials;
        if (matModule) {
          const singletons = [
            matModule.meshColoredMaterial,
            matModule.meshTransparentColoredMaterial,
            matModule.meshGhostMaterial,
            matModule.lineColoredMaterial,
            matModule.pointCloudColouredMaterial,
          ];
          for (const mat of singletons) {
            if (mat && 'envMapIntensity' in mat) {
              (mat as any).envMapIntensity = saved.iblIntensity;
            }
          }
        }
      } catch {
        // Non-critical: internal Speckle API
      }

      // 7. Re-apply normal filter colors from the selection mode context.
      //    setUserObjectColors() internally calls setFilters() → resetMaterials()
      //    which re-creates draw-range materials. The IBL re-assertion after
      //    applyFilterColors() ensures any newly-added batch materials get the
      //    correct envMapIntensity value.
      const capturedIbl = saved.iblIntensity;
      setTimeout(() => {
        applyFilterColors();
        try {
          const r = viewerRef.current?.getRenderer();
          if (r) {
            r.indirectIBLIntensity = capturedIbl;
            r.needsRender = true;
          }
        } catch { /* non-critical */ }
      }, 100);

      darkModeStateRef.current = null;

      // Force render update
      viewer.requestRender(8);
      setTimeout(() => viewer.requestRender(), 50);

      console.log('[SpeckleScene] Dark mode disabled');
    }

    // Cleanup: stop enforcement interval and pipeline hook on unmount or dependency change
    return () => {
      if (darkModeStateRef.current?.enforcementIntervalId) {
        clearInterval(darkModeStateRef.current.enforcementIntervalId);
      }
      darkModeStateRef.current?.pipelineShadowHookCleanup?.();
    };
  }, [isDarkMode, isViewerReady]);

  // ============================================================================
  // Effect - Sync entityObjectIds + object-center point lights in dark mode
  // ============================================================================
  // Runs when dark mode is active and linkedObjectIds changes (or dark mode first enables).
  // 1. Keeps darkModeStateRef.current.entityObjectIds fresh for the enforcement interval.
  // 2. Places point lights at the geometric centers of entity-linked Speckle meshes
  //    (computed from render view AABBs — same batch data used for blue emissive).
  //    Object-center lights are named DarkModeObjectLight_* and pushed onto
  //    entityPointLights so the disable block cleans them up automatically.
  // ============================================================================
  useEffect(() => {
    if (!isDarkMode || !darkModeStateRef.current || !viewerRef.current) return;
    const state = darkModeStateRef.current;
    state.entityObjectIds = Array.from(linkedObjectIds);

    // Remove previously placed object-center lights before re-computing
    const adapter = coordinatorRef.current?.getAdapter();
    if (adapter) {
      const customGroup = adapter.getCustomObjectsGroup();
      state.entityPointLights = state.entityPointLights.filter(light => {
        if (light.name.startsWith('DarkModeObjectLight_')) {
          customGroup.remove(light);
          light.dispose();
          return false;
        }
        return true;
      });

      // Compute per-object AABB by unioning render views from batch scan
      if (state.entityObjectIds.length > 0) {
        const entitySet = new Set(state.entityObjectIds);
        const r = viewerRef.current.getRenderer();
        const boxPerObject = new Map<string, THREE.Box3>();

        try {
          const bIds: string[] = (r as any).getBatchIds();
          for (const bid of bIds) {
            const b = (r as any).getBatch(bid);
            if (!b || b.geometryType !== GeometryType.MESH) continue;
            for (const rv of b.renderViews) {
              const objId: string | undefined = rv.renderData?.id;
              if (!objId || !entitySet.has(objId)) continue;
              const rvAabb: THREE.Box3 = rv.aabb;
              if (!rvAabb) continue;
              if (!boxPerObject.has(objId)) {
                boxPerObject.set(objId, rvAabb.clone());
              } else {
                boxPerObject.get(objId)!.union(rvAabb);
              }
            }
          }
        } catch { /* non-critical */ }

        const center = new THREE.Vector3();
        boxPerObject.forEach((box, objId) => {
          if (box.isEmpty()) return;
          box.getCenter(center);
          const light = new THREE.PointLight(
            DARK_MODE.LIGHT_COLOR_HEX,
            DARK_MODE.POINT_LIGHT_INTENSITY,
            DARK_MODE.POINT_LIGHT_DISTANCE,
            DARK_MODE.POINT_LIGHT_DECAY
          );
          light.name = `DarkModeObjectLight_${objId}`;
          light.position.copy(center);
          light.layers.enableAll();
          // No shadow casting: the light is at the mesh surface, casting shadows would block
          // neighboring geometry from being illuminated. Glow-only, no hard shadows.
          customGroup.add(light);
          state.entityPointLights.push(light);
        });
      }
    }
  }, [isDarkMode, linkedObjectIds]);

  // ============================================================================
  // Global Volume Handlers
  // ============================================================================
  const handleGlobalVolumeChange = useCallback((value: number) => {
    setGlobalVolume(value);
    // Apply global volume to audio orchestrator
    if (audioOrchestrator) {
      audioOrchestrator.setMasterVolume(value);
    }
  }, [audioOrchestrator]);

  const handleToggleVolumeSlider = useCallback(() => {
    // Toggle mute when clicking the button
    if (globalVolume > 0) {
      handleGlobalVolumeChange(0);
    } else {
      handleGlobalVolumeChange(0.8);
    }
  }, [globalVolume, handleGlobalVolumeChange]);

  const handleVolumeMouseEnter = useCallback(() => {
    setIsHoveringVolume(true);
  }, []);

  const handleVolumeMouseLeave = useCallback(() => {
    setIsHoveringVolume(false);
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
      const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
      if (playbackSchedulerRef.current && soundSphereManager) {
        // Build 'playing' states from current Zustand store (paused → playing)
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
          soundIntervals
        );
      }
    }

    // Start timeline cursor (preserves currentTime)
    playTimeline();
    // Update store states (updateSoundPlayback will skip — prevStates synced by seekToTime)
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
      soundIntervals
    );
  }, [seekTo, individualSoundStates, soundIntervals]);

  // ============================================================================
  // Effect - Sync Timeline Playback with Individual Sounds
  // ============================================================================
  useEffect(() => {
    // Check if any sound is playing
    const anySoundPlaying = Object.values(individualSoundStates).some(state => state === 'playing');
    // Check if any sound is paused (timeline should stay visible but cursor paused)
    const anySoundPaused = Object.values(individualSoundStates).some(state => state === 'paused');
    // Check if all sounds are stopped (not playing and not paused)
    const allSoundsStopped = Object.values(individualSoundStates).every(state => state === 'stopped' || state === undefined);

    if (anySoundPlaying && !playbackState.isPlaying) {
      // Start timeline if a sound is playing but timeline isn't
      playTimeline();
    } else if (!anySoundPlaying && anySoundPaused && playbackState.isPlaying) {
      // Pause timeline if no sounds are playing but some are paused
      pauseTimeline();
    } else if (allSoundsStopped && (playbackState.isPlaying || playbackState.currentTime > 0)) {
      // Only stop/reset timeline if ALL sounds are stopped (not just paused)
      stopTimeline();
    }
  }, [individualSoundStates, playbackState.isPlaying, playbackState.currentTime, playTimeline, pauseTimeline, stopTimeline]);

  // ============================================================================
  // Effect - Update Selected Object Overlay Position (Animation Loop)
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !viewerRef.current || !selectedSpeckleObjectIds || selectedSpeckleObjectIds.length === 0) {
      // Only update if not already null
      if (prevOverlayRef.current !== null) {
        prevOverlayRef.current = null;
        setSelectedObjectOverlay(null);
      }
      return;
    }

    const viewer = viewerRef.current;
    const selectedId = selectedSpeckleObjectIds[0];

    // Get the selected object from world tree
    const findObjectInTree = (tree: any, id: string): any => {
      if (!tree) return null;

      const checkNode = (node: any): any => {
        const nodeId = node?.raw?.id || node?.model?.id || node?.id;
        if (nodeId === id) return node;

        const children = node?.model?.children || node?.children;
        if (children) {
          for (const child of children) {
            const found = checkNode(child);
            if (found) return found;
          }
        }
        return null;
      };

      const rootChildren = tree.tree?._root?.children || tree._root?.children || tree.root?.children || tree.children;
      if (rootChildren) {
        for (const child of rootChildren) {
          const found = checkNode(child);
          if (found) return found;
        }
      }
      return null;
    };

    const selectedObject = findObjectInTree(worldTree, selectedId);

    if (!selectedObject) {
      // Only update if not already null
      if (prevOverlayRef.current !== null) {
        prevOverlayRef.current = null;
        setSelectedObjectOverlay(null);
      }
      return;
    }

    // Animation loop to update overlay position
    const updateOverlayPosition = () => {
      if (!viewer || !selectedObject) return;

      // Get bounding box of selected object
      const renderView = viewer.getRenderer().renderingCamera;
      if (!renderView) return;

      // Try to get object bounds - Speckle objects may have bounds in different locations
      let bounds = selectedObject.raw?.bounds || selectedObject.model?.bounds;

      // If no bounds, try to get from viewer's world tree
      if (!bounds) {
        try {
          const worldTree = viewer.getWorldTree();
          const node = worldTree.findId(selectedId) as any;
          if (node && node.raw) {
            bounds = node.raw.bounds || node.raw.bbox;
          }
        } catch (e) {
          // Ignore errors
        }
      }

      let newX: number;
      let newY: number;
      let newVisible: boolean;

      if (!bounds || !bounds.min || !bounds.max) {
        // Fallback: use screen center if no bounds available
        const canvas = viewer.getRenderer().renderer.domElement;
        newX = canvas.clientWidth / 2;
        newY = canvas.clientHeight / 2;
        newVisible = true;
      } else {
        // Calculate center of bounding box
        const center = new THREE.Vector3(
          (bounds.min.x + bounds.max.x) / 2,
          (bounds.min.y + bounds.max.y) / 2,
          (bounds.min.z + bounds.max.z) / 2
        );

        // Project to screen coordinates
        const camera = renderView as THREE.Camera;
        const tempVector = center.clone();
        tempVector.project(camera);

        const canvas = viewer.getRenderer().renderer.domElement;
        newX = (tempVector.x * 0.5 + 0.5) * canvas.clientWidth;
        newY = (-(tempVector.y * 0.5) + 0.5) * canvas.clientHeight;

        // Check if behind camera
        newVisible = tempVector.z <= 1;
      }

      // Only update state if values changed significantly (avoid micro-updates)
      const prev = prevOverlayRef.current;
      const xChanged = !prev || Math.abs(prev.x - newX) > 0.5;
      const yChanged = !prev || Math.abs(prev.y - newY) > 0.5;
      const visChanged = !prev || prev.visible !== newVisible;

      if (xChanged || yChanged || visChanged) {
        prevOverlayRef.current = { x: newX, y: newY, visible: newVisible };
        setSelectedObjectOverlay({
          x: newX,
          y: newY,
          visible: newVisible,
          objectData: selectedObject
        });
      }
    };

    // Run update on animation loop
    const intervalId = setInterval(updateOverlayPosition, 16); // ~60fps

    // Also run once immediately
    updateOverlayPosition();

    return () => {
      clearInterval(intervalId);
    };
  }, [isViewerReady, viewerRef, selectedSpeckleObjectIds, worldTree]);

  // ============================================================================
  // Effect - Update Selected Entity in Context (for RightSidebar display)
  // ============================================================================
  useEffect(() => {
    const prevIds = prevSpeckleObjectIdsRef.current;
    prevSpeckleObjectIdsRef.current = selectedSpeckleObjectIds || [];

    if (!selectedSpeckleObjectIds || selectedSpeckleObjectIds.length === 0) {
      // A custom object click (sound sphere / receiver) in the same cycle cleared
      // Speckle selection via clearAllSelections — don't interfere with the entity
      // it already set via its own callback
      if (skipDeselectionRef.current) {
        skipDeselectionRef.current = false;
        return;
      }

      // If we're deselecting FROM a Speckle object (prev was non-empty),
      // always clear — even if selectedEntity has soundData (linked object case)
      const wasSpeckleSelected = prevIds.length > 0;
      if (wasSpeckleSelected) {
        setSelectedEntity(null);
        setSelectedObjectIds([]);
      } else {
        // Prev was already empty — this is a custom object (receiver/sound sphere)
        // whose selection is managed by its own click callbacks, not Speckle
        if (!selectedEntity?.receiverData && !selectedEntity?.soundData) {
          setSelectedEntity(null);
        }
        setSelectedObjectIds([]);
      }
      return;
    }

    const selectedId = selectedSpeckleObjectIds[0];

    // If this object is linked to a sound, skip — the click callback already set
    // selectedEntity with objectType 'Sound' via onSelectSoundCard/handleSelectSoundCard
    const linkState = getObjectLinkState(selectedId);
    if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
      return;
    }

    // Helper to find object in tree
    const findObjectInTree = (tree: any, id: string): any => {
      if (!tree) return null;

      const checkNode = (node: any): any => {
        const nodeId = node?.raw?.id || node?.model?.id || node?.id;
        if (nodeId === id) return node;

        const children = node?.model?.children || node?.children;
        if (children) {
          for (const child of children) {
            const found = checkNode(child);
            if (found) return found;
          }
        }
        return null;
      };

      const rootChildren = tree.tree?._root?.children || tree._root?.children || tree.root?.children || tree.children;
      if (rootChildren) {
        for (const child of rootChildren) {
          const found = checkNode(child);
          if (found) return found;
        }
      }
      return null;
    };

    // Helper to find parent name
    const findParentName = (tree: any, childId: string): string | undefined => {
      if (!tree) return undefined;

      const checkNode = (node: any, parentNode: any): string | undefined => {
        const nodeId = node?.raw?.id || node?.model?.id || node?.id;
        if (nodeId === childId && parentNode) {
          return parentNode?.model?.name || parentNode?.raw?.name || undefined;
        }

        const children = node?.model?.children || node?.children;
        if (children) {
          for (const child of children) {
            const result = checkNode(child, node);
            if (result) return result;
          }
        }
        return undefined;
      };

      const rootChildren = tree.tree?._root?.children || tree._root?.children || tree.root?.children || tree.children;
      if (rootChildren) {
        for (const child of rootChildren) {
          const result = checkNode(child, null);
          if (result) return result;
        }
      }
      return undefined;
    };

    const selectedObject = findObjectInTree(worldTree, selectedId);

    if (!selectedObject) {
      setSelectedEntity(null);
      setSelectedObjectIds([]);
      return;
    }

    const objectName = selectedObject.model?.name || selectedObject.raw?.name || 'Unnamed';
    const objectType = selectedObject.raw?.speckle_type || 'Speckle Object';
    const parentName = findParentName(worldTree, selectedId);

    setSelectedEntity({
      objectId: selectedId,
      objectName,
      objectType,
      parentName
    });
    setSelectedObjectIds(selectedSpeckleObjectIds);
  }, [selectedSpeckleObjectIds, worldTree, setSelectedEntity, setSelectedObjectIds, selectedEntity?.receiverData, getObjectLinkState]);

  // ============================================================================  // Keyboard Controls - First-Person Mode
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!coordinatorRef.current) return;

      const isFirstPerson = coordinatorRef.current.isFirstPersonMode();

      if (!isFirstPerson) return;

      const rotationSpeed = 0.05; // radians per key press

      switch (event.key) {
        case 'ArrowRight':
          // Rotate left: positive yaw (rotate view left)
          coordinatorRef.current.rotateFirstPersonView(rotationSpeed, 0);
          event.preventDefault();
          break;
        case 'ArrowLeft':
          // Rotate right: negative yaw (rotate view right)
          coordinatorRef.current.rotateFirstPersonView(-rotationSpeed, 0);
          event.preventDefault();
          break;
        case 'ArrowDown':
          // Look up: negative pitch (look up in Three.js coordinate system)
          coordinatorRef.current.rotateFirstPersonView(0, -rotationSpeed);
          event.preventDefault();
          break;
        case 'ArrowUp':
          // Look down: positive pitch (look down in Three.js coordinate system)
          coordinatorRef.current.rotateFirstPersonView(0, rotationSpeed);
          event.preventDefault();
          break;
        case 'Escape':
          coordinatorRef.current.disableFirstPersonMode();
          setIsFirstPersonMode(false);
          event.preventDefault();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // ============================================================================
  // Effect - Sync Timeline Playback with Individual Sounds
  // ============================================================================
  useEffect(() => {
    // Check if any sound is playing
    const anySoundPlaying = Object.values(individualSoundStates).some(state => state === 'playing');
    // Check if any sound is paused (timeline should stay visible but cursor paused)
    const anySoundPaused = Object.values(individualSoundStates).some(state => state === 'paused');
    // Check if all sounds are stopped (not playing and not paused)
    const allSoundsStopped = Object.values(individualSoundStates).every(state => state === 'stopped' || state === undefined);

    if (anySoundPlaying && !playbackState.isPlaying) {
      // Start timeline if a sound is playing but timeline isn't
      playTimeline();
    } else if (!anySoundPlaying && anySoundPaused && playbackState.isPlaying) {
      // Pause timeline if no sounds are playing but some are paused
      pauseTimeline();
    } else if (allSoundsStopped && (playbackState.isPlaying || playbackState.currentTime > 0)) {
      // Only stop/reset timeline if ALL sounds are stopped (not just paused)
      stopTimeline();
    }
  }, [individualSoundStates, playbackState.isPlaying, playbackState.currentTime, playTimeline, pauseTimeline, stopTimeline]);

  // ============================================================================
  // Effect - Notify Parent of Receiver Mode Changes (Change Detection)
  // ============================================================================
  useEffect(() => {
    if (!onReceiverModeChange) return;

    // Use the selected receiver ID, or fall back to first receiver if in first-person mode
    const receiverId = isFirstPersonMode
      ? (selectedReceiverId || (receivers.length > 0 ? receivers[0].id : null))
      : null;

    // Only notify if state actually changed (prevent infinite loop)
    const prev = prevReceiverModeRef.current;
    if (prev.isActive !== isFirstPersonMode || prev.receiverId !== receiverId) {
      console.log('[SpeckleScene] Receiver mode changed:', { isFirstPersonMode, receiverId });
      onReceiverModeChange(isFirstPersonMode, receiverId);
      prevReceiverModeRef.current = { isActive: isFirstPersonMode, receiverId };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstPersonMode, selectedReceiverId, receivers[0]?.id]);

  // ============================================================================
  // Effect - Cleanup on component unmount
  // ============================================================================
  useEffect(() => {
    return () => {
      // Cleanup bounding box on unmount
      if (boundingBoxManagerRef.current) {
        console.log('[SpeckleScene] Cleaning up bounding box manager on unmount');
        boundingBoxManagerRef.current.dispose();
      }
    };
  }, []);

  // ============================================================================
  // Effect - Go To Receiver (First-Person Mode)
  // ============================================================================
  useEffect(() => {
    if (!goToReceiverId || !coordinatorRef.current) return;

    // Get receiver mesh from ReceiverManager to use current position (after drag)
    const receiverManager = coordinatorRef.current.getReceiverManager();
    if (!receiverManager) {
      console.warn('[SpeckleScene] Go to receiver: ReceiverManager not initialized');
      return;
    }

    const receiverMeshes = receiverManager.getReceiverMeshes();
    const receiverMesh = receiverMeshes.find(mesh => mesh.userData.receiverId === goToReceiverId);

    if (!receiverMesh) {
      console.warn('[SpeckleScene] Go to receiver: Receiver mesh not found:', goToReceiverId);
      return;
    }

    // Use current mesh position (which reflects dragged position)
    const receiverPosition = receiverMesh.position.clone();
    console.log('[SpeckleScene] Go to receiver:', { id: goToReceiverId, position: receiverPosition.toArray() });

    // Calculate initial look-at target (same logic as double-click in coordinator)
    // Try to look at the average of sound spheres, or default to looking forward
    let initialTarget: THREE.Vector3;

    // Get average position of sound sphere meshes (not soundscapeData - use actual mesh positions)
    const soundSphereManager = coordinatorRef.current.getSoundSphereManager();
    const soundSphereMeshes = soundSphereManager?.getSoundSphereMeshes() || [];
    const soundSpherePositions: THREE.Vector3[] = soundSphereMeshes.map(mesh => mesh.position.clone());

    if (soundSpherePositions.length > 0) {
      // Average of all sound sphere positions
      const sum = soundSpherePositions.reduce(
        (acc, pos) => acc.add(pos),
        new THREE.Vector3(0, 0, 0)
      );
      initialTarget = sum.divideScalar(soundSpherePositions.length);
    } else {
      // Default: look forward (negative Y direction in Z-up Speckle coordinate system)
      initialTarget = new THREE.Vector3(
        receiverPosition.x,
        receiverPosition.y - 5,
        receiverPosition.z
      );
    }

    // Enable first-person mode with calculated target
    coordinatorRef.current.enableFirstPersonMode(receiverPosition, initialTarget);
    setIsFirstPersonMode(true);

    // Update active receiver for simulation-based IR switching
    // This triggers IR loading for all sources based on this receiver
    coordinatorRef.current.updateActiveReceiver(goToReceiverId);

    console.log('[SpeckleScene] Activated first-person mode for receiver:', {
      receiverId: goToReceiverId,
      position: receiverPosition.toArray(),
      target: initialTarget.toArray()
    });
  }, [goToReceiverId, receivers, soundscapeData]);

  // ============================================================================
  // IR Hover Line (source ↔ receiver)
  // ============================================================================
  useEffect(() => {
    if (!IR_HOVER_LINE.ENABLED || !coordinatorRef.current) return;

    // Remove existing line
    if (irHoverLineRef.current) {
      const scene = viewerRef.current?.getRenderer().scene;
      if (scene) scene.remove(irHoverLineRef.current);
      irHoverLineRef.current.geometry.dispose();
      (irHoverLineRef.current.material as THREE.Material).dispose();
      irHoverLineRef.current = null;
      viewerRef.current?.requestRender();
    }

    if (!hoveredIRSourceReceiver) return;

    const { sourceId, receiverId } = hoveredIRSourceReceiver;

    // Look up positions from managers
    const soundSphereManager = coordinatorRef.current.getSoundSphereManager();
    const receiverManager = coordinatorRef.current.getReceiverManager();
    if (!soundSphereManager || !receiverManager) return;

    const sourceMetadata = soundSphereManager.getAudioSource(sourceId);
    const receiverPos = receivers.find(r => r.id === receiverId)?.position;

    if (!sourceMetadata || !receiverPos) return;

    const srcPos = sourceMetadata.position;
    const points = [
      new THREE.Vector3(srcPos.x, srcPos.y, srcPos.z),
      new THREE.Vector3(receiverPos[0], receiverPos[1], receiverPos[2]),
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: IR_HOVER_LINE.COLOR,
      opacity: IR_HOVER_LINE.OPACITY,
      transparent: true,
      dashSize: IR_HOVER_LINE.DASH_SIZE,
      gapSize: IR_HOVER_LINE.GAP_SIZE,
      depthTest: false,
      depthWrite: false,
    });

    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = 9999;
    line.layers.enable(4); // SPECKLE_OVERLAY_LAYER

    const scene = viewerRef.current?.getRenderer().scene;
    if (scene) {
      scene.add(line);
      irHoverLineRef.current = line;
      viewerRef.current?.requestRender();
    }

    return () => {
      if (irHoverLineRef.current) {
        const scene = viewerRef.current?.getRenderer().scene;
        if (scene) scene.remove(irHoverLineRef.current);
        irHoverLineRef.current.geometry.dispose();
        (irHoverLineRef.current.material as THREE.Material).dispose();
        irHoverLineRef.current = null;
        viewerRef.current?.requestRender();
      }
    };
  }, [hoveredIRSourceReceiver, receivers]);

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <div
      className={`relative w-full h-full ${className || ''}`}
      style={{ height: '100vh', backgroundColor: isDarkMode ? '#000000' : undefined }}
    >
      {/* Viewer container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        id="speckle-scene-container"
      />

      {/* View Mode Switch - Top Right of Viewer (Acoustic | Default | Dark) */}
      {isViewerReady && (
        <div
          className="absolute top-4 z-20 pointer-events-auto transition-all duration-300 flex flex-col items-end gap-1"
          style={{
            right: isRightSidebarExpanded ? `${UI_RIGHT_SIDEBAR.WIDTH + 20}px` : '20px'
          }}
        >
          <div
            className="flex items-center rounded-md overflow-hidden"
            style={{
              backgroundColor: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
            role="radiogroup"
            aria-label="View mode"
          >
            {([ 
              { mode: 'acoustic', label: 'Acoustic', title: 'Acoustic mode: layer isolation + material colors' },
              { mode: 'default', label: 'Default', title: 'Default mode: normal view' },
              { mode: 'dark', label: 'Dark', title: 'Dark mode: sound source lighting' },
            ] as const).map(({ mode, label, title }) => {
              const isActive = viewMode === mode;
              const accentColor = mode === 'dark' ? DARK_MODE.LIGHT_COLOR : 'var(--color-info, #00d4ff)';
              return (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setViewMode(mode)}
                  title={title}
                  className="px-2.5 py-1 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: isActive
                      ? (mode === 'dark' ? 'rgba(0,212,255,0.18)' : 'rgba(0,212,255,0.13)')
                      : 'transparent',
                    color: isActive ? accentColor : 'rgba(255,255,255,0.55)',
                    borderRight: mode !== 'dark' ? '1px solid rgba(255,255,255,0.12)' : undefined,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Undo / Redo toolbar */}
          <div
            className="flex items-center rounded-md overflow-hidden"
            style={{
              backgroundColor: 'rgba(0,0,0,0.45)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <UndoRedoToolbar />
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none bg-white bg-opacity-50"
        >
          <div className="flex flex-col items-center gap-3">
            <div
              className="animate-spin rounded-full border-4 border-t-transparent"
              style={{
                width: '48px',
                height: '48px',
                borderColor: UI_COLORS.PRIMARY,
                borderTopColor: 'transparent',
              }}
            />
            <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              Loading model...
            </p>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50"
        >
          <div className="text-center p-8">
            <div className="text-6xl mb-4">⚠️</div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: UI_COLORS.ERROR }}>
              Failed to Load Model
            </h3>
            <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Empty state - File upload */}
      {!modelUrl && !isLoading && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-50"
        >
          <div className="flex flex-col items-center gap-6 p-8" style={{ maxWidth: '400px' }}>
            <div className="text-center">
              {/* Fixed header - prevents wrapping issues */}
            <div className="flex items-center gap-4 flex-shrink-0 mb-4 justify-center">
              <Image className="dark:invert flex-shrink-0" src="/compas_icon_white.png" alt="compas logo" width={100} height={100} priority />
            </div>
              <h3 className="text-xl font-semibold mb-2">
                Compas Soundscape
              </h3>
              <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                Upload a 3D model to start
              </p>
            </div>

            {/* File Upload Area */}
            <div className="w-full">
              <FileUploadArea
                file={modelFile}
                isDragging={isDragging}
                acceptedFormats={MODEL_FILE_EXTENSIONS.join(',')}
                acceptedExtensions={MODEL_FILE_EXTENSIONS.join(', ')}
                onFileChange={handleFileChange}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                inputId="scene-model-upload"
                multiple={false}
              />
            </div>

            {/* Speckle Model Browser */}
            {onSpeckleModelSelect && (
              <SpeckleModelBrowser onModelSelect={onSpeckleModelSelect} />
            )}

            {/* Supported formats
            <div className="text-xs space-y-2 text-center" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              <p className="font-medium" style={{ color: UI_COLORS.NEUTRAL_400 }}>Supported Formats:</p>
              <p>.3dm (Rhino) &middot; .ifc (IFC) &middot; .obj (Wavefront)</p>
            </div> */}
          </div>
        </div>
      )}

      {/* Audio Timeline - Bottom Center (dynamically centered between sidebars) */}
      {showTimeline && isViewerReady && timelineSounds.length > 0 && (() => {
        // Calculate sidebar widths for centering
        const leftSidebarWidth = UI_VERTICAL_TABS.WIDTH + (isLeftSidebarExpanded ? LEFT_SIDEBAR_CONTENT_WIDTH : 0);
        const rightSidebarWidth = isRightSidebarExpanded ? UI_RIGHT_SIDEBAR.WIDTH : RIGHT_SIDEBAR_COLLAPSED_WIDTH;
        // Center offset: positive = shift right
        const centerOffset = (leftSidebarWidth - rightSidebarWidth) / 2;

        return (
          <div
            className="absolute pointer-events-auto z-10 transition-all duration-300"
            style={{
              bottom: `${TIMELINE_LAYOUT.BOTTOM_OFFSET_PX * 4}px`,
              // Center between the two sidebars — width is driven by WaveSurferTimeline content
              left: `calc(50% + ${centerOffset}px)`,
              transform: 'translateX(-50%)',
              // Constrain to available space; WaveSurferTimeline sets its own width
              maxWidth: `min(calc(100% - ${leftSidebarWidth}px - ${rightSidebarWidth}px - ${TIMELINE_LAYOUT.SIDEBAR_HORIZONTAL_OFFSET_PX}px), ${TIMELINE_LAYOUT.MAX_WIDTH_PX}px)`,
            }}
          >
          <WaveSurferTimeline
            sounds={timelineSounds}
            currentTime={playbackState.currentTime}
            onSeek={handleSeek}
            mutedSounds={mutedSounds}
            soloedSound={soloedSound}
            onRefresh={handleRefreshTimeline}
            onDownload={handleDownloadTimeline}
          />
          </div>
        );
      })()}

      {/* Playback Controls - Bottom Center (dynamically centered between sidebars) */}
      <PlaybackControls
        onPlayAll={handlePlayAll}
        onPauseAll={handlePauseAll}
        onStopAll={handleStopAll}
        onToggleAuralization={handleToggleAuralization}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
        isLeftSidebarExpanded={isLeftSidebarExpanded}
        isRightSidebarExpanded={isRightSidebarExpanded}
      />

      {/* NOTE: Selected Object Info moved to RightSidebar EntityInfoPanel */}

      {/* 3D Controls Info - Bottom Left */}
      {isViewerReady && <ControlsInfo />}

      {/* Bottom-right control buttons */}
      {isViewerReady && (
        <div
          className="absolute bottom-6 flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
          style={{
            gap: UI_SCENE_BUTTON.GAP,
            // When expanded: offset by full sidebar width + 24px margin
            // When collapsed: offset by collapsed width (40px) + 24px margin
            right: isRightSidebarExpanded ? `${UI_RIGHT_SIDEBAR.WIDTH + 20}px` : '20px'
          }}
        >
          {/* Global Volume Control with Hover Slider */}
          <div
            className="flex flex-col items-center"
            onMouseEnter={handleVolumeMouseEnter}
            onMouseLeave={handleVolumeMouseLeave}
          >
            {/* Global Volume Slider (appears above button on hover) */}
            {isHoveringVolume && (
              <div data-volume-slider className="mb-1 flex items-center justify-center">
                <VerticalVolumeSlider
                  value={globalVolume}
                  onChange={handleGlobalVolumeChange}
                />
              </div>
            )}

            {/* Global Volume Button */}
            <div data-volume-button>
              <SceneControlButton
                onClick={handleToggleVolumeSlider}
                isActive={globalVolume === 0}
                activeColor={UI_COLORS.WARNING}
                title="Global Volume"
                icon={globalVolume === 0 ? (
                  <Icon>
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </Icon>
                ) : (
                  <Icon>
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </Icon>
                )}
              />
            </div>
          </div>


        {/* Save Soundscape to Speckle Button */}
        {soundscapeData && soundscapeData.length > 0 && speckleData && onSaveSoundscape && (
          <SceneControlButton
            onClick={onSaveSoundscape}
            isActive={isSavingSoundscape}
            title={isSavingSoundscape ? "Saving soundscape..." : "Save soundscape to Speckle"}
            icon={
              isSavingSoundscape ? (
                <Icon>
                  <circle cx="12" cy="12" r="10" strokeDasharray="31.4 31.4" strokeDashoffset="0">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                  </circle>
                </Icon>
              ) : (
                <Icon>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </Icon>
              )
            }
          />
        )}

        {/* Reset Zoom Button */}
        <SceneControlButton
          onClick={handleResetZoom}
          title="Reset camera view"
          icon={
            <Icon>
              <rect x="3" y="3" width="18" height="18" strokeDasharray="3 3" />
            </Icon>
          }
        />

        {/* Toggle Timeline Button */}
        <SceneControlButton
          onClick={() => setShowTimeline(!showTimeline)}
          isActive={showTimeline}
          title={showTimeline ? "Hide timeline" : "Show timeline"}
          icon={
            <Icon>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M8 14h.01" />
              <path d="M12 14h.01" />
              <path d="M16 14h.01" />
              <path d="M8 18h.01" />
              <path d="M12 18h.01" />
              <path d="M16 18h.01" />
            </Icon>
          }
        />
      </div>
      
        )}
    </div>
  );
}
'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ControlsInfo } from '@/components/layout/sidebar/ControlsInfo';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { useSpeckleStore, useAcousticsSimulationStore, useGridListenersStore } from '@/store';
import { useRightSidebarStore } from '@/store/rightSidebarStore';
import { useUIStore } from '@/store/uiStore';
import { useTextGenerationStore } from '@/store/textGenerationStore';
import { apiService } from '@/services/api';
import { useSpeckleTree } from '@/hooks/useSpeckleTree';
import { useAudioControlsStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { Viewer, CameraController, SelectionExtension, FilteringExtension } from '@speckle/viewer';
import type * as THREE from 'three';
import { Vector2 as ThreeVector2 } from 'three';
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
import { useSpeckleGroundGrid } from '@/components/scene/hooks/useSpeckleGroundGrid';
// Phase 5 JSX sub-components
import { SceneViewModeToolbar } from '@/components/scene/SceneViewModeToolbar';
import { SceneFPSOverlay } from '@/components/scene/SceneFPSOverlay';
import { SceneContextMenu } from '@/components/scene/SceneContextMenu';
import { SceneHoverPreview } from '@/components/scene/SceneHoverPreview';
import { SceneEmptyState } from '@/components/scene/SceneEmptyState';
import { SceneTimeline } from '@/components/scene/SceneTimeline';
import { SceneControlButtons } from '@/components/scene/SceneControlButtons';
import { ObjectExplorerPanel } from '@/components/scene/ObjectExplorerPanel';
import { SceneControlButton } from '@/components/ui/SceneControlButton';
import { UndoRedoToolbar } from '@/components/ui/UndoRedoToolbar';
import { UI_RIGHT_SIDEBAR, UI_SCENE_BUTTON } from '@/utils/constants';
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

  // Soundscape persistence
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
  const showAdvancedSettings = useUIStore((s) => s.showAdvancedSettings);
  const setShowAdvancedSettings = useUIStore((s) => s.setShowAdvancedSettings);
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
  const [showObjectExplorer, setShowObjectExplorer] = useState(false);

  // Derived: dark mode is active only in 'dark' view mode
  const isDarkMode = viewMode === 'dark';
  // Non-reactive refs — read by hover patch set up in useSpeckleViewerInit
  const isDarkModeRef = useRef(false);
  const isAcousticModeRef = useRef(false);
  const showHoveringHighlightRef = useRef(true);

  const [selectedSpeckleObjectIds, setSelectedSpeckleObjectIds] = useState<string[]>([]);
  // Flag to skip the deselection effect when a sound sphere click clears Speckle selection
  const skipDeselectionRef = useRef(false);

  // Context menu (right-click floating panel)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const savedPrevEntityRef = useRef<import('@/store/speckleStore').SelectedEntityInfo | null>(null);

  // Hover preview — shown after 2 s of dwelling over a Speckle object
  const [hoverPreview, setHoverPreview] = useState<{ x: number; y: number; objectName: string; objectType: string; parentName?: string } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so timer callbacks can read contextMenuPos without stale closure
  const contextMenuPosRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { contextMenuPosRef.current = contextMenuPos; }, [contextMenuPos]);
  const savedPrevObjectIdsRef = useRef<string[]>([]);
  // Refs for latest mutable values accessible inside event callbacks without re-registering listeners
  const worldTreeRef = useRef<any>(null);
  const isFirstPersonModeRef = useRef(false);
  const setSelectedSpeckleObjectIdsRef = useRef(setSelectedSpeckleObjectIds);
  useEffect(() => { setSelectedSpeckleObjectIdsRef.current = setSelectedSpeckleObjectIds; });

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

  // Keep worldTreeRef current for use inside event callbacks
  useEffect(() => { worldTreeRef.current = worldTree; }, [worldTree]);

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

  // Keep isFirstPersonModeRef current for event callbacks
  useEffect(() => { isFirstPersonModeRef.current = isFirstPersonMode; }, [isFirstPersonMode]);

  // ── Right-click context menu ──
  // Shows the EntityInfoPanel as a floating panel at cursor position.
  // Only fires when the mouse has not moved (no orbit/pan drag).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Do not open in FPS mode or when the mouse was dragged (orbiting/panning).
      // Reuse SpeckleEventBridge's wasOrbiting flag — it tracks pointerdown/pointerup
      // for all buttons (no button filter), so right-click drags are already detected.
      const wasDragging = coordinatorRef.current?.getWasOrbiting() ?? false;
      if (isFirstPersonModeRef.current || wasDragging) return;

      // Dismiss hover preview immediately when the full panel opens
      setHoverPreview(null);
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }

      const { viewer, selectionExtension: sel, filteringExtension: fe } = useSpeckleEngineStore.getState();
      if (!viewer || !sel) return;

      // Convert client coordinates to NDC
      const renderer = viewer.getRenderer();
      const canvas = renderer.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      const mouse = new ThreeVector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      // ── 1. Try custom objects (sound spheres + receivers) first ──
      const adapter = coordinatorRef.current?.getAdapter();
      const customHit = adapter?.raycastCustomObjectsAt(mouse) ?? null;

      if (customHit) {
        const obj = customHit.object;
        const currentState = useSpeckleStore.getState();
        savedPrevEntityRef.current = currentState.selectedEntity;
        savedPrevObjectIdsRef.current = (currentState as any).selectedObjectIds ?? [];

        useRightSidebarStore.getState().setRightClickActive(true);

        let entityData: import('@/store/speckleStore').SelectedEntityInfo;

        if (customHit.type === 'sound') {
          const soundEvent = obj.userData.soundEvent as import('@/types').SoundEvent | undefined;
          const promptKey = obj.userData.promptKey as string | undefined;
          const promptIndex = promptKey ? parseInt(promptKey.replace('prompt_', ''), 10) : 0;
          entityData = {
            objectId: soundEvent?.id ?? obj.uuid,
            objectName: soundEvent?.display_name || soundEvent?.id || 'Sound Sphere',
            objectType: 'Sound',
            soundData: { promptIndex },
          };
        } else {
          // receiver
          const pos = obj.position;
          entityData = {
            objectId: obj.userData.receiverId ?? obj.uuid,
            objectName: obj.userData.receiverName || 'Receiver',
            objectType: 'Receiver',
            receiverData: { position: [pos.x, pos.y, pos.z] },
          };
        }

        sel.selectObjects([]);
        setSelectedEntity(entityData);
        setSelectedObjectIds([entityData.objectId]);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        return;
      }

      // ── 2. Fall through to Speckle scene objects ──
      let foundId: string | null = null;
      try {
        const intersections = (renderer as any).intersections.intersect(
          renderer.scene,
          renderer.renderingCamera,
          mouse,
          undefined,
          false,
          undefined
        );
        if (intersections?.length) {
          for (const hit of intersections) {
            const pair = (renderer as any).renderViewFromIntersection(hit);
            if (!pair) continue;
            const rv = pair[0];
            const objectId: string | undefined = rv?.renderData?.id;
            if (!objectId) continue;

            // Skip objects hidden by FilteringExtension
            if (fe) {
              const state = fe.filteringState;
              const isHidden = state?.hiddenObjects?.includes(objectId) ?? false;
              const isExcluded =
                (state?.isolatedObjects?.length ?? 0) > 0 &&
                !state?.isolatedObjects?.includes(objectId);
              if (isHidden || isExcluded) continue;
            }

            foundId = objectId;
            break;
          }
        }
      } catch (err) {
        console.warn('[SpeckleScene] Context menu intersection error:', err);
      }

      if (foundId) {
        const currentState = useSpeckleStore.getState();
        savedPrevEntityRef.current = currentState.selectedEntity;
        savedPrevObjectIdsRef.current = (currentState as any).selectedObjectIds ?? [];

        sel.selectObjects([foundId]);
        useRightSidebarStore.getState().setRightClickActive(true);

        // Build entity data directly from world tree for immediate display
        let entityData: import('@/store/speckleStore').SelectedEntityInfo = {
          objectId: foundId,
          objectName: 'Unknown',
          objectType: 'Speckle Object',
        };
        const tree = worldTreeRef.current;
        if (tree) {
          const rootChildren =
            tree.tree?._root?.children ||
            tree._root?.children ||
            tree.root?.children ||
            tree.children;

          const findNodeWithParent = (node: any, id: string, parent: any): { node: any; parent: any } | null => {
            const nodeId = node?.raw?.id || node?.model?.id || node?.id;
            if (nodeId === id) return { node, parent };
            const children = node?.model?.children || node?.children;
            if (children) {
              for (const child of children) {
                const found = findNodeWithParent(child, id, node);
                if (found) return found;
              }
            }
            return null;
          };

          let result: { node: any; parent: any } | null = null;
          if (rootChildren) {
            for (const child of rootChildren) {
              result = findNodeWithParent(child, foundId, null);
              if (result) break;
            }
          }
          if (result) {
            const objectName = result.node.model?.name || result.node.raw?.name || 'Unnamed';
            const objectType = result.node.raw?.speckle_type || 'Speckle Object';
            const parentName = result.parent
              ? (result.parent.model?.name || result.parent.raw?.name || undefined)
              : undefined;
            entityData = { objectId: foundId, objectName, objectType, parentName };
          }
        }

        // If this Speckle object has a linked sound, show the WaveSurfer player
        const linkState = getObjectLinkState(foundId);
        if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
          entityData = {
            ...entityData,
            objectType: 'Sound',
            soundData: { promptIndex: linkState.linkedSoundIndex },
          };
        }

        setSelectedEntity(entityData);
        setSelectedObjectIds([foundId]);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
      }
    };

    container.addEventListener('contextmenu', handleContextMenu);

    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // ── Hover preview (2 s dwell) ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const clearHoverTimer = () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };

    const clearHoverHideTimer = () => {
      if (hoverHideTimerRef.current) {
        clearTimeout(hoverHideTimerRef.current);
        hoverHideTimerRef.current = null;
      }
    };

    const scheduleHide = () => {
      clearHoverHideTimer();
      hoverHideTimerRef.current = setTimeout(() => {
        setHoverPreview(null);
      }, 600);
    };

    const handlePointerMove = (e: PointerEvent) => {
      // Only track idle hover — no buttons held, not in FPS mode
      if (e.buttons !== 0 || isFirstPersonModeRef.current) {
        clearHoverTimer();
        clearHoverHideTimer();
        setHoverPreview(null);
        return;
      }

      // If the preview is already visible, schedule a hide on movement
      // (checked via ref so we don't depend on stale closure)
      clearHoverHideTimer();
      scheduleHide();
      clearHoverTimer();
      const clientX = e.clientX;
      const clientY = e.clientY;

      hoverTimerRef.current = setTimeout(() => {
        // Skip if context menu is already open
        if (contextMenuPosRef.current) return;

        const { viewer, filteringExtension: fe } = useSpeckleEngineStore.getState();
        if (!viewer) return;

        const renderer = viewer.getRenderer();
        const canvas = renderer.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        const mouse = new ThreeVector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        );

        // Try custom objects first
        const adapter = coordinatorRef.current?.getAdapter();
        const customHit = adapter?.raycastCustomObjectsAt(mouse) ?? null;
        if (customHit) {
          const obj = customHit.object;
          const objectName = customHit.type === 'sound'
            ? (obj.userData.soundEvent?.display_name || obj.userData.soundEvent?.id || 'Sound Sphere')
            : (obj.userData.receiverName || 'Receiver');
          const objectType = customHit.type === 'sound' ? 'Sound' : 'Receiver';
          setHoverPreview({ x: clientX, y: clientY, objectName, objectType });
          return;
        }

        // Fall through to Speckle scene objects
        try {
          const intersections = (renderer as any).intersections.intersect(
            renderer.scene,
            renderer.renderingCamera,
            mouse,
            undefined,
            false,
            undefined
          );
          if (!intersections?.length) return;

          for (const hit of intersections) {
            const pair = (renderer as any).renderViewFromIntersection(hit);
            if (!pair) continue;
            const rv = pair[0];
            const objectId: string | undefined = rv?.renderData?.id;
            if (!objectId) continue;

            if (fe) {
              const state = fe.filteringState;
              const isHidden = state?.hiddenObjects?.includes(objectId) ?? false;
              const isExcluded =
                (state?.isolatedObjects?.length ?? 0) > 0 &&
                !state?.isolatedObjects?.includes(objectId);
              if (isHidden || isExcluded) continue;
            }

            // Resolve name from world tree
            let objectName = 'Speckle Object';
            let objectType = 'Speckle Object';
            let parentName: string | undefined;
            const tree = worldTreeRef.current;
            if (tree) {
              const rootChildren =
                tree.tree?._root?.children ||
                tree._root?.children ||
                tree.root?.children ||
                tree.children;

              const findNodeWithParent = (node: any, id: string, parent: any): { node: any; parent: any } | null => {
                const nodeId = node?.raw?.id || node?.model?.id || node?.id;
                if (nodeId === id) return { node, parent };
                const children = node?.model?.children || node?.children;
                if (children) {
                  for (const child of children) {
                    const found = findNodeWithParent(child, id, node);
                    if (found) return found;
                  }
                }
                return null;
              };

              if (rootChildren) {
                for (const child of rootChildren) {
                  const result = findNodeWithParent(child, objectId, null);
                  if (result) {
                    objectName = result.node.model?.name || result.node.raw?.name || 'Unnamed';
                    objectType = result.node.raw?.speckle_type || 'Speckle Object';
                    if (result.parent) {
                      parentName = result.parent.model?.name || result.parent.raw?.name || undefined;
                    }
                    break;
                  }
                }
              }
            }

            setHoverPreview({ x: clientX, y: clientY, objectName, objectType, parentName });
            return;
          }
        } catch {
          // silently ignore hover raycast errors
        }
        // No object under cursor
        setHoverPreview(null);
      }, 2000);
    };

    const handlePointerLeave = () => {
      clearHoverTimer();
      clearHoverHideTimer();
      setHoverPreview(null);
    };

    // Left-click: hide preview after short delay
    const handlePointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      clearHoverTimer();
      scheduleHide();
    };

    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('pointerdown', handlePointerDown);

    return () => {
      clearHoverTimer();
      clearHoverHideTimer();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('pointerdown', handlePointerDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

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

  // ── Ground Grid ──
  useSpeckleGroundGrid({ isViewerReady });

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
        <SceneViewModeToolbar />
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
          onPlay={handlePlayAll}
          onPause={handlePauseAll}
          onStop={handleStopAll}
          onClose={() => setShowTimeline(false)}
          isAnyPlaying={isAnyPlaying}
          onSelectSoundCard={onSelectSoundCard}
          originalIRChannelCount={audioOrchestrator?.getIRState().channelCount ?? 0}
        />
      )}


      {/* Advanced Settings toggle — top-right */}

      <div
        className="absolute pointer-events-auto z-20 transition-all duration-300 flex gap-2"
        style={{
          top: '16px',
          right: isRightSidebarExpanded ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 10}px` : '10px',
        }}
      >
        <UndoRedoToolbar />
        <SceneControlButton
          onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
          isActive={showAdvancedSettings}
          title={showAdvancedSettings ? 'Close Settings' : 'Open Settings'}
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          }
        />
      </div>


      {/* Object Explorer floating panel — always mounted so ObjectExplorer initializes (auto-hides Acoustics layer) on load */}
      <ObjectExplorerPanel
        isVisible={showObjectExplorer}
        onClose={() => setShowObjectExplorer(false)}
        isRightSidebarExpanded={isRightSidebarExpanded}
        rightSidebarWidth={rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH}
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

      {/* Object Explorer toggle — bottom right */}
      {isViewerReady && (
        <div
          className="absolute bottom-4 flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
          style={{
            gap: UI_SCENE_BUTTON.GAP,
            right: isRightSidebarExpanded ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 10}px` : '10px',
          }}
        >
          <SceneControlButton
            onClick={() => setShowObjectExplorer((v) => !v)}
            isActive={showObjectExplorer}
            title={showObjectExplorer ? 'Close Object Explorer' : 'Open Object Explorer'}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            }
          />
        </div>
      )}

      {/* Hover preview — shown after 2 s dwell, dismissed on right-click */}
      {hoverPreview && !contextMenuPos && (
        <SceneHoverPreview
          x={hoverPreview.x}
          y={hoverPreview.y}
          entity={{ objectName: hoverPreview.objectName, objectType: hoverPreview.objectType, parentName: hoverPreview.parentName }}
        />
      )}

      {/* Right-click context menu — floating EntityInfoPanel */}
      {contextMenuPos && (
        <SceneContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          onClose={() => {
            setContextMenuPos(null);
            useRightSidebarStore.getState().setRightClickActive(false);
            // Restore the entity and selection that were active before right-click
            setSelectedEntity(savedPrevEntityRef.current);
            setSelectedObjectIds(savedPrevObjectIdsRef.current);
            const { selectionExtension: sel } = useSpeckleEngineStore.getState();
            if (sel) {
              if (savedPrevObjectIdsRef.current.length > 0) {
                sel.selectObjects(savedPrevObjectIdsRef.current);
              } else {
                sel.selectObjects([]);
              }
            }
            savedPrevEntityRef.current = null;
            savedPrevObjectIdsRef.current = [];
          }}
          onOpenExplorer={() => setShowObjectExplorer(true)}
          generatedSounds={soundscapeData ?? undefined}
        />
      )}
    </div>
  );
}
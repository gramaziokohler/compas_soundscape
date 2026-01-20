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
} from '@speckle/viewer';
import { WaveSurferTimeline } from '@/components/audio/WaveSurferTimeline';
import { PlaybackControls } from '@/components/controls/PlaybackControls';
import { ControlsInfo } from '@/components/layout/sidebar/ControlsInfo';
import { SceneControlButton } from '@/components/scene/SceneControlButton';
import { Icon } from '@/components/ui/Icon';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { useTimelinePlayback } from '@/hooks/useTimelinePlayback';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { useSpeckleTree, getHeaderAndSubheader } from '@/hooks/useSpeckleTree';
import {
  extractTimelineSoundsFromData,
  calculateTimelineDurationFromData,
} from '@/lib/audio/timeline-utils';
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
} from '@/lib/constants';

// Left sidebar content width when expanded (matches Sidebar.tsx: 20rem = 320px)
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;
import type { SoundEvent, ReceiverData } from '@/types';
import type { AuralizationConfig } from '@/types/audio';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { TimelineSound } from '@/types/audio';

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
  selectedVariants: { [key: number]: number };
  individualSoundStates: { [key: string]: 'playing' | 'paused' | 'stopped' };
  soundVolumes: { [key: string]: number };
  soundIntervals: { [key: string]: number };
  mutedSounds: Set<string>;
  soloedSound: string | null;
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
  onPlayAll?: () => void;
  onPauseAll?: () => void;
  onStopAll?: () => void;
  isAnyPlaying?: boolean;

  // Resonance Audio (ShoeBox Acoustics) - NEW
  resonanceAudioConfig?: import('@/types/audio').ResonanceAudioConfig;
  geometryBounds?: { min: [number, number, number]; max: [number, number, number] } | null;
  showBoundingBox?: boolean;
  refreshBoundingBoxTrigger?: number;

  // Callback when viewer is loaded
  onViewerLoaded?: (viewer: Viewer) => void;

  // Sidebar expanded states - adjusts timeline and control positions
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;

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
  selectedVariants,
  individualSoundStates,
  soundVolumes,
  soundIntervals,
  mutedSounds,
  soloedSound,
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
  onPlayAll,
  onPauseAll,
  onStopAll,
  isAnyPlaying = false,
  resonanceAudioConfig,
  geometryBounds = null,
  showBoundingBox = false,
  refreshBoundingBoxTrigger = 0,
  onViewerLoaded,
  isLeftSidebarExpanded = true,
  isRightSidebarExpanded = true,
  className,
}: SpeckleSceneProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use context viewer ref if available, otherwise use local ref
  const { viewerRef: contextViewerRef } = useSpeckleViewerContext();
  const localViewerRef = useRef<Viewer | null>(null);
  const viewerRef = contextViewerRef || localViewerRef;
  
  // Get selection mode context - colors are auto-applied via FilteringExtension
  const { setViewer, setSelectedEntity } = useSpeckleSelectionMode();
  
  const coordinatorRef = useRef<SpeckleAudioCoordinator | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);
  const selectionExtensionRef = useRef<SelectionExtension | null>(null);
  const filteringExtensionRef = useRef<FilteringExtension | null>(null);
  const boundingBoxManagerRef = useRef<BoundingBoxManager | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);

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
  const [globalVolume, setGlobalVolume] = useState(1);
  const [isHoveringVolume, setIsHoveringVolume] = useState(false);

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

        // Store extensions in refs for later use
        cameraControllerRef.current = cameraController;
        selectionExtensionRef.current = selectionExtension;
        filteringExtensionRef.current = filteringExtension;

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

            // Register viewer with selection mode context
            setViewer(viewer);

            // Load world tree for selection handling
            const tree = viewer.getWorldTree();
            if (tree) {
              console.log('[SpeckleScene] World tree loaded');
              setWorldTree(tree);
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
  // Effect - Update Audio Orchestrator
  // ============================================================================
  useEffect(() => {
    if (coordinatorRef.current && audioOrchestrator) {
      coordinatorRef.current.setAudioOrchestrator(audioOrchestrator);
    }
  }, [audioOrchestrator]);

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
      // and expand the corresponding sound card
      if (objectIds.length > 0 && soundscapeData && onSelectSoundCard && selectedDiverseEntities) {
        const selectedId = objectIds[0];

        // Find the entity that corresponds to this Speckle object
        const linkedEntity = selectedDiverseEntities.find(
          (entity: any) => (entity.nodeId === selectedId) || (entity.id === selectedId)
        );

        if (linkedEntity && linkedEntity.index !== undefined) {
          // Find the sound linked to this entity
          const linkedSound = soundscapeData.find((sound: any) =>
            sound.entity_index === linkedEntity.index
          );

          if (linkedSound) {
            const promptIndex = (linkedSound as any).prompt_index ?? 0;
            console.log('[SpeckleScene] Speckle object clicked with linked sound, selecting card:', promptIndex);
            onSelectSoundCard(promptIndex);
          }
        }
        // Note: FilteringExtension colors are auto-applied by the context,
        // no need to manually restore highlights after click
      }
    });

    // Set up callback for sound sphere clicks to expand corresponding sound card
    coordinatorRef.current.setOnSoundSphereClicked((promptKey: string) => {
      if (!onSelectSoundCard) return;

      // Extract promptIndex from promptKey (format: 'prompt_0', 'prompt_1', etc.)
      const promptIndex = parseInt(promptKey.split('_')[1]);
      if (!isNaN(promptIndex)) {
        console.log('[SpeckleScene] Sound sphere clicked, selecting card:', promptIndex);
        onSelectSoundCard(promptIndex);
      }
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
  }, [coordinatorRef.current, soundscapeData, onSelectSoundCard, isLinkingEntity, onEntityLinked, worldTree, selectedDiverseEntities, onUpdateReceiverPosition, onUpdateSoundPosition]);

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

    // Calculate bounds for spiral placement (without triggering visualization)
    let effectiveBounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);
    
    if (!effectiveBounds) {
      const soundPositions: THREE.Vector3[] = [];
      if (soundscapeData) {
        soundscapeData.forEach(sound => {
          if (sound.position) {
            soundPositions.push(new THREE.Vector3(...sound.position));
          }
        });
      }
      effectiveBounds = boundingBoxManagerRef.current.calculateEffectiveBounds(
        geometryBounds,
        soundPositions
      );
    }

    // Use ref to prevent infinite loop (same pattern as ThreeScene)
    coordinatorRef.current.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfigRef.current,
      effectiveBounds
    );
  }, [isViewerReady, soundscapeData, selectedVariants, scaleForSounds, geometryBounds]);

  // ============================================================================
  // Effect - Update Receivers
  // ============================================================================
  useEffect(() => {
    if (!coordinatorRef.current || !isViewerReady || !boundingBoxManagerRef.current || !viewerRef.current) {
      return;
    }

    const currentLength = receivers.length;
    prevReceiversLengthRef.current = currentLength;

    // Calculate bounds for spiral placement (same as sound spheres)
    let effectiveBounds = boundingBoxManagerRef.current.calculateBoundsFromSpeckleBatches(viewerRef.current);
    
    if (!effectiveBounds) {
      const soundPositions: THREE.Vector3[] = [];
      if (soundscapeData) {
        soundscapeData.forEach(sound => {
          if (sound.position) {
            soundPositions.push(new THREE.Vector3(...sound.position));
          }
        });
      }
      effectiveBounds = boundingBoxManagerRef.current.calculateEffectiveBounds(
        geometryBounds,
        soundPositions
      );
    }

    // Pass bounds and enable spiral placement when bounds are available
    coordinatorRef.current.updateReceivers(receivers, effectiveBounds, !!effectiveBounds);
  }, [isViewerReady, receivers, geometryBounds, soundscapeData]);

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
  // - Pink: Objects in diverseSelectedObjectIds (diverse selection)
  // - Green: Objects in linkedObjectIds (sound-linked)
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

        console.log('[SpeckleScene] Timeline check:', {
          hasManager: !!soundSphereManager,
          metadataSize: soundMetadata?.size || 0,
          soundscapeDataLength: soundscapeData.length,
          soundMetadataReady
        });

        if (soundMetadata && soundMetadata.size > 0) {
          const duration = calculateTimelineDurationFromData(soundMetadata, soundIntervals);
          const sounds = extractTimelineSoundsFromData(soundMetadata, soundIntervals, duration);

          setTimelineSounds(sounds);
          setTimelineDuration(duration);
          setSoundMetadataReady(true);
          console.log('[SpeckleScene] ✅ Timeline updated:', sounds.length, 'sounds, duration:', duration);
        } else {
          // Metadata not ready yet, keep checking
          setSoundMetadataReady(false);
        }
      }
    }, UI_TIMING.UPDATE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [soundscapeData, selectedVariants, soundIntervals, soundMetadataReady]);

  // ============================================================================
  // Effect - Poll for Sound Metadata Readiness
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady || !soundscapeData || soundscapeData.length === 0) {
      return;
    }

    // Poll for sound metadata every 500ms until all sounds are loaded
    const intervalId = setInterval(() => {
      const soundSphereManager = coordinatorRef.current?.getSoundSphereManager();
      if (soundSphereManager) {
        const soundMetadata = soundSphereManager.getAllAudioSources();
        
        // Check if we have metadata for all sounds
        if (soundMetadata && soundMetadata.size > 0 && soundMetadata.size >= soundscapeData.length) {
          console.log('[SpeckleScene] 🎵 All sound metadata loaded, triggering timeline update');
          setSoundMetadataReady(prev => !prev); // Toggle to trigger the timeline effect
          clearInterval(intervalId); // Stop polling
        }
      }
    }, 500);

    // Cleanup
    return () => clearInterval(intervalId);
  }, [isViewerReady, soundscapeData]);

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
      console.log('[SpeckleScene] Bounding box effect - early return:', {
        hasBoundingBoxManager: !!boundingBoxManager,
        isViewerReady,
        hasViewer: !!viewer
      });
      return;
    }

    console.log('[SpeckleScene] Updating bounding box. showBoundingBox:', showBoundingBox);

    // Calculate effective bounds
    // Priority: 1) Speckle batch bounds, 2) geometryBounds, 3) auto-calculate from sound positions
    let effectiveBounds = boundingBoxManager.calculateBoundsFromSpeckleBatches(viewer);

    // Fallback to geometry bounds or sound positions
    if (!effectiveBounds) {
      console.log('[SpeckleScene] No Speckle bounds, trying fallback methods');
      const soundPositions: THREE.Vector3[] = [];
      if (soundscapeData) {
        soundscapeData.forEach(sound => {
          if (sound.position) {
            soundPositions.push(new THREE.Vector3(...sound.position));
          }
        });
      }

      effectiveBounds = boundingBoxManager.calculateEffectiveBounds(
        geometryBounds,
        soundPositions
      );
    }

    console.log('[SpeckleScene] Effective bounds:', effectiveBounds);

    // Update bounding box with calculated bounds
    const config = {
      roomMaterials: resonanceAudioConfig?.roomMaterials,
      visible: showBoundingBox && !!effectiveBounds
    };

    console.log('[SpeckleScene] Bounding box config:', config);

    boundingBoxManager.updateBoundingBox(effectiveBounds, config);

    // Request render update to show changes - use multiple frames and RENDER_RESET flag
    if (viewerRef.current) {
      // Request render with RENDER_RESET flag (0b1000 = 8) to force complete re-render
      viewerRef.current.requestRender(8); // UpdateFlags.RENDER_RESET
      // Also request a few regular renders to ensure it shows up
      setTimeout(() => viewerRef.current?.requestRender(), 0);
      setTimeout(() => viewerRef.current?.requestRender(), 100);
      setTimeout(() => viewerRef.current?.requestRender(), 200);
      console.log('[SpeckleScene] Requested render updates with RENDER_RESET flag');
    }
  }, [
    isViewerReady,
    geometryBounds,
    soundscapeData,
    showBoundingBox,
    resonanceAudioConfig?.roomMaterials,
    refreshBoundingBoxTrigger
  ]);

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
      handleGlobalVolumeChange(1);
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
  const handlePlayAll = useCallback(() => {
    console.log('[SpeckleScene] Play All clicked');
    
    // Start timeline cursor
    playTimeline();
    
    // Notify parent to update sound states (which triggers playback via updateSoundPlayback)
    if (onPlayAll) {
      onPlayAll();
    }
  }, [playTimeline, onPlayAll]);

  const handlePauseAll = useCallback(() => {
    // Pause timeline cursor
    pauseTimeline();
    
    // Notify parent to update sound states
    if (onPauseAll) {
      onPauseAll();
    }
  }, [pauseTimeline, onPauseAll]);

  const handleStopAll = useCallback(() => {
    // Reset timeline cursor to start
    stopTimeline();
    
    // Notify parent to update sound states
    if (onStopAll) {
      onStopAll();
    }
  }, [stopTimeline, onStopAll]);

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
    if (!selectedSpeckleObjectIds || selectedSpeckleObjectIds.length === 0) {
      setSelectedEntity(null);
      return;
    }

    const selectedId = selectedSpeckleObjectIds[0];

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
  }, [selectedSpeckleObjectIds, worldTree, setSelectedEntity]);

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
  // Render
  // ============================================================================
  return (
    <div className={`relative w-full h-full ${className || ''}`} style={{ height: '100vh' }}>
      {/* Viewer container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        id="speckle-scene-container"
      />

      {/* Loading overlay */}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
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
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
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

      {/* Empty state */}
      {!modelUrl && !isLoading && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
        >
          <div className="text-center p-8">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              No Model Loaded
            </h3>
            <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              Upload a 3D model to view it here
            </p>
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
              // Center between the two sidebars
              left: `calc(50% + ${centerOffset}px)`,
              transform: 'translateX(-50%)',
              // Dynamic width based on both sidebars
              width: `calc(100% - ${leftSidebarWidth}px - ${rightSidebarWidth}px - ${TIMELINE_LAYOUT.SIDEBAR_HORIZONTAL_OFFSET_PX}px)`,
              maxWidth: `${TIMELINE_LAYOUT.MAX_WIDTH_PX}px`,
            }}
          >
          <WaveSurferTimeline
            sounds={timelineSounds}
            duration={timelineDuration}
            currentTime={playbackState.currentTime}
            isPlaying={playbackState.isPlaying}
            onSeek={handleSeek}
            individualSoundStates={individualSoundStates}
            mutedSounds={mutedSounds}
            soloedSound={soloedSound}
          />
          </div>
        );
      })()}

      {/* Playback Controls - Bottom Center (dynamically centered between sidebars) */}
      <PlaybackControls
        onPlayAll={handlePlayAll}
        onPauseAll={handlePauseAll}
        onStopAll={handleStopAll}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
        isLeftSidebarExpanded={isLeftSidebarExpanded}
        isRightSidebarExpanded={isRightSidebarExpanded}
      />

      {/* NOTE: Selected Object Info moved to RightSidebar EntityInfoPanel */}

      {/* 3D Controls Info - Bottom Left */}
      {isViewerReady && <ControlsInfo />}

      {/* Bottom-right control buttons */}
      <div
        className="absolute bottom-6 flex flex-col items-center pointer-events-auto z-20 transition-all duration-300"
        style={{
          gap: UI_SCENE_BUTTON.GAP,
          // When expanded: offset by full sidebar width + 24px margin
          // When collapsed: offset by collapsed width (40px) + 24px margin
          right: isRightSidebarExpanded ? `${UI_RIGHT_SIDEBAR.WIDTH + 24}px` : '64px'
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
    </div>
  );
}
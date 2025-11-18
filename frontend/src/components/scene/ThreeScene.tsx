"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import * as THREE from "three";

import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { EntityInfoBox } from "@/components/overlays/EntityInfoBox";
import { ModalAnalysisProgress } from "@/components/overlays/ModalAnalysisProgress";
import { ImpactSoundPlayback } from "@/components/overlays/ImpactSoundPlayback";
import { PlaybackControls } from "@/components/controls/PlaybackControls";
import { OrientationIndicator } from "@/components/controls/OrientationIndicator";
import { WaveSurferTimeline } from "@/components/audio/WaveSurferTimeline";
import { ControlsInfo } from "@/components/layout/sidebar/ControlsInfo";
import { SceneControlButton } from "@/components/scene/SceneControlButton";
import { AdvancedSettingsPanel } from "@/components/scene/AdvancedSettingsPanel";
import { Icon } from "@/components/ui/Icon";
import { VerticalVolumeSlider } from "@/components/ui/VerticalVolumeSlider";
import { triangulateWithMapping, trimDisplayName } from "@/lib/utils";
import { frameCameraToObject } from "@/lib/three/sceneSetup";
import { SceneCoordinator } from "@/lib/three/scene-coordinator";
import { GeometryRenderer } from "@/lib/three/geometry-renderer";
import { SoundSphereManager } from "@/lib/three/sound-sphere-manager";
import { ReceiverManager } from "@/lib/three/receiver-manager";
import { PlaybackSchedulerService } from "@/lib/audio/playback-scheduler-service";
import { ModalImpactSynthesizer } from "@/lib/audio/modal-impact-synthesis";
import { ModeVisualizer } from "@/lib/three/mode-visualizer";
import { InputHandler } from "@/lib/three/input-handler";
import { projectToScreen, isInViewport as isInViewportUtil } from "@/lib/three/projection-utils";
import { getSoundState } from "@/lib/sound/state-utils";
import { extractTimelineSounds, calculateTimelineDuration } from "@/lib/audio/timeline-utils";
import { useTimelinePlayback } from "@/hooks/useTimelinePlayback";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { apiService } from "@/services/api";
import { createImpactParameters } from "@/hooks/useModalImpact";
import { 
  TIMELINE_DEFAULTS, 
  UI_TIMING, 
  AUDIO_VOLUME, 
  SCREEN_PROJECTION,
  AUDIO_CONTEXT_STATE,
  UI_OVERLAY,
  UI_COLORS,
  UI_SCENE_BUTTON,
  ENTITY_CONFIG,
  TIMELINE_LAYOUT,
  RESONANCE_AUDIO
} from "@/lib/constants";
import type { UIOverlay, EntityData, EntityOverlay, CompasGeometry } from "@/types";
import type { ThreeSceneProps } from "@/types/three-scene";
import type { TimelineSound } from "@/types/audio";
import type { ModalAnalysisRequest } from "@/types/modal";

/**
 * ThreeScene Component (Refactored)
 *
 * Main 3D scene component for the COMPAS Soundscape application.
 * Now uses service-oriented architecture for better maintainability.
 *
 * Key Features:
 * - 3D geometry visualization with Three.js
 * - Interval-based spatial audio scheduling with random variance
 * - Entity highlighting (diverse and individual selection)
 * - Draggable sound sources and receivers with positional audio
 * - First-person receiver view mode
 *
 * Architecture:
 * - SceneCoordinator: Scene initialization and animation loop
 * - GeometryRenderer: Entity rendering and highlighting
 * - SoundSphereManager: Sound sphere creation and audio sources
 * - ReceiverManager: Receiver cube management
 * - PlaybackSchedulerService: Audio playback scheduling
 * - AuralizationService: Impulse response convolution (audio routing only)
 * - InputHandler: User input (click, drag, keyboard)
 */

export function ThreeScene({
  geometryData,
  soundscapeData,
  individualSoundStates,
  selectedVariants,
  soundVolumes,
  soundIntervals,
  mutedSounds,
  soloedSound,
  onToggleSound,
  onVariantChange,
  onVolumeChange,
  onIntervalChange,
  onMute,
  onSolo,
  onDeleteSound,
  onPlayAll,
  onPauseAll,
  onStopAll,
  isAnyPlaying,
  scaleForSounds,
  modelEntities = [],
  selectedDiverseEntities = [],
  auralizationConfig,
  resonanceAudioConfig,
  geometryBounds,
  showBoundingBox = false,
  refreshBoundingBoxTrigger = 0,
  receivers = [],
  onUpdateReceiverPosition,
  onPlaceReceiver,
  isPlacingReceiver = false,
  onCancelPlacingReceiver,
  isLinkingEntity = false,
  onEntityLinked,
  onToggleDiverseSelection,
  onDetachSound,
  modeVisualizationState,
  onSetModeVisualization,
  onSelectMode,
  onReceiverModeChange,
  audioRenderingMode = 'basic_mixer',
  audioOrchestrator,
  audioContext,
  selectedIRId,
  className,
  // Sound generation advanced settings
  globalDuration = 5,
  globalSteps = 25,
  globalNegativePrompt = '',
  applyDenoising = false,
  normalizeImpulseResponses = false,
  audioModel = 'tangoflux',
  onGlobalDurationChange,
  onGlobalStepsChange,
  onGlobalNegativePromptChange,
  onApplyDenoisingChange,
  onNormalizeImpulseResponsesChange,
  onAudioModelChange,
  onResetAdvancedSettings
}: ThreeSceneProps) {
  // Throttled logging to avoid spam (only log once per second)
  useEffect(() => {
    const logTimer = setTimeout(() => {
      console.log('[ThreeScene] 🎬 Props received:', {
        hasAudioOrchestrator: !!audioOrchestrator,
        hasAudioContext: !!audioContext,
        orchestratorType: audioOrchestrator?.constructor.name
      });
    }, 1000);
    
    return () => clearTimeout(logTimer);
  }, [audioOrchestrator, audioContext]);

  // ============================================================================
  // Refs - Service Managers
  // ============================================================================
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneCoordinatorRef = useRef<SceneCoordinator | null>(null);
  const geometryRendererRef = useRef<GeometryRenderer | null>(null);
  const soundSphereManagerRef = useRef<SoundSphereManager | null>(null);
  const receiverManagerRef = useRef<ReceiverManager | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);
  const inputHandlerRef = useRef<InputHandler | null>(null);
  
  // Track previous mode to avoid infinite loops
  const previousModeRef = useRef<string | null>(null);
  const modeVisualizerRef = useRef<ModeVisualizer | null>(null);
  const boundingBoxGroupRef = useRef<THREE.Group | null>(null);

  // Refs for callbacks to avoid infinite loops in useEffect
  const onStopAllRef = useRef(onStopAll);
  const onPauseAllRef = useRef(onPauseAll);
  const onPlayAllRef = useRef(onPlayAll);

  // ============================================================================
  // Refs - Data for Event Handlers
  // ============================================================================
  const geometryDataRef = useRef(geometryData);
  const modelEntitiesRef = useRef(modelEntities);
  const auralizationConfigRef = useRef(auralizationConfig);
  const prevSoundscapeDataLengthRef = useRef<number>(0);

  // ============================================================================
  // State - UI Overlays and Visibility
  // ============================================================================
  const [uiOverlays, setUiOverlays] = useState<UIOverlay[]>([]);
  const [entityOverlay, setEntityOverlay] = useState<EntityOverlay | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityData | null>(null);
  const [showSoundBoxes, setShowSoundBoxes] = useState<boolean>(true);
  
  // Track user-hidden overlays separately (persists across animation updates)
  const hiddenOverlaysRef = useRef<Set<string>>(new Set());

  // ============================================================================
  // State - Modal Impact Sound Synthesis
  // ============================================================================
  const [modalImpactMode, setModalImpactMode] = useState<'inactive' | 'analyzing' | 'ready' | 'playing'>('inactive');
  const [modalImpactEntity, setModalImpactEntity] = useState<EntityData | null>(null);
  
  // Cache modal analysis results per entity (key: entity index)
  const modalAnalysisCache = useRef<Map<number, any>>(new Map());
  const [currentModalResult, setCurrentModalResult] = useState<any>(null);
  
  const [impactAudioBuffer, setImpactAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlayingImpact, setIsPlayingImpact] = useState<boolean>(false);
  const [highlightImpactHelp, setHighlightImpactHelp] = useState<boolean>(false);
  
  // Ref to track current playing audio source for cleanup
  const impactAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // ============================================================================
  // Error Handling
  // ============================================================================
  const handleError = useApiErrorHandler();

  // ============================================================================
  // State - First-Person Mode & Orientation
  // ============================================================================
  const [isFirstPersonMode, setIsFirstPersonMode] = useState<boolean>(false);
  const [currentOrientation, setCurrentOrientation] = useState<{ yaw: number; pitch: number; roll: number }>({
    yaw: 0,
    pitch: 0,
    roll: 0
  });

  // Track previous receiver mode state to prevent unnecessary updates
  const prevReceiverModeRef = useRef<{ isActive: boolean; receiverId: string | null }>({
    isActive: false,
    receiverId: null
  });

  // ============================================================================
  // Effect - Notify Audio Orchestrator of Receiver Mode Changes
  // ============================================================================
  useEffect(() => {
    if (!onReceiverModeChange) return;

    // Determine receiver ID (use first receiver if available)
    const receiverId = isFirstPersonMode && receivers.length > 0 ? receivers[0].id : null;

    // Only notify if state actually changed
    const prev = prevReceiverModeRef.current;
    if (prev.isActive !== isFirstPersonMode || prev.receiverId !== receiverId) {
      console.log('[ThreeScene] Receiver mode changed:', { isFirstPersonMode, receiverId });
      onReceiverModeChange(isFirstPersonMode, receiverId);
      prevReceiverModeRef.current = { isActive: isFirstPersonMode, receiverId };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstPersonMode, receivers[0]?.id]);

  // ============================================================================
  // State - Audio Timeline
  // ============================================================================
  const [timelineSounds, setTimelineSounds] = useState<TimelineSound[]>([]);
  const [timelineDuration, setTimelineDuration] = useState<number>(TIMELINE_DEFAULTS.DURATION_MS);
  const [showTimeline, setShowTimeline] = useState<boolean>(true);

  // Global volume state
  const [globalVolume, setGlobalVolume] = useState<number>(1); // 0 to 1
  const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);

  // Settings panel state
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState<boolean>(false);

  // Timeline playback hook (synced with PlaybackControls)
  const { playbackState, play: playTimeline, pause: pauseTimeline, stop: stopTimeline, seekTo } = useTimelinePlayback({
    sounds: timelineSounds,
    duration: timelineDuration
  });

  // ============================================================================
  // Effect - Sync Props to Refs (for event handlers)
  // ============================================================================
  useEffect(() => {
    geometryDataRef.current = geometryData;
  }, [geometryData]);

  useEffect(() => {
    modelEntitiesRef.current = modelEntities;
  }, [modelEntities]);

  useEffect(() => {
    auralizationConfigRef.current = auralizationConfig;
  }, [auralizationConfig]);

  // Keep callback refs up to date
  useEffect(() => {
    onStopAllRef.current = onStopAll;
  }, [onStopAll]);

  useEffect(() => {
    onPauseAllRef.current = onPauseAll;
  }, [onPauseAll]);

  useEffect(() => {
    onPlayAllRef.current = onPlayAll;
  }, [onPlayAll]);

  // Close volume slider when clicking outside
  useEffect(() => {
    if (!showVolumeSlider) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside the volume slider and button
      const isVolumeSlider = target.closest('[data-volume-slider]');
      const isVolumeButton = target.closest('[data-volume-button]');
      
      if (!isVolumeSlider && !isVolumeButton) {
        setShowVolumeSlider(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showVolumeSlider]);

  // ============================================================================
  // Handlers - Camera and UI Controls
  // ============================================================================

  // Calculate average position of sound spheres
  const calculateSoundSpheresAverage = useCallback((): THREE.Vector3 | null => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager) return null;

    const draggableObjects = soundSphereManager.getDraggableObjects();
    if (draggableObjects.length === 0) return null;

    const sum = new THREE.Vector3();
    draggableObjects.forEach(obj => {
      sum.add(obj.position);
    });
    sum.divideScalar(draggableObjects.length);
    return sum;
  }, []);

  // Reset camera to default or model view
  const handleResetZoom = useCallback(() => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!sceneCoordinator) return;

    sceneCoordinator.resetCamera(geometryData !== null);
  }, [geometryData]);

  // Toggle global volume slider visibility
  const handleToggleVolumeSlider = useCallback(() => {
    setShowVolumeSlider(prev => !prev);
  }, []);

  // Handle global volume change
  const handleGlobalVolumeChange = useCallback((volume: number) => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!sceneCoordinator) return;

    setGlobalVolume(volume);

    // Apply master volume
    if (sceneCoordinator.listener.context.state === AUDIO_CONTEXT_STATE.RUNNING) {
      sceneCoordinator.listener.setMasterVolume(volume);
      console.log(`[Audio] Global volume set to ${(volume * 100).toFixed(0)}%`);
    }
  }, []);

  // Toggle sound boxes visibility
  const handleToggleSoundBoxes = useCallback(() => {
    setShowSoundBoxes(prev => {
      const newValue = !prev;
      // If showing controls, clear all individual hidden states
      if (newValue) {
        hiddenOverlaysRef.current.clear();
        setUiOverlays(prevOverlays => [...prevOverlays]); // Force re-render
      }
      return newValue;
    });
  }, []);

  // Toggle individual overlay hide state
  const handleOverlayHideToggle = useCallback((promptKey: string) => {
    const hiddenOverlays = hiddenOverlaysRef.current;
    if (hiddenOverlays.has(promptKey)) {
      hiddenOverlays.delete(promptKey);
    } else {
      hiddenOverlays.add(promptKey);
    }
    // Force re-render by updating state (triggers overlay update in animation loop)
    setUiOverlays(prev => [...prev]);
  }, []);

  // Handle overlay dragging - updates both overlay position and sphere position
  const handleOverlayDrag = useCallback((promptKey: string, deltaX: number, deltaY: number) => {
    const soundSphereManager = soundSphereManagerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!soundSphereManager || !sceneCoordinator) return;

    // Find the sphere
    const sphere = soundSphereManager.findSphereByPromptKey(promptKey);
    if (!sphere) return;

    // Convert screen delta to world space movement
    const camera = sceneCoordinator.camera;
    const spherePosition = sphere.position.clone();
    
    // Project current position to screen space
    const vector = spherePosition.clone().project(camera);
    
    // Apply screen space delta
    const canvas = sceneCoordinator.renderer.domElement;
    const widthHalf = canvas.width / 2;
    const heightHalf = canvas.height / 2;
    
    vector.x += (deltaX / widthHalf);
    vector.y -= (deltaY / heightHalf);
    
    // Unproject back to world space
    vector.unproject(camera);
    
    // Calculate direction from camera
    const direction = vector.sub(camera.position).normalize();
    
    // Calculate distance from camera to sphere
    const distance = camera.position.distanceTo(spherePosition);
    
    // Calculate new position
    const newPosition = camera.position.clone().add(direction.multiplyScalar(distance));
    
    // Update sphere position
    soundSphereManager.updateSpherePosition(promptKey, newPosition);
  }, []);

  // ============================================================================
  // Playback Control Handlers (controlling both audio and timeline)
  // ============================================================================
  const handlePlayAll = useCallback(() => {
    onPlayAll(); // Play audio sounds
    playTimeline(); // Start timeline cursor
  }, [onPlayAll, playTimeline]);

  const handlePauseAll = useCallback(() => {
    onPauseAll(); // Pause audio sounds
    pauseTimeline(); // Pause timeline cursor
  }, [onPauseAll, pauseTimeline]);

  const handleStopAll = useCallback(() => {
    onStopAll(); // Stop audio sounds (includes emergency kill + restore)
    stopTimeline(); // Reset timeline cursor to start
  }, [onStopAll, stopTimeline]);

  const handleSeek = useCallback(async (timeMs: number) => {
    const playbackScheduler = playbackSchedulerRef.current;
    const soundSphereManager = soundSphereManagerRef.current;
    if (!playbackScheduler || !soundSphereManager) return;

    // Get audio sources
    const audioSources = soundSphereManager.getAllAudioSources();

    // Update timeline cursor position
    seekTo(timeMs);

    // Update audio playback to match new timeline position
    // MUST await to ensure audio context is resumed before scheduling
    await playbackScheduler.seekToTime(
      timeMs,
      audioSources,
      individualSoundStates,
      soundIntervals
    );
  }, [seekTo, individualSoundStates, soundIntervals]);

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Extract mesh data (vertices and faces) for a specific entity
   * Uses face_entity_map to filter faces belonging to the entity
   * Ensures all faces are triangulated for consistent array shape
   */
  const extractEntityMesh = useCallback((
    geometry: CompasGeometry,
    entityIndex: number
  ): { vertices: number[][], faces: number[][] } => {
    if (!geometry.face_entity_map) {
      // If no face_entity_map, return entire geometry (single entity)
      // Triangulate faces to ensure homogeneous shape
      const triangulatedFaces: number[][] = [];
      geometry.faces.forEach(face => {
        if (face.length === 3) {
          triangulatedFaces.push(face);
        } else if (face.length === 4) {
          // Split quad into two triangles
          triangulatedFaces.push([face[0], face[1], face[2]]);
          triangulatedFaces.push([face[0], face[2], face[3]]);
        } else if (face.length > 4) {
          // Fan triangulation for n-gons
          for (let i = 1; i < face.length - 1; i++) {
            triangulatedFaces.push([face[0], face[i], face[i + 1]]);
          }
        }
      });
      
      return {
        vertices: geometry.vertices,
        faces: triangulatedFaces,
      };
    }

    // Find all faces that belong to this entity
    const entityFaceIndices: number[] = [];
    geometry.face_entity_map.forEach((faceEntityIndex: number, faceIndex: number) => {
      if (faceEntityIndex === entityIndex) {
        entityFaceIndices.push(faceIndex);
      }
    });

    if (entityFaceIndices.length === 0) {
      console.warn(`[extractEntityMesh] No faces found for entity ${entityIndex}`);
      return { vertices: [], faces: [] };
    }

    // Collect unique vertex indices used by these faces
    const usedVertexIndices = new Set<number>();
    const entityFaces: number[][] = [];

    entityFaceIndices.forEach(faceIndex => {
      const face = geometry.faces[faceIndex];
      face.forEach((vertexIndex: number) => usedVertexIndices.add(vertexIndex));
      
      // Triangulate the face
      if (face.length === 3) {
        entityFaces.push(face);
      } else if (face.length === 4) {
        // Split quad into two triangles
        entityFaces.push([face[0], face[1], face[2]]);
        entityFaces.push([face[0], face[2], face[3]]);
      } else if (face.length > 4) {
        // Fan triangulation for n-gons
        for (let i = 1; i < face.length - 1; i++) {
          entityFaces.push([face[0], face[i], face[i + 1]]);
        }
      }
    });

    // Create mapping from old vertex indices to new ones
    const vertexIndexMap = new Map<number, number>();
    const entityVertices: number[][] = [];
    
    Array.from(usedVertexIndices).sort((a, b) => a - b).forEach((oldIndex, newIndex) => {
      vertexIndexMap.set(oldIndex, newIndex);
      entityVertices.push(geometry.vertices[oldIndex]);
    });

    // Remap face indices to new vertex indices
    const remappedFaces = entityFaces.map(face =>
      face.map(oldVertexIndex => vertexIndexMap.get(oldVertexIndex)!)
    );

    console.log(`[extractEntityMesh] Entity ${entityIndex}: ${entityVertices.length} vertices, ${remappedFaces.length} triangular faces`);

    return {
      vertices: entityVertices,
      faces: remappedFaces,
    };
  }, []);

  // ============================================================================
  // Modal Impact Handlers
  // ============================================================================
  
  const handleModalImpactClick = useCallback(async (entity: EntityData) => {
    if (!geometryData) return;
    
    // Check if we already have cached results for this entity
    const cached = modalAnalysisCache.current.get(entity.index);
    if (cached) {
      console.log(`[ModalImpact] Using cached analysis for entity ${entity.index}`);
      setModalImpactEntity(entity);
      setCurrentModalResult(cached);
      setModalImpactMode('ready');
      return;
    }
    
    // Don't hide entity UI - keep it visible with loading state
    setModalImpactMode('analyzing');
    setModalImpactEntity(entity);
    // CRITICAL: Clear old modal result immediately when switching entities
    // Otherwise visualization will try to apply old entity's data to new entity's mesh
    setCurrentModalResult(null);

    try {
      // Extract mesh data for this specific entity
      const { vertices: entityVertices, faces: entityFaces } = extractEntityMesh(
        geometryData,
        entity.index
      );
      
      if (entityFaces.length === 0) {
        throw new Error('No faces found for this entity');
      }
      
      console.log(`[ModalImpact] Extracted mesh: ${entityVertices.length} vertices, ${entityFaces.length} faces`);
      
      // Create analysis request with entity-specific mesh data
      const request: ModalAnalysisRequest = {
        vertices: entityVertices,
        faces: entityFaces,
        material: "steel", // Default material - could be made configurable
        num_modes: 20,
      };
      
      // Call backend API
      const result = await apiService.analyzeModal(request);
      
      // Cache the result
      modalAnalysisCache.current.set(entity.index, result);
      
      // Store result and transition to ready mode
      setCurrentModalResult(result);
      setModalImpactMode('ready');
      
      console.log(`[ModalImpact] Analysis complete, cached for entity ${entity.index}`);
      
    } catch (error) {
      console.error("Modal analysis failed:", error);
      // Display error to user with specific error message from backend
      handleError(error);
      // Return to inactive on error
      setModalImpactMode('inactive');
      setModalImpactEntity(null);
      setSelectedEntity(entity); // Restore entity selection
    }
  }, [geometryData, handleError]);
  
  const handleImpactPointClick = useCallback(async (impactPoint: [number, number, number]) => {
    if (!currentModalResult) return;
    
    // Prevent clicking while already playing
    if (isPlayingImpact) return;
    
    setIsPlayingImpact(true);
    setModalImpactMode('playing');
    
    // Create synthesizer instance
    const synthesizer = new ModalImpactSynthesizer();
    
    // Create impact parameters from click point
    const impactParams = createImpactParameters(
      impactPoint[0],
      impactPoint[1],
      impactPoint[2],
      5.0, // Default impact velocity
      "steel" // Default material - matches analysis
    );
    
    // Synthesize impact sound
    const audioBuffer = await synthesizer.synthesizeImpact(
      currentModalResult,
      impactParams
    );
    
    // Store buffer
    setImpactAudioBuffer(audioBuffer);
    
    // Play the impact sound
    const source = synthesizer.playBuffer(audioBuffer);
    
    // Store source ref for cleanup
    impactAudioSourceRef.current = source;
    
    // Reset playing state when sound finishes
    source.onended = () => {
      // Only update state if we're still in impact mode
      // (user might have exited while sound was playing)
      setIsPlayingImpact(false);
      setModalImpactMode((currentMode) => {
        // Only return to ready if we're still in playing mode
        return currentMode === 'playing' ? 'ready' : currentMode;
      });
      impactAudioSourceRef.current = null;
    };
    
  }, [currentModalResult, isPlayingImpact]);
  
  const exitImpactMode = useCallback(() => {
    // Stop any currently playing audio
    if (impactAudioSourceRef.current) {
      try {
        impactAudioSourceRef.current.stop();
        impactAudioSourceRef.current = null;
      } catch (e) {
        // Audio might have already stopped
        console.warn('[ModalImpact] Error stopping audio source:', e);
      }
    }

    // Reset modal impact state but keep cache
    setModalImpactMode('inactive');
    setModalImpactEntity(null);
    setCurrentModalResult(null);
    setImpactAudioBuffer(null);
    setIsPlayingImpact(false);
    setHighlightImpactHelp(false);

    // CRITICAL: Reset mode visualization state to prevent stale mode index
    // Otherwise when selecting a new entity, it might try to show a mode index
    // that doesn't exist in the new entity's modal analysis result
    if (onSetModeVisualization) {
      onSetModeVisualization(false); // Sets isActive=false and selectedModeIndex=null
    }
  }, [onSetModeVisualization]);

  // ============================================================================
  // Memoized Values
  // ============================================================================

  // Memoize triangulated geometry data for performance
  const triangulatedGeometry = useMemo(() => {
    if (!geometryData) return null;
    const { indices, triangleToFaceMap } = triangulateWithMapping(geometryData.faces);
    return {
      positions: new Float32Array(geometryData.vertices.flat()),
      indices,
      triangleToFaceMap // Map from triangle index to original face index
    };
  }, [geometryData]);

  // Memoize entity indices that have linked sounds
  const entitiesWithLinkedSounds = useMemo(() => {
    const entityIndices = new Set<number>();

    if (!soundscapeData) return entityIndices;

    // Group sounds by prompt index to get selected variants
    const soundsByPromptIndex: { [key: number]: any[] } = {};
    soundscapeData.forEach(sound => {
      const promptIdx = (sound as any).prompt_index ?? 0;
      if (!soundsByPromptIndex[promptIdx]) {
        soundsByPromptIndex[promptIdx] = [];
      }
      soundsByPromptIndex[promptIdx].push(sound);
    });

    // Extract entity indices from selected variants
    Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
      const promptIdx = parseInt(promptIdxStr);
      const selectedIdx = selectedVariants[promptIdx] || 0;
      const selectedSound = sounds[selectedIdx] || sounds[0];

      // Check if this sound has a valid entity_index
      if (
        selectedSound &&
        selectedSound.entity_index !== null &&
        selectedSound.entity_index !== undefined
      ) {
        entityIndices.add(selectedSound.entity_index);
      }
    });

    return entityIndices;
  }, [soundscapeData, selectedVariants]);

  // ============================================================================
  // Effect - Initialize Three.js Scene and Services (runs once)
  // ============================================================================
  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    // Initialize Scene Coordinator
    const sceneCoordinator = new SceneCoordinator(mountNode, audioOrchestrator);
    sceneCoordinatorRef.current = sceneCoordinator;

    // Initialize Geometry Renderer
    const geometryRenderer = new GeometryRenderer(
      sceneCoordinator.scene,
      sceneCoordinator.contentGroup,
      sceneCoordinator.diverseHighlightsGroup
    );
    geometryRendererRef.current = geometryRenderer;

    // Initialize Sound Sphere Manager
    const soundSphereManager = new SoundSphereManager(
      sceneCoordinator.contentGroup,
      sceneCoordinator.listener,
      audioOrchestrator,
      audioContext
    );
    soundSphereManagerRef.current = soundSphereManager;

    // Initialize Receiver Manager
    const receiverManager = new ReceiverManager(
      sceneCoordinator.scene,
      scaleForSounds
    );
    receiverManagerRef.current = receiverManager;

    // Initialize Playback Scheduler Service
    const playbackScheduler = new PlaybackSchedulerService(sceneCoordinator.listener, audioOrchestrator);
    playbackSchedulerRef.current = playbackScheduler;

    // Initialize Audio Flow Debugger (for development/debugging)
    if (typeof window !== 'undefined') {
      import('@/lib/audio/debug/audio-flow-debugger').then(({ audioFlowDebugger }) => {
        audioFlowDebugger.initialize(audioOrchestrator || null, null);
        console.log('💡 Audio Flow Debugger available. Use window.audioFlowDebugger.enable() to activate');
      });
    }

    // Initialize Mode Visualizer
    const modeVisualizer = new ModeVisualizer();
    modeVisualizerRef.current = modeVisualizer;

    // Initialize Input Handler
    const inputHandler = new InputHandler(
      sceneCoordinator.camera,
      sceneCoordinator.renderer
    );
    inputHandlerRef.current = inputHandler;

    // Setup Input Handler callbacks
    inputHandler.setOnEntitySelected((entity) => {
      // If in linking mode, pass entity (or null) to linking handler
      // Clicking on empty space (entity === null) will unlink or exit linking mode
      if (isLinkingEntity && onEntityLinked) {
        onEntityLinked(entity);
      } else {
        // Normal entity selection behavior
        setSelectedEntity(entity);
      }
    });
    inputHandler.setOnReceiverPlaced((position) => onPlaceReceiver?.(position));
    inputHandler.setOnFirstPersonModeEnabled((position, yaw, pitch) => {
      sceneCoordinator.enableFirstPersonMode(position, yaw, pitch);
    });
    inputHandler.setOnFirstPersonModeDisabled(() => {
      sceneCoordinator.disableFirstPersonMode();
    });
    inputHandler.setOnFirstPersonRotate((deltaYaw, deltaPitch) => {
      sceneCoordinator.rotateFirstPersonView(deltaYaw, deltaPitch);
    });
    inputHandler.setOnSpherePositionUpdated((promptKey, position) => {
      soundSphereManager.updateSpherePosition(promptKey, position);
    });
    inputHandler.setOnReceiverPositionUpdated((receiverId, position) => {
      onUpdateReceiverPosition?.(receiverId, position);
    });
    inputHandler.setOnPlacementCanceled(() => onCancelPlacingReceiver?.());
    inputHandler.setOnPreviewPositionUpdated((position) => {
      receiverManager.updatePreviewPosition(position);
    });
    inputHandler.setOnSphereClicked((promptKey) => {
      // Show overlay if it's hidden by user
      const hiddenOverlays = hiddenOverlaysRef.current;
      if (hiddenOverlays.has(promptKey)) {
        hiddenOverlays.delete(promptKey);
        setUiOverlays(prev => [...prev]); // Force re-render
      }
    });

    // Setup Input Handler data getters
    inputHandler.setGeometryDataGetter(() => geometryDataRef.current);
    inputHandler.setModelEntitiesGetter(() => modelEntitiesRef.current);
    inputHandler.setContentGroupGetter(() => sceneCoordinator.contentGroup);
    inputHandler.setReceiverMeshesGetter(() => receiverManager.getReceiverMeshes());
    inputHandler.setPreviewReceiverGetter(() => receiverManager.getPreviewReceiver());
    inputHandler.setOrbitControlsGetter(() => sceneCoordinator.controls as any);
    inputHandler.setSoundSpheresAverageGetter(calculateSoundSpheresAverage);
    inputHandler.setFirstPersonModeGetter(() => sceneCoordinator.isFirstPersonMode());
    inputHandler.setSoundSphereMeshesGetter(() => soundSphereManager.getSoundSphereMeshes());
    inputHandler.setTriangleToFaceMapGetter(() => geometryRenderer.getTriangleToFaceMap());

    // Setup event listeners
    inputHandler.setupClickHandler();
    inputHandler.setupMouseMoveHandler();
    inputHandler.setupKeyboardHandler();

    // Cleanup on unmount
    return () => {
      sceneCoordinator.dispose();
      geometryRenderer.dispose();
      soundSphereManager.dispose();
      receiverManager.dispose();
      playbackScheduler.dispose();
      modeVisualizer.dispose();
      inputHandler.dispose();

      if (mountNode.contains(sceneCoordinator.getDomElement())) {
        mountNode.removeChild(sceneCoordinator.getDomElement());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // Effect - Update SoundSphereManager orchestrator when it becomes available
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    const playbackScheduler = playbackSchedulerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    
    if (!soundSphereManager) return;

    // Update orchestrator references when they become available
    if (audioOrchestrator && audioContext) {
      console.log('[ThreeScene] 🔄 Updating managers with AudioOrchestrator');

      // Update SoundSphereManager with orchestrator
      soundSphereManager.setAudioOrchestrator(audioOrchestrator);

      // Update SceneCoordinator with orchestrator
      if (sceneCoordinator) {
        sceneCoordinator.setAudioOrchestrator(audioOrchestrator);
      }

      // Also update PlaybackSchedulerService
      if (playbackScheduler) {
        (playbackScheduler as any).audioOrchestrator = audioOrchestrator;
      }

      // Update audio flow debugger
      if (typeof window !== 'undefined') {
        import('@/lib/audio/debug/audio-flow-debugger').then(({ audioFlowDebugger }) => {
          audioFlowDebugger.initialize(audioOrchestrator, null);
        });
      }
    }
  }, [audioOrchestrator, audioContext]);

  // ============================================================================
  // Effect - Re-register sources when orchestrator's actual mode changes
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager || !audioOrchestrator) return;

    // Get the actual current mode from orchestrator
    const status = audioOrchestrator.getStatus?.();
    const currentMode = status?.currentMode;
    if (!currentMode) return;

    // Only trigger if mode actually changed
    if (previousModeRef.current === currentMode) return;
    
    // Skip on initial mount  
    if (previousModeRef.current === null) {
      previousModeRef.current = currentMode;
      return;
    }

    previousModeRef.current = currentMode;

    // Stop all audio and reset timeline
    onStopAllRef.current();

    // Re-register sources after stop completes
    const timer = setTimeout(() => {
      soundSphereManager.reregisterAllSources();
    }, 100);

    return () => clearTimeout(timer);
  }, [audioOrchestrator]);

  // ============================================================================
  // Effect - Re-register sources when audio mode changes (UI-driven)
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager || !audioOrchestrator) return;
    
    // Stop all audio and reset timeline
    onStopAllRef.current();

    // Re-register sources after stop completes
    const timer = setTimeout(() => {
      soundSphereManager.reregisterAllSources();
    }, 100);

    return () => clearTimeout(timer);
  }, [audioRenderingMode, audioOrchestrator]);

  // ============================================================================
  // Effect - Re-register sources when IR selection changes
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager || !audioOrchestrator) return;
    
    // Stop all audio and reset timeline
    onStopAllRef.current();

    // Re-register sources after stop completes
    const timer = setTimeout(() => {
      soundSphereManager.reregisterAllSources();
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedIRId, audioOrchestrator]);

  // ============================================================================
  // Effect - Update Geometry Mesh
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!geometryRenderer || !sceneCoordinator) return;

    if (triangulatedGeometry) {
      geometryRenderer.updateGeometryMesh(
        triangulatedGeometry.positions,
        new Uint32Array(triangulatedGeometry.indices),
        triangulatedGeometry.triangleToFaceMap
      );

      // Frame camera to model
      frameCameraToObject(
        sceneCoordinator.camera,
        sceneCoordinator.controls,
        sceneCoordinator.contentGroup,
        ENTITY_CONFIG.SCALE_MULTIPLIER
      );
    } else {
      geometryRenderer.updateGeometryMesh(null, null, null);
    }
  }, [triangulatedGeometry]);

  // ============================================================================
  // Effect - Update Entity Selection Callback (for linking mode & modal impact)
  // ============================================================================
  useEffect(() => {
    const inputHandler = inputHandlerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!inputHandler || !sceneCoordinator) return;

    inputHandler.setOnEntitySelected((entity) => {
      // Priority 1: Modal impact mode (ready or playing) - trigger impact or ignore
      if ((modalImpactMode === 'ready' || modalImpactMode === 'playing') && modalImpactEntity && geometryData) {
        // Check if user clicked on the correct entity
        if (entity && entity.index === modalImpactEntity.index) {
          // Only trigger new impact if not currently playing
          if (modalImpactMode === 'ready' || !isPlayingImpact) {
            // Use entity center as impact point
            const impactPoint: [number, number, number] = [
              modalImpactEntity.position[0],
              modalImpactEntity.position[1],
              modalImpactEntity.position[2],
            ];
            
            handleImpactPointClick(impactPoint);
          }
        } else {
          // User clicked wrong entity or empty space - highlight help text
          setHighlightImpactHelp(true);
          setTimeout(() => setHighlightImpactHelp(false), 2000); // Fade out after 2s
        }
        return; // Don't select entity in impact modes
      }

      // Priority 2: Linking mode
      if (isLinkingEntity && onEntityLinked && entity) {
        onEntityLinked(entity);
        return;
      }

      // Priority 3: Normal entity selection
      setSelectedEntity(entity);
    });
  }, [
    isLinkingEntity,
    onEntityLinked,
    modalImpactMode,
    modalImpactEntity,
    geometryData,
    isPlayingImpact,
    handleImpactPointClick
  ]);

  // ============================================================================
  // Effect - Entity Highlighting (Diverse Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateDiverseHighlights(geometryData, selectedDiverseEntities, entitiesWithLinkedSounds);
  }, [selectedDiverseEntities, geometryData, entitiesWithLinkedSounds]);

  // ============================================================================
  // Effect - Entity Highlighting (Individual Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateEntitySelection(geometryData, selectedEntity, selectedDiverseEntities);
  }, [selectedEntity, selectedDiverseEntities, geometryData]);

  // ============================================================================
  // Effect - Mode Visualization (Nodal Lines)
  // ============================================================================
  useEffect(() => {
    const modeVisualizer = modeVisualizerRef.current;
    const geometryRenderer = geometryRendererRef.current;
    if (!modeVisualizer || !geometryRenderer) return;

    // Check if visualization is active and we have data
    if (
      modeVisualizationState?.isActive &&
      modeVisualizationState.selectedModeIndex !== null &&
      currentModalResult &&
      currentModalResult.mode_shape_visualizations
    ) {
      const modeIndex = modeVisualizationState.selectedModeIndex;
      const modeViz = currentModalResult.mode_shape_visualizations[modeIndex];

      if (!modeViz) return;

      // Get the entity's highlight mesh (created when entity is selected in impact mode)
      // The highlight mesh has the same vertices as the analyzed entity
      const mesh = geometryRenderer.getHighlightMesh();
      if (!mesh) return;

      // Apply nodal line visualization
      modeVisualizer.applyModeVisualization(mesh, modeViz);
    } else {
      // Clear visualization if inactive
      const mesh = geometryRenderer.getHighlightMesh();
      if (mesh) {
        modeVisualizer.clearVisualization(mesh);
      }
    }
  }, [
    modeVisualizationState?.isActive,
    modeVisualizationState?.selectedModeIndex,
    currentModalResult,
  ]);

  // ============================================================================
  // Effect - Auto-select Mode 0 when Modal Analysis Completes
  // ============================================================================
  useEffect(() => {
    // Auto-select first mode when modal result becomes available
    if (
      currentModalResult &&
      currentModalResult.mode_shape_visualizations &&
      currentModalResult.mode_shape_visualizations.length > 0 &&
      modeVisualizationState &&
      modeVisualizationState.selectedModeIndex === null &&
      onSelectMode
    ) {
      onSelectMode(0);
    }
  }, [currentModalResult, modeVisualizationState?.selectedModeIndex, onSelectMode]);


  // ============================================================================
  // Effect - Update Entity Overlay Position (Animation Loop)
  // ============================================================================
  useEffect(() => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!selectedEntity || !sceneCoordinator) {
      setEntityOverlay(null);
      return;
    }

    const updateEntityOverlay = () => {
      if (!selectedEntity || !sceneCoordinator) return;

      const vector = new THREE.Vector3(
        selectedEntity.position[0],
        selectedEntity.position[1],
        selectedEntity.position[2]
      );
      const { x, y, isBehindCamera } = projectToScreen(
        vector,
        sceneCoordinator.camera,
        sceneCoordinator.renderer.domElement.clientWidth,
        sceneCoordinator.renderer.domElement.clientHeight
      );

      // Check if this entity has a linked sound
      let soundOverlay: UIOverlay | undefined = undefined;
      if (soundscapeData) {
        // Group sounds by prompt index to get variants
        const soundsByPromptIndex: { [key: number]: any[] } = {};
        soundscapeData.forEach(sound => {
          const promptIdx = (sound as any).prompt_index ?? 0;
          if (!soundsByPromptIndex[promptIdx]) {
            soundsByPromptIndex[promptIdx] = [];
          }
          soundsByPromptIndex[promptIdx].push(sound);
        });

        // Find sound linked to this entity
        Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
          const promptIdx = parseInt(promptIdxStr);
          const selectedIdx = selectedVariants[promptIdx] || 0;
          const selectedSound = sounds[selectedIdx] || sounds[0];

          // Only link if entity_index is a valid number (not null, not undefined) and matches selected entity
          if (
            selectedSound &&
            selectedSound.entity_index !== null &&
            selectedSound.entity_index !== undefined &&
            selectedSound.entity_index === selectedEntity.index
          ) {
            const promptKey = `prompt_${promptIdx}`;
            // Store entity index for EntityInfoBox positioning (above sound overlay)
            soundOverlay = {
              promptKey,
              promptIdx,
              x,
              y,
              visible: !isBehindCamera,
              soundId: selectedSound.id,
              displayName: trimDisplayName(selectedSound.display_name || selectedSound.id),
              variants: sounds.map(v => ({
                ...v,
                current_volume_db: soundVolumes[v.id] ?? v.volume_db,
                current_interval_seconds: soundIntervals[v.id] ?? v.interval_seconds
              })),
              selectedVariantIdx: selectedIdx,
              userHidden: hiddenOverlaysRef.current.has(promptKey),
              isEntityLinked: true
            };
          }
        });
      }

      // Position EntityInfoBox dynamically:
      // - If sound overlay exists AND is visible (not hidden by user AND showSoundBoxes is true):
      //   Position ABOVE the sound overlay by VERTICAL_STACK_OFFSET
      // - Otherwise: Position directly at entity (no offset)
      let entityBoxY = y; // Default: position at entity
      if (soundOverlay !== undefined) {
        const overlay = soundOverlay as UIOverlay;
        const isSoundVisible = showSoundBoxes && !hiddenOverlaysRef.current.has(overlay.promptKey);
        if (isSoundVisible) {
          entityBoxY = y - UI_OVERLAY.VERTICAL_STACK_OFFSET; // Offset above sound overlay
        }
      }

      setEntityOverlay({
        x,
        y: entityBoxY,
        visible: !isBehindCamera,
        entity: selectedEntity,
        soundOverlay,
        linkedPromptIndex: (soundOverlay as UIOverlay | undefined)?.promptIdx // Store prompt index for linking display
      });
    };

    sceneCoordinator.addAnimationCallback(updateEntityOverlay);

    return () => {
      sceneCoordinator.removeAnimationCallback(updateEntityOverlay);
    };
  }, [selectedEntity, soundscapeData, selectedVariants, soundVolumes, soundIntervals, showSoundBoxes]); // Add showSoundBoxes for dynamic positioning

  // ============================================================================
  // Effect - Update Sound UI Overlay Positions (Animation Loop)
  // ============================================================================
  useEffect(() => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    const soundSphereManager = soundSphereManagerRef.current;
    if (!sceneCoordinator || !soundSphereManager) return;

    // Clear overlays if no soundscape data
    if (!soundscapeData || soundscapeData.length === 0) {
      setUiOverlays([]);
      return;
    }

    const updateUIOverlayPositions = () => {
      if (!soundscapeData) return;

      const newOverlays: UIOverlay[] = [];
      const rendererWidth = sceneCoordinator.renderer.domElement.clientWidth;
      const rendererHeight = sceneCoordinator.renderer.domElement.clientHeight;

      const soundsByPromptIndex: { [key: number]: any[] } = {};
      soundscapeData.forEach(sound => {
        const promptIdx = (sound as any).prompt_index ?? 0;
        if (!soundsByPromptIndex[promptIdx]) {
          soundsByPromptIndex[promptIdx] = [];
        }
        soundsByPromptIndex[promptIdx].push(sound);
      });

      Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
        const promptIdx = parseInt(promptIdxStr);
        const selectedIdx = selectedVariants[promptIdx] || 0;
        const selectedSound = sounds[selectedIdx] || sounds[0];
        if (!selectedSound) return;

        // Check if this sound is linked to an entity (entity_index must be a valid number, not null/undefined)
        const isEntityLinked = selectedSound.entity_index !== null && selectedSound.entity_index !== undefined;

        // Use prompt_index as unique key to avoid React key conflicts with duplicate prompt texts
        const promptKey = `prompt_${promptIdx}`;

        let x: number, y: number, isBehindCamera: boolean, isVisible: boolean, distance: number;

        if (isEntityLinked) {
          // Entity-linked sound: get position from entity, not sphere
          const entity = modelEntities.find(e => e.index === selectedSound.entity_index);
          if (!entity) return; // Skip if entity not found

          const entityVector = new THREE.Vector3(
            entity.position[0],
            entity.position[1],
            entity.position[2]
          );

          // Calculate distance from camera to entity
          distance = sceneCoordinator.camera.position.distanceTo(entityVector);

          const screenPos = projectToScreen(
            entityVector,
            sceneCoordinator.camera,
            rendererWidth,
            rendererHeight
          );
          x = screenPos.x;
          y = screenPos.y;
          isBehindCamera = screenPos.isBehindCamera;

          const margin = UI_OVERLAY.MARGIN;
          const isInViewportFlag = isInViewportUtil(x, y, rendererWidth, rendererHeight, margin);
          isVisible = !isBehindCamera && isInViewportFlag;
        } else {
          // Non-entity-linked sound: get position from sphere
          const sphere = soundSphereManager.findSphereByPromptKey(promptKey);
          if (!sphere) return;

          const vector = new THREE.Vector3();
          sphere.getWorldPosition(vector);

          // Calculate distance from camera to sphere
          distance = sceneCoordinator.camera.position.distanceTo(vector);

          const screenPos = projectToScreen(
            vector,
            sceneCoordinator.camera,
            rendererWidth,
            rendererHeight
          );
          x = screenPos.x;
          y = screenPos.y;
          isBehindCamera = screenPos.isBehindCamera;

          const margin = UI_OVERLAY.MARGIN;
          const isInViewportFlag = isInViewportUtil(x, y, rendererWidth, rendererHeight, margin);
          isVisible = !isBehindCamera && isInViewportFlag;

          if (sphere) {
            sphere.visible = isVisible;
          }
        }

        const overlayData = {
          promptKey,
          promptIdx,
          x,
          y,
          visible: isVisible,
          soundId: selectedSound.id,
          displayName: trimDisplayName(selectedSound.display_name || selectedSound.id),
          variants: sounds,
          selectedVariantIdx: selectedIdx,
          userHidden: hiddenOverlaysRef.current.has(promptKey),
          isEntityLinked,
          distance
        };

        newOverlays.push(overlayData);
      });

      setUiOverlays(newOverlays);
    };

    sceneCoordinator.addAnimationCallback(updateUIOverlayPositions);

    return () => {
      sceneCoordinator.removeAnimationCallback(updateUIOverlayPositions);
    };
  }, [soundscapeData, selectedVariants, modelEntities]); // Add modelEntities for entity-linked sound positioning

  // ============================================================================
  // Effect - Update Sound Spheres (Meshes Only)
  // Note: Audio routing is handled separately in the auralization effect
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager) return;

    // Reset entity selection only when NEW sounds are generated (length changes)
    // Don't reset when just changing variants (selectedVariants changes but length stays same)
    const currentLength = soundscapeData?.length ?? 0;
    const prevLength = prevSoundscapeDataLengthRef.current;
    
    if (currentLength > 0 && currentLength !== prevLength) {
      setSelectedEntity(null);
      setEntityOverlay(null);
    }
    
    prevSoundscapeDataLengthRef.current = currentLength;

    // Get current audio sources before updating (to stop old variants)
    const oldAudioSources = soundSphereManager.getAllAudioSources();
    const playbackScheduler = playbackSchedulerRef.current;

    // Stop all schedulers for old audio sources ONLY if there are old sources
    // This prevents old variants from continuing to play after switching
    // Don't call onStopAll if there are no old sources (prevents spam on startup/generation)
    if (oldAudioSources.size > 0 && playbackScheduler) {
      // Use async IIFE to properly await stopAllSounds
      (async () => {
        await playbackScheduler.stopAllSounds(oldAudioSources);
        // Update UI state to reflect that all sounds are stopped after variant change
        onStopAll();
      })();
    }

    // Pass current auralization config for initial audio setup only
    // Changing auralization should NOT recreate meshes (use ref instead of prop)
    soundSphereManager.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfigRef.current
    );
  }, [soundscapeData, selectedVariants, scaleForSounds]);

  // ============================================================================
  // Effect - Update Receiver Cubes
  // ============================================================================
  useEffect(() => {
    const receiverManager = receiverManagerRef.current;
    if (!receiverManager) return;

    receiverManager.updateReceivers(receivers);
    // Note: Drag controls are updated in the effect below
  }, [receivers]);

  // ============================================================================
  // Effect - Update Drag Controls (Only when sound spheres or receivers change)
  // IMPORTANT: This effect MUST run AFTER the "Update Receiver Cubes" effect
  // to ensure drag controls include newly created receiver meshes
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    const receiverManager = receiverManagerRef.current;
    const inputHandler = inputHandlerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!soundSphereManager || !receiverManager || !inputHandler || !sceneCoordinator) return;

    // Get all draggable objects
    const allDraggableObjects = [
      ...soundSphereManager.getDraggableObjects(),
      ...receiverManager.getDraggableObjects()
    ];

    // Only setup drag controls if we have objects to drag
    // This prevents unnecessary setup on app startup
    if (allDraggableObjects.length === 0) {
      return;
    }

    // Update drag controls when sound spheres or receivers change
    // NOTE: Use receivers.length instead of receivers to avoid recreating on position changes
    // This allows smooth dragging (same pattern as sound spheres which don't trigger on position change)
    inputHandler.setupDragControls(allDraggableObjects, sceneCoordinator.controls);
  }, [soundscapeData, selectedVariants, scaleForSounds, receivers.length]);

  // ============================================================================
  // Effect - Preview Receiver Cube (Placing Mode)
  // ============================================================================
  useEffect(() => {
    const receiverManager = receiverManagerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!receiverManager || !sceneCoordinator) return;

    if (isPlacingReceiver) {
      receiverManager.enablePreview();
      sceneCoordinator.controls.enabled = false;
    } else {
      receiverManager.disablePreview();
      sceneCoordinator.controls.enabled = true;
    }
  }, [isPlacingReceiver]);

  // ============================================================================
  // Effect - Control Individual Sound Playback
  // ============================================================================
  useEffect(() => {
    const playbackScheduler = playbackSchedulerRef.current;
    const soundSphereManager = soundSphereManagerRef.current;
    if (!playbackScheduler || !soundSphereManager) return;

    const audioSources = soundSphereManager.getAllAudioSources();

    // IMPORTANT: This runs AFTER updateSoundSpheres when variants change
    // By that time, old variant audio sources have been removed
    // So we rely on updateSoundSpheres to stop any playing audio
    playbackScheduler.updateSoundPlayback(
      audioSources,
      individualSoundStates,
      soundIntervals
    );
  }, [individualSoundStates, soundIntervals]);

  // Helper: Calculate effective bounding box (from geometry or sound sources)
  const calculateEffectiveBounds = useCallback((): { min: [number, number, number]; max: [number, number, number] } | null => {
    if (geometryBounds) {
      return geometryBounds as { min: [number, number, number]; max: [number, number, number] };
    }
    
    // Auto-calculate from sound sources - use actual current positions from SoundSphereManager
    const soundSphereManager = soundSphereManagerRef.current;
    if (soundSphereManager) {
      const positions = soundSphereManager.getAllSpherePositions();

      if (positions.length > 0) {
        const threshold = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_THRESHOLD;
        const minSize = RESONANCE_AUDIO.BOUNDING_BOX.AUTO_BBOX_MIN_SIZE;
        
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        positions.forEach(([x, y, z]) => {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        });

        // Calculate center from actual sound positions
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const centerZ = (minZ + maxZ) / 2;

        // Calculate initial dimensions from sound spread
        const initialWidth = maxX - minX;
        const initialHeight = maxY - minY;
        const initialDepth = maxZ - minZ;

        // Ensure minimum dimensions and add threshold
        const width = Math.max(initialWidth + (threshold * 2), minSize);
        const height = Math.max(initialHeight + (threshold * 2), minSize);
        const depth = Math.max(initialDepth + (threshold * 2), minSize);

        // Return bounds centered on sound positions
        return {
          min: [centerX - width/2, centerY - height/2, centerZ - depth/2],
          max: [centerX + width/2, centerY + height/2, centerZ + depth/2]
        };
      }
    }
    
    return null;
  }, [geometryBounds]);

  // ============================================================================
  // Effect - Bounding Box Visualization
  // ============================================================================
  useEffect(() => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    const soundSphereManager = soundSphereManagerRef.current;
    if (!sceneCoordinator || !resonanceAudioConfig) return;

    // Calculate effective bounding box
    const boundsToUse = calculateEffectiveBounds();
    
    if (!boundsToUse) {
      // If no bounds available and bounding box exists, remove it
      if (boundingBoxGroupRef.current) {
        sceneCoordinator.scene.remove(boundingBoxGroupRef.current);
        boundingBoxGroupRef.current.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          } else if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          } else if (child instanceof THREE.Sprite) {
            (child.material as THREE.SpriteMaterial).map?.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        boundingBoxGroupRef.current = null;
      }
      return;
    }

    // Always clear existing bounding box when no geometry (for auto bbox recalculation on refresh)
    if (boundingBoxGroupRef.current && !geometryBounds) {
      sceneCoordinator.scene.remove(boundingBoxGroupRef.current);
      boundingBoxGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        } else if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        } else if (child instanceof THREE.Sprite) {
          (child.material as THREE.SpriteMaterial).map?.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      boundingBoxGroupRef.current = null;
    }

    // Create bounding box group if it doesn't exist
    if (!boundingBoxGroupRef.current) {
      const [minX, minY, minZ] = boundsToUse.min;
      const [maxX, maxY, maxZ] = boundsToUse.max;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const width = maxX - minX;
      const height = maxY - minY;
      const depth = maxZ - minZ;

      // Create group to hold all bounding box elements
      const boundingBoxGroup = new THREE.Group();
      boundingBoxGroup.position.set(centerX, centerY, centerZ);

      // 1. Create wireframe edges
      const boxGeometry = new THREE.BoxGeometry(width, height, depth);
      const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
      const wireframeMaterial = new THREE.LineBasicMaterial({ 
        color: RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_COLOR,
        linewidth: RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_WIDTH,
        depthTest: false, // Always render on top
        depthWrite: false
      });
      const wireframe = new THREE.LineSegments(edgesGeometry, wireframeMaterial);
      wireframe.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.WIREFRAME_RENDER_ORDER;
      boundingBoxGroup.add(wireframe);

      // Calculate label size based on bounding box dimensions
      const maxDimension = Math.max(width, height, depth);
      const labelWidth = maxDimension * RESONANCE_AUDIO.BOUNDING_BOX.LABEL_SCALE_FACTOR;
      const labelHeight = labelWidth / RESONANCE_AUDIO.BOUNDING_BOX.LABEL_ASPECT_RATIO;

      // 2. Create face planes with materials
      const faceConfigs = [
        { name: 'Left', normal: new THREE.Vector3(-1, 0, 0), position: new THREE.Vector3(-width/2, 0, 0), rotation: [0, Math.PI/2, 0], material: 'left', size: [depth, height] },
        { name: 'Right', normal: new THREE.Vector3(1, 0, 0), position: new THREE.Vector3(width/2, 0, 0), rotation: [0, -Math.PI/2, 0], material: 'right', size: [depth, height] },
        { name: 'Front', normal: new THREE.Vector3(0, 0, 1), position: new THREE.Vector3(0, 0, depth/2), rotation: [0, 0, 0], material: 'front', size: [width, height] },
        { name: 'Back', normal: new THREE.Vector3(0, 0, -1), position: new THREE.Vector3(0, 0, -depth/2), rotation: [0, Math.PI, 0], material: 'back', size: [width, height] },
        { name: 'Floor', normal: new THREE.Vector3(0, -1, 0), position: new THREE.Vector3(0, -height/2, 0), rotation: [Math.PI/2, 0, 0], material: 'down', size: [width, depth] },
        { name: 'Ceiling', normal: new THREE.Vector3(0, 1, 0), position: new THREE.Vector3(0, height/2, 0), rotation: [-Math.PI/2, 0, 0], material: 'up', size: [width, depth] },
      ];

      faceConfigs.forEach(config => {
        // Create semi-transparent plane
        const planeGeometry = new THREE.PlaneGeometry(config.size[0], config.size[1]);
        const planeMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: RESONANCE_AUDIO.BOUNDING_BOX.FACE_BASE_OPACITY,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false
        });
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.position.copy(config.position);
        plane.rotation.set(config.rotation[0], config.rotation[1], config.rotation[2]);
        plane.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.FACE_RENDER_ORDER;
        plane.userData.faceName = config.material; // Store for updates
        boundingBoxGroup.add(plane);

        // Create text sprite for label with fixed size and orientation
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_CANVAS_WIDTH;
        canvas.height = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_CANVAS_HEIGHT;
        context.fillStyle = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_BG_COLOR;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_FONT;
        context.fillStyle = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_TEXT_COLOR;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(config.name, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ 
          map: texture,
          depthTest: false,
          depthWrite: false
        });
        const sprite = new THREE.Sprite(spriteMaterial);
        sprite.position.copy(config.position);
        // Fixed size based on bounding box dimensions
        sprite.scale.set(labelWidth, labelHeight, 1);
        sprite.renderOrder = RESONANCE_AUDIO.BOUNDING_BOX.LABEL_RENDER_ORDER;
        boundingBoxGroup.add(sprite);
      });

      // Add to scene
      sceneCoordinator.scene.add(boundingBoxGroup);
      boundingBoxGroupRef.current = boundingBoxGroup;
      boxGeometry.dispose();
    }

    // Update face colors based on materials
    if (boundingBoxGroupRef.current && resonanceAudioConfig.roomMaterials) {
      const materials = resonanceAudioConfig.roomMaterials;
      
      boundingBoxGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.userData.faceName) {
          const faceMaterial = materials[child.userData.faceName as keyof typeof materials];
          const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[faceMaterial] || 0;
          
          // Color from white (low absorption) to cyan (high absorption)
          const r = 1 - absorption;
          const g = 1 - absorption * 0.3;
          const b = 1;
          
          (child.material as THREE.MeshBasicMaterial).color.setRGB(r, g, b);
          (child.material as THREE.MeshBasicMaterial).opacity = 
            RESONANCE_AUDIO.BOUNDING_BOX.FACE_BASE_OPACITY + 
            absorption * RESONANCE_AUDIO.BOUNDING_BOX.FACE_ABSORPTION_OPACITY_SCALE;
        }
      });
    }

    // Toggle visibility based on showBoundingBox prop
    if (boundingBoxGroupRef.current) {
      boundingBoxGroupRef.current.visible = showBoundingBox;
    }

    return () => {
      // Cleanup on unmount
      if (boundingBoxGroupRef.current) {
        sceneCoordinator.scene.remove(boundingBoxGroupRef.current);
        boundingBoxGroupRef.current.children.forEach(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          } else if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
          } else if (child instanceof THREE.Sprite) {
            (child.material as THREE.SpriteMaterial).map?.dispose();
            (child.material as THREE.Material).dispose();
          }
        });
        boundingBoxGroupRef.current = null;
      }
    };
  }, [geometryBounds, showBoundingBox, resonanceAudioConfig?.roomMaterials, refreshBoundingBoxTrigger, soundscapeData, calculateEffectiveBounds]);

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
  // Effect - Apply Global Volume
  // ============================================================================
  useEffect(() => {
    if (audioOrchestrator) {
      audioOrchestrator.setMasterVolume(globalVolume);
    }
  }, [globalVolume, audioOrchestrator]);

  // ============================================================================
  // Effect - Update UI State (Orientation Indicator)
  // ============================================================================
  useEffect(() => {
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!sceneCoordinator) return;

    const updateUIState = () => {
      if (!sceneCoordinator) return;
      const orientation = sceneCoordinator.getListenerOrientation();
      setCurrentOrientation(orientation);
      setIsFirstPersonMode(sceneCoordinator.isFirstPersonMode());
    };

    sceneCoordinator.addAnimationCallback(updateUIState);
    return () => {
      sceneCoordinator.removeAnimationCallback(updateUIState);
    };
  }, []);

  // ============================================================================
  // Effect - Update Timeline Data (Schedule Changes Only)
  // ============================================================================
  useEffect(() => {
    // Clear timeline when soundscape is removed
    if (!soundscapeData || soundscapeData.length === 0) {
      setTimelineSounds([]);
      return;
    }

    const playbackScheduler = playbackSchedulerRef.current;
    if (!playbackScheduler) {
      return;
    }

    // Use small timeout to ensure scheduler intervals are updated first
    const timeoutId = setTimeout(() => {
      const audioSchedulers = playbackScheduler.getAudioSchedulers();

      // Update timeline data if schedulers exist, otherwise clear
      if (audioSchedulers.size > 0) {
        // Calculate duration FIRST, then extract sounds using that duration
        const duration = calculateTimelineDuration(audioSchedulers);
        const sounds = extractTimelineSounds(audioSchedulers, duration);

        setTimelineSounds(sounds);
        setTimelineDuration(duration);
      } else {
        // No schedulers yet - clear timeline (will be populated when play starts)
        setTimelineSounds([]);
      }
    }, UI_TIMING.UPDATE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // Timeline data represents "what is scheduled", not playback state
    // Update when soundscape/variants change OR when intervals change
    // Update when soundscape/variants change OR when intervals change
  }, [soundscapeData, selectedVariants, soundIntervals]);

  // ============================================================================
  // Effect - Update Timeline When Playback Starts or Sound Count Changes
  // ============================================================================
  useEffect(() => {
    // When playback starts (Play All clicked), update timeline with scheduler data
    if (!isAnyPlaying || !soundscapeData || soundscapeData.length === 0) {
      return;
    }
    
    // Use setTimeout to ensure schedulers are populated
    // Schedulers are created asynchronously when Play All is clicked
    const timeoutId = setTimeout(() => {
      const playbackScheduler = playbackSchedulerRef.current;
      if (!playbackScheduler) return;

      const audioSchedulers = playbackScheduler.getAudioSchedulers();

      if (audioSchedulers.size > 0) {
        // Calculate duration FIRST, then extract sounds using that duration
        const duration = calculateTimelineDuration(audioSchedulers);
        const sounds = extractTimelineSounds(audioSchedulers, duration);

        setTimelineSounds(sounds);
        setTimelineDuration(duration);
      } else {
        // Retry after another delay
        setTimeout(() => {
          const schedulers = playbackSchedulerRef.current?.getAudioSchedulers();

          if (schedulers && schedulers.size > 0) {
            // Calculate duration FIRST, then extract sounds using that duration
            const duration = calculateTimelineDuration(schedulers);
            const sounds = extractTimelineSounds(schedulers, duration);

            setTimelineSounds(sounds);
            setTimelineDuration(duration);
          }
        }, UI_TIMING.RECEIVER_UPDATE_DELAY_MS);
      }
    }, UI_TIMING.SCENE_UPDATE_DELAY_MS);

    return () => clearTimeout(timeoutId);
  }, [isAnyPlaying, soundscapeData?.length]); // Update when playback starts or sound count changes

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
  // Render
  // ============================================================================
  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mountRef} className={`${className} w-full h-full`} />

      {/* 3D UI Overlays */}
      <div className="absolute inset-0 pointer-events-none">
        {uiOverlays.map((overlay) => {
          const selectedSound = overlay.variants[overlay.selectedVariantIdx];

          return (
            <SoundUIOverlay
              key={overlay.promptKey}
              overlay={{
                ...overlay,
                userHidden: !showSoundBoxes || overlay.userHidden,
                variants: overlay.variants.map(v => ({
                  ...v,
                  current_volume_db: soundVolumes[v.id] ?? v.volume_db,
                  current_interval_seconds: soundIntervals[v.id] ?? v.interval_seconds
                })),
                distance: overlay.distance // Explicitly preserve distance
              }}
              soundState={getSoundState(overlay.soundId, individualSoundStates)}
              onToggleSound={onToggleSound}
              onVariantChange={onVariantChange}
              onVolumeChange={onVolumeChange}
              onIntervalChange={onIntervalChange}
              onDelete={onDeleteSound}
              onHideToggle={handleOverlayHideToggle}
              onDragUpdate={handleOverlayDrag}
              onMute={onMute}
              onSolo={onSolo}
              isMuted={mutedSounds.has(overlay.soundId)}
              isSoloed={soloedSound === overlay.soundId}
            />
          );
        })}

        {/* Entity data overlay (shown when user clicks on an entity) */}
        {/* Entity-linked sound overlays are already rendered in the main uiOverlays array above */}
        {/* Only show EntityInfoBox here, positioned ABOVE the sound overlay */}
        {/* Hide when in impact ready/playing mode */}
        {entityOverlay && entityOverlay.visible && modalImpactMode === 'inactive' && (
          <EntityInfoBox
            entity={entityOverlay.entity}
            x={entityOverlay.x}
            y={entityOverlay.y}
            onModalImpact={handleModalImpactClick}
            isAnalyzing={false}
            isAnalyzed={modalAnalysisCache.current.has(entityOverlay.entity.index)}
            linkedPromptIndex={entityOverlay.linkedPromptIndex}
            isDiverseSelected={selectedDiverseEntities.some(e => e.index === entityOverlay.entity.index)}
            onToggleDiverseSelection={onToggleDiverseSelection}
            onDetachSound={onDetachSound}
          />
        )}

        {/* Entity info while analyzing - show analyzing state */}
        {entityOverlay && entityOverlay.visible && modalImpactMode === 'analyzing' && modalImpactEntity?.index === entityOverlay.entity.index && (
          <EntityInfoBox
            entity={entityOverlay.entity}
            x={entityOverlay.x}
            y={entityOverlay.y}
            onModalImpact={handleModalImpactClick}
            isAnalyzing={true}
            isAnalyzed={false}
            linkedPromptIndex={entityOverlay.linkedPromptIndex}
            isDiverseSelected={selectedDiverseEntities.some(e => e.index === entityOverlay.entity.index)}
            onToggleDiverseSelection={onToggleDiverseSelection}
            onDetachSound={onDetachSound}
          />
        )}

        {/* Modal Analysis Progress - removed, now shown inline in button */}

        {/* Impact Sound Playback Overlay - Right Side, Minimalistic */}
        {/* Show when ready OR playing */}
        {(modalImpactMode === 'ready' || modalImpactMode === 'playing') && modalImpactEntity && currentModalResult && (
          <ImpactSoundPlayback
            isPlaying={isPlayingImpact}
            numModes={currentModalResult.num_modes_computed}
            fundamentalFrequency={currentModalResult.frequency_response?.fundamental_frequency || currentModalResult.frequencies[0]}
            material="steel"
            meshQuality={currentModalResult.mesh_info?.mesh_quality}
            onExit={exitImpactMode}
            highlightHelp={highlightImpactHelp}
            modalResult={currentModalResult}
            visualizationState={modeVisualizationState}
            onSelectMode={onSelectMode}
          />
        )}
      </div>

      {/* Orientation Indicator - Top Left (First-Person Mode Only) */}
      {isFirstPersonMode && auralizationConfig.enabled && auralizationConfig.impulseResponseBuffer && (
        <OrientationIndicator
          yaw={currentOrientation.yaw}
          pitch={currentOrientation.pitch}
          className="absolute top-6 left-6 pointer-events-none z-20"
        />
      )}

      {/* Settings Button - Top Right */}
      <div className="absolute top-6 right-6 pointer-events-auto z-40">
        <SceneControlButton
          onClick={() => setIsSettingsPanelOpen(!isSettingsPanelOpen)}
          isActive={isSettingsPanelOpen}
          title="Advanced Settings"
          icon={
          <Icon className="transition-transform duration-200 group-hover:rotate-70">
            <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            <path
              d="M19.4 12.97c.04-.32.06-.65.06-.97s-.02-.65-.06-.97l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1
                a7.2 7.2 0 0 0-1.7-.97l-.38-2.65A.5.5 0 0 0 14.8 2h-3.6a.5.5 0 0 0-.5.42l-.38 2.65c-.6.23-1.17.55-1.7.97l-2.49-1a.5.5
                0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64L4.6 11.03c-.04.32-.06.65-.06.97s.02.65.06.97L2.49 14.62a.5.5 0 0 0-.12.64l2
                3.46a.5.5 0 0 0 .6.22l2.49-1c.53.42 1.1.74 1.7.97l.38 2.65a.5.5 0 0 0 .5.42h3.6a.5.5 0 0 0 .5-.42l.38-2.65c.6-.23
                1.17-.55 1.7-.97l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65Z"
            />
          </Icon>
          }
        />
      </div>

      {/* Advanced Settings Panel - Top Right (below button) */}
      <AdvancedSettingsPanel
        isOpen={isSettingsPanelOpen}
        onClose={() => setIsSettingsPanelOpen(false)}
        globalDuration={globalDuration}
        globalSteps={globalSteps}
        globalNegativePrompt={globalNegativePrompt}
        applyDenoising={applyDenoising}
        normalizeImpulseResponses={normalizeImpulseResponses}
        audioModel={audioModel}
        onGlobalDurationChange={onGlobalDurationChange || (() => {})}
        onGlobalStepsChange={onGlobalStepsChange || (() => {})}
        onGlobalNegativePromptChange={onGlobalNegativePromptChange || (() => {})}
        onApplyDenoisingChange={onApplyDenoisingChange || (() => {})}
        onNormalizeImpulseResponsesChange={onNormalizeImpulseResponsesChange || (() => {})}
        onAudioModelChange={onAudioModelChange || (() => {})}
        onResetToDefaults={onResetAdvancedSettings || (() => {})}
      />

      {/* Playback Controls - Bottom Center */}
      <PlaybackControls
        onPlayAll={handlePlayAll}
        onPauseAll={handlePauseAll}
        onStopAll={handleStopAll}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
      />

      {/* Audio Timeline - Bottom Center (above playback controls) */}
      {showTimeline && soundscapeData && soundscapeData.length > 0 && (
        <div 
          className="absolute left-1/2 transform -translate-x-1/2 pointer-events-auto z-10" 
          style={{ 
            bottom: `${TIMELINE_LAYOUT.BOTTOM_OFFSET_PX * 4}px`, // Convert Tailwind units to pixels (20 * 4 = 80px)
            width: `calc(100% - ${TIMELINE_LAYOUT.SIDEBAR_WIDTH_PX}px - ${TIMELINE_LAYOUT.CONTENT_WIDTH_PX}px)`, 
            maxWidth: `${TIMELINE_LAYOUT.MAX_WIDTH_PX}px` 
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
      )}

      {/* 3D Controls Info - Bottom Left */}
      <ControlsInfo />

      {/* Bottom-right control buttons */}
      <div className="absolute bottom-6 right-6 flex flex-col items-center pointer-events-auto" style={{ gap: UI_SCENE_BUTTON.GAP }}>
        {/* Global Volume Slider (appears above button when visible) */}
        {showVolumeSlider && (
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

        {/* Toggle Sound Boxes Button */}
        <SceneControlButton
          onClick={handleToggleSoundBoxes}
          isActive={showSoundBoxes}
          title={showSoundBoxes ? "Hide sound controls" : "Show sound controls"}
          icon={showSoundBoxes ? (
            <Icon>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </Icon>
          ) : (
            <Icon>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </Icon>
          )}
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

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
import { generateMaterialColor } from "@/components/acoustics/MaterialAssignmentUI";
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
import {
  extractTimelineSounds,
  calculateTimelineDuration,
  extractTimelineSoundsFromData,
  calculateTimelineDurationFromData
} from "@/lib/audio/timeline-utils";
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
  RESONANCE_AUDIO,
  ARCTIC_THEME
} from "@/lib/constants";
import type { UIOverlay, EntityData, EntityOverlay, CompasGeometry } from "@/types";
import type { ThreeSceneProps } from "@/types/three-scene";
import type { TimelineSound } from "@/types/audio";
import type { ModalAnalysisRequest } from "@/types/modal";
import { ResonanceMode } from "@/lib/audio/modes/ResonanceMode";
import { SimulationTab } from "../layout/sidebar/SimulationTab";

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
  onSelectSoundCard,
  selectedCardIndex,
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
  selectedReceiverId = null,
  onUpdateReceiverPosition,
  onReceiverSelected,
  onUpdateSoundPosition,
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
  audioRenderingMode = 'anechoic',
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
  onResetAdvancedSettings,
  selectedGeometry,
  onFaceSelected,
  materialAssignments,
  activeSimulationIndex,
  activeSimulationConfig,
  expandedSimulationIndex,
  expandedSimulationConfig,
  goToReceiverId,
  activeAiTab = 'text'
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
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);

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
  const audioRenderingModeRef = useRef(audioRenderingMode);
  const activeSimulationIndexRef = useRef(activeSimulationIndex);
  const activeSimulationConfigRef = useRef(activeSimulationConfig);
  const activeAiTabRef = useRef(activeAiTab);

  // ============================================================================
  // State - UI Overlays and Visibility
  // ============================================================================
  const [uiOverlays, setUiOverlays] = useState<UIOverlay[]>([]);
  const [entityOverlay, setEntityOverlay] = useState<EntityOverlay | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityData | null>(null);
  const [showSoundBoxes, setShowSoundBoxes] = useState<boolean>(true);

  // Track user-hidden overlays separately (persists across animation updates)
  const hiddenOverlaysRef = useRef<Set<string>>(new Set());

  // Track when sound spheres are updated (to trigger label updates)
  const [sphereUpdateCounter, setSphereUpdateCounter] = useState<number>(0);

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

    // Use the selected receiver ID from useReceivers hook, or fall back to first receiver if in first-person mode
    const receiverId = isFirstPersonMode 
      ? (selectedReceiverId || (receivers.length > 0 ? receivers[0].id : null))
      : null;

    // Only notify if state actually changed
    const prev = prevReceiverModeRef.current;
    if (prev.isActive !== isFirstPersonMode || prev.receiverId !== receiverId) {
      console.log('[ThreeScene] Receiver mode changed:', { isFirstPersonMode, receiverId });
      onReceiverModeChange(isFirstPersonMode, receiverId);
      prevReceiverModeRef.current = { isActive: isFirstPersonMode, receiverId };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstPersonMode, selectedReceiverId, receivers[0]?.id]);

  // ============================================================================
  // Effect - Programmatically Go To Receiver (activate first-person view)
  // ============================================================================
  useEffect(() => {
    if (!goToReceiverId || !sceneCoordinatorRef.current) return;

    // Find the receiver
    const receiver = receivers.find(r => r.id === goToReceiverId);
    if (!receiver) {
      console.warn('[ThreeScene] Go to receiver: Receiver not found:', goToReceiverId);
      return;
    }

    console.log('[ThreeScene] Go to receiver:', { id: goToReceiverId, position: receiver.position });

    const receiverPosition = new THREE.Vector3(...receiver.position);

    // Calculate initial look-at target (same logic as InputHandler double-click)
    // Try to look at the average of sound spheres, or default to looking forward
    let initialTarget: THREE.Vector3;

    // Get average position of sound spheres if any exist
    const soundSpherePositions: THREE.Vector3[] = [];
    if (soundscapeData) {
      soundscapeData.forEach((sound) => {
        if (sound.position) {
          soundSpherePositions.push(new THREE.Vector3(...sound.position));
        }
      });
    }

    if (soundSpherePositions.length > 0) {
      // Average of all sound sphere positions
      const sum = soundSpherePositions.reduce(
        (acc, pos) => acc.add(pos),
        new THREE.Vector3(0, 0, 0)
      );
      initialTarget = sum.divideScalar(soundSpherePositions.length);
    } else {
      // Default: look forward (negative Z direction)
      initialTarget = new THREE.Vector3(
        receiverPosition.x,
        receiverPosition.y,
        receiverPosition.z - 5
      );
    }

    // Calculate initial rotation angles
    const direction = new THREE.Vector3().subVectors(initialTarget, receiverPosition).normalize();
    const initialYaw = Math.atan2(direction.x, direction.z);
    const initialPitch = Math.asin(direction.y);

    // Enable first-person mode
    sceneCoordinatorRef.current.enableFirstPersonMode(receiverPosition, initialYaw, initialPitch);
    setIsFirstPersonMode(true);

    console.log('[ThreeScene] First-person mode activated programmatically', {
      receiverPos: receiverPosition.toArray(),
      initialYaw,
      initialPitch
    });
  }, [goToReceiverId, receivers, soundscapeData]);

  // ============================================================================
  // State - Audio Timeline
  // ============================================================================
  const [timelineSounds, setTimelineSounds] = useState<TimelineSound[]>([]);
  const [timelineDuration, setTimelineDuration] = useState<number>(TIMELINE_DEFAULTS.DURATION_MS);
  const [showTimeline, setShowTimeline] = useState<boolean>(true);

  // Global volume state
  const [globalVolume, setGlobalVolume] = useState<number>(1); // 0 to 1
  const [showVolumeSlider, setShowVolumeSlider] = useState<boolean>(false);
  const [isHoveringVolume, setIsHoveringVolume] = useState<boolean>(false);

  // Settings panel state
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState<boolean>(false);
  const [showAxesHelper, setShowAxesHelper] = useState<boolean>(false);

  // Timeline playback hook (synced with PlaybackControls)
  const { playbackState, play: playTimeline, pause: pauseTimeline, stop: stopTimeline, seekTo } = useTimelinePlayback({
    sounds: timelineSounds,
    duration: timelineDuration
  });

  // ============================================================================
  // Helper - Calculate Entity Center and Bounds
  // ============================================================================
  const calculateEntityBounds = useCallback((
    entityIndex: number,
    geometryData: CompasGeometry | null
  ): { center: THREE.Vector3; max: THREE.Vector3 } | null => {
    if (!geometryData?.face_entity_map || !geometryData.vertices || !geometryData.faces) {
      return null;
    }

    // Find all faces belonging to this entity
    const entityFaces: number[][] = [];
    geometryData.face_entity_map.forEach((entIdx, faceIndex) => {
      if (entIdx === entityIndex) {
        entityFaces.push(geometryData.faces[faceIndex]);
      }
    });

    if (entityFaces.length === 0) return null;

    // Calculate bounding box from all vertices in entity faces
    const box = new THREE.Box3();
    entityFaces.forEach(face => {
      face.forEach(vertexIndex => {
        const vertex = geometryData.vertices[vertexIndex];
        box.expandByPoint(new THREE.Vector3(vertex[0], vertex[1], vertex[2]));
      });
    });

    const center = new THREE.Vector3();
    box.getCenter(center);

    return { center, max: box.max };
  }, []);

  // ============================================================================
  // Helper - Create Number Label Sprite
  // ============================================================================
  const createNumberLabel = useCallback((number: number): THREE.Sprite => {
    // Create canvas for text
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = 128;
    canvas.height = 128;

    // No background - transparent
    context.clearRect(0, 0, canvas.width, canvas.height);

    // Draw number text
    context.font = 'bold 80px Arial';
    context.fillStyle = 'white';
    context.strokeStyle = 'black';
    context.lineWidth = 4;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // Draw stroke first for outline
    context.strokeText(number.toString(), 64, 64);
    // Then fill
    context.fillText(number.toString(), 64, 64);

    // Create sprite
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always render on top
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.3, 0.3, 1); // Smaller size to fit inside sphere
    sprite.userData.isNumberLabel = true;
    sprite.renderOrder = 999; // Render last (on top)

    return sprite;
  }, []);

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

  useEffect(() => {
    audioRenderingModeRef.current = audioRenderingMode;
  }, [audioRenderingMode]);

  useEffect(() => {
    activeSimulationIndexRef.current = activeSimulationIndex;
  }, [activeSimulationIndex]);

  useEffect(() => {
    activeSimulationConfigRef.current = activeSimulationConfig;
  }, [activeSimulationConfig]);

  useEffect(() => {
    activeAiTabRef.current = activeAiTab;
  }, [activeAiTab]);

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

  // Control axes helper visibility
  useEffect(() => {
    if (axesHelperRef.current) {
      axesHelperRef.current.visible = showAxesHelper;
    }
  }, [showAxesHelper]);

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

  // Wrap reset advanced settings to also reset scene settings
  const handleResetAdvancedSettingsLocal = useCallback(() => {
    setShowAxesHelper(false); // Reset axes helper to default (hidden)
    if (onResetAdvancedSettings) {
      onResetAdvancedSettings();
    }
  }, [onResetAdvancedSettings]);

  // Toggle global volume slider visibility
  const handleToggleVolumeSlider = useCallback(() => {
    setShowVolumeSlider(prev => !prev);
  }, []);

  // Handle volume control hover
  const handleVolumeMouseEnter = useCallback(() => {
    setIsHoveringVolume(true);
  }, []);

  const handleVolumeMouseLeave = useCallback(() => {
    setIsHoveringVolume(false);
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

  // ============================================================================
  // Sound Overlay Handlers (DEPRECATED - controls now in sidebar)
  // ============================================================================
  /*
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

    // Update label position to follow sphere
    const soundEvent = sphere.userData.soundEvent;
    if (soundEvent) {
      const promptIndex = (soundEvent as any).prompt_index ?? 0;
      // Find the label for this sound (labels are tagged with userData)
      const labels = sceneCoordinator.contentGroup.children.filter(
        child => child.userData.isNumberLabel &&
                 child.userData.promptIndex === promptIndex
      );
      labels.forEach(label => {
        label.position.copy(newPosition);
      });
    }
  }, []);
  */

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

    // Get sound metadata
    const soundMetadata = soundSphereManager.getAllAudioSources();

    // Update timeline cursor position
    seekTo(timeMs);

    // Update audio playback to match new timeline position
    // MUST await to ensure audio context is resumed before scheduling
    await playbackScheduler.seekToTime(
      timeMs,
      soundMetadata,
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

  // Memoize entity indices whose sound cards are selected
  const selectedSoundEntityIndices = useMemo(() => {
    const entityIndices = new Set<number>();

    if (!soundscapeData || selectedCardIndex === null) return entityIndices;

    // Find the sound for the selected card
    const selectedSound = soundscapeData.find(sound => {
      const promptIdx = (sound as any).prompt_index ?? 0;
      return promptIdx === selectedCardIndex;
    });

    // If the selected sound has an entity link, add it
    if (selectedSound && selectedSound.entity_index !== null && selectedSound.entity_index !== undefined) {
      entityIndices.add(selectedSound.entity_index);
    }

    return entityIndices;
  }, [soundscapeData, selectedCardIndex, selectedVariants]);

  // ============================================================================
  // Effect - Initialize Three.js Scene and Services (runs once)
  // ============================================================================
  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    // Initialize Scene Coordinator
    const sceneCoordinator = new SceneCoordinator(mountNode, audioOrchestrator);
    sceneCoordinatorRef.current = sceneCoordinator;

    // Add axes helper for spatial orientation (X=red, Y=green, Z=blue)
    const axesHelper = new THREE.AxesHelper(5);
    axesHelper.visible = false; // Hidden by default
    sceneCoordinator.scene.add(axesHelper);
    axesHelperRef.current = axesHelper;

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
    const playbackScheduler = new PlaybackSchedulerService(audioOrchestrator, audioContext);
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
      // In precise acoustics mode, don't show entity UI
      if (audioRenderingMode === 'precise') {
        return;
      }
      
      // If in linking mode, pass entity (or null) to linking handler
      // Clicking on empty space (entity === null) will unlink or exit linking mode
      if (isLinkingEntity && onEntityLinked) {
        onEntityLinked(entity);
      } else {
        // Normal entity selection behavior
        setSelectedEntity(entity);
        
        // If entity has a linked sound, select that sound card in sidebar
        if (entity && soundscapeData && onSelectSoundCard) {
          console.log('[ThreeScene] Entity clicked:', entity.index, 'Checking for linked sound...');
          const linkedSound = soundscapeData.find(
            (sound: any) => sound.entity_index === entity.index
          );
          console.log('[ThreeScene] Linked sound found:', linkedSound);
          if (linkedSound) {
            const promptIndex = (linkedSound as any).prompt_index ?? 0;
            console.log('[ThreeScene] Selecting sound card with promptIndex:', promptIndex);
            onSelectSoundCard(promptIndex);
          }
        }
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

      // Also update label position to follow sphere during drag
      const sphere = soundSphereManager.findSphereByPromptKey(promptKey);
      if (sphere && sphere.userData.soundEvent) {
        const promptIndex = (sphere.userData.soundEvent as any).prompt_index ?? 0;
        // Find and update the label for this sound sphere
        const labels = sceneCoordinator.contentGroup.children.filter(
          child => child.userData.isNumberLabel &&
                   child.userData.promptIndex === promptIndex &&
                   child.userData.isEntityLinked === false
        );
        labels.forEach(label => {
          label.position.copy(position);
        });
      }
    });

    // Update soundscapeData only when drag ends (not during drag)
    inputHandler.setOnSphereDragEnd((promptKey, position) => {
      const sphere = soundSphereManager.findSphereByPromptKey(promptKey);
      if (sphere && sphere.userData.soundEvent) {
        const soundEvent = sphere.userData.soundEvent;
        if (soundEvent?.id && onUpdateSoundPosition) {
          const positionArray: [number, number, number] = [position.x, position.y, position.z];
          onUpdateSoundPosition(soundEvent.id, positionArray);
        }
      }
    });

    inputHandler.setOnReceiverPositionUpdated((receiverId, position) => {
      onUpdateReceiverPosition?.(receiverId, position);
    });

    // Receiver selection (double-click) - triggers audio update via callback
    inputHandler.setOnReceiverSelected((receiverId) => {
      if (onReceiverSelected) {
        onReceiverSelected(receiverId);
      }
      console.log('[ThreeScene] Receiver selected:', receiverId);
    });

    inputHandler.setOnPlacementCanceled(() => onCancelPlacingReceiver?.());
    inputHandler.setOnPreviewPositionUpdated((position) => {
      receiverManager.updatePreviewPosition(position);
    });
    inputHandler.setOnSphereClicked((promptKey) => {
      // Extract promptIndex from promptKey (format: 'prompt_0', 'prompt_1', etc.)
      const promptIndex = parseInt(promptKey.split('_')[1]);

      // Clear entity selection (hide entity info overlay)
      setSelectedEntity(null);

      // Notify sidebar to select this sound card
      if (!isNaN(promptIndex) && onSelectSoundCard) {
        onSelectSoundCard(promptIndex);
      }

      // Show overlay if it's hidden by user
      const hiddenOverlays = hiddenOverlaysRef.current;
      if (hiddenOverlays.has(promptKey)) {
        hiddenOverlays.delete(promptKey);
        setUiOverlays(prev => [...prev]); // Force re-render
      }
    });

    // NEW: Face selection callback for precise acoustics mode
    inputHandler.setOnFaceSelected((faceIndex, entityIndex) => {
      // Determine if material coloring is active (use wireframe highlight)
      const activeConfig = activeSimulationConfigRef.current;
      const hasMaterialColoring = !!(activeConfig && (activeConfig as any)?.faceToMaterialMap?.size > 0);

      // Highlight face in 3D scene
      if (faceIndex === -1) {
        // Clear highlight
        geometryRenderer.highlightFace(-1, null);
      } else {
        geometryRenderer.highlightFace(faceIndex, geometryDataRef.current, hasMaterialColoring);
      }
      // Notify page.tsx to update selectedGeometry state
      if (onFaceSelected) {
        onFaceSelected(faceIndex, entityIndex);
      } else {
        console.warn('[ThreeScene] onFaceSelected callback not provided!');
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
    inputHandler.setAudioRenderingModeGetter(() => audioRenderingModeRef.current);
    inputHandler.setActiveSimulationIndexGetter(() => activeSimulationIndexRef.current ?? null);
    inputHandler.setActiveSimulationConfigGetter(() => activeSimulationConfigRef.current);
    inputHandler.setActiveAiTabGetter(() => activeAiTabRef.current);

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

      // Also update PlaybackSchedulerService (CRITICAL: Update BOTH orchestrator AND context)
      if (playbackScheduler) {
        (playbackScheduler as any).audioOrchestrator = audioOrchestrator;
        (playbackScheduler as any).audioContext = audioContext;
        console.log('[ThreeScene] ✅ Updated PlaybackScheduler with orchestrator and context');
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
  // Effect - Update Selected Sound Visualization
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    const sceneCoordinator = sceneCoordinatorRef.current;
    if (!soundSphereManager || !sceneCoordinator || !soundscapeData) return;

    // Get all sphere meshes and reset their colors
    const sphereMeshes = soundSphereManager.getSoundSphereMeshes();

    // Remove all existing number labels
    sceneCoordinator.contentGroup.children
      .filter(child => child.userData.isNumberLabel)
      .forEach(label => {
        sceneCoordinator.contentGroup.remove(label);
        if (label instanceof THREE.Sprite && label.material.map) {
          label.material.map.dispose();
          label.material.dispose();
        }
      });

    // Reset sphere colors to primary
    sphereMeshes.forEach(sphere => {
      const material = sphere.material as THREE.MeshStandardMaterial;
      material.color.setHex(UI_COLORS.PRIMARY_HEX);
    });

    // Add number labels to all sounds and highlight selected sound spheres
    soundscapeData.forEach(sound => {
      const promptIndex = (sound as any).prompt_index ?? 0;
      const isSelected = selectedCardIndex === promptIndex;

      // Find sphere for this sound
      const sphere = sphereMeshes.find(s => s.userData.soundEvent?.id === sound.id);
      if (sphere) {
        // Highlight sphere if selected
        if (isSelected) {
          const material = sphere.material as THREE.MeshStandardMaterial;
          material.color.setHex(parseInt(UI_COLORS.SECONDARY.replace('#', ''), 16));
        }

        // Add number label at sphere center
        const label = createNumberLabel(promptIndex + 1);
        label.position.copy(sphere.position);
        label.userData.promptIndex = promptIndex; // Tag for drag updates
        label.userData.isEntityLinked = false;
        // No Y offset - place at center
        sceneCoordinator.contentGroup.add(label);
      }

      // Handle entity-linked sounds: add label
      if (sound.entity_index !== undefined) {
        // Calculate entity bounds for label positioning
        const bounds = calculateEntityBounds(sound.entity_index, geometryData);
        if (bounds) {
          // Add number label above entity
          const label = createNumberLabel(promptIndex + 1);
          label.position.copy(bounds.center);
          label.position.y = bounds.max.y + 0.5; // Position above entity
          label.userData.promptIndex = promptIndex; // Tag for identification
          label.userData.isEntityLinked = true;
          sceneCoordinator.contentGroup.add(label);
        }
      }
    });

    // Entity coloring for selected sound cards is now handled by GeometryRenderer.updateDiverseHighlights
    // via the selectedSoundEntityIndices parameter
  }, [selectedCardIndex, soundscapeData, selectedVariants, geometryData, createNumberLabel, calculateEntityBounds, sphereUpdateCounter]);

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

      // Priority 2: In precise acoustics mode, don't show entity UI
      if (audioRenderingMode === 'precise') {
        return;
      }

      // Priority 3: Linking mode
      if (isLinkingEntity && onEntityLinked && entity) {
        onEntityLinked(entity);
        return;
      }

      // Priority 4: Normal entity selection
      setSelectedEntity(entity);

      // If entity has a linked sound, expand the corresponding sound card
      if (entity && soundscapeData && onSelectSoundCard) {
        // Find the sound linked to this entity
        const linkedSound = soundscapeData.find(sound =>
          sound.entity_index !== undefined &&
          sound.entity_index === entity.index
        );

        if (linkedSound) {
          const promptIndex = (linkedSound as any).prompt_index ?? 0;
          console.log(`[ThreeScene] Entity ${entity.index} has linked sound, selecting card ${promptIndex}`);
          onSelectSoundCard(promptIndex);
        }
      }
    });
  }, [
    isLinkingEntity,
    onEntityLinked,
    modalImpactMode,
    modalImpactEntity,
    geometryData,
    isPlayingImpact,
    handleImpactPointClick,
    soundscapeData,
    onSelectSoundCard,
    audioRenderingMode
  ]);

  // ============================================================================
  // Effect - Entity Highlighting (Diverse Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateDiverseHighlights(
      geometryData,
      selectedDiverseEntities,
      entitiesWithLinkedSounds,
      selectedSoundEntityIndices
    );
  }, [selectedDiverseEntities, geometryData, entitiesWithLinkedSounds, selectedSoundEntityIndices]);

  // ============================================================================
  // Effect - Entity Highlighting (Individual Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateEntitySelection(
      geometryData,
      selectedEntity,
      selectedDiverseEntities,
      entitiesWithLinkedSounds
    );
  }, [selectedEntity, selectedDiverseEntities, geometryData, entitiesWithLinkedSounds]);

  // ============================================================================
  // Effect - Clear Entity UI in Precise Mode
  // ============================================================================
  useEffect(() => {
    if (audioRenderingMode === 'precise') {
      // Clear all UI overlays when switching to precise mode
      setUiOverlays([]);
      // Also clear selected entity
      setSelectedEntity(null);
    }
  }, [audioRenderingMode]);

  // ============================================================================
  // Effect - Clear Entity UI When in Face Selection Mode (Mode 2)
  // ============================================================================
  useEffect(() => {
    // Check if we're in face selection mode (must match InputHandler logic)
    if (!activeSimulationConfig) return;

    const isFaceSelectionMode =
      activeAiTab === 'acoustics' &&
      activeSimulationIndex !== null &&
      (activeSimulationConfig.mode === 'pyroomacoustics' || activeSimulationConfig.mode === 'choras') &&
      (activeSimulationConfig.state === 'before-simulation' || activeSimulationConfig.state === 'running');

    if (isFaceSelectionMode) {
      // Clear entity overlay when entering face selection mode
      setSelectedEntity(null);
    }
  }, [activeAiTab, activeSimulationIndex, activeSimulationConfig]);

  // ============================================================================
  // Effect - Face Highlighting (Face Selection Mode / Mode 2)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    // Check if we're in face selection mode (Mode 2)
    const isFaceSelectionMode =
      activeAiTab === 'acoustics' &&
      activeSimulationIndex !== null &&
      activeSimulationConfig &&
      (activeSimulationConfig.mode === 'pyroomacoustics' || activeSimulationConfig.mode === 'choras') &&
      (activeSimulationConfig.state === 'before-simulation' || activeSimulationConfig.state === 'running');


    // Clear highlights when not in face selection mode
    if (!isFaceSelectionMode) {
      geometryRenderer.highlightFace(-1, null);
      return;
    }

    // Determine if material coloring is active (use wireframe highlight to preserve material colors)
    const hasMaterialColoring = !!(activeSimulationConfig && (activeSimulationConfig as any)?.faceToMaterialMap?.size > 0);

    // Highlight faces when selectedGeometry changes from sidebar
    if (selectedGeometry && geometryData?.face_entity_map) {
      if (selectedGeometry.type === 'face' && selectedGeometry.faceIndex !== undefined) {
        // Highlight single face (use wireframe if material coloring is active)
        geometryRenderer.highlightFace(selectedGeometry.faceIndex, geometryData, hasMaterialColoring);
      } else if (selectedGeometry.type === 'entity' && selectedGeometry.entityIndex !== undefined) {
        // Highlight all faces of the entity
        const facesToHighlight: number[] = [];
        geometryData.face_entity_map.forEach((entIdx: number, faceIdx: number) => {
          if (entIdx === selectedGeometry.entityIndex) {
            facesToHighlight.push(faceIdx);
          }
        });
        if (facesToHighlight.length > 0) {
          geometryRenderer.highlightFaces(facesToHighlight, geometryData);
        }
      } else if (selectedGeometry.type === 'layer' && selectedGeometry.layerId) {
        // Highlight all faces in entities belonging to this layer
        const facesToHighlight: number[] = [];
        const layerEntities = modelEntities.filter(e => e.layer === selectedGeometry.layerId);
        const entityIndices = new Set(layerEntities.map(e => e.index));

        geometryData.face_entity_map.forEach((entIdx: number, faceIdx: number) => {
          if (entityIndices.has(entIdx)) {
            facesToHighlight.push(faceIdx);
          }
        });
        if (facesToHighlight.length > 0) {
          geometryRenderer.highlightFaces(facesToHighlight, geometryData);
        }
      } else if (selectedGeometry.type === 'global') {
        // Highlight all faces
        const allFaces = Array.from({ length: geometryData.faces.length }, (_, i) => i);
        geometryRenderer.highlightFaces(allFaces, geometryData);
      } else {
        // Clear highlight
        geometryRenderer.highlightFace(-1, null);
      }
    } else {
      // Clear highlight if no selection
      geometryRenderer.highlightFace(-1, null);
    }
  }, [selectedGeometry, geometryData, activeAiTab, activeSimulationIndex, activeSimulationConfig, modelEntities]);

  // ============================================================================
  // Effect - Material Coloring (Active or Expanded Simulation Tab)
  // ============================================================================
  useEffect(() => {
    // Use active simulation if available, otherwise fall back to expanded simulation
    const displayConfig = activeSimulationConfig || expandedSimulationConfig;
    const displayIndex = activeSimulationIndex !== null ? activeSimulationIndex : expandedSimulationIndex;

    const geometryRenderer = geometryRendererRef.current;

    // Enable coloring when a simulation tab is active or expanded
    if (!geometryRenderer || !geometryData || !displayConfig) {
      return;
    }

    const simConfig = displayConfig as any;
    const faceToMaterialMap = simConfig.faceToMaterialMap as Map<number, string> | undefined;

    if (!faceToMaterialMap || faceToMaterialMap.size === 0) {
      return;
    }

    // Get unique materials from the faceToMaterialMap
    const uniqueMaterialIds = Array.from(new Set(faceToMaterialMap.values()));

    if (uniqueMaterialIds.length === 0) {
      return;
    }

    // Helper: Generate stable hash from string (for consistent colors per material ID)
    const hashString = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return Math.abs(hash);
    };

    // Create material color map with stable colors based on material ID
    const materialColors = new Map<string, string>();
    uniqueMaterialIds.forEach((materialId) => {
      // Use hash to determine a stable position in the gradient (0-99)
      const hashValue = hashString(materialId);
      const gradientPosition = hashValue % 100; // 0-99
      const color = generateMaterialColor(100-gradientPosition, 100);
      materialColors.set(materialId, color);
    });

    // Find the main geometry mesh
    const mesh = geometryRenderer['contentGroup'].children.find(
      child => child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;

    if (!mesh) {
      console.log('ThreeScene: No geometry mesh found in contentGroup');
      return;
    }

    const geometry = mesh.geometry;
    const positionCount = geometry.attributes.position.count;
    const colors = new Float32Array(positionCount * 3);

    // Initialize all vertices with default color (light gray)
    for (let i = 0; i < positionCount; i++) {
      colors[i * 3] = 0.9;
      colors[i * 3 + 1] = 0.9;
      colors[i * 3 + 2] = 0.9;
    }

    let coloredFaces = 0;
    const index = geometry.index;

    if (!index) {
      console.warn('ThreeScene: Geometry has no index buffer');
      return;
    }

    // Get the triangle-to-face mapping to correctly map face indices to triangles
    const triangleToFaceMap = geometryRenderer.getTriangleToFaceMap();
    if (!triangleToFaceMap) {
      console.warn('ThreeScene: No triangle-to-face mapping available');
      return;
    }

    // Build face-to-triangles map (reverse of triangleToFaceMap)
    // faceToTriangles[faceIndex] = [triangle0, triangle1, ...]
    const faceToTriangles = new Map<number, number[]>();
    triangleToFaceMap.forEach((faceIndex, triangleIndex) => {
      if (!faceToTriangles.has(faceIndex)) {
        faceToTriangles.set(faceIndex, []);
      }
      faceToTriangles.get(faceIndex)!.push(triangleIndex);
    });

    console.log('ThreeScene: Face-to-triangle mapping built', {
      totalFaces: geometryData.faces.length,
      totalTriangles: triangleToFaceMap.length,
      sampleMapping: Array.from(faceToTriangles.entries()).slice(0, 5).map(([face, triangles]) =>
        `Face ${face} -> Triangles [${triangles.join(', ')}]`
      )
    });

    // Iterate through faces and apply material colors from the simulation's faceToMaterialMap
    for (let faceIndex = 0; faceIndex < geometryData.faces.length; faceIndex++) {
      const materialId = faceToMaterialMap.get(faceIndex);

      if (materialId) {
        const materialColor = materialColors.get(materialId);
        if (materialColor) {
          coloredFaces++;
          // Parse hex color to RGB
          const color = new THREE.Color(materialColor);

          // Get all triangles for this face
          const triangleIndices = faceToTriangles.get(faceIndex) || [];

          // Color all triangles belonging to this face
          for (const triangleIndex of triangleIndices) {
            const indexStart = triangleIndex * 3;

            for (let v = 0; v < 3; v++) {
              const vertexIndex = index.getX(indexStart + v);
              colors[vertexIndex * 3] = color.r;
              colors[vertexIndex * 3 + 1] = color.g;
              colors[vertexIndex * 3 + 2] = color.b;
            }
          }
        }
      }
    }

    

    // Update geometry colors
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.attributes.color.needsUpdate = true;

    // Ensure material uses vertex colors with flat shading for solid colors
    if (mesh.material instanceof THREE.MeshStandardMaterial) {
      mesh.material.vertexColors = true;
      mesh.material.flatShading = true;
      // FIX: Set base color to white to prevent mixing with vertex colors
      mesh.material.color.setRGB(1, 1, 1);
      mesh.material.needsUpdate = true;
      geometry.computeVertexNormals(); // Recompute normals for flat shading
    } else if (Array.isArray(mesh.material)) {
      // Handle multi-material case
      mesh.material.forEach(mat => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.vertexColors = true;
          mat.flatShading = true;
          // FIX: Set base color to white to prevent mixing with vertex colors
          mat.color.setRGB(1, 1, 1);
          mat.needsUpdate = true;
        }
      });
      geometry.computeVertexNormals();
    } else {
      console.warn('ThreeScene: Material type not supported for vertex colors', mesh.material.type);
    }

  }, [activeSimulationConfig, expandedSimulationConfig, geometryData, activeSimulationIndex, expandedSimulationIndex]);

  // ============================================================================
  // Effect - Reset Material Colors When Leaving Acoustics Tab
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;

    if (!geometryRenderer || !geometryData) {
      return;
    }

    // Reset colors when NOT in acoustics tab or no active simulation
    if (activeAiTab !== 'acoustics' || activeSimulationIndex === null) {
      const mesh = geometryRenderer['contentGroup'].children.find(
        child => child instanceof THREE.Mesh && child.userData.isGeometry === true
      ) as THREE.Mesh | undefined;

      if (mesh) {
        const geometry = mesh.geometry;

        // Remove vertex colors attribute
        if (geometry.attributes.color) {
          geometry.deleteAttribute('color');
        }

        // Disable vertex colors in material and restore original base color
        if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.vertexColors = false;
          mesh.material.flatShading = false;
          // Restore original geometry color from ARCTIC_THEME
          mesh.material.color.setHex(ARCTIC_THEME.GEOMETRY_COLOR);
          mesh.material.needsUpdate = true;
        } else if (Array.isArray(mesh.material)) {
          mesh.material.forEach(mat => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.vertexColors = false;
              mat.flatShading = false;
              // Restore original geometry color from ARCTIC_THEME
              mat.color.setHex(ARCTIC_THEME.GEOMETRY_COLOR);
              mat.needsUpdate = true;
            }
          });
        }
      }
    }
  }, [activeAiTab, activeSimulationIndex, geometryData]);

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

      // Position EntityInfoBox directly at entity position (no offset)
      setEntityOverlay({
        x,
        y,
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
    const oldSoundMetadata = soundSphereManager.getAllAudioSources();
    const playbackScheduler = playbackSchedulerRef.current;

    // Stop all schedulers for old audio sources ONLY if there are old sources
    // This prevents old variants from continuing to play after switching
    // Don't call onStopAll if there are no old sources (prevents spam on startup/generation)
    if (oldSoundMetadata.size > 0 && playbackScheduler) {
      // Use async IIFE to properly await stopAllSounds
      (async () => {
        await playbackScheduler.stopAllSounds();
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

    // Trigger label update after spheres are created
    // Use setTimeout to ensure meshes are fully created before labels are added
    setTimeout(() => {
      setSphereUpdateCounter(prev => prev + 1);
    }, 0);
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
    // NOTE: Positions update on dragend (not during drag), so soundscapeData changes won't interrupt dragging
    // Use receivers.length to avoid recreating on receiver position updates
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

    // Update face colors based on materials using gradient
    if (boundingBoxGroupRef.current && resonanceAudioConfig.roomMaterials) {
      const materials = resonanceAudioConfig.roomMaterials;

      // Gradient colors from constants:
      const startColor = UI_COLORS.MATERIAL_GRADIENT_START.replace("#", "")
      const endColor = UI_COLORS.MATERIAL_GRADIENT_END.replace("#", "")

      boundingBoxGroupRef.current.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.userData.faceName) {
          const faceMaterial = materials[child.userData.faceName as keyof typeof materials];
          const absorption = RESONANCE_AUDIO.MATERIAL_ABSORPTION[faceMaterial] || 0;

          // Interpolate between teal (low absorption) and orange (high absorption)
          const r = (parseInt(startColor.slice(0, 2), 16) + (parseInt(endColor.slice(0, 2), 16) - parseInt(startColor.slice(0, 2), 16)) * absorption) / 255;
          const g = (parseInt(startColor.slice(2, 4), 16) + (parseInt(endColor.slice(2, 4), 16) - parseInt(startColor.slice(2, 4), 16)) * absorption) / 255;
          const b = (parseInt(startColor.slice(4, 6), 16) + (parseInt(endColor.slice(4, 6), 16) - parseInt(startColor.slice(4, 6), 16)) * absorption) / 255;

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

      // Get current sound metadata from soundSphereManager
      const soundMetadata = soundSphereManagerRef.current?.getAllAudioSources() || new Map();

      // ROBUST STRATEGY: Always use soundMetadata as the source of truth
      // Schedulers are transient (created when playing, destroyed when stopped)
      // soundMetadata persists as long as the soundscape exists
      // This prevents timeline from collapsing when Stop All is clicked (interval slider, individual play button, etc.)
      if (soundMetadata.size > 0) {
        const duration = calculateTimelineDurationFromData(soundMetadata, soundIntervals);
        const sounds = extractTimelineSoundsFromData(soundMetadata, soundIntervals, duration);

        setTimelineSounds(sounds);
        setTimelineDuration(duration);
        console.log('[ThreeScene] Timeline updated from soundMetadata:', sounds.length, 'sounds');
      }
      // Don't clear timeline when soundMetadata is empty temporarily
      // It will be cleared by the first effect when soundscapeData is removed
    }, UI_TIMING.UPDATE_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
    // Timeline data represents "what is configured", not playback state
    // Update when soundscape/variants/intervals change
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
        {/* Sound UI Overlays removed - controls now in sidebar */}

        {/* Entity data overlay (shown when user clicks on an entity) */}
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
            linkedSoundName={entityOverlay.soundOverlay?.displayName}
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
            linkedSoundName={entityOverlay.soundOverlay?.displayName}
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
      {isFirstPersonMode && (
        <OrientationIndicator
          yaw={currentOrientation.yaw}
          pitch={currentOrientation.pitch}
          className="absolute top-6 left-6 pointer-events-auto z-20"
          onExitFirstPersonMode={() => {
            const sceneCoordinator = sceneCoordinatorRef.current;
            if (sceneCoordinator) {
              sceneCoordinator.disableFirstPersonMode();
              setIsFirstPersonMode(false);
            }
          }}
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
        onResetToDefaults={handleResetAdvancedSettingsLocal}
        showAxesHelper={showAxesHelper}
        onShowAxesHelperChange={setShowAxesHelper}
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

        {/* Toggle Sound Boxes Button - Removed, controls now in sidebar */}

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

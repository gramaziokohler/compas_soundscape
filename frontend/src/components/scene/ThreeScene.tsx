"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import * as THREE from "three";

import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { EntityUIOverlay } from "@/components/overlays/EntityUIOverlay";
import { PlaybackControls } from "@/components/controls/PlaybackControls";
import { AudioTimeline } from "@/components/audio/AudioTimeline";
import { ControlsInfo } from "@/components/layout/sidebar/ControlsInfo";
import { triangulate, trimDisplayName } from "@/lib/utils";
import { frameCameraToObject } from "@/lib/three/sceneSetup";
import { SceneCoordinator } from "@/lib/three/scene-coordinator";
import { GeometryRenderer } from "@/lib/three/geometry-renderer";
import { SoundSphereManager } from "@/lib/three/sound-sphere-manager";
import { ReceiverManager } from "@/lib/three/receiver-manager";
import { AuralizationService } from "@/lib/audio/auralization-service";
import { PlaybackSchedulerService } from "@/lib/audio/playback-scheduler-service";
import { InputHandler } from "@/lib/three/input-handler";
import { extractTimelineSounds, calculateTimelineDuration } from "@/lib/audio/timeline-utils";
import { useTimelinePlayback } from "@/hooks/useTimelinePlayback";
import type { UIOverlay, EntityData, EntityOverlay } from "@/types";
import type { ThreeSceneProps } from "@/types/three-scene";
import type { TimelineSound } from "@/types/audio";

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
  onToggleSound,
  onVariantChange,
  onVolumeChange,
  onIntervalChange,
  onDeleteSound,
  onPlayAll,
  onPauseAll,
  onStopAll,
  isAnyPlaying,
  scaleForSounds,
  modelEntities = [],
  selectedDiverseEntities = [],
  auralizationConfig,
  receivers = [],
  onUpdateReceiverPosition,
  onPlaceReceiver,
  isPlacingReceiver = false,
  onCancelPlacingReceiver,
  className
}: ThreeSceneProps) {
  // ============================================================================
  // Refs - Service Managers
  // ============================================================================
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneCoordinatorRef = useRef<SceneCoordinator | null>(null);
  const geometryRendererRef = useRef<GeometryRenderer | null>(null);
  const soundSphereManagerRef = useRef<SoundSphereManager | null>(null);
  const receiverManagerRef = useRef<ReceiverManager | null>(null);
  const playbackSchedulerRef = useRef<PlaybackSchedulerService | null>(null);
  const auralizationServiceRef = useRef<AuralizationService | null>(null);
  const inputHandlerRef = useRef<InputHandler | null>(null);

  // ============================================================================
  // Refs - Data for Event Handlers
  // ============================================================================
  const geometryDataRef = useRef(geometryData);
  const modelEntitiesRef = useRef(modelEntities);
  const auralizationConfigRef = useRef(auralizationConfig);

  // ============================================================================
  // State - UI Overlays and Visibility
  // ============================================================================
  const [uiOverlays, setUiOverlays] = useState<UIOverlay[]>([]);
  const [entityOverlay, setEntityOverlay] = useState<EntityOverlay | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityData | null>(null);
  const [showSoundBoxes, setShowSoundBoxes] = useState<boolean>(true);

  // ============================================================================
  // State - Audio Timeline
  // ============================================================================
  const [timelineSounds, setTimelineSounds] = useState<TimelineSound[]>([]);
  const [timelineDuration, setTimelineDuration] = useState<number>(60000);
  const [showTimeline, setShowTimeline] = useState<boolean>(true);

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

  // Toggle sound boxes visibility
  const handleToggleSoundBoxes = useCallback(() => {
    setShowSoundBoxes(prev => !prev);
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
  // Memoized Values
  // ============================================================================

  // Memoize triangulated geometry data for performance
  const triangulatedGeometry = useMemo(() => {
    if (!geometryData) return null;
    return {
      positions: new Float32Array(geometryData.vertices.flat()),
      indices: triangulate(geometryData.faces)
    };
  }, [geometryData]);

  // ============================================================================
  // Effect - Initialize Three.js Scene and Services (runs once)
  // ============================================================================
  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    // Initialize Scene Coordinator
    const sceneCoordinator = new SceneCoordinator(mountNode);
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
      sceneCoordinator.listener
    );
    soundSphereManagerRef.current = soundSphereManager;

    // Initialize Receiver Manager
    const receiverManager = new ReceiverManager(
      sceneCoordinator.scene,
      scaleForSounds
    );
    receiverManagerRef.current = receiverManager;

    // Initialize Playback Scheduler Service
    const playbackScheduler = new PlaybackSchedulerService(sceneCoordinator.listener);
    playbackSchedulerRef.current = playbackScheduler;

    // Initialize Auralization Service (audio routing only)
    const auralizationService = new AuralizationService(sceneCoordinator.listener);
    auralizationServiceRef.current = auralizationService;

    // Initialize Input Handler
    const inputHandler = new InputHandler(
      sceneCoordinator.camera,
      sceneCoordinator.renderer
    );
    inputHandlerRef.current = inputHandler;

    // Setup Input Handler callbacks
    inputHandler.setOnEntitySelected((entity) => setSelectedEntity(entity));
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

    // Setup Input Handler data getters
    inputHandler.setGeometryDataGetter(() => geometryDataRef.current);
    inputHandler.setModelEntitiesGetter(() => modelEntitiesRef.current);
    inputHandler.setContentGroupGetter(() => sceneCoordinator.contentGroup);
    inputHandler.setReceiverMeshesGetter(() => receiverManager.getReceiverMeshes());
    inputHandler.setPreviewReceiverGetter(() => receiverManager.getPreviewReceiver());
    inputHandler.setOrbitControlsGetter(() => sceneCoordinator.controls as any);
    inputHandler.setSoundSpheresAverageGetter(calculateSoundSpheresAverage);
    inputHandler.setFirstPersonModeGetter(() => sceneCoordinator.isFirstPersonMode());

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
      auralizationService.dispose();
      inputHandler.dispose();

      if (mountNode.contains(sceneCoordinator.getDomElement())) {
        mountNode.removeChild(sceneCoordinator.getDomElement());
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        new Uint32Array(triangulatedGeometry.indices)
      );

      // Frame camera to model
      frameCameraToObject(
        sceneCoordinator.camera,
        sceneCoordinator.controls,
        sceneCoordinator.contentGroup,
        1.25
      );
    } else {
      geometryRenderer.updateGeometryMesh(null, null);
    }
  }, [triangulatedGeometry]);

  // ============================================================================
  // Effect - Entity Highlighting (Diverse Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateDiverseHighlights(geometryData, selectedDiverseEntities);
  }, [selectedDiverseEntities, geometryData]);

  // ============================================================================
  // Effect - Entity Highlighting (Individual Selection)
  // ============================================================================
  useEffect(() => {
    const geometryRenderer = geometryRendererRef.current;
    if (!geometryRenderer) return;

    geometryRenderer.updateEntitySelection(geometryData, selectedEntity, selectedDiverseEntities);
  }, [selectedEntity, selectedDiverseEntities, geometryData]);

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
      vector.project(sceneCoordinator.camera);

      const isBehindCamera = vector.z > 1;
      const x = (vector.x * 0.5 + 0.5) * sceneCoordinator.renderer.domElement.clientWidth;
      const y = (-(vector.y * 0.5) + 0.5) * sceneCoordinator.renderer.domElement.clientHeight;

      setEntityOverlay({
        x,
        y,
        visible: !isBehindCamera,
        entity: selectedEntity
      });
    };

    sceneCoordinator.addAnimationCallback(updateEntityOverlay);

    return () => {
      sceneCoordinator.removeAnimationCallback(updateEntityOverlay);
    };
  }, [selectedEntity]);

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

        // Use prompt_index as unique key to avoid React key conflicts with duplicate prompt texts
        const promptKey = `prompt_${promptIdx}`;
        const sphere = soundSphereManager.findSphereByPromptKey(promptKey);
        if (!sphere) return;

        const vector = new THREE.Vector3();
        sphere.getWorldPosition(vector);
        vector.project(sceneCoordinator.camera);

        const isBehindCamera = vector.z > 1;
        const x = (vector.x * 0.5 + 0.5) * rendererWidth;
        const y = (-(vector.y * 0.5) + 0.5) * rendererHeight;

        const margin = 250;
        const isInViewport =
          x >= -margin &&
          x <= rendererWidth + margin &&
          y >= -margin &&
          y <= rendererHeight + margin;

        const isVisible = !isBehindCamera && isInViewport;

        if (sphere) {
          sphere.visible = isVisible;
        }

        newOverlays.push({
          promptKey,
          promptIdx,
          x,
          y,
          visible: isVisible,
          soundId: selectedSound.id,
          displayName: trimDisplayName(selectedSound.display_name || selectedSound.id),
          variants: sounds,
          selectedVariantIdx: selectedIdx
        });
      });

      setUiOverlays(newOverlays);
    };

    sceneCoordinator.addAnimationCallback(updateUIOverlayPositions);

    return () => {
      sceneCoordinator.removeAnimationCallback(updateUIOverlayPositions);
    };
  }, [soundscapeData, selectedVariants]);

  // ============================================================================
  // Effect - Update Sound Spheres (Meshes Only)
  // Note: Audio routing is handled separately in the auralization effect
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager) return;

    // Reset entity selection when sound generation completes
    if (soundscapeData && soundscapeData.length > 0) {
      setSelectedEntity(null);
      setEntityOverlay(null);
    }

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
  // Effect - Update Drag Controls (Only when sound spheres or receivers change)
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
    // Do NOT update when auralizationConfig changes (audio routing only)
    inputHandler.setupDragControls(allDraggableObjects, sceneCoordinator.controls);
  }, [soundscapeData, selectedVariants, scaleForSounds, receivers]);

  // ============================================================================
  // Effect - Update Receiver Cubes
  // ============================================================================
  useEffect(() => {
    const receiverManager = receiverManagerRef.current;
    if (!receiverManager) return;

    receiverManager.updateReceivers(receivers);
    // Note: Drag controls are updated in the effect above
  }, [receivers]);

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

  // ============================================================================
  // Effect - Setup Auralization Convolver
  // ============================================================================
  useEffect(() => {
    const auralizationService = auralizationServiceRef.current;
    const soundSphereManager = soundSphereManagerRef.current;
    if (!auralizationService || !soundSphereManager) return;

    const audioSources = soundSphereManager.getAllAudioSources();

    // Only proceed if we have audio sources
    if (audioSources.size === 0) {
      return;
    }

    // Only run this effect when:
    // 1. Auralization is enabled AND an impulse response buffer exists
    // 2. OR when disabling auralization (enabled false but buffer still exists from previous state)
    // Don't run when both are false (no IR ever loaded)
    const hasImpulseResponse = auralizationConfig.impulseResponseBuffer !== null;
    const shouldSetupAuralization = auralizationConfig.enabled && hasImpulseResponse;
    const shouldDisableAuralization = !auralizationConfig.enabled && hasImpulseResponse;

    if (!shouldSetupAuralization && !shouldDisableAuralization) {
      return;
    }

    console.log('[ThreeScene] Auralization config changed - updating audio routing');

    // Stop and unschedule all sounds before changing routing
    const playbackScheduler = playbackSchedulerRef.current;
    if (playbackScheduler) {
      // Use async IIFE to properly await stopAllSounds
      (async () => {
        await playbackScheduler.stopAllSounds(audioSources);

        // Update audio routing (convolution only - no playback control)
        auralizationService.setupAuralization(auralizationConfig, audioSources);

        // Update sound sphere manager's convolver reference
        const convolverNode = auralizationService.getConvolverNode();
        soundSphereManager.setConvolverNode(convolverNode);

        // Update UI state to reflect that all sounds are stopped
        console.log('[ThreeScene] Stopping all sounds in UI state');
        onStopAll();
      })();
    }
  }, [
    auralizationConfig.enabled,
    auralizationConfig.impulseResponseBuffer,
    auralizationConfig.normalize
  ]);

  // ============================================================================
  // Effect - Apply Volume Changes
  // ============================================================================
  useEffect(() => {
    const soundSphereManager = soundSphereManagerRef.current;
    if (!soundSphereManager) return;

    soundSphereManager.updateVolumes(soundscapeData, soundVolumes);
  }, [soundVolumes, soundscapeData]);

  // ============================================================================
  // Effect - Update Timeline
  // ============================================================================
  useEffect(() => {
    const playbackScheduler = playbackSchedulerRef.current;
    if (!playbackScheduler) return;

    const audioSchedulers = playbackScheduler.getAudioSchedulers();

    // Update timeline data whenever sounds are scheduled
    if (audioSchedulers.size > 0) {
      const sounds = extractTimelineSounds(audioSchedulers, timelineDuration);
      const duration = calculateTimelineDuration(audioSchedulers);

      setTimelineSounds(sounds);
      setTimelineDuration(duration);
    } else {
      // Check if sounds are paused (keep timeline visible) or stopped (clear timeline)
      const anySoundPaused = Object.values(individualSoundStates).some(state => state === 'paused');
      if (!anySoundPaused) {
        setTimelineSounds([]);
      }
      // If paused, keep the existing timeline data visible
    }
  }, [soundscapeData, selectedVariants, individualSoundStates]);

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
        {showSoundBoxes && uiOverlays.map((overlay) => {
          const selectedSound = overlay.variants[overlay.selectedVariantIdx];

          return (
            <SoundUIOverlay
              key={overlay.promptKey}
              overlay={{
                ...overlay,
                variants: overlay.variants.map(v => ({
                  ...v,
                  current_volume_db: soundVolumes[v.id] ?? v.volume_db,
                  current_interval_seconds: soundIntervals[v.id] ?? v.interval_seconds
                }))
              }}
              soundState={individualSoundStates[overlay.soundId] || 'stopped'}
              onToggleSound={onToggleSound}
              onVariantChange={onVariantChange}
              onVolumeChange={onVolumeChange}
              onIntervalChange={onIntervalChange}
              onDelete={onDeleteSound}
            />
          );
        })}

        {/* Entity data overlay */}
        {entityOverlay && <EntityUIOverlay overlay={entityOverlay} />}
      </div>

      {/* Playback Controls - Bottom Center */}
      <PlaybackControls
        onPlayAll={handlePlayAll}
        onPauseAll={handlePauseAll}
        onStopAll={handleStopAll}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
      />

      {/* Audio Timeline - Bottom Center (above playback controls) */}
      {showTimeline && timelineSounds.length > 0 && (
        <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 pointer-events-auto z-10" style={{ width: 'calc(100% - 48px - 400px)', maxWidth: '1200px' }}>
          <AudioTimeline
            sounds={timelineSounds}
            duration={timelineDuration}
            currentTime={playbackState.currentTime}
            isPlaying={playbackState.isPlaying}
            onSeek={handleSeek}
          />
        </div>
      )}

      {/* 3D Controls Info - Bottom Left */}
      <ControlsInfo />

      {/* Bottom-right control buttons */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-auto">
        {/* Reset Zoom Button */}
        <button
          onClick={handleResetZoom}
          className="w-12 h-12 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-all duration-200 flex items-center justify-center group border border-gray-200 dark:border-gray-600"
          title="Reset camera view"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5 text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors"
          >
            <rect x="3" y="3" width="18" height="18" strokeDasharray="3 3" />
          </svg>
        </button>

        {/* Toggle Sound Boxes Button */}
        <button
          onClick={handleToggleSoundBoxes}
          className="w-12 h-12 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-all duration-200 flex items-center justify-center group border border-gray-200 dark:border-gray-600"
          title={showSoundBoxes ? "Hide sound controls" : "Show sound controls"}
        >
          {showSoundBoxes ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors"
            >
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>

        {/* Toggle Timeline Button */}
        {timelineSounds.length > 0 && (
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="w-12 h-12 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-all duration-200 flex items-center justify-center group border border-gray-200 dark:border-gray-600"
            title={showTimeline ? "Hide timeline" : "Show timeline"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5 text-gray-700 dark:text-gray-200 group-hover:text-primary transition-colors"
            >
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
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

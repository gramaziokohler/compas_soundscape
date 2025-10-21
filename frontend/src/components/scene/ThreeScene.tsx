"use client";

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";

import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { EntityUIOverlay } from "@/components/overlays/EntityUIOverlay";
import { PlaybackControls } from "@/components/controls/PlaybackControls";
import { ControlsInfo } from "@/components/layout/sidebar/ControlsInfo";
import { triangulate, trimDisplayName } from "@/lib/utils";
import { API_BASE_URL, PRIMARY_COLOR_HEX } from "@/lib/constants";
import {
  createArcticModeScene,
  setupArcticModeLighting,
  createArcticModeGrid,
  createArcticModeMaterial,
  setupOrbitControls,
  frameCameraToObject
} from "@/lib/three/sceneSetup";
import { AudioScheduler } from "@/lib/audio-scheduler";
import { processImpulseResponse } from "@/lib/audio/impulse-response";
import type { CompasGeometry, SoundEvent, SoundState, UIOverlay, EntityData, EntityOverlay, ReceiverData } from "@/types";
import type { ThreeSceneProps } from "@/types/three-scene";

/**
 * ThreeScene Component
 *
 * Main 3D scene component for the COMPAS Soundscape application.
 * Handles visualization of 3D geometry, spatial audio playback, and entity selection.
 *
 * Key Features:
 * - 3D geometry visualization with Three.js
 * - Interval-based spatial audio scheduling with random variance
 * - Two playback modes:
 *   1. Soundscape Mode: All sounds play together with synchronized scheduling
 *   2. Individual Mode: Each sound has its own independent scheduler
 * - Entity highlighting (diverse and individual selection)
 * - Draggable sound sources with positional audio
 *
 * Audio Scheduling:
 * - Playback interval = sound_duration + interval_setting + random_variance
 * - Random variance: ±10% by default (e.g., 10s → 9-11s)
 * - Individual schedulers are isolated and don't interfere with soundscape playback
 *
 * Architecture:
 * - Follows Single Responsibility Principle
 * - Audio scheduling logic kept internal due to tight coupling with 3D scene
 * - Uses refs for Three.js objects to avoid unnecessary re-renders
 * - Clear section comments for maintainability
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
  // Refs - Three.js Scene Objects
  // ============================================================================
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const dragControlsRef = useRef<DragControls | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  // ============================================================================
  // Refs - Audio Management
  // ============================================================================
  const audioSourcesRef = useRef<Map<string, THREE.PositionalAudio>>(new Map());
  const audioSchedulersRef = useRef<Map<string, AudioScheduler>>(new Map());
  const convolverNodeRef = useRef<ConvolverNode | null>(null);

  // ============================================================================
  // Refs - Sound Sphere Management
  // ============================================================================
  const draggableObjectsRef = useRef<THREE.Object3D[]>([]);
  const spherePositionsRef = useRef<{[key: string]: THREE.Vector3}>({});
  const prevSoundscapeDataRef = useRef<SoundEvent[] | null>(null);

  // ============================================================================
  // Refs - Receiver Sphere Management
  // ============================================================================
  const receiverSpheresRef = useRef<THREE.Mesh[]>([]);
  const receiverDragControlsRef = useRef<DragControls | null>(null);
  const previewReceiverRef = useRef<THREE.Mesh | null>(null);
  const receiverDraggableObjectsRef = useRef<THREE.Object3D[]>([]);
  const isDraggingRef = useRef<boolean>(false);
  const lockedReceiverPositionRef = useRef<THREE.Vector3 | null>(null);
  const firstPersonModeRef = useRef<boolean>(false);
  const firstPersonRotationRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 });

  // Track previous state to detect changes
  const prevIndividualSoundStatesRef = useRef<{[key: string]: SoundState}>({});
  const prevSoundIntervalsRef = useRef<{[key: string]: number}>({});
  const isPlayAllRef = useRef<boolean>(false);

  // ============================================================================
  // Refs - Entity Highlighting
  // ============================================================================
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const entityMarkersRef = useRef<THREE.Group | null>(null);
  const highlightMeshRef = useRef<THREE.Mesh | null>(null);
  const remainingMeshRef = useRef<THREE.Mesh | null>(null);
  const diverseHighlightsRef = useRef<THREE.Group | null>(null);
  const geometryDataRef = useRef<CompasGeometry | null>(null);
  const modelEntitiesRef = useRef<EntityData[]>([]);

  // ============================================================================
  // State - UI Overlays and Visibility
  // ============================================================================
  const [uiOverlays, setUiOverlays] = useState<UIOverlay[]>([]);
  const [entityOverlay, setEntityOverlay] = useState<EntityOverlay | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityData | null>(null);
  const [showSoundBoxes, setShowSoundBoxes] = useState<boolean>(true);

  // ============================================================================
  // Effect - Sync Props to Refs (for event handlers)
  // ============================================================================
  useEffect(() => {
    geometryDataRef.current = geometryData;
  }, [geometryData]);

  useEffect(() => {
    modelEntitiesRef.current = modelEntities;
  }, [modelEntities]);

  // ============================================================================
  // Handlers - Camera and UI Controls
  // ============================================================================

  // Calculate average position of sound spheres
  const calculateSoundSpheresAverage = (): THREE.Vector3 | null => {
    if (draggableObjectsRef.current.length === 0) return null;

    const sum = new THREE.Vector3();
    draggableObjectsRef.current.forEach(obj => {
      sum.add(obj.position);
    });
    sum.divideScalar(draggableObjectsRef.current.length);
    return sum;
  };

  // Reset camera to default or model view
  const handleResetZoom = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const contentGroup = contentGroupRef.current;
    if (!camera || !controls) return;

    // Unlock receiver position lock
    lockedReceiverPositionRef.current = null;

    // Reset distance constraints
    controls.minDistance = 0;
    controls.maxDistance = Infinity;

    // Reset to default settings
    controls.rotateSpeed = 1.0;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Re-enable panning and zooming
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;

    if (geometryData && contentGroup) {
      // Frame to model if it exists
      frameCameraToObject(camera, controls, contentGroup, 1.25);
    } else {
      // Reset to default position
      camera.position.set(15, 10, 15);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  };

  // Toggle sound boxes visibility
  const handleToggleSoundBoxes = () => {
    setShowSoundBoxes(prev => !prev);
  };

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
  // Effect - Initialize Three.js Scene (runs once)
  // ============================================================================
  useEffect(() => {
    const mountNode = mountRef.current;
    if (!mountNode) return;

    const scene = createArcticModeScene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, mountNode.clientWidth / mountNode.clientHeight, 0.1, 1000);
    camera.position.set(15, 10, 15);
    camera.up.set(0, 1, 0);
    const listener = new THREE.AudioListener();
    camera.add(listener);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountNode.clientWidth, mountNode.clientHeight);
    mountNode.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = setupOrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;

    const gridHelper = createArcticModeGrid();
    scene.add(gridHelper);

    setupArcticModeLighting(scene);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);
    contentGroupRef.current = contentGroup;

    const entityMarkers = new THREE.Group();
    scene.add(entityMarkers);
    entityMarkersRef.current = entityMarkers;

    const diverseHighlights = new THREE.Group();
    scene.add(diverseHighlights);
    diverseHighlightsRef.current = diverseHighlights;

    const animate = () => {
      // First-person mode: Arrow key rotation control
      if (firstPersonModeRef.current && lockedReceiverPositionRef.current) {
        // Disable OrbitControls entirely in first-person mode
        controls.enabled = false;

        // Lock camera position at receiver
        camera.position.copy(lockedReceiverPositionRef.current);

        // Calculate look-at target based on yaw (horizontal) and pitch (vertical) angles
        const yaw = firstPersonRotationRef.current.yaw;
        const pitch = firstPersonRotationRef.current.pitch;

        // Convert to direction vector
        const direction = new THREE.Vector3(
          Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch)
        );

        const target = new THREE.Vector3().addVectors(
          lockedReceiverPositionRef.current,
          direction
        );

        camera.lookAt(target);
      } else {
        // Normal mode: Use OrbitControls
        controls.enabled = true;
        controls.update();
      }

      renderer.render(scene, camera);
      animationFrameIdRef.current = requestAnimationFrame(animate);
    };
    animationFrameIdRef.current = requestAnimationFrame(animate);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      }
    });
    resizeObserver.observe(mountNode);

    // Click/Double-click handler for entity selection, receiver placement, and receiver camera reset
    let clickTimeout: NodeJS.Timeout | null = null;
    let clickCount = 0;

    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);

      // If in placing mode, place the receiver at the clicked position
      if (onPlaceReceiver && previewReceiverRef.current) {
        const position = previewReceiverRef.current.position;
        onPlaceReceiver([position.x, position.y, position.z]);
        return;
      }

      // Check for receiver cube double-click first
      const receiverIntersects = raycasterRef.current.intersectObjects(receiverSpheresRef.current, false);
      if (receiverIntersects.length > 0) {
        clickCount++;

        if (clickCount === 1) {
          clickTimeout = setTimeout(() => {
            clickCount = 0;
          }, 300);
        } else if (clickCount === 2) {
          // Double-click detected
          if (clickTimeout) clearTimeout(clickTimeout);
          clickCount = 0;

          // Lock camera at receiver position (first-person view)
          const receiverMesh = receiverIntersects[0].object as THREE.Mesh;
          const receiverPosition = receiverMesh.position.clone();

          // Calculate initial look-at target (average of sound spheres or forward)
          const soundSpheresAvg = calculateSoundSpheresAverage();
          const initialTarget = soundSpheresAvg || new THREE.Vector3(
            receiverPosition.x,
            receiverPosition.y,
            receiverPosition.z - 5
          );

          // Calculate initial rotation angles from direction to target
          const direction = new THREE.Vector3().subVectors(initialTarget, receiverPosition).normalize();
          const initialYaw = Math.atan2(direction.x, direction.z);
          const initialPitch = Math.asin(direction.y);

          // Enable first-person mode
          firstPersonModeRef.current = true;
          firstPersonRotationRef.current = {
            yaw: initialYaw,
            pitch: initialPitch
          };

          // Lock camera position at receiver
          lockedReceiverPositionRef.current = receiverPosition.clone();

          // Set camera position at receiver
          camera.position.copy(receiverPosition);

          console.log('[FirstPerson] Enabled - Use arrow keys to rotate view', {
            receiverPos: receiverPosition.toArray(),
            initialYaw,
            initialPitch,
          });

          // OrbitControls will be disabled in animate loop
          controls.enabled = false;
          
          return;
        }

        // Single click on receiver - just ignore and don't deselect entity
        return;
      }

      // Use refs to get current values
      const currentGeometryData = geometryDataRef.current;
      const currentModelEntities = modelEntitiesRef.current;

      // Check if we clicked on the main geometry mesh
      if (contentGroup.children.length > 0) {
        const geometryMesh = contentGroup.children.find(child =>
          child instanceof THREE.Mesh && child.userData.isGeometry === true
        );

        if (geometryMesh) {
          const intersects = raycasterRef.current.intersectObject(geometryMesh, false);

          if (intersects.length > 0) {
            const intersection = intersects[0];

            // Use face-entity mapping if available
            if (currentGeometryData?.face_entity_map && intersection.faceIndex !== undefined && intersection.faceIndex !== null && currentModelEntities.length > 0) {
              const triangleIndex = intersection.faceIndex;
              const faceIndex = Math.floor(triangleIndex / 1);

              if (faceIndex < currentGeometryData.face_entity_map.length) {
                const entityIndex = currentGeometryData.face_entity_map[faceIndex];
                const entity = currentModelEntities.find(e => e.index === entityIndex);

                if (entity) {
                  setSelectedEntity(entity);
                  return;
                }
              }
            }

            // Fallback: use bounding box method if mapping not available
            const clickPoint = intersection.point;
            let closestEntity = null;
            let minDistance = Infinity;

            currentModelEntities.forEach(entity => {
              const min = entity.bounds.min;
              const max = entity.bounds.max;
              const isInside =
                clickPoint.x >= min[0] && clickPoint.x <= max[0] &&
                clickPoint.y >= min[1] && clickPoint.y <= max[1] &&
                clickPoint.z >= min[2] && clickPoint.z <= max[2];

              if (isInside) {
                const entityPos = new THREE.Vector3(
                  entity.position[0],
                  entity.position[1],
                  entity.position[2]
                );
                const distance = clickPoint.distanceTo(entityPos);

                if (distance < minDistance) {
                  minDistance = distance;
                  closestEntity = entity;
                }
              }
            });

            setSelectedEntity(closestEntity);
            return;
          }
        }
      }

      // If no geometry clicked, deselect (but don't unlock camera - removed per user request)
      setSelectedEntity(null);
    };

    // Mouse move handler for preview receiver sphere
    const handleMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (previewReceiverRef.current) {
        raycasterRef.current.setFromCamera(mouseRef.current, camera);

        // Raycast against geometry or use a plane at y=0
        const planeY = 1.6; // Default ear height
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersectPoint = new THREE.Vector3();
        raycasterRef.current.ray.intersectPlane(plane, intersectPoint);

        if (intersectPoint) {
          previewReceiverRef.current.position.copy(intersectPoint);
        }
      }
    };

    // Keydown handler for arrow key rotation, canceling receiver placement, and resetting camera
    const handleKeyDown = (event: KeyboardEvent) => {
      // Arrow key rotation in first-person mode
      if (firstPersonModeRef.current) {
        const rotationSpeed = 0.05; // Radians per keypress
        const pitchSpeed = 0.03; // Slower vertical rotation

        switch(event.key) {
          case 'ArrowLeft':
            firstPersonRotationRef.current.yaw += rotationSpeed;
            event.preventDefault();
            break;
          case 'ArrowRight':
            firstPersonRotationRef.current.yaw -= rotationSpeed;
            event.preventDefault();
            break;
          case 'ArrowUp':
            firstPersonRotationRef.current.pitch += pitchSpeed;
            // Clamp pitch to prevent looking too far up/down
            firstPersonRotationRef.current.pitch = Math.min(Math.PI / 2 - 0.1, firstPersonRotationRef.current.pitch);
            event.preventDefault();
            break;
          case 'ArrowDown':
            firstPersonRotationRef.current.pitch -= pitchSpeed;
            // Clamp pitch to prevent looking too far up/down
            firstPersonRotationRef.current.pitch = Math.max(-Math.PI / 2 + 0.1, firstPersonRotationRef.current.pitch);
            event.preventDefault();
            break;
        }
      }

      if (event.key === 'Escape') {
        // Cancel receiver placement if active
        if (onCancelPlacingReceiver) {
          onCancelPlacingReceiver();
        }
        // Exit first-person mode
        firstPersonModeRef.current = false;
        // Unlock receiver position lock
        lockedReceiverPositionRef.current = null;
        // Reset distance constraints
        controls.minDistance = 0;
        controls.maxDistance = Infinity;
        // Reset to default settings
        controls.rotateSpeed = 1.0;
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        // Re-enable pan, zoom, and rotate
        controls.enablePan = true;
        controls.enableZoom = true;
        controls.enableRotate = true;
      }
    };

    renderer.domElement.addEventListener('click', handleClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
      if (clickTimeout) clearTimeout(clickTimeout);
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      audioSourcesRef.current.forEach(sound => {
        if(sound.isPlaying) sound.stop();
        sound.disconnect();
      });
      audioSourcesRef.current.clear();
      if (dragControlsRef.current) {
        dragControlsRef.current.dispose();
      }
      controls.dispose();
      renderer.dispose();
      if (mountNode.contains(renderer.domElement)) {
        mountNode.removeChild(renderer.domElement);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ============================================================================
  // Effect - Entity Highlighting (Diverse Selection)
  // ============================================================================
  useEffect(() => {
    const scene = sceneRef.current;
    const diverseGroup = diverseHighlightsRef.current;
    const contentGroup = contentGroupRef.current;
    if (!diverseGroup || !scene || !contentGroup) return;

    // Find the main geometry mesh
    const mainGeometryMesh = contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;

    // Clear existing diverse highlights
    while (diverseGroup.children.length > 0) {
      const mesh = diverseGroup.children[0];
      if (mesh instanceof THREE.Mesh) {
        mesh.geometry.dispose();
        if (mesh.material instanceof THREE.Material) {
          mesh.material.dispose();
        }
      }
      diverseGroup.remove(mesh);
    }

    // Create highlights for all diverse entities and gray mesh for non-diverse
    if (selectedDiverseEntities.length > 0 && geometryData?.face_entity_map && geometryData.vertices && geometryData.faces) {
      // Hide main mesh since we'll create separate meshes
      if (mainGeometryMesh) {
        mainGeometryMesh.visible = false;
      }

      const diverseEntityIndices = new Set(selectedDiverseEntities.map(e => e.index));
      const diverseFaces: number[][] = [];
      const nonDiverseFaces: number[][] = [];

      // Separate faces into diverse and non-diverse
      geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
        if (diverseEntityIndices.has(entityIndex)) {
          diverseFaces.push(geometryData.faces[faceIndex]);
        } else {
          nonDiverseFaces.push(geometryData.faces[faceIndex]);
        }
      });

      // Create pink meshes for diverse entities
      if (diverseFaces.length > 0) {
        const diverseIndices = triangulate(diverseFaces);
        const diverseGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        diverseGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        diverseGeom.setIndex(diverseIndices);
        diverseGeom.computeVertexNormals();

        const diverseMaterial = new THREE.MeshStandardMaterial({
          color: PRIMARY_COLOR_HEX,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: 0.5,
          emissive: PRIMARY_COLOR_HEX,
          emissiveIntensity: 0.4,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false
        });

        const diverseMesh = new THREE.Mesh(diverseGeom, diverseMaterial);
        diverseMesh.renderOrder = 999;
        diverseGroup.add(diverseMesh);
      }

      // Create gray mesh for non-diverse entities
      if (nonDiverseFaces.length > 0) {
        const nonDiverseIndices = triangulate(nonDiverseFaces);
        const nonDiverseGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        nonDiverseGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        nonDiverseGeom.setIndex(nonDiverseIndices);
        nonDiverseGeom.computeVertexNormals();

        const nonDiverseMaterial = createArcticModeMaterial();
        const nonDiverseMesh = new THREE.Mesh(nonDiverseGeom, nonDiverseMaterial);
        diverseGroup.add(nonDiverseMesh);
      }
    } else {
      // No diverse entities, show main mesh
      if (mainGeometryMesh) {
        mainGeometryMesh.visible = true;
      }
    }
  }, [selectedDiverseEntities, geometryData]);

  // ============================================================================
  // Effect - Entity Highlighting (Individual Selection)
  // ============================================================================
  useEffect(() => {
    const scene = sceneRef.current;
    const contentGroup = contentGroupRef.current;
    const diverseGroup = diverseHighlightsRef.current;
    if (!scene || !contentGroup) return;

    // Find the main geometry mesh
    const mainGeometryMesh = contentGroup.children.find(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry === true
    ) as THREE.Mesh | undefined;

    // Remove existing highlight and remaining mesh
    if (highlightMeshRef.current) {
      scene.remove(highlightMeshRef.current);
      highlightMeshRef.current.geometry.dispose();
      if (highlightMeshRef.current.material instanceof THREE.Material) {
        highlightMeshRef.current.material.dispose();
      }
      highlightMeshRef.current = null;
    }

    if (remainingMeshRef.current) {
      scene.remove(remainingMeshRef.current);
      remainingMeshRef.current.geometry.dispose();
      if (remainingMeshRef.current.material instanceof THREE.Material) {
        remainingMeshRef.current.material.dispose();
      }
      remainingMeshRef.current = null;
    }

    // Create new highlight if entity is selected
    if (selectedEntity && geometryData?.face_entity_map && geometryData.vertices && geometryData.faces) {
      // Hide the main gray mesh and diverse highlights
      if (mainGeometryMesh) {
        mainGeometryMesh.visible = false;
      }
      if (diverseGroup) {
        diverseGroup.visible = false;
      }

      // Check if this is a diverse entity (brighter pink)
      const isDiverse = selectedDiverseEntities.some(de => de.index === selectedEntity.index);

      // Separate faces into selected entity and others
      const selectedEntityFaces: number[][] = [];
      const otherFaces: number[][] = [];

      geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
        if (entityIndex === selectedEntity.index) {
          selectedEntityFaces.push(geometryData.faces[faceIndex]);
        } else {
          otherFaces.push(geometryData.faces[faceIndex]);
        }
      });

      // Create pink highlight mesh for selected entity
      if (selectedEntityFaces.length > 0) {
        const entityIndices = triangulate(selectedEntityFaces);
        const highlightGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        highlightGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        highlightGeom.setIndex(entityIndices);
        highlightGeom.computeVertexNormals();

        const highlightMaterial = new THREE.MeshStandardMaterial({
          color: PRIMARY_COLOR_HEX,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: isDiverse ? 0.6 : 0.35,
          emissive: PRIMARY_COLOR_HEX,
          emissiveIntensity: isDiverse ? 0.5 : 0.25,
          side: THREE.DoubleSide,
          depthTest: true,
          depthWrite: false
        });

        const highlightMesh = new THREE.Mesh(highlightGeom, highlightMaterial);
        highlightMesh.renderOrder = 1000;
        scene.add(highlightMesh);
        highlightMeshRef.current = highlightMesh;
      }

      // Create gray mesh for remaining entities
      if (otherFaces.length > 0) {
        const remainingIndices = triangulate(otherFaces);
        const remainingGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(geometryData.vertices.flat());
        remainingGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        remainingGeom.setIndex(remainingIndices);
        remainingGeom.computeVertexNormals();

        const remainingMaterial = createArcticModeMaterial();
        const remainingMesh = new THREE.Mesh(remainingGeom, remainingMaterial);
        scene.add(remainingMesh);
        remainingMeshRef.current = remainingMesh;
      }
    } else {
      // Show appropriate meshes when nothing is selected
      if (diverseGroup && diverseGroup.children.length > 0) {
        // If there are diverse entities, show them and hide the main mesh
        mainGeometryMesh && (mainGeometryMesh.visible = false);
        diverseGroup.visible = true;
      } else {
        // No diverse entities, show the main gray mesh
        mainGeometryMesh && (mainGeometryMesh.visible = true);
        diverseGroup && (diverseGroup.visible = false);
      }
    }
  }, [selectedEntity, selectedDiverseEntities, geometryData]);

  // ============================================================================
  // Effect - Update Entity Overlay Position (Animation Loop)
  // ============================================================================
  useEffect(() => {
    if (!selectedEntity || !cameraRef.current || !rendererRef.current) {
      setEntityOverlay(null);
      return;
    }

    const updateEntityOverlay = () => {
      if (!selectedEntity || !cameraRef.current || !rendererRef.current) return;

      const camera = cameraRef.current;
      const renderer = rendererRef.current;

      const vector = new THREE.Vector3(
        selectedEntity.position[0],
        selectedEntity.position[1],
        selectedEntity.position[2]
      );
      vector.project(camera);

      const isBehindCamera = vector.z > 1;
      const x = (vector.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
      const y = (-(vector.y * 0.5) + 0.5) * renderer.domElement.clientHeight;

      setEntityOverlay({
        x,
        y,
        visible: !isBehindCamera,
        entity: selectedEntity
      });
    };

    let animationId: number;
    const animate = () => {
      updateEntityOverlay();
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [selectedEntity]);

  // ============================================================================
  // Effect - Update Sound UI Overlay Positions (Animation Loop)
  // ============================================================================
  useEffect(() => {
    const updateUIOverlayPositions = () => {
      if (!cameraRef.current || !rendererRef.current || !soundscapeData) return;

      const camera = cameraRef.current;
      const renderer = rendererRef.current;
      const newOverlays: UIOverlay[] = [];

      // Get renderer dimensions to check viewport boundaries
      const rendererWidth = renderer.domElement.clientWidth;
      const rendererHeight = renderer.domElement.clientHeight;

      const soundsByPromptIndex: {[key: number]: SoundEvent[]} = {};
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

        const promptKey = (selectedSound as any).prompt || selectedSound.id;
        const sphere = draggableObjectsRef.current.find(obj => obj.userData.promptKey === promptKey);
        if (!sphere) return;

        const vector = new THREE.Vector3();
        sphere.getWorldPosition(vector);
        vector.project(camera);

        const isBehindCamera = vector.z > 1;
        const x = (vector.x * 0.5 + 0.5) * rendererWidth;
        const y = (-(vector.y * 0.5) + 0.5) * rendererHeight;

        // Check if overlay is within viewport bounds with margin
        // Add margin of 250px to account for overlay size
        const margin = 250;
        const isInViewport =
          x >= -margin &&
          x <= rendererWidth + margin &&
          y >= -margin &&
          y <= rendererHeight + margin;

        // Only show overlay if it's in front of camera AND within viewport
        const isVisible = !isBehindCamera && isInViewport;

        // Also hide the sphere itself if not visible
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

    let animationId: number;
    const animate = () => {
      updateUIOverlayPositions();
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [soundscapeData, selectedVariants]);

  // ============================================================================
  // Effect - Update Geometry Mesh
  // ============================================================================
  useEffect(() => {
    const contentGroup = contentGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!contentGroup || !camera || !controls) return;

    const existingMesh = contentGroup.children.find(child =>
      child instanceof THREE.Mesh &&
      child.userData.isGeometry === true
    );
    if (existingMesh) {
      const mesh = existingMesh as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      contentGroup.remove(mesh);
    }

    if (triangulatedGeometry) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(triangulatedGeometry.positions, 3));
      geom.setIndex(triangulatedGeometry.indices);
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, createArcticModeMaterial());
      mesh.userData.isGeometry = true;
      contentGroup.add(mesh);

      // Only frame camera on first load (when camera is at default position)
    //   const isDefaultPosition = camera.position.x === 15 && camera.position.y === 10 && camera.position.z === 15;
    //   if (isDefaultPosition) {
      frameCameraToObject(camera, controls, contentGroup, 1.25);
    //   }
    }
  }, [triangulatedGeometry]);

  // ============================================================================
  // Helper - Setup Unified DragControls
  // ============================================================================
  const setupDragControls = useCallback(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!camera || !renderer) return;

    // Don't recreate DragControls during an active drag
    if (isDraggingRef.current) {
      console.log('[DragControls] Skipping setup - drag in progress');
      return;
    }

    console.log('[DragControls] Setup running - sounds:', draggableObjectsRef.current.length, 'receivers:', receiverDraggableObjectsRef.current.length);

    // Dispose existing drag controls
    if (dragControlsRef.current) {
      dragControlsRef.current.dispose();
      dragControlsRef.current = null;
    }

    // Combine all draggable objects (sounds + receivers)
    const allDraggableObjects = [...draggableObjectsRef.current, ...receiverDraggableObjectsRef.current];

    console.log('[DragControls] Total draggable objects:', allDraggableObjects.length);

    if (allDraggableObjects.length > 0) {
      const dragControls = new DragControls(
        allDraggableObjects,
        camera,
        renderer.domElement
      );

      (dragControls as any).transformGroup = false;

      dragControls.addEventListener('dragstart', (event) => {
        isDraggingRef.current = true;
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
        if (event.object) {
          event.object.userData.isDragging = true;
        }
        console.log('[DragControls] Drag started:', event.object.userData);
      });

      dragControls.addEventListener('drag', (event) => {
        if (event.object && event.object.userData.promptKey) {
          // Sound sphere dragging
          spherePositionsRef.current[event.object.userData.promptKey] = event.object.position.clone();
          console.log('[DragControls] Dragging sound sphere:', event.object.userData.promptKey);
        } else if (event.object && event.object.userData.receiverId && onUpdateReceiverPosition) {
          // Receiver cube dragging
          const receiverId = event.object.userData.receiverId;
          const position: [number, number, number] = [
            event.object.position.x,
            event.object.position.y,
            event.object.position.z
          ];
          onUpdateReceiverPosition(receiverId, position);
          console.log('[DragControls] Dragging receiver sphere:', receiverId, position);
        }
      });

      dragControls.addEventListener('dragend', (event) => {
        isDraggingRef.current = false;
        if (controlsRef.current) {
          controlsRef.current.enabled = true;
        }
        if (event.object) {
          event.object.userData.isDragging = false;
        }
        console.log('[DragControls] Drag ended:', event.object.userData);
      });

      dragControlsRef.current = dragControls;
      console.log('[DragControls] DragControls successfully created with', allDraggableObjects.length, 'objects');
    }
  }, [onUpdateReceiverPosition]);

  // ============================================================================
  // Effect - Update Sound Spheres and Audio Sources
  // ============================================================================
  useEffect(() => {
    const scene = sceneRef.current;
    const contentGroup = contentGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !contentGroup || !camera || !controls) return;

    // Reset entity selection when sound generation completes
    if (soundscapeData && soundscapeData.length > 0) {
      setSelectedEntity(null);
      setEntityOverlay(null);
    }

    const isOnlyVariantChange =
      prevSoundscapeDataRef.current === soundscapeData &&
      soundscapeData !== null;

    prevSoundscapeDataRef.current = soundscapeData;

    const playingByPromptIndex = new Map<number, boolean>();
    if (soundscapeData) {
      soundscapeData.forEach(soundEvent => {
        const promptIdx = (soundEvent as any).prompt_index ?? 0;
        const audio = audioSourcesRef.current.get(soundEvent.id);
        if (audio && audio.isPlaying) {
          playingByPromptIndex.set(promptIdx, true);
        }
      });
    }

    audioSourcesRef.current.forEach(sound => {
      if (sound.isPlaying) sound.stop();
      try {
        sound.disconnect();
      } catch (error) {
        // Ignore disconnect errors - node may not be connected
        console.debug('Audio node disconnect error (expected):', error);
      }
    });
    audioSourcesRef.current.clear();
    draggableObjectsRef.current = [];

    const soundMeshes = contentGroup.children.filter(child =>
      child instanceof THREE.Mesh &&
      child.userData.isGeometry !== true
    );
    soundMeshes.forEach(mesh => {
      const m = mesh as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material instanceof THREE.Material) m.material.dispose();
      contentGroup.remove(m);
    });

    if (soundscapeData && camera.children.length > 0) {
      const listener = camera.children[0] as THREE.AudioListener;
      const audioLoader = new THREE.AudioLoader();

      const soundsByPromptIndex: {[key: number]: SoundEvent[]} = {};
      soundscapeData.forEach(sound => {
        const promptIdx = (sound as any).prompt_index ?? 0;
        if (!soundsByPromptIndex[promptIdx]) {
          soundsByPromptIndex[promptIdx] = [];
        }
        soundsByPromptIndex[promptIdx].push(sound);
      });

      const visibleSounds: SoundEvent[] = [];
      Object.entries(soundsByPromptIndex).forEach(([promptIdxStr, sounds]) => {
        const promptIdx = parseInt(promptIdxStr);
        const selectedIdx = selectedVariants[promptIdx] || 0;
        if (sounds[selectedIdx]) {
          visibleSounds.push(sounds[selectedIdx]);
        } else {
          visibleSounds.push(sounds[0]);
        }
      });

      visibleSounds.forEach(soundEvent => {
        let sphereGeom: THREE.BufferGeometry;
        if (soundEvent.geometry.vertices.length > 0) {
          sphereGeom = new THREE.BufferGeometry();
          const positions = new Float32Array(soundEvent.geometry.vertices.flat());
          const indices = triangulate(soundEvent.geometry.faces);
          sphereGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          sphereGeom.setIndex(indices);
          sphereGeom.computeVertexNormals();
        } else {
          const sphereRadius = 0.3 * scaleForSounds;
          sphereGeom = new THREE.SphereGeometry(sphereRadius, 32, 32);
        }

        const material = new THREE.MeshStandardMaterial({
          color: PRIMARY_COLOR_HEX,
          emissive: PRIMARY_COLOR_HEX,
          emissiveIntensity: 0.3,
          roughness: 0.3,
          metalness: 0.7
        });

        const sphereMesh = new THREE.Mesh(sphereGeom, material);

        const promptKey = (soundEvent as any).prompt || soundEvent.id;
        if (spherePositionsRef.current[promptKey]) {
          sphereMesh.position.copy(spherePositionsRef.current[promptKey]);
        } else {
          sphereMesh.position.fromArray(soundEvent.position);
          spherePositionsRef.current[promptKey] = sphereMesh.position.clone();
        }

        sphereMesh.userData.soundEvent = soundEvent;
        sphereMesh.userData.promptKey = promptKey;
        contentGroup.add(sphereMesh);
        draggableObjectsRef.current.push(sphereMesh);

        const positionalAudio = new THREE.PositionalAudio(listener);

        // Check if this is an uploaded sound (blob URL) or generated sound (backend URL)
        // Uploaded sounds have blob: or http: URLs, generated sounds are relative paths
        const isUploadedSound = soundEvent.url.startsWith('blob:') || soundEvent.url.startsWith('http');
        const fullUrl = isUploadedSound ? soundEvent.url : `${API_BASE_URL}${soundEvent.url}`;

        audioLoader.load(
          fullUrl,
          (buffer) => {
            positionalAudio.setBuffer(buffer);
            positionalAudio.setLoop(false); // Don't loop - scheduler handles intervals
            positionalAudio.setRefDistance(5);

            // Apply auralization if enabled and convolver is available
            if (auralizationConfig.enabled && convolverNodeRef.current) {
              try {
                // Get the positional audio's output
                const audioContext = listener.context;
                const sourceNode = positionalAudio.getOutput();

                // Disconnect from current destination
                sourceNode.disconnect();

                // Connect through convolver
                sourceNode.connect(convolverNodeRef.current);
                convolverNodeRef.current.connect(audioContext.destination);

                console.log(`[Auralization] Applied convolver to sound: ${soundEvent.id}`);
              } catch (error) {
                console.error('[Auralization] Error applying convolver:', error);
                // Fallback: reconnect directly
                positionalAudio.getOutput().connect(listener.context.destination);
              }
            }

            // Note: Don't auto-play here - let the scheduler handle it
          },
          undefined,
          (error) => {
            console.error('Error loading audio:', error);
          }
        );
        sphereMesh.add(positionalAudio);
        audioSourcesRef.current.set(soundEvent.id, positionalAudio);
      });

      // Trigger DragControls update after sounds are created
      setupDragControls();
    }
  }, [soundscapeData, selectedVariants, scaleForSounds, setupDragControls]);

  // ============================================================================
  // Effect - Update Receiver Spheres
  // ============================================================================
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!scene || !camera || !renderer) return;

    // Remove existing receiver spheres
    receiverSpheresRef.current.forEach(mesh => {
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) mesh.material.dispose();
      scene.remove(mesh);
    });
    receiverSpheresRef.current = [];
    receiverDraggableObjectsRef.current = [];

    // Create receiver cubes (draggable - handled by combined DragControls in sound spheres effect)
    receivers.forEach(receiver => {
      // Use same sizing logic as sound spheres (0.3 * scaleForSounds for spheres)
      // For cubes, use 0.3 * scaleForSounds as the side length to maintain similar visual size
      const cubeSize = 0.3 * scaleForSounds;
      const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

      // Blue color for receivers (sky-500: #0ea5e9)
      const material = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.7
      });

      const cubeMesh = new THREE.Mesh(cubeGeom, material);
      cubeMesh.position.fromArray(receiver.position);
      cubeMesh.userData.receiverId = receiver.id;
      cubeMesh.userData.isReceiver = true;

      scene.add(cubeMesh);
      receiverSpheresRef.current.push(cubeMesh);
      receiverDraggableObjectsRef.current.push(cubeMesh);
    });

    // Trigger DragControls update after receivers are created
    setupDragControls();
  }, [receivers, setupDragControls]);

  // ============================================================================
  // Effect - Preview Receiver Cube (Placing Mode)
  // ============================================================================
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Create or remove preview cube based on placing mode
    if (isPlacingReceiver) {
      // Create transparent preview cube with same sizing as regular receivers
      const cubeSize = 0.3 * scaleForSounds;
      const cubeGeom = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);

      const material = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.3,
        roughness: 0.3,
        metalness: 0.7,
        transparent: true,
        opacity: 0.5
      });

      const previewMesh = new THREE.Mesh(cubeGeom, material);
      previewMesh.position.set(0, 1.6, 0);
      previewMesh.userData.isPreview = true;

      scene.add(previewMesh);
      previewReceiverRef.current = previewMesh;

      // Disable orbit controls during placement
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
    } else {
      // Remove preview cube
      if (previewReceiverRef.current) {
        if (previewReceiverRef.current.geometry) previewReceiverRef.current.geometry.dispose();
        if (previewReceiverRef.current.material instanceof THREE.Material) {
          previewReceiverRef.current.material.dispose();
        }
        scene.remove(previewReceiverRef.current);
        previewReceiverRef.current = null;
      }

      // Re-enable orbit controls
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    }

    return () => {
      // Cleanup on unmount
      if (previewReceiverRef.current) {
        if (previewReceiverRef.current.geometry) previewReceiverRef.current.geometry.dispose();
        if (previewReceiverRef.current.material instanceof THREE.Material) {
          previewReceiverRef.current.material.dispose();
        }
        scene.remove(previewReceiverRef.current);
        previewReceiverRef.current = null;
      }
    };
  }, [isPlacingReceiver]);

  // ============================================================================
  // Effect - Cleanup Audio Schedulers on Unmount
  // ============================================================================
  useEffect(() => {
    return () => {
      // Cleanup all schedulers on unmount
      audioSchedulersRef.current.forEach(scheduler => scheduler.dispose());
      audioSchedulersRef.current.clear();
    };
  }, []);

  // ============================================================================
  // Effect - Control Individual Sound Playback (Granular Updates Only)
  // ============================================================================
  useEffect(() => {
    const sources = audioSourcesRef.current;
    const camera = cameraRef.current;
    if (sources.size === 0 || !camera || camera.children.length === 0) return;

    const listener = camera.children[0] as THREE.AudioListener;
    const prevStates = prevIndividualSoundStatesRef.current;
    const prevIntervals = prevSoundIntervalsRef.current;

    // Only process sounds that have changed
    const allSoundIds = new Set([
      ...Object.keys(individualSoundStates),
      ...Object.keys(prevStates)
    ]);

    // Detect if this is a "Play All" scenario (multiple sounds changing to 'playing' at once)
    const soundsChangingToPlaying = Array.from(allSoundIds).filter(soundId => {
      const currentState = individualSoundStates[soundId];
      const prevState = prevStates[soundId];
      return currentState === 'playing' && prevState !== 'playing';
    });

    // If 2 or more sounds are starting at the same time, it's likely "Play All"
    const isPlayAll = soundsChangingToPlaying.length >= 2;
    isPlayAllRef.current = isPlayAll;

    allSoundIds.forEach(soundId => {
      const currentState = individualSoundStates[soundId];
      const prevState = prevStates[soundId];
      const currentInterval = soundIntervals[soundId];
      const prevInterval = prevIntervals[soundId];

      const stateChanged = currentState !== prevState;
      const intervalChanged = currentInterval !== prevInterval;

      // Skip if nothing changed for this sound
      if (!stateChanged && !intervalChanged) return;

      const audio = sources.get(soundId);
      if (!audio || !audio.buffer) return;

      // Get or create scheduler for this sound
      let scheduler = audioSchedulersRef.current.get(soundId);
      if (!scheduler) {
        scheduler = new AudioScheduler(listener);
        audioSchedulersRef.current.set(soundId, scheduler);
      }

      // Handle state changes
      if (stateChanged) {
        switch (currentState) {
          case 'playing':
            // Only schedule if not already scheduled (prevents restart)
            if (!scheduler.isScheduled(soundId)) {
              console.log(`[ThreeScene] Starting sound ${soundId}, isPlayAll: ${isPlayAll}`);
              const intervalSeconds = currentInterval ?? 30;
              const randomnessPercent = 10; // ±10% variance

              // Calculate initial delay if this is Play All
              let initialDelayMs = 0;
              if (isPlayAll) {
                // Random delay from 0 to half the sound's interval
                const soundDurationMs = audio.buffer ? (audio.buffer.duration * 1000) : 0;
                const totalIntervalMs = (intervalSeconds * 1000) + soundDurationMs;
                const maxDelayMs = totalIntervalMs / 2;
                initialDelayMs = Math.random() * maxDelayMs;
              }

              scheduler.scheduleSound(soundId, audio, intervalSeconds, randomnessPercent, initialDelayMs);
            } else {
              console.log(`[ThreeScene] Sound ${soundId} already scheduled, skipping`);
            }
            break;

          case 'paused':
            // Unschedule and pause
            scheduler.unscheduleSound(soundId);
            if (audio.isPlaying) audio.pause();
            break;

          case 'stopped':
            // Unschedule and stop
            console.log(`[ThreeScene] Stopping sound ${soundId}, isPlaying: ${audio.isPlaying}`);
            scheduler.unscheduleSound(soundId);
            if (audio.isPlaying) audio.stop();
            audio.setLoop(false);
            break;
        }
      }
      // Handle interval changes (only if sound is playing and interval changed)
      else if (intervalChanged && currentState === 'playing' && scheduler.isScheduled(soundId)) {
        const intervalSeconds = currentInterval ?? 30;
        scheduler.updateInterval(soundId, intervalSeconds);
      }
    });

    // Update previous values
    prevIndividualSoundStatesRef.current = { ...individualSoundStates };
    prevSoundIntervalsRef.current = { ...soundIntervals };
  }, [individualSoundStates, soundIntervals]);


  // ============================================================================
  // Effect - Setup Auralization Convolver
  // ============================================================================
  useEffect(() => {
    console.log('[Auralization] Effect triggered:', {
      enabled: auralizationConfig.enabled,
      hasBuffer: !!auralizationConfig.impulseResponseBuffer,
      bufferDuration: auralizationConfig.impulseResponseBuffer?.duration,
      normalize: auralizationConfig.normalize
    });

    const camera = cameraRef.current;
    if (!camera || camera.children.length === 0) {
      console.log('[Auralization] Camera or listener not ready');
      return;
    }

    const listener = camera.children[0] as THREE.AudioListener;
    const audioContext = listener.context;

    console.log('[Auralization] AudioContext state:', audioContext.state);

    // Create or update convolver node
    if (auralizationConfig.enabled && auralizationConfig.impulseResponseBuffer) {
      try {
        // Process the impulse response
        const processedIR = processImpulseResponse(
          auralizationConfig.impulseResponseBuffer,
          audioContext,
          auralizationConfig.normalize
        );

        // Clean up old convolver if it exists
        if (convolverNodeRef.current) {
          convolverNodeRef.current.disconnect();
        }

        // Create new convolver node
        const convolver = audioContext.createConvolver();
        convolver.normalize = false; // We handle normalization in processImpulseResponse
        convolver.buffer = processedIR;

        // Store the convolver
        convolverNodeRef.current = convolver;

        console.log('[Auralization] Convolver node created and configured');
        console.log(`  - IR Duration: ${processedIR.duration.toFixed(3)}s`);
        console.log(`  - IR Channels: ${processedIR.numberOfChannels}`);
        console.log(`  - IR Sample Rate: ${processedIR.sampleRate}Hz`);
        console.log(`  - Normalized: ${auralizationConfig.normalize}`);

        // Reconnect all existing audio sources through the convolver
        audioSourcesRef.current.forEach((audio, soundId) => {
          if (audio.buffer) {
            try {
              const sourceNode = audio.getOutput();
              sourceNode.disconnect();
              sourceNode.connect(convolver);
              convolver.connect(audioContext.destination);
              console.log(`[Auralization] Reconnected sound ${soundId} through convolver`);
            } catch (error) {
              console.error(`[Auralization] Error reconnecting sound ${soundId}:`, error);
            }
          }
        });
      } catch (error) {
        console.error('[Auralization] Error setting up convolver:', error);
        convolverNodeRef.current = null;
      }
    } else {
      // Auralization disabled or no IR - disconnect convolver
      if (convolverNodeRef.current) {
        // Reconnect audio sources directly to destination
        audioSourcesRef.current.forEach((audio, soundId) => {
          if (audio.buffer) {
            try {
              const sourceNode = audio.getOutput();
              sourceNode.disconnect();
              sourceNode.connect(audioContext.destination);
              console.log(`[Auralization] Reconnected sound ${soundId} directly (bypass convolver)`);
            } catch (error) {
              console.error(`[Auralization] Error reconnecting sound ${soundId}:`, error);
            }
          }
        });

        convolverNodeRef.current = null;
        console.log('[Auralization] Convolver disabled');
      }
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
    const sources = audioSourcesRef.current;
    if (sources.size === 0 || !soundscapeData) return;

    soundscapeData.forEach(soundEvent => {
      const audio = sources.get(soundEvent.id);
      if (!audio) return;

      // Get the current volume setting
      const targetVolumeDb = soundVolumes[soundEvent.id] ?? soundEvent.volume_db ?? 70;
      const baseVolumeDb = soundEvent.volume_db ?? 70;

      // Calculate the volume difference in dB
      const dbDiff = targetVolumeDb - baseVolumeDb;

      // Convert dB difference to linear gain
      // gain = 10^(dB/20)
      const gainFactor = Math.pow(10, dbDiff / 20);

      // Apply the gain (THREE.js uses linear gain, not dB)
      // Clamp to reasonable range (0.0 to 10.0)
      audio.setVolume(Math.max(0.0, Math.min(10.0, gainFactor)));
    });
  }, [soundVolumes, soundscapeData]);

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
          const currentVolumeDb = soundVolumes[selectedSound?.id] ?? selectedSound?.volume_db ?? 70;

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
        onPlayAll={onPlayAll}
        onPauseAll={onPauseAll}
        onStopAll={onStopAll}
        isAnyPlaying={isAnyPlaying}
        hasSounds={soundscapeData !== null && soundscapeData.length > 0}
      />

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
            {/* Dashed square icon - typical "fit to view" symbol */}
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
      </div>
    </div>
  );
}

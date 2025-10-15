"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";

import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { EntityUIOverlay } from "@/components/overlays/EntityUIOverlay";
import { triangulate } from "@/lib/utils";
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
import type { CompasGeometry, SoundEvent, SoundState, UIOverlay, EntityData, EntityOverlay } from "@/types";

/**
 * ThreeScene Component Props
 */
interface ThreeSceneProps {
  geometryData: CompasGeometry | null;
  soundscapeData: SoundEvent[] | null;
  individualSoundStates: {[key: string]: SoundState};
  selectedVariants: {[key: number]: number};
  soundVolumes: {[key: string]: number};
  soundIntervals: {[key: string]: number};
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
  onVolumeChange: (soundId: string, volumeDb: number) => void;
  onIntervalChange: (soundId: string, intervalSeconds: number) => void;
  onDeleteSound: (soundId: string, promptIdx: number) => void;
  scaleForSounds: number;
  modelEntities?: EntityData[];
  selectedDiverseEntities?: EntityData[];
  className?: string;
}

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
  scaleForSounds,
  modelEntities = [],
  selectedDiverseEntities = [],
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

  // ============================================================================
  // Refs - Sound Sphere Management
  // ============================================================================
  const draggableObjectsRef = useRef<THREE.Object3D[]>([]);
  const spherePositionsRef = useRef<{[key: string]: THREE.Vector3}>({});
  const prevSoundscapeDataRef = useRef<SoundEvent[] | null>(null);

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

  // Reset camera to default or model view
  const handleResetZoom = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const contentGroup = contentGroupRef.current;
    if (!camera || !controls) return;

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
      controls.update();
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

    // Click handler for entity selection
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);

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

      // If no geometry clicked, deselect
      setSelectedEntity(null);
    };

    renderer.domElement.addEventListener('click', handleClick);

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', handleClick);
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
        const x = (vector.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
        const y = (-(vector.y * 0.5) + 0.5) * renderer.domElement.clientHeight;

        newOverlays.push({
          promptKey,
          promptIdx,
          x,
          y,
          visible: !isBehindCamera,
          soundId: selectedSound.id,
          displayName: selectedSound.display_name || selectedSound.id,
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
      sound.disconnect();
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
        const fullUrl = `${API_BASE_URL}${soundEvent.url}`;

        audioLoader.load(
          fullUrl,
          (buffer) => {
            positionalAudio.setBuffer(buffer);
            positionalAudio.setLoop(false); // Don't loop - scheduler handles intervals
            positionalAudio.setRefDistance(5);

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

      if (draggableObjectsRef.current.length > 0 && camera && rendererRef.current) {
        if (dragControlsRef.current) {
          dragControlsRef.current.dispose();
        }

        const dragControls = new DragControls(
          draggableObjectsRef.current,
          camera,
          rendererRef.current.domElement
        );

        (dragControls as any).transformGroup = false;

        dragControls.addEventListener('dragstart', (event) => {
          if (controlsRef.current) {
            controlsRef.current.enabled = false;
          }
          if (event.object) {
            event.object.userData.isDragging = true;
          }
        });

        dragControls.addEventListener('drag', (event) => {
          if (event.object && event.object.userData.promptKey) {
            spherePositionsRef.current[event.object.userData.promptKey] = event.object.position.clone();
          }
        });

        dragControls.addEventListener('dragend', (event) => {
          if (controlsRef.current) {
            controlsRef.current.enabled = true;
          }
          if (event.object) {
            event.object.userData.isDragging = false;
          }
        });

        dragControlsRef.current = dragControls;
      }
    }
  }, [soundscapeData, selectedVariants, scaleForSounds]);

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
            }
            break;

          case 'paused':
            // Unschedule and pause
            scheduler.unscheduleSound(soundId);
            if (audio.isPlaying) audio.pause();
            break;

          case 'stopped':
            // Unschedule and stop
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
    <div className="relative w-full h-full">
      <div ref={mountRef} className={className} />

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

      {/* Bottom-left control buttons */}
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

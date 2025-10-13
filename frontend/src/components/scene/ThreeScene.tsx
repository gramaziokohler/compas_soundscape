"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { EntityUIOverlay } from "@/components/overlays/EntityUIOverlay";
import { triangulate } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/constants";
import {
  createArcticModeScene,
  setupArcticModeLighting,
  createArcticModeGrid,
  createArcticModeMaterial,
  setupOrbitControls,
  frameCameraToObject
} from "@/lib/three/sceneSetup";
import type { CompasGeometry, SoundEvent, SoundState, UIOverlay, EntityData, EntityOverlay } from "@/types";

interface ThreeSceneProps {
  geometryData: CompasGeometry | null;
  soundscapeData: SoundEvent[] | null;
  soundscapeState: SoundState;
  individualSoundStates: {[key: string]: SoundState};
  selectedVariants: {[key: number]: number};
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
  scaleForSounds: number;
  modelEntities?: EntityData[];
  selectedDiverseEntities?: EntityData[];
  className?: string;
}

export function ThreeScene({
  geometryData,
  soundscapeData,
  soundscapeState,
  individualSoundStates,
  selectedVariants,
  onToggleSound,
  onVariantChange,
  scaleForSounds,
  modelEntities = [],
  selectedDiverseEntities = [],
  className
}: ThreeSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const audioSourcesRef = useRef<Map<string, THREE.PositionalAudio>>(new Map());
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const dragControlsRef = useRef<DragControls | null>(null);
  const contentGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const draggableObjectsRef = useRef<THREE.Object3D[]>([]);
  const spherePositionsRef = useRef<{[key: string]: THREE.Vector3}>({});
  const prevSoundscapeDataRef = useRef<SoundEvent[] | null>(null);

  const [uiOverlays, setUiOverlays] = useState<UIOverlay[]>([]);
  const [entityOverlay, setEntityOverlay] = useState<EntityOverlay | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityData | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const entityMarkersRef = useRef<THREE.Group | null>(null);
  const highlightMeshRef = useRef<THREE.Mesh | null>(null);
  const remainingMeshRef = useRef<THREE.Mesh | null>(null);
  const diverseHighlightsRef = useRef<THREE.Group | null>(null);
  const geometryDataRef = useRef<CompasGeometry | null>(null);
  const modelEntitiesRef = useRef<EntityData[]>([]);

  // Keep refs updated with latest props for click handler
  useEffect(() => {
    geometryDataRef.current = geometryData;
  }, [geometryData]);

  useEffect(() => {
    modelEntitiesRef.current = modelEntities;
  }, [modelEntities]);

  // Memoize triangulated geometry data
  const triangulatedGeometry = useMemo(() => {
    if (!geometryData) return null;
    return {
      positions: new Float32Array(geometryData.vertices.flat()),
      indices: triangulate(geometryData.faces)
    };
  }, [geometryData]);

  // Initialize scene, camera, renderer (only once)
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

  // Auto-highlight diverse entities after analysis and create gray mesh for non-diverse
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
          color: 0xF500B8,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: 0.5,
          emissive: 0xF500B8,
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

  // Create pink highlight for selected entity and gray mesh for others
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
          color: 0xF500B8,
          roughness: 0.3,
          metalness: 0.0,
          transparent: true,
          opacity: isDiverse ? 0.6 : 0.35,
          emissive: 0xF500B8,
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

  // Update entity overlay position
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

  // Update UI overlay positions every frame
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

  // Update geometry when geometryData changes
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

  // Update soundscape when soundscapeData changes
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
          color: 0xF500B8,
          emissive: 0xF500B8,
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
        const promptIdx = (soundEvent as any).prompt_index ?? 0;

        audioLoader.load(
          fullUrl,
          (buffer) => {
            positionalAudio.setBuffer(buffer);
            positionalAudio.setLoop(true);
            positionalAudio.setRefDistance(5);

            if (playingByPromptIndex.get(promptIdx) && listener.context.state !== 'suspended') {
              positionalAudio.play();
            }
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

  // Control audio playback based on soundscapeState
  useEffect(() => {
    const sources = audioSourcesRef.current;
    const camera = cameraRef.current;
    if (sources.size === 0 || !camera) return;

    const listener = camera.children[0] as THREE.AudioListener;

    switch (soundscapeState) {
      case 'playing':
        if (listener.context.state === 'suspended') {
          listener.context.resume().then(() => {
            sources.forEach(s => {
              if (s.buffer && !s.isPlaying) {
                s.play();
              }
            });
          });
        } else {
          sources.forEach(s => {
            if (s.buffer && !s.isPlaying) {
              s.play();
            }
          });
        }
        break;
      case 'paused':
        sources.forEach(s => {
          if (s.isPlaying) s.pause();
        });
        break;
      case 'stopped':
        sources.forEach(s => {
          if (s.isPlaying) s.stop();
        });
        break;
    }
  }, [soundscapeState]);

  // Control individual sound playback
  useEffect(() => {
    const sources = audioSourcesRef.current;
    const camera = cameraRef.current;
    if (sources.size === 0 || !camera) return;

    const listener = camera.children[0] as THREE.AudioListener;

    Object.entries(individualSoundStates).forEach(([soundId, state]) => {
      const audio = sources.get(soundId);
      if (!audio || !audio.buffer) return;

      switch (state) {
        case 'playing':
          if (listener.context.state === 'suspended') {
            listener.context.resume().then(() => {
              if (!audio.isPlaying) audio.play();
            });
          } else {
            if (!audio.isPlaying) audio.play();
          }
          break;
        case 'paused':
          if (audio.isPlaying) audio.pause();
          break;
        case 'stopped':
          if (audio.isPlaying) audio.stop();
          break;
      }
    });
  }, [individualSoundStates]);

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className={className} />

      {/* 3D UI Overlays */}
      <div className="absolute inset-0 pointer-events-none">
        {uiOverlays.map((overlay) => (
          <SoundUIOverlay
            key={overlay.promptKey}
            overlay={overlay}
            soundState={individualSoundStates[overlay.soundId] || 'stopped'}
            onToggleSound={onToggleSound}
            onVariantChange={onVariantChange}
          />
        ))}

        {/* Entity data overlay */}
        {entityOverlay && <EntityUIOverlay overlay={entityOverlay} />}
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, useMemo, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DragControls } from "three/examples/jsm/controls/DragControls.js";
import { SoundUIOverlay } from "@/components/overlays/SoundUIOverlay";
import { triangulate } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/constants";
import type { CompasGeometry, SoundEvent, SoundState, UIOverlay } from "@/types";

interface ThreeSceneProps {
  geometryData: CompasGeometry | null;
  soundscapeData: SoundEvent[] | null;
  soundscapeState: SoundState;
  individualSoundStates: {[key: string]: SoundState};
  selectedVariants: {[key: number]: number};
  onToggleSound: (soundId: string) => void;
  onVariantChange: (promptIdx: number, variantIdx: number) => void;
  scaleForSounds: number;
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
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

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRef.current = controls;

    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0xcccccc);
    scene.add(gridHelper);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    scene.add(directionalLight);

    const contentGroup = new THREE.Group();
    scene.add(contentGroup);
    contentGroupRef.current = contentGroup;

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

    return () => {
      resizeObserver.disconnect();
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
  }, []);

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
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: 0xF5E6D3,
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide
      }));
      mesh.userData.isGeometry = true;
      contentGroup.add(mesh);

      const box = new THREE.Box3().setFromObject(contentGroup);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = camera.fov * (Math.PI / 180);
      let cameraDistance = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
      cameraDistance *= 1.5;
      const angle = Math.PI / 4;
      camera.position.set(
        center.x + cameraDistance * Math.cos(angle),
        center.y + cameraDistance * Math.sin(angle),
        center.z + cameraDistance * 0.7
      );
      controls.target.copy(center);
      controls.update();
    }
  }, [triangulatedGeometry]);

  // Update soundscape when soundscapeData changes
  useEffect(() => {
    const scene = sceneRef.current;
    const contentGroup = contentGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !contentGroup || !camera || !controls) return;

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
      </div>
    </div>
  );
}

import * as THREE from "three";
import { triangulate } from "@/utils/utils";
import { API_BASE_URL, PRIMARY_COLOR_HEX, SOUND_SPHERE, DARK_MODE, OBJECT_LABEL } from "@/utils/constants";
import { createLabelSprite, disposeLabelSprite } from "@/lib/three/label-sprite-factory";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
// import { calculateSpiralPositions } from "@/lib/three/spiral-placement"; // Bounding-box placement removed
import { calculateCameraFrontSpiralPositions } from "@/lib/three/spiral-placement";
import { SPIRAL_PLACEMENT } from "@/utils/constants";
import type { SoundEvent } from "@/types";
import type { AuralizationConfig, SoundMetadata } from "@/types/audio";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import { trimDisplayName } from "@/utils/utils";
// import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager"; // Bounding-box placement removed

/**
 * Data shape expected by updateDraggableMeshes for sound spheres.
 * Extends the generic MeshData interface with sound-specific fields.
 */
interface SoundMeshData {
  id: string;
  position: [number, number, number];
  soundEvent: SoundEvent;
  promptKey: string;
}

/**
 * SoundSphereManager
 *
 * Manages sound sphere creation, updates, animations, and sound event visualization.
 *
 * Responsibilities:
 * - Sound sphere mesh creation and updates (via DraggableMeshManager utility)
 * - Spatial audio source management via AudioOrchestrator
 * - Sound variant switching
 * - Position tracking and persistence
 * - Resource cleanup
 *
 * Architecture:
 * - Uses DraggableMeshManager utility for efficient mesh updates (same as ReceiverManager)
 * - Audio source lifecycle is decoupled from mesh lifecycle
 * - Preserves mesh references for DragControls compatibility
 */
export class SoundSphereManager {
  private scene: THREE.Scene;
  private soundSpheresGroup: THREE.Group;
  private listener: THREE.AudioListener;

  // Audio Orchestrator integration
  private audioOrchestrator: AudioOrchestrator | null;

  // Sound sphere tracking — managed by updateDraggableMeshes utility
  private soundMeshes: THREE.Mesh[] = [];
  private draggableObjects: THREE.Object3D[] = [];

  // Position tracking — Map<soundId, [x, y, z]> for consistency with ReceiverManager
  private spherePositions: Map<string, [number, number, number]> = new Map();

  // Sound metadata tracking (replaces legacy PositionalAudio)
  private soundMetadata: Map<string, SoundMetadata> = new Map();
  // Track which sounds are entity-linked (for change detection in updateSounds)
  private entityLinkedIds: Set<string> = new Set();
  private audioLoader: THREE.AudioLoader;

  // Dark mode state
  private darkModeEnabled: boolean = false;
  private darkModePointLights: Map<string, THREE.PointLight> = new Map();

  // Cached scale for mesh factory (set before calling updateDraggableMeshes)
  private scaleForSounds: number = 1.0;

  // Camera-based spiral placement tracking
  private lastPlacementCenter: THREE.Vector3 | null = null;
  private soundsPlacedAtCenter: number = 0;

  // Label sprites — one per non-entity sound sphere, keyed by sound ID
  private labelSprites: Map<string, THREE.Sprite> = new Map();

  constructor(
    scene: THREE.Scene,
    listener: THREE.AudioListener,
    audioOrchestrator?: AudioOrchestrator | null,
    audioContext?: AudioContext | null,
    parentGroup?: THREE.Group
  ) {
    this.scene = scene;
    this.listener = listener;
    this.audioOrchestrator = audioOrchestrator || null;
    this.audioLoader = new THREE.AudioLoader();

    // Use provided parent group or create our own
    if (parentGroup) {
      this.soundSpheresGroup = parentGroup;
    } else {
      // Fallback: Create internal group for organization
      this.soundSpheresGroup = new THREE.Group();
      this.soundSpheresGroup.name = 'SoundSpheresGroup';
      this.soundSpheresGroup.layers.enableAll(); // Enable all layers for Speckle compatibility
      this.soundSpheresGroup.visible = true; // Force visibility
      this.scene.add(this.soundSpheresGroup);
    }

    if (!audioOrchestrator) {
      console.warn('[SoundSphereManager] Initialized without AudioOrchestrator - audio features will not work');
    }
  }

  /**
   * Set or update the audio orchestrator
   * Call this when the orchestrator becomes available
   */
  public setAudioOrchestrator(audioOrchestrator: AudioOrchestrator | null): void {
    this.audioOrchestrator = audioOrchestrator;
    if (audioOrchestrator) {
      console.log('[SoundSphereManager] AudioOrchestrator updated');
    }
  }

  /**
   * Update sound spheres based on soundscape data and selected variants
   *
   * Uses updateDraggableMeshes for efficient incremental mesh updates:
   * - Existing meshes are reused (preserving DragControls references)
   * - Only new meshes are created, only removed meshes are disposed
   * - Dragged meshes keep their position (isDragging guard)
   *
   * Audio sources are synced separately from mesh lifecycle.
   *
   * @param soundscapeData - Sound events to visualize
   * @param selectedVariants - Map of prompt index to variant index
   * @param scaleForSounds - Scale multiplier for sphere size
   * @param auralizationConfig - Auralization configuration
   * @param cameraFrontPosition - Camera-front position for placement (spiral anchor). Sounds without
   *   a saved backend position are placed here. Multiple sounds at the same camera position
   *   are spread in a spiral. Falls through to backend event position if unavailable.
   */
  public updateSoundSpheres(
    soundscapeData: SoundEvent[] | null,
    selectedVariants: { [key: number]: number },
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig,
    // bounds?: BoundingBoxBounds | null, // Bounding-box placement removed — camera-based only
    cameraFrontPosition?: THREE.Vector3 | null
  ): void {
    // Store scale for mesh factory
    this.scaleForSounds = scaleForSounds;

    // Handle empty case — clear everything
    if (!soundscapeData || soundscapeData.length === 0) {
      this.removeAllAudioSources();
      this.removeAllSoundMeshes();
      this.entityLinkedIds.clear();
      return;
    }

    // Compute visible sounds BEFORE any teardown to check if recreation is needed
    const soundsByPromptIndex: { [key: number]: SoundEvent[] } = {};
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

    // Check if the sound set has actually changed (different IDs or entity_index toggled).
    // If the same sounds are still visible with same entity linking state,
    // skip teardown to avoid interrupting playback.
    // Positions are already managed by updateSpherePosition during drag.
    const newSoundIds = new Set(visibleSounds.map(s => s.id));
    const newEntityLinkedIds = new Set(
      visibleSounds.filter(s => s.entity_index !== undefined).map(s => s.id)
    );
    if (
      this.soundMetadata.size > 0 &&
      newSoundIds.size === this.soundMetadata.size &&
      [...newSoundIds].every(id => this.soundMetadata.has(id)) &&
      // Also check entity_index hasn't changed (sphere visibility depends on it)
      newEntityLinkedIds.size === this.entityLinkedIds.size &&
      [...newEntityLinkedIds].every(id => this.entityLinkedIds.has(id))
    ) {
      // Sounds unchanged — still refresh mesh userData and sync labels in case display_name changed
      visibleSounds.forEach(soundEvent => {
        const mesh = this.soundMeshes.find(m => m.userData.soundEvent?.id === soundEvent.id);
        if (mesh) mesh.userData.soundEvent = soundEvent;

        // For entity-linked sounds, update the position in case the sound was re-linked
        // to a different Speckle object while the sound ID stayed the same.
        if (soundEvent.entity_index !== undefined && soundEvent.position) {
          const newPos = soundEvent.position as [number, number, number];
          const oldPos = this.spherePositions.get(soundEvent.id);
          const posChanged = !oldPos ||
            oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1] || oldPos[2] !== newPos[2];
          if (posChanged) {
            this.spherePositions.set(soundEvent.id, newPos);
            if (this.audioOrchestrator) {
              this.audioOrchestrator.updateSourcePosition(
                soundEvent.id,
                new THREE.Vector3(newPos[0], newPos[1], newPos[2])
              );
            }
          }
        }
      });
      this.syncLabelSprites(this.soundMeshes);
      return;
    }

    this.entityLinkedIds = newEntityLinkedIds;

    // Split visible sounds into mesh sounds (non-entity) and entity sounds
    const meshSounds = visibleSounds.filter(s => s.entity_index === undefined);
    const entitySounds = visibleSounds.filter(s => s.entity_index !== undefined);

    // Pre-populate spherePositions from soundEvent.position ONLY for previously-dragged sounds
    // restored from a saved soundscape. New sounds have position [0,0,0] and must go through
    // camera-front placement. Restored sounds have their drag position (non-zero) saved in Speckle.
    meshSounds.forEach(s => {
      if (!this.spherePositions.has(s.id) && s.position) {
        const pos = s.position as [number, number, number];
        const hasSavedPosition = pos.length === 3 && (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0);
        if (hasSavedPosition) {
          this.spherePositions.set(s.id, pos);
        }
      }
    });

    // Calculate spiral positions for non-entity-linked sounds that don't have stored positions.
    // Entity-linked sounds use their entity's position (set via linkSoundToEntity).
    const newMeshSounds = meshSounds.filter(s => !this.spherePositions.has(s.id));
    const hasNewMeshSounds = newMeshSounds.length > 0;

    let spiralPositionMap: Map<string, [number, number, number]> = new Map();
    if (cameraFrontPosition && hasNewMeshSounds) {
      // Camera-based placement: check if camera moved significantly
      const cameraMoved =
        !this.lastPlacementCenter ||
        cameraFrontPosition.distanceTo(this.lastPlacementCenter) > SPIRAL_PLACEMENT.CAMERA_MOVE_THRESHOLD;

      if (cameraMoved) {
        this.soundsPlacedAtCenter = 0;
        this.lastPlacementCenter = cameraFrontPosition.clone();
      } else if (newMeshSounds.length === meshSounds.length) {
        // All sounds are new (clean slate after deletion) — reset counter, keep center
        this.soundsPlacedAtCenter = 0;
      }

      const center = this.lastPlacementCenter!;
      const startIndex = this.soundsPlacedAtCenter;
      const allPositions = calculateCameraFrontSpiralPositions(center, startIndex + newMeshSounds.length);

      newMeshSounds.forEach((soundEvent, i) => {
        const pos = allPositions[startIndex + i];
        spiralPositionMap.set(soundEvent.id, [pos.x, pos.y, pos.z]);
      });

      this.soundsPlacedAtCenter += newMeshSounds.length;
    }
    // Bounding-box spiral fallback removed — camera-front is always the placement origin.
    // If cameraFrontPosition is unavailable, sounds fall through to their backend event position.
    // else if (bounds && hasNewMeshSounds) {
    //   const allSpiralPositions = calculateSpiralPositions(bounds, meshSounds.length);
    //   meshSounds.forEach((soundEvent, index) => {
    //     if (!this.spherePositions.has(soundEvent.id)) {
    //       const v = allSpiralPositions[index];
    //       spiralPositionMap.set(soundEvent.id, [v.x, v.y, v.z]);
    //     }
    //   });
    // }

    // Prepare mesh data with resolved positions (priority: stored > spiral > event position)
    const meshSoundData: SoundMeshData[] = meshSounds.map(soundEvent => {
      const promptIdx = (soundEvent as any).prompt_index ?? 0;
      const promptKey = `prompt_${promptIdx}`;

      let position: [number, number, number];

      const storedPosition = this.spherePositions.get(soundEvent.id);
      if (storedPosition) {
        // Use stored position (from previous drag) — preserves dragged positions
        position = storedPosition;
      } else {
        const spiralPosition = spiralPositionMap.get(soundEvent.id);
        if (spiralPosition) {
          // Use spiral position from bounding box placement (only for new sounds)
          position = spiralPosition;
          this.spherePositions.set(soundEvent.id, position);
        } else {
          // Use event position (from backend or default)
          position = soundEvent.position as [number, number, number];
          this.spherePositions.set(soundEvent.id, position);
        }
      }

      return { id: soundEvent.id, position, soundEvent, promptKey };
    });

    // Use updateDraggableMeshes for efficient incremental mesh updates
    const result = updateDraggableMeshes(
      this.soundSpheresGroup,
      this.soundMeshes,
      meshSoundData,
      (data) => this.createSoundSphereMesh(data),
      (mesh) => mesh.userData.soundEvent?.id || ''
    );

    this.soundMeshes = result.meshes;
    this.draggableObjects = result.draggableObjects;

    // Sync label sprites with the current mesh set
    this.syncLabelSprites(result.meshes);

    // Force group matrix update after mesh changes
    this.soundSpheresGroup.updateMatrixWorld(true);

    // Handle entity-linked sounds: store positions (no mesh)
    entitySounds.forEach(soundEvent => {
      // ALWAYS use soundEvent.position for entity-linked sounds — it contains
      // the entity's bounding box center (set by useSoundGeneration.linkSoundToEntity)
      this.spherePositions.set(soundEvent.id, soundEvent.position as [number, number, number]);
    });

    // Sync audio sources: create new, remove stale
    this.syncAudioSources(visibleSounds);
  }

  /**
   * Sync audio sources with the current set of visible sounds.
   * Creates audio sources for new sounds, removes sources for sounds no longer visible.
   * Also cleans up stale spherePositions entries to prevent unbounded growth.
   * Audio lifecycle is decoupled from mesh lifecycle.
   */
  private syncAudioSources(visibleSounds: SoundEvent[]): void {
    const visibleSoundIds = new Set(visibleSounds.map(s => s.id));

    // Remove audio sources and stale positions for sounds no longer visible
    for (const [soundId] of this.soundMetadata) {
      if (!visibleSoundIds.has(soundId)) {
        if (this.audioOrchestrator) {
          this.audioOrchestrator.removeSource(soundId);
        }
        this.soundMetadata.delete(soundId);
        this.spherePositions.delete(soundId);
      }
    }

    // Create audio sources for new sounds (not already in metadata)
    visibleSounds.forEach(soundEvent => {
      if (this.soundMetadata.has(soundEvent.id)) {
        return; // Audio already loaded for this sound
      }

      this.loadAudioForSound(soundEvent);
    });
  }

  /**
   * Load audio buffer and create an audio source for a single sound event.
   * Called by syncAudioSources for new sounds only.
   */
  private loadAudioForSound(soundEvent: SoundEvent): void {
    const audioPosition = this.spherePositions.get(soundEvent.id);
    if (!audioPosition) {
      console.warn(`[SoundSphereManager] No position for sound ${soundEvent.id}, skipping audio load`);
      return;
    }

    const isEntityLinked = soundEvent.entity_index !== undefined;

    // Determine full URL (blob for uploads, backend for generated)
    const isUploadedSound = soundEvent.url.startsWith('blob:') || soundEvent.url.startsWith('http');
    const fullUrl = isUploadedSound ? soundEvent.url : `${API_BASE_URL}${soundEvent.url}`;

    // Load audio buffer and create source
    this.audioLoader.load(
      fullUrl,
      (buffer) => {
        // For sphere-linked sounds, check if sphere still exists
        if (!isEntityLinked) {
          const meshStillExists = this.soundMeshes.some(
            m => m.userData.soundEvent?.id === soundEvent.id
          );
          if (!meshStillExists) {
            console.warn(`[SoundSphereManager] Sphere removed before audio loaded: ${soundEvent.id}`);
            return;
          }
        }

        // Create source via orchestrator
        const posVec = new THREE.Vector3(...audioPosition);
        if (this.audioOrchestrator) {
          this.audioOrchestrator.createSource(
            soundEvent.id,
            buffer,
            posVec
          );
        } else {
          console.warn('[SoundSphereManager] Cannot create audio source - AudioOrchestrator not available');
        }

        // Create lightweight metadata for scheduler tracking
        const metadata: SoundMetadata = {
          soundId: soundEvent.id,
          buffer: buffer,
          position: { x: audioPosition[0], y: audioPosition[1], z: audioPosition[2] },
          soundEvent: {
            id: soundEvent.id,
            display_name: soundEvent.display_name || soundEvent.id,
            color: (soundEvent as any).color,
            prompt_index: (soundEvent as any).prompt_index,
            url: soundEvent.url,
            isUploaded: soundEvent.isUploaded,
            interval_seconds: soundEvent.interval_seconds
          }
        };

        this.soundMetadata.set(soundEvent.id, metadata);
      },
      undefined,
      (error) => {
        console.error('[SoundSphereManager] Error loading audio:', error);
      }
    );
  }

  /** Remove all audio sources from orchestrator and clear metadata */
  private removeAllAudioSources(): void {
    this.soundMetadata.forEach((_, soundId) => {
      if (this.audioOrchestrator) {
        this.audioOrchestrator.removeSource(soundId);
      }
    });
    this.soundMetadata.clear();
  }

  /** Remove all sound sphere meshes and their label sprites */
  private removeAllSoundMeshes(): void {
    disposeMeshes(this.soundSpheresGroup, this.soundMeshes);
    this.soundMeshes = [];
    this.draggableObjects = [];
    this.labelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.labelSprites.clear();
  }

  /**
   * Create a single sound sphere mesh (visual only, no audio).
   * Used as the mesh factory for updateDraggableMeshes.
   *
   * Note: Scene.add() is handled by updateDraggableMeshes utility.
   * This factory only creates the mesh.
   *
   * @param data - Sound mesh data with position, soundEvent, and promptKey
   * @returns Configured THREE.Mesh ready for scene insertion
   */
  private createSoundSphereMesh(data: SoundMeshData): THREE.Mesh {
    const { soundEvent, promptKey } = data;

    // Create sphere geometry (custom or standard sphere)
    let sphereGeom: THREE.BufferGeometry;
    if (soundEvent.geometry.vertices.length > 0) {
      sphereGeom = new THREE.BufferGeometry();
      const positions = new Float32Array(soundEvent.geometry.vertices.flat());
      const indices = triangulate(soundEvent.geometry.faces);
      sphereGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      sphereGeom.setIndex(indices);
      sphereGeom.computeVertexNormals();
    } else {
      const sphereRadius = 0.3 * this.scaleForSounds;
      sphereGeom = new THREE.SphereGeometry(sphereRadius, 32, 32);
    }

    // Use electric blue color when dark mode is active, otherwise primary pink
    const sphereColor = this.darkModeEnabled ? DARK_MODE.LIGHT_COLOR_HEX : PRIMARY_COLOR_HEX;

    const material = new THREE.MeshBasicMaterial({
      color: sphereColor,
      transparent: true,
      opacity: 0.7,
      fog: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide
    });

    // Create sphere mesh
    const sphereMesh = new THREE.Mesh(sphereGeom, material);
    sphereMesh.renderOrder = SOUND_SPHERE.RENDER_ORDER;

    // Set specific layers for Speckle compatibility
    // Use OVERLAY layer (4) to avoid problematic render passes
    sphereMesh.layers.enable(4);
    sphereMesh.visible = true;

    // Position from data (already resolved: stored > spiral > event)
    sphereMesh.position.fromArray(data.position);

    // Store metadata for drag handler and event bridge
    sphereMesh.userData.speckleType = 'SoundSphere';
    sphereMesh.userData.soundEvent = soundEvent;
    sphereMesh.userData.promptKey = promptKey;
    sphereMesh.userData.positionKey = soundEvent.id;
    sphereMesh.userData.customObjectType = 'sound'; // CRITICAL: Required for drag handler and event bridge

    // Force matrix update
    sphereMesh.updateMatrix();

    // If dark mode is active, add a point light to the new sphere
    if (this.darkModeEnabled) {
      this.addPointLightToMesh(sphereMesh);
    }

    console.log(`[SoundSphereManager] Created sound sphere: ${promptKey}`);

    // Note: Scene.add() is handled by updateDraggableMeshes utility
    return sphereMesh;
  }

  /**
   * Update sphere positions (called during drag)
   * Accepts promptKey for backward compatibility with drag handlers
   * Stores position using positionKey (sound ID) for consistency
   */
  public updateSpherePosition(promptKey: string, position: THREE.Vector3): void {
    // Find sphere by promptKey (how drag handlers identify spheres)
    const sphere = this.soundMeshes.find(obj => obj.userData.promptKey === promptKey);
    if (sphere) {
      sphere.position.copy(position);

      // Use positionKey (sound ID) for storage - this is the new stable key
      const positionKey = sphere.userData.positionKey || sphere.userData.soundEvent?.id || promptKey;
      this.spherePositions.set(positionKey, [position.x, position.y, position.z]);

      // Update the audio source position if it exists
      const soundEvent = sphere.userData.soundEvent;
      if (soundEvent) {
        const soundId = soundEvent.id;
        const metadata = this.soundMetadata.get(soundId);
        if (metadata) {
          // Update metadata position
          metadata.position = { x: position.x, y: position.y, z: position.z };

          // Update orchestrator position
          if (this.audioOrchestrator) {
            this.audioOrchestrator.updateSourcePosition(soundId, position);
          }
        }
      }
    } else {
      // Fallback: store by promptKey if sphere not found (shouldn't happen)
      this.spherePositions.set(promptKey, [position.x, position.y, position.z]);
    }
  }

  /**
   * Get all draggable sound sphere objects
   */
  public getDraggableObjects(): THREE.Object3D[] {
    return this.draggableObjects;
  }

  /**
   * Get all sound sphere meshes (for raycasting/click detection)
   */
  public getSoundSphereMeshes(): THREE.Mesh[] {
    return this.soundMeshes;
  }

  /**
   * Get all current sphere positions
   */
  public getAllSpherePositions(): Array<[number, number, number]> {
    return Array.from(this.spherePositions.values());
  }

  /**
   * Get sound metadata by sound ID
   */
  public getAudioSource(soundId: string): SoundMetadata | undefined {
    return this.soundMetadata.get(soundId);
  }

  /**
   * Get all sound metadata
   */
  public getAllAudioSources(): Map<string, SoundMetadata> {
    return this.soundMetadata;
  }


  // ============================================================================
  // Screen-Space Sizing + Labels
  // ============================================================================

  /**
   * Sync label sprites with the current set of sound sphere meshes.
   * Creates labels for new meshes, removes labels for deleted meshes,
   * and recreates labels if the display_name changed.
   */
  private syncLabelSprites(meshes: THREE.Mesh[]): void {
    const currentIds = new Set(
      meshes.map(m => m.userData.soundEvent?.id as string).filter(Boolean)
    );

    // Remove labels for sounds that no longer have a mesh
    for (const [id, sprite] of this.labelSprites) {
      if (!currentIds.has(id)) {
        this.soundSpheresGroup.remove(sprite);
        disposeLabelSprite(sprite);
        this.labelSprites.delete(id);
      }
    }

    // Create (or recreate on name change) labels for current meshes
    for (const mesh of meshes) {
      const id = mesh.userData.soundEvent?.id as string;
      if (!id) continue;

      const text = trimDisplayName((mesh.userData.soundEvent?.display_name as string)) || id;
      const existing = this.labelSprites.get(id);

      if (existing) {
        if (existing.userData.labelText === text) continue; // up-to-date
        // Name changed — dispose and recreate
        this.soundSpheresGroup.remove(existing);
        disposeLabelSprite(existing);
        this.labelSprites.delete(id);
      }

      const sprite = createLabelSprite(text);
      sprite.position.copy(mesh.position);
      this.soundSpheresGroup.add(sprite);
      this.labelSprites.set(id, sprite);
    }
  }

  /**
   * Update mesh scales and label positions every frame so objects appear
   * at a constant screen size regardless of camera distance (zoom).
   *
   * Called by SpeckleAudioCoordinator's per-frame callback.
   */
  public updateScreenSpaceScale(camera: THREE.PerspectiveCamera): void {
    const baseRadius = SOUND_SPHERE.RADIUS_MULTIPLIER * this.scaleForSounds;

    this.soundMeshes.forEach(mesh => {
      const distance = camera.position.distanceTo(mesh.position);
      if (distance < 0.01) return;

      // Scale mesh so world radius = distance × SCREEN_SPACE_SIZE, clamped to min/max
      const rawScale = (distance * SOUND_SPHERE.SCREEN_SPACE_SIZE) / baseRadius;
      const scale = Math.max(SOUND_SPHERE.MIN_SCALE, Math.min(SOUND_SPHERE.MAX_SCALE, rawScale));
      mesh.scale.setScalar(scale);

      // Position and scale the corresponding label sprite (use same clamped ratio)
      const soundId = mesh.userData.soundEvent?.id as string;
      const label = soundId ? this.labelSprites.get(soundId) : null;
      if (label) {
        const clampRatio = scale / rawScale;
        const zOffset = distance * SOUND_SPHERE.SCREEN_SPACE_SIZE * OBJECT_LABEL.Z_OFFSET_FACTOR * clampRatio;
        label.position.set(mesh.position.x, mesh.position.y, mesh.position.z + zOffset);
        const h = distance * OBJECT_LABEL.SCREEN_SPACE_HEIGHT * clampRatio;
        label.scale.set(h * (label.userData.aspectRatio as number || 3), h, 1);
      }
    });
  }

  /**
   * Find sound sphere by prompt key
   */
  public findSphereByPromptKey(promptKey: string): THREE.Object3D | undefined {
    return this.soundMeshes.find(obj => obj.userData.promptKey === promptKey);
  }

  /**
   * Re-register all audio sources with the orchestrator
   * Called when audio mode switches to ensure sources exist in the new mode
   */
  public reregisterAllSources(): void {
    if (!this.audioOrchestrator) {
      console.warn('[SoundSphereManager] Cannot re-register sources - AudioOrchestrator not available');
      return;
    }

    let registeredCount = 0;
    this.soundMetadata.forEach((metadata, soundId) => {
      if (!metadata.buffer) {
        console.warn(`[SoundSphereManager] Cannot re-register ${soundId}: No buffer`);
        return;
      }

      const position = new THREE.Vector3(
        metadata.position.x,
        metadata.position.y,
        metadata.position.z
      );

      try {
        this.audioOrchestrator!.createSource(soundId, metadata.buffer, position);
        registeredCount++;
      } catch (error) {
        console.error(`[SoundSphereManager] Failed to re-register ${soundId}:`, error);
      }
    });

    console.log(`[SoundSphereManager] Re-registered ${registeredCount}/${this.soundMetadata.size} sources`);
  }

  // ============================================================================
  // Dark Mode - Point Light Management
  // ============================================================================

  /**
   * Enable dark mode on all sound spheres.
   * Changes sphere material color to electric blue and adds a PointLight child.
   */
  public enableDarkMode(): void {
    this.darkModeEnabled = true;

    this.soundMeshes.forEach(mesh => {
      // Change sphere color to electric blue and make opaque
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.setHex(DARK_MODE.LIGHT_COLOR_HEX);
      material.transparent = false;
      material.opacity = 1;
      material.needsUpdate = true;

      // Add point light as child (follows mesh during drag)
      this.addPointLightToMesh(mesh);
    });

    console.log(`[SoundSphereManager] Dark mode enabled on ${this.soundMeshes.length} spheres`);
  }

  /**
   * Disable dark mode: restore sphere colors and remove point lights.
   */
  public disableDarkMode(): void {
    this.darkModeEnabled = false;

    // Remove all point lights
    this.darkModePointLights.forEach((light) => {
      light.parent?.remove(light);
      light.dispose();
    });
    this.darkModePointLights.clear();

    // Restore sphere colors to primary pink and transparency
    this.soundMeshes.forEach(mesh => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.color.setHex(PRIMARY_COLOR_HEX);
      material.transparent = true;
      material.opacity = 0.7;
      material.needsUpdate = true;
    });

    console.log('[SoundSphereManager] Dark mode disabled');
  }

  /** Add a point light as a child of a sound sphere mesh */
  private addPointLightToMesh(mesh: THREE.Mesh): void {
    const soundId = mesh.userData.soundEvent?.id;
    if (!soundId || this.darkModePointLights.has(soundId)) return;

    const light = new THREE.PointLight(
      DARK_MODE.LIGHT_COLOR_HEX,
      DARK_MODE.POINT_LIGHT_INTENSITY,
      DARK_MODE.POINT_LIGHT_DISTANCE,
      DARK_MODE.POINT_LIGHT_DECAY
    );
    light.name = `DarkModeLight_${soundId}`;
    light.layers.enableAll();

    // Enable shadow casting so geometry blocks the light
    light.castShadow = true;
    light.shadow.mapSize.width = DARK_MODE.SHADOW_MAP_SIZE;
    light.shadow.mapSize.height = DARK_MODE.SHADOW_MAP_SIZE;
    light.shadow.camera.near = DARK_MODE.SHADOW_CAMERA_NEAR;
    light.shadow.camera.far = DARK_MODE.POINT_LIGHT_DISTANCE;
    light.shadow.bias = DARK_MODE.SHADOW_BIAS;

    mesh.add(light);
    this.darkModePointLights.set(soundId, light);
  }

  /**
   * Get positions of all entity-linked sounds (for external point light placement).
   */
  public getEntityLinkedSoundPositions(): Array<{ id: string; position: [number, number, number] }> {
    const result: Array<{ id: string; position: [number, number, number] }> = [];
    for (const soundId of this.entityLinkedIds) {
      const pos = this.spherePositions.get(soundId);
      if (pos) {
        result.push({ id: soundId, position: pos });
      }
    }
    return result;
  }

  /**
   * Re-enforce dark mode colors on all sound spheres.
   * Called by the enforcement interval to guard against external material resets
   * (e.g. Speckle render passes during drag operations).
   */
  public enforceDarkModeColors(): void {
    if (!this.darkModeEnabled) return;
    this.soundMeshes.forEach(mesh => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      if (material.color.getHex() !== DARK_MODE.LIGHT_COLOR_HEX) {
        material.color.setHex(DARK_MODE.LIGHT_COLOR_HEX);
        material.needsUpdate = true;
      }
      // Also enforce opaque state
      if (material.transparent) {
        material.transparent = false;
        material.opacity = 1;
        material.needsUpdate = true;
      }
    });
  }

  /** Whether dark mode is currently enabled */
  public isDarkMode(): boolean {
    return this.darkModeEnabled;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Remove all sources from AudioOrchestrator
    this.removeAllAudioSources();

    // Remove and dispose all sound meshes using utility
    disposeMeshes(this.soundSpheresGroup, this.soundMeshes);
    this.soundMeshes = [];
    this.draggableObjects = [];

    // Dispose all label sprites
    this.labelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.labelSprites.clear();

    // Remove sound spheres group from scene
    this.scene.remove(this.soundSpheresGroup);

    // Clear tracking
    this.spherePositions.clear();
    this.entityLinkedIds.clear();
  }
}

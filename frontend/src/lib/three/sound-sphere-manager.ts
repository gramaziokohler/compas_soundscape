import * as THREE from "three";
import { triangulate } from "@/utils/utils";
import { API_BASE_URL, PRIMARY_COLOR_HEX, SOUND_SPHERE } from "@/utils/constants";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
import { calculateSpiralPositions } from "@/lib/three/spiral-placement";
import type { SoundEvent } from "@/types";
import type { AuralizationConfig, SoundMetadata } from "@/types/audio";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager";

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

  // Cached scale for mesh factory (set before calling updateDraggableMeshes)
  private scaleForSounds: number = 1.0;

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
   * @param bounds - Optional bounding box bounds for spiral placement
   */
  public updateSoundSpheres(
    soundscapeData: SoundEvent[] | null,
    selectedVariants: { [key: number]: number },
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig,
    bounds?: BoundingBoxBounds | null
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
      return;
    }

    this.entityLinkedIds = newEntityLinkedIds;

    // Split visible sounds into mesh sounds (non-entity) and entity sounds
    const meshSounds = visibleSounds.filter(s => s.entity_index === undefined);
    const entitySounds = visibleSounds.filter(s => s.entity_index !== undefined);

    // Calculate spiral positions for non-entity-linked sounds that don't have stored positions.
    // Entity-linked sounds use their entity's position (set via linkSoundToEntity).
    const hasNewMeshSounds = meshSounds.some(s => !this.spherePositions.has(s.id));

    let spiralPositionMap: Map<string, [number, number, number]> = new Map();
    if (bounds && hasNewMeshSounds) {
      // Calculate spiral for all non-entity sounds to maintain consistent pattern
      const allSpiralPositions = calculateSpiralPositions(bounds, meshSounds.length);
      meshSounds.forEach((soundEvent, index) => {
        if (!this.spherePositions.has(soundEvent.id)) {
          const v = allSpiralPositions[index];
          spiralPositionMap.set(soundEvent.id, [v.x, v.y, v.z]);
        }
      });
    }

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
   * Audio lifecycle is decoupled from mesh lifecycle.
   */
  private syncAudioSources(visibleSounds: SoundEvent[]): void {
    const visibleSoundIds = new Set(visibleSounds.map(s => s.id));

    // Remove audio sources for sounds no longer visible
    for (const [soundId] of this.soundMetadata) {
      if (!visibleSoundIds.has(soundId)) {
        if (this.audioOrchestrator) {
          this.audioOrchestrator.removeSource(soundId);
        }
        this.soundMetadata.delete(soundId);
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

  /** Remove all sound sphere meshes using disposeMeshes utility */
  private removeAllSoundMeshes(): void {
    disposeMeshes(this.soundSpheresGroup, this.soundMeshes);
    this.soundMeshes = [];
    this.draggableObjects = [];
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

    const material = new THREE.MeshBasicMaterial({
      color: PRIMARY_COLOR_HEX,
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

    // Remove sound spheres group from scene
    this.scene.remove(this.soundSpheresGroup);

    // Clear tracking
    this.spherePositions.clear();
    this.entityLinkedIds.clear();
  }
}

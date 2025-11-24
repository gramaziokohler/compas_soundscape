import * as THREE from "three";
import { triangulate } from "@/lib/utils";
import { API_BASE_URL, PRIMARY_COLOR_HEX, SOUND_SPHERE } from "@/lib/constants";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import type { SoundEvent } from "@/types";
import type { AuralizationConfig, SoundMetadata } from "@/types/audio";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";

/**
 * SoundSphereManager
 *
 * Manages sound sphere creation, updates, animations, and sound event visualization.
 *
 * Responsibilities:
 * - Sound sphere mesh creation and updates
 * - Spatial audio source management via AudioOrchestrator
 * - Sound variant switching
 * - Position tracking and persistence
 * - Resource cleanup
 */
export class SoundSphereManager {
  private contentGroup: THREE.Group;
  private listener: THREE.AudioListener;

  // Audio Orchestrator integration
  private audioOrchestrator: AudioOrchestrator | null;

  // Sound sphere tracking
  private draggableObjects: THREE.Object3D[] = [];
  private spherePositions: { [key: string]: THREE.Vector3 } = {};

  // Sound metadata tracking (replaces legacy PositionalAudio)
  private soundMetadata: Map<string, SoundMetadata> = new Map();
  private audioLoader: THREE.AudioLoader;

  constructor(
    contentGroup: THREE.Group,
    listener: THREE.AudioListener,
    audioOrchestrator?: AudioOrchestrator | null,
    audioContext?: AudioContext | null
  ) {
    this.contentGroup = contentGroup;
    this.listener = listener;
    this.audioOrchestrator = audioOrchestrator || null;
    this.audioLoader = new THREE.AudioLoader();

    if (audioOrchestrator) {
      console.log('[SoundSphereManager] Initialized with AudioOrchestrator');
    } else {
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
   */
  public updateSoundSpheres(
    soundscapeData: SoundEvent[] | null,
    selectedVariants: { [key: number]: number },
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig
  ): void {
    // Remove existing sources from AudioOrchestrator
    this.soundMetadata.forEach((metadata, soundId) => {
      const displayName = metadata.soundEvent.display_name || soundId;
      console.log(`[SoundSphereManager] Removing audio source: ${displayName}`);

      if (this.audioOrchestrator) {
        this.audioOrchestrator.removeSource(soundId);
      }
    });
    this.soundMetadata.clear();

    this.draggableObjects = [];

    // Remove existing sound meshes from content group
    const soundMeshes = this.contentGroup.children.filter(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry !== true
    );
    soundMeshes.forEach(mesh => {
      disposeMesh(mesh as THREE.Mesh);
      this.contentGroup.remove(mesh);
    });

    if (!soundscapeData || soundscapeData.length === 0) return;

    // Group sounds by prompt index
    const soundsByPromptIndex: { [key: number]: SoundEvent[] } = {};
    soundscapeData.forEach(sound => {
      const promptIdx = (sound as any).prompt_index ?? 0;
      if (!soundsByPromptIndex[promptIdx]) {
        soundsByPromptIndex[promptIdx] = [];
      }
      soundsByPromptIndex[promptIdx].push(sound);
    });

    // Select visible sounds based on variant selection
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

    // Create sound spheres and audio sources
    visibleSounds.forEach(soundEvent => {
      this.createSoundSphere(soundEvent, scaleForSounds, auralizationConfig);
    });
  }

  /**
   * Create a single sound sphere with audio source
   * If the sound is entity-linked (has entity_index), only creates the audio source without a visible sphere
   */
  private createSoundSphere(
    soundEvent: SoundEvent,
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig
  ): void {
    const isEntityLinked = soundEvent.entity_index !== undefined;
    const promptIdx = (soundEvent as any).prompt_index ?? 0;
    const promptKey = `prompt_${promptIdx}`;

    let sphereMesh: THREE.Mesh | null = null;

    // Only create visual sphere if NOT entity-linked
    if (!isEntityLinked) {
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
        const sphereRadius = 0.3 * scaleForSounds;
        sphereGeom = new THREE.SphereGeometry(sphereRadius, 32, 32);
      }

      // Create sphere material
      const material = new THREE.MeshStandardMaterial({
        color: PRIMARY_COLOR_HEX,
        emissive: PRIMARY_COLOR_HEX,
        emissiveIntensity: SOUND_SPHERE.EMISSIVE_INTENSITY,
        roughness: SOUND_SPHERE.ROUGHNESS,
        metalness: SOUND_SPHERE.METALNESS,
        opacity: SOUND_SPHERE.OPACITY,
        transparent: SOUND_SPHERE.TRANSPARENT,
      });

      // Create sphere mesh
      sphereMesh = new THREE.Mesh(sphereGeom, material);

      // Position the sphere (use stored position or event position)
      if (this.spherePositions[promptKey]) {
        sphereMesh.position.copy(this.spherePositions[promptKey]);
      } else {
        sphereMesh.position.fromArray(soundEvent.position);
        this.spherePositions[promptKey] = sphereMesh.position.clone();
      }

      // Store metadata
      sphereMesh.userData.soundEvent = soundEvent;
      sphereMesh.userData.promptKey = promptKey;

      // Add to scene and draggable objects
      this.contentGroup.add(sphereMesh);
      this.draggableObjects.push(sphereMesh);
    } else {
      // Entity-linked sound: Store position for audio source but don't create sphere
      // Position is always at the entity center (from backend)
      this.spherePositions[promptKey] = new THREE.Vector3().fromArray(soundEvent.position);
    }

    // Load audio and create source via AudioOrchestrator
    const audioPosition = this.spherePositions[promptKey];

    // Determine full URL (blob for uploads, backend for generated)
    const isUploadedSound = soundEvent.url.startsWith('blob:') || soundEvent.url.startsWith('http');
    const fullUrl = isUploadedSound ? soundEvent.url : `${API_BASE_URL}${soundEvent.url}`;

    // Load audio buffer and create source
    this.audioLoader.load(
      fullUrl,
      (buffer) => {
        // For entity-linked sounds, check if audio context is still valid
        // For sphere-linked sounds, check if sphere still exists
        if (!isEntityLinked && sphereMesh && !sphereMesh.parent) {
          console.warn(`[SoundSphereManager] Sphere removed before audio loaded: ${soundEvent.id}`);
          return;
        }

        // Create source via orchestrator
        if (this.audioOrchestrator) {
          this.audioOrchestrator.createSource(
            soundEvent.id,
            buffer,
            audioPosition
          );
        } else {
          console.warn('[SoundSphereManager] Cannot create audio source - AudioOrchestrator not available');
        }

        // Create lightweight metadata for scheduler tracking
        const metadata: SoundMetadata = {
          soundId: soundEvent.id,
          buffer: buffer,
          position: { x: audioPosition.x, y: audioPosition.y, z: audioPosition.z },
          soundEvent: {
            id: soundEvent.id,
            display_name: soundEvent.display_name || soundEvent.id, // Fallback to ID if no display name
            color: (soundEvent as any).color, // Color is added dynamically during processing
            prompt_index: (soundEvent as any).prompt_index,
            url: soundEvent.url, // CRITICAL: Needed for timeline waveform visualization
            isUploaded: soundEvent.isUploaded, // Needed for timeline color coding
            interval_seconds: soundEvent.interval_seconds // Needed for playback scheduling
          }
        };

        this.soundMetadata.set(soundEvent.id, metadata);

        console.log(`[SoundSphereManager] Created audio source: ${soundEvent.display_name}`);
      },
      undefined,
      (error) => {
        console.error('[SoundSphereManager] Error loading audio:', error);
      }
    );
  }

  /**
   * Update sphere positions (called during drag)
   */
  public updateSpherePosition(promptKey: string, position: THREE.Vector3): void {
    this.spherePositions[promptKey] = position.clone();

    // Also update the actual mesh position immediately
    const sphere = this.draggableObjects.find(obj => obj.userData.promptKey === promptKey);
    if (sphere) {
      sphere.position.copy(position);

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
    return this.draggableObjects.filter(obj => obj instanceof THREE.Mesh) as THREE.Mesh[];
  }

  /**
   * Get all current sphere positions
   */
  public getAllSpherePositions(): Array<[number, number, number]> {
    return Object.values(this.spherePositions).map(pos => [pos.x, pos.y, pos.z]);
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
    return this.draggableObjects.find(obj => obj.userData.promptKey === promptKey);
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
    if (this.audioOrchestrator) {
      this.soundMetadata.forEach((metadata, soundId) => {
        this.audioOrchestrator!.removeSource(soundId);
      });
    }
    this.soundMetadata.clear();

    // Remove and dispose all sound meshes
    const soundMeshes = this.contentGroup.children.filter(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry !== true
    );
    soundMeshes.forEach(mesh => {
      disposeMesh(mesh as THREE.Mesh);
      this.contentGroup.remove(mesh);
    });

    // Clear tracking
    this.draggableObjects = [];
    this.spherePositions = {};
  }
}

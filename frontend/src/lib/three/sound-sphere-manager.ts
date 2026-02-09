import * as THREE from "three";
import { SpeckleBasicMaterial } from "@speckle/viewer";
import { triangulate } from "@/lib/utils";
import { API_BASE_URL, PRIMARY_COLOR_HEX, SOUND_SPHERE, RESONANCE_AUDIO } from "@/lib/constants";
import { disposeMesh } from "@/lib/three/mesh-cleanup";
import { calculateSpiralPositions } from "@/lib/three/spiral-placement";
import type { SoundEvent } from "@/types";
import type { AuralizationConfig, SoundMetadata } from "@/types/audio";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import type { BoundingBoxBounds } from "@/lib/three/BoundingBoxManager";

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
  private scene: THREE.Scene;
  private soundSpheresGroup: THREE.Group;
  private listener: THREE.AudioListener;

  // Audio Orchestrator integration
  private audioOrchestrator: AudioOrchestrator | null;

  // Sound sphere tracking
  private draggableObjects: THREE.Object3D[] = [];
  private spherePositions: { [key: string]: THREE.Vector3 } = {};

  // Sound metadata tracking (replaces legacy PositionalAudio)
  private soundMetadata: Map<string, SoundMetadata> = new Map();
  // Track which sounds are entity-linked (for change detection in updateSounds)
  private entityLinkedIds: Set<string> = new Set();
  private audioLoader: THREE.AudioLoader;

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

    // Sound set or entity linking state changed — full teardown and recreation
    this.removeAllAudioSources();
    this.removeAllSoundMeshes();
    this.entityLinkedIds = newEntityLinkedIds;

    // Calculate spiral positions ONLY for sounds that don't already have stored positions
    const hasExplicitPositions = visibleSounds.some(s => s.entity_index !== undefined);
    const hasNewSounds = visibleSounds.some(s => !this.spherePositions[s.id] && s.entity_index === undefined);

    let spiralPositionMap: Map<string, THREE.Vector3> = new Map();
    if (bounds && !hasExplicitPositions && hasNewSounds) {
      const allSpiralPositions = calculateSpiralPositions(bounds, visibleSounds.length);
      visibleSounds.forEach((soundEvent, index) => {
        if (!this.spherePositions[soundEvent.id] && soundEvent.entity_index === undefined) {
          spiralPositionMap.set(soundEvent.id, allSpiralPositions[index]);
        }
      });
    }

    // Create sound spheres and audio sources
    visibleSounds.forEach((soundEvent, index) => {
      const spiralPosition = spiralPositionMap.get(soundEvent.id) || null;
      this.createSoundSphere(soundEvent, scaleForSounds, auralizationConfig, spiralPosition);
    });
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

  /** Remove all sound sphere meshes (not receivers or other custom objects) */
  private removeAllSoundMeshes(): void {
    this.draggableObjects = [];
    const soundMeshes = this.soundSpheresGroup.children.filter(child =>
      child instanceof THREE.Mesh &&
      child.userData.isGeometry !== true &&
      child.userData.customObjectType === 'sound'
    );
    soundMeshes.forEach(mesh => {
      disposeMesh(mesh as THREE.Mesh);
      this.soundSpheresGroup.remove(mesh);
    });
  }

  /**
   * Create a single sound sphere with audio source
   * If the sound is entity-linked (has entity_index), only creates the audio source without a visible sphere
   * 
   * @param soundEvent - Sound event data
   * @param scaleForSounds - Scale multiplier for sphere size
   * @param auralizationConfig - Auralization configuration
   * @param spiralPosition - Optional position from spiral placement (overrides default position)
   */
  private createSoundSphere(
    soundEvent: SoundEvent,
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig,
    spiralPosition?: THREE.Vector3 | null
  ): void {
    const isEntityLinked = soundEvent.entity_index !== undefined;
    const promptIdx = (soundEvent as any).prompt_index ?? 0;
    const promptKey = `prompt_${promptIdx}`;
    // Use sound ID as stable position key (IDs don't change when new sounds are added)
    const positionKey = soundEvent.id;

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

      // // Create sphere material using Speckle's material system
      // const material = new SpeckleBasicMaterial({
      //   color: PRIMARY_COLOR_HEX, // Bright red for visibility testing
      //   transparent: true,
      //   opacity: 0.7,
      //   fog: true,
      //   depthWrite: true,
      //   depthTest: true,
      //   side: THREE.FrontSide,
      //   metalness: 0.2,           
      //   roughness: 0.3,           
      //   emissive: PRIMARY_COLOR_HEX
      // });

      const material = new THREE.MeshBasicMaterial({
        color: PRIMARY_COLOR_HEX,
        transparent: true,
        opacity: 0.7,
        fog: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.FrontSide
      });


      // Configure material to skip problematic MRT render passes
      // This prevents WebGL errors about missing fragment shader outputs
      // const originalOnBeforeRender = material.onBeforeRender.bind(material);
      // material.onBeforeRender = (renderer: any, scene: any, camera: any, geometry: any, object: any) => {
      //   // Skip rendering in depth-normal or multi-target passes
      //   const renderTarget = renderer.getRenderTarget();
      //   if (renderTarget && renderTarget.texture && Array.isArray(renderTarget.texture)) {
      //     // Multiple render targets detected - skip to avoid shader output mismatch
      //     return;
      //   }
      //   // Call original onBeforeRender for normal passes
      //   if (originalOnBeforeRender) {
      //     originalOnBeforeRender(renderer, scene, camera, geometry, object);
      //   }
      // };

      // Create sphere mesh
      sphereMesh = new THREE.Mesh(sphereGeom, material);
      sphereMesh.renderOrder = SOUND_SPHERE.RENDER_ORDER;

      // Set specific layers for Speckle compatibility
      // Use OVERLAY layer (4) to avoid problematic render passes that expect specific shader outputs
      // sphereMesh.layers.disableAll();
      // sphereMesh.layers.enable(0); // Default layer for basic rendering
      sphereMesh.layers.enable(4); // OVERLAY layer for custom objects

      // sphereMesh.frustumCulled = false; // Disable frustum culling for debugging
      sphereMesh.visible = true; // Force visibility

      // Store Speckle-specific metadata
      sphereMesh.userData.speckleType = 'SoundSphere'; // Mark as custom Speckle object

      // Position the sphere (priority: spiral > stored > event position)
      // CRITICAL: spiralPosition is only passed for NEW sounds (no stored position)
      // so existing dragged positions are always preserved
      if (spiralPosition) {
        // Use spiral position from bounding box placement (only for new sounds)
        sphereMesh.position.copy(spiralPosition);
        this.spherePositions[positionKey] = sphereMesh.position.clone();
      } else if (this.spherePositions[positionKey]) {
        // Use stored position (from previous drag) - THIS IS THE KEY PATH FOR PRESERVING POSITIONS
        sphereMesh.position.copy(this.spherePositions[positionKey]);
      } else {
        // Use event position (from backend or default)
        sphereMesh.position.fromArray(soundEvent.position);
        this.spherePositions[positionKey] = sphereMesh.position.clone();
      }

      // Store metadata
      sphereMesh.userData.soundEvent = soundEvent;
      sphereMesh.userData.promptKey = promptKey;
      sphereMesh.userData.positionKey = positionKey; // Sound ID for position storage
      sphereMesh.userData.customObjectType = 'sound'; // CRITICAL: Required for drag handler and event bridge

      // Add to sound spheres group and draggable objects
      this.soundSpheresGroup.add(sphereMesh);
      this.draggableObjects.push(sphereMesh);
      
      // CRITICAL: Force update matrix after adding to group
      sphereMesh.updateMatrix();
      sphereMesh.updateMatrixWorld(true);
      this.soundSpheresGroup.updateMatrixWorld(true);

      console.log(`[SoundSphereManager] Created sound sphere: ${promptKey}`);
    } else {
      // Entity-linked sound: Store position for audio source but don't create sphere
      // ALWAYS use soundEvent.position for entity-linked sounds — it contains
      // the entity's bounding box center (set by useSoundGeneration.linkSoundToEntity)
      this.spherePositions[positionKey] = new THREE.Vector3().fromArray(soundEvent.position);
    }

    // Load audio and create source via AudioOrchestrator
    const audioPosition = this.spherePositions[positionKey];

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
      },
      undefined,
      (error) => {
        console.error('[SoundSphereManager] Error loading audio:', error);
      }
    );
  }

  /**
   * Update sphere positions (called during drag)
   * Accepts promptKey for backward compatibility with drag handlers
   * Stores position using positionKey (sound ID) for consistency
   */
  public updateSpherePosition(promptKey: string, position: THREE.Vector3): void {
    // Find sphere by promptKey (how drag handlers identify spheres)
    const sphere = this.draggableObjects.find(obj => obj.userData.promptKey === promptKey);
    if (sphere) {
      sphere.position.copy(position);

      // Use positionKey (sound ID) for storage - this is the new stable key
      const positionKey = sphere.userData.positionKey || sphere.userData.soundEvent?.id || promptKey;
      this.spherePositions[positionKey] = position.clone();

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
      this.spherePositions[promptKey] = position.clone();
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
    const soundMeshes = this.soundSpheresGroup.children.filter(child =>
      child instanceof THREE.Mesh && child.userData.isGeometry !== true
    );
    soundMeshes.forEach(mesh => {
      disposeMesh(mesh as THREE.Mesh);
      this.soundSpheresGroup.remove(mesh);
    });

    // Remove sound spheres group from scene
    this.scene.remove(this.soundSpheresGroup);

    // Clear tracking
    this.draggableObjects = [];
    this.spherePositions = {};
  }
}

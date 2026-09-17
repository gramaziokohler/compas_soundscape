import * as THREE from "three";
import { triangulate } from "@/utils/utils";
import { API_BASE_URL, SOUND_SPHERE, DARK_MODE, OBJECT_LABEL } from "@/utils/constants";
import { getCssColorHex, trimDisplayName } from '@/utils/utils';
import { createLabelSprite, disposeLabelSprite, updateLabelSprite, computeLabelWorldHeight } from "@/lib/three/label-sprite-factory";
import { updateDraggableMeshes, disposeMeshes } from "@/lib/three/draggable-mesh-manager";
// import { calculateSpiralPositions } from "@/lib/three/spiral-placement"; // Bounding-box placement removed
import { calculateCameraFrontSpiralPositions } from "@/lib/three/spiral-placement";
import { SPIRAL_PLACEMENT } from "@/utils/constants";
import type { SoundEvent } from "@/types";
import type { AuralizationConfig, SoundMetadata } from "@/types/audio";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import { useAudioControlsStore } from "@/store/audioControlsStore";
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
 * Runtime surface info for entity-linked sounds, supplied by React (from
 * speckleStore.objectSoundLinks + viewer AABBs). A prompt is "large" when the
 * union AABB of its linked objects exceeds DARK_MODE.LARGE_ENTITY_THRESHOLD_M;
 * large prompts render a surface marker (no sphere) with a movable point.
 */
export interface EntitySurfaceInfo {
  largePrompts: Set<number>;
  objectIdsByPrompt: Map<number, string[]>;
  boxByPrompt: Map<number, THREE.Box3>;
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
  // Shared position per prompt index so all variants in the same prompt stay aligned.
  private promptPositions: Map<number, [number, number, number]> = new Map();

  // Sound metadata tracking (replaces legacy PositionalAudio)
  private soundMetadata: Map<string, SoundMetadata> = new Map();
  // Sounds whose buffer is currently being fetched/decoded. Guards syncAudioSources from
  // calling loadAudioForSound again for the same ID while a load is already in flight,
  // which would cause duplicate AudioOrchestrator sources and the "already exists" loop.
  private pendingLoads: Set<string> = new Set();
  // Latest non-pending sounds passed to syncAudioSources — used by buffer load callbacks
  // to sync _generatedSounds before re-baking the orchestrate schedule.
  private latestSounds: SoundEvent[] = [];
  // Track which sounds are entity-linked (for change detection in updateSounds)
  private entityLinkedIds: Set<string> = new Set();
  // sound id → prompt index (for deciding large-marker light behaviour).
  private soundPromptIndex: Map<string, number> = new Map();
  // Previous visible sound ID set — used to detect sound-set changes for the fast path.
  // soundMetadata intentionally contains ALL non-pending variants (not just the visible
  // selection), so a size comparison against it is invalid for multi-variant prompts.
  private lastVisibleSoundIds: Set<string> = new Set();
  private audioLoader: THREE.AudioLoader;

  // Dark mode state
  private darkModeEnabled: boolean = false;
  private darkModePointLights: Map<string, THREE.PointLight> = new Map();
  /** Group holding entity/marker dark-mode lights (not parented to a mesh). */
  private darkModeLightsGroup: THREE.Group | null = null;
  /** Sound IDs currently allowed to cast shadows (bounded by the shadow budget). */
  private darkModeShadowCasters: Set<string> = new Set();
  /** When true, non-playing sound lights are hidden (active playback). */
  private idleLightsOff: boolean = false;

  // Playing state — prompt indices currently producing audio. Keyed by prompt
  // (not variant sound id) so the visible variant's sphere pulses even when the
  // timeline is playing a different copy. Drives the scale pulse and, in dark
  // mode, the reactive light intensity.
  private playingPrompts: Set<number> = new Set();
  private playingPromptLevels: Map<number, number> = new Map();

  // Cached scale for mesh factory (set before calling updateDraggableMeshes)
  private scaleForSounds: number = 1.0;

  // Camera-based spiral placement tracking
  private lastPlacementCenter: THREE.Vector3 | null = null;
  private soundsPlacedAtCenter: number = 0;

  // Label sprites — one per non-entity sound sphere, keyed by sound ID
  private labelSprites: Map<string, THREE.Sprite> = new Map();

  // Pending label-recreation timers — debounce text changes so prompt typing
  // doesn't dispose/recreate sprite canvases on every keystroke.
  private labelUpdateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Label sprites for entity-linked sounds (no mesh), keyed by sound ID
  private entityLabelSprites: Map<string, THREE.Sprite> = new Map();

  // Surface markers for large entity-linked sounds (no sphere), keyed by prompt index
  private markerGroups: Map<number, THREE.Group> = new Map();
  // Surface info supplied by React — decides which prompts get a marker.
  private entitySurfaceInfo: EntitySurfaceInfo = {
    largePrompts: new Set<number>(),
    objectIdsByPrompt: new Map<number, string[]>(),
    boxByPrompt: new Map<number, THREE.Box3>(),
  };

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
    cameraFrontPosition?: THREE.Vector3 | null,
    entitySurfaceInfo?: EntitySurfaceInfo
  ): Map<string, [number, number, number]> {
    // Store scale for mesh factory
    this.scaleForSounds = scaleForSounds;

    if (entitySurfaceInfo) this.entitySurfaceInfo = entitySurfaceInfo;

    // Handle empty case — clear everything
    if (!soundscapeData || soundscapeData.length === 0) {
      this.removeAllAudioSources();
      this.removeAllSoundMeshes();
      this.entityLinkedIds.clear();
      this.promptPositions.clear();
      this.lastVisibleSoundIds.clear();
      return new Map();
    }

    // Separate iteration-label-only entries (produced by page.tsx for per-iteration entity
    // position visualization) from real sound events.  They carry '_iter_' in their ID.
    // They must NOT enter the variant-selection or audio-loading pipelines — only labels.
    const iterationLabels = soundscapeData.filter(s => s.id.includes('_iter_'));
    const realSoundData   = soundscapeData.filter(s => !s.id.includes('_iter_'));

    // Refresh the sound → prompt map (drives large-marker light behaviour).
    realSoundData.forEach((s) => {
      this.soundPromptIndex.set(s.id, (s as any).prompt_index ?? 0);
    });

    console.log('[SoundSphereManager:update] soundscapeData.length:', soundscapeData.length,
      'realSoundData.length:', realSoundData.length,
      'iterationLabels:', iterationLabels.length);
    if (realSoundData.length) {
      console.log('[SoundSphereManager:update] realSoundData (first 15):',
        realSoundData.slice(0, 15).map(s => ({
          id: s.id,
          pi: (s as any).prompt_index,
          sci: (s as any).speech_card_index,
          cat: (s as any).category,
          url: s.url?.substring(0, 50),
        })));
    }

    // Compute visible sounds BEFORE any teardown to check if recreation is needed.
    // Use only real sound data so iteration-label entries don't corrupt variant selection.
    const soundsByPromptIndex: { [key: number]: SoundEvent[] } = {};
    realSoundData.forEach(sound => {
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

    // Keep prompt-level positions bounded to prompts that still exist.
    const visiblePromptIndices = new Set(
      realSoundData.map((s) => ((s as any).prompt_index ?? 0) as number)
    );
    for (const promptIdx of this.promptPositions.keys()) {
      if (!visiblePromptIndices.has(promptIdx)) {
        this.promptPositions.delete(promptIdx);
      }
    }

    // Check if the sound set has actually changed (different IDs or entity_index toggled).
    // If the same sounds are still visible with same entity linking state,
    // skip teardown to avoid interrupting playback.
    // Positions are already managed by updateSpherePosition during drag.
    const newSoundIds = new Set(visibleSounds.map(s => s.id));
    const newEntityLinkedIds = new Set(
      visibleSounds.filter(s => s.entity_index !== undefined).map(s => s.id)
    );
    const visibleSetUnchanged =
      this.lastVisibleSoundIds.size === newSoundIds.size &&
      [...newSoundIds].every(id => this.lastVisibleSoundIds.has(id));
    const allVisibleHaveMetadata = [...newSoundIds].every(id => this.soundMetadata.has(id));
    if (
      this.soundMetadata.size > 0 &&
      visibleSetUnchanged &&
      allVisibleHaveMetadata &&
      // Also check entity_index hasn't changed (sphere visibility depends on it)
      newEntityLinkedIds.size === this.entityLinkedIds.size &&
      [...newEntityLinkedIds].every(id => this.entityLinkedIds.has(id))
    ) {
      // Sounds unchanged — still refresh mesh userData and sync labels in case display_name changed
      visibleSounds.forEach(soundEvent => {
        const mesh = this.soundMeshes.find(m => m.userData.soundEvent?.id === soundEvent.id);
        if (mesh) mesh.userData.soundEvent = soundEvent;
        const promptIdx = (soundEvent as any).prompt_index ?? 0;

        // Sync position for ALL sounds in case an undo/redo changed stored positions.
        // For entity-linked sounds: update if entity position changed.
        // For draggable mesh sounds: update if the stored position in soundscapeData differs
        //   from the manager's spherePositions (e.g., after undo of a drag).
        if (soundEvent.position) {
          const newPos = soundEvent.position as [number, number, number];
          const oldPos = this.spherePositions.get(soundEvent.id);
          const posChanged = !oldPos ||
            oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1] || oldPos[2] !== newPos[2];
          if (posChanged) {
            // Guard against [0,0,0] overwriting a valid non-zero stored position.
            // This can happen when a generated SoundEvent carries position [0,0,0]
            // from the backend/factory, but the sphere manager has already assigned
            // it a camera-front spiral position (or a position inherited from the
            // pending placeholder via promptPositions).
            const isZero = newPos[0] === 0 && newPos[1] === 0 && newPos[2] === 0;
            const hasValidStored = oldPos && (oldPos[0] !== 0 || oldPos[1] !== 0 || oldPos[2] !== 0);
            if (!(isZero && hasValidStored)) {
              this.spherePositions.set(soundEvent.id, newPos);
              this.promptPositions.set(promptIdx, newPos);
              // Update 3D mesh position so the viewer reflects undo/redo
              if (mesh) {
                mesh.position.set(newPos[0], newPos[1], newPos[2]);
              }
              if (this.audioOrchestrator) {
                this.audioOrchestrator.updateSourcePosition(
                  soundEvent.id,
                  new THREE.Vector3(newPos[0], newPos[1], newPos[2])
                );
              }
            }
          }
        }
      });
      // Register iteration label positions so updateScreenSpaceScale can scale them.
      // The set may change even when real sounds are unchanged (when the user links a
      // new entity to a DAW iteration), so always sync them in the fast path too.
      iterationLabels.forEach(label => {
        if (label.position) {
          this.spherePositions.set(label.id, label.position as [number, number, number]);
        }
      });
      this.syncLabelSprites(this.soundMeshes);
      // Keep surface markers in sync with the current large-prompt set, then
      // (re)wire labels. Markers must exist before labels so a large sound's
      // label becomes its click target in the same pass.
      const keepMarkers = new Set<number>();
      visibleSounds.forEach(se => {
        if (se.entity_index === undefined) return;
        const pi = (se as any).prompt_index ?? 0;
        if (this.entitySurfaceInfo.largePrompts.has(pi)) {
          const pos = this.spherePositions.get(se.id) ?? (se.position as [number, number, number]);
          this.upsertMarker(pi, se, pos);
          keepMarkers.add(pi);
        }
      });
      this.pruneMarkers(keepMarkers);

      this.syncEntityLabelSprites([
        ...visibleSounds.filter(s => s.entity_index !== undefined),
        ...iterationLabels,
      ]);

      this.lastVisibleSoundIds = new Set(newSoundIds);
      return new Map();
    }

    this.entityLinkedIds = newEntityLinkedIds;

    // Split visible sounds into mesh sounds (non-entity) and entity sounds
    const meshSounds = visibleSounds.filter(s => s.entity_index === undefined);
    const entitySounds = visibleSounds.filter(s => s.entity_index !== undefined);

    // Pre-populate spherePositions from soundEvent.position ONLY for previously-dragged sounds
    // restored from a saved soundscape. New sounds have position [0,0,0] and must go through
    // camera-front placement. Restored sounds have their drag position (non-zero) saved in Speckle.
    meshSounds.forEach(s => {
      const promptIdx = (s as any).prompt_index ?? 0;
      const promptPos = this.promptPositions.get(promptIdx);
      if (promptPos) {
        this.spherePositions.set(s.id, promptPos);
        return;
      }
      if (!this.spherePositions.has(s.id) && s.position) {
        const pos = s.position as [number, number, number];
        const hasSavedPosition = pos.length === 3 && (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0);
        if (hasSavedPosition) {
          this.spherePositions.set(s.id, pos);
          this.promptPositions.set(promptIdx, pos);
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
    // Track newly placed positions so the caller can sync them back to React state
    const newlyPlacedPositions: Map<string, [number, number, number]> = new Map();
    const meshSoundData: SoundMeshData[] = meshSounds.map(soundEvent => {
      const promptIdx = (soundEvent as any).prompt_index ?? 0;
      const promptKey = `prompt_${promptIdx}`;

      let position: [number, number, number];

      const sharedPromptPosition = this.promptPositions.get(promptIdx);
      const storedPosition = sharedPromptPosition ?? this.spherePositions.get(soundEvent.id);
      if (storedPosition) {
        // For pending spheres, the UI position widget may have been edited.
        // If soundEvent.position differs from the stored (spiral-placed) position, use the explicit one.
        // Generated sounds use the early-return path for position sync, so this branch is safe.
        if ((soundEvent as any).isPending && soundEvent.position) {
          const explicit = soundEvent.position as [number, number, number];
          // Only override when position is non-zero — [0,0,0] is the default
          // placeholder value (config.position ?? [0,0,0]) and should not
          // override a spiral-placed position.
          const isNonZero = explicit[0] !== 0 || explicit[1] !== 0 || explicit[2] !== 0;
          const differs =
            explicit[0] !== storedPosition[0] ||
            explicit[1] !== storedPosition[1] ||
            explicit[2] !== storedPosition[2];
          if (isNonZero && differs) {
            position = explicit;
            this.spherePositions.set(soundEvent.id, explicit);
            this.promptPositions.set(promptIdx, explicit);
          } else {
            position = storedPosition;
            this.spherePositions.set(soundEvent.id, position);
          }
        } else {
          // Use stored position (from previous drag) — preserves dragged positions
          position = storedPosition;
          this.spherePositions.set(soundEvent.id, position);
        }
      } else {
        const spiralPosition = spiralPositionMap.get(soundEvent.id);
        if (spiralPosition) {
          // Use spiral position from camera-front placement (only for new sounds)
          position = spiralPosition;
          this.spherePositions.set(soundEvent.id, position);
          this.promptPositions.set(promptIdx, position);
          newlyPlacedPositions.set(soundEvent.id, position);
        } else {
          // Use event position (from backend or default)
          position = (soundEvent.position as [number, number, number] | undefined) ?? [0, 0, 0];
          this.spherePositions.set(soundEvent.id, position);
          this.promptPositions.set(promptIdx, position);
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
    this.pruneOwnerlessLights();

    // Update userData.soundEvent on every mesh to reflect the latest data
    // (e.g. display_name changes). updateDraggableMeshes reuses existing
    // meshes but only updates position, not userData.
    const meshById = new Map(result.meshes.map(m => [m.userData.soundEvent?.id as string, m]));
    for (const data of meshSoundData) {
      const mesh = meshById.get(data.id);
      if (mesh) mesh.userData.soundEvent = data.soundEvent;
    }

    // Sync label sprites with the current mesh set
    this.syncLabelSprites(result.meshes);

    // Force group matrix update after mesh changes
    this.soundSpheresGroup.updateMatrixWorld(true);

    // Handle entity-linked sounds: store positions (no mesh) and sync labels.
    // Large linked objects additionally get a surface marker (no sphere) whose
    // position is a deterministic random point inside the object's AABB.
    const keepMarkers = new Set<number>();
    entitySounds.forEach(soundEvent => {
      const promptIdx = (soundEvent as any).prompt_index ?? 0;
      const position = soundEvent.position as [number, number, number];
      this.spherePositions.set(soundEvent.id, position);
      this.promptPositions.set(promptIdx, position);

      if (this.entitySurfaceInfo.largePrompts.has(promptIdx)) {
        const box = this.entitySurfaceInfo.boxByPrompt.get(promptIdx);
        let finalPos = position;
        if (box && !box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const atCenter =
            Math.hypot(position[0] - center.x, position[1] - center.y, position[2] - center.z) < 1e-3;
          if (atCenter) {
            finalPos = this.randomPointInBox(box, soundEvent.id);
            this.spherePositions.set(soundEvent.id, finalPos);
            this.promptPositions.set(promptIdx, finalPos);
            newlyPlacedPositions.set(soundEvent.id, finalPos);
          }
        }
        this.upsertMarker(promptIdx, soundEvent, finalPos);
        keepMarkers.add(promptIdx);
      }
    });
    // Remove markers that no longer belong to a large entity source (unlink/shrink).
    this.pruneMarkers(keepMarkers);

    // Register per-iteration label positions so updateScreenSpaceScale can find them.
    // These entries are label-only (no audio source, no mesh) and were excluded from the
    // variant-selection pipeline to avoid corrupting audio scheduling.
    iterationLabels.forEach(label => {
      if (label.position) {
        this.spherePositions.set(label.id, label.position as [number, number, number]);
      }
    });

    this.syncEntityLabelSprites([...entitySounds, ...iterationLabels]);

    // Register audio sources for ALL non-pending variants (not just the visible/selected one).
    // This decouples the sound card's variant selector from timeline playback — the
    // orchestrator always has every variant's buffer loaded so that playAll (which always
    // schedules copy-index 0) and per-iteration iterationLinks can both find their target
    // without the card selection affecting what plays on the timeline.
    const allNonPendingSounds = Object.values(soundsByPromptIndex)
      .flat()
      .filter((s) => !(s as any).isPending);

    // Non-selected variants don't go through the mesh/position pipeline above, so they
    // may lack entries in spherePositions.  Give them the prompt-level position so that
    // loadAudioForSound can spatialise them correctly.
    allNonPendingSounds.forEach((sound) => {
      if (!this.spherePositions.has(sound.id)) {
        const promptIdx = (sound as any).prompt_index ?? 0;
        const pos = this.promptPositions.get(promptIdx);
        if (pos) this.spherePositions.set(sound.id, pos);
      }
    });

    this.syncAudioSources(allNonPendingSounds);

    this.lastVisibleSoundIds = new Set(newSoundIds);

    return newlyPlacedPositions;
  }

  /**
   * Sync audio sources with the current set of visible sounds.
   * Creates audio sources for new sounds, removes sources for sounds no longer visible.
   * Also cleans up stale spherePositions entries to prevent unbounded growth.
   * Audio lifecycle is decoupled from mesh lifecycle.
   */
  private syncAudioSources(visibleSounds: SoundEvent[]): void {
    this.latestSounds = visibleSounds; // snapshot for buffer-load callbacks
    const visibleSoundIds = new Set(visibleSounds.map(s => s.id));

    console.log('[SoundSphereManager:syncAudio] visibleSounds.length:', visibleSounds.length,
      'existing metadata.size:', this.soundMetadata.size,
      'pendingLoads:', this.pendingLoads.size);
    if (visibleSounds.length) {
      const ttsSounds = visibleSounds.filter(s => s.id.startsWith('tts_'));
      const genSounds = visibleSounds.filter(s => s.id.startsWith('generated_'));
      console.log('[SoundSphereManager:syncAudio] tts:', ttsSounds.length, 'generated:', genSounds.length);
      if (ttsSounds.length) {
        console.log('[SoundSphereManager:syncAudio] TTS sounds:', ttsSounds.map(s => ({
          id: s.id, pi: (s as any).prompt_index, sci: (s as any).speech_card_index, url: s.url?.substring(0, 60)
        })));
      }
    }

    // Remove audio sources and stale positions for sounds no longer visible
    for (const [soundId] of this.soundMetadata) {
      if (!visibleSoundIds.has(soundId)) {
        if (this.audioOrchestrator) {
          this.audioOrchestrator.removeSource(soundId);
        }
        this.soundMetadata.delete(soundId);
        this.spherePositions.delete(soundId);
        this.pendingLoads.delete(soundId); // clear any stale in-flight marker
      }
    }

    // Create audio sources for new sounds (not already in metadata or currently loading)
    visibleSounds.forEach(soundEvent => {
      if (this.soundMetadata.has(soundEvent.id)) return; // already loaded
      if (this.pendingLoads.has(soundEvent.id)) return;  // load in-flight — don't duplicate
      if (soundEvent.isPending) return; // pre-generation placeholder
      this.loadAudioForSound(soundEvent);
    });
  }

  /**
   * Load audio buffer and create an audio source for a single sound event.
   * Called by syncAudioSources for new sounds only.
   */
  private loadAudioForSound(soundEvent: SoundEvent): void {
    // Missing audio (e.g. a saved event whose file no longer exists on the
    // server — the backend clears its audio_filename) has no URL. Skip the load
    // instead of fetching the API base URL, which would fail noisily.
    if (!soundEvent.url) {
      return;
    }
    const audioPosition = this.spherePositions.get(soundEvent.id);
    if (!audioPosition) {
      console.warn(`[SoundSphereManager] No position for sound ${soundEvent.id} (pi:${(soundEvent as any).prompt_index} sci:${(soundEvent as any).speech_card_index}), skipping audio load`);
      return;
    }

    const isEntityLinked = soundEvent.entity_index !== undefined;

    // Determine full URL (blob for uploads, backend for generated)
    const isUploadedSound = soundEvent.url.startsWith('blob:') || soundEvent.url.startsWith('http');
    const fullUrl = isUploadedSound ? soundEvent.url : `${API_BASE_URL}${soundEvent.url}`;

    // Mark as in-flight so concurrent syncAudioSources calls don't start a second load
    this.pendingLoads.add(soundEvent.id);

    // Load audio buffer and create source
    this.audioLoader.load(
      fullUrl,
      (buffer) => {
        this.pendingLoads.delete(soundEvent.id); // load complete

        // For sphere-linked sounds, verify the sphere is still in the scene before
        // registering the buffer.  Non-primary copies (copy_index >= 1) never have
        // a visible mesh — they exist purely for audio playback — so we must NOT
        // abort them here; otherwise variant B / C buffers are never loaded.
        const copyIndex = (soundEvent as any).copy_index ?? 0;
        const isPrimaryOrEntity = isEntityLinked || copyIndex === 0;
        if (isPrimaryOrEntity && !isEntityLinked) {
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
            interval_seconds: soundEvent.interval_seconds,
            copy_index: (soundEvent as any).copy_index,
            speech_card_index: (soundEvent as any).speech_card_index,
            category: (soundEvent as any).category,
          }
        };

        this.soundMetadata.set(soundEvent.id, metadata);

        // Store buffer duration and re-bake the orchestrate schedule so that
        // after() / alignEnd() expressions resolve using the real buffer length.
        console.log('[SoundSphereManager] metadata registered:', soundEvent.id,
          'prompt_index:', (soundEvent as any).prompt_index,
          'speech_card_index:', (soundEvent as any).speech_card_index,
          'category:', (soundEvent as any).category,
          'copy_index:', (soundEvent as any).copy_index,
          'display_name:', soundEvent.display_name);
        // Note: syncGeneratedSounds is intentionally NOT called here — it is already
        // dispatched from the page.tsx useEffect and calling it from every buffer
        // callback caused a store-update storm that re-triggered syncAudioSources
        // repeatedly (compounding the pending-load race that pendingLoads now guards).
        const audioStore = useAudioControlsStore.getState();
        audioStore.setSoundBufferDuration(soundEvent.id, buffer.duration);
      },
      undefined,
      (error) => {
        this.pendingLoads.delete(soundEvent.id); // allow retry on next sync
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

  /** Remove all sound sphere meshes and their label sprites (including entity labels) */
  private removeAllSoundMeshes(): void {
    disposeMeshes(this.soundSpheresGroup, this.soundMeshes);
    this.soundMeshes = [];
    this.draggableObjects = [];
    this.pruneOwnerlessLights();
    this.labelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.labelSprites.clear();
    this.entityLabelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.entityLabelSprites.clear();
    this.labelUpdateTimers.forEach(timer => clearTimeout(timer));
    this.labelUpdateTimers.clear();

    // Remove all surface markers
    Array.from(this.markerGroups.keys()).forEach((promptIdx) => this.removeMarker(promptIdx));
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

    // Pending (pre-generation) placeholders share the generated sphere's primary
    // look but render slightly dimmer (PENDING_OPACITY vs BASE_OPACITY).
    const isPendingSphere = !!soundEvent.isPending;
    const sphereColor = getCssColorHex('--color-primary');

    const material = new THREE.MeshBasicMaterial({
      color: sphereColor,
      // In dark mode spheres are opaque self-lit emitters (matching enableDarkMode),
      // including spheres created after dark mode was turned on.
      transparent: this.darkModeEnabled ? false : true,
      opacity: this.darkModeEnabled ? 1 : (isPendingSphere ? SOUND_SPHERE.PENDING_OPACITY : SOUND_SPHERE.BASE_OPACITY),
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
      const soundEvent = sphere.userData.soundEvent as SoundEvent | undefined;
      const promptIdx = (soundEvent as any)?.prompt_index;
      if (typeof promptIdx === 'number') {
        this.promptPositions.set(promptIdx, [position.x, position.y, position.z]);
      }

      // Update the audio source position if it exists
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
   * Get the rendered position of a sound sphere by sound ID.
   * Returns from spherePositions (always up-to-date, includes dragged positions).
   * Preferred over getAudioSource for position look-ups since it is populated
   * synchronously and does not depend on audio loading completing.
   */
  public getSpherePosition(soundId: string): [number, number, number] | undefined {
    return this.spherePositions.get(soundId);
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
        const timer = this.labelUpdateTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          this.labelUpdateTimers.delete(id);
        }
      }
    }

    // Create (or recreate on name change) labels for current meshes
    for (const mesh of meshes) {
      const id = mesh.userData.soundEvent?.id as string;
      if (!id) continue;

      const text = trimDisplayName((mesh.userData.soundEvent?.display_name as string) || id);
      const existing = this.labelSprites.get(id);
      // Pending placeholders (pre-generation) have a frozen label: while the
      // card is pending its title may still be edited, but the 3D label must
      // not update. When the sound is generated the pending event is replaced
      // by a generated event (new id), which creates a fresh label then.
      const isPending = !!(mesh.userData.soundEvent as any)?.isPending;

      if (existing) {
        if (existing.userData.labelText === text) continue; // up-to-date
        if (isPending) continue; // pending — freeze label, update only on generation
        // Name changed — debounce the recreation so typing in a sound prompt
        // only settles the label once the user stops typing.
        const pending = this.labelUpdateTimers.get(id);
        if (pending) clearTimeout(pending);
        this.labelUpdateTimers.set(id, setTimeout(() => {
          this.labelUpdateTimers.delete(id);
          this.recreateLabelSprite(id, text, mesh.position);
        }, OBJECT_LABEL.LABEL_UPDATE_DEBOUNCE_MS));
        continue;
      }

      this.recreateLabelSprite(id, text, mesh.position);
    }
  }

  private recreateLabelSprite(id: string, text: string, position: THREE.Vector3): void {
    const existing = this.labelSprites.get(id);
    if (existing) {
      // Redraw the existing canvas/texture in place — no sprite recreation, so
      // the label never flashes at the default (huge) scale for a frame.
      updateLabelSprite(existing, text);
      return;
    }
    const sprite = createLabelSprite(text);
    sprite.position.copy(position);
    this.soundSpheresGroup.add(sprite);
    this.labelSprites.set(id, sprite);
  }

  /**
   * Sync label sprites for entity-linked sounds (which have no sphere mesh).
   * Groups sounds by entity_index so co-located labels can be spread side-by-side
   * in updateScreenSpaceScale. Each sprite gets userData.entitySlot (0-based index
   * within the group) and userData.entityGroupSize so the per-frame update can
   * compute the correct horizontal offset.
   */
  private syncEntityLabelSprites(entitySounds: SoundEvent[]): void {
    const currentIds = new Set(entitySounds.map(s => s.id));

    // Separate iteration labels from regular entity-linked sounds.
    const iterationLabels: SoundEvent[] = [];
    const regularEntitySounds: SoundEvent[] = [];
    for (const s of entitySounds) {
      if (s.id.includes('_iter_')) {
        iterationLabels.push(s);
      } else {
        regularEntitySounds.push(s);
      }
    }

    // Build set of base sound IDs that have iteration labels (i.e. multiple entities linked).
    // Regular entity labels for these sounds are converted to .pos1 (default entity)
    // instead of being suppressed, so unlinked iterations show as linked to entity 1.
    const iterBaseIds = new Set(iterationLabels.map(s => s.id.replace(/_iter_.*$/, '')));

    // Remove labels whose entity sound is no longer visible,
    // AND regular entity labels suppressed because iteration labels exist.
    for (const [id, sprite] of this.entityLabelSprites) {
      if (!currentIds.has(id) || iterBaseIds.has(id)) {
        this.soundSpheresGroup.remove(sprite);
        disposeLabelSprite(sprite);
        this.entityLabelSprites.delete(id);
      }
    }

    // Group-1: regular entity-linked sounds — by entity_index (co-located at same entity)
    const entityIndexGroups = new Map<number, SoundEvent[]>();
    for (const s of regularEntitySounds) {
      const idx = s.entity_index ?? 0;
      if (!entityIndexGroups.has(idx)) entityIndexGroups.set(idx, []);
      entityIndexGroups.get(idx)!.push(s);
    }

    // Group-2: iteration labels — by base sound ID (all iterations of the same sound)
    const iterationGroups = new Map<string, SoundEvent[]>();
    for (const s of iterationLabels) {
      const baseId = s.id.replace(/_iter_.*$/, '');
      if (!iterationGroups.has(baseId)) iterationGroups.set(baseId, []);
      iterationGroups.get(baseId)!.push(s);
    }

    // Create (or recreate) labels for regular entity groups.
    // Suppress regular labels when iteration labels exist (multi-entity).
    // The default .pos1 label is provided as an explicit iteration label.
    for (const sounds of entityIndexGroups.values()) {
      const groupSize = sounds.length;
      sounds.forEach((soundEvent, slotIdx) => {
        if (iterBaseIds.has(soundEvent.id)) return;
        const baseText = trimDisplayName((soundEvent.display_name ?? '') || soundEvent.id);
        const text = groupSize > 1 ? `${baseText}.pos${slotIdx + 1}` : baseText;
        this.upsertEntityLabel(soundEvent, slotIdx, groupSize, text);
      });
    }

    // Create (or recreate) labels for iteration groups.
    // Each iteration label carries the real entity index (from the config.entities array)
    // so the pos suffix matches the sound card's numbered entity buttons.
    for (const sounds of iterationGroups.values()) {
      const groupSize = sounds.length;
      sounds.forEach((soundEvent, slotIdx) => {
        const baseText = trimDisplayName((soundEvent.display_name ?? '') || soundEvent.id);
        const entityIdx = soundEvent.entity_index ?? -1;
        const posNum = entityIdx >= 0 ? entityIdx + 1 : slotIdx + 1;
        const text = `${baseText}.pos${posNum}`;
        this.upsertEntityLabel(soundEvent, slotIdx, groupSize, text);
      });
    }
  }

  private upsertEntityLabel(
    soundEvent: SoundEvent,
    slotIdx: number,
    groupSize: number,
    text: string,
  ): void {
    const existing = this.entityLabelSprites.get(soundEvent.id);

    // Pending placeholders (pre-generation) have a frozen label — never rebuild
    // them while pending. When the sound is generated the pending event is
    // replaced by a generated event (new id), which creates a fresh label then.
    if (existing && (soundEvent as any).isPending) {
      this.applyMarkerLabelUserData(existing, soundEvent);
      return;
    }

    // Recreate when text, slot index, or group size has changed
    const needsRebuild = existing && (
      existing.userData.labelText !== text ||
      existing.userData.entitySlot !== slotIdx ||
      existing.userData.entityGroupSize !== groupSize
    );

    if (existing && !needsRebuild) {
      // Keep the click-target wiring current even when the sprite is reused.
      this.applyMarkerLabelUserData(existing, soundEvent);
      return;
    }

    if (existing) {
      // Redraw the existing canvas/texture in place — no sprite recreation, so
      // the label never flashes at the default (huge) scale for a frame.
      updateLabelSprite(existing, text);
      existing.userData.entitySlot = slotIdx;
      existing.userData.entityGroupSize = groupSize;
      this.applyMarkerLabelUserData(existing, soundEvent);
      return;
    }

    const pos = this.spherePositions.get(soundEvent.id) ?? soundEvent.position as [number, number, number];
    const sprite = createLabelSprite(text);
    sprite.position.set(pos[0], pos[1], pos[2]);
    sprite.userData.entitySlot = slotIdx;
    sprite.userData.entityGroupSize = groupSize;
    this.applyMarkerLabelUserData(sprite, soundEvent);
    this.soundSpheresGroup.add(sprite);
    this.entityLabelSprites.set(soundEvent.id, sprite);
  }

  // ============================================================================
  // Surface Markers (large entity-linked sounds)
  // ============================================================================

  /** Deterministic 0..1 PRNG seeded from a string (stable across reloads). */
  private seededRandom(seed: string): () => number {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /** A deterministic random point inside a box (80% of each half-extent). */
  private randomPointInBox(
    box: THREE.Box3,
    seed: string,
  ): [number, number, number] {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const rnd = this.seededRandom(seed);
    return [
      center.x + (rnd() - 0.5) * size.x * 0.8,
      center.y + (rnd() - 0.5) * size.y * 0.8,
      center.z + (rnd() - 0.5) * size.z * 0.8,
    ];
  }

  private createMarkerGroup(soundEvent: SoundEvent): THREE.Group {
    // Large linked sounds show NO fixed UI (ring/pin/head) — only their point
    // light. The marker is an invisible position proxy; the gumball is summoned
    // by clicking the sound's label sprite (see applyMarkerLabelUserData).
    const group = new THREE.Group();
    group.name = `SoundMarker_${soundEvent.id}`;
    group.visible = false;
    group.layers.enableAll();
    return group;
  }

  /**
   * Make an entity label sprite the click target for a large surface marker:
   * clicking it selects the (invisible) marker group so the gumball appears.
   */
  private applyMarkerLabelUserData(sprite: THREE.Sprite, soundEvent: SoundEvent): void {
    const promptIdx = (soundEvent as any).prompt_index ?? 0;
    const markerGroup = this.markerGroups.get(promptIdx);
    if (markerGroup && this.entitySurfaceInfo.largePrompts.has(promptIdx)) {
      sprite.userData.customObjectType = 'sound';
      sprite.userData.isSurfaceMarker = true;
      sprite.userData.promptKey = `prompt_${promptIdx}`;
      sprite.userData.positionKey = soundEvent.id;
      sprite.userData.surfaceObjectIds = this.entitySurfaceInfo.objectIdsByPrompt.get(promptIdx) ?? [];
      sprite.userData.markerTarget = markerGroup;
    } else {
      delete sprite.userData.customObjectType;
      delete sprite.userData.isSurfaceMarker;
      delete sprite.userData.markerTarget;
    }
  }

  private upsertMarker(
    promptIdx: number,
    soundEvent: SoundEvent,
    position: [number, number, number],
  ): void {
    let group = this.markerGroups.get(promptIdx);
    if (!group) {
      group = this.createMarkerGroup(soundEvent);
      this.soundSpheresGroup.add(group);
      this.markerGroups.set(promptIdx, group);
    }
    group.position.set(position[0], position[1], position[2]);
    group.userData.customObjectType = 'sound';
    group.userData.isSurfaceMarker = true;
    group.userData.soundEvent = soundEvent;
    group.userData.promptKey = `prompt_${promptIdx}`;
    group.userData.positionKey = soundEvent.id;
    group.userData.surfaceObjectIds = this.entitySurfaceInfo.objectIdsByPrompt.get(promptIdx) ?? [];
  }

  private removeMarker(promptIdx: number): void {
    const group = this.markerGroups.get(promptIdx);
    if (!group) return;

    // Clear the click-target wiring on any label that points at this marker so a
    // stale sprite can't re-select a removed marker (e.g. after unlinking).
    this.entityLabelSprites.forEach((sprite) => {
      if (sprite.userData.markerTarget === group) {
        delete sprite.userData.customObjectType;
        delete sprite.userData.isSurfaceMarker;
        delete sprite.userData.markerTarget;
        delete sprite.userData.surfaceObjectIds;
      }
    });

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.soundSpheresGroup.remove(group);
    this.markerGroups.delete(promptIdx);
  }

  /**
   * Remove markers whose prompt no longer qualifies as a large entity source
   * (e.g. the sound was unlinked or the linked object shrank below threshold).
   * Without this, an unlinked sound left its marker + gumball behind.
   */
  private pruneMarkers(keepPrompts: Set<number>): void {
    for (const promptIdx of Array.from(this.markerGroups.keys())) {
      if (!keepPrompts.has(promptIdx)) this.removeMarker(promptIdx);
    }
  }

  /** Surface marker objects (for the surface-constrained gumball + picking). */
  public getMarkerObjects(): THREE.Group[] {
    return Array.from(this.markerGroups.values());
  }

  /** Object ids bound to a prompt's marker (for the surface raycast). */
  public getMarkerSurfaceObjectIds(promptIdx: number): string[] {
    return this.entitySurfaceInfo.objectIdsByPrompt.get(promptIdx) ?? [];
  }

  /**
   * Move a marker (and its audio source / stored position) — called live while
   * the surface gumball drags, and on commit.
   */
  public updateMarkerPosition(promptIdx: number, position: [number, number, number]): void {
    const group = this.markerGroups.get(promptIdx);
    if (!group) return;
    group.position.set(position[0], position[1], position[2]);

    const soundEvent = group.userData.soundEvent as SoundEvent | undefined;
    if (!soundEvent) return;
    this.spherePositions.set(soundEvent.id, position);
    this.promptPositions.set(promptIdx, position);
    this.audioOrchestrator?.updateSourcePosition(soundEvent.id, new THREE.Vector3(...position));
  }

  /**
   * World height for a label at `distance` from a perspective camera so the
   * label occupies a fixed fraction of the viewport height on ANY screen/window
   * size (rem-like consistent sizing). Independent of canvas pixel size/DPI.
   */
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

      // Realtime playing pulse — a subtle scale "breath" proportional to the
      // source's live level. Applied on top of the screen-space scale so it is
      // visible in every view mode (scale is recomputed each frame here).
      const soundId = mesh.userData.soundEvent?.id as string;
      const promptIdx = (mesh.userData.soundEvent as SoundEvent | undefined)?.prompt_index ?? 0;
      let pulse = 1;
      if (this.playingPrompts.has(promptIdx)) {
        const level = this.playingPromptLevels.get(promptIdx) ?? 0.5;
        pulse = 1 + DARK_MODE.PLAYING_SPHERE_PULSE * (0.35 + 0.65 * level);
      }
      mesh.scale.setScalar(scale * pulse);

      // Position and scale the corresponding label sprite (use same clamped ratio)
      const label = soundId ? this.labelSprites.get(soundId) : null;
      if (label) {
        const clampRatio = scale / rawScale;
        const zOffset = distance * SOUND_SPHERE.SCREEN_SPACE_SIZE * OBJECT_LABEL.Z_OFFSET_FACTOR * clampRatio;
        label.position.set(mesh.position.x, mesh.position.y, mesh.position.z + zOffset);
        const h = computeLabelWorldHeight(camera, distance, clampRatio);
        label.scale.set(h * (label.userData.aspectRatio as number || 3), h, 1);
      }
    });

    // Update entity-linked label sprites (no mesh — use stored position + group offset)
    // Camera up vector is computed once and reused to stack co-located labels
    // vertically in screen space regardless of camera orientation.
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

    for (const [soundId, label] of this.entityLabelSprites) {
      const pos = this.spherePositions.get(soundId);
      if (!pos) continue;

      const worldPos = new THREE.Vector3(pos[0], pos[1], pos[2]);
      const distance = camera.position.distanceTo(worldPos);
      if (distance < 0.01) continue;

      // Mirror the same MIN/MAX clamp used for sphere meshes so entity labels
      // maintain the same minimum apparent size when zoomed in close.
      const rawScale = (distance * SOUND_SPHERE.SCREEN_SPACE_SIZE) / baseRadius;
      const clampedScale = Math.max(SOUND_SPHERE.MIN_SCALE, Math.min(SOUND_SPHERE.MAX_SCALE, rawScale));
      const clampRatio = clampedScale / rawScale;

      const h = computeLabelWorldHeight(camera, distance, clampRatio);
      const labelWidth = h * (label.userData.aspectRatio as number || 3);

      // Vertical offset so grouped labels stack above the anchor without overlapping.
      // slot i of n: centered so the group as a whole is over the anchor.
      const slot: number = label.userData.entitySlot ?? 0;
      const groupSize: number = label.userData.entityGroupSize ?? 1;
      const spacing = h * 1.2; // 20% gap between adjacent labels
      const groupOffset = (slot - (groupSize - 1) / 2) * spacing;

      const zOffset = distance * SOUND_SPHERE.SCREEN_SPACE_SIZE * OBJECT_LABEL.Z_OFFSET_FACTOR * clampRatio;
      const labelPos = worldPos.clone().addScaledVector(cameraUp, groupOffset);
      labelPos.z += zOffset;
      label.position.copy(labelPos);
      label.scale.set(labelWidth, h, 1);
    }

    // Surface markers keep a constant apparent size at any zoom.
    this.markerGroups.forEach((group) => {
      const distance = camera.position.distanceTo(group.position);
      if (distance < 0.01) return;
      const rawScale = (distance * DARK_MODE.MARKER_SCREEN_SPACE_SIZE) / DARK_MODE.MARKER_RING_RADIUS;
      const scale = Math.max(DARK_MODE.MARKER_MIN_SCALE, Math.min(DARK_MODE.MARKER_MAX_SCALE, rawScale));
      group.scale.setScalar(scale);
    });

    // Bound the number of VISIBLE sound lights. Three compiles every visible
    // light into every standard material's shader; beyond a modest count the
    // fragment uniform budget can be exceeded, which blacks out / mangles the
    // shading (the "not all lit / messy" symptom with many sources). Keep only
    // the closest lights that want to be visible.
    if (this.darkModePointLights.size > 0) {
      const candidates: Array<{ light: THREE.PointLight; dist: number }> = [];
      const tmpLightPos = new THREE.Vector3();
      this.darkModePointLights.forEach((light) => {
        // Per-sphere lights track their mesh (they are not mesh children, so
        // hiding sound spheres no longer hides the light).
        const owner = light.userData.ownerMesh as THREE.Mesh | undefined;
        if (owner) {
          owner.getWorldPosition(tmpLightPos);
          light.position.copy(tmpLightPos);
        }
        const wants =
          light.userData.muted !== true && light.userData.wantVisible !== false;
        if (!wants) {
          light.visible = false;
          return;
        }
        light.getWorldPosition(tmpLightPos);
        candidates.push({ light, dist: camera.position.distanceTo(tmpLightPos) });
      });
      candidates.sort((a, b) => a.dist - b.dist);
      const cap = DARK_MODE.MAX_ACTIVE_LIGHTS;
      candidates.forEach((c, i) => {
        c.light.visible = i < cap;
      });
    }
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
      material.color.setHex(getCssColorHex('--color-primary'));
      material.transparent = false;
      material.opacity = 1;
      material.needsUpdate = true;

      // Add point light as child (follows mesh during drag)
      this.addPointLightToMesh(mesh);
    });
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
    this.darkModeShadowCasters.clear();

    // Remove the entity/marker lights group
    if (this.darkModeLightsGroup) {
      this.scene.remove(this.darkModeLightsGroup);
      this.darkModeLightsGroup.clear();
      this.darkModeLightsGroup = null;
    }

    // Restore per-state sphere visuals: pending placeholders come back dimmer
    // (PENDING_OPACITY), everything else at the normal transparent-primary opacity.
    this.soundMeshes.forEach(mesh => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      const isPending = !!((mesh.userData.soundEvent as SoundEvent | undefined)?.isPending);
      material.color.setHex(getCssColorHex('--color-primary'));
      material.transparent = true;
      material.opacity = isPending ? SOUND_SPHERE.PENDING_OPACITY : SOUND_SPHERE.BASE_OPACITY;
      material.needsUpdate = true;
    });
  }

  /** Add a point light as a child of a sound sphere mesh */
  private addPointLightToMesh(mesh: THREE.Mesh): void {
    const soundId = mesh.userData.soundEvent?.id;
    if (!soundId || this.darkModePointLights.has(soundId)) return;

    const light = new THREE.PointLight(
      getCssColorHex('--color-primary'),
      DARK_MODE.POINT_LIGHT_INTENSITY,
      DARK_MODE.POINT_LIGHT_DISTANCE,
      DARK_MODE.POINT_LIGHT_DECAY
    );
    light.name = `DarkModeLight_${soundId}`;
    light.layers.enableAll();
    light.userData.baseIntensity = DARK_MODE.POINT_LIGHT_INTENSITY;
    light.userData.wantVisible = true;
    // Inherit the track's current mute state: a sound muted before dark mode was
    // enabled must not start lighting the scene.
    light.userData.muted = mesh.userData.isMuted === true;
    // The light lives in the dedicated lights group (NOT as a child of the mesh)
    // so hiding sound spheres does not also hide the light. Its position is
    // synced from the mesh each frame in updateScreenSpaceScale.
    light.userData.ownerMesh = mesh;

    // Shadow budget: only a bounded number of lights cast shadows.
    this.applyShadowBudget(light, soundId);

    this.ensureDarkModeLightsGroup().add(light);
    this.darkModePointLights.set(soundId, light);
  }

  /**
   * Enable a light as a shadow caster only if the budget allows; otherwise keep
   * it a plain (cheap) point light. A shadow-casting PointLight renders the
   * scene 6× per frame, so this cap is the main guard against multi-source lag.
   */
  private applyShadowBudget(light: THREE.PointLight, soundId: string): void {
    // Large surface markers must NOT cast shadows: the surface would occlude the
    // light and only one face would be lit. Shadowless, it shines through and
    // lights both faces (material is DoubleSide).
    if (light.userData.noShadow === true) {
      light.castShadow = false;
      return;
    }
    const canCast = this.darkModeShadowCasters.size < DARK_MODE.MAX_SHADOW_CASTING_LIGHTS;
    if (!canCast) {
      light.castShadow = false;
      return;
    }
    light.castShadow = true;
    light.shadow.mapSize.width = DARK_MODE.SHADOW_MAP_SIZE;
    light.shadow.mapSize.height = DARK_MODE.SHADOW_MAP_SIZE;
    light.shadow.camera.near = DARK_MODE.SHADOW_CAMERA_NEAR;
    light.shadow.camera.far = light.distance;
    light.shadow.bias = DARK_MODE.SHADOW_BIAS;
    light.shadow.normalBias = DARK_MODE.SHADOW_NORMAL_BIAS;
    this.darkModeShadowCasters.add(soundId);
  }

  /** True when a sound belongs to a large surface-marker prompt. */
  private isLargeMarkerLight(soundId: string): boolean {
    const promptIdx = this.soundPromptIndex.get(soundId);
    return promptIdx !== undefined && this.entitySurfaceInfo.largePrompts.has(promptIdx);
  }

  private ensureDarkModeLightsGroup(): THREE.Group {
    if (!this.darkModeLightsGroup) {
      const group = new THREE.Group();
      group.name = 'DarkModeLightsGroup';
      group.layers.enableAll();
      this.scene.add(group);
      this.darkModeLightsGroup = group;
    }
    return this.darkModeLightsGroup;
  }

  /**
   * Create a dark-mode point light for an entity/marker sound (which has no
   * sphere mesh). Idempotent per sound ID.
   */
  public addEntityDarkModeLight(
    soundId: string,
    position: [number, number, number],
    intensity: number,
    distance: number
  ): THREE.PointLight | null {
    const existing = this.darkModePointLights.get(soundId);
    if (existing) {
      existing.position.set(position[0], position[1], position[2]);
      return existing;
    }
    const light = new THREE.PointLight(
      getCssColorHex('--color-primary'),
      intensity,
      distance,
      DARK_MODE.POINT_LIGHT_DECAY
    );
    light.name = `DarkModeEntityLight_${soundId}`;
    light.position.set(position[0], position[1], position[2]);
    light.layers.enableAll();
    light.userData.baseIntensity = intensity;
    light.userData.wantVisible = true;
    // Large surface markers must shine through the surface (light both faces).
    light.userData.noShadow = this.isLargeMarkerLight(soundId);
    this.applyShadowBudget(light, soundId);
    this.ensureDarkModeLightsGroup().add(light);
    this.darkModePointLights.set(soundId, light);
    return light;
  }

  /** Remove an entity/marker dark-mode light for a sound ID. */
  public removeEntityDarkModeLight(soundId: string): void {
    const light = this.darkModePointLights.get(soundId);
    if (!light) return;
    light.parent?.remove(light);
    light.dispose();
    this.darkModePointLights.delete(soundId);
    this.darkModeShadowCasters.delete(soundId);
  }

  /** Drop lights whose owner mesh no longer exists (mesh removed/replaced). */
  private pruneOwnerlessLights(): void {
    if (this.darkModePointLights.size === 0) return;
    const live = new Set<THREE.Object3D>(this.soundMeshes);
    const toRemove: string[] = [];
    this.darkModePointLights.forEach((light, soundId) => {
      const owner = light.userData.ownerMesh as THREE.Object3D | undefined;
      if (owner && !live.has(owner)) toRemove.push(soundId);
    });
    toRemove.forEach((id) => this.removeEntityDarkModeLight(id));
  }

  /** Move an entity/marker dark-mode light (e.g. while dragging the marker). */
  public setEntityDarkModeLightPosition(soundId: string, position: [number, number, number]): void {
    const light = this.darkModePointLights.get(soundId);
    if (light) light.position.set(position[0], position[1], position[2]);
  }

  /**
   * Re-assign shadow-casting status so only the currently playing sounds (up to
   * MAX_SHADOW_CASTING_LIGHTS) cast shadows. Called by the playing-visuals loop.
   */
  public setShadowCasters(activeIds: Iterable<string>): void {
    const active = new Set(activeIds);
    let count = 0;
    this.darkModePointLights.forEach((light, soundId) => {
      // Large surface-marker lights never cast (they must light both faces).
      const noShadow = light.userData.noShadow === true || this.isLargeMarkerLight(soundId);
      const shouldCast = !noShadow && active.has(soundId) && count < DARK_MODE.MAX_SHADOW_CASTING_LIGHTS;
      if (shouldCast) count++;
      if (light.castShadow !== shouldCast) {
        light.castShadow = shouldCast;
        if (shouldCast) {
          light.shadow.mapSize.width = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.mapSize.height = DARK_MODE.SHADOW_MAP_SIZE;
          light.shadow.camera.near = DARK_MODE.SHADOW_CAMERA_NEAR;
          light.shadow.camera.far = light.distance;
          light.shadow.bias = DARK_MODE.SHADOW_BIAS;
          light.shadow.normalBias = DARK_MODE.SHADOW_NORMAL_BIAS;
        }
      }
      if (shouldCast) this.darkModeShadowCasters.add(soundId);
      else this.darkModeShadowCasters.delete(soundId);
    });
  }

  /**
   * Set a sound light's reactive intensity from a realtime level (0..1).
   *
   * - playing  → intensity scales with the live level (base × factor).
   * - idle, playback active (`idleLightsOff`) → light hidden entirely, so the
   *   scene goes dark and only the sounding source(s) light it.
   * - idle, nothing playing → restored to base so the static dark scene is lit.
   *
   * Visibility is only a *desire* here; the per-frame cap in
   * `updateScreenSpaceScale` is the single authority that turns lights on/off
   * (so it can bound the shader's visible-light count without flicker).
   */
  public setSoundLightReactive(soundId: string, playing: boolean, level01: number): void {
    const light = this.darkModePointLights.get(soundId);
    if (!light) return;
    const base = (light.userData.baseIntensity as number | undefined) ?? light.intensity;

    light.userData.wantVisible = playing ? true : !this.idleLightsOff;

    if (playing) {
      const clamped = Math.max(0, Math.min(1, level01));
      const factor = DARK_MODE.PLAYING_LIGHT_MIN_FACTOR
        + (DARK_MODE.PLAYING_LIGHT_MAX_FACTOR - DARK_MODE.PLAYING_LIGHT_MIN_FACTOR) * clamped;
      light.intensity = base * factor;
    } else if (light.intensity !== base) {
      light.intensity = base;
    }
  }

  /**
   * When true, every non-playing sound light is hidden. Set while any playback
   * (timeline/preview) is active so starting playback darkens the scene and only
   * the sounding sources remain lit. Restored to false when playback stops.
   */
  public setIdleLightsOff(off: boolean): void {
    this.idleLightsOff = off;
  }

  /**
   * Publish the current playing set + per-prompt level. Drives the sphere scale
   * pulse (all modes) and is read by the dark-mode light reactivity.
   */
  public setPlayingPrompts(promptIds: Iterable<number>, levels: Map<number, number>): void {
    this.playingPrompts = new Set(promptIds);
    this.playingPromptLevels = levels;
  }

  /** Whether a prompt (sound card) is currently producing audio. */
  public isPromptPlaying(promptIndex: number): boolean {
    return this.playingPrompts.has(promptIndex);
  }

  /**
   * Show or hide the point light for a specific sound sphere (dark mode only).
   * When muted, the point light is disabled so the sphere no longer illuminates the scene.
   */
  public setSourceMuted(soundId: string, muted: boolean): void {
    const light = this.darkModePointLights.get(soundId);
    if (!light) return;
    light.userData.muted = muted;
  }

  /**
   * Dim (or restore) a card's sound sphere based on its effective mute state.
   * A card is considered muted when ANY of its variants is muted, or when solo
   * mode is active and none of its variants is the soloed one.
   *
   * Only the selected variant of a card has a visible mesh, but the mesh is
   * keyed by prompt index here so muting a non-selected variant still dims the
   * card's sphere.
   */
  public setPromptMuted(promptIdx: number, muted: boolean): void {
    const mesh = this.soundMeshes.find(m => {
      const ev = m.userData.soundEvent as SoundEvent | undefined;
      return (ev as any)?.prompt_index === promptIdx;
    });
    if (!mesh) return;
    const material = mesh.material as THREE.MeshBasicMaterial;
    const isPending = !!((mesh.userData.soundEvent as SoundEvent | undefined)?.isPending);
    mesh.userData.isMuted = muted;
    material.transparent = true;
    // Unmute restores the per-state base opacity: pending placeholders are dimmer
    // (PENDING_OPACITY) than generated spheres (BASE_OPACITY).
    material.opacity = muted
      ? SOUND_SPHERE.MUTED_OPACITY
      : (isPending ? SOUND_SPHERE.PENDING_OPACITY : SOUND_SPHERE.BASE_OPACITY);
    material.needsUpdate = true;
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
   *
   * Spheres carrying a MANAGED color are skipped:
   * - `--color-warning`    → selection highlight (useSpeckleSoundHighlight)
   * - `--color-error`      → simulation mismatch (useSpeckleSimulationMismatch)
   * - `userData.isMuted`   → 50%-opacity muted state (audioControlsStore)
   *
   * Otherwise the enforcement would paint every sphere back to primary blue
   * (including a sphere being dragged) every interval tick.
   */
  public enforceDarkModeColors(): void {
    if (!this.darkModeEnabled) return;
    const primaryHex = getCssColorHex('--color-primary');
    const warningHex = getCssColorHex('--color-warning');
    const errorHex = getCssColorHex('--color-error');

    this.soundMeshes.forEach(mesh => {
      const material = mesh.material as THREE.MeshBasicMaterial;
      const currentHex = material.color.getHex();

      if (
        currentHex !== primaryHex &&
        currentHex !== warningHex &&
        currentHex !== errorHex      ) {
        material.color.setHex(primaryHex);
        material.needsUpdate = true;
      }

      // Keep muted spheres at 50% opacity — the interval must not force opaque.
      if (mesh.userData.isMuted === true) {
        if (!material.transparent || material.opacity !== SOUND_SPHERE.MUTED_OPACITY) {
          material.transparent = true;
          material.opacity = SOUND_SPHERE.MUTED_OPACITY;
          material.needsUpdate = true;
        }
        return;
      }

      // Enforce opaque state for non-muted spheres
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

  /** Show or hide all sound sphere meshes. */
  public setSoundSpheresVisible(visible: boolean): void {
    this.soundMeshes.forEach(m => { m.visible = visible; });
  }

  /** Show or hide all label sprites (sphere-linked and entity-linked). */
  public setLabelSpritesVisible(visible: boolean): void {
    this.labelSprites.forEach(s => { s.visible = visible; });
    this.entityLabelSprites.forEach(s => { s.visible = visible; });
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

    // Dispose all label sprites (sphere-linked and entity-linked)
    this.labelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.labelSprites.clear();
    this.entityLabelSprites.forEach((sprite) => {
      this.soundSpheresGroup.remove(sprite);
      disposeLabelSprite(sprite);
    });
    this.entityLabelSprites.clear();
    this.labelUpdateTimers.forEach(timer => clearTimeout(timer));
    this.labelUpdateTimers.clear();

    // Dispose all surface markers
    Array.from(this.markerGroups.keys()).forEach((promptIdx) => this.removeMarker(promptIdx));

    // Remove sound spheres group from scene
    this.scene.remove(this.soundSpheresGroup);

    // Remove dark-mode lights group from scene
    if (this.darkModeLightsGroup) {
      this.scene.remove(this.darkModeLightsGroup);
      this.darkModeLightsGroup.clear();
      this.darkModeLightsGroup = null;
    }

    // Clear tracking
    this.spherePositions.clear();
    this.promptPositions.clear();
    this.entityLinkedIds.clear();
  }
}

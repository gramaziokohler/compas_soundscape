import * as THREE from 'three';
import type { Viewer, CameraController, SelectionExtension } from '@speckle/viewer';
import { FilteringExtension } from '@speckle/viewer';
import { SpeckleSceneAdapter } from './speckle-scene-adapter';
import { SpeckleCameraController } from './speckle-camera-controller';
import { SpeckleEventBridge } from './speckle-event-bridge';
import { SpeckleDragHandler } from './speckle-drag-handler';
import { SoundSphereManager } from './sound-sphere-manager';
import { ReceiverManager } from './receiver-manager';
import { GridReceiverManager } from './grid-receiver-manager';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { SoundEvent, ReceiverData } from '@/types';
import type { AuralizationConfig, SourceReceiverIRMapping, AcousticSimulationMode } from '@/types/audio';
// import type { BoundingBoxBounds } from './BoundingBoxManager'; // Bounding-box placement removed

/**
 * SpeckleAudioCoordinator
 *
 * Orchestrates all audio components in Speckle mode (replaces SceneCoordinator role).
 *
 * Responsibilities:
 * - Component composition and initialization
 * - Event callback wiring between components
 * - Audio manager lifecycle (sound spheres, receivers)
 * - First-person mode coordination
 * - Animation loop management
 * - Resource cleanup
 *
 * Architecture:
 * - Creates and owns all Speckle audio integration services
 * - Provides unified interface for SpeckleScene component
 * - Ensures proper initialization order and cleanup
 */
export class SpeckleAudioCoordinator {
  // Speckle viewer and extensions
  private viewer: Viewer;
  private cameraController: CameraController;
  private selectionExtension: SelectionExtension;

  // Audio context
  private audioOrchestrator: AudioOrchestrator | null;
  private audioContext: AudioContext | null;
  private listener: THREE.AudioListener;

  // Phase 1: Core Adapter Components
  private adapter: SpeckleSceneAdapter | null = null;
  private speckleCameraController: SpeckleCameraController | null = null;

  // Phase 2: Interaction Layer Components
  private eventBridge: SpeckleEventBridge | null = null;
  private dragHandler: SpeckleDragHandler | null = null;

  // Phase 3: Audio Manager Components
  private soundSphereManager: SoundSphereManager | null = null;
  private receiverManager: ReceiverManager | null = null;
  private gridReceiverManager: GridReceiverManager | null = null;

  private isInitialized: boolean = false;
  private scaleForSounds: number = 1.0;
  private prevSoundscapeDataLength: number = 0;
  private prevReceiversLength: number = 0;

  // Simulation-based acoustics state (mirrors AudioOrchestrator)
  private simulationMode: AcousticSimulationMode = 'none';
  private sourceReceiverIRMapping: SourceReceiverIRMapping | null = null;
  private activeReceiverId: string | null = null;

  // Callback when receiver is activated (for parent component integration)
  private onReceiverActivatedCallback: ((receiverId: string) => void) | null = null;

  // Callback when receiver position is updated via drag (for React state sync)
  private onReceiverPositionUpdatedCallback: ((receiverId: string, position: [number, number, number]) => void) | null = null;

  // Callback when sound sphere position is updated via drag (for React state sync)
  private onSoundPositionUpdatedCallback: ((soundId: string, position: [number, number, number]) => void) | null = null;

  // Callback when custom object (sound/receiver) is deselected (clicking empty space)
  private onCustomObjectDeselectedCallback: (() => void) | null = null;

  // External callback when a receiver mesh is double-clicked (for FPS mode + card expansion)
  private externalOnReceiverDoubleClickedCallback: ((receiverId: string) => void) | null = null;

  constructor(
    viewer: Viewer,
    cameraController: CameraController,
    selectionExtension: SelectionExtension,
    audioOrchestrator: AudioOrchestrator | null,
    audioContext: AudioContext | null
  ) {
    this.viewer = viewer;
    this.cameraController = cameraController;
    this.selectionExtension = selectionExtension;
    this.audioOrchestrator = audioOrchestrator;
    this.audioContext = audioContext;

    // Create audio listener
    this.listener = new THREE.AudioListener();

  }

  public initialize(scaleForSounds: number = 1.0): void {
    if (this.isInitialized) return;

    this.scaleForSounds = scaleForSounds;

    this.adapter = new SpeckleSceneAdapter(this.viewer, this.audioOrchestrator);
    this.speckleCameraController = new SpeckleCameraController(this.viewer, this.cameraController);

    const scene = this.adapter.getScene();
    const customObjectsGroup = this.adapter.getCustomObjectsGroup();

    this.soundSphereManager = new SoundSphereManager(
      scene,
      this.listener,
      this.audioOrchestrator,
      this.audioContext,
      customObjectsGroup
    );

    this.receiverManager = new ReceiverManager(scene, scaleForSounds, customObjectsGroup);
    this.gridReceiverManager = new GridReceiverManager(scene, scaleForSounds, customObjectsGroup);
    this.eventBridge = new SpeckleEventBridge(this.viewer, this.adapter, this.selectionExtension);

    // Wire FilteringExtension for mode-agnostic hidden-object-aware selection
    try {
      const filteringExt = this.viewer.getExtension(FilteringExtension);
      if (filteringExt) {
        this.eventBridge.setFilteringExtension(filteringExt);
      }
    } catch { /* FilteringExtension may not be created yet — non-critical */ }

    this.dragHandler = new SpeckleDragHandler(this.viewer, this.adapter, this.cameraController);
    this.eventBridge.setDragHandler(this.dragHandler);
    this.setupEventCallbacks();
    this.adapter.setOnFrameCallback(() => this.updateScreenSpaceScale());
    this.adapter.startAnimationLoop();
    this.isInitialized = true;
  }

  private setupEventCallbacks(): void {
    if (!this.eventBridge || !this.dragHandler || !this.soundSphereManager || !this.receiverManager) {
      return;
    }

    this.eventBridge.setupEventListeners();

    this.eventBridge.setOnCustomObjectSelected((object: THREE.Object3D, type: 'sound' | 'receiver') => {
      if (this.dragHandler) {
        this.dragHandler.selectObjects([object]);
      }
    });

    this.eventBridge.setOnSelectionCleared(() => {
      if (this.dragHandler) {
        this.dragHandler.deselectObjects();
      }
      if (this.onCustomObjectDeselectedCallback) {
        this.onCustomObjectDeselectedCallback();
      }
    });

    // Zoom camera to any custom object on double-click, but skip receivers
    // (receiver double-click should enter FPS mode instead of zooming).
    this.eventBridge.setOnCustomObjectDoubleClicked((position: THREE.Vector3, type: 'sound' | 'receiver') => {
      if (type !== 'receiver') {
        this.zoomToPosition(position);
      }
    });

    this.eventBridge.setOnReceiverDoubleClicked((receiverId: string) => {
      // Update active receiver for simulation-based IR switching
      this.updateActiveReceiver(receiverId);

      // Enable FPS mode SYNCHRONOUSLY, right here in the event handler, so that
      // cameraController.enabled = false is set BEFORE Speckle's own dblclick
      // processing (which may fire asynchronously via pointer/animation events and
      // re-enable controls). The goToReceiverId useEffect in SpeckleScene will also
      // call enableFirstPersonMode, but the guard in SpeckleCameraController prevents
      // it from overwriting the saved camera state on that second call.
      if (this.receiverManager && this.speckleCameraController) {
        const mesh = this.receiverManager.getReceiverMeshes().find(
          (m) => m.userData.receiverId === receiverId
        );
        if (mesh) {
          const soundMeshes = this.soundSphereManager?.getSoundSphereMeshes() || [];
          let target: THREE.Vector3;
          if (soundMeshes.length > 0) {
            target = soundMeshes
              .reduce((acc, m) => acc.add(m.position.clone()), new THREE.Vector3())
              .divideScalar(soundMeshes.length);
          } else {
            target = new THREE.Vector3(mesh.position.x, mesh.position.y - 5, mesh.position.z);
          }
          this.enableFirstPersonMode(mesh.position.clone(), target);
        }
      }

      // Notify parent (SpeckleScene) so it can expand the listener card + sync React state
      this.externalOnReceiverDoubleClickedCallback?.(receiverId);
    });

    this.dragHandler.setOnDragEnd((objects: THREE.Object3D[], position: THREE.Vector3) => {
      for (const object of objects) {
        const objectType = object.userData.customObjectType;
        if (objectType === 'sound') {
          const promptKey = object.userData.promptKey;

          // Update internal position map + orchestrator source position.
          this.soundSphereManager!.updateSpherePosition(promptKey, object.position);

          // Also sync to React state so simulations (pyroomacoustics) use updated positions.
          // This is safe because SoundSphereManager.updateSoundSpheres has an early-return
          // that skips teardown when the same sound IDs are present (no audio interruption).
          const soundId = object.userData.soundEvent?.id || object.userData.positionKey;
          if (soundId && this.onSoundPositionUpdatedCallback) {
            const pos: [number, number, number] = [object.position.x, object.position.y, object.position.z];
            this.onSoundPositionUpdatedCallback(soundId, pos);
          }
        } else if (objectType === 'receiver') {
          // Update receiver position in both internal map and React state
          const receiverId = object.userData.receiverId;
          if (receiverId) {
            const pos: [number, number, number] = [object.position.x, object.position.y, object.position.z];

            // Update internal position map (for persistence across re-renders)
            if (this.receiverManager) {
              this.receiverManager.updateReceiverPosition(receiverId, pos);
            }

            // Update React state via callback
            if (this.onReceiverPositionUpdatedCallback) {
              this.onReceiverPositionUpdatedCallback(receiverId, pos);
            }
          }
        }
      }
    });
  }

  public setAudioOrchestrator(orchestrator: AudioOrchestrator | null): void {
    this.audioOrchestrator = orchestrator;

    if (this.adapter) {
      this.adapter.setAudioOrchestrator(orchestrator);
    }

    if (this.soundSphereManager) {
      this.soundSphereManager.setAudioOrchestrator(orchestrator);
    }
  }

  public updateSoundSpheres(
    soundscapeData: SoundEvent[] | null,
    selectedVariants: { [key: number]: number },
    scaleForSounds: number,
    auralizationConfig: AuralizationConfig,
    // bounds?: BoundingBoxBounds | null, // Bounding-box placement removed — camera-based only
    cameraFrontPosition?: THREE.Vector3 | null
  ): void {
    if (!this.soundSphereManager) return;

    const currentLength = soundscapeData?.length || 0;
    this.prevSoundscapeDataLength = currentLength;
    this.scaleForSounds = scaleForSounds;
    const newlyPlacedPositions = this.soundSphereManager.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfig,
      // bounds, // Bounding-box placement removed
      cameraFrontPosition
    );

    // Sync newly placed positions (from spiral placement) back to React state
    // so the serializer saves the correct position instead of [0,0,0].
    if (newlyPlacedPositions.size > 0 && this.onSoundPositionUpdatedCallback) {
      for (const [soundId, pos] of newlyPlacedPositions) {
        this.onSoundPositionUpdatedCallback(soundId, pos);
      }
    }

    try {
      this.viewer.requestRender();
      requestAnimationFrame(() => {
        this.viewer.requestRender();
      });
      setTimeout(() => {
        this.viewer.requestRender();
      }, 50);
      // Longer delays for when spheres are created right after model load —
      // the Speckle viewer may still be settling its rendering pipeline.
      setTimeout(() => {
        this.viewer.requestRender();
      }, 500);
      setTimeout(() => {
        this.viewer.requestRender();
      }, 1500);
    } catch (error) {
      // Silently handle render request errors
    }
  }

  public updateReceivers(receivers: ReceiverData[]): void {
    if (!this.receiverManager) return;

    const currentLength = receivers.length;
    this.prevReceiversLength = currentLength;

    // Placement strategy is now camera-based (handled by caller before addReceiver).
    // setBoundingBox / spiral placement removed.
    this.receiverManager.updateReceivers(receivers);

    try {
      this.viewer.requestRender();
      requestAnimationFrame(() => {
        this.viewer.requestRender();
      });
      setTimeout(() => {
        this.viewer.requestRender();
      }, 50);
    } catch (error) {
      // Silently handle render request errors
    }
  }

  public updateScale(scaleForSounds: number): void {
    this.scaleForSounds = scaleForSounds;
    if (this.receiverManager) {
      this.receiverManager.updateScale(scaleForSounds);
    }
  }

  /**
   * Set source-receiver IR mapping for simulation-based acoustics
   * Enables per-source IR assignment based on active receiver
   * @param mapping - Source-receiver IR mapping
   * @param simulationMode - Type of simulation (pyroomacoustics, choras)
   * @param initialReceiverId - Initial receiver to activate (optional)
   */
  public async setSourceReceiverIRMapping(
    mapping: SourceReceiverIRMapping,
    simulationMode: AcousticSimulationMode,
    initialReceiverId?: string
  ): Promise<void> {
    this.sourceReceiverIRMapping = mapping;
    this.simulationMode = simulationMode;
    this.activeReceiverId = initialReceiverId || null;

    console.log('[SpeckleAudioCoordinator] IR mapping set:', { simulationMode, activeReceiverId: this.activeReceiverId });

    // Forward to AudioOrchestrator
    if (this.audioOrchestrator) {
      await this.audioOrchestrator.setSourceReceiverIRMapping(mapping, simulationMode, initialReceiverId);
    }
  }

  /**
   * Update active receiver (called when receiver selection changes)
   * Loads corresponding IRs for all sources based on the new receiver
   * @param receiverId - ID of the receiver to activate
   */
  public async updateActiveReceiver(receiverId: string): Promise<void> {
    this.activeReceiverId = receiverId;

    if (this.audioOrchestrator) {
      await this.audioOrchestrator.updateActiveReceiver(receiverId);
    }

    // Notify callback (for parent component integration)
    if (this.onReceiverActivatedCallback) {
      this.onReceiverActivatedCallback(receiverId);
    }
  }

  /**
   * Hot-swap source-receiver IR mapping without stopping playback.
   * Used when switching between completed simulations while audio is playing.
   */
  public async hotSwapSourceReceiverIRMapping(
    mapping: SourceReceiverIRMapping,
    simulationMode: AcousticSimulationMode,
    activeReceiverId?: string
  ): Promise<void> {
    this.sourceReceiverIRMapping = mapping;
    this.simulationMode = simulationMode;
    this.activeReceiverId = activeReceiverId || this.activeReceiverId;

    console.log('[SpeckleAudioCoordinator] Hot-swapping IR mapping (no stop):', { simulationMode });

    if (this.audioOrchestrator) {
      await this.audioOrchestrator.hotSwapSourceReceiverIRMapping(mapping, simulationMode, activeReceiverId);
    }
  }

  /**
   * Clear source-receiver IR mapping (exit simulation mode)
   */
  public clearSourceReceiverIRMapping(): void {
    this.sourceReceiverIRMapping = null;
    this.simulationMode = 'none';
    this.activeReceiverId = null;

    // Forward to AudioOrchestrator
    if (this.audioOrchestrator) {
      this.audioOrchestrator.clearSourceReceiverIRMapping();
    }

    console.log('[SpeckleAudioCoordinator] Source-receiver IR mapping cleared');
  }

  /**
   * Get current active receiver ID
   */
  public getActiveReceiverId(): string | null {
    return this.activeReceiverId;
  }

  /**
   * Get current simulation mode
   */
  public getSimulationMode(): AcousticSimulationMode {
    return this.simulationMode;
  }

  /**
   * Check if simulation-based acoustics is active
   */
  public hasSourceReceiverIRMapping(): boolean {
    return this.sourceReceiverIRMapping !== null && this.simulationMode !== 'none';
  }

  /**
   * Set callback for when a receiver is activated (first-person mode entered)
   * This allows parent components to react to receiver selection
   */
  public setOnReceiverActivated(callback: (receiverId: string) => void): void {
    this.onReceiverActivatedCallback = callback;
  }

  /**
   * Set callback for when a receiver mesh is double-clicked in the scene.
   * Parent can use this to expand the listener card and enter FPS mode.
   */
  public setOnReceiverDoubleClicked(callback: (receiverId: string) => void): void {
    this.externalOnReceiverDoubleClickedCallback = callback;
  }

  /**
   * Set callback for when a receiver position is updated via drag
   * This syncs the 3D position back to React state to persist the dragged position
   */
  public setOnReceiverPositionUpdated(callback: (receiverId: string, position: [number, number, number]) => void): void {
    this.onReceiverPositionUpdatedCallback = callback;
  }

  /**
   * Set callback for when a sound sphere position is updated via drag
   * This syncs the 3D position back to React state so simulations use updated positions
   */
  public setOnSoundPositionUpdated(callback: (soundId: string, position: [number, number, number]) => void): void {
    this.onSoundPositionUpdatedCallback = callback;
  }



  /**
   * Zoom the camera to 2 meters from a position.
   * Moves the camera along the current view direction so it ends up
   * exactly `distance` metres away, looking at the target.
   */
  public zoomToPosition(position: THREE.Vector3, distance: number = 2): void {
    const cam = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
    const currentDist = cam.position.distanceTo(position);
    // Direction from target to current camera (keeps the same viewing angle)
    const offset = new THREE.Vector3().subVectors(cam.position, position).normalize().multiplyScalar(distance);
    const newCamPos = new THREE.Vector3().addVectors(position, offset);
    // Use Speckle's native controls API (setCameraView only accepts Box3/IDs)
    this.cameraController.controls.fromPositionAndTarget(newCamPos, position);
    this.viewer.requestRender();
  }

  public enableFirstPersonMode(position: THREE.Vector3, target: THREE.Vector3): void {
    if (!this.speckleCameraController) return;
    this.speckleCameraController.enableFirstPersonMode(position, target);
  }

  public disableFirstPersonMode(): void {
    if (!this.speckleCameraController) return;
    this.speckleCameraController.disableFirstPersonMode();
  }

  public isFirstPersonMode(): boolean {
    if (!this.speckleCameraController) return false;
    return this.speckleCameraController.isFirstPersonMode();
  }

  public teleportFirstPerson(position: THREE.Vector3): void {
    if (!this.speckleCameraController) return;
    this.speckleCameraController.teleportFirstPerson(position);
  }

  public getActiveReceiverId(): string | null {
    return this.activeReceiverId;
  }

  public rotateFirstPersonView(deltaYaw: number, deltaPitch: number): void {
    if (!this.speckleCameraController) return;
    this.speckleCameraController.rotateFirstPersonView(deltaYaw, deltaPitch);
  }

  public setOnSpeckleObjectSelected(callback: (objectIds: string[], intersectionPoint?: THREE.Vector3) => void): void {
    if (!this.eventBridge) return;
    this.eventBridge.setOnSpeckleObjectSelected(callback);
  }

  public setOnSoundSphereClicked(callback: (promptKey: string) => void): void {
    if (!this.eventBridge) return;
    this.eventBridge.setOnSoundSphereClicked(callback);
  }

  public setOnReceiverSingleClicked(callback: (receiverId: string) => void): void {
    if (!this.eventBridge) return;
    this.eventBridge.setOnReceiverSingleClicked(callback);
  }

  public setOnCustomObjectDeselected(callback: () => void): void {
    this.onCustomObjectDeselectedCallback = callback;
  }

  public getAdapter(): SpeckleSceneAdapter | null {
    return this.adapter;
  }

  public getCameraController(): SpeckleCameraController | null {
    return this.speckleCameraController;
  }

  public getEventBridge(): SpeckleEventBridge | null {
    return this.eventBridge;
  }

  public getDragHandler(): SpeckleDragHandler | null {
    return this.dragHandler;
  }

  public getSoundSphereManager(): SoundSphereManager | null {
    return this.soundSphereManager;
  }

  public getReceiverManager(): ReceiverManager | null {
    return this.receiverManager;
  }

  public updateGridListeners(points: [number, number, number][]): void {
    this.gridReceiverManager?.updatePoints(points);
    // Wake the Speckle viewer — it only renders on explicit request
    this.viewer.requestRender();
  }

  public getListener(): THREE.AudioListener {
    return this.listener;
  }

  public getViewer(): Viewer {
    return this.viewer;
  }

  public getScene(): THREE.Scene | null {
    return this.adapter ? this.adapter.getScene() : null;
  }

  public getCamera(): THREE.PerspectiveCamera | null {
    return this.adapter ? this.adapter.getCamera() : null;
  }

  public getRenderer(): THREE.WebGLRenderer | null {
    return this.adapter ? this.adapter.getRenderer() : null;
  }

  /**
   * Update screen-space scale for sound spheres and receivers every frame.
   * Called via the adapter's onFrameCallback so objects maintain constant apparent size.
   */
  private updateScreenSpaceScale(): void {
    if (!this.adapter) return;
    const camera = this.adapter.getCamera();
    if (!camera) return;

    this.soundSphereManager?.updateScreenSpaceScale(camera);
    this.receiverManager?.updateScreenSpaceScale(camera);
    this.gridReceiverManager?.updateScreenSpaceScale(camera);
  }

  public dispose(): void {
    if (this.adapter) {
      this.adapter.stopAnimationLoop();
    }

    if (this.dragHandler) {
      this.dragHandler.dispose();
      this.dragHandler = null;
    }

    if (this.eventBridge) {
      this.eventBridge.dispose();
      this.eventBridge = null;
    }

    if (this.soundSphereManager) {
      this.soundSphereManager.dispose();
      this.soundSphereManager = null;
    }

    if (this.receiverManager) {
      this.receiverManager.dispose();
      this.receiverManager = null;
    }

    if (this.gridReceiverManager) {
      this.gridReceiverManager.dispose();
      this.gridReceiverManager = null;
    }

    if (this.speckleCameraController) {
      this.speckleCameraController.dispose();
      this.speckleCameraController = null;
    }

    if (this.adapter) {
      this.adapter.dispose();
      this.adapter = null;
    }

    this.isInitialized = false;
  }
}

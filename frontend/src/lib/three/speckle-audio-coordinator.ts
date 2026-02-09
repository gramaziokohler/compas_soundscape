import * as THREE from 'three';
import type { Viewer, CameraController, SelectionExtension } from '@speckle/viewer';
import { SpeckleSceneAdapter } from './speckle-scene-adapter';
import { SpeckleCameraController } from './speckle-camera-controller';
import { SpeckleEventBridge } from './speckle-event-bridge';
import { SpeckleDragHandler } from './speckle-drag-handler';
import { SoundSphereManager } from './sound-sphere-manager';
import { ReceiverManager } from './receiver-manager';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { SoundEvent, ReceiverData } from '@/types';
import type { AuralizationConfig, SourceReceiverIRMapping, AcousticSimulationMode } from '@/types/audio';
import type { BoundingBoxBounds } from './BoundingBoxManager';

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
    this.eventBridge = new SpeckleEventBridge(this.viewer, this.adapter, this.selectionExtension);
    this.dragHandler = new SpeckleDragHandler(this.viewer, this.adapter, this.cameraController);
    this.eventBridge.setDragHandler(this.dragHandler);
    this.setupEventCallbacks();
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

    this.eventBridge.setOnReceiverDoubleClicked((receiverId: string) => {
      const receiverMeshes = this.receiverManager!.getReceiverMeshes();
      const receiverMesh = receiverMeshes.find(mesh => mesh.userData.receiverId === receiverId);

      if (receiverMesh) {
        const receiverPosition = receiverMesh.position.clone();
        let initialTarget: THREE.Vector3;

        const soundSphereMeshes = this.soundSphereManager!.getSoundSphereMeshes();
        const soundSpherePositions: THREE.Vector3[] = soundSphereMeshes.map(mesh => mesh.position.clone());

        if (soundSpherePositions.length > 0) {
          const sum = soundSpherePositions.reduce(
            (acc, pos) => acc.add(pos),
            new THREE.Vector3(0, 0, 0)
          );
          initialTarget = sum.divideScalar(soundSpherePositions.length);
        } else {
          initialTarget = new THREE.Vector3(
            receiverPosition.x,
            receiverPosition.y,
            receiverPosition.z - 5
          );
        }

        this.enableFirstPersonMode(receiverPosition, initialTarget);

        // Update active receiver for simulation-based IR switching
        // This triggers IR loading for all sources based on this receiver
        console.log('[SpeckleAudioCoordinator] Receiver double-clicked, updating active receiver:', receiverId);
        this.updateActiveReceiver(receiverId);
      }
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
    bounds?: BoundingBoxBounds | null
  ): void {
    if (!this.soundSphereManager) return;

    const currentLength = soundscapeData?.length || 0;
    this.prevSoundscapeDataLength = currentLength;
    this.scaleForSounds = scaleForSounds;
    this.soundSphereManager.updateSoundSpheres(
      soundscapeData,
      selectedVariants,
      scaleForSounds,
      auralizationConfig,
      bounds
    );

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

  public updateReceivers(receivers: ReceiverData[], bounds?: BoundingBoxBounds | null, useSpiralPlacement: boolean = false): void {
    if (!this.receiverManager) return;

    const currentLength = receivers.length;
    this.prevReceiversLength = currentLength;
    
    // Set bounding box for spiral placement
    this.receiverManager.setBoundingBox(bounds || null);
    this.receiverManager.updateReceivers(receivers, useSpiralPlacement);

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

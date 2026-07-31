/**
 * SpeckleSceneAdapter
 *
 * Minimal bridge to access Speckle viewer resources and manage custom objects.
 * This adapter provides safe access to the Speckle viewer's Three.js scene, camera,
 * and renderer while maintaining a separate group for custom audio objects.
 *
 * Responsibilities:
 * - Scene, camera, and renderer access
 * - Custom object management (sound spheres, receivers)
 * - Animation loop for AudioOrchestrator listener updates
 * - Lifecycle management (initialization and cleanup)
 */

import * as THREE from 'three';
import type { Viewer } from '@speckle/viewer';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

/**
 * Custom object types that can be added to the Speckle scene
 */
export type CustomObjectType = 'sound' | 'receiver';

/**
 * SpeckleSceneAdapter class
 *
 * Provides a clean interface for integrating audio objects with the Speckle viewer
 * without modifying the viewer's core functionality.
 */
export class SpeckleSceneAdapter {
  private viewer: Viewer;
  private audioOrchestrator: AudioOrchestrator | null;

  // Custom objects group (added to scene)
  private customObjectsGroup: THREE.Group;

  // Animation loop
  private animationFrameId: number | null = null;
  private _noOrchestratorWarned: boolean = false;

  // Per-frame callback (e.g. screen-space scale updates from coordinator)
  private onFrameCallback: (() => void) | null = null;

  /**
   * Create a new SpeckleSceneAdapter
   * @param viewer - Speckle viewer instance
   * @param audioOrchestrator - Audio orchestrator for listener updates (optional)
   */
  constructor(viewer: Viewer, audioOrchestrator: AudioOrchestrator | null = null) {
    this.viewer = viewer;
    this.audioOrchestrator = audioOrchestrator;

    // Create a group for custom objects
    this.customObjectsGroup = new THREE.Group();
    this.customObjectsGroup.name = 'CustomAudioObjects';
    
    // CRITICAL: Ensure group is visible and rendered in all passes
    this.customObjectsGroup.visible = true;
    this.customObjectsGroup.layers.enableAll(); // Enable all layers for Speckle compatibility
    this.customObjectsGroup.frustumCulled = false; // Prevent culling issues
    this.customObjectsGroup.matrixAutoUpdate = true;

    // Add custom objects group to Speckle scene
    const scene = this.getScene();
    scene.add(this.customObjectsGroup);

    console.log('[SpeckleSceneAdapter] 🎬 Initialized with custom objects group');
  }

  // ============================================================================
  // Scene Access Methods
  // ============================================================================

  /**
   * Get the Speckle viewer's Three.js scene
   */
  public getScene(): THREE.Scene {
    return this.viewer.getRenderer().scene;
  }

  /**
   * Get the Speckle viewer's camera
   */
  public getCamera(): THREE.PerspectiveCamera {
    return this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
  }

  /**
   * Get the Speckle viewer's WebGL renderer
   */
  public getRenderer(): THREE.WebGLRenderer {
    return this.viewer.getRenderer().renderer;
  }

  /**
   * Get the Speckle viewer instance
   */
  public getViewer(): Viewer {
    return this.viewer;
  }

  // ============================================================================
  // Custom Object Management
  // ============================================================================

  /**
   * Add a custom object to the scene (sound sphere or receiver)
   * @param object - Three.js object to add
   * @param type - Type of custom object
   */
  public addCustomObject(object: THREE.Object3D, type: CustomObjectType): void {
    // Store type as user data for later filtering
    object.userData.customObjectType = type;
    this.customObjectsGroup.add(object);

    console.log(`[SpeckleSceneAdapter] ➕ Added custom object: ${type} (${object.name || 'unnamed'})`);
  }

  /**
   * Remove a custom object from the scene
   * @param object - Three.js object to remove
   */
  public removeCustomObject(object: THREE.Object3D): void {
    this.customObjectsGroup.remove(object);
    console.log(`[SpeckleSceneAdapter] ➖ Removed custom object: ${object.name || 'unnamed'}`);
  }

  /**
   * Get all custom objects, optionally filtered by type
   * @param type - Optional filter by object type
   * @returns Array of custom objects
   */
  public getCustomObjects(type?: CustomObjectType): THREE.Object3D[] {
    if (!type) {
      return this.customObjectsGroup.children;
    }

    return this.customObjectsGroup.children.filter(
      obj => obj.userData.customObjectType === type
    );
  }

  /**
   * Raycast against custom objects (sound spheres + receivers) from an NDC mouse
   * position. Returns the first hit with its object type and Three.js object.
   * Mirrors the logic in SpeckleEventBridge.raycastCustomObjects() but accepts
   * an external NDC vector so it can be called outside the event bridge.
   */
  public raycastCustomObjectsAt(
    mouseNDC: THREE.Vector2,
  ): { type: 'sound' | 'receiver'; object: THREE.Object3D } | null {
    const camera = this.getCamera();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouseNDC, camera);
    const intersects = raycaster.intersectObjects(this.customObjectsGroup.children, true);

    for (const intersect of intersects) {
      let current: THREE.Object3D | null = intersect.object;
      while (current) {
        const t = current.userData.customObjectType;
        if (t === 'sound' || t === 'receiver') {
          return { type: t, object: current };
        }
        current = current.parent;
      }
    }
    return null;
  }

  /**
   * Get the custom objects group
   */
  public getCustomObjectsGroup(): THREE.Group {
    return this.customObjectsGroup;
  }

  // ============================================================================
  // Audio Orchestrator Integration
  // ============================================================================

  /**
   * Set or update the audio orchestrator
   * @param orchestrator - Audio orchestrator instance
   */
  public setAudioOrchestrator(orchestrator: AudioOrchestrator | null): void {
    this.audioOrchestrator = orchestrator;
    this._noOrchestratorWarned = false;

    console.log('[SpeckleSceneAdapter] 🎵 AudioOrchestrator set:', {
      hasOrchestrator: !!orchestrator,
      orchestratorType: orchestrator?.constructor.name
    });
  }

  // ============================================================================
  // Animation Loop Integration
  // ============================================================================

  /**
   * Start the animation loop for listener position updates
   *
   * This syncs the AudioOrchestrator listener with the Speckle camera
   * position and orientation every frame.
   */
  /**
   * Register a callback to be invoked every animation frame.
   * Used by SpeckleAudioCoordinator to update screen-space scales.
   */
  public setOnFrameCallback(cb: () => void): void {
    this.onFrameCallback = cb;
  }

  public startAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      console.warn('[SpeckleSceneAdapter] ⚠️ Animation loop already running');
      return;
    }

    const animate = () => {
      // Update AudioOrchestrator listener if available
      if (this.audioOrchestrator) {
        try {
          const camera = this.getCamera();
          const position = camera.position;

          // Get orientation from camera direction
          // This will be refined by SpeckleCameraController
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          direction.normalize();

          // Calculate basic orientation — Speckle Z-UP: +X=Right, -Y=Forward, +Z=Up
          const yaw = Math.atan2(-direction.x, -direction.y);
          const pitch = Math.asin(direction.z);
          let roll = 0;

          // In first-person mode the camera can be rolled (head tilt) via the camera
          // controller's quaternion post-multiplication. getWorldDirection() only
          // exposes the look direction (roll-invariant), so read the tracked roll
          // from the camera controller — the source of truth for auralization.
          const coordinator = useSpeckleEngineStore.getState().coordinator;
          const camController = coordinator?.getCameraController();
          if (camController?.isFirstPersonMode()) {
            roll = camController.getListenerOrientation().roll;
          }

          const orientation = { yaw, pitch, roll };

          this.audioOrchestrator.updateListener(position, orientation);

          // Update live camera orientation store
          const prevOri = useSpeckleEngineStore.getState().currentCameraOrientation;
          if (
            Math.abs(prevOri.yaw - yaw) > 0.0001 ||
            Math.abs(prevOri.pitch - pitch) > 0.0001 ||
            Math.abs(prevOri.roll - roll) > 0.0001
          ) {
            useSpeckleEngineStore.getState().setCurrentCameraOrientation({ yaw, pitch, roll });
          }
        } catch (error) {
          console.warn('[SpeckleSceneAdapter] Failed to update audio listener:', error);
        }
      } else {
        // Log once if orchestrator is missing
        if (!this._noOrchestratorWarned) {
          console.warn('[SpeckleSceneAdapter] ⚠️ No AudioOrchestrator - listener position will not update');
          this._noOrchestratorWarned = true;
        }
      }

      // Per-frame callback (screen-space scale + label updates)
      this.onFrameCallback?.();

      // Continue animation loop
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
    console.log('[SpeckleSceneAdapter] ▶️ Animation loop started');
  }

  /**
   * Stop the animation loop
   */
  public stopAnimationLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      console.log('[SpeckleSceneAdapter] ⏹️ Animation loop stopped');
    }
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Dispose of all resources and clean up
   *
   * Important: This removes custom objects from the scene but does NOT
   * dispose of the Speckle viewer itself.
   */
  public dispose(): void {
    console.log('[SpeckleSceneAdapter] 🧹 Disposing...');

    // Stop animation loop
    this.stopAnimationLoop();

    // Remove custom objects group from scene
    const scene = this.getScene();
    scene.remove(this.customObjectsGroup);

    // Clear custom objects (caller should dispose geometries/materials)
    this.customObjectsGroup.clear();

    // Clear references
    this.audioOrchestrator = null;
    this._noOrchestratorWarned = false;

    console.log('[SpeckleSceneAdapter] ✅ Disposed successfully');
  }
}

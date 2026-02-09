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
import type { SpeckleCameraController } from './speckle-camera-controller';

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
          const orientation = { yaw, pitch, roll: 0 };

          this.audioOrchestrator.updateListener(position, orientation);
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

/**
 * SpeckleCameraController
 *
 * Manages camera orientation tracking and first-person mode for Speckle viewer.
 * This controller works alongside Speckle's native CameraController to provide:
 * - Accurate listener orientation for spatial audio
 * - First-person camera mode (locked position with manual rotation)
 * - Seamless transition between orbit and first-person modes
 *
 * Responsibilities:
 * - Camera orientation calculation for audio spatialization
 * - First-person mode state management
 * - Manual camera rotation in first-person mode
 * - Integration with Speckle's CameraController
 */

import * as THREE from 'three';
import type { Viewer, CameraController } from '@speckle/viewer';

/**
 * SpeckleCameraController class
 *
 * Bridges Speckle's camera system with audio spatialization requirements
 */
export class SpeckleCameraController {
  private viewer: Viewer;
  private cameraController: CameraController;

  // First-person mode state
  private firstPersonMode: boolean = false;
  private firstPersonRotation: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
  private lockedPosition: THREE.Vector3 | null = null;

  // Camera state before entering first-person mode (for restoration)
  private savedCameraPosition: THREE.Vector3 | null = null;
  private savedCameraTarget: THREE.Vector3 | null = null;

  /**
   * Create a new SpeckleCameraController
   * @param viewer - Speckle viewer instance
   * @param cameraController - Speckle's camera controller extension
   */
  constructor(viewer: Viewer, cameraController: CameraController) {
    this.viewer = viewer;
    this.cameraController = cameraController;

    console.log('[SpeckleCameraController] 🎥 Initialized');
  }

  // ============================================================================
  // First-Person Mode Management
  // ============================================================================

  /**
   * Enable first-person mode at a specific position
   * Uses Speckle's native fromPositionAndTarget() API
   * @param position - Position to lock the camera at
   * @param target - Initial look-at target
   */
  public enableFirstPersonMode(
    position: THREE.Vector3,
    target: THREE.Vector3
  ): void {
    // Save current camera state for restoration
    this.savedCameraPosition = this.cameraController.controls.getPosition().clone();
    this.savedCameraTarget = this.cameraController.controls.getTarget().clone();

    // Calculate yaw and pitch from position to target
    const direction = new THREE.Vector3().subVectors(target, position).normalize();
    
    // For Z-up coordinate system (Speckle):
    // Yaw: horizontal rotation around Z axis
    // atan2(-x, -y) gives: forward(-Y)=0, left(-X)=+π/2, back(+Y)=π, right(+X)=-π/2
    const yaw = Math.atan2(-direction.x, -direction.y);
    
    // Pitch: vertical rotation (elevation angle)
    // In Z-up, vertical component is Z (not Y)
    const pitch = Math.asin(direction.z);

    // Set first-person state
    this.firstPersonMode = true;
    this.lockedPosition = position.clone();
    this.firstPersonRotation = { yaw, pitch };

    // CRITICAL: Set up vector to (0, 1, 0) to prevent roll
    this.cameraController.controls.up = new THREE.Vector3(0, 0, 1);

    // Use Speckle's native API to set camera position and target
    this.cameraController.controls.fromPositionAndTarget(position, target);

    // Disable Speckle's camera controls to prevent user orbiting
    this.cameraController.enabled = false;

    console.log('[SpeckleCameraController] 👁️ First-person mode enabled', {
      position: position.toArray(),
      target: target.toArray(),
      yaw: (yaw * 180 / Math.PI).toFixed(1) + '°',
      pitch: (pitch * 180 / Math.PI).toFixed(1) + '°'
    });
  }

  /**
   * Disable first-person mode and return to normal orbit controls
   * Uses Speckle's native API to restore camera state
   */
  public disableFirstPersonMode(): void {
    if (!this.firstPersonMode) {
      console.warn('[SpeckleCameraController] ⚠️ First-person mode not active');
      return;
    }

    this.firstPersonMode = false;
    this.lockedPosition = null;

    // Restore camera position using Speckle's native API
    if (this.savedCameraPosition && this.savedCameraTarget) {
      this.cameraController.controls.fromPositionAndTarget(
        this.savedCameraPosition,
        this.savedCameraTarget
      );
      this.savedCameraPosition = null;
      this.savedCameraTarget = null;
    }

    // Re-enable Speckle's camera controls
    this.cameraController.enabled = true;

    console.log('[SpeckleCameraController] 🔄 First-person mode disabled, controls restored');
  }

  /**
   * Check if first-person mode is currently active
   */
  public isFirstPersonMode(): boolean {
    return this.firstPersonMode;
  }

  /**
   * Update camera position and orientation in first-person mode
   * Uses Speckle's native fromPositionAndTarget() API
   */
  public updateFirstPersonCamera(): void {
    if (!this.firstPersonMode || !this.lockedPosition) {
      return;
    }

    // Calculate look-at target based on rotation
    // Convention for Z-up coordinate system (Speckle):
    // - yaw=0 → looking in -Y direction (forward)
    // - +yaw → rotate left (towards -X)
    // - +pitch → look up (towards +Z)
    const yaw = this.firstPersonRotation.yaw;
    const pitch = this.firstPersonRotation.pitch;

    // Direction calculation for Z-up coordinate system
    const direction = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),  // X: horizontal component (left/right)
      -Math.cos(yaw) * Math.cos(pitch),  // Y: horizontal component (forward/back) - Z-up: Y is horizontal
      Math.sin(pitch)                     // Z: vertical component (up/down) - Z-up: Z is vertical
    );

    const target = new THREE.Vector3().addVectors(
      this.lockedPosition,
      direction
    );

    // CRITICAL: Ensure up vector is locked to (0, 0, 1) to prevent roll/circular motion
    this.cameraController.controls.up = new THREE.Vector3(0, 0, 1);

    // Use Speckle's native API to update camera
    this.cameraController.controls.fromPositionAndTarget(this.lockedPosition, target);
  }

  // ============================================================================
  // First-Person View Rotation
  // ============================================================================

  /**
   * Rotate the first-person view
   * @param deltaYaw - Change in horizontal rotation (radians)
   * @param deltaPitch - Change in vertical rotation (radians)
   */
  public rotateFirstPersonView(deltaYaw: number, deltaPitch: number): void {
    if (!this.firstPersonMode) {
      console.warn('[SpeckleCameraController] ⚠️ Cannot rotate: first-person mode not active');
      return;
    }

    // Update rotation values
    this.firstPersonRotation.yaw += deltaYaw;
    this.firstPersonRotation.pitch += deltaPitch;

    // Clamp pitch to prevent looking too far up/down
    // Leave small margin to avoid gimbal lock
    this.firstPersonRotation.pitch = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, this.firstPersonRotation.pitch)
    );

    // Update camera immediately
    this.updateFirstPersonCamera();
  }

  // ============================================================================
  // Orientation Calculation
  // ============================================================================

  /**
   * Get the current listener orientation for ambisonic rotation
   * Returns orientation in radians: { yaw, pitch, roll }
   *
   * - Yaw: Horizontal rotation (left/right)
   * - Pitch: Vertical rotation (up/down)
   * - Roll: Head tilt (always 0 for now)
   *
   * This is the source of truth for listener orientation in auralization.
   */
  public getListenerOrientation(): { yaw: number; pitch: number; roll: number } {
    if (this.firstPersonMode) {
      // In first-person mode, use the stored rotation values
      return {
        yaw: this.firstPersonRotation.yaw,
        pitch: this.firstPersonRotation.pitch,
        roll: 0  // No head tilt support yet
      };
    } else {
      // In orbit mode, calculate from camera's actual look direction
      const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;

      // Get camera's world direction (where it's looking)
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      direction.normalize();

      // Calculate yaw (horizontal rotation around Z axis) — Speckle Z-UP
      // Speckle Z-UP: +X=Right, -Y=Forward, +Z=Up
      // Yaw=0 when looking -Y (forward), +Yaw rotates left (-X), -Yaw rotates right (+X)
      // atan2(-x, -y) gives us: -Y→0, -X→+PI/2, +Y→PI, +X→-PI/2
      const yaw = Math.atan2(-direction.x, -direction.y);

      // Calculate pitch (elevation angle from horizontal plane)
      // Pitch=0 when looking horizontally, +Pitch looks up (+Z), -Pitch looks down (-Z)
      const pitch = Math.asin(direction.z);

      // Roll (head tilt)
      // Speckle's CameraController doesn't support roll, so it's always 0
      const roll = 0;

      return {
        yaw,
        pitch,
        roll
      };
    }
  }

  /**
   * Get the camera's current position
   */
  public getCameraPosition(): THREE.Vector3 {
    const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
    return camera.position.clone();
  }

  /**
   * Get the camera's current look direction
   */
  public getCameraDirection(): THREE.Vector3 {
    const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    return direction.normalize();
  }

  // ============================================================================
  // Lifecycle Management
  // ============================================================================

  /**
   * Dispose of controller resources
   */
  public dispose(): void {
    console.log('[SpeckleCameraController] 🧹 Disposing...');

    // Exit first-person mode if active
    if (this.firstPersonMode) {
      this.disableFirstPersonMode();
    }

    // Clear saved state
    this.savedCameraPosition = null;
    this.savedCameraTarget = null;
    this.lockedPosition = null;

    console.log('[SpeckleCameraController] ✅ Disposed successfully');
  }
}

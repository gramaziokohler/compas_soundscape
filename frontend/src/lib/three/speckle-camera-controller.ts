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
  private firstPersonRotation: { yaw: number; pitch: number; roll: number } = { yaw: 0, pitch: 0, roll: 0 };
  private lockedPosition: THREE.Vector3 | null = null;

  // Camera state before entering first-person mode (for restoration)
  private savedCameraPosition: THREE.Vector3 | null = null;
  private savedCameraTarget: THREE.Vector3 | null = null;

  // True while FPS mode has switched Speckle's active controls to FlyControls.
  // FlyControls.update() early-returns when disabled, so our direct camera
  // writes (including roll) are not overwritten by the goal/damper system.
  // SmoothOrbitControls.update() ignores the enabled flag and re-derives the
  // camera from spherical coordinates every frame, which would wipe roll.
  private fpsUsesFlyControls: boolean = false;

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
   * Locks the camera at the position and drives it directly from yaw/pitch/roll
   * @param position - Position to lock the camera at
   * @param target - Initial look-at target
   */
  public enableFirstPersonMode(
    position: THREE.Vector3,
    target: THREE.Vector3
  ): void {
    // Only save camera state when first entering FPS mode.
    // Guard prevents overwriting the saved state when called a second time (e.g.
    // synchronous coordinator call followed by the React goToReceiverId useEffect).
    if (!this.firstPersonMode) {
      this.savedCameraPosition = this.cameraController.controls.getPosition().clone();
      this.savedCameraTarget = this.cameraController.controls.getTarget().clone();

      // Switch to FlyControls so disabling the controller actually stops its
      // update loop (SmoothOrbitControls.update() ignores enabled and keeps
      // overwriting the camera orientation, wiping roll).
      this.switchToFlyControls();
    }

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
    this.firstPersonRotation = { yaw, pitch, roll: 0 };

    // Set the camera directly (position + yaw/pitch/roll orientation)
    this.updateFirstPersonCamera();

    // Disable Speckle's camera controls to prevent user orbiting.
    // Re-enforce on the next frames: Speckle's internal double-click handler may
    // process the dblclick asynchronously and re-enable the controls afterwards.
    this.cameraController.enabled = false;
    requestAnimationFrame(() => { if (this.firstPersonMode) this.cameraController.enabled = false; });
    setTimeout(() => { if (this.firstPersonMode) this.cameraController.enabled = false; }, 100);

    console.log('[SpeckleCameraController] 👁️ First-person mode enabled', {
      position: position.toArray(),
      target: target.toArray(),
      yaw: (yaw * 180 / Math.PI).toFixed(1) + '°',
      pitch: (pitch * 180 / Math.PI).toFixed(1) + '°'
    });
  }

  /**
   * Switch Speckle's active controls to FlyControls (whose update() respects the
   * enabled flag), so the FPS camera can be driven directly without interference.
   */
  private switchToFlyControls(): void {
    try {
      const cc = this.cameraController as unknown as { toggleControls?: () => void };
      if (cc.toggleControls) {
        cc.toggleControls();
        this.fpsUsesFlyControls = true;
      }
    } catch (error) {
      console.warn('[SpeckleCameraController] Failed to switch to FlyControls:', error);
    }
  }

  /**
   * Switch back to Speckle's orbit controls after first-person mode exits.
   */
  private switchBackToOrbitControls(): void {
    try {
      const cc = this.cameraController as unknown as { toggleControls?: () => void };
      if (cc.toggleControls) {
        cc.toggleControls();
      }
    } catch (error) {
      console.warn('[SpeckleCameraController] Failed to switch back to orbit controls:', error);
    }
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

    // Switch back to the orbit controls (which animate toward the restored view).
    if (this.fpsUsesFlyControls) {
      this.switchBackToOrbitControls();
      this.fpsUsesFlyControls = false;
    }

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
   * Teleport the FPS camera to a new position, preserving current look direction.
   * Called when the user edits receiver position coordinates while in FPS mode.
   */
  public teleportFirstPerson(position: THREE.Vector3): void {
    if (!this.firstPersonMode) return;
    this.lockedPosition = position.clone();
    this.updateFirstPersonCamera();
    this.viewer.requestRender();
  }

  /**
   * Update camera position and orientation in first-person mode.
   * Sets the camera directly (position + yaw/pitch/roll quaternion), bypassing
   * Speckle's goal/damper controls so the roll is never overwritten between
   * frames. Runs on a disabled FlyControls instance, which won't fight the write.
   */
  public updateFirstPersonCamera(): void {
    if (!this.firstPersonMode || !this.lockedPosition) {
      return;
    }

    // Convention for Z-up coordinate system (Speckle):
    // - yaw=0 → looking in -Y direction (forward)
    // - +yaw → rotate towards -X
    // - +pitch → look up (towards +Z)
    const yaw = this.firstPersonRotation.yaw;
    const pitch = this.firstPersonRotation.pitch;
    const roll = this.firstPersonRotation.roll;

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

    const camera = this.viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
    camera.position.copy(this.lockedPosition);

    // Base orientation: look from lockedPosition to target with up = (0,0,1).
    const baseQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.lockedPosition, target, new THREE.Vector3(0, 0, 1))
    );

    // Apply roll (head tilt) by post-multiplying the camera quaternion around its
    // forward axis (camera-local +Z). Post-multiplication rotates in the camera's
    // local frame, avoiding gimbal lock.
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      roll
    );
    camera.quaternion.copy(baseQuat).multiply(rollQuat);
    camera.updateMatrixWorld(true);

    // The viewer only renders on explicit request — without this the previous
    // frame stays on screen.
    this.viewer.requestRender();

    // Keep the renderer's pipeline on the full-quality (stationary) stage.
    // The FPS camera is driven directly while FlyControls is disabled, so the
    // controls' update() never reports camera movement and the pipeline would
    // otherwise stay stuck in the dynamic stage (which renders a fast, edge/
    // wireframe representation of the scene). Emitting the same events the
    // controls would emit when idle keeps the shaded render on screen.
    const cc = this.cameraController as unknown as { emit?: (name: string, ...args: unknown[]) => void };
    cc.emit?.('stationary');
  }

  // ============================================================================
  // First-Person View Rotation
  // ============================================================================

  /**
   * Rotate the first-person view
   * @param deltaYaw - Change in horizontal rotation (radians)
   * @param deltaPitch - Change in vertical rotation (radians)
   * @param deltaRoll - Change in head tilt (radians), default 0
   */
  public rotateFirstPersonView(deltaYaw: number, deltaPitch: number, deltaRoll: number = 0): void {
    if (!this.firstPersonMode) {
      console.warn('[SpeckleCameraController] ⚠️ Cannot rotate: first-person mode not active');
      return;
    }

    // Update rotation values
    this.firstPersonRotation.yaw += deltaYaw;
    this.firstPersonRotation.pitch += deltaPitch;
    this.firstPersonRotation.roll += deltaRoll;

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
   * - Roll: Head tilt around the forward axis
   *
   * This is the source of truth for listener orientation in auralization.
   */
  public getListenerOrientation(): { yaw: number; pitch: number; roll: number } {
    if (this.firstPersonMode) {
      // In first-person mode, use the stored rotation values
      return {
        yaw: this.firstPersonRotation.yaw,
        pitch: this.firstPersonRotation.pitch,
        roll: this.firstPersonRotation.roll
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

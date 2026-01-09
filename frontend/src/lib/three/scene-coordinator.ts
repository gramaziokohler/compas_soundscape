import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createArcticModeScene,
  setupArcticModeLighting,
  createArcticModeGrid,
  setupOrbitControls,
  frameCameraToObject
} from "@/lib/three/sceneSetup";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";

/**
 * SceneCoordinator
 *
 * Manages Three.js scene initialization, camera setup, renderer configuration,
 * resize handling, and animation loop coordination.
 *
 * Responsibilities:
 * - Scene, camera, and renderer initialization
 * - OrbitControls setup
 * - Animation loop management
 * - Resize observer handling
 * - First-person camera mode
 * - AudioOrchestrator listener updates
 * - Cleanup on disposal
 */
export class SceneCoordinator {
  // Scene objects
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public controls: OrbitControls;
  public listener: THREE.AudioListener;

  // Audio Orchestrator integration
  private audioOrchestrator: AudioOrchestrator | null;

  // Groups
  public contentGroup: THREE.Group;
  public entityMarkersGroup: THREE.Group;
  public diverseHighlightsGroup: THREE.Group;

  // Animation
  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // First-person mode state
  private firstPersonMode: boolean = false;
  private firstPersonRotation: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
  private lockedPosition: THREE.Vector3 | null = null;

  // Camera state before entering first-person mode (for restoration)
  private savedCameraPosition: THREE.Vector3 | null = null;
  private savedControlsTarget: THREE.Vector3 | null = null;

  // Custom animation callbacks
  private customAnimationCallbacks: Array<() => void> = [];

  private _noOrchestratorWarned: boolean = false;

  constructor(mountElement: HTMLDivElement, audioOrchestrator?: AudioOrchestrator | null) {
    this.audioOrchestrator = audioOrchestrator || null;

    // Initialize scene
    this.scene = createArcticModeScene();
    
    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      mountElement.clientWidth / mountElement.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(15, 10, 15);
    this.camera.up.set(0, 1, 0);
    
    // Add audio listener to camera
    this.listener = new THREE.AudioListener();
    this.camera.add(this.listener);
    
    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(mountElement.clientWidth, mountElement.clientHeight);
    mountElement.appendChild(this.renderer.domElement);
    
    // Initialize controls
    this.controls = setupOrbitControls(this.camera, this.renderer.domElement);
    
    // Add grid and lighting
    const gridHelper = createArcticModeGrid();
    this.scene.add(gridHelper);
    setupArcticModeLighting(this.scene);
    
    // Initialize groups
    this.contentGroup = new THREE.Group();
    this.scene.add(this.contentGroup);
    
    this.entityMarkersGroup = new THREE.Group();
    this.scene.add(this.entityMarkersGroup);
    
    this.diverseHighlightsGroup = new THREE.Group();
    this.scene.add(this.diverseHighlightsGroup);
    
    // Start animation loop
    this.startAnimation();
    
    // Setup resize observer
    this.setupResizeObserver(mountElement);
  }

  /**
   * Set or update the audio orchestrator
   * Call this after the orchestrator is initialized
   */
  public setAudioOrchestrator(orchestrator: AudioOrchestrator | null): void {
    this.audioOrchestrator = orchestrator;
    this._noOrchestratorWarned = false; // Reset warning
    console.log('[SceneCoordinator] 🎵 AudioOrchestrator set:', {
      hasOrchestrator: !!orchestrator,
      orchestratorType: orchestrator?.constructor.name
    });
  }

  /**
   * Start the animation loop
   */
  private startAnimation(): void {
    let frameCounter = 0;

    const animate = () => {
      frameCounter++;

      // Handle first-person mode
      if (this.firstPersonMode && this.lockedPosition) {
        // Disable OrbitControls in first-person mode
        this.controls.enabled = false;

        // Lock camera position
        this.camera.position.copy(this.lockedPosition);

        // Calculate look-at target based on rotation
        // Convention: yaw=0 → looking at -Z (forward in Three.js), +yaw → looking left
        // This matches orbit mode and AnechoicMode's expected coordinate system
        const yaw = this.firstPersonRotation.yaw;
        const pitch = this.firstPersonRotation.pitch;

        const direction = new THREE.Vector3(
          -Math.sin(yaw) * Math.cos(pitch),  // Negated: yaw=0 → x=0, +yaw → look left (-X)
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch)   // Negated: yaw=0 → -Z (forward)
        );

        const target = new THREE.Vector3().addVectors(
          this.lockedPosition,
          direction
        );

        this.camera.lookAt(target);
      } else {
        // Normal mode: use OrbitControls
        // Only update controls, don't force enable it (let DragControls manage it)
        if (this.controls.enabled) {
          this.controls.update();
        }
      }

      // Update AudioOrchestrator listener (position + orientation)
      if (this.audioOrchestrator) {
        const position = this.camera.position;
        const orientation = this.getListenerOrientation();

        try {
          this.audioOrchestrator.updateListener(position, orientation);
        } catch (error) {
          console.warn('[SceneCoordinator] Failed to update audio listener:', error);
        }
      } else {
        // Log once if orchestrator is missing
        if (!this._noOrchestratorWarned) {
          console.warn('[SceneCoordinator] ⚠️ No AudioOrchestrator - listener position will not update');
          this._noOrchestratorWarned = true;
        }
      }

      // Execute custom animation callbacks
      this.customAnimationCallbacks.forEach(callback => callback());

      // Render scene
      this.renderer.render(this.scene, this.camera);

      // Continue animation loop
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Setup resize observer for responsive rendering
   */
  private setupResizeObserver(mountElement: HTMLDivElement): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }
    });
    
    this.resizeObserver.observe(mountElement);
  }

  /**
   * Add a custom animation callback to be executed every frame
   */
  public addAnimationCallback(callback: () => void): void {
    this.customAnimationCallbacks.push(callback);
  }

  /**
   * Remove a custom animation callback
   */
  public removeAnimationCallback(callback: () => void): void {
    const index = this.customAnimationCallbacks.indexOf(callback);
    if (index > -1) {
      this.customAnimationCallbacks.splice(index, 1);
    }
  }

  /**
   * Enable first-person mode at a specific position
   */
  public enableFirstPersonMode(
    position: THREE.Vector3,
    initialYaw: number,
    initialPitch: number
  ): void {
    // Save current camera state for restoration
    this.savedCameraPosition = this.camera.position.clone();
    this.savedControlsTarget = this.controls.target.clone();

    this.firstPersonMode = true;
    this.lockedPosition = position.clone();
    this.firstPersonRotation = { yaw: initialYaw, pitch: initialPitch };
    this.camera.position.copy(position);
    this.controls.enabled = false;
  }

  /**
   * Disable first-person mode and return to normal orbit controls
   */
  public disableFirstPersonMode(): void {
    this.firstPersonMode = false;
    this.lockedPosition = null;

    // Restore camera position and controls target
    if (this.savedCameraPosition && this.savedControlsTarget) {
      this.camera.position.copy(this.savedCameraPosition);
      this.controls.target.copy(this.savedControlsTarget);
      this.controls.update();

      // Clear saved state
      this.savedCameraPosition = null;
      this.savedControlsTarget = null;
    }

    // Reset controls
    this.controls.minDistance = 0;
    this.controls.maxDistance = Infinity;
    this.controls.rotateSpeed = 1.0;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableRotate = true;
    this.controls.enabled = true;
  }

  /**
   * Check if first-person mode is active
   */
  public isFirstPersonMode(): boolean {
    return this.firstPersonMode;
  }

  /**
   * Rotate the first-person view
   */
  public rotateFirstPersonView(deltaYaw: number, deltaPitch: number): void {
    if (!this.firstPersonMode) return;
    
    this.firstPersonRotation.yaw += deltaYaw;
    this.firstPersonRotation.pitch += deltaPitch;
    
    // Clamp pitch to prevent looking too far up/down
    this.firstPersonRotation.pitch = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, this.firstPersonRotation.pitch)
    );
  }

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
      // In orbit mode, use the camera's actual look direction
      // OrbitControls makes the camera look AT the target, so the listener
      // should face the same direction (toward the target)

      // Get camera's world direction (where it's looking)
      const direction = new THREE.Vector3();
      this.camera.getWorldDirection(direction);
      direction.normalize();

      // Calculate yaw (horizontal rotation around Y axis)
      // Three.js: +X=Right, +Z=Back, -Z=Forward
      // Yaw=0 when looking -Z (forward), +Yaw rotates left (-X), -Yaw rotates right (+X)
      // atan2(-x, -z) gives us: -Z→0, -X→+PI/2, +Z→PI, +X→-PI/2
      const yaw = Math.atan2(-direction.x, -direction.z);

      // Calculate pitch (vertical rotation around X axis)
      // Pitch=0 when looking horizontally, +Pitch looks up, -Pitch looks down
      // asin(y) gives us the pitch angle from the normalized direction
      const pitch = Math.asin(direction.y);

      // Roll (head tilt around Z axis)
      // OrbitControls doesn't support roll, so it's always 0
      const roll = 0;

      return {
        yaw,
        pitch,
        roll
      };
    }
  }

  /**
   * Reset camera to default or frame to content group
   */
  public resetCamera(hasGeometry: boolean): void {
    // Exit first-person mode
    this.disableFirstPersonMode();
    
    if (hasGeometry) {
      // Frame to model if it exists
      frameCameraToObject(this.camera, this.controls, this.contentGroup, 1.25);
    } else {
      // Reset to default position
      this.camera.position.set(15, 10, 15);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  /**
   * Get the renderer's DOM element
   */
  public getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Cancel animation loop
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    // Dispose controls
    this.controls.dispose();
    
    // Dispose renderer
    this.renderer.dispose();
    
    // Clear callbacks
    this.customAnimationCallbacks = [];
  }
}

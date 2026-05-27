import { Viewer, CameraController, SectionTool } from '@speckle/viewer';
import * as THREE from 'three';

// Milliseconds to wait after repositioning the camera before capturing.
// Speckle's render loop is RAF-based; this ensures at least one full frame renders.
const RENDER_SETTLE_MS = 200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureView(
  viewer: Viewer,
  controls: any,
  position: THREE.Vector3,
  target: THREE.Vector3
): Promise<string> {
  controls.fromPositionAndTarget(position, target);
  viewer.requestRender();
  await wait(RENDER_SETTLE_MS);
  return viewer.screenshot();
}

/**
 * Captures 3 screenshots of the currently loaded Speckle model and returns
 * them as base64-encoded PNG strings (data URIs).
 *
 * Shot order:
 *  [0] View A    — Outside diagonal perspective (NE corner, elevated)
 *  [1] Section A — Horizontal floor-plan section cut at ~45% building height, top-down camera
 *  [2] Section B — Vertical elevation section cut at Y midpoint, camera from -Y side
 *
 * Coordinate system: Speckle Z-up (+X=Right, -Y=Forward, +Z=Up)
 *
 * The function saves and restores the original camera position/orientation
 * and SectionTool state so the viewer is unchanged after the call.
 *
 * @param viewer - The live Speckle Viewer instance (must have a loaded model)
 * @returns Promise resolving to [viewA_b64, sectionA_b64, sectionB_b64]
 */
export async function captureSceneScreenshots(viewer: Viewer): Promise<string[]> {
  const bbox = viewer.World.worldBox;
  if (bbox.isEmpty()) {
    throw new Error('[captureSceneScreenshots] World bounding box is empty — is a model loaded?');
  }

  const center = bbox.getCenter(new THREE.Vector3());
  const size   = bbox.getSize(new THREE.Vector3());
  const { min, max } = bbox;

  // ── Camera controls ──────────────────────────────────────────────────────
  // CameraController.controls is the underlying camera-controls instance,
  // same pattern used in speckle-audio-coordinator.ts:506
  const cameraController = viewer.getExtension(CameraController);
  if (!cameraController) {
    throw new Error('[captureSceneScreenshots] CameraController extension not found on viewer');
  }
  const controls = (cameraController as any).controls;

  // Save current camera state so we can restore it after all captures.
  // Use the THREE.js camera for position and reconstruct the target from
  // the look direction (avoids depending on camera-controls internal state API).
  const camera = viewer.getRenderer().renderingCamera as THREE.PerspectiveCamera;
  const savedPosition = camera.position.clone();
  const savedDirection = new THREE.Vector3();
  camera.getWorldDirection(savedDirection);
  // Place the saved target 15 units along the current look direction
  const savedTarget = savedPosition.clone().addScaledVector(savedDirection, 15);

  // ── SectionTool (get or create lazily) ───────────────────────────────────
  const sectionTool = viewer.hasExtension(SectionTool)
    ? viewer.getExtension(SectionTool)!
    : viewer.createExtension(SectionTool);
  const wasEnabled = sectionTool.enabled;
  const wasVisible = sectionTool.visible;

  // Ensure section is off for the first (outside) shot
  sectionTool.enabled = false;

  const screenshots: string[] = [];

  try {
    // ── Shot 0: View A — Outside diagonal ──────────────────────────────────
    // Camera positioned beyond the (+X, +Y, +Z) corner of the bbox looking
    // toward the model center. Z-up: +Z is height.
    const viewAPosition = new THREE.Vector3(
      max.x + size.x * 0.8,
      max.y + size.y * 0.8,
      max.z + size.z * 0.8
    );
    screenshots.push(await captureView(viewer, controls, viewAPosition, center));

    // ── Shot 1: Section A — Horizontal floor-plan section ──────────────────
    // Section box retains everything below 45% of building height (Z axis).
    // Camera is placed directly above, looking straight down.
    // A tiny X/Y offset avoids the degenerate case where position == target
    // in the XY plane (which could cause gimbal issues in some camera controls).
    const sectionABox = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, max.y, min.z + size.z * 0.45)
    );
    sectionTool.setBox(sectionABox);
    sectionTool.enabled = true;
    sectionTool.visible = false; // hide the interactive gizmo

    const sectionAPosition = new THREE.Vector3(
      center.x + size.x * 0.001, // tiny offset to avoid gimbal lock
      center.y + size.y * 0.001,
      max.z + size.z * 2
    );
    screenshots.push(await captureView(viewer, controls, sectionAPosition, center));

    // ── Shot 2: Section B — Vertical elevation section ─────────────────────
    // Section box retains everything on the -Y (south) side of the Y midpoint.
    // Camera is positioned on the -Y side at mid-height, looking toward +Y,
    // showing the exposed interior cross-section.
    const sectionBBox = new THREE.Box3(
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y + size.y * 0.5, max.z)
    );
    sectionTool.setBox(sectionBBox);
    sectionTool.enabled = true;
    sectionTool.visible = false;

    const sectionBPosition = new THREE.Vector3(
      center.x,
      min.y - size.y,
      center.z
    );
    screenshots.push(await captureView(viewer, controls, sectionBPosition, center));
  } finally {
    // ── Restore original state unconditionally ────────────────────────────
    sectionTool.enabled = wasEnabled;
    sectionTool.visible = wasVisible;
    controls.fromPositionAndTarget(savedPosition, savedTarget);
    viewer.requestRender();
  }

  return screenshots;
}

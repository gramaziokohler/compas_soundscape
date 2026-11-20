/**
 * Occlusion ghost: a faint see-through copy of an overlay mesh that is drawn
 * ONLY where the model hides that mesh. Gives sound spheres and listeners two
 * levels of transparency: their own material where they are in plain view, and
 * a fainter silhouette where a wall / obstacle is in front of them.
 *
 * How it works: the ghost shares the parent's geometry and is drawn after it
 * (renderOrder + 1) with `depthFunc: GreaterDepth` and no depth write. Where the
 * parent is visible, the parent wrote its own depth, the ghost lands on exactly
 * the same depth and the "greater" test fails. Where an obstacle is in front,
 * the stored depth is the obstacle's (nearer), so the ghost passes and draws.
 * Partial occlusion (half behind a column) is handled per pixel by the GPU.
 *
 * This needs the model depth, which Speckle clears before its OVERLAY pass, so
 * attaching a ghost also moves the parent from the OVERLAY layer to
 * OCCLUSION_GHOST.LAYER, drawn by the occludable pass that
 * lib/three/speckle-occlusion-pass.ts adds to every pipeline.
 *
 * The ghost follows its parent automatically: position / scale / visibility by
 * being a child, colour and opacity copied from the parent material right
 * before each draw (so selection, mismatch, muted, dark mode … need no extra
 * wiring), instance count for InstancedMesh parents. Its material is disposed
 * with the parent's material. A geometry swap on the parent must call
 * `syncOcclusionGhostGeometry` (geometry is bound before the draw callback).
 *
 * Usage:
 * ```ts
 * attachOcclusionGhost(sphereMesh, OCCLUSION_GHOST.SOUND_OPACITY_RATIO);
 * ```
 *
 * In the Ghosted / Wireframe view styles the model writes no depth, so nothing
 * counts as occluded and the ghost never shows (everything is already see-through).
 */

import * as THREE from 'three';
import { ObjectLayers } from '@speckle/viewer';
import { OCCLUSION_GHOST } from '@/utils/constants';

const SPECKLE_OVERLAY_LAYER = ObjectLayers.OVERLAY;

export const OCCLUSION_GHOST_NAME = 'occlusionGhost';

/** Material properties the ghost copies from its parent (Basic and Standard both have them). */
interface ColoredMaterial extends THREE.Material {
  color?: THREE.Color;
}

function findGhost(parent: THREE.Object3D): THREE.Mesh | undefined {
  return parent.children.find((c) => c.name === OCCLUSION_GHOST_NAME) as THREE.Mesh | undefined;
}

/** Copy colour, opacity and instance count from the parent just before the ghost draws. */
function syncFromParent(ghost: THREE.Mesh, parent: THREE.Mesh, ratio: number): void {
  const source = (Array.isArray(parent.material) ? parent.material[0] : parent.material) as ColoredMaterial | undefined;
  const target = ghost.material as THREE.MeshBasicMaterial;
  if (!source) return;
  if (source.color) target.color.copy(source.color);
  target.visible = source.visible;
  target.opacity = (source.transparent ? source.opacity : 1) * ratio;
  if (parent instanceof THREE.InstancedMesh && ghost instanceof THREE.InstancedMesh) {
    ghost.count = parent.count;
  }
}

/**
 * Attach (once) an occlusion ghost to `parent`. `opacityRatio` scales the
 * parent's current opacity, so a faded parent gets an even fainter ghost.
 * Returns the ghost (existing one if already attached).
 */
export function attachOcclusionGhost(parent: THREE.Mesh, opacityRatio: number): THREE.Mesh {
  const existing = findGhost(parent);
  if (existing) return existing;

  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    depthFunc: THREE.GreaterDepth,
    fog: false,
    side: THREE.FrontSide,
  });

  let ghost: THREE.Mesh;
  if (parent instanceof THREE.InstancedMesh) {
    const instanced = new THREE.InstancedMesh(parent.geometry, material, 0);
    // Share the per-instance matrices: hidden (zero-scale) instances hide in the ghost too.
    instanced.instanceMatrix = parent.instanceMatrix;
    instanced.count = parent.count;
    ghost = instanced;
  } else {
    ghost = new THREE.Mesh(parent.geometry, material);
  }

  // Move the parent from the OVERLAY layer (drawn after Speckle clears depth)
  // to the occludable layer, drawn while the model depth is still there.
  // Layer 0 stays enabled: raycasters pick on the default layer.
  parent.layers.disable(SPECKLE_OVERLAY_LAYER);
  parent.layers.enable(OCCLUSION_GHOST.LAYER);

  ghost.name = OCCLUSION_GHOST_NAME;
  ghost.renderOrder = parent.renderOrder + OCCLUSION_GHOST.RENDER_ORDER_OFFSET;
  ghost.layers.set(OCCLUSION_GHOST.LAYER);
  // Cached instance bounds can go stale when points move; the ghost is cheap to draw.
  ghost.frustumCulled = false;
  // Never pickable: drag, hover and selection only ever hit the parent.
  ghost.raycast = () => {};
  ghost.userData.isOcclusionGhost = true;
  ghost.onBeforeRender = () => syncFromParent(ghost, parent, opacityRatio);

  const parentMaterial = Array.isArray(parent.material) ? parent.material[0] : parent.material;
  parentMaterial?.addEventListener('dispose', () => material.dispose());

  parent.add(ghost);
  return ghost;
}

/** Point the ghost at the parent's current geometry (call after replacing `parent.geometry`). */
export function syncOcclusionGhostGeometry(parent: THREE.Mesh): void {
  const ghost = findGhost(parent);
  if (ghost && ghost.geometry !== parent.geometry) ghost.geometry = parent.geometry;
}

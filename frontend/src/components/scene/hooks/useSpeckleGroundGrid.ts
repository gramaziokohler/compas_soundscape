import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store';
import {
  computeLabelWorldHeight,
  createLabelSprite,
  disposeLabelSprite,
} from '@/lib/three/label-sprite-factory';
import { getCssColorString } from '@/utils/utils';
import { GROUND_GRID_MIN_EXTENT, GROUND_GRID_EXTENT_FRACTION, HOME_STAGE } from '@/utils/constants';

// Layer 4 = ObjectLayers.OVERLAY in the Speckle viewer pipeline.
// Without enabling this layer on every custom Three.js object, Speckle's
// rendering pipeline will skip the object entirely — it exists in the scene
// graph but is never drawn. Layer 0 is also required for basic Three.js
// raycasting and rendering fallbacks.
// See: area-drawing-manager.ts, BoundingBoxManager.ts, gradient-map-manager.ts
const SPECKLE_OVERLAY_LAYER = 4;

// Home (sandbox) grid: a fixed, empty HOME_STAGE.GRID_SIZE_M square with
// HOME_STAGE.GRID_SPACING_M cells, centred on the origin — nothing drawn on it.

interface GroundGridOptions {
  isViewerReady: boolean;
  /** Home/sandbox stage: force the small fixed grid on, without labels. */
  isSandbox?: boolean;
  /** True while a model file is being dragged over the window (Home only — brightens the grid). */
  isDragOver?: boolean;
}

function enableSpeckleLayers(obj: THREE.Object3D): void {
  obj.layers.enable(0);
  obj.layers.enable(SPECKLE_OVERLAY_LAYER);
  obj.traverse((child) => {
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
  });
}

function resolveGridColor(stored: string): string {
  return stored || getCssColorString('--color-primary');
}

/**
 * Keep every grid tick / axis sprite at a constant apparent size. The grid
 * group lives directly in the scene (no manager), so it has no access to the
 * coordinator's per-frame screen-space pass and drives its own rAF loop while
 * visible — same pattern as useSpeckleScenarioPreview.
 */
function updateGridLabels(group: THREE.Group): void {
  const { viewer } = useSpeckleEngineStore.getState();
  const camera = viewer?.getRenderer().renderingCamera as THREE.PerspectiveCamera | undefined;
  if (!camera) return;

  const tmpVec = new THREE.Vector3();
  group.traverse((obj) => {
    const sprite = obj as THREE.Sprite;
    if (!sprite.isSprite || !sprite.userData.isLabel) return;
    sprite.getWorldPosition(tmpVec);
    const distance = camera.position.distanceTo(tmpVec);
    if (distance < 0.01) return;
    const h = computeLabelWorldHeight(camera, distance);
    sprite.scale.set(h * ((sprite.userData.aspectRatio as number) || 2), h, 1);
  });
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if ((obj as THREE.Sprite).isSprite) {
      disposeLabelSprite(obj as THREE.Sprite);
      return;
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((m) => {
        const mat = m as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        m.dispose();
      });
    } else if (material) {
      const mat = material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      material.dispose();
    }
  });
}

export function useSpeckleGroundGrid({
  isViewerReady,
  isSandbox = false,
  isDragOver = false,
}: GroundGridOptions) {
  const showGroundGrid    = useUIStore((s) => s.showGroundGrid);
  const groundGridSpacing = useUIStore((s) => s.groundGridSpacing);
  const groundGridColor   = useUIStore((s) => s.groundGridColor);
  const showGroundGridLabels = useUIStore((s) => s.showGroundGridLabels);
  const speckleBounds = useUIStore((s) => s.speckleBounds);

  // The Home grid must stay fixed and independent of the resonance box / sound
  // layout, so on the sandbox it ignores the live `speckleBounds` (which tracks
  // the sound-fitted resonance room).
  const gridBoundsKey = isSandbox
    ? 'sandbox'
    : speckleBounds
      ? `${speckleBounds.min.join(',')}:${speckleBounds.max.join(',')}`
      : 'none';

  const groupRef = useRef<THREE.Group | null>(null);

  // On the Home stage the grid is always visible and never shows labels.
  const gridVisible = showGroundGrid || isSandbox;
  const gridLabelsVisible = showGroundGridLabels && !isSandbox;

  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!viewer || !isViewerReady) return;

    const scene = viewer.getRenderer().scene;

    // Cleanup previous group
    if (groupRef.current) {
      scene.remove(groupRef.current);
      disposeGroup(groupRef.current);
      groupRef.current = null;
    }

    if (!gridVisible) {
      viewer.requestRender();
      return;
    }

    // Center grid on the model bounding box (viewer uses Z-up so XY = ground
    // plane). On the sandbox it is the fixed Home grid at the origin, so it
    // stays put regardless of where the sound spheres / resonance box go.
    const bounds = isSandbox ? null : useUIStore.getState().speckleBounds;
    const cx     = bounds ? (bounds.min[0] + bounds.max[0]) / 2 : 0;
    const cy     = bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 0;
    const floorZ = bounds ? bounds.min[2] : 0;

    const mW = bounds ? bounds.max[0] - bounds.min[0] : 50;
    const mH = bounds ? bounds.max[1] - bounds.min[1] : 50;
    const spacing    = isSandbox ? HOME_STAGE.GRID_SPACING_M : Math.max(0.5, groundGridSpacing);
    const halfExtent = isSandbox
      ? HOME_STAGE.GRID_SIZE_M / 2
      : Math.max(mW, mH, GROUND_GRID_MIN_EXTENT) * GROUND_GRID_EXTENT_FRACTION;
    const gridCount  = Math.ceil(halfExtent / spacing - 1e-9);
    const extent     = gridCount * spacing;

    const RENDER_ORDER = 9900;
    const colorCss = resolveGridColor(groundGridColor);
    const color = new THREE.Color(colorCss);

    const group = new THREE.Group();
    group.position.set(cx, cy, floorZ);
    group.frustumCulled = false;

    // Grid lines on XY plane (Z=0 relative to group)
    const pts: number[] = [];
    for (let i = -gridCount; i <= gridCount; i++) {
      const v = i * spacing;
      pts.push(-extent, v, 0,  extent, v, 0); // lines parallel to X axis
      pts.push(v, -extent, 0,  v, extent, 0); // lines parallel to Y axis
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: isDragOver ? 0.85 : 0.5,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(geo, lineMat);
    lines.frustumCulled = false;
    lines.renderOrder = RENDER_ORDER;
    group.add(lines);

    if (gridLabelsVisible) {
      const labelOpts: { showBackground: boolean; textColor: string } = {
        showBackground: false,
        textColor: colorCss,
      };
      const labelOffset = spacing * 0.15;
      const addLabel = (text: string, x: number, y: number, opts = labelOpts) => {
        const sprite = createLabelSprite(text, opts);
        sprite.renderOrder = RENDER_ORDER + 1;
        sprite.position.set(x, y, 0.05);
        group.add(sprite);
      };

      for (let i = -gridCount; i <= gridCount; i++) {
        const v = i * spacing;

        if (i !== 0) {
          addLabel(`${Math.round(cy + v)}`, 0, v);
          addLabel(`${Math.round(cx + v)}`, v, 0);
        } else {
          addLabel(`${Math.round(cy)}`, labelOffset, -labelOffset);
          addLabel(`${Math.round(cx + v)}`, -labelOffset, labelOffset);
        }
      }

      const axisColor = getCssColorString('--color-primary') || colorCss;
      const axisOpts = { showBackground: false, textColor: axisColor };
      addLabel('X', extent + spacing * 0.4, 0, axisOpts);
      addLabel('Y', 0, extent + spacing * 0.4, axisOpts);
    }

    // CRITICAL: enable Speckle overlay layers on the group and every child.
    // The Speckle viewer rendering pipeline only draws objects that have
    // layer 4 (ObjectLayers.OVERLAY) enabled. Without this the objects exist
    // in the scene graph but are never rendered.
    enableSpeckleLayers(group);

    scene.add(group);
    groupRef.current = group;
    if (gridLabelsVisible) updateGridLabels(group);
    viewer.requestRender();

    let rafId: number | null = null;
    if (gridLabelsVisible) {
      const tick = () => {
        updateGridLabels(group);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (groupRef.current) {
        scene.remove(groupRef.current);
        disposeGroup(groupRef.current);
        groupRef.current = null;
      }
      viewer.requestRender();
    };
  }, [isViewerReady, gridVisible, gridLabelsVisible, groundGridSpacing, groundGridColor, gridBoundsKey, isSandbox, isDragOver]);
}

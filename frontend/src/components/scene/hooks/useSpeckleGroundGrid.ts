import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store';
import { useResolvedColorTheme } from '@/hooks/useResolvedColorTheme';
import {
  computeLabelWorldHeight,
  createLabelSprite,
  disposeLabelSprite,
} from '@/lib/three/label-sprite-factory';
import { getCssColorString } from '@/utils/utils';
import { SANDBOX_GRID_MIN_EXTENT, SANDBOX_GRID_EXTENT_FRACTION } from '@/utils/constants';
import { getSandboxStageBounds } from '@/lib/three/placeholder-room-manager';

// Layer 4 = ObjectLayers.OVERLAY in the Speckle viewer pipeline.
// Without enabling this layer on every custom Three.js object, Speckle's
// rendering pipeline will skip the object entirely — it exists in the scene
// graph but is never drawn. Layer 0 is also required for basic Three.js
// raycasting and rendering fallbacks.
// See: area-drawing-manager.ts, BoundingBoxManager.ts, gradient-map-manager.ts
const SPECKLE_OVERLAY_LAYER = 4;

// Home (sandbox) grid uses a fixed world extent (see SANDBOX_GRID_* constants)
// so the projected "SOUND IS BLUE" text keeps a constant size regardless of the
// chosen grid spacing.

interface GroundGridOptions {
  isViewerReady: boolean;
  /** Home/sandbox stage: force the grid on, hide numeric labels, project the title text. */
  isSandbox?: boolean;
  /** True while a model file is being dragged over the window (Home only). */
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

const TITLE_FONT_FAMILY = '"Helvetica Neue", Arial, sans-serif';

/**
 * Render "SOUND" / "IS" / "BLUE" into a square canvas used as a flat projection
 * on the Home grid.
 *
 * Each letter's capital height is exactly 3 vertical grid squares (6 m at the
 * default 2 m spacing) — measured from the font metrics so it is exact, not
 * approximate. Rows are spaced apart, and the "I" of "IS" is centred on the
 * grid origin so the sound sphere reads as its dot/point.
 *
 * `enableGlow` bakes a soft glow around the glyphs (used on the dark stage).
 */
function createHomeTextTexture(
  colorCss: string,
  halfExtent: number,
  spacing: number,
  enableGlow: boolean,
): THREE.CanvasTexture {
  const S = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = colorCss;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (enableGlow) {
    ctx.shadowColor = colorCss;
    ctx.shadowBlur = 48;
  }

  const pxPerWorld = S / (2 * halfExtent);
  // One letter = 3 vertical grid squares, always → capital height target.
  const capWorld = 3 * spacing;
  const capPx = capWorld * pxPerWorld;

  // Measure the font's capital height, then scale so it equals capPx exactly.
  const PROBE = 100;
  ctx.font = `700 ${PROBE}px ${TITLE_FONT_FAMILY}`;
  const probeMetrics = ctx.measureText('I');
  const probeCap = probeMetrics.actualBoundingBoxAscent || PROBE * 0.72;
  const fontPx = PROBE * (capPx / probeCap);
  ctx.font = `700 ${fontPx}px ${TITLE_FONT_FAMILY}`;

  // Canvas ↔ world mapping (canvas top = +Y, matching the ground plane UVs).
  const toCanvasX = (wx: number) => (wx + halfExtent) * pxPerWorld;
  // Baseline is the bottom of the capital letters → place it capWorld/2 below
  // the row centre.
  const baselineCanvasY = (rowWorldY: number) =>
    (halfExtent - (rowWorldY - capWorld / 2)) * pxPerWorld;

  const drawWord = (word: string, rowWorldY: number, centerX = 0) => {
    const n = word.length;
    for (let i = 0; i < n; i++) {
      const wx = centerX + (i - (n - 1) / 2) * capWorld;
      ctx.fillText(word[i], toCanvasX(wx), baselineCanvasY(rowWorldY));
    }
  };

  // Rows spaced ~2 footprints apart; "IS" sits so the "I" top meets the origin.
  drawWord('SOUND', capWorld * 2);
  // The capital "I" is centred on x=0 with its top at y=0, so the sound sphere
  // at the origin reads as the dot/point of the "i"; "S" sits to its right.
  const isRow = -capWorld / 2;
  ctx.fillText('I', toCanvasX(0), baselineCanvasY(isRow));
  ctx.fillText('S', toCanvasX(capWorld), baselineCanvasY(isRow));
  drawWord('BLUE', -capWorld * 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
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
  // The title only glows in dark mode (resolved UI color theme).
  const isDarkStage = useResolvedColorTheme() === 'dark';

  // The Home grid must stay fixed and independent of the resonance box / sound
  // layout, so on the sandbox it always uses the fixed Home stage bounds instead
  // of the live `speckleBounds` (which tracks the sound-fitted resonance room).
  const gridBoundsKey = isSandbox
    ? 'sandbox'
    : speckleBounds
      ? `${speckleBounds.min.join(',')}:${speckleBounds.max.join(',')}`
      : 'none';

  const groupRef = useRef<THREE.Group | null>(null);

  // On the Home stage the grid is always visible and never shows numeric labels
  // (the projected title text replaces them).
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
    // plane). On the sandbox the bounds are the fixed Home stage bounds, so the
    // grid stays put regardless of where the sound spheres / resonance box go.
    const bounds = isSandbox ? getSandboxStageBounds() : useUIStore.getState().speckleBounds;
    const cx     = bounds ? (bounds.min[0] + bounds.max[0]) / 2 : 0;
    const cy     = bounds ? (bounds.min[1] + bounds.max[1]) / 2 : 0;
    const floorZ = bounds ? bounds.min[2] : 0;

    const mW = bounds ? bounds.max[0] - bounds.min[0] : 50;
    const mH = bounds ? bounds.max[1] - bounds.min[1] : 50;
    const spacing    = Math.max(0.5, groundGridSpacing);
    const halfExtent = Math.max(mW, mH, SANDBOX_GRID_MIN_EXTENT) * SANDBOX_GRID_EXTENT_FRACTION;
    const gridCount  = Math.ceil(halfExtent / spacing);
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

    if (isSandbox) {
      // Flat title projection lying on the ground plane, authored in readable
      // screen space (a 180° in-plane rotation would flip the glyphs).
      // The title can be wider than the grid (3-square letters), so size the
      // projection plane to contain it rather than clipping at the grid edge.
      const textPlaneHalf = Math.max(extent, 3 * spacing * 3.5);
      const textTexture = createHomeTextTexture(colorCss, textPlaneHalf, spacing, isDarkStage);
      const textMat = new THREE.MeshBasicMaterial({
        map: textTexture,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const textSize = textPlaneHalf * 2;
      const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(textSize, textSize), textMat);
      // Rotate the whole "SOUND IS BLUE" 180° around the grid centre.
      textMesh.rotation.z = Math.PI;
      textMesh.position.set(0, 0, 0.02);
      textMesh.renderOrder = RENDER_ORDER + 1;
      textMesh.frustumCulled = false;
      group.add(textMesh);

      // Landing-pad ring under the sphere — visible only while dragging a model.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(halfExtent * 0.16, halfExtent * 0.19, 96),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(getCssColorString('--color-receiver')),
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.position.set(0, 0, 0.03);
      ring.renderOrder = RENDER_ORDER + 2;
      ring.frustumCulled = false;
      ring.visible = isDragOver;
      ring.userData.isHomeDropRing = true;
      group.add(ring);
    }

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
  }, [isViewerReady, gridVisible, gridLabelsVisible, groundGridSpacing, groundGridColor, gridBoundsKey, isSandbox, isDragOver, isDarkStage]);
}

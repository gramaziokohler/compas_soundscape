import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';

// Layer 4 = ObjectLayers.OVERLAY in the Speckle viewer pipeline.
// Without enabling this layer on every custom Three.js object, Speckle's
// rendering pipeline will skip the object entirely — it exists in the scene
// graph but is never drawn. Layer 0 is also required for basic Three.js
// raycasting and rendering fallbacks.
// See: area-drawing-manager.ts, BoundingBoxManager.ts, gradient-map-manager.ts
const SPECKLE_OVERLAY_LAYER = 4;

function enableSpeckleLayers(obj: THREE.Object3D): void {
  obj.layers.enable(0);
  obj.layers.enable(SPECKLE_OVERLAY_LAYER);
  obj.traverse((child) => {
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
  });
}

function makeLabel(text: string, color: string, scale: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 64);
  ctx.font = 'bold 48px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale * 0.5, 1);
  sprite.renderOrder = 9901;
  return sprite;
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach((m: THREE.Material) => {
      const sm = m as THREE.SpriteMaterial;
      if (sm.map) sm.map.dispose();
      m.dispose();
    });
  });
}

export function useSpeckleGroundGrid({ isViewerReady }: { isViewerReady: boolean }) {
  const showGroundGrid    = useUIStore((s) => s.showGroundGrid);
  const groundGridSpacing = useUIStore((s) => s.groundGridSpacing);
  const groundGridColor   = useUIStore((s) => s.groundGridColor);
  const speckleBounds = useUIStore((s) => s.speckleBounds);

  const groupRef = useRef<THREE.Group | null>(null);

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

    if (!showGroundGrid) {
      viewer.requestRender();
      return;
    }

    // Center grid on model bounding box; viewer uses Z-up so XY = ground plane
    const cx     = speckleBounds ? (speckleBounds.min[0] + speckleBounds.max[0]) / 2 : 0;
    const cy     = speckleBounds ? (speckleBounds.min[1] + speckleBounds.max[1]) / 2 : 0;
    const floorZ = speckleBounds ? speckleBounds.min[2] : 0;

    const mW = speckleBounds ? speckleBounds.max[0] - speckleBounds.min[0] : 50;
    const mH = speckleBounds ? speckleBounds.max[1] - speckleBounds.min[1] : 50;
    const spacing    = Math.max(0.5, groundGridSpacing);
    const halfExtent = Math.max(mW, mH, 20) * 0.75;
    const gridCount  = Math.ceil(halfExtent / spacing);
    const extent     = gridCount * spacing;

    const RENDER_ORDER = 9900;
    const color = new THREE.Color(groundGridColor);

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
      opacity: 0.5,
      depthTest: false,
    });
    const lines = new THREE.LineSegments(geo, lineMat);
    lines.frustumCulled = false;
    lines.renderOrder = RENDER_ORDER;
    group.add(lines);

    // Resolve --color-primary from CSS custom properties at runtime
    const primaryColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary')
      .trim() || '#2F2FE4';

    // Numeric labels on both axes — show absolute world coordinates
    const labelScale = Math.max(spacing * 0.55, 0.5);
    const labelOffset = labelScale * 0.25;
    for (let i = -gridCount; i <= gridCount; i++) {
      const v = i * spacing;

      if (i !== 0) {
        // Y-axis labels sit on the Y axis; at i=0 offset to avoid overlapping the X label
        const ly = makeLabel(`${Math.round(cy + v)}`, groundGridColor, labelScale);
        ly.position.set(0, v, 0.05);
        group.add(ly);

        // X-axis labels sit on the X axis
        const lx = makeLabel(`${Math.round(cx + v)}`, groundGridColor, labelScale);
        lx.position.set(v, 0, 0.05);
        group.add(lx);

      } else {
        const ly = makeLabel(`${Math.round(cy)}`, groundGridColor, labelScale);
        ly.position.set(labelOffset, -labelOffset, 0.05);
        group.add(ly);

        const lx = makeLabel(`${Math.round(cx + v)}`, groundGridColor, labelScale);
        lx.position.set(-labelOffset, labelOffset, 0.05);
        group.add(lx);

      }
    }

    // Axis name labels at the positive ends of each axis
    const axisLabelScale = labelScale * 1.4;
    const xAxisLabel = makeLabel('X', primaryColor, axisLabelScale);
    xAxisLabel.position.set(extent + labelScale, 0, 0.05);
    group.add(xAxisLabel);

    const yAxisLabel = makeLabel('Y', primaryColor, axisLabelScale);
    yAxisLabel.position.set(0, extent + labelScale, 0.05);
    group.add(yAxisLabel);

    // CRITICAL: enable Speckle overlay layers on the group and every child.
    // The Speckle viewer rendering pipeline only draws objects that have
    // layer 4 (ObjectLayers.OVERLAY) enabled. Without this the objects exist
    // in the scene graph but are never rendered.
    enableSpeckleLayers(group);

    scene.add(group);
    groupRef.current = group;

    viewer.requestRender();

    return () => {
      if (groupRef.current) {
        scene.remove(groupRef.current);
        disposeGroup(groupRef.current);
        groupRef.current = null;
      }
      viewer.requestRender();
    };
  }, [isViewerReady, showGroundGrid, groundGridSpacing, groundGridColor, speckleBounds]);
}

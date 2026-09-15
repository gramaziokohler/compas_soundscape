import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useScenarioPreviewStore, useSpeckleStore, useUIStore, type ScenarioPreviewParcours, type ScenarioPreviewStop } from '@/store';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { SCENARIO_PREVIEW } from '@/utils/constants';
import {
  computeLabelWorldHeight,
  createLabelSprite,
  disposeLabelSprite,
} from '@/lib/three/label-sprite-factory';

interface ScenarioPreviewProps {
  isViewerReady: boolean;
  worldTree: any;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if ((obj as THREE.Sprite).isSprite) {
      disposeLabelSprite(obj as THREE.Sprite);
      return;
    }
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
}

function findObjectInTree(tree: any, id: string): any {
  if (!tree) return null;

  const checkNode = (node: any): any => {
    const nodeId = node?.raw?.id || node?.model?.id || node?.id;
    if (nodeId === id) return node;
    const children = node?.model?.children || node?.children;
    if (children) {
      for (const child of children) {
        const found = checkNode(child);
        if (found) return found;
      }
    }
    return null;
  };

  const rootChildren =
    tree.tree?._root?.children ||
    tree._root?.children ||
    tree.root?.children ||
    tree.children;
  if (rootChildren) {
    for (const child of rootChildren) {
      const found = checkNode(child);
      if (found) return found;
    }
  }
  return null;
}

/** Resolves a Speckle object id to its world-space bounding box (or null). */
function resolveObjectBounds(worldTree: any, id: string): THREE.Box3 | null {
  // Render views carry the AABB (NodeRenderView.aabb). The WorldTree object-tree
  // nodes found by findId() do NOT have renderView/aabb — must go through the
  // RenderTree's getRenderViewsForNodeId.
  try {
    const renderTree = worldTree?.getRenderTree?.();
    const rvs = renderTree?.getRenderViewsForNodeId?.(id);
    if (Array.isArray(rvs) && rvs.length > 0) {
      for (const rv of rvs) {
        let box = rv?.aabb as THREE.Box3 | undefined;
        if (!box || box.isEmpty()) {
          try {
            rv?.computeAABB?.();
            box = rv?.aabb;
          } catch {
            box = undefined;
          }
        }
        if (box && !box.isEmpty()) return box.clone();
      }
    }
  } catch {
    // ignore
  }

  // Fallback: WorldTree.findId nodes carrying a renderView.
  try {
    const nodes = worldTree?.findId?.(id) ?? null;
    if (Array.isArray(nodes)) {
      for (const node of nodes) {
        const rv = node?.renderView;
        if (!rv) continue;
        let box = rv.aabb as THREE.Box3 | undefined;
        if (!box || box.isEmpty()) {
          try {
            rv.computeAABB?.();
            box = rv.aabb;
          } catch {
            box = undefined;
          }
        }
        if (box && !box.isEmpty()) return box.clone();
      }
    }
  } catch {
    // ignore
  }

  // Last resort: any bounds fields present on the raw/model node.
  const node = findObjectInTree(worldTree, id);
  let bounds = node?.raw?.bounds || node?.model?.bounds;
  if (!bounds && node?.raw) bounds = node.raw.bbox;
  if (!bounds?.min || !bounds?.max) return null;

  return new THREE.Box3(
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  );
}

/** Dashed line + arrowhead cone for one parcours segment (from → to).
 *  `colorHex` is a hex string (e.g. from getMaterialColorByAbsorption). */
function createParcoursSegment(from: THREE.Vector3, to: THREE.Vector3, colorHex: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'ScenarioParcoursSegment';

  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([from, to]),
    new THREE.LineDashedMaterial({
      color: colorHex,
      opacity: SCENARIO_PREVIEW.LINE_OPACITY,
      transparent: true,
      dashSize: SCENARIO_PREVIEW.DASH_SIZE,
      gapSize: SCENARIO_PREVIEW.GAP_SIZE,
      depthTest: false,
      depthWrite: false,
    }),
  );
  line.computeLineDistances();
  line.renderOrder = 9999;
  line.frustumCulled = false;
  line.layers.enable(0);
  line.layers.enable(4);
  group.add(line);

  const direction = new THREE.Vector3().subVectors(to, from);
  const segLen = direction.length();
  const dirUnit = direction.normalize();
  const headRadius = THREE.MathUtils.clamp(
    segLen * SCENARIO_PREVIEW.ARROW_RADIUS_FACTOR,
    SCENARIO_PREVIEW.ARROW_MIN_RADIUS,
    SCENARIO_PREVIEW.ARROW_MAX_RADIUS,
  );
  const headLength = headRadius * SCENARIO_PREVIEW.ARROW_HEAD_LENGTH_FACTOR;

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius, headLength, 12),
    new THREE.MeshBasicMaterial({
      color: colorHex,
      opacity: SCENARIO_PREVIEW.LINE_OPACITY,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // Center the cone so its tip lands on `to`
  const tipOffset = dirUnit.clone().multiplyScalar(headLength / 2);
  cone.position.copy(to).sub(tipOffset);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirUnit);
  cone.renderOrder = 9999;
  cone.frustumCulled = false;
  cone.layers.enable(0);
  cone.layers.enable(4);
  group.add(cone);

  return group;
}

/** Center of a parcours stop = the referenced object's bounds center. */
function resolveStopPosition(
  worldTree: any,
  stop: ScenarioPreviewStop,
): THREE.Vector3 | null {
  const box = resolveObjectBounds(worldTree, stop.id);
  if (!box) return null;
  return box.getCenter(new THREE.Vector3());
}

type ParcoursEndpointKind = 'start' | 'end';

interface ParcoursEndpointLabel {
  anchor: THREE.Vector3;
  kinds: Set<ParcoursEndpointKind>;
}

/**
 * Start/End anchors for every scenario's parcours. Endpoints closer than
 * `SCENARIO_PREVIEW.LABEL_OVERLAP_THRESHOLD` collapse into one entry whose
 * `kinds` set collects every role at that spot — so a single-stop parcours, a
 * loop back to the start, or two scenarios meeting at the same object render a
 * single combined "Start / End" sprite instead of two sprites stacked exactly
 * on top of each other.
 */
function resolveEndpointLabels(
  worldTree: any,
  parcours: ScenarioPreviewParcours,
): ParcoursEndpointLabel[] {
  const labels: ParcoursEndpointLabel[] = [];

  const push = (anchor: THREE.Vector3, kind: ParcoursEndpointKind) => {
    for (const entry of labels) {
      if (entry.anchor.distanceTo(anchor) < SCENARIO_PREVIEW.LABEL_OVERLAP_THRESHOLD) {
        entry.kinds.add(kind);
        return;
      }
    }
    labels.push({ anchor: anchor.clone(), kinds: new Set([kind]) });
  };

  for (const scenarioStops of parcours) {
    const positions: THREE.Vector3[] = [];
    for (const stop of scenarioStops) {
      const pos = resolveStopPosition(worldTree, stop);
      if (pos) positions.push(pos);
    }
    if (positions.length === 0) continue;
    push(positions[0], 'start');
    push(positions[positions.length - 1], 'end');
  }

  return labels;
}

/** Human text for a merged endpoint label, ordered Start then End. */
function endpointLabelText(kinds: Set<ParcoursEndpointKind>): string {
  const parts: string[] = [];
  if (kinds.has('start')) parts.push(SCENARIO_PREVIEW.START_LABEL);
  if (kinds.has('end')) parts.push(SCENARIO_PREVIEW.END_LABEL);
  return parts.join(' / ');
}

/**
 * Keep every Start/End sprite at a constant apparent size and floating above its
 * anchor. The parcours group lives directly in the scene (no manager), so it has
 * no access to the coordinator's per-frame screen-space pass and drives its own
 * rAF loop while visible.
 */
function updateScenarioLabels(group: THREE.Group): void {
  const { viewer } = useSpeckleEngineStore.getState();
  const camera = viewer?.getRenderer().renderingCamera as THREE.PerspectiveCamera | undefined;
  if (!camera) return;

  const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  group.traverse((obj) => {
    const sprite = obj as THREE.Sprite;
    if (!sprite.isSprite) return;
    const anchor = sprite.userData.anchor as THREE.Vector3 | undefined;
    if (!anchor) return;

    const distance = camera.position.distanceTo(anchor);
    if (distance < 0.01) return;

    const h = computeLabelWorldHeight(camera, distance);
    sprite.scale.set(h * ((sprite.userData.aspectRatio as number) || 3), h, 1);
    sprite.position
      .copy(anchor)
      .addScaledVector(cameraUp, h * SCENARIO_PREVIEW.LABEL_UP_OFFSET_FACTOR);
  });
}

/**
 * Scenario 3D preview.
 *
 * While a scenario card is expanded (`enabled`):
 *   - the involved `objectIds` are colored in the viewer with the LIGHT PRIMARY
 *     colour via the same FilteringExtension pipeline as the hover highlight
 *     (see `speckleStore.setScenarioPreviewHighlight`), and
 *   - dashed arrows are drawn between the bounds centers of consecutive parcours
 *     stops (per scenario), only while the viewer "Show scenario parcours"
 *     toggle (`uiStore.showScenarioParcours`, scenario card footer) is on. Each segment is
 *     colored along the acoustic-material gradient (teal → orange → red) by its
 *     order of appearance. The arrows are THREE overlays added to the scene
 *     (independent of FilteringExtension), and
 *   - a "Start" / "End" label sprite marks the first / last stop of each scenario's
 *     parcours, floating above the endpoint. Endpoints that coincide collapse into
 *     one combined "Start / End" sprite (single-stop parcours, loop, or two
 *     scenarios meeting at the same object).
 */
export function useSpeckleScenarioPreview({ isViewerReady, worldTree }: ScenarioPreviewProps) {
  const enabled = useScenarioPreviewStore((s) => s.enabled);
  const objectIds = useScenarioPreviewStore((s) => s.objectIds);
  const parcours = useScenarioPreviewStore((s) => s.parcours);
  const parcoursEnabled = useUIStore((s) => s.showScenarioParcours);
  const groupRef = useRef<THREE.Group | null>(null);

  const setScenarioPreviewHighlight = useSpeckleStore((s) => s.setScenarioPreviewHighlight);
  const clearScenarioPreviewHighlight = useSpeckleStore((s) => s.clearScenarioPreviewHighlight);

  // ── Object coloring (light-primary, same mechanism as the hover highlight) ──
  useEffect(() => {
    if (enabled && objectIds.length > 0) {
      setScenarioPreviewHighlight(objectIds);
    } else {
      clearScenarioPreviewHighlight();
    }
    return () => clearScenarioPreviewHighlight();
  }, [enabled, objectIds, setScenarioPreviewHighlight, clearScenarioPreviewHighlight]);

  // ── Dashed-arrow parcours between consecutive stops (per scenario) ──
  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer) return;

    // Remove any previously drawn parcours before (re)building
    if (groupRef.current) {
      const scene = viewer.getRenderer().scene;
      if (scene) scene.remove(groupRef.current);
      disposeGroup(groupRef.current);
      groupRef.current = null;
      viewer.requestRender();
    }

    if (!enabled || !parcoursEnabled) return;

    const group = new THREE.Group();
    group.name = 'ScenarioPreviewGroup';
    group.layers.enable(0);
    group.layers.enable(4);

    // Collect all segments in order of appearance (across all scenarios)
    const segments: Array<{ from: THREE.Vector3; to: THREE.Vector3 }> = [];
    for (const scenarioStops of parcours) {
      let prev: THREE.Vector3 | null = null;
      for (const stop of scenarioStops) {
        const pos = resolveStopPosition(worldTree, stop);
        if (!pos) continue;
        if (prev && prev.distanceTo(pos) >= SCENARIO_PREVIEW.MIN_SEGMENT_LENGTH) {
          segments.push({ from: prev, to: pos });
        }
        prev = pos;
      }
    }

    // Color each segment along the acoustic-material gradient (teal → orange →
    // red) based on its order of appearance — same gradient used by
    // useSpeckleSurfaceMaterials / getMaterialColorByAbsorption.
    const segmentCount = segments.length;
    segments.forEach((segment, index) => {
      const t = segmentCount <= 1 ? 1 : index / (segmentCount - 1);
      const color = getMaterialColorByAbsorption(t);
      group.add(createParcoursSegment(segment.from, segment.to, color));
    });

    // Start / End label sprites — overlapping endpoints share one combined sprite
    for (const endpoint of resolveEndpointLabels(worldTree, parcours)) {
      const sprite = createLabelSprite(endpointLabelText(endpoint.kinds));
      sprite.userData.anchor = endpoint.anchor.clone();
      sprite.position.copy(endpoint.anchor);
      group.add(sprite);
    }

    const scene = viewer.getRenderer().scene;
    if (scene && group.children.length > 0) {
      scene.add(group);
      groupRef.current = group;
      updateScenarioLabels(group);
      viewer.requestRender();
    } else {
      disposeGroup(group);
    }

    let rafId: number | null = null;
    if (groupRef.current === group) {
      const tick = () => {
        updateScenarioLabels(group);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const { viewer: v } = useSpeckleEngineStore.getState();
      if (groupRef.current) {
        const s = v?.getRenderer().scene;
        if (s) s.remove(groupRef.current);
        disposeGroup(groupRef.current);
        groupRef.current = null;
        v?.requestRender();
      }
    };
  }, [isViewerReady, worldTree, enabled, parcoursEnabled, parcours]);
}

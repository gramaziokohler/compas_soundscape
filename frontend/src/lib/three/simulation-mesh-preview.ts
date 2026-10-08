/**
 * SimulationMeshPreview
 *
 * Renders the prepared simulation mesh of a geometry preflight in place of the
 * Speckle model: per-face coloured surfaces (separate front/back side passes,
 * each side filtered by its legend category), outlines of the simulated walls,
 * open-edge loops (holes), escaping rays (leaks) and blocked source→receiver
 * segments.
 *
 * The whole group is rebuilt on every option change — it is a handful of
 * BufferGeometries, cheap compared with keeping incremental state in sync.
 */

import * as THREE from 'three';
import type { Viewer } from '@speckle/viewer';
import { SIMULATION_PREFLIGHT } from '@/utils/constants';
import type { PreflightFilters, PreflightIssue, PreflightPayload, PreflightViewMode } from '@/types/simulationPreflight';
import { faceSideColors, resolvePreviewPalette, severityColor, type PreviewPalette } from './simulation-mesh-colors';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4); layer 0
// keeps plain Three.js raycasting working.
const SPECKLE_OVERLAY_LAYER = 4;

export interface MeshPreviewOptions {
  viewMode: PreflightViewMode;
  filters: PreflightFilters;
  ghost: boolean;
  /** Issue whose faces / loops / segment are emphasised (focused or hovered). */
  highlight: PreflightIssue | null;
}

function enableOverlay(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
    child.frustumCulled = false;
    child.renderOrder = SIMULATION_PREFLIGHT.RENDER_ORDER;
  });
}

/**
 * Show / hide the whole Speckle model (its render batches live under the
 * renderer's `ContentGroup`). Sound spheres, receivers and other custom
 * objects sit outside it and stay visible.
 */
export function setSpeckleModelVisible(viewer: Viewer, visible: boolean): void {
  const content = viewer.getRenderer().allObjects;
  if (content && content.visible !== visible) {
    content.visible = visible;
    viewer.requestRender();
  }
}

function lines(points: number[], color: number, opacity = 1, dashed = false): THREE.LineSegments {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = dashed
    ? new THREE.LineDashedMaterial({
        color, transparent: true, opacity, depthTest: false,
        dashSize: SIMULATION_PREFLIGHT.LEAK_DASH_SIZE_M, gapSize: SIMULATION_PREFLIGHT.LEAK_GAP_SIZE_M,
      })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
  const seg = new THREE.LineSegments(geo, material);
  if (dashed) seg.computeLineDistances();
  return seg;
}

export class SimulationMeshPreview {
  private readonly scene: THREE.Scene;
  private group: THREE.Group | null = null;
  private payload: PreflightPayload | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setPayload(payload: PreflightPayload | null): void {
    this.payload = payload;
  }

  /** (Re)build the preview group for the current payload and options. */
  render(options: MeshPreviewOptions): void {
    this.clear();
    const payload = this.payload;
    if (!payload) return;
    const palette = resolvePreviewPalette();
    const group = new THREE.Group();
    group.name = 'simulation-mesh-preview';

    const highlightFaces = new Map<number, number>();
    if (options.filters.blockers) {
      for (const path of payload.blocked_paths) {
        for (const f of path.face_ids) highlightFaces.set(f, palette.error);
      }
    }
    if (options.highlight) {
      const color = severityColor(palette, options.highlight.severity);
      for (const f of options.highlight.face_ids) highlightFaces.set(f, color);
    }

    this.addFaces(group, payload, options, palette, highlightFaces);
    if (options.filters.edges) this.addWallOutlines(group, payload, options, palette);
    if (options.filters.holes) this.addLoops(group, payload, palette, options.highlight);
    if (options.filters.leaks && payload.leaks.length) {
      const pts = payload.leaks.flatMap((l) => [...l.origin, ...l.end]);
      group.add(lines(pts, palette.error, 0.8, true));
    }
    if (options.filters.blockers && payload.blocked_paths.length) {
      group.add(lines(payload.blocked_paths.flatMap((p) => [...p.segment[0], ...p.segment[1]]), palette.error));
    }
    if (options.highlight?.segment) {
      const [a, b] = options.highlight.segment;
      group.add(lines([...a, ...b], severityColor(palette, options.highlight.severity)));
    }

    enableOverlay(group);
    this.scene.add(group);
    this.group = group;
  }

  /** World-space box framing an issue (position, segment, loops, faces). */
  issueBounds(issue: PreflightIssue): THREE.Box3 | null {
    const payload = this.payload;
    if (!payload) return null;
    const box = new THREE.Box3();
    const v = payload.vertices;
    if (issue.position) box.expandByPoint(new THREE.Vector3(...issue.position));
    if (issue.segment) issue.segment.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)));
    for (const k of issue.loop_ids) {
      const seg = payload.loops[k]?.segments ?? [];
      for (let i = 0; i < seg.length; i += 3) box.expandByPoint(new THREE.Vector3(seg[i], seg[i + 1], seg[i + 2]));
    }
    for (const f of issue.face_ids) {
      for (let c = 0; c < 3; c++) {
        const vi = payload.faces[3 * f + c] * 3;
        box.expandByPoint(new THREE.Vector3(v[vi], v[vi + 1], v[vi + 2]));
      }
    }
    if (box.isEmpty()) return null;
    return box.expandByScalar(SIMULATION_PREFLIGHT.FOCUS_PADDING_M);
  }

  clear(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.group = null;
  }

  dispose(): void {
    this.clear();
    this.payload = null;
  }

  // ── Builders ─────────────────────────────────────────────────────────────

  private addFaces(
    group: THREE.Group,
    payload: PreflightPayload,
    options: MeshPreviewOptions,
    palette: PreviewPalette,
    highlight: Map<number, number>,
  ): void {
    const v = payload.vertices;
    // One pass per Three.js side; a face side is drawn only when its legend
    // category is checked (highlighted faces always show on both sides).
    const passes = [
      { side: THREE.FrontSide, positions: [] as number[], colors: [] as number[] },
      { side: THREE.BackSide, positions: [] as number[], colors: [] as number[] },
    ];
    const tmp = new THREE.Color();
    const nFaces = payload.faces.length / 3;
    for (let f = 0; f < nFaces; f++) {
      const hl = highlight.get(f);
      const sideColors = hl !== undefined
        ? [hl, hl]
        : faceSideColors(payload, f, options.viewMode, options.filters, palette);
      sideColors.forEach((color, i) => {
        if (color === null) return;
        tmp.setHex(color);
        for (let c = 0; c < 3; c++) {
          const vi = payload.faces[3 * f + c] * 3;
          passes[i].positions.push(v[vi], v[vi + 1], v[vi + 2]);
          passes[i].colors.push(tmp.r, tmp.g, tmp.b);
        }
      });
    }

    const opacity = options.ghost ? SIMULATION_PREFLIGHT.GHOST_FACE_OPACITY : SIMULATION_PREFLIGHT.FACE_OPACITY;
    for (const pass of passes) {
      if (pass.positions.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pass.positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(pass.colors, 3));
      const material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: pass.side,
        transparent: true,
        opacity,
        depthWrite: !options.ghost,
        polygonOffset: true,
        polygonOffsetFactor: SIMULATION_PREFLIGHT.POLYGON_OFFSET_FACTOR,
        polygonOffsetUnits: SIMULATION_PREFLIGHT.POLYGON_OFFSET_UNITS,
      });
      group.add(new THREE.Mesh(geo, material));
    }
  }

  /** Edges between different simulated walls (merged polygons) + open edges. */
  private addWallOutlines(
    group: THREE.Group,
    payload: PreflightPayload,
    options: MeshPreviewOptions,
    palette: PreviewPalette,
  ): void {
    const walls = new Map<string, Set<number>>();
    const nFaces = payload.faces.length / 3;
    for (let f = 0; f < nFaces; f++) {
      const [front, back] = faceSideColors(payload, f, options.viewMode, options.filters, palette);
      if (front === null && back === null) continue;
      for (let c = 0; c < 3; c++) {
        const a = payload.faces[3 * f + c];
        const b = payload.faces[3 * f + ((c + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (!walls.has(key)) walls.set(key, new Set());
        walls.get(key)!.add(payload.face_wall[f]);
      }
    }
    const v = payload.vertices;
    const pts: number[] = [];
    for (const [key, ws] of walls) {
      // Shared by faces of a single wall = interior triangulation edge: skip.
      if (ws.size === 1 && !this.isOpenEdge(key, payload)) continue;
      const [a, b] = key.split('_').map(Number);
      pts.push(v[3 * a], v[3 * a + 1], v[3 * a + 2], v[3 * b], v[3 * b + 1], v[3 * b + 2]);
    }
    if (pts.length) group.add(lines(pts, palette.edges, SIMULATION_PREFLIGHT.EDGE_OPACITY));
  }

  private openEdges: Set<string> | null = null;
  private openEdgesFor: PreflightPayload | null = null;

  private isOpenEdge(key: string, payload: PreflightPayload): boolean {
    if (this.openEdgesFor !== payload) {
      const counts = new Map<string, number>();
      const nFaces = payload.faces.length / 3;
      for (let f = 0; f < nFaces; f++) {
        for (let c = 0; c < 3; c++) {
          const a = payload.faces[3 * f + c];
          const b = payload.faces[3 * f + ((c + 1) % 3)];
          const k = a < b ? `${a}_${b}` : `${b}_${a}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
      this.openEdges = new Set([...counts].filter(([, n]) => n === 1).map(([k]) => k));
      this.openEdgesFor = payload;
    }
    return this.openEdges!.has(key);
  }

  private addLoops(group: THREE.Group, payload: PreflightPayload, palette: PreviewPalette, highlight: PreflightIssue | null): void {
    const focused = new Set(highlight?.loop_ids ?? []);
    const leaking: number[] = [];
    const open: number[] = [];
    const emphasised: number[] = [];
    for (const loop of payload.loops) {
      if (focused.has(loop.id)) emphasised.push(...loop.segments);
      else if (loop.leaking) leaking.push(...loop.segments);
      else open.push(...loop.segments);
    }
    if (open.length) group.add(lines(open, palette.holes, 0.7));
    if (leaking.length) group.add(lines(leaking, palette.error));
    if (emphasised.length && highlight) group.add(lines(emphasised, severityColor(palette, highlight.severity)));
  }
}

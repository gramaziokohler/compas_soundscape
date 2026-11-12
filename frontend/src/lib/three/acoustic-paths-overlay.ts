/**
 * AcousticPathsOverlay
 *
 * Draws the sound paths of a geometric-acoustics card in the Speckle scene:
 *  - specular reflection paths, one colour per reflection order, fading with the order;
 *  - first-order diffracted paths (dashed);
 *  - the diffracting edges: on (warning), carrying a path (error), switched off (grey, dashed),
 *    and the hovered one highlighted;
 *  - a "billiard" of ray particles with short tails, moved in time by `setTime`.
 *
 * Paths are drawn on top of the model (no depth test) so a reflection behind a wall stays
 * visible; edges are depth-tested less strictly through a polygon-free line layer. Rebuilt on
 * every view change; only the particle buffers are rewritten per animation frame.
 */

import * as THREE from 'three';
import { ACOUSTIC_PATHS } from '@/utils/constants';
import { getCssColorHex } from '@/utils/utils';
import {
  cumulativeDistances,
  pickScreenEdge,
  pointAtDistance,
  visibleDiffracted,
  visibleEdges,
  visibleRays,
  visibleReflections,
  type ScreenEdge,
} from '@/lib/acoustics/acoustic-paths';
import { sameEdge } from '@/lib/acoustics/geometric-engine';
import type { AcousticPathsPayload, AcousticPathsView, DiffractionEdge } from '@/types/acousticPaths';

// Speckle renders custom objects only on ObjectLayers.OVERLAY (4).
const SPECKLE_OVERLAY_LAYER = 4;

function enableOverlay(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    child.layers.disableAll();
    child.layers.enable(0);
    child.layers.enable(SPECKLE_OVERLAY_LAYER);
    child.frustumCulled = false;
    child.renderOrder = ACOUSTIC_PATHS.RENDER_ORDER;
    child.raycast = () => undefined; // never intercept scene clicks; edges are picked in screen space
  });
}

/** Segment pairs (a→b, b→c, ...) of a flat polyline, appended to `out`. */
function pushPolyline(out: number[], points: readonly number[]): void {
  for (let i = 0; i + 5 < points.length; i += 3) {
    out.push(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5]);
  }
}

function lineSegments(positions: number[], color: number, opacity: number, dashed = false): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const common = { color, transparent: true, opacity, depthTest: false, depthWrite: false };
  const material = dashed
    ? new THREE.LineDashedMaterial({ ...common, dashSize: ACOUSTIC_PATHS.EDGE_DASH_SIZE_M, gapSize: ACOUSTIC_PATHS.EDGE_GAP_SIZE_M })
    : new THREE.LineBasicMaterial(common);
  const lines = new THREE.LineSegments(geometry, material);
  if (dashed) lines.computeLineDistances();
  return lines;
}

interface RayTrack {
  points: number[];
  cumulative: Float64Array;
}

export interface AcousticPathsRenderOptions {
  view: AcousticPathsView;
  /** The card's switched-off edges ([x1,y1,z1,x2,y2,z2]); overrides the payload's own flags. */
  excludedEdges: readonly number[][];
  hoveredEdgeId: number | null;
}

export class AcousticPathsOverlay {
  private readonly scene: THREE.Scene;
  private payload: AcousticPathsPayload | null = null;
  private group: THREE.Group | null = null;
  private particles: THREE.Points | null = null;
  private trails: THREE.LineSegments | null = null;
  private tracks: RayTrack[] = [];
  private shownEdges: DiffractionEdge[] = [];
  private timeMs = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setPayload(payload: AcousticPathsPayload | null): void {
    this.payload = payload;
  }

  /** Duration (ms) of the longest shown ray: the end of the billiard animation. */
  get durationMs(): number {
    const speed = this.payload?.speed_of_sound ?? 343;
    let longest = 0;
    for (const t of this.tracks) longest = Math.max(longest, t.cumulative[t.cumulative.length - 1] ?? 0);
    return (1000 * longest) / speed;
  }

  render({ view, excludedEdges, hoveredEdgeId }: AcousticPathsRenderOptions): void {
    this.clear();
    const payload = this.payload;
    if (!payload) return;
    const group = new THREE.Group();
    group.name = 'acoustic-paths';
    const vars = ACOUSTIC_PATHS.COLOR_VARS;

    // ── Reflection paths: one LineSegments per order ─────────────────────────
    const byOrder = new Map<number, number[]>();
    for (const path of visibleReflections(payload, view)) {
      let positions = byOrder.get(path.order);
      if (!positions) byOrder.set(path.order, (positions = []));
      pushPolyline(positions, path.points);
    }
    for (const [order, positions] of byOrder) {
      const colorVar = order === 0 ? vars.DIRECT : vars.ORDERS[(order - 1) % vars.ORDERS.length];
      const opacity = ACOUSTIC_PATHS.PATH_OPACITY * ACOUSTIC_PATHS.PATH_OPACITY_FALLOFF ** order;
      group.add(lineSegments(positions, getCssColorHex(colorVar), opacity));
    }

    // ── Diffracted paths ─────────────────────────────────────────────────────
    const diffracted: number[] = [];
    for (const path of visibleDiffracted(payload, view)) pushPolyline(diffracted, path.points);
    if (diffracted.length) group.add(lineSegments(diffracted, getCssColorHex(vars.DIFFRACTED), ACOUSTIC_PATHS.PATH_OPACITY, true));

    // ── Diffracting edges ────────────────────────────────────────────────────
    this.shownEdges = visibleEdges(payload, view);
    const on: number[] = [];
    const used: number[] = [];
    const off: number[] = [];
    const hovered: number[] = [];
    for (const edge of this.shownEdges) {
      const excluded = excludedEdges.some((e) => sameEdge(e, edge.segment));
      const bucket = edge.id === hoveredEdgeId ? hovered : excluded ? off : edge.used ? used : on;
      bucket.push(...edge.segment);
    }
    if (on.length) group.add(lineSegments(on, getCssColorHex(vars.EDGE), ACOUSTIC_PATHS.EDGE_OPACITY));
    if (used.length) group.add(lineSegments(used, getCssColorHex(vars.EDGE_USED), ACOUSTIC_PATHS.EDGE_OPACITY));
    if (off.length) group.add(lineSegments(off, getCssColorHex(vars.EDGE_EXCLUDED), ACOUSTIC_PATHS.EDGE_EXCLUDED_OPACITY, true));
    if (hovered.length) group.add(lineSegments(hovered, getCssColorHex(vars.DIRECT), 1));

    // ── Billiard particles ───────────────────────────────────────────────────
    this.tracks = visibleRays(payload, view).map((ray) => ({ points: ray.points, cumulative: cumulativeDistances(ray.points) }));
    if (this.tracks.length) {
      const n = this.tracks.length;
      const pointGeometry = new THREE.BufferGeometry();
      pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * n), 3));
      this.particles = new THREE.Points(pointGeometry, new THREE.PointsMaterial({
        color: getCssColorHex(vars.PARTICLE), size: ACOUSTIC_PATHS.PARTICLE_SIZE_M, sizeAttenuation: true,
        transparent: true, opacity: 1, depthTest: false, depthWrite: false,
      }));
      const trailGeometry = new THREE.BufferGeometry();
      trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * n), 3));
      this.trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({
        color: getCssColorHex(vars.PARTICLE), transparent: true, opacity: 0.45, depthTest: false, depthWrite: false,
      }));
      group.add(this.trails, this.particles);
    }

    enableOverlay(group);
    this.scene.add(group);
    this.group = group;
    this.setTime(this.timeMs);
  }

  /** Move the billiard particles to `timeMs` after emission. */
  setTime(timeMs: number): void {
    this.timeMs = timeMs;
    if (!this.particles || !this.trails || !this.payload) return;
    const speed = this.payload.speed_of_sound;
    const distance = (speed * timeMs) / 1000;
    const trail = (speed * ACOUSTIC_PATHS.PARTICLE_TRAIL_MS) / 1000;
    const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
    const seg = this.trails.geometry.getAttribute('position') as THREE.BufferAttribute;
    let shown = 0;
    for (const track of this.tracks) {
      const head = pointAtDistance(track.points, track.cumulative, distance);
      if (!head) continue;
      // the tail stops at the last bounce, so it never cuts a corner through a wall
      const tailDistance = Math.max(distance - trail, track.cumulative[head[3]]);
      const tail = pointAtDistance(track.points, track.cumulative, tailDistance) ?? head;
      pos.setXYZ(shown, head[0], head[1], head[2]);
      seg.setXYZ(2 * shown, tail[0], tail[1], tail[2]);
      seg.setXYZ(2 * shown + 1, head[0], head[1], head[2]);
      shown++;
    }
    this.particles.geometry.setDrawRange(0, shown);
    this.trails.geometry.setDrawRange(0, 2 * shown);
    pos.needsUpdate = true;
    seg.needsUpdate = true;
  }

  /**
   * The shown edge under a pointer at canvas pixel (x, y), or null. Screen-space picking: lines
   * are one pixel wide, so a ray cast would need the same tolerance anyway.
   */
  pickEdge(x: number, y: number, camera: THREE.Camera, width: number, height: number): number | null {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const screen: ScreenEdge[] = [];
    for (const edge of this.shownEdges) {
      a.set(edge.segment[0], edge.segment[1], edge.segment[2]).project(camera);
      b.set(edge.segment[3], edge.segment[4], edge.segment[5]).project(camera);
      if (a.z > 1 || b.z > 1 || a.z < -1 || b.z < -1) continue; // behind the camera / clipped
      screen.push({
        id: edge.id,
        ax: (a.x * 0.5 + 0.5) * width, ay: (-a.y * 0.5 + 0.5) * height,
        bx: (b.x * 0.5 + 0.5) * width, by: (-b.y * 0.5 + 0.5) * height,
        depth: Math.min(a.z, b.z),
      });
    }
    return pickScreenEdge(screen, x, y, ACOUSTIC_PATHS.EDGE_PICK_PX);
  }

  edge(id: number): DiffractionEdge | undefined {
    return this.payload?.diffraction?.edges.find((e) => e.id === id);
  }

  clear(): void {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child instanceof THREE.LineSegments || child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    this.group = null;
    this.particles = null;
    this.trails = null;
    this.tracks = [];
    this.shownEdges = [];
  }

  dispose(): void {
    this.clear();
    this.payload = null;
  }
}

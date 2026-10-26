/**
 * Viewport hover highlight drawn as a border only. The hovered object's own
 * material is never touched, so it keeps the look of the active render style
 * (Rendered / Ghosted / Arctic / Wireframe) and its filter color.
 *
 * Speckle's hover swaps the object's material (renderer.setMaterial) to get a
 * stencil outline, and a swapped material escapes the render styles, which only
 * restyle each batch's base material. Instead, the hovered render view's
 * triangles are copied out of its batch into a small overlay mesh (OVERLAY
 * layer, drawn after the model) and outlined with a stencil dilation:
 *   1. mask   — the silhouette writes stencil STENCIL_REF (no color),
 *   2. border — the silhouette, shifted WIDTH_PX in DIRECTIONS screen
 *               directions, is colored where stencil != STENCIL_REF,
 *   3. unmask — the silhouette resets stencil to 0.
 * Depth testing is off, like Speckle's STENCIL-MASK pass (it clears depth), so
 * the border also shows through occluders.
 */

import * as THREE from 'three';
import {
  GeometryType,
  ObjectLayers,
  type NodeRenderView,
  type SpeckleRenderer,
} from '@speckle/viewer';
import { HOVER_OUTLINE } from '@/utils/constants';

const BORDER_VERTEX_SHADER = /* glsl */ `
#include <clipping_planes_pars_vertex>
uniform vec2 uOffset;     // drawing-buffer pixels
uniform vec2 uResolution; // drawing-buffer pixels
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  #include <clipping_planes_vertex>
  vec4 clip = projectionMatrix * mvPosition;
  clip.xy += uOffset * 2.0 / uResolution * clip.w;
  gl_Position = clip;
}
`;

const BORDER_FRAGMENT_SHADER = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform vec3 uColor;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(uColor, 1.0);
}
`;

/** Silhouette-only material writing `ref` into the stencil buffer. */
function createStencilMaterial(ref: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: ref,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilFail: THREE.ReplaceStencilOp,
  });
}

/** Border material: the silhouette shifted by `offset` CSS px, outside the mask only. */
function createBorderMaterial(offset: THREE.Vector2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uOffset: { value: new THREE.Vector2() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColor: { value: new THREE.Color(HOVER_OUTLINE.COLOR) },
    },
    vertexShader: BORDER_VERTEX_SHADER,
    fragmentShader: BORDER_FRAGMENT_SHADER,
    clipping: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilWriteMask: 0,
    stencilRef: HOVER_OUTLINE.STENCIL_REF,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilFail: THREE.KeepStencilOp,
    userData: { offsetCss: offset },
  });
}

/**
 * Copy the render view's triangles out of its mesh batch, in world space
 * relative to `origin` (keeps float32 precision on large-coordinate models).
 * Null for render views that are not plain mesh-batch triangles (lines,
 * points, instanced batches).
 */
function extractGeometry(
  renderer: SpeckleRenderer,
  renderView: NodeRenderView,
  origin: THREE.Vector3,
): THREE.BufferGeometry | null {
  const batch = renderer.batcher.batches[renderView.batchId];
  if (!batch || batch.geometryType !== GeometryType.MESH) return null;
  const mesh = batch.renderObject as THREE.Mesh & { isInstancedMesh?: boolean };
  if (!mesh.isMesh || mesh.isInstancedMesh) return null;

  const source = mesh.geometry;
  const index = source.getIndex();
  // RTE batches split each position into 'position' (high) + 'position_low'.
  const high = source.getAttribute('position');
  const low = source.getAttribute('position_low') as THREE.BufferAttribute | undefined;
  if (!index || !high) return null;

  const start = renderView.batchStart;
  const end = Math.min(start + renderView.batchCount, index.count);
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  for (let i = start; i < end; i++) {
    const src = index.getX(i);
    let dst = remap.get(src);
    if (dst === undefined) {
      dst = remap.size;
      remap.set(src, dst);
      v.set(high.getX(src), high.getY(src), high.getZ(src));
      if (low) {
        v.x += low.getX(src);
        v.y += low.getY(src);
        v.z += low.getZ(src);
      }
      v.applyMatrix4(mesh.matrixWorld).sub(origin);
      positions.push(v.x, v.y, v.z);
    }
    indices.push(dst);
  }
  if (indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export class HoverOutline {
  private group: THREE.Group | null = null;
  private current: NodeRenderView | null = null;
  private readonly resolution = new THREE.Vector2();

  constructor(private readonly renderer: SpeckleRenderer) {}

  /** Outline `renderView`, or clear the outline when null. */
  show(renderView: NodeRenderView | null): void {
    if (renderView === this.current) return;
    this.hide();
    if (!renderView) return;

    const origin = renderView.aabb.getCenter(new THREE.Vector3());
    const geometry = extractGeometry(this.renderer, renderView, origin);
    if (!geometry) return;

    const group = new THREE.Group();
    group.position.copy(origin);
    const clippingPlanes = this.renderer.clippingPlanes;
    const order = HOVER_OUTLINE.RENDER_ORDER;

    const add = (material: THREE.Material, renderOrder: number): THREE.Mesh => {
      material.clippingPlanes = clippingPlanes;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      mesh.layers.set(ObjectLayers.OVERLAY);
      // Never pickable: the hover itself must keep hitting the model.
      mesh.raycast = () => {};
      group.add(mesh);
      return mesh;
    };

    add(createStencilMaterial(HOVER_OUTLINE.STENCIL_REF), order);
    for (let k = 0; k < HOVER_OUTLINE.DIRECTIONS; k++) {
      const angle = (2 * Math.PI * k) / HOVER_OUTLINE.DIRECTIONS;
      const offset = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(HOVER_OUTLINE.WIDTH_PX);
      const border = add(createBorderMaterial(offset), order + 1);
      border.onBeforeRender = (webgl, _scene, _camera, _geometry, material) => {
        const uniforms = (material as THREE.ShaderMaterial).uniforms;
        webgl.getDrawingBufferSize(this.resolution);
        uniforms.uResolution.value.copy(this.resolution);
        uniforms.uOffset.value
          .copy((material.userData.offsetCss as THREE.Vector2))
          .multiplyScalar(webgl.getPixelRatio());
      };
    }
    add(createStencilMaterial(0), order + 2);

    this.renderer.scene.add(group);
    this.group = group;
    this.current = renderView;
  }

  hide(): void {
    this.current = null;
    if (!this.group) return;
    this.group.removeFromParent();
    const meshes = this.group.children as THREE.Mesh[];
    meshes[0]?.geometry.dispose();
    meshes.forEach((m) => (m.material as THREE.Material).dispose());
    this.group = null;
  }
}

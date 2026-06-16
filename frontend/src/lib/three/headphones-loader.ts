import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RECEIVER_CONFIG } from '@/utils/constants';

let cachedResult: { geometry: THREE.BufferGeometry; baseHalfSize: number } | null = null;
let loadPromise: Promise<{ geometry: THREE.BufferGeometry; baseHalfSize: number }> | null = null;

export interface HeadphonesGeometryResult {
  geometry: THREE.BufferGeometry;
  /** Half-extent of the largest axis after normalisation, used for screen-space scaling. */
  baseHalfSize: number;
}

/**
 * Merge an array of BufferGeometries into a single non-indexed BufferGeometry.
 * Each input geometry must already have its world transform baked in.
 */
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();

  let totalVertices = 0;
  const attrNames = new Set<string>();

  for (const g of geos) {
    for (const name of Object.keys(g.attributes)) {
      attrNames.add(name);
    }
    const posAttr = g.attributes.position;
    if (posAttr) totalVertices += posAttr.count;
  }

  const attrNameList = [...attrNames];

  for (const name of attrNameList) {
    const firstAttr = geos.find((g) => g.attributes[name])?.attributes[name];
    if (!firstAttr) continue;
    const itemSize = firstAttr.itemSize;
    const array = new Float32Array(totalVertices * itemSize);

    let offset = 0;
    for (const g of geos) {
      const attr = g.attributes[name];
      if (attr) {
        const src = attr.array as Float32Array;
        array.set(src, offset * itemSize);
        offset += attr.count;
      } else {
        offset += (g.attributes.position?.count ?? 0);
      }
    }

    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  return merged;
}

export function loadHeadphonesGeometry(scaleForSounds: number): Promise<HeadphonesGeometryResult> {
  if (cachedResult && cachedResult.baseHalfSize === RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * scaleForSounds) {
    return Promise.resolve(cachedResult);
  }

  if (loadPromise) return loadPromise;

  const targetHalfSize = RECEIVER_CONFIG.CUBE_SIZE_MULTIPLIER * scaleForSounds;

  loadPromise = new Promise((resolve, reject) => {
    const loader = new OBJLoader();
    loader.load(
      '/Headphones.obj',
      (group) => {
        const geometries: THREE.BufferGeometry[] = [];

        group.updateMatrixWorld();
        group.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            const geom = child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld);
            geometries.push(geom);
          }
        });

        if (geometries.length === 0) {
          loadPromise = null;
          reject(new Error('Headphones.obj contains no mesh geometry'));
          return;
        }

        const merged = mergeGeos(geometries);
        merged.computeBoundingBox();

        const bbox = merged.boundingBox!;
        const sizeX = bbox.max.x - bbox.min.x;
        const sizeY = bbox.max.y - bbox.min.y;
        const sizeZ = bbox.max.z - bbox.min.z;
        const largestDimension = Math.max(sizeX, sizeY, sizeZ);

        if (largestDimension > 0.0001) {
          const normaliseScale = (targetHalfSize * 2) / largestDimension;
          merged.scale(normaliseScale, normaliseScale, normaliseScale);
          merged.computeBoundingBox();
        }

        cachedResult = { geometry: merged, baseHalfSize: targetHalfSize };
        resolve(cachedResult);
      },
      undefined,
      (err) => {
        loadPromise = null;
        reject(err);
      }
    );
  });

  return loadPromise;
}

/**
 * Reset the cached geometry so the next call re-loads the OBJ.
 * Useful when scaleForSounds changes.
 */
export function invalidateHeadphonesCache(): void {
  if (cachedResult) {
    cachedResult.geometry.dispose();
    cachedResult = null;
  }
  loadPromise = null;
}

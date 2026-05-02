// Helper Functions

/**
 * Read a CSS custom property at runtime and return its hex value as a Three.js-compatible number.
 * Call only in browser context (not SSR).
 */
export function getCssColorHex(cssVar: string): number {
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar).trim().replace('#', '');
  return parseInt(val, 16);
}

/**
 * Generate a gradient color for acoustic materials based on absorption coefficient.
 * Reads gradient stops from CSS custom properties (--color-material-start/mid/end)
 * at call time; falls back to the original values for SSR.
 *
 * @param absorption - Absorption coefficient (0-1)
 * @returns Hex color string
 */
export function getMaterialColorByAbsorption(absorption: number): string {
  if (typeof absorption !== 'number' || isNaN(absorption)) {
    console.warn('[getMaterialColorByAbsorption] Invalid absorption value:', absorption, 'Using default color');
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    return root ? getComputedStyle(root).getPropertyValue('--color-secondary-hover').trim() || '#787878' : '#787878';
  }

  const ratio = Math.max(0, Math.min(1, absorption));

  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const cssHex = (varName: string, fallback: string): string => {
    if (!root) return fallback;
    return getComputedStyle(root).getPropertyValue(varName).trim().replace('#', '') || fallback;
  };

  let startHex: string;
  let endHex: string;
  let localRatio: number;

  if (ratio < 0.5) {
    startHex = cssHex('--color-material-start', '67bfb4');
    endHex = cssHex('--color-material-mid', 'ffbf6d');
    localRatio = ratio * 2;
  } else {
    startHex = cssHex('--color-material-mid', 'ffbf6d');
    endHex = cssHex('--color-material-end', 'eb5c52');
    localRatio = (ratio - 0.5) * 2;
  }

  const r1 = parseInt(startHex.substring(0, 2), 16);
  const g1 = parseInt(startHex.substring(2, 4), 16);
  const b1 = parseInt(startHex.substring(4, 6), 16);

  const r2 = parseInt(endHex.substring(0, 2), 16);
  const g2 = parseInt(endHex.substring(2, 4), 16);
  const b2 = parseInt(endHex.substring(4, 6), 16);

  const r = Math.round(r1 + (r2 - r1) * localRatio);
  const g = Math.round(g1 + (g2 - g1) * localRatio);
  const b = Math.round(b1 + (b2 - b1) * localRatio);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Triangulate faces into triangle indices
 * @param faces - Array of face vertex indices
 * @returns Array of triangle vertex indices
 */
export function triangulate(faces: number[][]): number[] {
  const indices: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    const v0 = face[0];
    for (let i = 1; i < face.length - 1; i++) {
      indices.push(v0, face[i], face[i + 1]);
    }
  }
  return indices;
}

/**
 * Triangulate faces and create mapping from triangle index to original face index
 * @param faces - Array of face vertex indices
 * @returns Object containing triangle indices and triangle-to-face mapping
 */
export function triangulateWithMapping(faces: number[][]): {
  indices: number[];
  triangleToFaceMap: number[];
} {
  const indices: number[] = [];
  const triangleToFaceMap: number[] = [];

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex];
    if (face.length < 3) continue;

    const v0 = face[0];
    for (let i = 1; i < face.length - 1; i++) {
      indices.push(v0, face[i], face[i + 1]);
      triangleToFaceMap.push(faceIndex); // Map this triangle to the original face
    }
  }

  return { indices, triangleToFaceMap };
}

export function validateFileExtension(filename: string, validExtensions: string[]): boolean {
  const fileExtension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return validExtensions.includes(fileExtension);
}

export function calculateGeometryBounds(vertices: number[][]): { min: [number, number, number], max: [number, number, number] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  vertices.forEach((vertex: number[]) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], vertex[i]);
      max[i] = Math.max(max[i], vertex[i]);
    }
  });

  return { min: min as [number, number, number], max: max as [number, number, number] };
}

export function calculateScaleForSounds(bounds: {min: [number, number, number], max: [number, number, number]}): number {
  const sizeX = bounds.max[0] - bounds.min[0];
  const sizeY = bounds.max[1] - bounds.min[1];
  const sizeZ = bounds.max[2] - bounds.min[2];
  const maxDimension = Math.max(sizeX, sizeY, sizeZ);
  const scaleFactor = maxDimension / 10;
  return Math.max(0.2, Math.min(scaleFactor, 5));
}

/**
 * Trim display name to a maximum of 5 words
 * @param name - The display name to trim
 * @returns Trimmed display name with "..." if truncated
 */
export function trimDisplayName(name: string): string {
  if (!name) return '';
  const words = name.trim().split(/\s+/);
  if (words.length <= 3) return name;
  return words.slice(0, 3).join(' ') + '...';
}

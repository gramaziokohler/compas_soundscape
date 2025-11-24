// Helper Functions

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

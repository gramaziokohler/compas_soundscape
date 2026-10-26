/**
 * Material lookup for the PFFDTD voxel preview.
 *
 * The backend legend reports the material id it simulated, which is the
 * frontend id with the `pyroom_` prefix stripped (wave-based cards share the
 * pyroomacoustics database). Resolving it back to the frontend material gives
 * the voxel points and legend exactly the colour and name the material has in
 * the viewer and the Object Explorer.
 */

import { getMaterialColorByAbsorption } from '@/utils/utils';
import { PFFDTD } from '@/utils/constants';
import type { AcousticMaterial } from '@/types/materials';

/** Frontend material of a backend legend id (prefixed or not); null when unknown. */
export function resolvePffdtdMaterial(
  materialId: string | null | undefined,
  materials: AcousticMaterial[],
): AcousticMaterial | null {
  if (!materialId) return null;
  const prefixed = materialId.startsWith(PFFDTD.MATERIAL_ID_PREFIX)
    ? materialId
    : `${PFFDTD.MATERIAL_ID_PREFIX}${materialId}`;
  return materials.find((m) => m.id === prefixed || m.id === materialId) ?? null;
}

/** Viewer colour of a backend legend id (same absorption ramp as the model), or null when unknown. */
export function pffdtdMaterialColor(
  materialId: string | null | undefined,
  materials: AcousticMaterial[],
): string | null {
  const material = resolvePffdtdMaterial(materialId, materials);
  return material ? getMaterialColorByAbsorption(material.absorption) : null;
}

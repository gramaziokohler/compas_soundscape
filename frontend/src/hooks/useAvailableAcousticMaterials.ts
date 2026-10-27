/**
 * useAvailableAcousticMaterials Hook
 *
 * Merges the built-in absorption database with the user's custom materials
 * (library) and the custom materials of a shared soundscape that are not in
 * the library (snapshot, flagged `isShared`). The merged list is what every
 * material picker, viewer colour and summary resolves against.
 *
 * @example
 * const materials = useAvailableAcousticMaterials(pyroomMaterials, hasPyroomCard);
 */

import { useEffect, useMemo } from 'react';
import { useCustomMaterialStore, customRecordToMaterial } from '@/store';
import type { AcousticMaterial } from '@/types/materials';

export function useAvailableAcousticMaterials(
  builtInMaterials: AcousticMaterial[],
  enabled: boolean,
): AcousticMaterial[] {
  const library = useCustomMaterialStore((s) => s.library);
  const snapshot = useCustomMaterialStore((s) => s.snapshot);
  const load = useCustomMaterialStore((s) => s.load);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return useMemo(() => {
    const libraryIds = new Set(library.map((m) => m.id));
    return [
      ...builtInMaterials,
      ...library.map((m) => customRecordToMaterial(m)),
      ...snapshot.filter((m) => !libraryIds.has(m.id)).map((m) => customRecordToMaterial(m, true)),
    ];
  }, [builtInMaterials, library, snapshot]);
}

/**
 * useAcousticsMaterials Hook
 *
 * Simulation-agnostic hook for loading and mapping acoustic materials.
 * Can be used with any material API endpoint.
 *
 * @example
 * // For Pyroomacoustics
 * const { materials, isLoading } = useAcousticsMaterials({
 *   fetchMaterials: () => apiService.getPyroomacousticsMaterials(),
 *   idPrefix: 'pyroom'
 * });
 *
 * // For Choras
 * const { materials, isLoading } = useAcousticsMaterials({
 *   fetchMaterials: () => apiService.getChorasMaterials(),
 *   idPrefix: 'choras'
 * });
 */

import { useState, useEffect, useMemo } from 'react';
import type { AcousticMaterial } from '@/types/materials';

interface UseAcousticsMaterialsProps {
  /** Function that fetches materials from API */
  fetchMaterials: () => Promise<any[]>;
  /** Prefix to add to material IDs (e.g., 'pyroom', 'choras') */
  idPrefix: string;
  /** Default absorption value if not provided by API */
  defaultAbsorption?: number;
}

export interface UseAcousticsMaterialsReturn {
  /** Mapped materials in AcousticMaterial format */
  materials: AcousticMaterial[];
  /** Raw materials from API */
  rawMaterials: any[];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: string | null;
  /** Reload materials */
  reload: () => void;
}

/**
 * Generic hook for loading and mapping acoustic materials from any source
 */
export function useAcousticsMaterials({
  fetchMaterials,
  idPrefix,
  defaultAbsorption = 0.5
}: UseAcousticsMaterialsProps): UseAcousticsMaterialsReturn {
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMaterials = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const materials = await fetchMaterials();
      setRawMaterials(materials);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to load materials';
      console.error(`[useAcousticsMaterials] ${idPrefix}:`, e);
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Load materials on mount
  useEffect(() => {
    loadMaterials();
  }, []);

  /**
   * Map raw materials to common AcousticMaterial format
   */
  const materials = useMemo<AcousticMaterial[]>(() =>
    rawMaterials.map(mat => ({
      id: `${idPrefix}_${mat.id}`,
      name: mat.name,
      absorption: mat.absorption ?? defaultAbsorption,
      category: mat.category as any || 'Wall',
      description: mat.description
    })), [rawMaterials, idPrefix, defaultAbsorption]);

  return {
    materials,
    rawMaterials,
    isLoading,
    error,
    reload: loadMaterials
  };
}

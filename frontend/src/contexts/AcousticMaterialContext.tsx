/**
 * AcousticMaterialContext
 *
 * Bridges acoustic material assignment state between left sidebar (producer)
 * and right sidebar (consumers: EntityInfoPanel, ObjectExplorer).
 *
 * Uses refs to avoid re-render loops — consumers pull state via getters,
 * and a version counter triggers re-renders only when state actually changes.
 */

'use client';

import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from 'react';
import type { AcousticMaterial } from '@/types/materials';
import type { HierarchicalMeshObject } from '@/hooks/useSpeckleSurfaceMaterials';
import type { SpeckleLayerInfo } from '@/types/speckle-materials';

// ============================================================================
// Types
// ============================================================================

export interface AcousticMaterialState {
  meshObjects: HierarchicalMeshObject[];
  materialAssignments: Map<string, string>;
  availableMaterials: AcousticMaterial[];
  selectedLayerId: string | null;
  layerOptions: SpeckleLayerInfo[];
  assignMaterial: (objectId: string, materialId: string) => void;
  assignMaterialToAll: (materialId: string) => void;
  getMaterialColor: (materialId: string) => string;
}

interface AcousticMaterialContextValue {
  /** Whether a simulation card is currently publishing material state */
  isActive: boolean;
  /** Version counter — increments when published state changes */
  version: number;
  /** Layer ID that ObjectExplorer should expand/scroll to */
  expandToLayerId: string | null;
  /** Push material state into context (called by SpeckleSurfaceMaterialsSection) */
  publishMaterialState: (state: AcousticMaterialState) => void;
  /** Clear all published state (called on unmount) */
  clearMaterialState: () => void;
  /** Get the current published state (returns null when inactive) */
  getMaterialState: () => AcousticMaterialState | null;
}

// ============================================================================
// Context
// ============================================================================

const AcousticMaterialContext = createContext<AcousticMaterialContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function AcousticMaterialProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [version, setVersion] = useState(0);
  const [expandToLayerId, setExpandToLayerId] = useState<string | null>(null);

  // Store published state in a ref to avoid re-render cascades
  const stateRef = useRef<AcousticMaterialState | null>(null);

  const publishMaterialState = useCallback((state: AcousticMaterialState) => {
    stateRef.current = state;

    // Update expandToLayerId when layer changes
    setExpandToLayerId(state.selectedLayerId);

    setIsActive(true);
    setVersion(v => v + 1);
  }, []);

  const clearMaterialState = useCallback(() => {
    stateRef.current = null;
    setIsActive(false);
    setExpandToLayerId(null);
    setVersion(v => v + 1);
  }, []);

  const getMaterialState = useCallback((): AcousticMaterialState | null => {
    return stateRef.current;
  }, []);

  return (
    <AcousticMaterialContext.Provider
      value={{
        isActive,
        version,
        expandToLayerId,
        publishMaterialState,
        clearMaterialState,
        getMaterialState
      }}
    >
      {children}
    </AcousticMaterialContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useAcousticMaterial() {
  const ctx = useContext(AcousticMaterialContext);
  if (!ctx) {
    throw new Error('useAcousticMaterial must be used within AcousticMaterialProvider');
  }
  return ctx;
}

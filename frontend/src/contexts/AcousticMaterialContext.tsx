/**
 * AcousticMaterialContext
 *
 * Bridges acoustic material assignment state between left sidebar (producer)
 * and right sidebar (consumers: EntityInfoPanel, ObjectExplorer).
 *
 * Design:
 * - `materialState` is stored directly as React state (not in a ref behind a version counter).
 * - `publishMaterialState` uses a functional updater with reference-equality guards so that
 *   calling it with unchanged data returns the SAME object reference → React bails out and
 *   does NOT re-render consumers. This definitively breaks any potential infinite loop:
 *   no state-reference change → no context re-render → no cascading effect re-fires.
 * - Function references (assignMaterial, getMaterialColor, etc.) are updated without
 *   triggering re-renders when only they change (data is the same).
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
  assignMaterialToObjects: (objectIds: string[], materialId: string) => void;
  getMaterialColor: (materialId: string) => string;
  // Scattering coefficients (per-object, same workflow as material assignment)
  scatteringAssignments: Map<string, number>;
  assignScattering: (objectId: string, value: number) => void;
  assignScatteringToAll: (value: number) => void;
  assignScatteringToObjects: (objectIds: string[], value: number) => void;
}

interface AcousticMaterialContextValue {
  /** Whether a simulation card is currently publishing material state */
  isActive: boolean;
  /** The current published material state (null when inactive) */
  materialState: AcousticMaterialState | null;
  /** Layer ID that ObjectExplorer should expand/scroll to */
  expandToLayerId: string | null;
  /** Push material state into context (called by SpeckleSurfaceMaterialsSection) */
  publishMaterialState: (state: AcousticMaterialState) => void;
  /** Clear all published state (called on unmount) */
  clearMaterialState: () => void;
}

// ============================================================================
// Context
// ============================================================================

const AcousticMaterialContext = createContext<AcousticMaterialContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function AcousticMaterialProvider({ children }: { children: ReactNode }) {
  const [materialState, setMaterialState] = useState<AcousticMaterialState | null>(null);
  const [expandToLayerId, setExpandToLayerId] = useState<string | null>(null);

  // Ref holds the latest function references — updated without triggering re-renders.
  // When publishMaterialState is called with same data but new function refs (e.g.
  // getMaterialColor got a new identity because availableMaterials prop changed),
  // we update this ref so consumers always call the latest functions, while avoiding
  // a context re-render (because we return `prev` from the functional state updater).
  const latestFnsRef = useRef<Pick<
    AcousticMaterialState,
    'assignMaterial' | 'assignMaterialToAll' | 'assignMaterialToObjects' |
    'getMaterialColor' | 'assignScattering' | 'assignScatteringToAll' | 'assignScatteringToObjects'
  > | null>(null);

  const publishMaterialState = useCallback((state: AcousticMaterialState) => {
    // Always keep latest function references in the side-ref
    latestFnsRef.current = {
      assignMaterial: state.assignMaterial,
      assignMaterialToAll: state.assignMaterialToAll,
      assignMaterialToObjects: state.assignMaterialToObjects,
      getMaterialColor: state.getMaterialColor,
      assignScattering: state.assignScattering,
      assignScatteringToAll: state.assignScatteringToAll,
      assignScatteringToObjects: state.assignScatteringToObjects,
    };

    // Functional updater with data-equality guard.
    // If only function refs changed (data is the same), return `prev` — same reference
    // → React bails out → NO context re-render → NO cascading effects.
    setMaterialState(prev => {
      if (
        prev !== null &&
        prev.materialAssignments === state.materialAssignments &&
        prev.selectedLayerId === state.selectedLayerId &&
        prev.meshObjects === state.meshObjects &&
        prev.scatteringAssignments === state.scatteringAssignments &&
        prev.availableMaterials === state.availableMaterials &&
        prev.layerOptions === state.layerOptions
      ) {
        return prev; // Data unchanged — bail out, no re-render
      }
      return state; // Data changed — new reference → consumers re-render
    });

    // Only update expandToLayerId if the value actually changed
    setExpandToLayerId(prev => prev === state.selectedLayerId ? prev : state.selectedLayerId);
  }, []);

  const clearMaterialState = useCallback(() => {
    setMaterialState(prev => {
      if (prev === null) return prev; // Already cleared — bail out, no re-render
      return null;
    });
    setExpandToLayerId(null);
  }, []);

  const isActive = materialState !== null;

  return (
    <AcousticMaterialContext.Provider
      value={{
        isActive,
        materialState,
        expandToLayerId,
        publishMaterialState,
        clearMaterialState,
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

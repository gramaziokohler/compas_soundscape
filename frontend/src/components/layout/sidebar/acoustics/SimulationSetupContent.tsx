/**
 * SimulationSetupContent Component
 *
 * Wrapper component for simulation setup UI.
 * Combines material assignment (SpeckleSurfaceMaterialsSection) with
 * simulation-specific settings (Choras or Pyroomacoustics).
 *
 * This component extracts the setup UI from AcousticsSection for better modularity.
 */

'use client';

import { useEffect } from 'react';
import { SpeckleSurfaceMaterialsSection } from '@/components/acoustics/SpeckleSurfaceMaterialsSection';
import { ChorasSimulationSettings } from './ChorasSimulationSettings';
import { PyroomAcousticsSimulationSettings } from './PyroomAcousticsSimulationSettings';
import type { SimulationConfig, ChorasSimulationConfig, PyroomAcousticsSimulationConfig } from '@/types/acoustics';
import type { AcousticMaterial } from '@/types/materials';
import type { Viewer } from '@speckle/viewer';

interface SimulationSetupContentProps {
  config: SimulationConfig;
  index: number;
  viewerRef: React.RefObject<Viewer | null>;
  worldTree: any;
  availableMaterials: AcousticMaterial[];
  /** When true, layer isolation filtering is active in the Speckle viewer */
  filteringEnabled?: boolean;
  /** When true, UI controls are disabled (read-only mode for completed simulations) */
  isReadOnly?: boolean;
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void;
  onUpdateConfig: (updates: Partial<SimulationConfig>) => void;
  onIsolationChange?: (ids: string[] | null) => void;
}

/**
 * Renders the simulation setup UI based on simulation type
 */
export function SimulationSetupContent({
  config,
  index,
  viewerRef,
  worldTree,
  availableMaterials,
  filteringEnabled = true,
  isReadOnly = false,
  onMaterialAssignmentsChange,
  onUpdateConfig,
  onIsolationChange,
}: SimulationSetupContentProps) {
  // Extract persisted Speckle state from config
  const initialAssignments = (config as any).speckleMaterialAssignments as Record<string, string> | undefined;
  const initialLayerName = (config as any).speckleLayerName as string | null | undefined;
  const initialScatteringAssignments = (config as any).speckleScatteringAssignments as Record<string, number> | undefined;
  const initialIsolatedObjectIds = (config as any).speckleIsolatedObjectIds as string[] | null | undefined;

  // DEBUG: log what we receive on mount and when config changes
  useEffect(() => {
    console.log(`[SimulationSetupContent #${index}] MOUNT — config.state=${config.state} isReadOnly=${isReadOnly}`);
    console.log(`[SimulationSetupContent #${index}] initialAssignments:`, initialAssignments ? Object.keys(initialAssignments).length + ' entries' : 'undefined', initialAssignments);
    console.log(`[SimulationSetupContent #${index}] initialLayerName:`, initialLayerName);
    console.log(`[SimulationSetupContent #${index}] worldTree:`, worldTree ? 'present' : 'null/undefined');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.log(`[SimulationSetupContent #${index}] worldTree changed:`, worldTree ? 'present' : 'null/undefined');
  }, [index, worldTree]);

  return (
    <div className="space-y-4">
      {/* Surface Materials Selection */}
      <SpeckleSurfaceMaterialsSection
        viewerRef={viewerRef}
        worldTree={worldTree}
        availableMaterials={availableMaterials}
        filteringEnabled={filteringEnabled}
        isReadOnly={isReadOnly}
        onMaterialAssignmentsChange={onMaterialAssignmentsChange}
        initialAssignments={initialAssignments}
        initialLayerName={initialLayerName}
        initialScatteringAssignments={initialScatteringAssignments}
        initialIsolatedObjectIds={initialIsolatedObjectIds}
        onIsolationChange={onIsolationChange}
      />

      {/* Choras Settings */}
      {config.type === 'choras' && (
        <ChorasSimulationSettings
          config={config as ChorasSimulationConfig}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Pyroomacoustics Settings */}
      {config.type === 'pyroomacoustics' && (
        <PyroomAcousticsSimulationSettings
          config={config as PyroomAcousticsSimulationConfig}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

    </div>
  );
}

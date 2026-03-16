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
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void;
  onUpdateConfig: (updates: Partial<SimulationConfig>) => void;
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
  onMaterialAssignmentsChange,
  onUpdateConfig
}: SimulationSetupContentProps) {
  // Extract persisted Speckle material assignments from config
  const initialAssignments = (config as any).speckleMaterialAssignments as Record<string, string> | undefined;
  const initialLayerName = (config as any).speckleLayerName as string | null | undefined;
  const initialScatteringAssignments = (config as any).speckleScatteringAssignments as Record<string, number> | undefined;

  return (
    <div className="space-y-4">
      {/* Surface Materials Selection */}
      <SpeckleSurfaceMaterialsSection
        viewerRef={viewerRef}
        worldTree={worldTree}
        availableMaterials={availableMaterials}
        onMaterialAssignmentsChange={onMaterialAssignmentsChange}
        initialAssignments={initialAssignments}
        initialLayerName={initialLayerName}
        initialScatteringAssignments={initialScatteringAssignments}
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

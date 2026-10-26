/**
 * SimulationSetupContent Component
 *
 * Wrapper component for simulation setup UI.
 * Shows the simulation-specific settings (Pyroomacoustics or wave-based
 * PFFDTD) and the pre-simulation check: the mesh geometry check for
 * pyroomacoustics, the voxel preview for PFFDTD (it simulates the voxel grid,
 * not the mesh).
 * Source / listener / material counts live in the card footer (SimulationSummaryBar).
 *
 * Also mounts the headless SpeckleSurfaceMaterialsSection so the acoustic
 * material store stays activated while a simulation card exists — this drives
 * the material/scattering columns in the Object Explorer.
 *
 * This component extracts the setup UI from AcousticsSection for better modularity.
 */

'use client';

import { SpeckleSurfaceMaterialsSection } from '@/components/acoustics/SpeckleSurfaceMaterialsSection';
import { PyroomAcousticsSimulationSettings } from './PyroomAcousticsSimulationSettings';
import { PffdtdSimulationSettings } from './PffdtdSimulationSettings';
import { SimulationPreflightPanel, type PreflightPanelControl } from './SimulationPreflightPanel';
import { PffdtdVoxelPreviewPanel, type VoxelPreviewControl } from './PffdtdVoxelPreviewPanel';
import type { SimulationConfig, PyroomAcousticsSimulationConfig } from '@/types/acoustics';
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
  /** True when this card is the expanded/active one that owns the shared material store. */
  isActive?: boolean;
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void;
  onUpdateConfig: (updates: Partial<SimulationConfig>) => void;
  onIsolationChange?: (ids: string[] | null) => void;
  /** Pre-simulation geometry check wiring (pyroomacoustics cards). */
  preflight?: PreflightPanelControl;
  /** Voxel preview wiring (PFFDTD cards). */
  voxelPreview?: VoxelPreviewControl;
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
  isActive = true,
  onMaterialAssignmentsChange,
  onUpdateConfig,
  onIsolationChange,
  preflight,
  voxelPreview,
}: SimulationSetupContentProps) {
  // Extract persisted Speckle state from config
  const initialAssignments = (config as any).speckleMaterialAssignments as Record<string, string> | undefined;
  const initialLayerName = (config as any).speckleLayerName as string | null | undefined;
  const initialScatteringAssignments = (config as any).speckleScatteringAssignments as Record<string, number> | undefined;
  const initialIsolatedObjectIds = (config as any).speckleIsolatedObjectIds as string[] | null | undefined;

  return (
    <div className="card-stack">
      {/* Headless — activates the acoustic material store so the Object Explorer
          shows the material/scattering assignment columns for this simulation */}
      <SpeckleSurfaceMaterialsSection
        viewerRef={viewerRef}
        worldTree={worldTree}
        availableMaterials={availableMaterials}
        cardType={config.type === 'pyroomacoustics' || config.type === 'pffdtd' ? config.type : null}
        filteringEnabled={filteringEnabled}
        isReadOnly={isReadOnly}
        isActive={isActive}
        onMaterialAssignmentsChange={onMaterialAssignmentsChange}
        initialAssignments={initialAssignments}
        initialLayerName={initialLayerName}
        initialScatteringAssignments={initialScatteringAssignments}
        initialIsolatedObjectIds={initialIsolatedObjectIds}
        onIsolationChange={onIsolationChange}
      />

      {/* Pyroomacoustics Settings */}
      {config.type === 'pyroomacoustics' && (
        <PyroomAcousticsSimulationSettings
          config={config as PyroomAcousticsSimulationConfig}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Wave-based (PFFDTD) Settings */}
      {config.type === 'pffdtd' && (
        <PffdtdSimulationSettings
          config={config}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Pre-simulation geometry check: the exact mesh the engine will use */}
      {preflight && config.type === 'pyroomacoustics' && (
        <SimulationPreflightPanel
          configId={config.id}
          engine={config.type}
          {...preflight}
        />
      )}

      {/* PFFDTD voxel grid: what the wave solver will actually see */}
      {voxelPreview && config.type === 'pffdtd' && (
        <PffdtdVoxelPreviewPanel configId={config.id} {...voxelPreview} />
      )}

    </div>
  );
}

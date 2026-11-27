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
import { HybridSimulationSettings } from './HybridSimulationSettings';
import { Hybrid2SimulationSettings } from './Hybrid2SimulationSettings';
import { isGeometricSimulation, materialColumnsType } from '@/types/acoustics';
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
  /**
   * Hybrid simulation 2: the body of its Check or Run step. When given, it replaces the
   * settings; the headless material section stays mounted so the materials keep showing.
   */
  stepBody?: React.ReactNode;
  /** Hybrid simulation 2 on its Results / Run step: only the headless material section is mounted. */
  bodyHidden?: boolean;
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
  stepBody,
  bodyHidden = false,
}: SimulationSetupContentProps) {
  // the settings, panels and previews give way to a step's body, or to nothing (bodyHidden)
  const replaced = bodyHidden || !!stepBody;
  const isHybrid2 = config.type === 'hybrid' && config.uiVersion === 2;
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
        cardType={materialColumnsType(config)}
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

      {/* Hybrid simulation 2, Check step: the geometry check in place of the settings */}
      {!bodyHidden && stepBody}

      {/* Pyroomacoustics Settings */}
      {!replaced && config.type === 'pyroomacoustics' && (
        <PyroomAcousticsSimulationSettings
          config={config as PyroomAcousticsSimulationConfig}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Wave-based (PFFDTD) Settings */}
      {!replaced && config.type === 'pffdtd' && (
        <PffdtdSimulationSettings
          config={config}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Hybrid (wave below the crossover, rays above) settings */}
      {!replaced && config.type === 'hybrid' && isHybrid2 && (
        <Hybrid2SimulationSettings
          config={config}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}
      {!replaced && config.type === 'hybrid' && !isHybrid2 && (
        <HybridSimulationSettings
          config={config}
          onUpdateConfig={(updates) => onUpdateConfig(updates as Partial<SimulationConfig>)}
        />
      )}

      {/* Pre-simulation geometry check: the exact mesh the engine will use */}
      {/* (Hybrid simulation 2 shows it as its own step: stepBody) */}
      {preflight && isGeometricSimulation(config) && !isHybrid2 && (
        <SimulationPreflightPanel
          configId={config.id}
          engine="pyroomacoustics"
          {...preflight}
        />
      )}

      {/* PFFDTD voxel grid: what the wave solver will actually see */}
      {voxelPreview && !replaced && config.type === 'pffdtd' && (
        <PffdtdVoxelPreviewPanel configId={config.id} {...voxelPreview} />
      )}

    </div>
  );
}

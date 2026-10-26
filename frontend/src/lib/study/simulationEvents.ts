import { logStudyEvent } from '@/lib/study/studyLogger';
import { captureStudySnapshot } from '@/lib/study/snapshot';
import { speckleCardFields } from '@/utils/simulationRequest';
import type { SimulationConfig } from '@/types/acoustics';
import type { ImpulseResponseMetadata } from '@/types/audio';

/**
 * Research-study events for room-acoustics simulations (pyroomacoustics /
 * PFFDTD), called from AcousticsSection so the component only needs one line
 * per site. `sim.launch` carries the design snapshot hash, so a simulation can
 * be tied to the exact geometry / materials / sources it was run on.
 */

/** Material-assignment summary: material id → number of objects using it. */
function countMaterials(assignments: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!assignments || typeof assignments !== 'object') return counts;
  for (const material of Object.values(assignments as Record<string, unknown>)) {
    const key = typeof material === 'string' ? material : String((material as { id?: unknown })?.id ?? 'unknown');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function logSimulationLaunch(index: number, config: SimulationConfig): void {
  try {
    const fields = speckleCardFields(config);
    const payload = {
      index,
      engine: config.type,
      config_id: config.id,
      name: (config as { name?: string }).name ?? null,
      settings: 'settings' in config ? config.settings : null,
      layer: fields.speckleLayerName ?? null,
      material_counts: countMaterials(fields.speckleMaterialAssignments),
      material_assignments: fields.speckleMaterialAssignments ?? null,
      scattering_assignments: fields.speckleScatteringAssignments ?? null,
    };
    void captureStudySnapshot().then((snapshotHash) =>
      logStudyEvent('sim.launch', { ...payload, snapshot_hash: snapshotHash }),
    );
  } catch {
    // study logging never affects the simulation
  }
}

export function logSimulationResult(
  index: number,
  engine: string,
  simulationId: string | null,
  irs: { importedIRIds: string[]; importedIRMetadataList: ImpulseResponseMetadata[] },
): void {
  logStudyEvent('sim.result', {
    index,
    engine,
    simulation_id: simulationId,
    ir_ids: irs.importedIRIds,
    irs: irs.importedIRMetadataList.map((m) => ({ id: m.id, name: m.name, channels: m.channels, duration: m.duration })),
    audio_refs: irs.importedIRMetadataList.map((m) => m.url).filter(Boolean),
  });
}

/**
 * Copy material assignments — shared helpers for the "Copy materials to …" rows
 * of the simulation card menus (Simple bubbles and Expert cards).
 *
 * Ray-tracing, wave-based and Import-IRs cards draw from the same material
 * library, so their Speckle assignments (applicationId → material id) transfer
 * as-is. The copy also carries the acoustic region the assignments were made on.
 * A completed target keeps its results: the new assignments enter its generation
 * signature, which surfaces "Regenerate".
 */

import { notifyError } from '@/store';
import type { SimulationAcousticSelection, SimulationConfig } from '@/types/acoustics';
import { CARD_TYPE_LABELS } from '@/types/card';
import { COPY_MATERIALS } from '@/utils/constants';

type MaterialCardType = (typeof COPY_MATERIALS.TYPES)[number];

/** Material-related fields a card stores (not all are declared on every config type). */
interface MaterialAssignmentFields {
  speckleMaterialAssignments?: Record<string, string>;
  speckleScatteringAssignments?: Record<string, number>;
  speckleLayerName?: string | null;
  speckleGeometryObjectIds?: string[];
  speckleAcousticSelection?: SimulationAcousticSelection;
  materialAssignmentsEnabled?: boolean;
}

/** A menu row independent of the menu component (ContextMenu / Card kebab). */
export interface CopyMaterialsRow {
  key: string;
  /** Target card name. */
  label: string;
  onClick: () => void;
}

export interface CopyMaterialsRowsOptions {
  configs: SimulationConfig[];
  sourceIndex: number;
  /** Applies the updates to the target card. */
  onUpdate: (targetIndex: number, updates: Partial<SimulationConfig>) => void;
}

export function canHoldMaterials(config: SimulationConfig | undefined): boolean {
  return !!config && (COPY_MATERIALS.TYPES as readonly string[]).includes(config.type as MaterialCardType);
}

function materialFields(config: SimulationConfig): MaterialAssignmentFields {
  return config as unknown as MaterialAssignmentFields;
}

export function countMaterialAssignments(config: SimulationConfig | undefined): number {
  if (!config || !canHoldMaterials(config)) return 0;
  return Object.keys(materialFields(config).speckleMaterialAssignments ?? {}).length;
}

/** Display name of a simulation card (custom name, else its type label). */
export function simulationCardName(config: SimulationConfig): string {
  return config.display_name || CARD_TYPE_LABELS[config.type] || 'Simulation';
}

/** Config updates that give `target` a copy of the source's material assignments. */
export function buildMaterialCopyUpdates(
  source: SimulationConfig,
  target: SimulationConfig,
): Partial<SimulationConfig> {
  const src = materialFields(source);
  const sel = src.speckleAcousticSelection;
  const updates: MaterialAssignmentFields = {
    speckleMaterialAssignments: { ...(src.speckleMaterialAssignments ?? {}) },
    speckleLayerName: src.speckleLayerName ?? null,
    speckleGeometryObjectIds: [...(src.speckleGeometryObjectIds ?? [])],
  };
  // Wave-based sources carry no meaningful scattering: keep the target's own.
  if (src.speckleScatteringAssignments && Object.keys(src.speckleScatteringAssignments).length > 0) {
    updates.speckleScatteringAssignments = { ...src.speckleScatteringAssignments };
  }
  if (sel) {
    updates.speckleAcousticSelection = {
      ...sel,
      nodeIds: [...sel.nodeIds],
      nodeNames: [...sel.nodeNames],
      geometryIds: [...sel.geometryIds],
    };
  }
  // Import-IRs cards only use materials once the option is on.
  if (target.type === 'import-irs') updates.materialAssignmentsEnabled = true;
  return updates as Partial<SimulationConfig>;
}

/** One row per other card that can receive the source card's materials. */
export function buildCopyMaterialsRows({ configs, sourceIndex, onUpdate }: CopyMaterialsRowsOptions): CopyMaterialsRow[] {
  const source = configs[sourceIndex];
  const count = countMaterialAssignments(source);
  if (!source || count === 0) return [];
  return configs.flatMap((target, targetIndex) => {
    if (targetIndex === sourceIndex || !canHoldMaterials(target)) return [];
    const name = simulationCardName(target);
    return [{
      key: `copy-materials-${target.id ?? targetIndex}`,
      label: name,
      onClick: () => {
        onUpdate(targetIndex, buildMaterialCopyUpdates(source, target));
        notifyError(`Copied ${count} material assignment${count === 1 ? '' : 's'} to ${name}`, 'info');
      },
    }];
  });
}

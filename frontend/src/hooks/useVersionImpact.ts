'use client';

import { useEffect, useMemo } from 'react';
import {
  useAcousticLayerStore,
  useAcousticMaterialStore,
  useModelVersionStore,
  useReceiversStore,
  useSoundscapeStore,
  impactKey,
} from '@/store';
import type { ImpactEntry } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { buildLiveRegion, buildPlacementPoints, buildSimulationImpactRequest } from '@/utils/modelVersionImpact';
import type { ModelVersionImpactRequest } from '@/types/modelVersionImpact';
import type { SimulationConfig } from '@/types/acoustics';

const IDLE: ImpactEntry = { status: 'loading', report: null, error: null };

function useImpactEntry(request: ModelVersionImpactRequest | null): ImpactEntry | null {
  const key = request ? impactKey(request) : null;
  const entry = useModelVersionStore((s) => (key ? s.impacts[key] : undefined));
  useEffect(() => {
    if (request) useModelVersionStore.getState().ensureImpact(request);
    // `key` identifies the request; the object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!request) return null;
  return entry ?? IDLE;
}

/**
 * Impact of `from → to` on the LIVE scene: the current acoustic region and
 * materials, and the current listener / free-sound positions (placement checks).
 * Re-requested when any of them changes, so fixing an issue updates the report.
 */
export function useLiveVersionImpact(fromVersionId: string | null, toVersionId: string | null): ImpactEntry | null {
  const tolerance = useModelVersionStore((s) => s.tolerance);
  const geometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const layerNames = useAcousticLayerStore((s) => s.selectedAcousticLayerNames);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const receivers = useReceiversStore((s) => s.receivers);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);

  const request = useMemo<ModelVersionImpactRequest | null>(() => {
    if (!fromVersionId || !toVersionId || fromVersionId === toVersionId) return null;
    return {
      from_version_id: fromVersionId,
      to_version_id: toVersionId,
      tolerance,
      region: buildLiveRegion(),
      points: buildPlacementPoints(),
    };
    // The builders read these stores; listing them re-runs the memo on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromVersionId, toVersionId, tolerance, geometryIds, layerNames, isWholeModel, materialAssignments, receivers, generatedSounds, soundConfigs]);

  return useImpactEntry(request);
}

/**
 * Impact on a completed simulation card: the region it was simulated with,
 * from the version it ran on to the loaded one. `null` when the card ran on
 * the loaded version (or predates version tracking).
 */
export function useSimulationVersionImpact(config: SimulationConfig): ImpactEntry | null {
  const tolerance = useModelVersionStore((s) => s.tolerance);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const selection = config.speckleAcousticSelection;
  const assignments = (config as { speckleMaterialAssignments?: Record<string, string> }).speckleMaterialAssignments;

  const request = useMemo(
    () => buildSimulationImpactRequest(config, loadedVersionId, tolerance),
    // Only the fields the request is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.state, config.simulatedVersionId, loadedVersionId, tolerance, selection, assignments],
  );

  return useImpactEntry(request);
}

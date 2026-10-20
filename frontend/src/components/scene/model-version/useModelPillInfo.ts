'use client';

import { useUIStore, useSpeckleStore, useModelVersionStore, findModelVersion } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

const SPECKLE_PROJECT_URL = /\/projects\/([^/]+)\/models\//;

export interface ModelPillInfo {
  /** Uploaded file name of the loaded version, else the latest known one, else the Speckle name. */
  fileName: string;
  /** Speckle model name. */
  modelName: string | null;
  projectId: string | null;
  /** True when the user chose an older version (not following the latest). */
  isPinned: boolean;
}

/** Display identity of the open model for the bottom-bar pill and its menu. */
export function useModelPillInfo(): ModelPillInfo {
  const globalSpeckleData = useUIStore((s) => s.globalSpeckleData);
  const modelFileName = useSpeckleStore((s) => s.modelFileName);
  const versions = useModelVersionStore((s) => s.versions);
  const storeModelName = useModelVersionStore((s) => s.modelName);
  const pinnedVersionId = useModelVersionStore((s) => s.pinnedVersionId);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);

  const loaded = findModelVersion(versions, loadedVersionId);
  const knownFileName = loaded?.file_name ?? versions.find((v) => v.file_name)?.file_name ?? null;
  const modelName = storeModelName || globalSpeckleData?.display_name || null;

  return {
    fileName: knownFileName || modelFileName || modelName || globalSpeckleData?.model_id || 'Model',
    modelName,
    projectId: globalSpeckleData?.url?.match(SPECKLE_PROJECT_URL)?.[1] ?? null,
    isPinned: !!pinnedVersionId,
  };
}

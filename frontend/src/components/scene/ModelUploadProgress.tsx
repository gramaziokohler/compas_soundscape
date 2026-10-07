"use client";

import { useUIStore } from '@/store';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SPECKLE_INGESTION_PHASE_LABELS, SPECKLE_UPLOAD_STAGE_LABELS } from '@/utils/constants';

/**
 * Live status of an in-flight model upload for the scene loading overlay:
 * stage label, Speckle's own progress message and — while Speckle is
 * processing — a percentage bar fed by the ingestion status polls.
 */
export function ModelUploadProgress() {
  const upload = useUIStore((s) => s.globalModelUploadProgress);

  // No upload in flight (e.g. selecting an existing Speckle model) → plain loading.
  const stage = upload?.stage ?? 'loading';
  const phaseLabel =
    stage === 'processing' && upload?.phase ? SPECKLE_INGESTION_PHASE_LABELS[upload.phase] : undefined;
  const title = phaseLabel ? `${phaseLabel}…` : SPECKLE_UPLOAD_STAGE_LABELS[stage];
  const retry = upload?.attempt && upload.attempt >= 2 ? ` (retry ${upload.attempt - 1})` : '';
  const progress = upload?.progress ?? null;

  return (
    <div className="flex w-64 flex-col items-center gap-2 text-center">
      <p className="text-xs text-primary">
        {title}
        {retry}
        {progress !== null && <span className="ml-1 tabular-nums">{Math.round(progress * 100)}%</span>}
      </p>
      {progress !== null && <ProgressBar value={progress} label={title} />}
      {upload?.message && upload.message !== title && (
        <p className="text-xxs text-secondary-hover">{upload.message}</p>
      )}
    </div>
  );
}

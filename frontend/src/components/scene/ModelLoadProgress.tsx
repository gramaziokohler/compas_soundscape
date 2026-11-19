"use client";

import { useEffect, useState } from 'react';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { MODEL_LOAD_PHASE_LABELS, MODEL_LOAD_PROGRESS } from '@/utils/constants';
import type { ModelLoadProgress as ModelLoadProgressData } from '@/types';

interface ModelLoadProgressProps {
  /** Current phase + weighted overall value, from `useSpeckleViewerInit`. */
  progress: ModelLoadProgressData;
}

const formatCount = (n: number) => n.toLocaleString();

/** Seconds since mount, shown once a load passes ELAPSED_SHOW_AFTER_MS. */
function useElapsedSeconds(): number {
  const [startedAt] = useState(() => Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), MODEL_LOAD_PROGRESS.ELAPSED_TICK_MS);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return elapsedMs >= MODEL_LOAD_PROGRESS.ELAPSED_SHOW_AFTER_MS ? Math.floor(elapsedMs / 1000) : 0;
}

/**
 * Phased progress for opening an existing model on the scene loading overlay:
 * phase label, weighted overall %, item counts for the current phase and an
 * elapsed timer for slow loads. Upload progress is `ModelUploadProgress`.
 *
 * @example
 *   <ModelLoadProgress progress={{ phase: 'downloading', overall: 0.42, done: 840, total: 2000 }} />
 */
export function ModelLoadProgress({ progress }: ModelLoadProgressProps) {
  const elapsed = useElapsedSeconds();
  const { phase, overall, done, total, partIndex, partCount, attempt } = progress;
  const title = MODEL_LOAD_PHASE_LABELS[phase];
  const retry = attempt && attempt >= 2 ? ` (retry ${attempt - 1})` : '';

  const details: string[] = [];
  if (done !== undefined) {
    const unit = phase === 'downloading' ? 'objects' : 'elements';
    details.push(total !== undefined ? `${formatCount(done)} / ${formatCount(total)} ${unit}` : `${formatCount(done)} ${unit}`);
  }
  if (partCount && partCount > 1 && partIndex !== undefined) details.push(`part ${partIndex + 1} of ${partCount}`);
  if (elapsed > 0) details.push(`${elapsed} s`);

  return (
    <div className="flex w-64 flex-col items-center gap-2 text-center">
      <p className="text-xs text-primary">
        {title}
        {retry}
        <span className="ml-1 tabular-nums">{Math.round(overall * 100)}%</span>
      </p>
      <ProgressBar value={overall} label={title} />
      {details.length > 0 && (
        <p className="text-xxs tabular-nums text-secondary-hover">{details.join(' · ')}</p>
      )}
    </div>
  );
}

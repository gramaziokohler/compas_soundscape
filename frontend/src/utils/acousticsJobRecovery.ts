import type { JobRecord } from '@/types';

/**
 * Split recovered job records so each simulation card gets at most one
 * pyroom/choras job: the newest (by `timestamp`) per `meta.configId`.
 *
 * The backend lists finished jobs for an hour, so a card re-run within that
 * hour has two completed jobs. Recovering both re-imports the older run's IRs
 * over the newer result on every reload. Records without a `configId` and
 * non-acoustics records are always kept.
 *
 * Usage:
 * ```ts
 * const { keep, superseded } = latestAcousticsJobPerCard(records);
 * superseded.forEach((r) => removeInflightJob(r.jobId));
 * ```
 */
export function latestAcousticsJobPerCard(records: JobRecord[]): {
  keep: JobRecord[];
  superseded: JobRecord[];
} {
  const newest = new Map<string, JobRecord>();
  for (const r of records) {
    const configId = acousticsConfigId(r);
    if (!configId) continue;
    const current = newest.get(configId);
    if (!current || r.timestamp > current.timestamp) newest.set(configId, r);
  }

  const keep: JobRecord[] = [];
  const superseded: JobRecord[] = [];
  for (const r of records) {
    const configId = acousticsConfigId(r);
    if (configId && newest.get(configId) !== r) superseded.push(r);
    else keep.push(r);
  }
  return { keep, superseded };
}

function acousticsConfigId(record: JobRecord): string | undefined {
  if (record.jobType !== 'pyroom' && record.jobType !== 'choras') return undefined;
  return record.meta?.configId;
}

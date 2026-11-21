import type { FinishedSimulation, JobRecord } from '@/types';

/**
 * Split recovered job records so each simulation card gets at most one
 * pyroom/pffdtd job: the newest (by `timestamp`) per `meta.configId`.
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
  if (record.jobType !== 'pyroom' && record.jobType !== 'pffdtd') return undefined;
  return record.meta?.configId;
}

/** Run state of a simulation card, as recovery reads it. */
export interface CardRunState {
  id?: string;
  isRunning?: boolean;
  currentSimulationRunId?: string | null;
  currentSimulationId?: string | null;
  completedAt?: number | null;
}

/**
 * Whether a finished simulation record (GET /api/finished-simulations) should be
 * applied to its card: the card waits on exactly this run, or it holds neither
 * this result nor a newer one and no other run owns it.
 */
export function shouldApplyFinished(card: CardRunState, rec: FinishedSimulation, simulationId: string): boolean {
  if (card.currentSimulationRunId === rec.jobId) return true;
  if (card.currentSimulationId === simulationId) return false;
  if (card.currentSimulationRunId || card.isRunning) return false;
  return rec.completedMs > (card.completedAt ?? 0);
}

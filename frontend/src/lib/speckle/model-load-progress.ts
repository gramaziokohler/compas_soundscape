/**
 * Phased progress for opening an existing Speckle model.
 *
 * `computeModelLoadOverall` maps a phase + in-phase fraction onto one monotonic
 * 0–1 bar (MODEL_LOAD_PROGRESS weights). `trackSpeckleLoader` turns a
 * SpeckleLoader's events into throttled `ModelLoadProgress` updates.
 */
import { LoaderEvent, type SpeckleLoader } from '@speckle/viewer';
import { MODEL_LOAD_PROGRESS } from '@/utils/constants';
import type { ModelLoadPhase, ModelLoadProgress } from '@/types';

type FixedPhase = keyof typeof MODEL_LOAD_PROGRESS.FIXED_PHASE_RANGES;
type LoaderPhase = keyof typeof MODEL_LOAD_PROGRESS.LOADER_PHASE_WEIGHTS;

const LOADER_PHASE_ORDER: readonly LoaderPhase[] = ['downloading', 'converting', 'building'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function isFixedPhase(phase: ModelLoadPhase): phase is FixedPhase {
  return phase in MODEL_LOAD_PROGRESS.FIXED_PHASE_RANGES;
}

/**
 * Overall bar value for `phase` at `fraction` (0–1) of that phase. Loader phases
 * are placed inside resource part `partIndex` of `partCount`, so a multi-URL
 * model never moves the bar backwards between parts.
 */
export function computeModelLoadOverall(
  phase: ModelLoadPhase,
  fraction: number,
  partIndex = 0,
  partCount = 1,
): number {
  const f = clamp01(fraction);
  if (isFixedPhase(phase)) {
    const [start, end] = MODEL_LOAD_PROGRESS.FIXED_PHASE_RANGES[phase];
    return start + (end - start) * f;
  }
  const [spanStart, spanEnd] = MODEL_LOAD_PROGRESS.LOADER_SPAN;
  const count = Math.max(1, partCount);
  const partSize = (spanEnd - spanStart) / count;
  const weights = MODEL_LOAD_PROGRESS.LOADER_PHASE_WEIGHTS;
  let before = 0;
  for (const p of LOADER_PHASE_ORDER) {
    if (p === phase) break;
    before += weights[p];
  }
  const inPart = before + weights[phase] * f;
  return spanStart + partSize * (Math.min(partIndex, count - 1) + inPart);
}

/** Progress for a phase without item counts (fixed phases, `building`). */
export function phaseProgress(
  phase: ModelLoadPhase,
  fraction = 0,
  extra: Partial<ModelLoadProgress> = {},
): ModelLoadProgress {
  return {
    phase,
    overall: computeModelLoadOverall(phase, fraction, extra.partIndex, extra.partCount),
    ...extra,
  };
}

/**
 * Subscribe to one SpeckleLoader's events and report throttled progress for
 * resource part `partIndex` of `partCount`. Call before `viewer.loadObject`.
 *
 * - `LoadProgress` → downloading (exact: objects downloaded / total)
 * - `Traversed` / `Converted` → converting (converted / traversed nodes, capped)
 * - `load()` resolving → building (`viewer.loadObject` then builds GPU batches;
 *   the viewer emits nothing in between, so `load` is wrapped on this instance)
 */
export function trackSpeckleLoader(
  loader: SpeckleLoader,
  partIndex: number,
  partCount: number,
  onProgress: (progress: ModelLoadProgress) => void,
): void {
  const part = { partIndex, partCount };
  let lastPhase: ModelLoadPhase | null = null;
  let lastOverall = -1;
  let traversed = 0;
  let totalObjects: number | null = null;

  const report = (next: ModelLoadProgress, force = false) => {
    const moved = next.overall - lastOverall >= MODEL_LOAD_PROGRESS.MIN_UPDATE_STEP;
    if (!force && next.phase === lastPhase && !moved) return;
    lastPhase = next.phase;
    lastOverall = Math.max(lastOverall, next.overall);
    onProgress({ ...next, overall: lastOverall });
  };

  loader.on(LoaderEvent.LoadProgress, ({ progress }) => {
    // SpeckleLoader emits i / (total + 1) per downloaded object and keeps `total`
    // private. The first event (i = 1) is 1 / (total + 1), which gives the total.
    if (totalObjects === null && progress > 0) totalObjects = Math.max(1, Math.round(1 / progress) - 1);
    const total = totalObjects;
    report({
      ...part,
      phase: 'downloading',
      overall: computeModelLoadOverall('downloading', progress, partIndex, partCount),
      done: total !== null ? Math.min(total, Math.round(progress * (total + 1))) : undefined,
      total: total ?? undefined,
    });
  });

  loader.on(LoaderEvent.Traversed, ({ count }) => {
    traversed = Math.max(traversed, count);
  });

  loader.on(LoaderEvent.Converted, ({ count }) => {
    const fraction = traversed > 0
      ? Math.min(count / traversed, MODEL_LOAD_PROGRESS.CONVERT_MAX_FRACTION)
      : 0;
    report({
      ...part,
      phase: 'converting',
      overall: computeModelLoadOverall('converting', fraction, partIndex, partCount),
      done: count,
      total: traversed > 0 ? Math.max(traversed, count) : undefined,
    });
  });

  const load = loader.load.bind(loader);
  loader.load = async () => {
    const ok = await load();
    if (ok) report(phaseProgress('building', 0, part), true);
    return ok;
  };
}

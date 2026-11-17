/**
 * Per-octave-band room-acoustic metrics (125 Hz - 8 kHz), for every engine.
 *
 * The backend measures each IR once with the compas_acoustics Analyser and stores, per
 * source-listener pair (results JSON) and per IR (metadata), `acoustic_parameters_bands`. The
 * card's single numbers are the ISO mean of this table's 500 Hz and 1 kHz columns.
 * `aggregateBandMetrics` averages the pairs band by band, skipping values a pair could not measure
 * and pairs whose IR is tagged low energy, and flags the bands whose decay is too short to trust.
 * `withBandHeadline` reads the single numbers back off that table, so the metrics table's collapsed
 * row always agrees with its expanded band rows.
 */

import type { IRAcousticParameters, IRBandMetrics, IRMetricBlocks, SourceReceiverIRMapping } from '@/types/audio';
import type { AcousticParameters } from '@/utils/acousticMetrics';
import { isLowEnergyIR } from '@/utils/irEnergy';

export const BAND_METRIC_FREQUENCIES = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

export type BandMetricKey = 'T30' | 'EDT' | 'C50' | 'C80' | 'D50' | 'STI';

export const BAND_METRIC_KEYS: readonly BandMetricKey[] = ['T30', 'EDT', 'C50', 'C80', 'D50', 'STI'];

export interface BandMetrics {
  frequencies: number[];
  /** Mean over the pairs, per band; null where no pair has a value. */
  values: Record<BandMetricKey, Array<number | null>>;
  /** Bands where at least one pair's decay is too short for T30 (when the backend reports it). */
  unreliableT30: boolean[];
  pairs: number;
}

/** A run's results-JSON entry as far as the metrics read it. */
export interface RunPairResult {
  source_id?: string;
  receiver_id?: string;
  acoustic_parameters?: IRAcousticParameters | null;
  acoustic_parameters_bands?: IRBandMetrics | null;
}

function reliabilityFlags(block: IRBandMetrics, n: number): boolean[] | null {
  const flags = block.reliability?.T30_reliable;
  return Array.isArray(flags) && flags.length === n ? flags.map((f) => f !== false) : null;
}

/** Band-wise mean of metric blocks; null when none carries a value. */
export function averageBandMetrics(blocks: IRBandMetrics[]): BandMetrics | null {
  if (blocks.length === 0) return null;
  const frequencies = [...(blocks[0].frequency_bands ?? blocks[0].reliability?.freqs ?? BAND_METRIC_FREQUENCIES)];
  const n = frequencies.length;
  const values = {} as Record<BandMetricKey, Array<number | null>>;
  for (const key of BAND_METRIC_KEYS) {
    values[key] = Array.from({ length: n }, (_, band) => {
      let sum = 0;
      let count = 0;
      for (const block of blocks) {
        const v = block[key]?.[band];
        if (typeof v === 'number' && Number.isFinite(v)) {
          sum += v;
          count++;
        }
      }
      return count ? sum / count : null;
    });
  }
  const unreliableT30 = Array.from({ length: n }, (_, band) =>
    blocks.some((block) => reliabilityFlags(block, n)?.[band] === false));
  if (BAND_METRIC_KEYS.every((key) => values[key].every((v) => v === null))) return null;
  return { frequencies, values, unreliableT30, pairs: blocks.length };
}

/**
 * Band-wise mean of a results JSON's pairs; pairs whose IR in `mapping` is tagged low energy are
 * left out, as in the card's single numbers. Null when no pair carries band metrics.
 */
export function aggregateBandMetrics(
  results: RunPairResult[] | undefined,
  mapping?: SourceReceiverIRMapping,
): BandMetrics | null {
  const blocks = (results ?? [])
    .filter((r) => !(r.source_id && r.receiver_id && isLowEnergyIR(mapping?.[r.source_id]?.[r.receiver_id])))
    .map((r) => r.acoustic_parameters_bands)
    .filter((b): b is IRBandMetrics => !!b);
  return averageBandMetrics(blocks);
}

/**
 * Band-wise mean of the IRs a card plays: each mapped pair uses its IR's own band metrics (a
 * free-positioning or imported IR carries them) and falls back to the run's result for that pair.
 * Low-energy IRs are left out. Without a mapping, the run's results are averaged.
 */
export function aggregateMappedBandMetrics(
  mapping: SourceReceiverIRMapping | undefined,
  results: RunPairResult[] | undefined,
): BandMetrics | null {
  const pairs = Object.entries(mapping ?? {});
  if (pairs.length === 0) return aggregateBandMetrics(results);
  const byPair = metricBlocksByPair(results);
  const blocks: IRBandMetrics[] = [];
  for (const [sourceId, receivers] of pairs) {
    for (const [receiverId, meta] of Object.entries(receivers)) {
      if (isLowEnergyIR(meta)) continue;
      const block = meta.acoustic_parameters_bands ?? byPair[`${sourceId}::${receiverId}`]?.acoustic_parameters_bands;
      if (block) blocks.push(block);
    }
  }
  return averageBandMetrics(blocks);
}

/** A run's metric blocks per pair, keyed `${source_id}::${receiver_id}` (as `pairMetricsKey`). */
export function metricBlocksByPair(results: RunPairResult[] | null | undefined): Record<string, IRMetricBlocks> {
  const out: Record<string, IRMetricBlocks> = {};
  for (const r of results ?? []) {
    if (r.source_id == null || r.receiver_id == null) continue;
    if (!r.acoustic_parameters && !r.acoustic_parameters_bands) continue;
    out[`${r.source_id}::${r.receiver_id}`] = {
      acoustic_parameters: r.acoustic_parameters ?? null,
      acoustic_parameters_bands: r.acoustic_parameters_bands ?? null,
    };
  }
  return out;
}

/** The table of one IR (its own metrics, no averaging); null without band metrics. */
export function bandMetricsOfIR(block: IRBandMetrics | null | undefined): BandMetrics | null {
  return block ? averageBandMetrics([block]) : null;
}

/** The single numbers that are the mean of the 500 Hz and 1 kHz bands (ISO 3382-1), D50 0-1 vs %. */
const HEADLINE_FROM_BANDS: Array<{ key: 't30' | 'edt' | 'c50' | 'c80' | 'd50'; band: BandMetricKey; scale: number }> = [
  { key: 't30', band: 'T30', scale: 1 },
  { key: 'edt', band: 'EDT', scale: 1 },
  { key: 'c50', band: 'C50', scale: 1 },
  { key: 'c80', band: 'C80', scale: 1 },
  { key: 'd50', band: 'D50', scale: 0.01 },
];

/**
 * `params` with T30, EDT, C50, C80 and D50 read off `bands`: the mean of its 500 Hz and 1 kHz
 * columns, as the Analyser's `*_overall` is per IR. Over several pairs this is the band-wise mean
 * the table shows, so the single numbers and the band rows cannot disagree. A metric missing either
 * column keeps its measured value (null for a band-limited IR). STI is IEC-weighted over all bands,
 * not a mean of its band values, so it is kept as measured.
 */
export function withBandHeadline(
  params: AcousticParameters | null,
  bands: BandMetrics | null | undefined,
): AcousticParameters | null {
  if (!bands) return params;
  const lo = bands.frequencies.indexOf(500);
  const hi = bands.frequencies.indexOf(1000);
  if (lo < 0 || hi < 0) return params;
  const out: AcousticParameters = params
    ? { ...params }
    : { t30: null, edt: null, c50: null, c80: null, d50: null, sti: null };
  for (const { key, band, scale } of HEADLINE_FROM_BANDS) {
    const a = bands.values[band][lo];
    const b = bands.values[band][hi];
    if (a !== null && b !== null) out[key] = ((a + b) / 2) * scale;
  }
  return out;
}

export function formatBandFrequency(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

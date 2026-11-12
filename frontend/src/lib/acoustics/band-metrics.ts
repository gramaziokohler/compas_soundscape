/**
 * Per-octave-band room-acoustic metrics of a simulation (compas_acoustics engine).
 *
 * The results JSON carries, per source-listener pair, `acoustic_parameters_bands`: the
 * compas_acoustics Analyser output at 125 Hz - 8 kHz plus how far each band's decay supports the
 * decay times. `aggregateBandMetrics` averages the pairs band by band, skipping values a pair
 * could not measure, and flags the bands whose decay is too short to trust.
 */

export const BAND_METRIC_FREQUENCIES = [125, 250, 500, 1000, 2000, 4000, 8000] as const;

export type BandMetricKey = 'T30' | 'EDT' | 'C50' | 'C80' | 'D50' | 'STI';

export const BAND_METRIC_ROWS: Array<{ key: BandMetricKey; label: string; unit: string; digits: number; title: string }> = [
  { key: 'T30', label: 'T30', unit: 's', digits: 2, title: 'Reverberation time from the −5 to −35 dB decay' },
  { key: 'EDT', label: 'EDT', unit: 's', digits: 2, title: 'Early decay time (first 10 dB)' },
  { key: 'C50', label: 'C50', unit: 'dB', digits: 1, title: 'Clarity for speech: early (50 ms) to late energy' },
  { key: 'C80', label: 'C80', unit: 'dB', digits: 1, title: 'Clarity for music: early (80 ms) to late energy' },
  { key: 'D50', label: 'D50', unit: '%', digits: 0, title: 'Definition: share of the energy in the first 50 ms' },
  { key: 'STI', label: 'STI', unit: '', digits: 2, title: 'Speech transmission index (modulation transfer per band)' },
];

/** One pair's block as written by the backend (lists per band; nulls where not measurable). */
export interface PairBandMetrics {
  frequency_bands?: number[];
  T30?: Array<number | null>;
  EDT?: Array<number | null>;
  C50?: Array<number | null>;
  C80?: Array<number | null>;
  D50?: Array<number | null>;
  STI?: Array<number | null>;
  reliability?: { freqs?: number[]; T30_reliable?: boolean[] } & Record<string, unknown>;
}

export interface BandMetrics {
  frequencies: number[];
  /** Mean over the pairs, per band; null where no pair has a value. */
  values: Record<BandMetricKey, Array<number | null>>;
  /** Bands where at least one pair's decay is too short for T30 (when the backend reports it). */
  unreliableT30: boolean[];
  pairs: number;
}

function reliabilityFlags(block: PairBandMetrics, n: number): boolean[] | null {
  const r = block.reliability;
  if (!r) return null;
  const flags = r.T30_reliable as unknown;
  return Array.isArray(flags) && flags.length === n ? flags.map((f) => f !== false) : null;
}

/** Band-wise mean of the pairs' metrics; null when no pair carries band metrics. */
export function aggregateBandMetrics(results: Array<{ acoustic_parameters_bands?: PairBandMetrics | null }> | undefined): BandMetrics | null {
  const blocks = (results ?? []).map((r) => r.acoustic_parameters_bands).filter((b): b is PairBandMetrics => !!b);
  if (blocks.length === 0) return null;
  const frequencies = [...(blocks[0].frequency_bands ?? blocks[0].reliability?.freqs ?? BAND_METRIC_FREQUENCIES)];
  const n = frequencies.length;
  const values = {} as Record<BandMetricKey, Array<number | null>>;
  for (const { key } of BAND_METRIC_ROWS) {
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
  if (BAND_METRIC_ROWS.every(({ key }) => values[key].every((v) => v === null))) return null;
  return { frequencies, values, unreliableT30, pairs: blocks.length };
}

export function formatBandFrequency(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

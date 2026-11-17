/**
 * AcousticMetricsTable — the acoustic metrics of a simulation card (averaged over its pairs) or of
 * one IR (the IR preview panel), as one expandable table: a row of single numbers (T30, EDT, C50,
 * C80, D50 = mean of the 500 Hz and 1 kHz bands; STI over all bands) that the chevron next to the
 * title expands into one row per octave band (125 Hz - 8 kHz) under it, column by column.
 *
 * A doubtful value is marked with `*` (single number: estimate / unreliable decay; band: T30 decay
 * too short); a missing value shows "–". The table is transparent, so it takes the background of
 * what it sits on: the blue card or the IR preview (`tone`).
 *
 * Usage: `<AcousticMetricsTable params={withBandHeadline(params, bands)} bands={bands} tone="surface" />`
 */

'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatBandFrequency, type BandMetricKey, type BandMetrics } from '@/lib/acoustics/band-metrics';
import type { AcousticParameterKey, AcousticParameters } from '@/utils/acousticMetrics';

export interface AcousticMetricMeta {
  key: AcousticParameterKey;
  /** Its row in the band table. */
  band: BandMetricKey;
  label: string;
  unit: string;
  digits: number;
  title: string;
  /** How the single number is formed from the bands. */
  overall: string;
}

const ISO_MEAN = 'mean of 500 Hz and 1 kHz';

export const ACOUSTIC_METRICS: AcousticMetricMeta[] = [
  { key: 't30', band: 'T30', label: 'T30', unit: 's', digits: 2, title: 'Reverberation time (−5 to −35 dB decay)', overall: ISO_MEAN },
  { key: 'edt', band: 'EDT', label: 'EDT', unit: 's', digits: 2, title: 'Early decay time (first 10 dB)', overall: ISO_MEAN },
  { key: 'c50', band: 'C50', label: 'C50', unit: 'dB', digits: 1, title: 'Clarity for speech: early (50 ms) to late energy', overall: ISO_MEAN },
  { key: 'c80', band: 'C80', label: 'C80', unit: 'dB', digits: 1, title: 'Clarity for music: early (80 ms) to late energy', overall: ISO_MEAN },
  { key: 'd50', band: 'D50', label: 'D50', unit: '%', digits: 0, title: 'Definition: share of the energy in the first 50 ms', overall: ISO_MEAN },
  { key: 'sti', band: 'STI', label: 'STI', unit: '', digits: 2, title: 'Speech transmission index', overall: 'weighted over all bands' },
];

export function acousticMetricMeta(key: string | null | undefined): AcousticMetricMeta | null {
  return ACOUSTIC_METRICS.find((m) => m.key === key) ?? null;
}

/** A single number in its unit (D50 is stored 0-1 and shown in %). */
export function formatAcousticMetric(meta: AcousticMetricMeta, value: number): string {
  return `${(meta.key === 'd50' ? value * 100 : value).toFixed(meta.digits)}${meta.unit}`;
}

function metricWarning(params: AcousticParameters, key: AcousticParameterKey): string | undefined {
  const warnings: string[] = [];
  if (key === 't30' && params.t30 !== null && params.t30IsEstimate) {
    warnings.push('T30 is an estimate: ISM-only simulation, no ray-traced diffuse tail');
  }
  if (key === 't30' && params.t30 !== null && params.t30Reliable === false) {
    warnings.push('T30 is unreliable: the decay is too short or bent at 500 Hz – 1 kHz');
  }
  if (key === 'edt' && params.edt !== null && params.edtReliable === false) {
    warnings.push('EDT is unreliable: the decay is too short at 500 Hz – 1 kHz');
  }
  return warnings.length > 0 ? warnings.join(' · ') : undefined;
}

export type AcousticMetricsTableTone = 'blue' | 'surface';

/** Text and hairline tokens for the blue sidebar card and the neutral panel surface. */
const TONES: Record<AcousticMetricsTableTone, { muted: string; text: string; border: string }> = {
  blue: { muted: 'var(--color-on-blue-muted)', text: 'var(--color-on-blue)', border: 'var(--color-on-blue-faint)' },
  surface: { muted: 'var(--color-secondary-hover)', text: 'var(--color-foreground)', border: 'var(--color-border-strong)' },
};

/** Width of the band-label column that the expanded table adds (CSS px). */
const LABEL_COLUMN_WIDTH = 30;

export interface AcousticMetricsTableProps {
  /** The single numbers; null when none was measured. */
  params: AcousticParameters | null;
  /** The per-band table; undefined while loading and null without one (no expand button either way). */
  bands?: BandMetrics | null;
  /** Colour scheme of the background the table sits on. */
  tone?: AcousticMetricsTableTone;
  /** Controlled expansion; local state (collapsed at first) when omitted. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Says under the band rows how many source-listener pairs they average. */
  showPairCount?: boolean;
}

export function AcousticMetricsTable({
  params,
  bands,
  tone = 'blue',
  expanded: controlledExpanded,
  onExpandedChange,
  showPairCount = false,
}: AcousticMetricsTableProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const { muted, text, border } = TONES[tone];

  const hasBandValue = (band: BandMetricKey) => !!bands && bands.values[band].some((v) => v !== null);
  // A metric keeps its column when only its bands were measured, so expanding never adds columns.
  const columns = ACOUSTIC_METRICS.filter((m) => params?.[m.key] != null || hasBandValue(m.band));
  if (columns.length === 0) return null;

  const expanded = !!bands && (controlledExpanded ?? localExpanded);
  const bandRows = expanded && bands ? bands : null;
  const toggle = () => {
    setLocalExpanded(!expanded);
    onExpandedChange?.(!expanded);
  };

  const cell = 'border px-1 text-center';
  const rowLabel = `${cell} text-[9px] font-normal whitespace-nowrap`;
  const unreliableT30 = !!bands && bands.unreliableT30.some(Boolean);
  const footnote = [
    showPairCount && bands ? `Mean of ${bands.pairs} source–listener pair${bands.pairs === 1 ? '' : 's'}` : null,
    unreliableT30 ? '* decay too short for a reliable T30' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-1">
        <h3 className="text-xs font-semibold" style={{ color: text }}>
          Acoustic Metrics
        </h3>
        {bands && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            title={expanded ? 'Hide the per-band values' : 'Show the per-band values (125 Hz – 8 kHz)'}
            className="flex shrink-0 cursor-pointer items-center justify-center rounded opacity-70 transition-opacity hover:opacity-100"
            style={{ color: text }}
          >
            <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      <table className="w-full border-collapse table-fixed tabular-nums">
        {expanded && (
          <colgroup>
            <col style={{ width: LABEL_COLUMN_WIDTH }} />
            {columns.map((col) => <col key={col.key} />)}
          </colgroup>
        )}
        <thead>
          <tr>
            {expanded && (
              <th className={`${rowLabel} py-0.5`} style={{ borderColor: border, color: muted }}>Hz</th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`${cell} py-0.5 text-[9px] font-medium`}
                style={{ borderColor: border, color: muted }}
                title={col.title}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {expanded && (
              <th
                scope="row"
                className={`${rowLabel} py-1`}
                style={{ borderColor: border, color: muted }}
                title="Single numbers (ISO 3382-1)"
              >
                Avg
              </th>
            )}
            {columns.map((col) => {
              const value = params?.[col.key];
              const warning = params ? metricWarning(params, col.key) : undefined;
              return (
                <td
                  key={col.key}
                  className={`${cell} py-1 text-[10px] font-semibold ${warning ? 'text-warning' : ''}`}
                  style={warning ? { borderColor: border } : { borderColor: border, color: text }}
                  title={warning ?? `${col.title}, ${col.overall}`}
                >
                  {value == null ? '–' : formatAcousticMetric(col, value)}
                  {warning ? '*' : ''}
                </td>
              );
            })}
          </tr>
          {bandRows?.frequencies.map((hz, band) => (
            <tr key={hz}>
              <th scope="row" className={`${rowLabel} py-0.5`} style={{ borderColor: border, color: muted }}>
                {formatBandFrequency(hz)}
              </th>
              {columns.map((col) => {
                const value = bandRows.values[col.band][band];
                const doubtful = col.band === 'T30' && bandRows.unreliableT30[band];
                return (
                  <td
                    key={col.key}
                    className={`${cell} py-0.5 text-[10px]`}
                    style={{ borderColor: border, color: doubtful ? muted : text }}
                    title={doubtful ? 'The decay is too short or too bent in this band for a reliable T30' : undefined}
                  >
                    {value == null ? '–' : `${value.toFixed(col.digits)}${doubtful ? '*' : ''}`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {expanded && footnote && (
        <p className="text-[10px]" style={{ color: muted }}>{footnote}</p>
      )}
    </div>
  );
}

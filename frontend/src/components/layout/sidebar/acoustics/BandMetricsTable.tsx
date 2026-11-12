/**
 * BandMetricsTable — per-octave-band metrics of a ray-tracing result (compas_acoustics engine):
 * T30, EDT, C50, C80, D50 and STI at 125 Hz - 8 kHz, averaged over the source-listener pairs.
 *
 * Collapsed by default under the broadband metrics; fetched from the results JSON on first open.
 * Renders nothing for results without band metrics (legacy engine, older runs, the share view's
 * pruned results). A T30 whose decay is too short to trust is marked.
 */

'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { simulationResultsJsonUrl } from '@/services/api';
import {
  BAND_METRIC_ROWS,
  aggregateBandMetrics,
  formatBandFrequency,
  type BandMetrics,
} from '@/lib/acoustics/band-metrics';

export function BandMetricsTable({ simulationId }: { simulationId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [metrics, setMetrics] = useState<BandMetrics | null | undefined>(undefined);

  // A new result invalidates what was fetched for the previous one.
  useEffect(() => { setMetrics(undefined); }, [simulationId]);

  useEffect(() => {
    if (!expanded || metrics !== undefined) return;
    let cancelled = false;
    fetch(simulationResultsJsonUrl(simulationId, 'pyroomacoustics'))
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => { if (!cancelled) setMetrics(aggregateBandMetrics(json?.results)); })
      .catch(() => { if (!cancelled) setMetrics(null); });
    return () => { cancelled = true; };
  }, [expanded, metrics, simulationId]);

  // Known to have none: say nothing rather than show an empty disclosure.
  if (metrics === null) return null;

  const muted = { color: 'var(--color-on-blue-muted)' };
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left text-[11px]"
        style={muted}
      >
        {expanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        <span>Per-band metrics</span>
      </button>
      {expanded && metrics && (
        <div className="card-collapse-body overflow-x-auto">
          <table className="w-full border-collapse text-[10px] tabular-nums">
            <thead>
              <tr style={muted}>
                <th className="pr-1 text-left font-normal">Hz</th>
                {metrics.frequencies.map((f) => (
                  <th key={f} className="px-0.5 text-right font-normal">{formatBandFrequency(f)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BAND_METRIC_ROWS.map(({ key, label, unit, digits, title }) => (
                <tr key={key} title={title}>
                  <td className="pr-1 text-left" style={muted}>{label}{unit && ` (${unit})`}</td>
                  {metrics.values[key].map((value, band) => {
                    const doubtful = key === 'T30' && metrics.unreliableT30[band];
                    return (
                      <td
                        key={band}
                        className="px-0.5 text-right"
                        style={doubtful ? muted : undefined}
                        title={doubtful ? 'The decay is too short or too bent in this band for a reliable T30' : undefined}
                      >
                        {value === null ? '–' : `${value.toFixed(digits)}${doubtful ? '*' : ''}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px]" style={muted}>
            Mean of {metrics.pairs} source–listener pair{metrics.pairs === 1 ? '' : 's'}
            {metrics.unreliableT30.some(Boolean) ? ' · * decay too short for a reliable T30' : ''}
          </p>
        </div>
      )}
    </div>
  );
}

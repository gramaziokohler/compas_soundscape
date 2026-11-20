'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { MeterBar } from '@/components/ui/MeterBar';
import { Sparkline } from '@/components/ui/Sparkline';
import { PERFORMANCE_METER, SCENE_BOTTOM_BAR } from '@/utils/constants';
import { PERFORMANCE_METRICS } from '@/lib/diagnostics/performance-levels';
import type { PerformanceMeterState } from '@/hooks/usePerformanceMeter';
import { detailRows, metricTitle, metricValueText } from './performance-format';

export interface PerformanceMeterPanelProps {
  state: PerformanceMeterState;
  onHideMeter: () => void;
  onResetPeaks: () => void;
}

/**
 * Expanded performance meter, opened above the bottom-bar strip: one row per
 * metric (bar + peak tick + 60 s sparkline + value) and a "Details" disclosure.
 */
export function PerformanceMeterPanel({ state, onHideMeter, onResetPeaks }: PerformanceMeterPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const { sample, display, peaks, history, levels, headroom } = state;

  return (
    <div
      className="bar-popover perf-meter-panel"
      role="dialog"
      aria-label={PERFORMANCE_METER.BUTTON_TITLE}
      style={{
        right: 0,
        position: 'absolute',
        bottom: `calc(100% + ${SCENE_BOTTOM_BAR.POPOVER_OFFSET}px)`,
        width: PERFORMANCE_METER.PANEL_WIDTH,
      }}
    >
      <div className="perf-meter-panel__header">
        <span className="bar-popover__title">{PERFORMANCE_METER.BUTTON_TITLE}</span>
        <span className={`perf-meter-panel__headroom perf-level--${headroom}`}>
          <span className={`perf-meter-dot perf-level--${headroom}`} />
          {PERFORMANCE_METER.HEADROOM_WORDS[headroom]}
        </span>
        <button type="button" className="perf-meter-panel__close" title={PERFORMANCE_METER.HIDE_TITLE} onClick={onHideMeter}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>

      <button type="button" className="perf-meter-panel__rows" onClick={onResetPeaks} title="Click to reset peaks">
        {PERFORMANCE_METRICS.map((id) => (
          <span key={id} className="perf-meter-row" title={metricTitle(id, sample)}>
            <span className="perf-meter-row__label">{PERFORMANCE_METER.LABELS[id]}</span>
            <MeterBar value={display[id]} peak={peaks[id]} level={levels[id]} width={PERFORMANCE_METER.STRIP_BAR_WIDTH * 2} />
            <Sparkline
              values={history[id]}
              length={PERFORMANCE_METER.HISTORY_LENGTH}
              width={PERFORMANCE_METER.SPARK_WIDTH}
              height={PERFORMANCE_METER.SPARK_HEIGHT}
              level={levels[id]}
            />
            <span className="perf-meter-row__value">{metricValueText(id, sample)}</span>
          </span>
        ))}
      </button>

      <button
        type="button"
        className="perf-meter-panel__details-toggle"
        aria-expanded={showDetails}
        onClick={() => setShowDetails((v) => !v)}
      >
        {showDetails ? '▾' : '▸'} Details
      </button>
      {showDetails && (
        <dl className="perf-meter-panel__details">
          {detailRows(sample).map(([label, value]) => (
            <div key={label} className="perf-meter-detail">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

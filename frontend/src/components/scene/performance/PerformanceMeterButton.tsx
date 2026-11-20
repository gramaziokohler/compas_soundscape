'use client';

import { Gauge } from 'lucide-react';
import { BarButton } from '@/components/ui/BarButton';
import { MeterBar } from '@/components/ui/MeterBar';
import { useUIStore } from '@/store';
import { useCanEdit } from '@/hooks/useCanEdit';
import { usePerformanceMeter } from '@/hooks/usePerformanceMeter';
import { useViewportScale } from '@/hooks/useViewportScale';
import { PERFORMANCE_METER, SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { PerformanceMetricId } from '@/types';
import { PerformanceMeterPanel } from './PerformanceMeterPanel';
import { metricTitle } from './performance-format';

/** Metrics shown as micro-bars in the collapsed strip (XRUN lives in the panel). */
const STRIP_METRICS: readonly PerformanceMetricId[] = ['mem', 'cpu', 'dsp', 'gpu'];

/**
 * Bottom-bar performance meter (edit mode only — never in the public share view).
 * Off: a Gauge button. On: an inline strip (headroom dot + four DAW-style micro-bars)
 * that opens the expanded panel. Sampling runs only while the meter is shown.
 */
export function PerformanceMeterButton() {
  const canEdit = useCanEdit();
  const show = useUIStore((s) => s.showPerformanceMeter);
  const toggle = useUIStore((s) => s.togglePerformanceMeter);
  // Stays open while the user works elsewhere (no outside-click dismiss) — closed only
  // by the strip or the panel's own close button.
  const open = useUIStore((s) => s.performancePanelOpen);
  const setOpen = useUIStore((s) => s.setPerformancePanelOpen);
  const { viewport } = useViewportScale();
  const { state, methods } = usePerformanceMeter(canEdit && show);

  if (!canEdit) return null;

  if (!show) {
    return (
      <BarButton
        onClick={toggle}
        title={PERFORMANCE_METER.BUTTON_TITLE}
        icon={<Gauge size={SCENE_BOTTOM_BAR.ICON_SIZE} strokeWidth={2} aria-hidden="true" />}
      />
    );
  }

  const compact = viewport.width < PERFORMANCE_METER.COMPACT_BELOW_PX;
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        className={`perf-meter-strip${open ? ' perf-meter-strip--open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={`${PERFORMANCE_METER.BUTTON_TITLE} — ${PERFORMANCE_METER.HEADROOM_WORDS[state.headroom]}`}
      >
        <span className={`perf-meter-dot perf-level--${state.headroom}`} />
        {!compact && (
          <span className="perf-meter-strip__bars">
            {STRIP_METRICS.map((id) => (
              <span key={id} className="perf-meter-strip__item" title={metricTitle(id, state.sample)}>
                <span className="perf-meter-strip__label">{PERFORMANCE_METER.LABELS[id]}</span>
                <MeterBar
                  value={state.display[id]}
                  peak={state.peaks[id]}
                  level={state.levels[id]}
                  width={PERFORMANCE_METER.STRIP_BAR_WIDTH}
                  compact
                />
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <PerformanceMeterPanel
          state={state}
          onResetPeaks={methods.resetPeaks}
          onClose={() => setOpen(false)}
          onHideMeter={() => {
            setOpen(false);
            toggle();
          }}
        />
      )}
    </div>
  );
}

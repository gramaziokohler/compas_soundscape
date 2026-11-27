/**
 * Hybrid2WaveFitNotice — the Run step's message when the wave part could not run as set (its grid did
 * not fit the GPU memory, or a source / listener near a surface forced a finer grid).
 *
 * The job keeps running with the recommended fitted parameters (backend utils/hybrid_wave_fit.py);
 * this shows why, and the two options: conservative (keeps the wave part's accuracy) and optimized
 * (keeps more of the band in the wave solver), one marked "Recommended", the running one "Running".
 * Clicking the other one asks "Do you want to restart the simulation with this?" and, on yes, sets the
 * card to it and restarts (`onChoose`). With no option that runs, only the message shows.
 *
 * Usage:
 * ```tsx
 * <Hybrid2WaveFitNotice adjustment={adjustment} running onChoose={(o) => restartWith(o)} />
 * ```
 */

'use client';

import { useState, type CSSProperties } from 'react';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatHz } from '@/lib/acoustics/crossover-band';
import type { HybridWaveAdjustment, HybridWaveOption } from '@/types/acoustics';

export interface Hybrid2WaveFitNoticeProps {
  adjustment: HybridWaveAdjustment;
  /** The run is going (restart) or finished (re-run). */
  running: boolean;
  /** Set the card to this option and run it; omitted = read-only (share view). */
  onChoose?: (option: HybridWaveOption) => void;
}

const OPTION_TITLE: Record<HybridWaveOption['key'], string> = {
  conservative: 'Conservative',
  optimized: 'Optimized',
};

function optionSummary(option: HybridWaveOption): string {
  const precision = option.precision === 'single' ? ', single precision' : '';
  return `${formatHz(option.crossover_hz)}, ${option.ppw} points per wavelength${precision}`;
}

export function Hybrid2WaveFitNotice({ adjustment, running, onChoose }: Hybrid2WaveFitNoticeProps) {
  const [confirming, setConfirming] = useState<HybridWaveOption | null>(null);
  const title = adjustment.reason === 'gpu' ? 'The wave grid does not fit the GPU' : 'A source or listener is close to a surface';
  return (
    <div className="notice-bar card-stack--md flex-col items-stretch" style={{ '--notice-color': 'var(--color-warning)' } as CSSProperties} role="status">
      <div className="card-field">
        <span className="text-xs font-semibold leading-4" style={{ color: 'var(--color-warning-hover)' }}>{title}</span>
        <span className="text-xxs leading-4">
          {adjustment.message}
          {adjustment.applied ? ` ${running ? 'The simulation runs' : 'The simulation ran'} with the ${adjustment.applied} option.` : ''}
        </span>
      </div>
      {adjustment.options.length > 0 && (
        <div className="card-stack--tight" role="list" aria-label="Parameter options">
          {adjustment.options.map((option) => {
            const applied = option.key === adjustment.applied;
            const canPick = !applied && !!onChoose;
            return (
              <button
                key={option.key}
                type="button"
                role="listitem"
                disabled={!canPick}
                onClick={() => canPick && setConfirming(option)}
                className="card-field rounded border px-2 py-1 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-secondary-lighter"
                style={{
                  borderColor: applied ? 'var(--color-warning)' : 'var(--color-border-strong)',
                  backgroundColor: confirming?.key === option.key ? 'var(--color-secondary-lighter)' : 'transparent',
                }}
                title={canPick ? `${running ? 'Restart' : 'Re-run'} the simulation with these parameters` : undefined}
              >
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-xs font-semibold leading-4">{OPTION_TITLE[option.key]}</span>
                  {option.key === adjustment.recommended && <Badge variant="success">Recommended</Badge>}
                  {applied && <Badge variant="warning">{running ? 'Running' : 'Used'}</Badge>}
                </span>
                <span className="text-xxs leading-4">{option.label}</span>
                <span className="text-xxs leading-4 text-secondary-hover">{option.detail}</span>
              </button>
            );
          })}
        </div>
      )}
      {confirming && onChoose && (
        <ConfirmDialog
          message={`Do you want to ${running ? 'restart' : 're-run'} the simulation with this? ${optionSummary(confirming)}.`
            + (running ? ' The current run stops,' : ' The current results will be replaced,')
            + ' and the card is set to these parameters.'}
          confirmLabel={running ? 'Restart' : 'Re-run'}
          variant="warning"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const option = confirming;
            setConfirming(null);
            onChoose(option);
          }}
        />
      )}
    </div>
  );
}

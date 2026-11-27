/**
 * Steps of "Hybrid simulation 2": Setup → Check → Run → Results.
 *
 * - `Hybrid2StepBar`: the four steps under the card title. While a run is going, the Run step
 *   spins and Setup / Check stay clickable (the run carries on); Run brings the progress back.
 * - `Hybrid2RunStep`: the Run step's body, the run's progress with every process row expanded
 *   (the card footer shows no progress for this card), the offer to re-run when the settings
 *   changed after the run started, and the wave part's fitted parameters with the option to
 *   restart with the other set (Hybrid2WaveFitNotice).
 * - `Hybrid2RerunPrompt`: the Results step's "Re-run simulation" with its confirmation.
 */

'use client';

import { useState } from 'react';
import { Check, RotateCcw, Square } from 'lucide-react';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ProgressLanes } from '@/components/ui/ProgressLanes';
import { Spinner } from '@/components/ui/Spinner';
import type { ProgressLane } from '@/types/card';
import type { HybridWaveAdjustment, HybridWaveOption } from '@/types/acoustics';
import { Hybrid2WaveFitNotice } from './Hybrid2WaveFitNotice';

export type Hybrid2Step = 'setup' | 'check' | 'run' | 'results';

const STEPS: { id: Hybrid2Step; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'check', label: 'Check' },
  { id: 'run', label: 'Run' },
  { id: 'results', label: 'Results' },
];

export interface Hybrid2StepBarProps {
  /** The step whose body is shown. */
  step: Hybrid2Step;
  /** Furthest step reached (the run's or the results'); earlier steps show a check mark. */
  reached: Hybrid2Step;
  /** A run is going: the Run step spins. */
  running?: boolean;
  /** Called when a clickable step is clicked; omitted = not clickable. */
  onStep?: (step: Hybrid2Step) => void;
  /** Steps that can be clicked. */
  clickable?: Hybrid2Step[];
  /** On the solid-blue generated card: on-blue colours. */
  onBlue?: boolean;
  /** The settings differ from the last run's: a reset button on the Setup tab restores them. */
  onReset?: () => void;
}

/**
 * Usage:
 * ```tsx
 * <Hybrid2StepBar step="setup" reached="run" running onStep={setStep} clickable={['setup', 'check', 'run']} />
 * ```
 */
export function Hybrid2StepBar({ step, reached, running = false, onStep, clickable = [], onBlue = false, onReset }: Hybrid2StepBarProps) {
  const reachedIndex = STEPS.findIndex((s) => s.id === reached);
  const colors = onBlue
    ? { active: 'var(--color-on-blue)', done: 'var(--color-on-blue-muted)', idle: 'var(--color-on-blue-faint)', text: 'var(--color-on-blue-muted)', activeText: 'var(--color-on-blue)' }
    : { active: 'var(--color-primary)', done: 'var(--color-primary-light)', idle: 'var(--color-secondary-light)', text: 'var(--color-secondary-hover)', activeText: 'var(--foreground)' };
  return (
    <div className="flex gap-1" role="list" aria-label="Simulation steps">
      {STEPS.map((s, i) => {
        const active = s.id === step;
        const done = i < reachedIndex;
        const spinning = running && s.id === 'run';
        const canClick = !!onStep && clickable.includes(s.id) && !active;
        return (
          <div
            key={s.id}
            role="listitem"
            className="flex flex-1 items-center justify-center gap-1 border-b-2 pb-0.5"
            style={{ borderColor: active ? colors.active : done || spinning ? colors.done : colors.idle }}
          >
            <button
              type="button"
              aria-current={active ? 'step' : undefined}
              disabled={!canClick}
              onClick={() => canClick && onStep?.(s.id)}
              className="flex items-center gap-1 text-xxs transition-colors enabled:cursor-pointer enabled:hover:underline"
              style={{ color: active ? colors.activeText : colors.text }}
            >
              {spinning
                ? <Spinner size={9} thickness={1} className="shrink-0" />
                : done && <Check size={10} className="shrink-0" />}
              {i + 1}. {s.label}
            </button>
            {s.id === 'setup' && onReset && (
              <button
                type="button"
                onClick={onReset}
                className="flex cursor-pointer items-center transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-warning)' }}
                title="Reset the settings to the last run's"
                aria-label="Reset the settings to the last run's"
              >
                <RotateCcw size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface Hybrid2RerunPromptProps {
  /** Go to the Check step (geometry check, then the run from there). */
  onCheckFirst: () => void;
  /** Start the run now (Run step; the run still checks the geometry if the inputs changed). */
  onRunNow: () => void;
}

/**
 * The Results step's re-run when the settings changed since the run: a button, then a confirmation
 * that the results will be replaced, with the choice of checking the geometry first.
 *
 * Usage:
 * ```tsx
 * <Hybrid2RerunPrompt onCheckFirst={() => openCheck()} onRunNow={() => run()} />
 * ```
 */
export function Hybrid2RerunPrompt({ onCheckFirst, onRunNow }: Hybrid2RerunPromptProps) {
  const [confirming, setConfirming] = useState(false);
  const button = 'cursor-pointer rounded border px-2 text-xxs font-semibold leading-5 transition-opacity hover:opacity-80';
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={`flex items-center justify-center gap-1 ${button}`}
        style={{ borderColor: 'var(--color-on-blue)', color: 'var(--color-on-blue)' }}
        title="The settings changed since this run"
      >
        <RotateCcw size={10} />
        Re-run simulation
      </button>
    );
  }
  return (
    <div className="card-settings-inset card-field">
      <span className="text-xs leading-4">Re-run with the changed settings? The current results will be replaced.</span>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => { setConfirming(false); onRunNow(); }} className={`${button} border-primary bg-primary text-white`}>
          Run now
        </button>
        <button type="button" onClick={() => { setConfirming(false); onCheckFirst(); }} className={`${button} border-primary text-primary`}>
          Check geometry first
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={`${button} border-transparent text-secondary-hover`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export interface Hybrid2RunStepProps {
  progress: number;
  status?: string;
  lanes: ProgressLane[] | null;
  /** The settings, materials or positions changed since the run started. */
  changedSinceStart: boolean;
  onRerun: () => void;
  /** Stop the run (the card footer shows no stop button for this card while it is open). */
  onStop: () => void;
  /** The wave part runs fitted parameters (Hybrid2WaveFitNotice): why, and the other option to restart with. */
  waveAdjustment?: HybridWaveAdjustment | null;
  onChooseWaveOption?: (option: HybridWaveOption) => void;
}

/**
 * Usage:
 * ```tsx
 * <Hybrid2RunStep progress={42} status="Geometric 45% · Wave 20%" lanes={lanes} changedSinceStart onRerun={rerun} onStop={stop} />
 * ```
 */
export function Hybrid2RunStep({
  progress, status, lanes, changedSinceStart, onRerun, onStop, waveAdjustment, onChooseWaveOption,
}: Hybrid2RunStepProps) {
  return (
    <div className="card-stack">
      {waveAdjustment && <Hybrid2WaveFitNotice adjustment={waveAdjustment} running onChoose={onChooseWaveOption} />}
      {changedSinceStart && (
        <div
          className="flex items-center gap-2 rounded border px-2 py-1.5"
          style={{ borderColor: 'var(--color-warning)' }}
        >
          <span className="min-w-0 flex-1 text-xs leading-4">The settings changed since this run started.</span>
          <button
            type="button"
            onClick={onRerun}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white"
            title="Stop this run and start one with the current settings"
          >
            <RotateCcw size={10} />
            Re-run
          </button>
        </div>
      )}
      <div className="card-field">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-xs">{status || 'Running...'}</span>
          <span className="text-xxs font-mono text-secondary-hover">{Math.round(progress)}%</span>
          <button
            type="button"
            onClick={onStop}
            className="flex shrink-0 cursor-pointer items-center gap-1 text-xxs text-secondary-hover transition-colors hover:text-error"
            title="Stop the simulation"
          >
            <Square size={9} fill="currentColor" />
            Stop
          </button>
        </div>
        <ProgressBar value={progress / 100} label="Simulation progress" />
      </div>
      {lanes && lanes.length > 0 && <ProgressLanes lanes={lanes} />}
    </div>
  );
}

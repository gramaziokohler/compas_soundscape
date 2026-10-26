/**
 * PffdtdAnimationGenerator — on-demand wave animation of a finished
 * wave-based run.
 *
 * The user picks the height of the horizontal plane (the viewer previews the
 * strength-G slice there until the plane is animated) and the animation
 * length, then generates: one short GPU pulse run per source on the run's
 * kept voxel grid (`pffdtdAnimationStore`). A small progress widget replaces
 * the button while it runs; the frames load when it finishes.
 */

'use client';

import { useState } from 'react';
import { usePffdtdAnimationStore, usePffdtdVisualsStore } from '@/store';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Spinner } from '@/components/ui/Spinner';
import { Notice } from '@/components/ui/Notice';
import { animationPlaneMatches, defaultSlicePosition, volumeAxisRange } from '@/lib/acoustics/pffdtd-volume';
import { PFFDTD, PFFDTD_VISUALS } from '@/utils/constants';
import type { PffdtdFieldBlock, PffdtdFieldVolume } from '@/types/pffdtd';

interface PffdtdAnimationGeneratorProps {
  configId: string;
  simulationId: string;
  block: PffdtdFieldBlock;
  volume: PffdtdFieldVolume;
  /** Requested plane height (m). */
  z: number;
  /** Whether frames exist for this simulation (at block.z). */
  hasAnimation: boolean;
  onBlueBackground?: boolean;
}

const BUTTON_CLASS =
  'cursor-pointer rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

export function PffdtdAnimationGenerator({
  configId, simulationId, block, volume, z, hasAnimation, onBlueBackground = false,
}: PffdtdAnimationGeneratorProps) {
  const job = usePffdtdAnimationStore((s) => s.jobs[simulationId]);
  const { generateAnimation, cancelAnimation, clearAnimationJob } = usePffdtdAnimationStore.getState();
  const setFieldSlice = usePffdtdVisualsStore((s) => s.setFieldSlice);
  const [animationMs, setAnimationMs] = useState<number>(PFFDTD.DEFAULT_ANIMATION_MS);

  const range = volumeAxisRange(volume, 'z');
  const running = job?.status === 'running';
  const matches = hasAnimation && animationPlaneMatches(block, z);
  const mutedStyle = { color: onBlueBackground ? 'var(--color-on-blue-muted)' : 'var(--color-secondary-hover)' };

  return (
    <div className="card-stack--tight">
      <RangeSlider
        label="Height"
        value={z}
        min={range.min}
        max={range.max}
        step={PFFDTD_VISUALS.SLICE_STEP_M}
        unit="m"
        precision={2}
        defaultValue={defaultSlicePosition(block, volume, 'z')}
        onChange={(position) => setFieldSlice(configId, { axis: 'z', position })}
        disabled={running}
        hoverText="Height of the horizontal plane the wave is recorded on"
        onBlueBackground={onBlueBackground}
      />
      <RangeSlider
        label="Length"
        value={animationMs}
        min={PFFDTD.ANIMATION_MS_MIN}
        max={PFFDTD.ANIMATION_MS_MAX}
        step={PFFDTD.ANIMATION_MS_STEP}
        unit="ms"
        defaultValue={PFFDTD.DEFAULT_ANIMATION_MS}
        onChange={setAnimationMs}
        disabled={running}
        onBlueBackground={onBlueBackground}
      />

      {running ? (
        <div className="card-stack--tight">
          <div className="flex items-center gap-2">
            <Spinner size={12} />
            <span className="min-w-0 flex-1 truncate text-[10px]" style={mutedStyle}>
              {job.statusText || 'Generating the wave animation…'}
            </span>
            <button type="button" className={BUTTON_CLASS} onClick={() => cancelAnimation(simulationId)}>
              Cancel
            </button>
          </div>
          <ProgressBar value={job.progress / 100} label="Wave animation" />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 text-[10px]" style={mutedStyle}>
            {matches
              ? `Animated at z = ${block.z.toFixed(2)} m`
              : 'Preview: strength G at this height'}
          </span>
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => void generateAnimation(simulationId, z, animationMs)}
            title="One short GPU run per source on the simulated voxel grid"
          >
            {matches ? 'Regenerate' : 'Generate animation'}
          </button>
        </div>
      )}
      {job?.status === 'error' && job.error && (
        <Notice type="error" message={job.error} onDismiss={() => clearAnimationJob(simulationId)} />
      )}
    </div>
  );
}

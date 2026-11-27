/**
 * PffdtdPrecisionToggle Component
 *
 * Solver precision of a wave-based run (wave-based card, hybrid card's wave part). Single precision
 * halves the GPU memory per grid point and runs ~1.5x faster; it matches double at any reverberation
 * time down to a grid spacing of PFFDTD.SINGLE_MIN_SPACING_M. Below that the low bands drift, so a
 * warning tag appears next to the toggle while single is on.
 */

'use client';

import { PFFDTD } from '@/utils/constants';
import type { PffdtdPrecision } from '@/types/pffdtd';
import { ToggleField } from '@/components/ui/ToggleField';
import { CardSelect } from '@/components/ui/CardSelect';
import { ModifiedMark } from '@/components/ui/ModifiedMark';
import { Notice } from '@/components/ui/Notice';

interface PffdtdPrecisionToggleProps {
  precision: PffdtdPrecision;
  /** Estimated grid spacing h (m); null when unknown (e.g. hybrid before the room is measured). */
  gridSpacing: number | null;
  onChange: (precision: PffdtdPrecision) => void;
  disabled?: boolean;
  modified?: boolean;
  /** A "Single / Double precision" dropdown instead of the toggle (Hybrid simulation 2). */
  asSelect?: boolean;
}

const PRECISION_HINT = 'Single precision stores each grid point in half the GPU memory of double (½ GPU memory) and runs '
  + 'about 1.5× faster. It matches double down to a grid spacing of '
  + `${(PFFDTD.SINGLE_MIN_SPACING_M * 100).toFixed(0)} cm; on finer grids the lowest bands drift, so use double there.`;

const PRECISION_OPTIONS = [
  { value: 'single', label: 'Single precision (½ GPU memory)', title: PRECISION_HINT },
  { value: 'double', label: 'Double precision', title: 'Exact on any grid; twice the GPU memory of single precision' },
];

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

export function PffdtdPrecisionToggle({ precision, gridSpacing, onChange, disabled, modified, asSelect = false }: PffdtdPrecisionToggleProps) {
  const single = precision === 'single';
  const tooFine = single && gridSpacing !== null && gridSpacing < PFFDTD.SINGLE_MIN_SPACING_M;
  return (
    <div className="card-stack--tight">
      {asSelect ? (
        <div title={PRECISION_HINT}>
          <label className="text-xxs card-label text-secondary-hover">
            Precision{modified && <ModifiedMark />}
          </label>
          <CardSelect
            value={precision}
            onChange={(v) => onChange(v as PffdtdPrecision)}
            disabled={disabled}
            options={PRECISION_OPTIONS}
          />
        </div>
      ) : (
      <ToggleField
        checked={single}
        onChange={(on) => onChange(on ? 'single' : 'double')}
        label="Single precision"
        badge="½ GPU memory"
        modified={modified}
        disabled={disabled}
      />
      )}
      {tooFine && (
        <span
          title={
            `Grid h ≈ ${cm(gridSpacing)} is finer than ${cm(PFFDTD.SINGLE_MIN_SPACING_M)}: single precision then drifts ` +
            'from double in the low bands (63 Hz early-response error about -28 dB at 1.7 cm, -17 dB at 0.8 cm; ' +
            'level and C80 off by 0.1-0.3 dB). Switch to double, or lower the max frequency / points per wavelength.'
          }
        >
          <Notice
            type="warning"
            variant="tag"
            message={`h ${cm(gridSpacing)} < ${cm(PFFDTD.SINGLE_MIN_SPACING_M)}: low bands drift, use double`}
          />
        </span>
      )}
    </div>
  );
}

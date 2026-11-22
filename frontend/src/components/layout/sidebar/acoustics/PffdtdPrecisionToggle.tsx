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
import { Notice } from '@/components/ui/Notice';

interface PffdtdPrecisionToggleProps {
  precision: PffdtdPrecision;
  /** Estimated grid spacing h (m); null when unknown (e.g. hybrid before the room is measured). */
  gridSpacing: number | null;
  onChange: (precision: PffdtdPrecision) => void;
  disabled?: boolean;
  modified?: boolean;
}

const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

export function PffdtdPrecisionToggle({ precision, gridSpacing, onChange, disabled, modified }: PffdtdPrecisionToggleProps) {
  const single = precision === 'single';
  const tooFine = single && gridSpacing !== null && gridSpacing < PFFDTD.SINGLE_MIN_SPACING_M;
  return (
    <div className="card-stack--tight">
      <ToggleField
        checked={single}
        onChange={(on) => onChange(on ? 'single' : 'double')}
        label="Single precision"
        badge="½ GPU memory"
        modified={modified}
        disabled={disabled}
      />
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

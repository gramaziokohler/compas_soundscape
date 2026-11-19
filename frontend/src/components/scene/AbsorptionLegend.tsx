'use client';

import { ABSORPTION_LEGEND } from '@/utils/constants';

/**
 * AbsorptionLegend Component
 *
 * Colour key of the Acoustics view mode: surfaces are tinted by their material's
 * mean absorption coefficient α through `getMaterialColorByAbsorption`
 * (utils/utils.ts) — teal (reflective, 0%) → amber (50%) → red (absorbent, 100%).
 * The CSS gradient uses the same three tokens with linear interpolation, so it
 * matches the scene colours exactly.
 *
 * Usage:
 * ```tsx
 * {viewMode === 'acoustic' && <AbsorptionLegend />}
 * ```
 */
export function AbsorptionLegend() {
  return (
    <div
      className="rounded-md px-2.5 py-1.5 frosted-surface backdrop-blur-lg backdrop-saturate-150 flex flex-col gap-1"
      style={{
        width: ABSORPTION_LEGEND.WIDTH,
        border: '1px solid var(--color-overlay-border)',
        color: 'var(--color-secondary-hover)',
      }}
      role="img"
      aria-label={`${ABSORPTION_LEGEND.ARIA_LABEL}: ${ABSORPTION_LEGEND.TOOLTIP}`}
      title={ABSORPTION_LEGEND.TOOLTIP}
    >
      <div className="flex items-baseline justify-between text-[10px] font-medium">
        <span>{ABSORPTION_LEGEND.LOW_LABEL}</span>
        <span>{ABSORPTION_LEGEND.HIGH_LABEL}</span>
      </div>
      <div
        className="w-full rounded-full"
        style={{ height: ABSORPTION_LEGEND.BAR_HEIGHT, background: ABSORPTION_LEGEND.GRADIENT }}
      />
      <div className="flex justify-between text-[9px] tabular-nums">
        {ABSORPTION_LEGEND.TICKS.map((tick) => (
          <span key={tick}>{tick}</span>
        ))}
      </div>
    </div>
  );
}

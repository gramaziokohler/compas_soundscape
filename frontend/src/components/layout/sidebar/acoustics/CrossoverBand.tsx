/**
 * CrossoverBand — the frequency band of Hybrid simulation 2.
 *
 * A log frequency axis (20 Hz – 20 kHz) split by a draggable handle: the wave solver below it
 * (standing waves), the rays above it (bouncing rays). Clicking a part selects it, so the card shows
 * that part's settings. Each part has a checkbox; switching one off makes the other run alone:
 * rays alone cover the whole band (no handle), the wave solver alone runs up to the handle and the
 * band above it is greyed out ("not simulated").
 *
 * Two vertical lines mark the recommended crossover (the room's Schroeder frequency) and the GPU
 * limit (past it the wave grid no longer fits the free GPU memory); the band past the GPU limit is
 * hatched red. An orange "used" line marks the crossover the simulation actually ran with when the
 * job had to fit it (GPU memory, a seed near a surface; Hybrid2WaveFitNotice). Dragging near the
 * recommended line snaps to it. The handle is a slider for the
 * keyboard (arrows, Shift for larger steps, Home = recommended).
 *
 * Usage:
 * ```tsx
 * <CrossoverBand crossoverHz={180} parts="both" selected="wave" recommendedHz={175} gpuMaxHz={420}
 *   onCrossoverChange={setHz} onSelect={setSelected} onPartsChange={setParts} />
 * ```
 */

'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { HYBRID, HYBRID_BAND } from '@/utils/constants';
import {
  bandFrequency,
  bandPosition,
  formatHz,
  rayPath,
  floorCrossover,
  snapCrossover,
  tickLabel,
  wavePath,
} from '@/lib/acoustics/crossover-band';
import type { HybridParts } from '@/types/acoustics';

export type HybridPart = 'wave' | 'rays';

export interface CrossoverBandProps {
  /** Where the handle sits (the planned crossover; the wave band's top when the wave part runs alone). */
  crossoverHz: number;
  parts: HybridParts;
  selected: HybridPart;
  /** Recommended crossover (Schroeder frequency); null when unknown. */
  recommendedHz: number | null;
  recommendedTitle?: string;
  /** Handle value past which the wave grid no longer fits the GPU; Infinity = never, null = unknown. */
  gpuMaxHz: number | null;
  gpuTitle?: string;
  /** The value the (running or last) simulation actually used, when it differs from the handle: an orange line. */
  usedHz?: number | null;
  usedTitle?: string;
  disabled?: boolean;
  onCrossoverChange: (hz: number) => void;
  onSelect: (part: HybridPart) => void;
  onPartsChange: (parts: HybridParts) => void;
}

const WAVE_COLOR = 'var(--color-material-start)';
const RAYS_COLOR = 'var(--color-primary)';
const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const HATCH = (color: string) =>
  `repeating-linear-gradient(135deg, ${tint(color, 28)} 0 4px, transparent 4px 8px)`;
const pct = (position: number) => `${(position * 100).toFixed(3)}%`;

const WAVE_PATHS = [wavePath(HYBRID_BAND.WAVE_CYCLES), wavePath(HYBRID_BAND.WAVE_CYCLES, Math.PI)];
const RAY_PATHS = Array.from({ length: HYBRID_BAND.RAY_LINES }, (_, i) =>
  rayPath(HYBRID_BAND.RAY_BOUNCES, (i + 0.5) / HYBRID_BAND.RAY_LINES));

/** Decorative curves of one part, stretched over its box. */
function PartCurves({ part }: { part: HybridPart }) {
  const paths = part === 'wave' ? WAVE_PATHS : RAY_PATHS;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={part === 'wave' ? WAVE_COLOR : RAYS_COLOR}
          strokeWidth={1.25}
          strokeOpacity={i === 0 ? 0.9 : 0.45}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** A full-height marker line with a small label; clicking the label moves the handle onto the line. */
function MarkerLine({ position, color, label, title, labelAt, onClick }: {
  position: number; color: string; label: string; title?: string; labelAt: 'top' | 'bottom'; onClick?: () => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute inset-y-0 z-10"
      style={{ left: pct(position), width: 0, borderLeft: `1.5px dashed ${color}` }}
      title={title}
    >
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        onPointerDown={(e) => e.stopPropagation()}
        className={`absolute ${labelAt === 'top' ? 'top-0.5' : 'bottom-0.5'} left-0.5 whitespace-nowrap rounded px-0.5 text-xxs leading-3 transition-opacity enabled:cursor-pointer enabled:hover:underline`}
        style={{ color, backgroundColor: 'var(--color-surface)' }}
        title={onClick ? `${title ? `${title}
` : ''}Click to move the crossover here` : title}
      >
        {label}
      </button>
    </div>
  );
}

export function CrossoverBand({
  crossoverHz,
  parts,
  selected,
  recommendedHz,
  recommendedTitle,
  gpuMaxHz,
  gpuTitle,
  usedHz = null,
  usedTitle,
  disabled = false,
  onCrossoverChange,
  onSelect,
  onPartsChange,
}: CrossoverBandProps) {
  const bandRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const waveOn = parts !== 'rays';
  const raysOn = parts !== 'wave';
  const hasHandle = waveOn;
  const split = hasHandle ? bandPosition(crossoverHz) : 0;
  const gpuPosition = gpuMaxHz !== null && Number.isFinite(gpuMaxHz) && waveOn ? bandPosition(gpuMaxHz) : null;
  const overGpu = gpuMaxHz !== null && waveOn && crossoverHz > gpuMaxHz;

  const frequencyAt = useCallback((clientX: number) => {
    const rect = bandRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return snapCrossover(bandFrequency((clientX - rect.left) / rect.width), recommendedHz);
  }, [recommendedHz]);

  // Drag: listen on window so a release outside the band (or a lost capture) still ends it.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: globalThis.PointerEvent) => {
      const hz = frequencyAt(e.clientX);
      if (hz !== null) onCrossoverChange(hz);
    };
    const end = () => setDragging(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
  }, [dragging, frequencyAt, onCrossoverChange]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const ratio = e.shiftKey ? HYBRID_BAND.KEY_STEP_RATIO_LARGE : HYBRID_BAND.KEY_STEP_RATIO;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = crossoverHz * ratio;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = crossoverHz / ratio;
    else if (e.key === 'Home' && recommendedHz !== null) next = recommendedHz;
    if (next === null) return;
    e.preventDefault();
    onCrossoverChange(snapCrossover(next, e.key === 'Home' ? recommendedHz : null));
  };

  const togglePart = (part: HybridPart, on: boolean) => {
    const other = part === 'wave' ? raysOn : waveOn;
    if (!on && !other) return; // one part always runs
    const next: HybridParts = on ? (other ? 'both' : part) : (part === 'wave' ? 'rays' : 'wave');
    onPartsChange(next);
    onSelect(on ? part : part === 'wave' ? 'rays' : 'wave');
  };

  const partBox = (part: HybridPart, left: number, right: number) => {
    const on = part === 'wave' ? waveOn : raysOn;
    const color = part === 'wave' ? WAVE_COLOR : RAYS_COLOR;
    const isSelected = selected === part && on;
    return (
      <button
        type="button"
        className="absolute inset-y-0 cursor-pointer overflow-hidden transition-colors disabled:cursor-default"
        style={{
          left: pct(left),
          width: pct(right - left),
          backgroundColor: isSelected ? tint(color, 16) : 'transparent',
          boxShadow: isSelected ? `inset 0 -2px 0 ${color}` : undefined,
        }}
        onClick={() => onSelect(part)}
        disabled={!on}
        title={part === 'wave' ? 'Wave-based part: show its settings' : 'Ray-tracing part: show its settings'}
        aria-pressed={isSelected}
      >
        <PartCurves part={part} />
      </button>
    );
  };

  return (
    <div className="card-stack--tight">
      <div className="flex items-center gap-2">
        {(['wave', 'rays'] as const).map((part) => {
          const on = part === 'wave' ? waveOn : raysOn;
          const onlyOne = on && !(part === 'wave' ? raysOn : waveOn);
          return (
            <div
              key={part}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5"
              style={{ backgroundColor: selected === part && on ? 'var(--color-secondary-lighter)' : 'transparent' }}
              onClick={() => on && onSelect(part)}
            >
              <Checkbox
                checked={on}
                disabled={disabled || onlyOne}
                onChange={(v) => togglePart(part, v)}
                accentColor={part === 'wave' ? WAVE_COLOR : RAYS_COLOR}
                title={onlyOne ? 'One part always runs: switch the other on first' : on ? 'Switch this part off' : 'Switch this part on'}
              />
              <span
                className="text-xs leading-4"
                style={{ color: on ? (part === 'wave' ? WAVE_COLOR : 'var(--color-blue-text)') : 'var(--color-secondary-hover)' }}
              >
                {part === 'wave' ? 'Wave-based' : 'Ray tracing'}
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative select-none">
        <div
          ref={bandRef}
          className="relative overflow-visible rounded border"
          style={{
            height: HYBRID_BAND.HEIGHT_PX,
            borderColor: 'var(--color-border-strong)',
            backgroundColor: 'var(--color-secondary-lighter)',
          }}
        >
          <div className="absolute inset-0 overflow-hidden rounded">
            {waveOn && partBox('wave', 0, split)}
            {raysOn && partBox('rays', split, 1)}
            {!raysOn && (
              <div
                className="absolute inset-y-0 flex items-center justify-center text-xxs text-secondary-hover"
                style={{ left: pct(split), right: 0, background: HATCH('var(--color-secondary-hover)') }}
                title="Above the wave band nothing is simulated: switch the rays on to cover it"
              >
                Not simulated
              </div>
            )}
            {gpuPosition !== null && gpuPosition < bandPosition(HYBRID.CROSSOVER_HZ_MAX) && (
              <div
                className="pointer-events-none absolute inset-y-0"
                style={{
                  left: pct(gpuPosition),
                  width: pct(bandPosition(HYBRID.CROSSOVER_HZ_MAX) - gpuPosition),
                  background: HATCH('var(--color-error)'),
                }}
              />
            )}
          </div>

          {waveOn && recommendedHz !== null && (
            <MarkerLine position={bandPosition(recommendedHz)} color="var(--color-success)" label="rec" title={recommendedTitle} labelAt="top"
              onClick={hasHandle && !disabled ? () => onCrossoverChange(recommendedHz) : undefined} />
          )}
          {gpuPosition !== null && (
            <MarkerLine position={gpuPosition} color="var(--color-error)" label="GPU max" title={gpuTitle} labelAt="bottom"
              onClick={hasHandle && !disabled && gpuMaxHz !== null
                ? () => onCrossoverChange(floorCrossover(gpuMaxHz))
                : undefined} />
          )}
          {waveOn && usedHz !== null && (
            <MarkerLine position={bandPosition(usedHz)} color="var(--color-warning)" label="used" title={usedTitle} labelAt="top"
              onClick={hasHandle && !disabled ? () => onCrossoverChange(usedHz) : undefined} />
          )}

          {hasHandle && (
            <div
              role="slider"
              tabIndex={disabled ? -1 : 0}
              aria-label={raysOn ? 'Crossover frequency' : 'Wave band top frequency'}
              aria-valuemin={HYBRID.CROSSOVER_HZ_MIN}
              aria-valuemax={HYBRID.CROSSOVER_HZ_MAX}
              aria-valuenow={Math.round(crossoverHz)}
              aria-valuetext={formatHz(crossoverHz)}
              aria-disabled={disabled}
              onPointerDown={startDrag}
              onKeyDown={onHandleKey}
              className="absolute inset-y-0 z-20 flex -translate-x-1/2 touch-none items-center justify-center outline-none focus-visible:ring-2"
              style={{ left: pct(split), width: 16, cursor: disabled ? 'default' : 'ew-resize' }}
              title={`${raysOn ? 'Crossover' : 'Wave band top'}: ${formatHz(crossoverHz)}. Drag, or use the arrow keys (Home: recommended).`}
            >
              <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2" style={{ backgroundColor: overGpu ? 'var(--color-error)' : 'var(--foreground)' }} />
              <div
                className="relative flex h-5 w-4 items-center justify-center rounded border"
                style={{
                  backgroundColor: 'var(--color-surface-2)',
                  borderColor: overGpu ? 'var(--color-error)' : 'var(--foreground)',
                  color: overGpu ? 'var(--color-error)' : 'var(--foreground)',
                }}
              >
                <ChevronsLeftRight size={11} />
              </div>
            </div>
          )}
        </div>

        <div className="relative h-3 text-xxs leading-3 text-secondary-hover">
          {HYBRID_BAND.AXIS_TICKS_HZ.map((hz, i) => (
            <span
              key={hz}
              className="absolute top-0.5"
              style={{
                left: pct(bandPosition(hz)),
                transform: i === 0 ? 'none' : i === HYBRID_BAND.AXIS_TICKS_HZ.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {tickLabel(hz)}{i === HYBRID_BAND.AXIS_TICKS_HZ.length - 1 ? ' Hz' : ''}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}

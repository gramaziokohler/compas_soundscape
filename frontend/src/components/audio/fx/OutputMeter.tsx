'use client';

import { useEffect, useRef, useState } from 'react';
import { SOUND_FX } from '@/utils/constants';

interface OutputMeterProps {
  height: number;
  /** Linear peak of the post-FX stereo output (can exceed 1.0 when clipping). */
  getLevels: () => { left: number; right: number };
}

const MIN_DB = SOUND_FX.METER_MIN_DB;
const MAX_DB = SOUND_FX.METER_MAX_DB;
const RANGE = MAX_DB - MIN_DB;
/** Fraction from the bottom at which 0 dBFS sits. */
const ZERO_PCT = ((0 - MIN_DB) / RANGE) * 100;

function levelToPct(peak: number): number {
  const db = 20 * Math.log10(Math.max(peak, 1e-6));
  const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
  return ((clamped - MIN_DB) / RANGE) * 100;
}

/**
 * Two vertical bars showing the final (post-FX) output level in dBFS, with the
 * part above 0 dBFS — i.e. the clipped part — drawn in red.
 *
 * Usage:
 * ```tsx
 * <OutputMeter height={96} getLevels={() => engine.getOutputLevels()} />
 * ```
 */
export function OutputMeter({ height, getLevels }: OutputMeterProps) {
  const [levels, setLevels] = useState({ left: 0, right: 0 });
  const holdRef = useRef({ left: 0, right: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const lv = getLevels();
      const decay = Math.exp(-dt / 0.6);
      const next = {
        left: Math.max(lv.left, holdRef.current.left * decay),
        right: Math.max(lv.right, holdRef.current.right * decay),
      };
      holdRef.current = next;
      setLevels((prev) => {
        if (
          Math.abs(prev.left - next.left) < 0.002 &&
          Math.abs(prev.right - next.right) < 0.002
        ) {
          return prev;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevels]);

  return (
    <div className="flex gap-1" style={{ height, width: 16 }} title="Output level (dBFS)">
      <MeterBar height={height} level={levels.left} />
      <MeterBar height={height} level={levels.right} />
    </div>
  );
}

function MeterBar({ height, level }: { height: number; level: number }) {
  const pct = levelToPct(level);
  const normalPct = Math.min(pct, ZERO_PCT);
  const redPct = Math.max(0, pct - ZERO_PCT);
  const clipped = level >= SOUND_FX.METER_CLIP_LINEAR;

  return (
    <div
      className="relative"
      style={{
        width: 6,
        height,
        background: 'var(--color-secondary-lighter)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${normalPct}%`,
          background: 'var(--color-primary)',
        }}
      />
      {redPct > 0.5 ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: `${ZERO_PCT}%`,
            height: `${redPct}%`,
            background: 'var(--color-error)',
          }}
        />
      ) : clipped ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: `${ZERO_PCT}%`,
            height: 3,
            background: 'var(--color-error)',
          }}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: `${ZERO_PCT}%`,
          height: 1,
          background: 'var(--color-border-strong)',
        }}
      />
    </div>
  );
}

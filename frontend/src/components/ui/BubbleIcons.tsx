"use client";

import { SIMPLE_MODE } from "@/utils/constants";

/**
 * Bubble icons — line pictograms drawn in `currentColor`, so a bubble's state
 * (pending / generated / selected) recolors them. All share a 24×24 viewBox.
 *
 * Usage:
 * ```tsx
 * <Bubble icon={<SimulationTypeIcon type="pyroomacoustics" size={18} />} ... />
 * <Bubble icon={<WaveformRing values={envelope} size={36} />} ... />
 * ```
 */

export interface BubbleIconProps {
  size?: number;
}

const STROKE = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };

/** Resonance — a shoebox room. */
export function ShoeboxIcon({ size = 18 }: BubbleIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path {...STROKE} d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path {...STROKE} d="M4 8l8 4 8-4M12 12v8" />
    </svg>
  );
}

/** Ray tracing (pyroomacoustics) — a ray bouncing inside a room. */
export function RaysIcon({ size = 18 }: BubbleIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect {...STROKE} x="3.5" y="4.5" width="17" height="15" rx="1" strokeWidth={1.2} opacity={0.55} />
      <path {...STROKE} d="M6 17l5-10 4 7 3-4" />
      <circle cx="6" cy="17" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Imported impulse responses — an impulse spike with its decay. */
export function ImpulseIcon({ size = 18 }: BubbleIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path {...STROKE} d="M3 16h5l1.5-11 1.5 11 1.2-4 1 4h7.8" />
    </svg>
  );
}

/** Wave-based simulation (Choras) — propagating wave fronts. */
export function WaveFrontIcon({ size = 18 }: BubbleIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" fill="currentColor" />
      <path {...STROKE} d="M10 8.5a5 5 0 0 1 0 7M13.5 6a8.5 8.5 0 0 1 0 12M17 3.5a12 12 0 0 1 0 17" />
    </svg>
  );
}

/** A single listener — head and shoulders. */
export function ListenerIcon({ size = 18 }: BubbleIconProps) {
  // Headphones — a single listener (first-person listening point).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path {...STROKE} d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect {...STROKE} x="3" y="14" width="4.5" height="6.5" rx="1.5" />
      <rect {...STROKE} x="16.5" y="14" width="4.5" height="6.5" rx="1.5" />
    </svg>
  );
}

/** A grid of listener points. */
export function ListenerGridIcon({ size = 18 }: BubbleIconProps) {
  const pts = [5, 12, 19];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {pts.flatMap((x) => pts.map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.7} fill="currentColor" />))}
    </svg>
  );
}

export interface SimulationTypeIconProps extends BubbleIconProps {
  type: string;
}

/** Pictogram for an acoustic simulation card type. */
export function SimulationTypeIcon({ type, size }: SimulationTypeIconProps) {
  if (type === "resonance") return <ShoeboxIcon size={size} />;
  if (type === "pyroomacoustics") return <RaysIcon size={size} />;
  if (type === "choras") return <WaveFrontIcon size={size} />;
  return <ImpulseIcon size={size} />;
}

export interface WaveformRingProps {
  /** Loudness per timeline bin, 0..1 (clockwise from 12 o'clock). Null = nothing generated yet. */
  values: number[] | null;
  /** Bubble diameter in px — the ring fills it. */
  size: number;
}

/**
 * Radial loudness "fingerprint" of a scene: one bar per timeline bin around an
 * inner circle. Busy scenes look spiky, calm ones smooth. With no generated
 * audio yet, only the dashed base circle is drawn.
 */
export function WaveformRing({ values, size }: WaveformRingProps) {
  const r = size / 2;
  const inner = r * SIMPLE_MODE.WAVEFORM_INNER_RATIO;
  const maxLen = r * SIMPLE_MODE.WAVEFORM_MAX_RATIO;
  const stroke = Math.max(1, size / 30);
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} aria-hidden="true">
      <circle
        className="waveform-ring__base"
        r={inner}
        strokeWidth={stroke * 0.8}
        strokeDasharray={values ? undefined : `${stroke} ${stroke * 1.6}`}
      />
      {values?.map((v, i) => {
        const a = (i / values.length) * Math.PI * 2 - Math.PI / 2;
        const len = Math.max(stroke * 0.6, v * maxLen);
        const x1 = Math.cos(a) * (inner + stroke);
        const y1 = Math.sin(a) * (inner + stroke);
        const x2 = Math.cos(a) * (inner + stroke + len);
        const y2 = Math.sin(a) * (inner + stroke + len);
        return <line key={i} className="waveform-ring__bar" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={stroke} />;
      })}
    </svg>
  );
}

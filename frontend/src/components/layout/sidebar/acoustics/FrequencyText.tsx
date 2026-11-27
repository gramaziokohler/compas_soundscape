/**
 * FrequencyText — a read-out line with its frequencies ("875 Hz", "1.2 kHz") in bold.
 *
 * Usage:
 * ```tsx
 * <FrequencyText text="Wave below 875 Hz, rays above." className="text-xxs text-secondary-hover" />
 * ```
 */

'use client';

import type { CSSProperties } from 'react';

const FREQUENCY = /(\d[\d,.]*\s?k?Hz)/g;

export function FrequencyText({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  const pieces = text.split(FREQUENCY);
  return (
    <p className={className} style={style}>
      {pieces.map((piece, i) => (i % 2 === 1
        ? <strong key={i} className="font-semibold text-foreground">{piece}</strong>
        : piece))}
    </p>
  );
}

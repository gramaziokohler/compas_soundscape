/**
 * FrequencyText — a read-out line with its frequencies ("875 Hz", "1.2 kHz") in bold.
 *
 * Usage:
 * ```tsx
 * <FrequencyText text="Wave below 875 Hz, rays above." className="text-xxs text-secondary-hover" />
 * ```
 */

'use client';

const FREQUENCY = /(\d[\d,.]*\s?k?Hz)/g;

export function FrequencyText({ text, className }: { text: string; className?: string }) {
  const pieces = text.split(FREQUENCY);
  return (
    <p className={className}>
      {pieces.map((piece, i) => (i % 2 === 1
        ? <strong key={i} className="font-semibold text-foreground">{piece}</strong>
        : piece))}
    </p>
  );
}

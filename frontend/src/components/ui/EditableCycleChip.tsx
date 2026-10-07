'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SIMPLE_MODE } from '@/utils/constants';

/** First option above `current`, wrapping to the first one (works for custom values off the list). */
function nextOption(options: readonly number[], current: number): number {
  return options.find((o) => o > current) ?? options[0];
}

export interface EditableCycleChipProps {
  /** Current value, in display units (e.g. people, seconds). */
  value: number;
  /** Values cycled through on single click. */
  options: readonly number[];
  /** Bounds for an exact value typed after a double click. */
  min: number;
  max: number;
  /** Chip label for a value. */
  format: (value: number) => string;
  /** Unit shown next to the exact-value input (e.g. "s"). */
  unit?: string;
  title: string;
  onChange: (value: number) => void;
}

/**
 * EditableCycleChip Component
 *
 * A `bubble-chip` that cycles through preset values on single click and turns
 * into a number input on double click for an exact value. Enter / blur commits
 * (clamped to [min, max]), Escape cancels.
 *
 * Usage:
 * ```tsx
 * <EditableCycleChip value={n} options={[0, 5, 10]} min={0} max={50}
 *   format={(v) => `${v} people`} title="People" onChange={setN} />
 * ```
 */
export function EditableCycleChip({ value, options, min, max, format, unit, title, onChange }: EditableCycleChipProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClickTimer = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  };
  useEffect(() => clearClickTimer, []);

  const handleClick = () => {
    clearClickTimer();
    // Deferred so the first click of a double click doesn't also cycle.
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onChange(nextOption(options, value));
    }, SIMPLE_MODE.CHIP_DOUBLE_CLICK_MS);
  };

  const handleDoubleClick = () => {
    clearClickTimer();
    setDraft(String(value));
  };

  const commit = () => {
    if (draft === null) return;
    const parsed = Math.round(Number(draft));
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      onChange(Math.min(max, Math.max(min, parsed)));
    }
    setDraft(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keep Enter / Escape from reaching the surrounding composer.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(null);
    }
  };

  if (draft !== null) {
    return (
      <span className="bubble-chip bubble-chip--on" title={title}>
        <input
          type="number"
          className="bubble-chip__input"
          value={draft}
          min={min}
          max={max}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          aria-label={title}
        />
        {unit && <span>{unit}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="bubble-chip"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={`${title} — double-click to enter an exact value`}
    >
      {format(value)}
    </button>
  );
}

'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SIMPLE_MODE } from '@/utils/constants';

/** Option after `current` (case-insensitive), wrapping; the first one for a custom value off the list. */
function nextOption(options: readonly string[], current: string): string {
  const i = options.findIndex((o) => o.toLowerCase() === current.trim().toLowerCase());
  return options[(i + 1) % options.length];
}

export interface EditableTextChipProps {
  /** Current value shown on the chip. */
  value: string;
  /** Values cycled through on single click. */
  options: readonly string[];
  /** Placeholder of the free-text input shown after a double click. */
  placeholder?: string;
  title: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * EditableTextChip Component
 *
 * The string counterpart of `EditableCycleChip`: a `bubble-chip` that cycles
 * through preset values on single click and turns into a text input on double
 * click for any value. Enter / blur commits a non-empty value, Escape cancels.
 *
 * Usage:
 * ```tsx
 * <EditableTextChip value={lang} options={['English', 'French']}
 *   title="Speech language" onChange={setLang} />
 * ```
 */
export function EditableTextChip({ value, options, placeholder, title, disabled, onChange }: EditableTextChipProps) {
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
      if (options.length > 0) onChange(nextOption(options, value));
    }, SIMPLE_MODE.CHIP_DOUBLE_CLICK_MS);
  };

  const handleDoubleClick = () => {
    clearClickTimer();
    setDraft(value);
  };

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    if (text && text !== value) onChange(text);
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
          type="text"
          className="bubble-chip__input bubble-chip__input--text"
          value={draft}
          placeholder={placeholder}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          aria-label={title}
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      className="bubble-chip"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      disabled={disabled}
      title={`${title} — double-click to type any value`}
    >
      {value}
    </button>
  );
}

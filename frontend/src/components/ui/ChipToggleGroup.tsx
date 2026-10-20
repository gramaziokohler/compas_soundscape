'use client';

export interface ChipToggleGroupProps {
  /** Chip labels (also used as values). */
  options: readonly string[];
  /** Selected values. */
  selected: readonly string[];
  /** Called with the new selection. */
  onChange: (selected: string[]) => void;
  /** `multi` toggles each chip; `single` behaves like a radio group (click again to clear). */
  mode?: 'multi' | 'single';
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * ChipToggleGroup Component
 *
 * Row of pill chips (bug-report chip styling) for quick tags or a single
 * choice. Used by the study Moment panel and the design-intent card.
 *
 * Usage:
 * ```tsx
 * <ChipToggleGroup options={TAGS} selected={tags} onChange={setTags} ariaLabel="Tags" />
 * ```
 */
export function ChipToggleGroup({
  options,
  selected,
  onChange,
  mode = 'multi',
  ariaLabel,
  disabled = false,
}: ChipToggleGroupProps) {
  const toggle = (value: string) => {
    const isOn = selected.includes(value);
    if (mode === 'single') onChange(isOn ? [] : [value]);
    else onChange(isOn ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="bug-report__chips" role={mode === 'single' ? 'radiogroup' : 'group'} aria-label={ariaLabel}>
      {options.map((option) => {
        const isOn = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={isOn}
            data-active={isOn}
            className="bug-report__chip"
            onClick={() => toggle(option)}
            disabled={disabled}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

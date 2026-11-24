'use client';

export interface CardChipGroupProps {
  /** Chip labels (also used as values). */
  options: readonly string[];
  /** Selected values. */
  selected: readonly string[];
  /** Called with the new selection. */
  onChange: (selected: string[]) => void;
  /** `multi` toggles each chip; `single` is a radio group (clicking the active chip keeps it). */
  mode?: 'multi' | 'single';
  ariaLabel: string;
  /** Per-option tooltip. */
  titles?: Readonly<Record<string, string>>;
  /** Generated (blue) sound card: white-on-blue tones instead of the card greys. */
  onBlueBackground?: boolean;
  disabled?: boolean;
}

function chipStyle(active: boolean, onBlue: boolean): React.CSSProperties {
  if (onBlue) {
    return {
      color: active ? 'var(--color-on-blue)' : 'var(--color-on-blue-muted)',
      borderColor: active ? 'var(--color-on-blue)' : 'var(--color-on-blue-faint)',
      backgroundColor: active ? 'var(--color-on-blue-faint)' : 'transparent',
    };
  }
  return {
    color: active ? 'var(--color-blue-text)' : 'var(--color-secondary-hover)',
    borderColor: active ? 'var(--color-primary)' : 'var(--color-secondary-light)',
    backgroundColor: active ? 'var(--color-primary-lighter)' : 'var(--color-secondary-lighter)',
  };
}

/**
 * CardChipGroup Component
 *
 * Compact chips sized and coloured like the other sound-card controls (10 px
 * text, card greys, or white-on-blue on a generated card). Use it inside cards
 * instead of ChipToggleGroup, whose larger bug-report chips belong to panels.
 *
 * Usage:
 * ```tsx
 * <CardChipGroup options={['Off', 'Subtle']} selected={['Subtle']} mode="single"
 *   onChange={([v]) => setMode(v)} ariaLabel="Variation" onBlueBackground />
 * ```
 */
export function CardChipGroup({
  options,
  selected,
  onChange,
  mode = 'multi',
  ariaLabel,
  titles,
  onBlueBackground = false,
  disabled = false,
}: CardChipGroupProps) {
  const toggle = (value: string) => {
    const isOn = selected.includes(value);
    if (mode === 'single') {
      if (!isOn) onChange([value]);
      return;
    }
    onChange(isOn ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="flex flex-wrap gap-1" role={mode === 'single' ? 'radiogroup' : 'group'} aria-label={ariaLabel}>
      {options.map((option) => {
        const isOn = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={mode === 'single' ? 'radio' : 'checkbox'}
            aria-checked={isOn}
            title={titles?.[option]}
            className="px-1.5 py-0.5 text-[10px] leading-tight rounded border transition-colors disabled:opacity-50"
            style={chipStyle(isOn, onBlueBackground)}
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

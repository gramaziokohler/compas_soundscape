'use client';

export type OptionTone = 'primary' | 'warning';

export interface OptionToggleItem<T extends string> {
  value: T;
  label: string;
  title?: string;
  /** Active tint — 'warning' is used for viewer-drawing options. Defaults to 'primary'. */
  tone?: OptionTone;
  disabled?: boolean;
}

interface OptionToggleProps<T extends string> {
  options: OptionToggleItem<T>[];
  /** Currently active option. */
  value: T;
  onChange: (value: T) => void;
}

const optionStyle = (active: boolean, tone: OptionTone, disabled: boolean) => ({
  backgroundColor: active
    ? tone === 'warning'
      ? 'var(--color-warning-light)'
      : 'var(--color-primary-lighter)'
    : 'var(--color-secondary-lighter)',
  borderColor: active
    ? tone === 'warning'
      ? 'var(--color-warning)'
      : 'var(--color-primary)'
    : 'var(--color-secondary-light)',
  borderWidth: '1px',
  borderStyle: 'solid' as const,
  color: active
    ? tone === 'warning'
      ? 'var(--color-warning)'
      : 'var(--color-blue-text)'
    : 'var(--color-secondary-hover)',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

/**
 * OptionToggle Component
 *
 * Row of equal-width, mutually exclusive option buttons with a tinted active
 * state (sound placement on text cards, grid-listener boundary mode).
 *
 * Usage:
 * ```tsx
 * <OptionToggle
 *   value={mode}
 *   onChange={setMode}
 *   options={[
 *     { value: 'objects', label: 'Select objects' },
 *     { value: 'area', label: 'Draw area', tone: 'warning' },
 *   ]}
 * />
 * ```
 */
export function OptionToggle<T extends string>({ options, value, onChange }: OptionToggleProps<T>) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => !option.disabled && onChange(option.value)}
          disabled={option.disabled}
          className="flex-1 px-2 py-1.5 text-xs rounded transition-colors"
          style={optionStyle(value === option.value, option.tone ?? 'primary', !!option.disabled)}
          title={option.title}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

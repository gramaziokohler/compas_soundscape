'use client';

/**
 * VariantsBar Component
 *
 * Reusable letter-square selector bar (A/B/C …) for sound card variants.
 * Used in two states:
 *   - Pre-generation (TTS): each square is a speech line — click to set the
 *     active prompt, delete to remove a line, "+" to add a line.
 *   - Post-generation (TTS + text-to-audio): each square is a generated audio
 *     variant — click to switch the active variant, delete to remove it,
 *     "+" to trigger regeneration (text-to-audio only).
 *
 * Canonical styling is the TTS speech-line squares (TextToSpeechMode).
 *
 * **Usage:**
 * ```tsx
 * <VariantsBar
 *   items={[{ key: 'line-0', title: 'Hello' }, { key: 'line-1', title: 'World' }]}
 *   selectedIndex={0}
 *   onSelect={(i) => ...}
 *   onDelete={(i) => ...}
 *   onAdd={() => ...}
 *   isRegenerating={false}
 *   pendingIndex={2}
 * />
 * ```
 */

export interface VariantsBarItem {
  /** Stable React key for the square. */
  key: string;
  /** Tooltip text (speech-line text for TTS, letter for generated variants). */
  title?: string;
}

export interface VariantsBarProps {
  items: VariantsBarItem[];
  /** Index of the currently selected square (undefined = none). */
  selectedIndex?: number;
  /** Called when a square is clicked. */
  onSelect?: (index: number) => void;
  /** Called when the delete badge is clicked (only shown when items.length > 1). */
  onDelete?: (index: number) => void;
  /** Called when the "+" button is clicked (rendered even when items is empty). */
  onAdd?: () => void;
  /** When true, renders a pending spinner square at pendingIndex. */
  isRegenerating?: boolean;
  /** Index of the variant currently being generated. */
  pendingIndex?: number;
}

/** Spinner icon shown on the pending square while regenerating. */
function SpinnerIcon() {
  return (
    <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

export function VariantsBar({
  items,
  selectedIndex,
  onSelect,
  onDelete,
  onAdd,
  isRegenerating = false,
  pendingIndex,
}: VariantsBarProps) {
  const letterFor = (idx: number) => String.fromCharCode(65 + idx);

  return (
    <div
      className="flex gap-1 overflow-x-auto flex-shrink-0 items-center"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}
    >
      {items.map((item, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <button
            key={item.key}
            onClick={() => onSelect?.(idx)}
            title={item.title ?? letterFor(idx)}
            className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 relative group ${
              isSelected ? 'text-white' : 'bg-secondary text-secondary-light'
            }`}
            style={isSelected ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
          >
            {letterFor(idx)}
            {items.length > 1 && onDelete && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(idx);
                }}
                title="Delete variant"
                className="absolute -top-1 -right-1 w-3 h-3 text-[8px] rounded-full bg-error text-white hidden group-hover:flex items-center justify-center leading-none"
              >
                ×
              </span>
            )}
          </button>
        );
      })}

      {isRegenerating && pendingIndex !== undefined && (
        <button
          key="pending"
          onClick={() => onSelect?.(pendingIndex)}
          title={letterFor(pendingIndex)}
          className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 flex items-center justify-center ${
            pendingIndex === selectedIndex ? 'text-white' : 'bg-secondary text-secondary-light'
          }`}
          style={pendingIndex === selectedIndex ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
        >
          {pendingIndex === selectedIndex ? (
            <SpinnerIcon />
          ) : (
            <span className="text-[8px]">{letterFor(pendingIndex)}</span>
          )}
        </button>
      )}

      {onAdd && (
        <button
          key="add"
          onClick={onAdd}
          title="Add variant"
          className="w-5 h-5 text-[10px] rounded border border-dashed border-secondary-light text-secondary-hover hover:text-foreground hover:border-foreground transition-colors flex-shrink-0 flex items-center justify-center"
        >
          +
        </button>
      )}
    </div>
  );
}

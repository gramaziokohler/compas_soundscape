'use client';

import { useState, type KeyboardEvent } from 'react';

export interface EditableTextChipProps {
  /** Current value shown on the chip. */
  value: string;
  /** Placeholder of the text input. */
  placeholder?: string;
  title: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * EditableTextChip Component
 *
 * A `bubble-chip` showing a free-text value; a click turns it into a text input.
 * Enter / blur commits a non-empty value, Escape cancels.
 *
 * Usage:
 * ```tsx
 * <EditableTextChip value={lang} title="Speech language" onChange={setLang} />
 * ```
 */
export function EditableTextChip({ value, placeholder, title, disabled, onChange }: EditableTextChipProps) {
  const [draft, setDraft] = useState<string | null>(null);

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
      onClick={() => setDraft(value)}
      disabled={disabled}
      title={`${title} — click to change`}
    >
      {value}
    </button>
  );
}

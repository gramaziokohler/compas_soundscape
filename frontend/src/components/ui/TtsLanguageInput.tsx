'use client';

import { useEffect, useRef, type CSSProperties, type Ref } from 'react';
import { TtsLanguageStatus } from '@/components/ui/TtsLanguageStatus';
import { useTtsLanguageResolver } from '@/hooks/useTtsLanguageResolver';
import { TTS_LANGUAGE, UI_BORDER_RADIUS } from '@/utils/constants';

export interface TtsLanguageInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Extra input style (e.g. the settings-search highlight ring). */
  style?: CSSProperties;
}

/**
 * TtsLanguageInput Component
 *
 * Free-text TTS language field (any language, dialect or BCP-47 tag) with
 * suggestions from the Gemini voice library. On Enter / blur the text is
 * checked against the backend; unknown dialects get a "create a custom voice?"
 * prompt (see TtsLanguageStatus).
 *
 * Usage:
 * ```tsx
 * <TtsLanguageInput value={ttsLanguage} onChange={setTtsLanguage} />
 * ```
 */
export function TtsLanguageInput({ value, onChange, placeholder, inputRef, style }: TtsLanguageInputProps) {
  const resolver = useTtsLanguageResolver();
  const lastResolved = useRef<string | null>(null);
  const { resolve, dialects, deleteCustomDialect } = resolver;
  const customDialects = Array.from(new Set(dialects?.custom_voices.map((v) => v.dialect_name) ?? []));

  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed === lastResolved.current) return;
    lastResolved.current = trimmed;
    void resolve(trimmed);
  };

  // Show the status of the persisted language once on mount.
  useEffect(() => {
    if (value.trim()) {
      lastResolved.current = value.trim();
      void resolve(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        list={TTS_LANGUAGE.DATALIST_ID}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-xs rounded bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors"
        style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px`, ...style }}
      />
      <datalist id={TTS_LANGUAGE.DATALIST_ID}>
        {customDialects.map((name) => (
          <option key={`custom-${name}`} value={name}>Custom voice</option>
        ))}
        {dialects?.dialects.map((d) => (
          <option key={`${d.language_code}-${d.accent}`} value={d.accent}>
            {d.language_code} · {d.voice_count} voices
          </option>
        ))}
      </datalist>
      <TtsLanguageStatus resolver={resolver} />
      {customDialects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-secondary-hover">
          <span>Your custom voices:</span>
          {customDialects.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-secondary-light text-foreground"
              style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            >
              <button type="button" className="hover:text-primary" onClick={() => { onChange(name); commit(name); }} title="Use this voice">
                {name}
              </button>
              <button
                type="button"
                className="text-secondary-hover hover:text-error"
                onClick={() => void deleteCustomDialect(name)}
                aria-label={`Delete custom voice ${name}`}
                title="Delete custom voice"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

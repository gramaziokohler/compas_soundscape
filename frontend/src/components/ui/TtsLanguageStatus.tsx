'use client';

import { useEffect, useState } from 'react';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import type { UseTtsLanguageResolverReturn } from '@/hooks/useTtsLanguageResolver';
import { TTS_LANGUAGE, UI_BORDER_RADIUS } from '@/utils/constants';

export interface TtsLanguageStatusProps {
  resolver: UseTtsLanguageResolverReturn;
}

const FIELD_CLASS =
  'w-full px-2 py-1 text-xs bg-secondary-lighter text-foreground border border-secondary-light focus:outline-none focus:border-primary transition-colors';
const BUTTON_CLASS =
  'px-2 py-0.5 text-[10px] rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const PRIMARY_BUTTON_CLASS = `${BUTTON_CLASS} border-primary text-primary hover:bg-primary-light`;
const SECONDARY_BUTTON_CLASS = `${BUTTON_CLASS} border-secondary-light text-secondary-hover hover:text-foreground`;

/**
 * TtsLanguageStatus Component
 *
 * Shows what a committed TTS language resolved to: regional library voices,
 * the user's custom voice, or — for a dialect without native voices — a prompt
 * offering to create a custom voice (editable description, optional base
 * language), with inline progress while the backend creates it.
 *
 * Usage:
 * ```tsx
 * const resolver = useTtsLanguageResolver();
 * <TtsLanguageStatus resolver={resolver} />
 * ```
 */
export function TtsLanguageStatus({ resolver }: TtsLanguageStatusProps) {
  const { match, resolving, creating, error, createCustomVoice, dismiss } = resolver;
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState('');
  const [baseLanguage, setBaseLanguage] = useState('');

  // New resolution → reset the creation form to the backend's defaults.
  useEffect(() => {
    setEditing(false);
    setDescription(match?.default_description ?? '');
    setBaseLanguage('');
  }, [match]);

  if (creating) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-secondary-hover" role="status">
        <Spinner size={10} />
        <span className="truncate">
          {creating.status || `Creating ${creating.dialect} voices…`} ({creating.progress}%)
        </span>
      </div>
    );
  }
  if (resolving) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-secondary-hover" role="status">
        <Spinner size={10} />
        <span>Checking available voices…</span>
      </div>
    );
  }
  if (error) return <Notice type="error" message={error} onDismiss={dismiss} />;
  if (!match) return null;

  if (match.kind === 'library') {
    if (match.uses_classic_voices) return null;
    return (
      <Notice
        type="success"
        variant="tag"
        message={`Regional voices · ${match.accent} (${match.voice_count})`}
      />
    );
  }
  if (match.kind === 'custom') {
    const genders = match.custom_voices.map((v) => v.gender).join(', ');
    return <Notice type="info" variant="tag" message={`Custom voice · ${match.label} (${genders})`} />;
  }

  // 'tag' (known language, no native voices) or 'unknown'.
  const needsBaseLanguage = !match.suggested_language_code;
  const question =
    match.kind === 'tag'
      ? `No native voices for “${match.query}”.`
      : `“${match.query}” is not a known language or dialect.`;

  return (
    <div
      className="flex flex-col gap-1 p-1.5 border border-secondary-light text-[10px] text-foreground"
      style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
    >
      <span>
        {question} Do you want to create a custom voice for this dialect? This might take a minute.
      </span>
      {editing && (
        <>
          <label className="text-secondary-hover">Voice description</label>
          <textarea
            className={FIELD_CLASS}
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            rows={TTS_LANGUAGE.DESCRIPTION_ROWS}
            maxLength={TTS_LANGUAGE.DESCRIPTION_MAX}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {needsBaseLanguage && (
            <>
              <label className="text-secondary-hover">Base language (e.g. Arabic, de, ar-MA)</label>
              <input
                type="text"
                className={FIELD_CLASS}
                style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
                value={baseLanguage}
                onChange={(e) => setBaseLanguage(e.target.value)}
              />
            </>
          )}
        </>
      )}
      <div className="flex items-center gap-1.5">
        {editing ? (
          <button
            type="button"
            className={PRIMARY_BUTTON_CLASS}
            disabled={needsBaseLanguage && !baseLanguage.trim()}
            onClick={() => createCustomVoice(match.query, description, baseLanguage || undefined)}
          >
            Create voices
          </button>
        ) : (
          <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => setEditing(true)}>
            Create custom voice…
          </button>
        )}
        <button
          type="button"
          className={SECONDARY_BUTTON_CLASS}
          onClick={dismiss}
          title="Keep the standard voices; the dialogue is still written in this language"
        >
          Use standard voices
        </button>
      </div>
    </div>
  );
}

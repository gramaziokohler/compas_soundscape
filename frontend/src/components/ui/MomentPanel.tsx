'use client';

import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { ChipToggleGroup } from '@/components/ui/ChipToggleGroup';
import { isModEnter } from '@/lib/shortcuts/keyboard-utils';
import { detectMac, formatShortcutKeys } from '@/utils/platform';
import { STUDY_LOG } from '@/utils/constants';
import type { UseMomentCaptureResult } from '@/hooks/useMomentCapture';

export interface MomentPanelProps extends UseMomentCaptureResult {
  /** Participant id for the external SUS form. */
  pseudonym: string | null;
}

/**
 * MomentPanel Component
 *
 * Body of the "Moment" tab in the shared feedback popover: what just happened
 * (note), quick tags, Save. The moment itself (screenshot + state + listening
 * context) was already captured when the button was clicked. Shows the
 * student's study id for the external SUS questionnaire.
 *
 * Usage:
 * ```tsx
 * const moment = useMomentCapture(close);
 * <MomentPanel {...moment} pseudonym={pseudonym} />
 * ```
 */
export function MomentPanel({ state, methods, pseudonym }: MomentPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMac = useMemo(() => detectMac(), []);
  const isSaving = state.status === 'saving';
  const canSave = (state.note.trim().length > 0 || state.tags.length > 0) && !isSaving;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isModEnter(e)) {
      e.preventDefault();
      void methods.submit();
    }
  };

  if (state.status === 'saved') {
    return (
      <div className="bug-report__sent" role="status">
        <Check size={18} />
        <span>Moment saved.</span>
      </div>
    );
  }

  return (
    <>
      <p className="bug-report__hint bug-report__note">
        {state.status === 'capturing' ? 'Capturing this moment…' : 'This moment is captured (screen + what you were hearing).'}
      </p>
      <textarea
        ref={textareaRef}
        className="bug-report__textarea"
        rows={STUDY_LOG.MOMENT_TEXTAREA_ROWS}
        maxLength={STUDY_LOG.MOMENT_MAX_CHARS}
        placeholder={'What just happened?\nWhat did you notice or realise?'}
        value={state.note}
        onChange={(e) => methods.setNote(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={isSaving}
      />
      <ChipToggleGroup
        options={STUDY_LOG.MOMENT_TAGS}
        selected={state.tags}
        onChange={methods.setTags}
        ariaLabel="Moment tags"
        disabled={isSaving}
      />
      {state.error && <p className="bug-report__error" role="alert">{state.error}</p>}
      <div className="study-intent__footer">
        <span className="bug-report__hint">
          {pseudonym ? <>Study ID <span className="study-id">{pseudonym}</span> · </> : null}
          {formatShortcutKeys('Ctrl', isMac)}+Enter to save
        </span>
        <button
          type="button"
          className="bar-btn bar-btn--primary bug-report__send"
          onClick={() => void methods.submit()}
          disabled={!canSave}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}

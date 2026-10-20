'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useStudyStore } from '@/store';
import { ChipToggleGroup } from '@/components/ui/ChipToggleGroup';
import { logStudyEvent } from '@/lib/study/studyLogger';
import { captureStudySnapshot } from '@/lib/study/snapshot';
import { isModEnter } from '@/lib/shortcuts/keyboard-utils';
import { detectMac, formatShortcutKeys } from '@/utils/platform';
import { STUDY_LOG } from '@/utils/constants';
import type { StudyIntentPrompt, StudyPromptedByListening } from '@/types/study';

const LISTENING_OPTIONS = ['Yes', 'Partly', 'No'] as const;
const LISTENING_VALUE: Record<string, StudyPromptedByListening> = { Yes: 'yes', Partly: 'partly', No: 'no' };

interface IntentDraft {
  key: string;
  answer: string;
  listening: string[];
  detail: string;
  tags: string[];
}

const promptKey = (p: StudyIntentPrompt) => `${p.kind}:${p.modelId ?? ''}:${p.fromVersionId ?? ''}`;

/** Prompts already logged as shown (the card remounts when loading ends). */
const _shownPrompts = new Set<number>();

function loadDraft(key: string): IntentDraft | null {
  try {
    const raw = localStorage.getItem(STUDY_LOG.INTENT_DRAFT_STORAGE_KEY);
    const draft = raw ? (JSON.parse(raw) as IntentDraft) : null;
    return draft && draft.key === key ? draft : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: IntentDraft | null): void {
  try {
    if (draft) localStorage.setItem(STUDY_LOG.INTENT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    else localStorage.removeItem(STUDY_LOG.INTENT_DRAFT_STORAGE_KEY);
  } catch {
    // storage unavailable — the draft just isn't kept
  }
}

/**
 * DesignIntentPrompt Component
 *
 * Research-study question shown inside the model loading overlay while a new
 * version uploads (or a new model imports). It is tied to the study store's
 * `pendingIntentPrompt`, not to the loading flag: if loading finishes first
 * the card stays until the student submits or skips, and the typed draft
 * survives a refresh (localStorage). Renders nothing when no prompt is pending.
 *
 * Usage:
 * ```tsx
 * <DesignIntentPrompt />
 * ```
 */
export function DesignIntentPrompt() {
  const prompt = useStudyStore((s) => s.pendingIntentPrompt);
  const clearIntentPrompt = useStudyStore((s) => s.clearIntentPrompt);
  const key = prompt ? promptKey(prompt) : '';
  const initial = useMemo(() => (key ? loadDraft(key) : null), [key]);
  const [answer, setAnswer] = useState('');
  const [listening, setListening] = useState<string[]>([]);
  const [detail, setDetail] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const isMac = useMemo(() => detectMac(), []);

  // New prompt → restore its draft (or start empty) and log that it was shown.
  useEffect(() => {
    if (!prompt) return;
    setAnswer(initial?.answer ?? '');
    setListening(initial?.listening ?? []);
    setDetail(initial?.detail ?? '');
    setTags(initial?.tags ?? []);
    if (!_shownPrompts.has(prompt.startedAt)) {
      _shownPrompts.add(prompt.startedAt);
      logStudyEvent('intent.shown', { kind: prompt.kind, from_version_id: prompt.fromVersionId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key) return;
    saveDraft({ key, answer, listening, detail, tags });
  }, [key, answer, listening, detail, tags]);

  if (!prompt) return null;
  const isVersion = prompt.kind === 'version';

  const finish = (submitted: boolean) => {
    const base = {
      kind: prompt.kind,
      from_version_id: prompt.fromVersionId,
      to_version_id: prompt.toVersionId,
      model_id: prompt.modelId,
      shown_ms: Date.now() - prompt.startedAt,
    };
    clearIntentPrompt();
    saveDraft(null);
    if (!submitted) {
      logStudyEvent('intent.skipped', base);
      return;
    }
    const payload = {
      ...base,
      answer: answer.trim(),
      prompted_by_listening: listening[0] ? LISTENING_VALUE[listening[0]] : null,
      listening_detail: detail.trim() || null,
      tags,
    };
    void captureStudySnapshot().then((snapshotHash) =>
      logStudyEvent('intent.note', { ...payload, snapshot_hash: snapshotHash }),
    );
  };

  const canSubmit = answer.trim().length > 0;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isModEnter(e) && canSubmit) {
      e.preventDefault();
      finish(true);
    }
  };
  const showDetail = listening[0] === 'Yes' || listening[0] === 'Partly';

  return (
    <div
      className="study-intent pointer-events-auto"
      role="dialog"
      aria-label="Design intent"
      style={{ width: STUDY_LOG.INTENT_CARD_WIDTH }}
    >
      <p className="study-intent__question">
        {isVersion
          ? 'While the new version loads: what did you change in this version, and why?'
          : 'While your model loads: what should this space sound like? What acoustic qualities are you aiming for?'}
      </p>
      <textarea
        className="bug-report__textarea"
        rows={STUDY_LOG.INTENT_TEXTAREA_ROWS}
        maxLength={STUDY_LOG.INTENT_MAX_CHARS}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />

      {isVersion && (
        <>
          <p className="study-intent__sub">Was this change prompted by something you heard?</p>
          <ChipToggleGroup
            options={LISTENING_OPTIONS}
            selected={listening}
            onChange={setListening}
            mode="single"
            ariaLabel="Prompted by listening"
          />
          {showDetail && (
            <input
              className="bug-report__textarea"
              placeholder="Which sound or listening spot?"
              maxLength={STUDY_LOG.INTENT_MAX_CHARS}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
          )}
          <p className="study-intent__sub">What kind of change?</p>
          <ChipToggleGroup options={STUDY_LOG.INTENT_TAGS} selected={tags} onChange={setTags} ariaLabel="Change type" />
        </>
      )}

      <div className="study-intent__footer">
        <span className="bug-report__hint">{formatShortcutKeys('Ctrl', isMac)}+Enter to submit · saved for the research study</span>
        <div className="flex gap-2">
          <button type="button" className="bar-btn" onClick={() => finish(false)}>
            Skip
          </button>
          <button
            type="button"
            className="bar-btn bar-btn--primary bug-report__send"
            onClick={() => finish(true)}
            disabled={!canSubmit}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

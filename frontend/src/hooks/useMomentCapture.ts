'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '@/services/api';
import { captureAppScreenshot } from '@/lib/diagnostics/captureScreenshot';
import { isStudyFeatureEnabled, logStudyEvent } from '@/lib/study/studyLogger';
import { captureStudySnapshot } from '@/lib/study/snapshot';
import { currentStudyListeningScope, readStudyListeningContext } from '@/lib/study/listeningTracker';
import { STUDY_LOG } from '@/utils/constants';

export type MomentStatus = 'idle' | 'capturing' | 'ready' | 'saving' | 'saved' | 'error';

export interface UseMomentCaptureResult {
  state: {
    status: MomentStatus;
    note: string;
    tags: string[];
    error: string | null;
  };
  methods: {
    /** Capture the moment NOW (on click): context, snapshot, screenshot. */
    begin: () => void;
    setNote: (note: string) => void;
    setTags: (tags: string[]) => void;
    submit: () => Promise<void>;
    /** Panel closed: log whether the moment was annotated. */
    end: () => void;
  };
}

/**
 * useMomentCapture — research-study "Moment" bookmark (shares the bug button).
 *
 * `begin()` runs the instant the student clicks: it logs `moment.open` with
 * the listening context (what is playing, from where, render mode), then
 * captures the screenshot (feature `moment_screenshot`) and the design-state
 * snapshot and creates the moment server-side — so the record reflects the
 * moment of the click, not the moment the note is finished. `submit()` adds
 * the note + tags (`moment.capture`).
 *
 * Usage:
 * ```tsx
 * const moment = useMomentCapture();
 * moment.methods.begin(); // when the panel opens
 * ```
 */
export function useMomentCapture(onDone?: () => void): UseMomentCaptureResult {
  const [status, setStatus] = useState<MomentStatus>('idle');
  const [note, setNoteState] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const momentIdRef = useRef<Promise<string | null> | null>(null);
  const eventIdRef = useRef<string | null>(null);
  const notedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const begin = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    setStatus('capturing');
    setNoteState('');
    setTags([]);
    setError(null);
    notedRef.current = false;
    const clickedAt = Date.now();
    const eventId = logStudyEvent('moment.open', {
      listening: currentStudyListeningScope(),
      context: readStudyListeningContext(),
    });
    eventIdRef.current = eventId;

    momentIdRef.current = (async () => {
      let screenshot: string | null = null;
      if (isStudyFeatureEnabled('moment_screenshot')) {
        try {
          screenshot = await captureAppScreenshot();
        } catch {
          screenshot = null;
        }
      }
      const snapshotHash = await captureStudySnapshot();
      try {
        return await apiService.createStudyMoment({
          event_id: eventId ?? '',
          screenshot,
          snapshot_hash: snapshotHash,
          ts_client: clickedAt,
        });
      } catch {
        return null;
      }
    })();
    void momentIdRef.current.then(() => setStatus((s) => (s === 'capturing' ? 'ready' : s)));
  }, []);

  const setNote = useCallback((next: string) => setNoteState(next.slice(0, STUDY_LOG.MOMENT_MAX_CHARS)), []);

  const submit = useCallback(async () => {
    const text = note.trim();
    if ((!text && tags.length === 0) || status === 'saving') return;
    setStatus('saving');
    setError(null);
    const momentId = await (momentIdRef.current ?? Promise.resolve(null));
    try {
      if (momentId) await apiService.noteStudyMoment(momentId, { note: text, tags });
      logStudyEvent('moment.capture', { moment_id: momentId, open_event_id: eventIdRef.current, note: text, tags });
      notedRef.current = true;
      setStatus('saved');
      closeTimerRef.current = setTimeout(() => onDone?.(), STUDY_LOG.MOMENT_SUCCESS_AUTOCLOSE_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note');
      setStatus('error');
    }
  }, [note, tags, status, onDone]);

  const end = useCallback(() => {
    if (!eventIdRef.current) return;
    if (!notedRef.current) logStudyEvent('moment.closed', { open_event_id: eventIdRef.current, noted: false });
    eventIdRef.current = null;
    setStatus('idle');
  }, []);

  return {
    state: { status, note, tags, error },
    methods: { begin, setNote, setTags, submit, end },
  };
}

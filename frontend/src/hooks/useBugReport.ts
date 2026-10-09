'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toJpeg } from 'html-to-image';
import { apiService } from '@/services/api';
import { installDiagnosticsCapture } from '@/lib/diagnostics/diagnosticsBuffer';
import { collectBugReportContext } from '@/lib/diagnostics/collectBugReportContext';
import { BUG_REPORT } from '@/utils/constants';
import type { BugReportCategory, BugReportPayload } from '@/types';

export type BugReportStatus = 'idle' | 'sending' | 'sent' | 'error';

interface BugReportDraft {
  description: string;
  category: BugReportCategory;
}

function loadDraft(): BugReportDraft | null {
  try {
    const raw = localStorage.getItem(BUG_REPORT.DRAFT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BugReportDraft) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: BugReportDraft | null): void {
  try {
    if (draft && draft.description) localStorage.setItem(BUG_REPORT.DRAFT_STORAGE_KEY, JSON.stringify(draft));
    else localStorage.removeItem(BUG_REPORT.DRAFT_STORAGE_KEY);
  } catch {
    // Storage unavailable (private window / blocked) — the draft just isn't kept.
  }
}

/** JPEG data URL of the whole app, minus elements marked with `BUG_REPORT.IGNORE_ATTR`. */
async function captureScreenshot(): Promise<string> {
  return toJpeg(document.body, {
    pixelRatio: BUG_REPORT.SCREENSHOT_PIXEL_RATIO,
    quality: BUG_REPORT.SCREENSHOT_JPEG_QUALITY,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    filter: (node) => !(node instanceof Element && node.hasAttribute(BUG_REPORT.IGNORE_ATTR)),
  });
}

export interface UseBugReportResult {
  state: {
    open: boolean;
    description: string;
    category: BugReportCategory;
    includeScreenshot: boolean;
    includeDiagnostics: boolean;
    status: BugReportStatus;
    reportId: string | null;
    error: string | null;
  };
  methods: {
    setOpen: (open: boolean) => void;
    setDescription: (description: string) => void;
    setCategory: (category: BugReportCategory) => void;
    setIncludeScreenshot: (include: boolean) => void;
    setIncludeDiagnostics: (include: boolean) => void;
    submit: () => Promise<void>;
  };
}

/**
 * useBugReport — state + submission for the in-app bug report popover.
 *
 * Starts the diagnostics capture on mount, keeps an unsent draft in
 * localStorage, and on submit captures an optional screenshot, collects the
 * diagnostics context, and posts it via `apiService.submitBugReport`.
 *
 * Usage:
 * ```tsx
 * const { state, methods } = useBugReport();
 * <BugReportPanel state={state} methods={methods} />
 * ```
 */
export function useBugReport(): UseBugReportResult {
  const [open, setOpenState] = useState(false);
  const [description, setDescriptionState] = useState('');
  const [category, setCategoryState] = useState<BugReportCategory>('bug');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [status, setStatus] = useState<BugReportStatus>('idle');
  const [reportId, setReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    installDiagnosticsCapture();
    const draft = loadDraft();
    if (draft) {
      setDescriptionState(draft.description);
      setCategoryState(draft.category);
    }
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const setOpen = useCallback((next: boolean) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenState(next);
    // Re-opening after a send (or a failure) starts from a clean status.
    setStatus((s) => (s === 'sending' ? s : 'idle'));
    setError(null);
  }, []);

  const setDescription = useCallback(
    (next: string) => {
      const clipped = next.slice(0, BUG_REPORT.MAX_DESCRIPTION_CHARS);
      setDescriptionState(clipped);
      saveDraft({ description: clipped, category });
    },
    [category],
  );

  const setCategory = useCallback(
    (next: BugReportCategory) => {
      setCategoryState(next);
      saveDraft({ description, category: next });
    },
    [description],
  );

  const submit = useCallback(async () => {
    const text = description.trim();
    if (!text || status === 'sending') return;
    setStatus('sending');
    setError(null);

    const context = collectBugReportContext(includeDiagnostics);
    let screenshot: string | undefined;
    if (includeScreenshot) {
      try {
        screenshot = await captureScreenshot();
      } catch (err) {
        context.screenshot_error = err instanceof Error ? err.message : String(err);
      }
    }

    const payload: BugReportPayload = { description: text, category, context, screenshot };
    try {
      const created = await apiService.submitBugReport(payload);
      setReportId(created.id);
      setStatus('sent');
      setDescriptionState('');
      setCategoryState('bug');
      saveDraft(null);
      closeTimerRef.current = setTimeout(() => setOpenState(false), BUG_REPORT.SUCCESS_AUTOCLOSE_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report');
      setStatus('error');
    }
  }, [description, status, includeDiagnostics, includeScreenshot, category]);

  return {
    state: { open, description, category, includeScreenshot, includeDiagnostics, status, reportId, error },
    methods: { setOpen, setDescription, setCategory, setIncludeScreenshot, setIncludeDiagnostics, submit },
  };
}

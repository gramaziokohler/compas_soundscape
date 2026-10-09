'use client';

import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/Checkbox';
import { summarizeDiagnostics } from '@/lib/diagnostics/collectBugReportContext';
import { BUG_REPORT, SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { UseBugReportResult } from '@/hooks/useBugReport';

interface CheckboxRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}

/** Checkbox with a clickable label and an optional muted hint line. */
function CheckboxRow({ checked, onChange, label, hint }: CheckboxRowProps) {
  return (
    <div className="bug-report__option">
      <Checkbox checked={checked} onChange={onChange} label={label} size={14} />
      <button type="button" className="bug-report__option-text" onClick={() => onChange(!checked)}>
        <span>{label}</span>
        {hint && <span className="bug-report__hint">{hint}</span>}
      </button>
    </div>
  );
}

export interface BugReportPanelProps extends UseBugReportResult {
  /** Popover placement relative to its trigger. */
  style?: CSSProperties;
}

/**
 * BugReportPanel Component
 *
 * Popover body of the bug report button: category chips, description,
 * screenshot / diagnostics toggles, and Send (Ctrl+Enter). Marked with
 * `BUG_REPORT.IGNORE_ATTR` so it never appears in its own screenshot.
 *
 * Usage:
 * ```tsx
 * const report = useBugReport();
 * {report.state.open && <BugReportPanel {...report} style={{ left: 0 }} />}
 * ```
 */
export function BugReportPanel({ state, methods, style }: BugReportPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isSending = state.status === 'sending';
  const canSend = state.description.trim().length > 0 && !isSending;
  // Snapshot when the panel opens — the counts describe what would be sent now.
  const summary = useMemo(() => summarizeDiagnostics(), []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void methods.submit();
    }
  };

  const diagnosticsHint = [
    `${summary.logs} console message${summary.logs === 1 ? '' : 's'}`,
    `${summary.failedRequests} failed request${summary.failedRequests === 1 ? '' : 's'}`,
    `${summary.notifications} notification${summary.notifications === 1 ? '' : 's'}`,
  ].join(' · ');

  return (
    <div
      className="bar-popover bug-report"
      role="dialog"
      aria-label="Report a problem"
      {...{ [BUG_REPORT.IGNORE_ATTR]: '' }}
      style={{
        position: 'absolute',
        bottom: `calc(100% + ${SCENE_BOTTOM_BAR.POPOVER_OFFSET}px)`,
        width: BUG_REPORT.POPOVER_WIDTH,
        zIndex: BUG_REPORT.Z_INDEX,
        ...style,
      }}
    >
      <div className="bug-report__header">
        <span className="bug-report__title">Report a problem</span>
        <button type="button" className="bar-btn" onClick={() => methods.setOpen(false)} aria-label="Close" title="Close">
          <X size={SCENE_BOTTOM_BAR.ICON_SIZE} />
        </button>
      </div>

      {state.status === 'sent' ? (
        <div className="bug-report__sent" role="status">
          <Check size={18} />
          <span>Thanks — report sent.</span>
          {state.reportId && <span className="bug-report__hint">Reference #{state.reportId.slice(0, 8)}</span>}
        </div>
      ) : (
        <>
          <div className="bug-report__chips" role="radiogroup" aria-label="Report type">
            {BUG_REPORT.CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={state.category === c.id}
                data-active={state.category === c.id}
                className="bug-report__chip"
                onClick={() => methods.setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <textarea
            ref={textareaRef}
            className="bug-report__textarea"
            rows={BUG_REPORT.TEXTAREA_ROWS}
            maxLength={BUG_REPORT.MAX_DESCRIPTION_CHARS}
            placeholder={'What happened? What did you expect?\nSteps to reproduce help a lot.'}
            value={state.description}
            onChange={(e) => methods.setDescription(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isSending}
          />
          <div className="bug-report__meta">
            <span>Ctrl+Enter to send</span>
            <span>{state.description.length}/{BUG_REPORT.MAX_DESCRIPTION_CHARS}</span>
          </div>

          <CheckboxRow
            checked={state.includeScreenshot}
            onChange={methods.setIncludeScreenshot}
            label="Attach screenshot"
            hint="Captured when you press Send"
          />
          <CheckboxRow
            checked={state.includeDiagnostics}
            onChange={methods.setIncludeDiagnostics}
            label="Include diagnostics"
            hint={diagnosticsHint}
          />
          <p className="bug-report__hint bug-report__note">
            Page link, browser, and interface mode are always included.
          </p>

          {state.error && <p className="bug-report__error" role="alert">{state.error}</p>}

          <div className="bug-report__footer">
            <button
              type="button"
              className="bar-btn bar-btn--primary bug-report__send"
              onClick={() => void methods.submit()}
              disabled={!canSend}
            >
              {isSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

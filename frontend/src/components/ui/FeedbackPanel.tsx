'use client';

import { type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { BugReportPanel } from '@/components/ui/BugReportPanel';
import { MomentPanel } from '@/components/ui/MomentPanel';
import { BUG_REPORT, SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { UseBugReportResult } from '@/hooks/useBugReport';
import type { UseMomentCaptureResult } from '@/hooks/useMomentCapture';

export type FeedbackTab = 'moment' | 'report';

export interface FeedbackPanelProps {
  tab: FeedbackTab;
  onTabChange: (tab: FeedbackTab) => void;
  onClose: () => void;
  moment: UseMomentCaptureResult;
  report: UseBugReportResult;
  pseudonym: string | null;
  /** Popover placement relative to its trigger. */
  style?: CSSProperties;
}

const TABS: { id: FeedbackTab; label: string }[] = [
  { id: 'moment', label: 'Moment' },
  { id: 'report', label: 'Report a problem' },
];

/**
 * FeedbackPanel Component
 *
 * Popover of the shared feedback button while the research study is on:
 * "Moment" (bookmark a creative moment, the default) and "Report a problem"
 * (the unchanged BugReportPanel). Marked with `BUG_REPORT.IGNORE_ATTR` so it
 * never appears in its own screenshots.
 *
 * Usage:
 * ```tsx
 * <FeedbackPanel tab={tab} onTabChange={setTab} onClose={close} moment={moment} report={report} pseudonym={id} />
 * ```
 */
export function FeedbackPanel({ tab, onTabChange, onClose, moment, report, pseudonym, style }: FeedbackPanelProps) {
  return (
    <div
      className="bar-popover study-panel-host"
      {...{ [BUG_REPORT.IGNORE_ATTR]: '' }}
      style={{
        position: 'absolute',
        bottom: `calc(100% + ${SCENE_BOTTOM_BAR.POPOVER_OFFSET}px)`,
        width: BUG_REPORT.POPOVER_WIDTH,
        zIndex: BUG_REPORT.Z_INDEX,
        ...style,
      }}
    >
      <div className="study-tabs" role="tablist" aria-label="Feedback">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className="study-tabs__tab"
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'moment' ? (
        <div className="bug-report" role="dialog" aria-label="Capture a moment">
          <div className="bug-report__header">
            <span className="bug-report__title">Capture a moment</span>
            <button type="button" className="bar-btn" onClick={onClose} aria-label="Close" title="Close">
              <X size={SCENE_BOTTOM_BAR.ICON_SIZE} />
            </button>
          </div>
          <MomentPanel {...moment} pseudonym={pseudonym} />
        </div>
      ) : (
        <BugReportPanel {...report} />
      )}
    </div>
  );
}

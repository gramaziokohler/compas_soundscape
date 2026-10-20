'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, Bug } from 'lucide-react';
import { BarButton } from '@/components/ui/BarButton';
import { BugReportPanel } from '@/components/ui/BugReportPanel';
import { FeedbackPanel, type FeedbackTab } from '@/components/ui/FeedbackPanel';
import { useBugReport } from '@/hooks/useBugReport';
import { useMomentCapture } from '@/hooks/useMomentCapture';
import { useStudyStore, useUIStore } from '@/store';
import { BUG_REPORT, SCENE_BOTTOM_BAR, SIMPLE_MODE, STUDY_LOG } from '@/utils/constants';

export interface BugReportButtonProps {
  /** `bar`: flat button inside the bottom bar (Detailed mode).
   *  `floating`: round button above the bar's left end (Simple mode). */
  variant: 'bar' | 'floating';
}

/**
 * BugReportButton Component
 *
 * Bug icon that opens the "Report a problem" popover upward. Closes on outside
 * click or Escape. The floating variant is portaled to `<body>` (the bar's
 * backdrop-filter would otherwise become its containing block) and rises with
 * the docked DAW.
 *
 * While the research study is on, the same button becomes the shared feedback
 * button: a bookmark icon whose popover opens on the "Moment" tab (the moment
 * is captured on click) with "Report a problem" as the second tab. The study
 * shortcut (STUDY_LOG.MOMENT_SHORTCUT_KEY) opens it on the Moment tab too.
 *
 * Usage:
 * ```tsx
 * {isExpert ? <BugReportButton variant="bar" /> : <BugReportButton variant="floating" />}
 * ```
 */
export function BugReportButton({ variant }: BugReportButtonProps) {
  const report = useBugReport();
  const { open } = report.state;
  const { setOpen } = report.methods;
  const studyEnabled = useStudyStore((s) => s.enabled);
  const pseudonym = useStudyStore((s) => s.pseudonym);
  const momentNonce = useStudyStore((s) => s.momentRequestNonce);
  const [tab, setTab] = useState<FeedbackTab>('moment');
  const closeRef = useRef<() => void>(() => {});
  const moment = useMomentCapture(() => closeRef.current());
  const { begin, end } = moment.methods;
  const rootRef = useRef<HTMLDivElement>(null);
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  // Portal target only exists after mount (keeps the server render empty).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Open / close; in study mode opening captures a moment right away. */
  const setPanelOpen = useCallback(
    (next: boolean, nextTab: FeedbackTab = 'moment') => {
      if (studyEnabled) {
        if (next && !open) {
          setTab(nextTab);
          if (nextTab === 'moment') begin();
        } else if (!next && open && tab === 'moment') {
          end();
        }
      }
      setOpen(next);
    },
    [studyEnabled, open, tab, begin, end, setOpen],
  );
  closeRef.current = () => setPanelOpen(false);

  const changeTab = useCallback(
    (next: FeedbackTab) => {
      if (next === tab) return;
      if (next === 'moment') begin();
      else end();
      setTab(next);
    },
    [tab, begin, end],
  );

  // Moment shortcut → open on the Moment tab (or switch to it).
  const lastNonceRef = useRef(momentNonce);
  useEffect(() => {
    if (momentNonce === lastNonceRef.current) return;
    lastNonceRef.current = momentNonce;
    if (!open) setPanelOpen(true, 'moment');
    else if (tab !== 'moment') changeTab('moment');
  }, [momentNonce, open, tab, setPanelOpen, changeTab]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setPanelOpen]);

  const idleTitle = studyEnabled
    ? `Capture a moment (${STUDY_LOG.MOMENT_SHORTCUT_LABEL}) / report a problem`
    : 'Report a problem';
  const title = open ? (studyEnabled ? 'Close' : 'Close bug report') : idleTitle;
  const panel = open && (studyEnabled ? (
    <FeedbackPanel
      tab={tab}
      onTabChange={changeTab}
      onClose={() => setPanelOpen(false)}
      moment={moment}
      report={report}
      pseudonym={pseudonym}
      style={{ left: 0 }}
    />
  ) : (
    <BugReportPanel {...report} style={{ left: 0 }} />
  ));
  const Icon = studyEnabled ? Bookmark : Bug;

  if (variant === 'bar') {
    return (
      <div ref={rootRef} className="relative flex items-center">
        <BarButton
          onClick={() => setPanelOpen(!open)}
          active={open}
          title={title}
          icon={<Icon size={SCENE_BOTTOM_BAR.ICON_SIZE} aria-hidden="true" />}
        />
        {panel}
      </div>
    );
  }

  if (!mounted) return null;
  return createPortal(
    <div
      ref={rootRef}
      className="fixed"
      style={{
        left: SIMPLE_MODE.EDGE_MARGIN,
        bottom: SCENE_BOTTOM_BAR.HEIGHT + SIMPLE_MODE.LISTENERS_BOTTOM_GAP + dockLift,
        zIndex: BUG_REPORT.Z_INDEX,
      }}
    >
      <button
        type="button"
        className="bug-report-fab backdrop-blur-lg backdrop-saturate-150"
        data-active={open}
        onClick={() => setPanelOpen(!open)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        style={{ width: BUG_REPORT.FLOATING_SIZE, height: BUG_REPORT.FLOATING_SIZE }}
      >
        <Icon size={SCENE_BOTTOM_BAR.ICON_SIZE + 2} aria-hidden="true" />
      </button>
      {panel}
    </div>,
    document.body,
  );
}

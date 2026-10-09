'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bug } from 'lucide-react';
import { BarButton } from '@/components/ui/BarButton';
import { BugReportPanel } from '@/components/ui/BugReportPanel';
import { useBugReport } from '@/hooks/useBugReport';
import { useUIStore } from '@/store';
import { BUG_REPORT, SCENE_BOTTOM_BAR, SIMPLE_MODE } from '@/utils/constants';

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
 * Usage:
 * ```tsx
 * {isExpert ? <BugReportButton variant="bar" /> : <BugReportButton variant="floating" />}
 * ```
 */
export function BugReportButton({ variant }: BugReportButtonProps) {
  const report = useBugReport();
  const { open } = report.state;
  const { setOpen } = report.methods;
  const rootRef = useRef<HTMLDivElement>(null);
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  // Portal target only exists after mount (keeps the server render empty).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const title = open ? 'Close bug report' : 'Report a problem';
  const panel = open && <BugReportPanel {...report} style={{ left: 0 }} />;

  if (variant === 'bar') {
    return (
      <div ref={rootRef} className="relative flex items-center">
        <BarButton
          onClick={() => setOpen(!open)}
          active={open}
          title={title}
          icon={<Bug size={SCENE_BOTTOM_BAR.ICON_SIZE} aria-hidden="true" />}
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
        onClick={() => setOpen(!open)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        style={{ width: BUG_REPORT.FLOATING_SIZE, height: BUG_REPORT.FLOATING_SIZE }}
      >
        <Bug size={SCENE_BOTTOM_BAR.ICON_SIZE + 2} aria-hidden="true" />
      </button>
      {panel}
    </div>,
    document.body,
  );
}

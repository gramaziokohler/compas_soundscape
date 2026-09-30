'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { DAW } from '@/utils/constants';
import type { SnapMode } from './daw-snap';

const clampPxPerSecond = (v: number) => Math.max(DAW.MIN_PX_PER_SECOND, Math.min(DAW.MAX_PX_PER_SECOND, v));
const clampTrackHeight = (v: number) => Math.max(DAW.MIN_TRACK_HEIGHT, Math.min(DAW.MAX_TRACK_HEIGHT, v));

/** Default track height lowered by N wheel-out notches — the compact first-open height. */
const FIT_TRACK_HEIGHT = clampTrackHeight(DAW.TRACK_HEIGHT * DAW.WHEEL_ZOOM_OUT ** DAW.FIT_TRACK_HEIGHT_NOTCHES);

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

interface UseDawViewArgs {
  durationMs: number;
  /** Dock insets (px) from the screen edges — the dock width is viewport − left − right. */
  leftOffset: number;
  rightOffset: number;
}

/**
 * View state for the DAW dock. Dock height survives refresh via uiStore.timelineDock;
 * snap mode is session-local.
 *
 * Zoom (px/sec + track height) is auto-fitted until the user touches it: horizontal fits
 * the whole timeline duration to the dock width, vertical uses a compact track height.
 * Any manual change (wheel / status-bar buttons) is stored in uiStore.timelineView, so
 * collapsing and re-expanding the dock restores the user's zoom instead of re-fitting.
 * The fit is derived from the viewport (not measured from the DOM), so it is exact on the
 * first render and unaffected by the dock's width transition.
 */
export function useDawView({ durationMs, leftOffset, rightOffset }: UseDawViewArgs) {
  const timelineDock = useUIStore((s) => s.timelineDock);
  const setTimelineDock = useUIStore((s) => s.setTimelineDock);
  const manualView = useUIStore((s) => s.timelineView);
  const setTimelineView = useUIStore((s) => s.setTimelineView);
  const viewportWidth = useViewportWidth();

  const dockHeight = timelineDock.height;
  // Older persisted payloads predate the flag — missing `autoFit` still means auto-fit.
  const dockAutoFit = timelineDock.autoFit !== false;

  const [snapMode, setSnapMode] = useState<SnapMode>('on');

  const durationSec = durationMs / 1000;
  const laneWidth = viewportWidth - leftOffset - rightOffset - DAW.HEAD_WIDTH - DAW.FIT_SCROLLBAR_ALLOWANCE;
  const fitPxPerSecond = viewportWidth <= 0 || durationSec <= 0
    ? DAW.FALLBACK_PX_PER_SECOND
    : clampPxPerSecond(laneWidth / durationSec);

  const pxPerSecond = manualView.pxPerSecond ?? fitPxPerSecond;
  const trackHeight = manualView.trackHeight ?? FIT_TRACK_HEIGHT;

  // Updater-style setters (wheel / ± buttons) read the *effective* value, so the first
  // manual step scales from the fitted zoom rather than from a stale default.
  const pxPerSecondRef = useRef(pxPerSecond); pxPerSecondRef.current = pxPerSecond;
  const trackHeightRef = useRef(trackHeight); trackHeightRef.current = trackHeight;

  const setPxPerSecond = useCallback((value: number | ((prev: number) => number)) => {
    const next = typeof value === 'function' ? value(pxPerSecondRef.current) : value;
    setTimelineView({ pxPerSecond: clampPxPerSecond(next) });
  }, [setTimelineView]);

  const setTrackHeight = useCallback((value: number | ((prev: number) => number)) => {
    const next = typeof value === 'function' ? value(trackHeightRef.current) : value;
    setTimelineView({ trackHeight: clampTrackHeight(next) });
  }, [setTimelineView]);

  const setDockHeight = useCallback((value: number | ((prev: number) => number)) => {
    setTimelineDock({
      height: Math.max(
        DAW.MIN_DOCK_HEIGHT,
        typeof value === 'function' ? value(dockHeight) : value,
      ),
    });
  }, [dockHeight, setTimelineDock]);

  const setDockAutoFit = useCallback((autoFit: boolean) => {
    setTimelineDock({ autoFit });
  }, [setTimelineDock]);

  return {
    pxPerSecond, setPxPerSecond, snapMode, setSnapMode,
    dockHeight, setDockHeight, dockAutoFit, setDockAutoFit,
    trackHeight, setTrackHeight,
  };
}

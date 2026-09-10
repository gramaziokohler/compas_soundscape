'use client';

import { useCallback, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { DAW } from '@/utils/constants';
import type { SnapMode } from './daw-snap';

/**
 * View state for the DAW dock: zoom (px/sec) and snap mode are session-local
 * (not persisted — low value vs. schema growth); dock height survives refresh
 * via uiStore.timelineDock.
 */
export function useDawView() {
  const timelineDock = useUIStore((s) => s.timelineDock);
  const setTimelineDock = useUIStore((s) => s.setTimelineDock);

  const dockHeight = timelineDock.height;
  // Older persisted payloads predate the flag — missing `autoFit` still means auto-fit.
  const dockAutoFit = timelineDock.autoFit !== false;

  const [pxPerSecond, setPxPerSecondRaw] = useState<number>(10);
  const [snapMode, setSnapMode] = useState<SnapMode>('smart');
  const [trackHeight, setTrackHeightRaw] = useState<number>(DAW.TRACK_HEIGHT);

  const setPxPerSecond = useCallback((value: number | ((prev: number) => number)) => {
    setPxPerSecondRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return Math.max(DAW.MIN_PX_PER_SECOND, Math.min(DAW.MAX_PX_PER_SECOND, next));
    });
  }, []);

  const setTrackHeight = useCallback((value: number | ((prev: number) => number)) => {
    setTrackHeightRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return Math.max(DAW.MIN_TRACK_HEIGHT, Math.min(DAW.MAX_TRACK_HEIGHT, next));
    });
  }, []);

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

'use client';

import { useState, useLayoutEffect, useEffect } from 'react';
import { DAWDock } from '@/components/audio/daw/DAWDock';
import { DAWMiniTransport } from '@/components/audio/daw/DAWMiniTransport';
import type { TimelinePlaybackState } from '@/types/audio';
import type { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';

const SIDEBAR_SELECTOR = '[data-sidebar="left"], [data-sidebar="right"]';

interface SceneTimelineProps {
  sounds: any[];
  playbackState: TimelinePlaybackState;
  /** When true, hide the DAW panel and show the compact bottom-center play/pause bar. */
  collapsed?: boolean;
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;
  leftSidebarContentWidth?: number;
  rightSidebarWidth?: number;
  onSeek: (timeMs: number) => void;
  onDownload?: (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  /** Reveals the full DAW timeline from the compact transport (same as "Show timeline"). */
  onToggleTimeline: () => void;
  isAnyPlaying?: boolean;
  onSelectSoundCard?: (promptIndex: number) => void;
  originalIRChannelCount?: number;
  sampleRate?: number;
  playbackSchedulerRef?: React.RefObject<PlaybackSchedulerService | null>;
}

export function SceneTimeline({
  sounds,
  playbackState,
  collapsed = false,
  isLeftSidebarExpanded,
  isRightSidebarExpanded,
  leftSidebarContentWidth,
  rightSidebarWidth,
  onSeek,
  onDownload,
  onPlay,
  onPause,
  onStop,
  onClose,
  onToggleTimeline,
  isAnyPlaying,
  onSelectSoundCard,
  originalIRChannelCount,
  sampleRate,
  playbackSchedulerRef,
}: SceneTimelineProps) {
  // Docked insets are measured from the actual fixed sidebars instead of being
  // derived from props/constants. Sidebar widths are clamped-fluid (viewport
  // dependent) and are only known for certain by their live layout, so the dock
  // reads the two `<aside data-sidebar=…>` boxes: `left` = right edge of the
  // left sidebar, `right` = distance from screen-right to the right sidebar's
  // left edge. 0 means that sidebar is collapsed/hidden, so the dock hugs the
  // screen edge. A ResizeObserver (width changes, open/close animations) plus a
  // MutationObserver (sidebar remount) keep it aligned through resizes and
  // resolutions.
  const [insets, setInsets] = useState<{ left: number; right: number }>({ left: 0, right: 0 });

  const measure = () => {
    const leftEl = document.querySelector<HTMLElement>('[data-sidebar="left"]');
    const rightEl = document.querySelector<HTMLElement>('[data-sidebar="right"]');
    const lr = leftEl ? leftEl.getBoundingClientRect() : null;
    const rr = rightEl ? rightEl.getBoundingClientRect() : null;
    const left = lr && lr.width > 0 ? Math.round(lr.right) : 0;
    const right = rr && rr.width > 0 ? Math.round(window.innerWidth - rr.left) : 0;
    setInsets((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  };

  useLayoutEffect(() => {
    if (collapsed) return;
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  useEffect(() => {
    if (collapsed) return;
    const ro = new ResizeObserver(() => measure());
    const mo = new MutationObserver(() => {
      ro.disconnect();
      document.querySelectorAll(SIDEBAR_SELECTOR).forEach((el) => ro.observe(el));
      measure();
    });
    document.querySelectorAll(SIDEBAR_SELECTOR).forEach((el) => ro.observe(el));
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  if (collapsed) {
    return (
      <DAWMiniTransport
        currentTime={playbackState.currentTime}
        duration={playbackState.duration}
        isPlaying={playbackState.isPlaying}
        onPlay={onPlay}
        onPause={onPause}
        onStop={onStop}
        onExpand={onToggleTimeline}
      />
    );
  }

  return (
    <DAWDock
      sounds={sounds}
      currentTime={playbackState.currentTime}
      isPlaying={playbackState.isPlaying}
      isAnyPlaying={isAnyPlaying}
      onSeek={onSeek}
      onDownload={onDownload}
      onPlay={onPlay}
      onPause={onPause}
      onStop={onStop}
      onClose={onClose}
      onSelectSoundCard={onSelectSoundCard}
      originalIRChannelCount={originalIRChannelCount}
      leftOffset={insets.left}
      rightOffset={insets.right}
      sampleRate={sampleRate}
      playbackSchedulerRef={playbackSchedulerRef}
    />
  );
}

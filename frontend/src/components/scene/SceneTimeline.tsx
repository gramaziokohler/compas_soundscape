'use client';

import React from 'react';
import { WaveSurferTimeline } from '@/components/audio/WaveSurferTimeline';
import { UI_RIGHT_SIDEBAR, UI_VERTICAL_TABS, TIMELINE_LAYOUT } from '@/utils/constants';
import type { TimelinePlaybackState } from '@/types/audio';

// Left sidebar content width when expanded
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;

interface SceneTimelineProps {
  sounds: any[];
  playbackState: TimelinePlaybackState;
  isLeftSidebarExpanded: boolean;
  isRightSidebarExpanded: boolean;
  leftSidebarContentWidth?: number;
  rightSidebarWidth?: number;
  onSeek: (timeMs: number) => void;
  onRefresh: () => void;
  onDownload: () => Promise<void>;
}

export function SceneTimeline({
  sounds,
  playbackState,
  isLeftSidebarExpanded,
  isRightSidebarExpanded,
  leftSidebarContentWidth,
  rightSidebarWidth,
  onSeek,
  onRefresh,
  onDownload,
}: SceneTimelineProps) {
  const effectiveLeftContent = leftSidebarContentWidth ?? LEFT_SIDEBAR_CONTENT_WIDTH;
  const effectiveRightWidth = rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH;
  const leftSidebarWidth = UI_VERTICAL_TABS.WIDTH + (isLeftSidebarExpanded ? effectiveLeftContent : 0);
  const rightSidebarWidthCalc = isRightSidebarExpanded ? effectiveRightWidth : RIGHT_SIDEBAR_COLLAPSED_WIDTH;
  const centerOffset = (leftSidebarWidth - rightSidebarWidthCalc) / 2;

  return (
    <div
      className="absolute pointer-events-auto z-10 transition-all duration-300"
      style={{
        bottom: `${TIMELINE_LAYOUT.BOTTOM_OFFSET_PX * 4}px`,
        left: `calc(50% + ${centerOffset}px)`,
        transform: 'translateX(-50%)',
        maxWidth: `min(calc(100% - ${leftSidebarWidth}px - ${rightSidebarWidthCalc}px - ${TIMELINE_LAYOUT.SIDEBAR_HORIZONTAL_OFFSET_PX}px), ${TIMELINE_LAYOUT.MAX_WIDTH_PX}px)`,
      }}
    >
      <WaveSurferTimeline
        sounds={sounds}
        currentTime={playbackState.currentTime}
        onSeek={onSeek}
        onRefresh={onRefresh}
        onDownload={onDownload}
      />
    </div>
  );
}

'use client';

import { DAWTimeline } from '@/components/audio/daw/DAWTimeline';
import type { TimelinePlaybackState } from '@/types/audio';

interface SceneTimelineProps {
  sounds: any[];
  playbackState: TimelinePlaybackState;
  // Kept for backward-compat but no longer used for positioning (panel is self-positioned)
  isLeftSidebarExpanded?: boolean;
  isRightSidebarExpanded?: boolean;
  leftSidebarContentWidth?: number;
  rightSidebarWidth?: number;
  onSeek: (timeMs: number) => void;
  onRefresh?: () => void;
  onDownload?: () => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  isAnyPlaying?: boolean;
  onSelectSoundCard?: (promptIndex: number) => void;
}

export function SceneTimeline({
  sounds,
  playbackState,
  onSeek,
  onRefresh,
  onDownload,
  onPlay,
  onPause,
  onStop,
  onClose,
  isAnyPlaying,
  onSelectSoundCard,
}: SceneTimelineProps) {
  return (
    <DAWTimeline
      sounds={sounds}
      currentTime={playbackState.currentTime}
      isPlaying={playbackState.isPlaying}
      isAnyPlaying={isAnyPlaying}
      onSeek={onSeek}
      onRefresh={onRefresh}
      onDownload={onDownload}
      onPlay={onPlay}
      onPause={onPause}
      onStop={onStop}
      onClose={onClose}
      onSelectSoundCard={onSelectSoundCard}
    />
  );
}

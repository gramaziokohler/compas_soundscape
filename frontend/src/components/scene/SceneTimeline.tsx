'use client';

import { DAWTimeline } from '@/components/audio/daw/DAWTimeline';
import { DAWMiniTransport } from '@/components/audio/daw/DAWMiniTransport';
import type { TimelinePlaybackState } from '@/types/audio';

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
  onRefresh?: () => void;
  onDownload?: (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  isAnyPlaying?: boolean;
  onSelectSoundCard?: (promptIndex: number) => void;
  originalIRChannelCount?: number;
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
  onRefresh,
  onDownload,
  onPlay,
  onPause,
  onStop,
  onClose,
  isAnyPlaying,
  onSelectSoundCard,
  originalIRChannelCount,
}: SceneTimelineProps) {
  if (collapsed) {
    return (
      <DAWMiniTransport
        currentTime={playbackState.currentTime}
        duration={playbackState.duration}
        isPlaying={playbackState.isPlaying}
        onPlay={onPlay}
        onPause={onPause}
        onStop={onStop}
      />
    );
  }

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
      originalIRChannelCount={originalIRChannelCount}
    />
  );
}

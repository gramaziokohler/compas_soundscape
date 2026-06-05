'use client';

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { DAWGroup } from './DAWGroup';
import { DAWTrack } from './DAWTrack';
import type { IterationContextMenuData } from './DAWIteration';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { WAVESURFER_TIMELINE } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';

/* ============================================================
 * Constants
 * ============================================================ */
const LABEL_WIDTH = 120; // px — label gutter
const PANEL_DEFAULT_WIDTH = 800;
const PANEL_DEFAULT_HEIGHT = 340;
const RULER_HEIGHT = 24; // px

/* ============================================================
 * Helper: format seconds → "M:SS"
 * ============================================================ */
function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ============================================================
 * Ruler sub-component (pure React, no WaveSurfer)
 * ============================================================ */
function DAWRuler({
  totalDurationSec,
  pxPerSecond,
  timeInterval,
  primaryLabelInterval,
  onSeekClick,
}: {
  totalDurationSec: number;
  pxPerSecond: number;
  timeInterval: number;
  primaryLabelInterval: number;
  onSeekClick: (timeMs: number) => void;
}) {
  const ticks: { x: number; label: string; isPrimary: boolean }[] = [];
  for (let t = 0; t <= totalDurationSec + 0.001; t += timeInterval) {
    const x = t * pxPerSecond;
    const isPrimary = Math.round(t) % primaryLabelInterval === 0;
    ticks.push({ x, label: formatTime(t), isPrimary });
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left - LABEL_WIDTH;
      if (clickX < 0) return;
      const timeSec = clickX / pxPerSecond;
      onSeekClick(timeSec * 1000);
    },
    [pxPerSecond, onSeekClick],
  );

  return (
    <div
      onClick={handleClick}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        display: 'flex',
        height: `${RULER_HEIGHT}px`,
        flexShrink: 0,
        backgroundColor: 'var(--background)',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        cursor: 'crosshair',
        userSelect: 'none',
        minWidth: LABEL_WIDTH + totalDurationSec * pxPerSecond,
      }}
    >
      {/* Label gutter placeholder (so ruler ticks align with track content) */}
      <div
        style={{
          width: `${LABEL_WIDTH}px`,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.1)',
          backgroundColor: 'var(--background)',
        }}
      />

      {/* Tick marks */}
      <div style={{ position: 'relative', flex: 1 }}>
        {ticks.map(({ x, label, isPrimary }) => (
          <div
            key={x}
            style={{ position: 'absolute', left: `${x}px`, top: 0, height: '100%' }}
          >
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '1px',
                height: isPrimary ? '100%' : '40%',
                backgroundColor: isPrimary
                  ? 'var(--color-secondary-hover)'
                  : 'var(--color-secondary-light)',
              }}
            />
            {isPrimary && (
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  left: '3px',
                  fontSize: '9px',
                  color: 'var(--color-secondary-hover)',
                  fontFamily: 'monospace',
                  lineHeight: 1,
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * Transport button component
 * ============================================================ */
function TransportBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: active ? '1.5px solid var(--color-primary)' : '1.5px solid rgba(255,255,255,0.2)',
        backgroundColor: active ? 'var(--color-primary)' : 'rgba(255,255,255,0.07)',
        color: active ? '#fff' : 'var(--foreground)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0,
        transition: 'background-color 0.1s, border-color 0.1s',
      }}
    >
      {children}
    </button>
  );
}

/* ============================================================
 * Props
 * ============================================================ */
export interface DAWTimelineProps {
  sounds: TimelineSound[];
  /** Current playback time in milliseconds */
  currentTime: number;
  isPlaying: boolean;
  isAnyPlaying?: boolean;
  onSeek: (timeMs: number) => void;
  onRefresh?: () => void;
  onDownload?: () => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  onSelectSoundCard?: (promptIndex: number) => void;
}

/* ============================================================
 * Main component
 * ============================================================ */
export function DAWTimeline({
  sounds,
  currentTime,
  isPlaying,
  onSeek,
  onRefresh,
  onDownload,
  onPlay,
  onPause,
  onStop,
  onClose,
  onSelectSoundCard,
}: DAWTimelineProps) {
  /* ---- Store subscriptions ---- */
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound = useAudioControlsStore((s) => s.soloedSound);
  const soundTimestamps = useAudioControlsStore((s) => s.soundTimestamps);
  const handleTimestampsChange = useAudioControlsStore((s) => s.handleTimestampsChange);
  const handleRemoveTimestamp = useAudioControlsStore((s) => s.handleRemoveTimestamp);
  const handleMute = useAudioControlsStore((s) => s.handleMute);
  const handleSolo = useAudioControlsStore((s) => s.handleSolo);

  /* ---- Panel drag/resize state ---- */
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [panelSize, setPanelSize] = useState({
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_DEFAULT_HEIGHT,
  });

  // Initialise position on first render (centered at bottom of viewport)
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (panelPos !== null) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPanelPos({
      x: Math.max(0, (vw - PANEL_DEFAULT_WIDTH) / 2),
      y: Math.max(0, vh - PANEL_DEFAULT_HEIGHT - 20),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Panel drag ---- */
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const pos = panelPos ?? { x: 0, y: 0 };
      dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: pos.x, panelY: pos.y };

      const handleMove = (ev: PointerEvent) => {
        if (!dragStartRef.current) return;
        setPanelPos({
          x: dragStartRef.current.panelX + (ev.clientX - dragStartRef.current.mouseX),
          y: dragStartRef.current.panelY + (ev.clientY - dragStartRef.current.mouseY),
        });
      };
      const handleUp = () => {
        dragStartRef.current = null;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [panelPos],
  );

  /* ---- Resize handle ---- */
  const resizeStartRef = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(null);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        w: panelSize.width,
        h: panelSize.height,
      };
      const handleMove = (ev: PointerEvent) => {
        if (!resizeStartRef.current) return;
        setPanelSize({
          width: Math.max(500, resizeStartRef.current.w + (ev.clientX - resizeStartRef.current.mouseX)),
          height: Math.max(200, resizeStartRef.current.h + (ev.clientY - resizeStartRef.current.mouseY)),
        });
      };
      const handleUp = () => {
        resizeStartRef.current = null;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [panelSize],
  );

  /* ---- Zoom (Ctrl+wheel) ---- */
  const [pxPerSecond, setPxPerSecond] = useState<number>(WAVESURFER_TIMELINE.PIXELS_PER_SECOND);

  /* ---- Context menu ---- */
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; soundId: string; iterationIndex: number;
  } | null>(null);

  const handleIterationContextMenu = useCallback(
    (soundId: string, data: IterationContextMenuData) => {
      setContextMenu({ x: data.x, y: data.y, soundId, iterationIndex: data.iterationIndex });
    },
    [],
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [contextMenu]);

  /* ---- Derived dimensions ---- */
  const totalDurationSec = timelineDurationMs / 1000;
  const contentWidth = totalDurationSec * pxPerSecond;

  /* ---- Cursor position ---- */
  const cursorLeft = LABEL_WIDTH + (currentTime / 1000) * pxPerSecond;

  /* ---- Scroll to keep cursor visible ---- */
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isPlaying) return;
    const cursorPx = (currentTime / 1000) * pxPerSecond;
    const { scrollLeft, clientWidth } = container;
    const viewEnd = scrollLeft + clientWidth - LABEL_WIDTH;
    if (cursorPx > viewEnd - 20) {
      container.scrollLeft = cursorPx - (clientWidth - LABEL_WIDTH) / 2;
    }
  }, [currentTime, isPlaying, pxPerSecond]);

  /* ---- Ctrl+wheel zoom on scroll container ---- */
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPxPerSecond((prev) =>
        Math.max(1, Math.min(80, prev * (e.deltaY < 0 ? 1.15 : 0.87))),
      );
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  /* ---- Group sounds by soundGroup ---- */
  const GROUP_ORDER = ['background', 'sound_event', 'speech'];
  const GROUP_LABELS: Record<string, string> = {
    background: 'Background',
    sound_event: 'Sound Events',
    speech: 'Speech',
    sounds: 'Sounds',
  };

  const grouped = useMemo(() => {
    const groups: Record<string, TimelineSound[]> = {};
    for (const s of sounds) {
      const g = s.soundGroup ?? 'sounds';
      if (!groups[g]) groups[g] = [];
      groups[g].push(s);
    }
    return groups;
  }, [sounds]);

  const groupKeys = useMemo(() => {
    const keys = Object.keys(grouped);
    return keys.sort((a, b) => {
      const ai = GROUP_ORDER.indexOf(a);
      const bi = GROUP_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [grouped]);

  /* ---- Drag end handler (timestamps mode) ---- */
  const handleDragEnd = useCallback(
    (soundId: string, iterationIndex: number, newStartMs: number) => {
      const sound = sounds.find((s) => s.id === soundId);
      if (!sound) return;
      const currentTsSec = soundTimestamps[soundId] ?? [];
      const newTsSec = [...currentTsSec];
      newTsSec[iterationIndex] = parseFloat((newStartMs / 1000).toFixed(3));
      handleTimestampsChange(soundId, newTsSec);
    },
    [sounds, soundTimestamps, handleTimestampsChange],
  );

  /* ---- Delete iteration handler ---- */
  const handleDeleteIteration = useCallback(
    (soundId: string, iterationIndex: number) => {
      handleRemoveTimestamp(soundId, iterationIndex);
    },
    [handleRemoveTimestamp],
  );

  /* ---- Duplicate iteration (Ctrl+drag) ---- */
  const handleDuplicate = useCallback(
    (soundId: string, newStartMs: number) => {
      const current = soundTimestamps[soundId] ?? [];
      const newTs = [...current, parseFloat((newStartMs / 1000).toFixed(3))].sort((a, b) => a - b);
      handleTimestampsChange(soundId, newTs);
    },
    [soundTimestamps, handleTimestampsChange],
  );

  /* ---- Download handler ---- */
  const [isDownloading, setIsDownloading] = useState(false);
  const handleDownload = useCallback(async () => {
    if (!onDownload) return;
    setIsDownloading(true);
    try { await onDownload(); } finally { setIsDownloading(false); }
  }, [onDownload]);

  if (panelPos === null) return null; // Wait for position init

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: `${panelPos.x}px`,
        top: `${panelPos.y}px`,
        width: `${panelSize.width}px`,
        height: `${panelSize.height}px`,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--background)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '8px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        zIndex: 200,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* ============================================
          Header
          ============================================ */}
      <div
        onPointerDown={handleHeaderPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '38px',
          paddingLeft: '12px',
          paddingRight: '8px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          backgroundColor: 'rgba(255,255,255,0.04)',
          cursor: 'grab',
          flexShrink: 0,
          gap: '8px',
        }}
      >
        {/* Title */}
        <span
          style={{
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--foreground)',
            opacity: 0.7,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          DAW Timeline
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Transport controls (centered) */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>

          {/* Play / Pause */}
          {isPlaying ? (
            <TransportBtn onClick={onPause} title="Pause" active>
              <svg width="10" height="12" viewBox="0 0 10 12">
                <rect x="0.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
                <rect x="6.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
              </svg>
            </TransportBtn>
          ) : (
            <TransportBtn onClick={onPlay} title="Play">
              <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: 'translateX(1px)' }}>
                <path d="M1 1 L9 6 L1 11 Z" fill="currentColor" />
              </svg>
            </TransportBtn>
          )}

          {/* Stop */}
          <TransportBtn onClick={onStop} title="Stop">
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          </TransportBtn>

        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Right controls */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexShrink: 0 }}>
          {/* Current time display */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: 'rgba(255,255,255,0.5)',
              minWidth: '40px',
              textAlign: 'right',
            }}
          >
            {formatTime(currentTime / 1000)}
          </span>

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh timeline"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}

          {/* Download */}
          {onDownload && (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              title="Download timeline mix"
              style={{
                background: 'transparent',
                border: 'none',
                color: isDownloading ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)',
                cursor: isDownloading ? 'wait' : 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            title="Close timeline"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              fontSize: '16px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* ============================================
          Scrollable body (ruler + tracks)
          ============================================ */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
          backgroundColor: 'var(--background)',
        }}
      >
        {/* Inner container — wide enough for timeline content */}
        <div
          style={{
            minWidth: LABEL_WIDTH + contentWidth,
            position: 'relative',
          }}
        >
          {/* Ruler */}
          <DAWRuler
            totalDurationSec={totalDurationSec}
            pxPerSecond={pxPerSecond}
            timeInterval={WAVESURFER_TIMELINE.TIME_INTERVAL}
            primaryLabelInterval={WAVESURFER_TIMELINE.PRIMARY_LABEL_INTERVAL}
            onSeekClick={onSeek}
          />

          {/* Tracks (always grouped) */}
          {groupKeys.map((g) => (
            <DAWGroup key={g} groupName={GROUP_LABELS[g] ?? g} soundCount={grouped[g].length}>
              {grouped[g].map((sound) => (
                <DAWTrack
                  key={sound.id}
                  sound={sound}
                  pxPerSecond={pxPerSecond}
                  timelineDurationMs={timelineDurationMs}
                  isMuted={mutedSounds.has(sound.id)}
                  isSoloed={soloedSound === sound.id}
                  onMute={() => handleMute(sound.id)}
                  onSolo={() => handleSolo(sound.id)}
                  onDeleteIteration={(idx) => handleDeleteIteration(sound.id, idx)}
                  onDragEnd={(idx, newStartMs) => handleDragEnd(sound.id, idx, newStartMs)}
                  onDuplicate={(newStartMs) => handleDuplicate(sound.id, newStartMs)}
                  onSelectSoundCard={
                    onSelectSoundCard && sound.promptIndex !== undefined
                      ? () => onSelectSoundCard(sound.promptIndex!)
                      : undefined
                  }
                  onIterationContextMenu={(data) => handleIterationContextMenu(sound.id, data)}
                />
              ))}
            </DAWGroup>
          ))}

          {/* Playback cursor */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${cursorLeft}px`,
              width: '2px',
              bottom: 0,
              backgroundColor: 'var(--color-primary)',
              opacity: 0.85,
              zIndex: 50,
              pointerEvents: 'none',
              boxShadow: '0 0 4px var(--color-primary)',
            }}
          />
        </div>
      </div>

      {/* ============================================
          Iteration context menu
          ============================================ */}
      {contextMenu && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 9999,
            backgroundColor: 'var(--background)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            minWidth: '140px',
            padding: '4px 0',
            fontSize: '11px',
          }}
        >
          {/* Linked entities */}
          <div
            style={{
              padding: '6px 12px',
              cursor: 'default',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--foreground)',
              opacity: 0.8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <span>Linked entities</span>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          {/* Variants */}
          <div
            style={{
              padding: '6px 12px',
              cursor: 'default',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: 'var(--foreground)',
              opacity: 0.8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <span>Variants</span>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        </div>
      )}

      {/* ============================================
          Resize handle (bottom-right corner)
          ============================================ */}
      <div
        onPointerDown={handleResizePointerDown}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '16px',
          height: '16px',
          cursor: 'nwse-resize',
          opacity: 0.4,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: '3px',
        }}
        title="Resize panel"
      >
        <svg width="8" height="8" viewBox="0 0 8 8">
          <path d="M7 1 L1 7 M7 4 L4 7" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

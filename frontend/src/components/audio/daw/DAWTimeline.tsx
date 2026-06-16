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
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useSpeckleStore } from '@/store/speckleStore';
import { useUIStore } from '@/store/uiStore';
import { WAVESURFER_TIMELINE } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';

/* ============================================================
 * Constants
 * ============================================================ */
const LABEL_WIDTH = 120; // px — label gutter
const PANEL_DEFAULT_WIDTH = 800;
const PANEL_MIN_HEIGHT = 200;
const RULER_HEIGHT = 24; // px
const GROUP_HEADER_HEIGHT = 22;

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
        {ticks.map(({ x, label, isPrimary }, i) => {
          const isLast = i === ticks.length - 1;
          return (
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
                    ...(isLast
                      ? { right: '0px', textAlign: 'right' as const }
                      : { left: '3px' }),
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
          );
        })}
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
  onDownload?: (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  /** Current IR channel count (0 if no IR active). Greys out incompatible download formats. */
  originalIRChannelCount?: number;
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
  originalIRChannelCount,
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

  const triggerZoomToSoundCard = useUIStore((s) => s.triggerZoomToSoundCard);

  /* ---- Dynamic minimum panel height based on track count ---- */
  const TRACK_HEIGHT_TOTAL = WAVESURFER_TIMELINE.TRACK_HEIGHT + WAVESURFER_TIMELINE.TRACK_SPACING;

  const minPanelHeight = useMemo(() => {
    const groups = new Set<string>();
    for (const s of sounds) {
      groups.add(s.soundGroup ?? 'sounds');
    }
    const groupCount = groups.size;
    const trackCount = sounds.length;
    const tracksContentHeight = groupCount * GROUP_HEADER_HEIGHT + trackCount * TRACK_HEIGHT_TOTAL;
    return Math.max(PANEL_MIN_HEIGHT, 38 + RULER_HEIGHT + tracksContentHeight + 20 + 8);
  }, [sounds]);

  /* ---- Panel drag/resize state ---- */
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [panelSize, setPanelSize] = useState({
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_MIN_HEIGHT,
  });

  // Initialise position on first render (centered at bottom of viewport)
  const panelRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  useEffect(() => {
    if (isInitialized.current) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const totalDurationSec = timelineDurationMs / 1000;
    const pxPerSec = WAVESURFER_TIMELINE.PIXELS_PER_SECOND;
    const contentBasedWidth = LABEL_WIDTH + totalDurationSec * pxPerSec + 2; // +2px for panel borders
    const panelWidth = Math.max(contentBasedWidth, PANEL_DEFAULT_WIDTH);
    setPanelPos({
      x: Math.max(0, vw/2 - panelWidth/2),
      y: Math.max(0, vh - minPanelHeight - 20),
    });
    setPanelSize({ width: panelWidth, height: minPanelHeight });
    isInitialized.current = true;
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
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    w: number;
    h: number;
  } | null>(null);

  const durationSecRef = useRef(0);

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
        const ref = resizeStartRef.current;
        if (!ref) return;
        const targetW = ref.w + (ev.clientX - ref.mouseX);
        const clampedW = Math.max(500, targetW);
        const curPps = pxPerSecondRef.current;
        const durSec = durationSecRef.current;
        const maxContentW = LABEL_WIDTH + durSec * curPps;
        if (clampedW > maxContentW && clampedW - LABEL_WIDTH > 0) {
          const newPps = Math.max(1, Math.min(200, (clampedW - LABEL_WIDTH) / durSec));
          pxPerSecondRef.current = newPps;
          setPxPerSecond(newPps);
          setPanelSize((prev) => ({
            width: clampedW,
            height: Math.max(100, ref.h + (ev.clientY - ref.mouseY)),
          }));
        } else {
          setPanelSize((prev) => ({
            width: Math.min(clampedW, maxContentW),
            height: Math.max(100, ref.h + (ev.clientY - ref.mouseY)),
          }));
        }
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
  const pxPerSecondRef = useRef(pxPerSecond);
  pxPerSecondRef.current = pxPerSecond;

  /* ---- Store: iteration links ---- */
  const iterationLinks = useAudioControlsStore((s) => s.iterationLinks);
  const setIterationLink = useAudioControlsStore((s) => s.setIterationLink);
  const clearIterationLink = useAudioControlsStore((s) => s.clearIterationLink);

  /* ---- Store: generated sounds (for variant submenu) ---- */
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);

  /* ---- Store: sound configs (to resolve entity positions) ---- */
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);

  /* ---- Store: object→sound links (for entity submenu) ---- */
  const objectSoundLinks = useSpeckleStore((s) => s.objectSoundLinks);

  /* ---- Context menu ---- */
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    soundId: string;
    iterationIndex: number;
    submenuOpen: 'variants' | 'entities' | null;
  } | null>(null);

  const handleIterationContextMenu = useCallback(
    (soundId: string, data: IterationContextMenuData) => {
      setContextMenu({
        x: data.x,
        y: data.y,
        soundId,
        iterationIndex: data.iterationIndex,
        submenuOpen: null,
      });
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
  durationSecRef.current = totalDurationSec;
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

  /* ---- Ctrl+wheel zoom ---- */
  // Registered on `document` (non-passive) so browsers can't intercept ctrl+wheel for
  // their own page-zoom before we do. We bail out if the event doesn't originate inside
  // our panel.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const panel = panelRef.current;
      if (!panel || !panel.contains(e.target as Node)) return;
      e.preventDefault();
      const container = scrollContainerRef.current;
      // Capture scroll state before the async state update
      const scrollLeft = container?.scrollLeft ?? 0;
      const containerLeft = container?.getBoundingClientRect().left ?? 0;
      const cursorOffset = e.clientX - containerLeft - LABEL_WIDTH;
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      setPxPerSecond((prev) => {
        const next = Math.max(1, Math.min(200, prev * factor));
        if (container && prev > 0) {
          // Keep the time point under the cursor stationary
          const timeAtCursor = (scrollLeft + cursorOffset) / prev;
          requestAnimationFrame(() => {
            container.scrollLeft = timeAtCursor * next - cursorOffset;
          });
        }
        return next;
      });
    };
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, []);

  // Auto-shrink panel width when zoom-out makes content narrower than panel
  useEffect(() => {
    const maxW = LABEL_WIDTH + totalDurationSec * pxPerSecond + 2; // +2px for panel borders
    if (panelSize.width > maxW) {
      setPanelSize((prev) => ({ ...prev, width: maxW }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pxPerSecond, totalDurationSec]);

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
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  const handleDownload = useCallback(async (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => {
    if (!onDownload) return;
    setIsDownloading(true);
    setDownloadMenuOpen(false);
    try { await onDownload(format); } finally { setIsDownloading(false); }
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
          Timeline
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

          {/* Download dropdown */}
          {onDownload && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setDownloadMenuOpen((prev) => !prev)}
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
              {downloadMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    backgroundColor: 'var(--background)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    padding: '4px 0',
                    zIndex: 9999,
                    width: 'fit-content',
                    marginTop: '4px',
                  }}
                  onMouseLeave={() => setDownloadMenuOpen(false)}
                >
                  {(() => {
                    const irChan = originalIRChannelCount ?? 0;
                    // No IR (Anechoic): all formats available. With IR: cap at IR's ambisonic order.
                    const maxOrder = irChan > 0 ? Math.floor(Math.sqrt(irChan)) - 1 : 3;

                    const formats = [
                      { fmt: 'mono' as const, label: 'Mono', desc: 'W channel from ambisonic mix at camera position (24-bit)', minOrder: 0 },
                      { fmt: 'binaural' as const, label: 'Binaural', desc: 'HRTF spatialized binaural decoding at camera position (2ch, 24-bit)', minOrder: 1 },
                      { fmt: 'foa' as const, label: '1st Order Ambisonics', desc: 'Raw B-format ACN FOA at camera position (4ch, 24-bit)', minOrder: 1 },
                      { fmt: 'toa' as const, label: '3rd Order Ambisonics', desc: 'Raw B-format ACN TOA at camera position (16ch, 24-bit)', minOrder: 3 },
                    ] as const;

                    return formats.map(({ fmt, label, desc, minOrder }) => {
                      const disabled = minOrder > maxOrder;
                      return (
                        <div
                          key={fmt}
                          onClick={disabled ? undefined : () => handleDownload(fmt)}
                          title={desc}
                          style={{
                            padding: '6px 12px',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                            fontSize: '11px',
                            color: disabled ? 'rgba(255,255,255,0.2)' : 'var(--foreground)',
                          }}
                          onMouseEnter={disabled ? undefined : (e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                          onMouseLeave={disabled ? undefined : (e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <div style={{ fontWeight: 500 }}>{label}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
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
                  onDoubleClickSoundCard={
                    sound.promptIndex !== undefined
                      ? () => triggerZoomToSoundCard(sound.promptIndex!)
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
          Keyboard / mouse shortcut hints (footer row)
          ============================================ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'left-align',
          gap: '14px',
          paddingLeft: 10,
          paddingRight: 20,
          height: '20px',
          flexShrink: 0,
          backgroundColor: 'var(--background)',
          pointerEvents: 'none',
        }}
      >
        {(
          [
            [ 'Zoom', 'Ctrl + Scroll'],
            ['Pan','Shift + Scroll'],
            ['Duplicate','Alt + Drag (in unlocked mode only)'],
            ['Options', 'Right-click'],
          ] as [string, string][]
        ).map(([key, desc]) => (
          <span
            key={key}
            style={{
              fontSize: '9px',
              color: 'var(--color-secondary-hover)',
              whiteSpace: 'nowrap',
              opacity: 0.65,
            }}
          >
            <span style={{ fontWeight: 600 }}>{key}</span>
            {' : '}
            {desc}
          </span>
        ))}
      </div>

      {/* ============================================
          Iteration context menu
          ============================================ */}
      {contextMenu && (() => {
        const { soundId, iterationIndex, submenuOpen } = contextMenu;
        const linkKey = `${soundId}-${iterationIndex}`;
        const currentLink = iterationLinks[linkKey] ?? {};

        // Derive promptIndex for this sound from the timeline sounds list
        const timelineSound = sounds.find((s) => s.id === soundId);
        const promptIndex = timelineSound?.promptIndex;

        // Variants for this promptIndex
        const variants = promptIndex !== undefined
          ? generatedSounds.filter((s: any) => s.prompt_index === promptIndex)
          : [];

        // Entities linked to this promptIndex
        const linkedEntities: string[] = promptIndex !== undefined
          ? [...objectSoundLinks.entries()]
              .filter(([, pi]) => pi === promptIndex)
              .map(([objectId]) => objectId)
          : [];

        const MENU_WIDTH = 150;
        const SUBMENU_WIDTH = 160;

        return (
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
              width: `${MENU_WIDTH}px`,
              padding: '4px 0',
              fontSize: '11px',
            }}
          >
            {/* ── Variants item — only when multiple variants exist ── */}
            {variants.length > 1 && (
            <div
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'var(--foreground)',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)';
                setContextMenu((prev) => prev ? { ...prev, submenuOpen: 'variants' } : prev);
              }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span>Variants</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>

              {/* Variants submenu */}
              {submenuOpen === 'variants' && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${MENU_WIDTH - 2}px`,
                    top: 0,
                    width: 80,
                    backgroundColor: 'var(--background)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    padding: '4px 0',
                    zIndex: 10000,
                  }}
                >
                  {variants.map((v: any, vi: number) => {
                    const letter = String.fromCharCode(65 + vi);
                    const isActive = currentLink.variantIndex === vi;
                    return (
                      <div
                        key={v.id}
                        style={{
                          padding: '5px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: 'var(--foreground)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        onClick={() => {
                          setIterationLink(soundId, iterationIndex, { variantIndex: vi });
                          setContextMenu(null);
                        }}
                      >
                        <span style={{ width: 10, flexShrink: 0, color: 'var(--color-primary)', fontSize: '10px' }}>
                          {isActive ? '✓' : ''}
                        </span>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                        >
                          {letter}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            )}

            {/* ── Empty state: no variants or linked entities ── */}
            {variants.length <= 1 && linkedEntities.length === 0 && (
              <div
                style={{
                  padding: '8px 12px',
                  color: 'rgba(255,255,255,0.35)',
                  fontStyle: 'italic',
                  cursor: 'default',
                  textAlign: 'center',
                }}
              >
                No variants or linked objects
              </div>
            )}

            {/* ── Linked entities item — only when entities exist ── */}
            {linkedEntities.length > 0 && (
            <div
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'var(--foreground)',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)';
                setContextMenu((prev) => prev ? { ...prev, submenuOpen: 'entities' } : prev);
              }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span>Linked entities</span>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>

              {/* Entities submenu */}
              {submenuOpen === 'entities' && (() => {
                  // Build entity-id → index-in-entities-array map for consistent numbering
                  const configEntities = promptIndex !== undefined ? soundConfigs[promptIndex]?.entities ?? [] : [];
                  const entityIdxMap = new Map<string, number>();
                  configEntities.forEach((e: any, ei: number) => {
                    const eid = e.nodeId || e.id;
                    if (eid) entityIdxMap.set(eid, ei);
                  });
                  return (
                <div
                  style={{
                    position: 'absolute',
                    left: `${MENU_WIDTH - 2}px`,
                    top: 0,
                    width: 80,
                    backgroundColor: 'var(--background)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    padding: '4px 0',
                    zIndex: 10000,
                  }}
                >
                    {linkedEntities.map((entityId) => {
                      const isActive = currentLink.entityNodeId === entityId;
                      const entityArrayIdx = entityIdxMap.get(entityId);
                      const displayNumber = entityArrayIdx !== undefined ? entityArrayIdx + 1 : 1;
                      return (
                        <div
                          key={entityId}
                          style={{
                            padding: '5px 12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: 'var(--foreground)',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          onClick={() => {
                            if (isActive) {
                              clearIterationLink(soundId, iterationIndex);
                              setContextMenu(null);
                              return;
                            }
                            let entityPosition: [number, number, number] | undefined;
                            if (promptIndex !== undefined) {
                              const config = soundConfigs[promptIndex];
                              const entity = config?.entities?.find((e: any) =>
                                (e.nodeId || e.id) === entityId
                              );
                              if (entity) {
                                entityPosition = entity.bounds?.center
                                  ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]]
                                  : entity.position && entity.position.length >= 3
                                    ? [entity.position[0], entity.position[1], entity.position[2]]
                                    : undefined;
                              }
                            }
                            setIterationLink(soundId, iterationIndex, { entityNodeId: entityId, entityPosition, entityIndex: entityArrayIdx });
                            setContextMenu(null);
                          }}
                        >
                        <span style={{ width: 10, flexShrink: 0, color: 'var(--color-primary)', fontSize: '10px' }}>
                          {isActive ? '✓' : ''}
                        </span>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            fontSize: '11px',
                          }}
                        >
                          {displayNumber}
                        </span>
                      </div>
                    );
                  })}
                </div>
                  );
              })()}
            </div>
            )}
          </div>
        );
      })()}

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

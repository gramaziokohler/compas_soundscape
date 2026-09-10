'use client';

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { DAWTransportBtn, DAWPlayIcon, DAWPauseIcon, DAWStopIcon } from './DAWTransportBtn';
import { NumberField } from '@/components/ui/NumberField';
import { DAW } from '@/utils/constants';
import type { SnapMode } from './daw-snap';
import type { ExportFormat } from '@/lib/audio/SoundscapeExporter';

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const SNAP_OPTIONS: Array<{ value: SnapMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 0.1, label: '0.1s' },
  { value: 0.5, label: '0.5s' },
  { value: 1, label: '1s' },
  { value: 'smart', label: 'Smart' },
];

interface DAWStatusBarProps {
  isPlaying: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  currentTimeMs: number;
  durationMs: number;
  onDurationChange: (ms: number) => void;
  isEditingDuration: boolean;
  onStartEditDuration: () => void;
  onStopEditDuration: () => void;
  /** Orchestrator-baked clips that start beyond the current timeline length.
   *  Null when the whole current sound scene fits inside the timeline. */
  timelineOverrun?: { iterationCount: number; proposedDurationMs: number } | null;
  /** Extend the timeline to the proposed duration so overrunning clips are included. */
  onExtendTimeline?: (ms: number) => void;
  trackCount: number;
  clipCount: number;
  selectionCount: number;
  pxPerSecond: number;
  onZoomChange: (updater: (prev: number) => number) => void;
  snapMode: SnapMode;
  onSnapModeChange: (m: SnapMode) => void;
  onDownload?: (format: ExportFormat) => Promise<void>;
  originalIRChannelCount?: number;
  isBakingSchedule: boolean;
  sampleRate?: number;
}

export function DAWStatusBar({
  isPlaying,
  onPlay,
  onPause,
  onStop,
  currentTimeMs,
  durationMs,
  onDurationChange,
  isEditingDuration,
  onStartEditDuration,
  onStopEditDuration,
  timelineOverrun,
  onExtendTimeline,
  trackCount,
  clipCount,
  selectionCount,
  pxPerSecond,
  onZoomChange,
  snapMode,
  onSnapModeChange,
  onDownload,
  originalIRChannelCount,
  isBakingSchedule,
  sampleRate,
}: DAWStatusBarProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [downloadPos, setDownloadPos] = useState<{ x: number; y: number } | null>(null);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const downloadAnchorRef = useRef<{ x: number; y: number } | null>(null);

  const handleDownload = useCallback(async (format: ExportFormat) => {
    if (!onDownload) return;
    setIsDownloading(true);
    setDownloadMenuOpen(false);
    setDownloadPos(null);
    try { await onDownload(format); } finally { setIsDownloading(false); }
  }, [onDownload]);

  // Toggle the export menu. On open we remember the button's right/top edge so the
  // menu can be anchored right next to the button (right-aligned, opening upward)
  // instead of being pinned to the viewport bottom-right corner (which sits far
  // from the button whenever the dock is inset by the sidebars).
  const toggleDownloadMenu = useCallback(() => {
    if (downloadMenuOpen) {
      setDownloadMenuOpen(false);
      setDownloadPos(null);
      return;
    }
    const rect = downloadBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    downloadAnchorRef.current = { x: rect.right, y: rect.top };
    setDownloadPos(null);
    setDownloadMenuOpen(true);
  }, [downloadMenuOpen]);

  // Measure the freshly-mounted menu and place it right beside the button. Rendered
  // through a portal to <body> so it escapes clipped/transformed dock ancestors and
  // stays on top of everything.
  useLayoutEffect(() => {
    if (!downloadMenuOpen || !downloadMenuRef.current || !downloadAnchorRef.current) return;
    const el = downloadMenuRef.current;
    const a = downloadAnchorRef.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    let px = Math.max(margin, Math.min(a.x - w, vw - w - margin));
    let py = a.y - h - 4;
    py = Math.max(margin, py);
    setDownloadPos({ x: px, y: py });
  }, [downloadMenuOpen]);

  // Dismiss on outside pointer-down (the button itself is handled by the toggle).
  useEffect(() => {
    if (!downloadMenuOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (downloadMenuRef.current?.contains(t)) return;
      if (downloadBtnRef.current?.contains(t)) return;
      setDownloadMenuOpen(false);
      setDownloadPos(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [downloadMenuOpen]);

  const zoomPercent = Math.round((pxPerSecond / 10) * 100);

  // ── Overrun warning popover (clips beyond the timeline) ────────────────────
  const [overrunPopover, setOverrunPopover] = useState<{ x: number; y: number } | null>(null);
  const overrunBtnRef = useRef<HTMLButtonElement>(null);
  const overrunPopRef = useRef<HTMLDivElement>(null);

  const handleOverrunClick = useCallback(() => {
    if (overrunPopover) { setOverrunPopover(null); return; }
    const rect = overrunBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const margin = 8;
    let x = rect.left;
    let y = rect.bottom + 4;
    // Measure after first paint, then clamp into the viewport (prefer above the bar
    // when it would overflow the bottom — the dock hugs the bottom edge).
    requestAnimationFrame(() => {
      const el = overrunPopRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      x = Math.max(margin, Math.min(x, vw - w - margin));
      if (y + h > vh - margin) y = rect.top - h - 4;
      setOverrunPopover({ x, y });
    });
    setOverrunPopover({ x: rect.left, y: rect.bottom + 4 });
  }, [overrunPopover]);

  const closeOverrun = useCallback(() => setOverrunPopover(null), []);

  useEffect(() => {
    if (!overrunPopover) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (overrunPopRef.current?.contains(t) || overrunBtnRef.current?.contains(t)) return;
      setOverrunPopover(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [overrunPopover]);

  // Clear the popover when there is nothing out of bounds any more.
  useEffect(() => {
    if (!timelineOverrun || timelineOverrun.iterationCount === 0) setOverrunPopover(null);
  }, [timelineOverrun]);

  const overrunCount = timelineOverrun?.iterationCount ?? 0;
  const hasOverrun = overrunCount > 0;
  const proposedDurationMs = timelineOverrun?.proposedDurationMs ?? durationMs;

  return (
    <div
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--card-space-lg)', height: `${DAW.STATUS_HEIGHT}px`,
        paddingLeft: 'var(--card-space-md)', paddingRight: 'var(--card-space-md)', flexShrink: 0,
        backgroundColor: 'transparent', borderTop: '1px solid var(--color-border)',
        fontSize: '9px', color: 'var(--color-secondary-hover)',
      }}
    >
      {/* Left: duration + counts */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-space-xxs)' }}>
        Duration:{' '}
        {isEditingDuration ? (
          <NumberField
            value={durationMs / 1000}
            precision={0}
            autoFocus
            onCommit={(v) => { if (v && v > 0) onDurationChange(v * 1000); onStopEditDuration(); }}
            onKeyDown={(e) => { if (e.key === 'Escape') onStopEditDuration(); }}
            containerStyle={{ width: '44px' }}
            className="!text-xs !py-0.5"
          />
        ) : (
          <strong onClick={onStartEditDuration} title="Click to edit duration" style={{ cursor: 'text' }}>
            {formatTime(durationMs / 1000)}
          </strong>
        )}
      </span>
      {hasOverrun && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <button
            ref={overrunBtnRef}
            onClick={handleOverrunClick}
            title={`${overrunCount} clip${overrunCount !== 1 ? 's' : ''} sit beyond the ${formatTime(durationMs / 1000)} timeline — click to extend`}
            aria-label={`${overrunCount} clips beyond timeline`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
              color: 'var(--color-warning)', width: 14, height: 14,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </button>
        </span>
      )}
      <span>Tracks: {trackCount}</span>
      <span>Clips: {clipCount}</span>
      {selectionCount > 0 && <span>Selected: {selectionCount}</span>}

      {isBakingSchedule && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              backgroundColor: 'var(--color-primary)', animation: 'daw-bake-pulse 1s ease-in-out infinite',
            }}
          />
          Computing schedule…
          <style>{`@keyframes daw-bake-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(0.7); } }`}</style>
        </span>
      )}

      {/* Transport — the Play/Pause button is centred on the dock using the
          exact same rule as the centred reduce/expand knob (left 50%, then a
          fixed 14px back = half the 28px button), so its centre lines up under
          the knob. Stop + timecode trail to the right. */}
      <div
        style={{
          position: 'absolute', left: '50%', top: '50%',
          transform: 'translate(-14px, -50%)',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        {isPlaying ? (
          <DAWTransportBtn onClick={onPause} title="Pause" active><DAWPauseIcon /></DAWTransportBtn>
        ) : (
          <DAWTransportBtn onClick={onPlay} title="Play" active><DAWPlayIcon /></DAWTransportBtn>
        )}
        <DAWTransportBtn onClick={onStop} title="Stop"><DAWStopIcon /></DAWTransportBtn>
        <span style={{ fontSize: '10px', fontFamily: 'monospace', minWidth: '36px' }}>
          {formatTime(currentTimeMs / 1000)}
        </span>
      </div>

      {/* Right: snap, zoom, export — pushed to the far edge (the transport is
          absolutely centred above, so it stays out of the flex flow). */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
        <select
          value={String(snapMode)}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === 'off' || raw === 'smart' ? raw : (parseFloat(raw) as SnapMode);
            onSnapModeChange(parsed);
          }}
          style={{
            fontSize: '10px', background: 'var(--background)', color: 'var(--foreground)',
            border: '1px solid var(--color-border-strong)', borderRadius: '3px', padding: '1px 4px',
          }}
        >
          {SNAP_OPTIONS.map((o) => (
            <option key={o.label} value={String(o.value)}>{o.label}</option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button
          onClick={() => onZoomChange((p) => p * 0.85)}
          title="Zoom out (horizontal)"
          style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary-hover)', cursor: 'pointer', fontSize: '13px', padding: '0 2px' }}
        >
          −
        </button>
        <span style={{ minWidth: '30px', textAlign: 'center' }}>{zoomPercent}%</span>
        <button
          onClick={() => onZoomChange((p) => p * 1.15)}
          title="Zoom in (horizontal)"
          style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary-hover)', cursor: 'pointer', fontSize: '13px', padding: '0 2px' }}
        >
          +
        </button>
      </div>

      {onDownload && (
        <div style={{ position: 'relative' }}>
          <button
            ref={downloadBtnRef}
            onClick={toggleDownloadMenu}
            disabled={isDownloading}
            title="Download timeline mix"
            style={{
              background: 'transparent', border: 'none', color: isDownloading ? 'var(--color-text-3)' : 'var(--color-secondary-hover)',
              cursor: isDownloading ? 'wait' : 'pointer', padding: '4px', borderRadius: '4px', display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          {downloadMenuOpen && createPortal(
            <div
              ref={downloadMenuRef}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseLeave={() => { setDownloadMenuOpen(false); setDownloadPos(null); }}
              style={{
                position: 'fixed', left: `${downloadPos?.x ?? 0}px`, top: `${downloadPos?.y ?? 0}px`,
                backgroundColor: 'var(--background)', border: '1px solid var(--color-border-strong)',
                borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                padding: '4px 0', zIndex: 999999, width: 'fit-content',
              }}
            >
              {(() => {
                const irChan = originalIRChannelCount ?? 0;
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
                      style={{ padding: '6px 12px', cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', fontSize: '11px', color: disabled ? 'var(--color-text-3)' : 'var(--foreground)' }}
                      onMouseEnter={disabled ? undefined : (e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
                      onMouseLeave={disabled ? undefined : (e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div style={{ fontWeight: 500 }}>{label}</div>
                    </div>
                  );
                });
              })()}
            </div>,
            document.body
          )}
        </div>
      )}

      {sampleRate !== undefined && sampleRate > 0 && <span>{(sampleRate / 1000).toFixed(1)} kHz</span>}

      {/* Overrun warning popover — proposes extending the timeline so that every
          orchestrator-baked clip of the current sound scene becomes visible. */}
      {overrunPopover && hasOverrun && onExtendTimeline && createPortal(
        <div
          ref={overrunPopRef}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', left: `${overrunPopover.x}px`, top: `${overrunPopover.y}px`,
            width: 260, zIndex: 999999,
            backgroundColor: 'var(--background)', border: '1px solid var(--color-border-strong)',
            borderRadius: '8px', boxShadow: 'var(--shadow-lg)', padding: '10px 12px',
            color: 'var(--foreground)', fontSize: '11px', lineHeight: 1.45,
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>
                {overrunCount} clip{overrunCount !== 1 ? 's' : ''} beyond the {formatTime(durationMs / 1000)} timeline
              </div>
              <div style={{ color: 'var(--color-secondary-hover)' }}>
                This sound scene is cut short. Extend the timeline to{' '}
                <span style={{ fontFamily: 'monospace', color: 'var(--foreground)' }}>
                  {formatTime(proposedDurationMs / 1000)}
                </span>{' '}
                to include every scheduled clip?
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button
              onClick={closeOverrun}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'var(--color-secondary-hover)', fontSize: '11px', padding: '3px 6px',
              }}
            >
              Later
            </button>
            <button
              onClick={() => { onExtendTimeline(proposedDurationMs); closeOverrun(); }}
              style={{
                cursor: 'pointer', border: 'none', borderRadius: '5px', padding: '4px 12px',
                fontSize: '11px', fontWeight: 600, color: '#fff', background: 'var(--color-primary)',
              }}
            >
              Extend to {formatTime(proposedDurationMs / 1000)}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


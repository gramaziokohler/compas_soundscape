'use client';

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { BarButton } from '@/components/ui/BarButton';
import { Icon } from '@/components/ui/Icon';
import { DAW, SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { SnapMode } from './daw-snap';
import type { ExportFormat } from '@/lib/audio/SoundscapeExporter';

const EXPORT_FORMATS = [
  { fmt: 'mono', label: 'Mono', desc: 'W channel from ambisonic mix at camera position (24-bit)', minOrder: 0 },
  { fmt: 'binaural', label: 'Binaural', desc: 'HRTF spatialized binaural decoding at camera position (2ch, 24-bit)', minOrder: 1 },
  { fmt: 'foa', label: '1st Order Ambisonics', desc: 'Raw B-format ACN FOA at camera position (4ch, 24-bit)', minOrder: 1 },
  { fmt: 'toa', label: '3rd Order Ambisonics', desc: 'Raw B-format ACN TOA at camera position (16ch, 24-bit)', minOrder: 3 },
] as const satisfies ReadonlyArray<{ fmt: ExportFormat; label: string; desc: string; minOrder: number }>;

interface DAWBarControlsProps {
  pxPerSecond: number;
  onZoomChange: (updater: (prev: number) => number) => void;
  snapMode: SnapMode;
  onSnapModeChange: (m: SnapMode) => void;
  onDownload?: (format: ExportFormat) => Promise<void>;
  originalIRChannelCount?: number;
}

/**
 * DAW controls shown in the scene bottom bar (right of "Timeline") while the
 * dock is expanded: snap magnet, horizontal zoom and mix export. DAWDock
 * portals this into the bar's DAW slot, so the state stays owned by the dock.
 */
export function DAWBarControls({
  pxPerSecond,
  onZoomChange,
  snapMode,
  onSnapModeChange,
  onDownload,
  originalIRChannelCount,
}: DAWBarControlsProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(async (format: ExportFormat) => {
    if (!onDownload) return;
    setIsDownloading(true);
    setMenuOpen(false);
    try { await onDownload(format); } finally { setIsDownloading(false); }
  }, [onDownload]);

  // `.bar-popover` already sits just above the bar; right-align it to the download button.
  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !anchorRef.current) { setMenuLeft(null); return; }
    const right = anchorRef.current.getBoundingClientRect().right;
    const w = menuRef.current.offsetWidth;
    const margin = 8;
    setMenuLeft(Math.max(margin, Math.min(right - w, window.innerWidth - w - margin)));
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const zoomPercent = Math.round((pxPerSecond / DAW.FALLBACK_PX_PER_SECOND) * 100);
  const irChannels = originalIRChannelCount ?? 0;
  const maxOrder = irChannels > 0 ? Math.floor(Math.sqrt(irChannels)) - 1 : 3;

  return (
    <>
      <div className="scene-bottom-bar__sep" />
      <BarButton
        onClick={() => onSnapModeChange(snapMode === 'on' ? 'off' : 'on')}
        active={snapMode === 'on'}
        title={snapMode === 'on' ? 'Snap enabled' : 'Snap disabled'}
        icon={
          <Icon>
            <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" />
            <path d="m5 8 4 4" />
            <path d="m12 15 4 4" />
          </Icon>
        }
      />
      <BarButton
        onClick={() => onZoomChange((p) => p * DAW.WHEEL_ZOOM_OUT)}
        title="Zoom out (horizontal)"
        icon={<Icon><line x1="5" y1="12" x2="19" y2="12" /></Icon>}
      />
      <span className="bar-time" title="Horizontal zoom">{zoomPercent}%</span>
      <BarButton
        onClick={() => onZoomChange((p) => p * DAW.WHEEL_ZOOM_IN)}
        title="Zoom in (horizontal)"
        icon={<Icon><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>}
      />
      {onDownload && (
        <span ref={anchorRef} className="flex items-center">
          <BarButton
            onClick={() => setMenuOpen((o) => !o)}
            active={menuOpen}
            disabled={isDownloading}
            title={isDownloading ? 'Exporting mix…' : 'Download timeline mix'}
            icon={
              <Icon>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </Icon>
            }
          />
        </span>
      )}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="bar-popover"
          role="menu"
          style={{
            left: menuLeft ?? 0, zIndex: SCENE_BOTTOM_BAR.Z_INDEX,
            visibility: menuLeft === null ? 'hidden' : 'visible', padding: '4px 0', width: 'fit-content',
          }}
        >
          {EXPORT_FORMATS.map(({ fmt, label, desc, minOrder }) => {
            const disabled = minOrder > maxOrder;
            return (
              <button
                key={fmt}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={() => handleDownload(fmt)}
                title={desc}
                className="block w-full text-left px-3 py-1.5 text-[11px] whitespace-nowrap enabled:hover:bg-[var(--color-border)] disabled:cursor-not-allowed disabled:text-[var(--color-text-3)]"
              >
                {label}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

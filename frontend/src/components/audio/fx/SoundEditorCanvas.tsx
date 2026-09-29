'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  createSilhouetteRenderFunction,
  resolveSilhouettePalette,
  withAlpha,
  resolveCssVar,
} from '@/lib/audio/waveform-silhouette';
import { getCssColorString } from '@/utils/utils';
import type { FxRegion } from '@/lib/audio/fx/fx-types';
import { Spinner } from '@/components/ui/Spinner';
import { OutputMeter } from './OutputMeter';

type RegionVariant = 'keep' | 'inpaint';

interface SoundEditorCanvasProps {
  audioUrl: string;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  regions: FxRegion[];
  /** 'keep' (crop, primary) or 'inpaint' (regenerate, warning) region coloring. */
  regionVariant?: RegionVariant;
  /** Change to re-seed the drawn regions (e.g. switching which effect owns them). */
  regionKey?: string;
  getLevels: () => { left: number; right: number };
  onSeek: (time: number) => void;
  onRegionsChange: (regions: FxRegion[]) => void;
}

function regionColorFor(variant: RegionVariant): string {
  const varName = variant === 'inpaint' ? '--color-warning' : '--color-primary';
  return withAlpha(getCssColorString(varName) || '#002aff', 0.18);
}

const DEFAULT_HEIGHT = 96;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 320;
const ZOOM_DEBOUNCE_MS = 140;
const ZOOM_STEP = 1.6;
const ZOOM_MAX = 4000;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function SoundEditorCanvas({
  audioUrl, currentTime, duration, isPlaying, regions,
  regionVariant = 'keep', regionKey,
  getLevels, onSeek, onRegionsChange,
}: SoundEditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const [ready, setReady] = useState(false);
  const [spectrogram, setSpectrogram] = useState(false);
  const [zoom, setZoom] = useState(0); // 0 = fit; otherwise px/sec
  const [waveHeight, setWaveHeight] = useState(DEFAULT_HEIGHT);
  const applyingRef = useRef(false);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef(0);
  const waveHeightRef = useRef(waveHeight);
  waveHeightRef.current = waveHeight;
  const durationRef = useRef(duration);
  durationRef.current = duration;
  // Read inside `recreate` (memoized on [audioUrl, spectrogram]) so a
  // resize-triggered recreate never restores stale regions or zoom.
  const regionsPropRef = useRef(regions);
  regionsPropRef.current = regions;
  const regionVariantRef = useRef<RegionVariant>(regionVariant);
  regionVariantRef.current = regionVariant;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const fitPxPerSec = useCallback(() => {
    const w = containerRef.current?.clientWidth || 0;
    const d = durationRef.current || 0;
    return w > 0 && d > 0 ? w / d : 0;
  }, []);

  const applyZoomNow = useCallback((pxPerSec: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    const dur = ws.getDuration() || 0;
    if (dur <= 0) return;
    if (pxPerSec <= 0) {
      const w = containerRef.current?.clientWidth || 0;
      if (w > 0) {
        try { ws.zoom(w / dur); } catch { /* ignore */ }
      }
      return;
    }
    try { ws.zoom(pxPerSec); } catch { /* ignore */ }
  }, []);

  const recreate = useCallback(() => {
    if (!containerRef.current) return;
    try { wsRef.current?.destroy(); } catch { /* abort during teardown */ }
    wsRef.current = null;
    setReady(false);

    const height = waveHeightRef.current;
    const palette = resolveSilhouettePalette(false);
    const plugins: unknown[] = [];
    const regionsPlugin = RegionsPlugin.create();
    plugins.push(regionsPlugin);
    if (spectrogram) {
      // The Spectrogram plugin appends itself to the WaveSurfer wrapper, so the
      // waveform container must collapse to height 0 for it to be visible.
      plugins.push(Spectrogram.create({
        labels: false,
        height,
        fftSamples: 1024,
      }));
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      backend: 'WebAudio',
      height: spectrogram ? 0 : height,
      waveColor: palette.fill,
      progressColor: resolveCssVar('var(--color-secondary)'),
      cursorColor: resolveCssVar('var(--color-warning)'),
      interact: true,
      fillParent: true,
      // Not hidden: zoomed-in content scrolls (pans) natively via the scrollbar.
      hideScrollbar: false,
      plugins: plugins as never[],
      renderFunction: createSilhouetteRenderFunction(palette),
    });
    ws.setVolume(0);
    regionsPluginRef.current = regionsPlugin;
    wsRef.current = ws;

    ws.on('ready', () => {
      setReady(true);
      applyingRef.current = true;
      regionsPlugin.clearRegions();
      const dur = ws.getDuration() || 1;
      const color = regionColorFor(regionVariantRef.current);
      for (const r of regionsPropRef.current) {
        regionsPlugin.addRegion({
          start: r.start * dur,
          end: r.end * dur,
          color,
          drag: true,
          resize: true,
        });
      }
      // Re-assert the current zoom after a recreate (spectrogram/resize).
      if (zoomRef.current > 0) applyZoomNow(zoomRef.current);
      // Keep the apply-guard up through the next tick so any async
      // region-removed events from clearRegions() don't wipe the chain.
      setTimeout(() => { applyingRef.current = false; }, 0);
    });

    ws.on('interaction', (t: number) => onSeek(t));

    const emitRegions = () => {
      if (applyingRef.current) return;
      const dur = ws.getDuration() || 1;
      const next = regionsPlugin.getRegions().map((r) => ({
        start: r.start / dur,
        end: r.end / dur,
      }));
      onRegionsChange(next);
    };
    regionsPlugin.enableDragSelection({ color: regionColorFor(regionVariantRef.current) });
    regionsPlugin.on('region-updated', emitRegions);
    regionsPlugin.on('region-created', emitRegions);
    regionsPlugin.on('region-removed', emitRegions);

    // load() rejects with AbortError when the canvas is destroyed mid-decode
    // (React StrictMode double-mount, or a variant/spectrogram switch). Swallow
    // it — the replacement instance performs the real load.
    void ws.load(audioUrl).catch(() => { /* aborted load */ });
  }, [audioUrl, spectrogram]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    recreate();
    return () => {
      try { wsRef.current?.destroy(); } catch { /* abort during teardown */ }
      wsRef.current = null;
    };
  }, [recreate]);

  // Re-seed the drawn regions when their owner changes (chain crop regions vs.
  // an inpaint effect's replace-regions). Depends only on `regionKey` so that
  // dragging (which updates the `regions` prop every frame) never loops.
  useEffect(() => {
    if (!ready) return;
    const ws = wsRef.current;
    const rp = regionsPluginRef.current;
    if (!ws || !rp) return;
    applyingRef.current = true;
    rp.clearRegions();
    const dur = ws.getDuration() || 1;
    const color = regionColorFor(regionVariantRef.current);
    for (const r of regionsPropRef.current) {
      rp.addRegion({ start: r.start * dur, end: r.end * dur, color, drag: true, resize: true });
    }
    setTimeout(() => { applyingRef.current = false; }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey, ready]);

  // Debounced zoom → WaveSurfer re-renders the peaks at the new resolution.
  // zoom === 0 means "fit": only re-apply it when coming back from a zoomed
  // state, so the initial load keeps WaveSurfer's own fill behavior.
  useEffect(() => {
    if (!ready) return;
    if (zoom === 0) {
      if (prevZoomRef.current !== 0) applyZoomNow(0);
      prevZoomRef.current = 0;
      return;
    }
    prevZoomRef.current = zoom;
    if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    zoomTimerRef.current = setTimeout(() => applyZoomNow(zoom), ZOOM_DEBOUNCE_MS);
    return () => {
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
    };
  }, [zoom, ready, applyZoomNow]);

  // Mouse wheel over the waveform/spectrogram zooms instead of scrolling.
  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const base = z > 0 ? z : fitPxPerSec();
      return base > 0 ? Math.min(ZOOM_MAX, base * ZOOM_STEP) : z;
    });
  }, [fitPxPerSec]);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const base = z > 0 ? z : fitPxPerSec();
      if (base <= 0) return z;
      const next = base / ZOOM_STEP;
      return next <= fitPxPerSec() * 1.01 ? 0 : next;
    });
  }, [fitPxPerSec]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomIn, zoomOut]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !ready || duration <= 0) return;
    const t = ws.getCurrentTime();
    if (Math.abs(t - currentTime) > 0.05) {
      try { ws.setTime(currentTime); } catch { /* ignore */ }
    }
  }, [currentTime, duration, ready, isPlaying]);

  const clearRegions = () => {
    applyingRef.current = true;
    regionsPluginRef.current?.clearRegions();
    applyingRef.current = false;
    onRegionsChange([]);
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startY: e.clientY, startH: waveHeightRef.current };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const h = clamp(r.startH + (e.clientY - r.startY), MIN_HEIGHT, MAX_HEIGHT);
    waveHeightRef.current = h;
    setWaveHeight(h);
    wsRef.current?.setOptions({ height: spectrogram ? 0 : h });
  };
  const onResizeUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // The spectrogram's canvas height is fixed at creation — rebuild it.
    if (spectrogram) recreate();
  };

  const zoomed = zoom > 0;

  return (
    <div className="card-stack">
      <div className="flex items-stretch gap-2">
        <div className="flex-1 flex flex-col min-w-0">
          <div
            ref={boxRef}
            className="relative overflow-hidden"
            style={{ minHeight: waveHeight, background: 'var(--color-secondary-lighter)', borderRadius: 4 }}
          >
            {!ready && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <Spinner />
              </div>
            )}
            <div ref={containerRef} />
          </div>
          {/* Resize strip lives below the box so it never overlaps WaveSurfer's
              own horizontal scrollbar (used to pan when zoomed). */}
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            title="Drag to resize"
            style={{ height: 7, cursor: 'ns-resize' }}
          >
            <div
              style={{
                width: 24,
                height: 3,
                margin: '0 auto',
                marginTop: 2,
                borderRadius: 2,
                background: 'var(--color-secondary-hover)',
                opacity: 0.6,
              }}
            />
          </div>
        </div>
        <OutputMeter height={waveHeight} getLevels={getLevels} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!ready}
            title="Zoom out"
            className="p-1 text-secondary-hover hover:text-foreground disabled:opacity-40"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={!ready}
            title="Zoom in"
            className="p-1 text-secondary-hover hover:text-foreground disabled:opacity-40"
          >
            <ZoomIn size={13} />
          </button>
          {zoomed && (
            <button
              type="button"
              onClick={() => setZoom(0)}
              title="Reset zoom"
              className="p-1 text-secondary-hover hover:text-foreground"
            >
              <Maximize2 size={13} />
            </button>
          )}
          {regions.length > 0 && (
            <button
              type="button"
              onClick={clearRegions}
              title="Clear regions"
              className="ml-1 inline-flex items-center gap-0.5 text-[10px] text-secondary-hover hover:text-foreground"
            >
              <X size={11} /> Clear regions
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSpectrogram(false)}
            className="text-[10px] transition-colors"
            style={{ color: spectrogram ? 'var(--color-secondary-hover)' : 'var(--color-primary)' }}
          >
            Waveform
          </button>
          <span
            role="switch"
            aria-checked={spectrogram}
            title={spectrogram ? 'Show waveform' : 'Show spectrogram'}
            className={`toggle-switch ${spectrogram ? 'checked' : ''}`}
            onClick={() => setSpectrogram((v) => !v)}
          />
          <button
            type="button"
            onClick={() => setSpectrogram(true)}
            className="text-[10px] transition-colors"
            style={{ color: spectrogram ? 'var(--color-primary)' : 'var(--color-secondary-hover)' }}
          >
            Spectrogram
          </button>
        </div>
      </div>
    </div>
  );
}

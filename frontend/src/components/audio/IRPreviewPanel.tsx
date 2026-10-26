'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { AudioWaveformDisplay, getDefaultWaveformHeight } from '@/components/audio/AudioWaveformDisplay';
import { FrequencyResponseDisplay } from '@/components/audio/FrequencyResponseDisplay';
import { clampToViewport, clampToViewportHeight, clampToViewportWidth } from '@/utils/scale';
import { AUDIO_VISUALIZATION, IR_PREVIEW_PANEL } from '@/utils/constants';

export type IRPreviewMode = 'impulse' | 'frequency';

export interface IRPreviewLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MODES: Array<{ id: IRPreviewMode; label: string; title: string }> = [
  { id: 'impulse', label: 'IR', title: 'Impulse response' },
  { id: 'frequency', label: 'FR', title: 'Frequency response' },
];

export interface IRPreviewContentProps {
  name: string;
  /** Sample rate of the IR file (the decoded buffer may have been resampled by the browser). */
  sampleRate: number;
  channelLabel: string;
  audioBuffer: AudioBuffer;
  mode: IRPreviewMode;
  onModeChange: (mode: IRPreviewMode) => void;
  onDownload: () => void;
  /** Shows a close button when provided. */
  onClose?: () => void;
  /** Pointer handlers that turn the header into a drag handle. */
  dragHandlers?: React.HTMLAttributes<HTMLDivElement>;
  amplitudeScale?: number;
  fullScale?: boolean;
  /** Graph fills the parent's remaining space (parent needs a definite height). */
  fill?: boolean;
}

/**
 * Header (name, IR/FR toggle, download, optional close) + graph shared by the
 * hover preview and the pinned panel.
 */
export function IRPreviewContent({
  name,
  sampleRate,
  channelLabel,
  audioBuffer,
  mode,
  onModeChange,
  onDownload,
  onClose,
  dragHandlers,
  amplitudeScale,
  fullScale,
  fill = false,
}: IRPreviewContentProps) {
  const iconBtn = 'shrink-0 flex items-center justify-center rounded p-1 transition-colors hover:bg-secondary-light';
  const draggable = dragHandlers !== undefined;

  return (
    <div
      className={fill ? 'flex flex-col w-full h-full' : 'flex flex-col'}
      style={fill ? undefined : { width: AUDIO_VISUALIZATION.WAVEFORM_WIDTH }}
    >
      <div
        className={`flex items-center gap-2 px-2 shrink-0 select-none ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        style={{
          height: IR_PREVIEW_PANEL.HEADER_HEIGHT,
          backgroundColor: 'var(--color-secondary-lighter)',
          touchAction: draggable ? 'none' : undefined,
        }}
        {...dragHandlers}
      >
        <div className="min-w-0 flex-1" title={name}>
          <p className="text-xs font-medium truncate" style={{ color: 'var(--color-foreground)' }}>{name}</p>
          <p className="text-[10px] truncate" style={{ color: 'var(--color-secondary-hover)' }}>
            {sampleRate} Hz · {channelLabel}
          </p>
        </div>
        <div
          data-no-drag
          role="group"
          aria-label="Preview mode"
          className="flex shrink-0 rounded border overflow-hidden"
          style={{ borderColor: 'var(--color-border-strong)' }}
        >
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.title}
              aria-pressed={mode === m.id}
              onClick={() => onModeChange(m.id)}
              className="px-1.5 py-0.5 text-[10px] font-medium transition-colors"
              style={
                mode === m.id
                  ? { backgroundColor: 'var(--color-primary)', color: 'var(--color-on-blue)' }
                  : { backgroundColor: 'transparent', color: 'var(--color-secondary-hover)' }
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          data-no-drag
          type="button"
          title="Download IR"
          onClick={onDownload}
          className={iconBtn}
          style={{ color: 'var(--color-secondary-hover)' }}
        >
          <Download size={12} />
        </button>
        {onClose && (
          <button
            data-no-drag
            type="button"
            title="Close"
            onClick={onClose}
            className={iconBtn}
            style={{ color: 'var(--color-secondary-hover)' }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className={fill ? 'relative flex-1 min-h-0' : undefined}>
        {mode === 'impulse' ? (
          <AudioWaveformDisplay
            audioBuffer={audioBuffer}
            audioInfo={{
              filename: name,
              sample_rate: sampleRate,
              channels: channelLabel,
              duration: audioBuffer.duration,
              num_samples: audioBuffer.length,
            }}
            enableWaveform={true}
            hideTextInfo={true}
            amplitudeScale={amplitudeScale}
            fullScale={fullScale}
            fill={fill}
          />
        ) : (
          <FrequencyResponseDisplay audioBuffer={audioBuffer} amplitudeScale={amplitudeScale} fill={fill} />
        )}
      </div>
    </div>
  );
}

export interface IRPreviewPanelProps extends Omit<IRPreviewContentProps, 'dragHandlers' | 'fill'> {
  /** Remembered layout (position + size); null = default size at `defaultPosition`. */
  savedLayout: { x: number; y: number; width?: number; height?: number } | null;
  defaultPosition: { x: number; y: number };
  /** Called when a drag or resize ends, so the layout can be remembered. */
  onLayoutCommit: (layout: IRPreviewLayout) => void;
}

/**
 * Pinned, draggable, resizable and closable impulse-response preview with an
 * impulse-response / frequency-response toggle. Drag by the header, resize from the bottom-right corner.
 *
 * Usage:
 * `<IRPreviewPanel name="IR" sampleRate={48000} channelLabel="Mono" audioBuffer={buf} mode="impulse"
 *   onModeChange={...} onClose={...} onDownload={...} savedLayout={null}
 *   defaultPosition={{ x: 100, y: 100 }} onLayoutCommit={...} />`
 */
export function IRPreviewPanel({
  savedLayout,
  defaultPosition,
  onLayoutCommit,
  ...content
}: IRPreviewPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<IRPreviewLayout>(() => {
    const border = 2;
    const width = clampToViewportWidth(
      savedLayout?.width ?? AUDIO_VISUALIZATION.WAVEFORM_WIDTH + border,
      IR_PREVIEW_PANEL.MIN_WIDTH,
      IR_PREVIEW_PANEL.MARGIN * 2,
    );
    const height = clampToViewportHeight(
      savedLayout?.height ?? IR_PREVIEW_PANEL.HEADER_HEIGHT + getDefaultWaveformHeight(content.audioBuffer.numberOfChannels) + border,
      IR_PREVIEW_PANEL.MIN_HEIGHT,
      IR_PREVIEW_PANEL.MARGIN * 2,
    );
    const pos = clampToViewport(
      savedLayout?.x ?? defaultPosition.x,
      savedLayout?.y ?? defaultPosition.y,
      width,
      height,
      IR_PREVIEW_PANEL.MARGIN,
    );
    return { ...pos, width, height };
  });
  const layoutRef = useRef(layout);
  const gestureRef = useRef<
    | { kind: 'drag'; px: number; py: number; start: IRPreviewLayout }
    | { kind: 'resize'; px: number; py: number; start: IRPreviewLayout }
    | null
  >(null);

  const updateLayout = useCallback((next: IRPreviewLayout) => {
    layoutRef.current = next;
    setLayout(next);
  }, []);

  // Re-fit after a viewport resize.
  useEffect(() => {
    const onResize = () => {
      const l = layoutRef.current;
      const width = clampToViewportWidth(l.width, IR_PREVIEW_PANEL.MIN_WIDTH, IR_PREVIEW_PANEL.MARGIN * 2);
      const height = clampToViewportHeight(l.height, IR_PREVIEW_PANEL.MIN_HEIGHT, IR_PREVIEW_PANEL.MARGIN * 2);
      const pos = clampToViewport(l.x, l.y, width, height, IR_PREVIEW_PANEL.MARGIN);
      if (pos.x !== l.x || pos.y !== l.y || width !== l.width || height !== l.height) {
        updateLayout({ ...pos, width, height });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateLayout]);

  const startGesture = (kind: 'drag' | 'resize') => (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureRef.current = { kind, px: e.clientX, py: e.clientY, start: layoutRef.current };
    e.preventDefault();
    e.stopPropagation();
  };

  const moveGesture = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    const dx = e.clientX - g.px;
    const dy = e.clientY - g.py;
    if (g.kind === 'drag') {
      const pos = clampToViewport(g.start.x + dx, g.start.y + dy, g.start.width, g.start.height, IR_PREVIEW_PANEL.MARGIN);
      updateLayout({ ...g.start, ...pos });
    } else {
      const maxW = window.innerWidth - g.start.x - IR_PREVIEW_PANEL.MARGIN;
      const maxH = window.innerHeight - g.start.y - IR_PREVIEW_PANEL.MARGIN;
      updateLayout({
        ...g.start,
        width: Math.max(IR_PREVIEW_PANEL.MIN_WIDTH, Math.min(maxW, g.start.width + dx)),
        height: Math.max(IR_PREVIEW_PANEL.MIN_HEIGHT, Math.min(maxH, g.start.height + dy)),
      });
    }
  };

  const endGesture = () => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    onLayoutCommit(layoutRef.current);
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] rounded-lg border overflow-hidden shadow-lg"
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
        borderColor: 'var(--color-border-strong)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <IRPreviewContent
        {...content}
        fill
        dragHandlers={{
          onPointerDown: startGesture('drag'),
          onPointerMove: moveGesture,
          onPointerUp: endGesture,
          onPointerCancel: endGesture,
        }}
      />
      <div
        title="Resize"
        className="absolute bottom-0 right-0 z-10 w-4 h-4 cursor-nwse-resize"
        style={{
          touchAction: 'none',
          background:
            'linear-gradient(135deg, transparent 50%, var(--color-border-strong) 50%, var(--color-border-strong) 60%, transparent 60%, transparent 75%, var(--color-border-strong) 75%, var(--color-border-strong) 85%, transparent 85%)',
        }}
        onPointerDown={startGesture('resize')}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
      />
    </div>,
    document.body,
  );
}

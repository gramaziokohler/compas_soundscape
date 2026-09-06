'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.esm.js';
import { API_BASE_URL, DEFAULT_DBFS } from '@/utils/constants';
import { dbfsToLinear } from '@/utils/utils';
import { useUIStore } from '@/store';
import { subscribeColorTheme } from '@/utils/color-theme';
import { Spinner } from '@/components/ui/Spinner';

const WAVEFORM_HEIGHT_MIN = 20;
const WAVEFORM_HEIGHT_MAX = 300;

const SPECTROGRAM_FREQ_MIN = 20;
const SPECTROGRAM_FREQ_MAX = 20000;

const FREQ_LABELS = [
  { freq: 20,    label: '20 Hz' },
  { freq: 100,   label: '100 Hz' },
  { freq: 500,   label: '500 Hz' },
  { freq: 2000,  label: '2 kHz' },
  { freq: 5000,  label: '5 kHz' },
  { freq: 10000, label: '10 kHz' },
  { freq: 20000, label: '20 kHz' },
];

export interface WaveSurferPlayerProps {
  audioUrl: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onStop: (ws: WaveSurfer | null) => void;
  volumeDbfs?: number;
  /** Calibrated level of the audio file itself (the gain is applied relative to this base). */
  baseVolumeDbfs?: number;
  isMuted?: boolean;
  silent?: boolean;
  color?: string;
  onWavesurferReady?: (ws: WaveSurfer | null) => void;
  onAudioProcess?: (currentTime: number, duration: number) => void;
  onFinish?: () => void;
  interact?: boolean;
  pointerHandlers?: {
    onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
    onPointerLeave?: () => void;
  };
  cursor?: string;
  children?: React.ReactNode;
  controlsExtra?: React.ReactNode;
  className?: string;
  borderColor?: string;
  backgroundColor?: string;
  /** Recolor waveform + transport for a solid-primary (generated) card. */
  onBlueBackground?: boolean;
}

export function WaveSurferPlayer({
  audioUrl,
  isPlaying,
  onPlayPause,
  onStop,
  volumeDbfs = DEFAULT_DBFS,
  baseVolumeDbfs = DEFAULT_DBFS,
  isMuted = false,
  silent = false,
  color = 'var(--color-primary)',
  onWavesurferReady,
  onAudioProcess,
  onFinish,
  interact = true,
  pointerHandlers,
  cursor = 'default',
  children,
  controlsExtra,
  className = 'space-y-2 min-w-0 overflow-hidden',
  borderColor,
  backgroundColor = 'var(--color-secondary-lighter)',
  onBlueBackground = false,
}: WaveSurferPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spectrogramContainerRef = useRef<HTMLDivElement>(null);
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const showSpectrograms = useUIStore((s) => s.showSpectrograms);
  const waveformHeight = useUIStore((s) => s.waveformHeight);
  const setWaveformHeight = useUIStore((s) => s.setWaveformHeight);

  // Resize drag state
  const isResizingRef = useRef(false);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(waveformHeight);
  const [pendingHeight, setPendingHeight] = useState<number | null>(null);
  // Throttles the 'audioprocess' → setState re-render (native event fires far
  // faster than a text time display needs to update) without dropping the
  // onAudioProcess callback rate for consumers that need precise timing.
  const lastAudioProcessUpdateRef = useRef(0);

  // Hover state for spectrogram labels
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => { resizeStartHeightRef.current = waveformHeight; }, [waveformHeight]);

  const displayHeight = pendingHeight ?? waveformHeight;
  const isSpectrogramMode = showSpectrograms;

  const resolveAudioUrl = (url: string): string => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:')) {
      return url;
    }
    return `${API_BASE_URL}${url}`;
  };

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsReady(false);
    setIsLoadingAudio(true);
    setCurrentTime(0);

    const { waveColor, progressColor } = resolveWaveColors(onBlueBackground);

    const plugins = [];
    if (isSpectrogramMode && spectrogramContainerRef.current) {
      plugins.push(Spectrogram.create({
        container: spectrogramContainerRef.current,
        labels: false,
        height: waveformHeight,
        fftSamples: 1024,
      }));
    }

    const ws = WaveSurfer.create({
      container: containerRef.current,
      // WebAudio backend routes volume through a GainNode, which allows gains > 1.
      // The MediaElement backend clamps volume to [0, 1] and throws on boost.
      backend: 'WebAudio',
      waveColor,
      progressColor,
      cursorColor: progressColor,
      cursorWidth: 2,
      height: isSpectrogramMode ? 0 : waveformHeight,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      fillParent: true,
      interact,
      hideScrollbar: true,
      plugins,
    });

    ws.on('ready', () => {
      setIsReady(true);
      setIsLoadingAudio(false);
      setDuration(ws.getDuration());
    });

    ws.on('audioprocess', () => {
      const t = ws.getCurrentTime();
      // Throttle the React re-render to ~5/s — plenty for a text time readout —
      // while still invoking onAudioProcess at native event rate for consumers
      // (e.g. trim-end auto-pause) that need precise timing.
      const now = performance.now();
      if (now - lastAudioProcessUpdateRef.current > 200) {
        lastAudioProcessUpdateRef.current = now;
        setCurrentTime(t);
      }
      onAudioProcess?.(t, ws.getDuration());
    });

    ws.on('seeking', () => {
      setCurrentTime(ws.getCurrentTime());
    });

    ws.on('finish', () => {
      onFinish?.();
    });

    ws.on('error', (error: Error) => {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) return;
      console.error('[WaveSurferPlayer] Error:', error);
      setIsLoadingAudio(false);
    });

    ws.load(resolveAudioUrl(audioUrl)).catch((error: Error) => {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) return;
      console.error('[WaveSurferPlayer] Load error:', error);
      setIsLoadingAudio(false);
    });

    wsRef.current = ws;
    onWavesurferReady?.(ws);

    return () => {
      if (abortRef.current) abortRef.current.abort();
      onWavesurferReady?.(null);
      try { ws.destroy(); } catch { /* ignore */ }
      wsRef.current = null;
      setIsReady(false);
      setIsLoadingAudio(false);
    };
    // Deliberately NOT depending on waveformHeight/interact/onBlueBackground:
    // those are cosmetic/interaction options WaveSurfer supports updating live
    // via setOptions() below — recreating (and re-fetching + re-decoding) the
    // whole instance for a resize-handle drag or a mute-color change was the
    // cause of the spinner flash on every such interaction. Only the audio
    // source itself and the spectrogram plugin wiring need a real recreate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, isSpectrogramMode]);

  // Live cosmetic/interaction updates — no re-decode, no instance recreation.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const { waveColor, progressColor } = resolveWaveColors(onBlueBackground);
    ws.setOptions({
      waveColor,
      progressColor,
      cursorColor: progressColor,
      height: isSpectrogramMode ? 0 : waveformHeight,
      interact,
    });
  }, [onBlueBackground, waveformHeight, interact, isSpectrogramMode, isReady]);

  useEffect(() => {
    const applyWaveColors = () => {
      const ws = wsRef.current;
      if (!ws) return;
      const { waveColor, progressColor } = resolveWaveColors(onBlueBackground);
      ws.setOptions({
        waveColor,
        progressColor,
        cursorColor: progressColor,
      });
    };
    applyWaveColors();
    return subscribeColorTheme(applyWaveColors);
  }, [onBlueBackground]);

  // Play/pause sync
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !isReady) return;
    try {
      if (isPlaying && !isMuted) {
        // WebAudio backend: the AudioContext is created at load time (not from a
        // user gesture) and may be suspended by the autoplay policy — resume it.
        const media = ws.getMediaElement() as unknown as { audioContext?: AudioContext };
        if (media?.audioContext?.state === 'suspended') {
          void media.audioContext.resume();
        }
        ws.play();
      } else {
        ws.pause();
      }
    } catch { /* ignore */ }
  }, [isPlaying, isReady, isMuted]);

  // Volume
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (silent || isMuted) {
      ws.setVolume(0);
      return;
    }
    // The audio file is already calibrated to baseVolumeDbfs, so the preview
    // gain is the ratio of the desired level to that base. With the WebAudio
    // backend the GainNode accepts gains > 1, so the displayed dBFS value maps
    // truthfully to the actual output level (up to 0 dBFS).
    const linearVolume = dbfsToLinear(volumeDbfs - baseVolumeDbfs);
    ws.setVolume(Math.max(0, linearVolume));
  }, [volumeDbfs, baseVolumeDbfs, isMuted, silent]);

  const handleStop = useCallback(() => {
    onStop(wsRef.current);
  }, [onStop]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Resize handle drag logic ──────────────────────────────────────────────

  const handleResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = waveformHeight;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [waveformHeight]);

  const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizingRef.current) return;
    const dy = e.clientY - resizeStartYRef.current;
    const newHeight = Math.round(
      Math.min(WAVEFORM_HEIGHT_MAX, Math.max(WAVEFORM_HEIGHT_MIN, resizeStartHeightRef.current + dy))
    );
    setPendingHeight(newHeight);
  }, []);

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const dy = e.clientY - resizeStartYRef.current;
    const finalHeight = Math.round(
      Math.min(WAVEFORM_HEIGHT_MAX, Math.max(WAVEFORM_HEIGHT_MIN, resizeStartHeightRef.current + dy))
    );
    setPendingHeight(null);
    setWaveformHeight(finalHeight);
  }, [setWaveformHeight]);

  // ── Spectrogram frequency label positions ─────────────────────────────────

  const freqToTop = (freq: number): number => {
    const ratio = (freq - SPECTROGRAM_FREQ_MIN) / (SPECTROGRAM_FREQ_MAX - SPECTROGRAM_FREQ_MIN);
    return (1 - ratio) * 100; // percentage from top
  };

  const resolvedBorderColor = borderColor ?? (isMuted ? 'var(--color-secondary-hover)' : color);

  return (
    <div className={className}>
      {/* Waveform container */}
      <div
        ref={outerContainerRef}
        className="rounded overflow-hidden"
        style={{
          border: `2px solid ${resolvedBorderColor}`,
          backgroundColor,
          borderRadius: '8px',
          opacity: isMuted ? 0.5 : 1,
          position: 'relative',
          ...(isSpectrogramMode || pendingHeight !== null ? { height: `${displayHeight}px` } : {}),
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Overlay for pointer interactions */}
        <div
          style={{
            position: 'relative',
            cursor,
            userSelect: pointerHandlers ? 'none' : undefined,
            touchAction: pointerHandlers ? 'none' : undefined,
            ...(isSpectrogramMode || pendingHeight !== null ? { height: `${displayHeight}px` } : {}),
          }}
          {...pointerHandlers}
        >
          {/* WaveSurfer mounts here */}
          <div ref={containerRef} />

          {/* Spectrogram container */}
          <div
            ref={spectrogramContainerRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${displayHeight}px`,
              zIndex: 1,
              display: isSpectrogramMode ? 'block' : 'none',
              pointerEvents: 'none',
            }}
          />

          {/* Frequency labels — only visible on hover in spectrogram mode */}
          {isSpectrogramMode && isHovered && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: '2px',
                width: '40px',
                height: '100%',
                zIndex: 3,
                pointerEvents: 'none',
              }}
            >
              {FREQ_LABELS.map(({ freq, label }) => (
                <div
                  key={freq}
                  style={{
                    position: 'absolute',
                    top: `${freqToTop(freq)}%`,
                    left: 0,
                    transform: 'translateY(-50%)',
                    fontSize: '7px',
                    lineHeight: 1,
                    color: 'var(--color-secondary-hover)',
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    padding: '0 2px',
                    borderRadius: '1px',
                    whiteSpace: 'nowrap',
                    fontWeight: 500,
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          )}

          {children}

          {/* Streaming overlay — shown while a (usually remote saved) audio file
              downloads + decodes, so the waveform area never reads as "broken". */}
          {isLoadingAudio && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 6,
              }}
            >
              <span
                style={{
                  display: 'flex',
                  color: onBlueBackground
                    ? 'var(--color-on-blue-muted)'
                    : 'var(--color-secondary-hover)',
                }}
              >
                <Spinner size={18} />
              </span>
            </div>
          )}
        </div>

        {/* Resize handle — bottom edge */}
        <div
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '6px',
            cursor: 'ns-resize',
            zIndex: 10,
          }}
          title="Drag to resize waveform"
        >
          <div
            style={{
              position: 'absolute',
              bottom: 1,
              left: '50%',
              transform: 'translateX(-50%)',
              width: '24px',
              height: '3px',
              borderRadius: '2px',
              backgroundColor: onBlueBackground ? 'var(--color-on-blue-muted)' : 'var(--color-secondary-hover)',
              opacity: 0.6,
            }}
          />
        </div>
      </div>

      {/* Time display and controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`text-xs ${onBlueBackground ? 'text-on-blue-muted' : 'text-secondary-hover'}`}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          {controlsExtra}
        </div>

        <div className="flex items-center gap-2">
          {/* Play/Pause button */}
          <button
            onClick={onPlayPause}
            disabled={!isReady}
            className="ws-play w-7 h-7 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isPlaying ? color : 'var(--color-primary)',
              color: 'var(--color-on-blue)',
              opacity: isReady ? 1 : 0.5,
              border: 'none',
            }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            disabled={!isReady || !isPlaying}
            className={`ws-stop w-7 h-7 flex items-center justify-center rounded-full transition-colors${isPlaying ? ' ws-stop--live' : ''}`}
            style={{
              backgroundColor: isPlaying ? 'var(--color-surface)' : 'var(--color-secondary-lighter)',
              color: isPlaying ? 'var(--color-error)' : 'var(--color-secondary-hover)',
              opacity: isReady ? 1 : 0.5,
              border: '1px solid var(--color-border-strong)',
            }}
            title="Stop"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function resolveCssVar(variable: string, fallback = '#888888'): string {
  if (typeof window === 'undefined') return fallback;
  if (!variable.startsWith('var(')) return variable;
  const match = variable.match(/var\(\s*(--[^,)]+)/);
  if (!match) return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return val || fallback;
}

function resolveWaveColors(onBlueBackground: boolean): { waveColor: string; progressColor: string } {
  if (onBlueBackground) {
    return {
      waveColor: resolveCssVar('var(--color-on-blue-muted)'),
      progressColor: resolveCssVar('var(--color-on-blue)'),
    };
  }
  return {
    waveColor: resolveCssVar('var(--color-secondary-hover)'),
    progressColor: resolveCssVar('var(--color-primary)'),
  };
}

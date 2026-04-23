'use client';

import { useRef, useEffect, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { API_BASE_URL, UI_COLORS } from '@/utils/constants';

interface DetectionSegment {
  start_sec: number;
  end_sec: number;
}

interface SoundWithSegments {
  name: string;
  detection_segments: DetectionSegment[];
}

interface SEDWaveformPlayerProps {
  audioFile: File;
  audioDuration: number;
  detectedSounds: SoundWithSegments[];
  /** Index of the currently hovered sound in detectedSounds; null = no hover */
  hoveredSoundIndex: number | null;
  /** Per-sound selection mask — regions are hidden for unselected sounds */
  selectedMask: boolean[];
}

/**
 * SEDWaveformPlayer
 *
 * WaveSurfer player for SED analysis results. Renders detection region overlays
 * in --info color, one layer per sound. On hover, non-hovered regions are dimmed.
 */
export function SEDWaveformPlayer({
  audioFile,
  audioDuration,
  detectedSounds,
  hoveredSoundIndex,
  selectedMask,
}: SEDWaveformPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(audioDuration);

  // Create blob URL once per audioFile instance
  const [audioUrl, setAudioUrl] = useState<string>('');
  useEffect(() => {
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !audioUrl) return;

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setIsReady(false);
    setIsPlaying(false);
    setCurrentTime(0);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#9CA3AF',
      progressColor: 'var(--color-success)',
      cursorColor: 'var(--color-success)',
      cursorWidth: 2,
      height: 50,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      fillParent: true,
      interact: true,
      hideScrollbar: true,
    });

    ws.on('ready', () => {
      setIsReady(true);
      setDuration(ws.getDuration());
    });

    ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()));
    ws.on('seeking', () => setCurrentTime(ws.getCurrentTime()));
    ws.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(0);
      ws.seekTo(0);
    });

    ws.on('error', (e: Error) => {
      if (e.name === 'AbortError' || e.message?.includes('aborted')) return;
      console.error('[SEDWaveformPlayer]', e);
    });

    ws.load(audioUrl).catch((e: Error) => {
      if (e.name === 'AbortError' || e.message?.includes('aborted')) return;
      console.error('[SEDWaveformPlayer] load error', e);
    });

    wavesurferRef.current = ws;

    return () => {
      if (abortRef.current) abortRef.current.abort();
      try { ws.destroy(); } catch { /* ignore */ }
      wavesurferRef.current = null;
      setIsReady(false);
    };
  }, [audioUrl]);

  const handlePlayPause = () => {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) return;
    if (isPlaying) {
      ws.pause();
      setIsPlaying(false);
    } else {
      ws.play();
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    ws.pause();
    ws.seekTo(0);
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const totalDur = duration > 0 ? duration : audioDuration || 1;
  const isHovering = hoveredSoundIndex !== null;

  return (
    <div className="space-y-1">
      {/* Waveform + region overlays */}
      <div
        style={{
          position: 'relative',
          border: `2px solid var(--color-success)`,
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: UI_COLORS.DARK_BG,
        }}
      >
        {/* WaveSurfer mounts here */}
        <div ref={containerRef} />

        {/* Detection region overlays — one group per sound (hidden when unchecked) */}
        {detectedSounds.map((sound, soundIdx) => {
          if (!selectedMask[soundIdx]) return null;
          const isActive = hoveredSoundIndex === soundIdx;
          const opacity = isHovering ? (isActive ? 0.55 : 0.04) : 0.18;

          return sound.detection_segments.map((seg, segIdx) => {
            const left = (seg.start_sec / totalDur) * 100;
            const width = ((seg.end_sec - seg.start_sec) / totalDur) * 100;
            return (
              <div
                key={`${soundIdx}-${segIdx}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${left}%`,
                  width: `${width}%`,
                  height: '100%',
                  backgroundColor: 'var(--color-success)',
                  opacity,
                  pointerEvents: 'none',
                  transition: 'opacity 0.15s ease',
                  zIndex: isActive ? 4 : 3,
                }}
              />
            );
          });
        })}
      </div>

      {/* Time + controls row */}
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
          {formatTime(currentTime)} / {formatTime(totalDur)}
        </span>
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={!isReady}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: isPlaying ? 'var(--color-info, #0ea5e9)' : UI_COLORS.NEUTRAL_700,
              color: 'white',
              opacity: isReady ? 1 : 0.5,
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
          {/* Stop */}
          <button
            onClick={handleStop}
            disabled={!isReady}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_700,
              color: 'white',
              opacity: isReady ? 1 : 0.5,
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

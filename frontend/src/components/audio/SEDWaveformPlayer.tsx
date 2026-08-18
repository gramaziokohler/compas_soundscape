'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import type WaveSurfer from 'wavesurfer.js';
import { WaveSurferPlayer } from './WaveSurferPlayer';

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
  hoveredSoundIndex: number | null;
  selectedMask: boolean[];
}

export function SEDWaveformPlayer({
  audioFile,
  audioDuration,
  detectedSounds,
  hoveredSoundIndex,
  selectedMask,
}: SEDWaveformPlayerProps) {
  const wsRef = useRef<WaveSurfer | null>(null);
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

  const handlePlayPause = useCallback(() => {
    setIsPlaying((v) => !v);
  }, []);

  const handleStop = useCallback((ws: WaveSurfer | null) => {
    if (ws) {
      ws.pause();
      ws.seekTo(0);
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleAudioProcess = useCallback((t: number, _dur: number) => {
    setCurrentTime(t);
  }, []);

  const handleFinish = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const totalDur = duration > 0 ? duration : audioDuration || 1;

  return (
    <WaveSurferPlayer
      audioUrl={audioUrl}
      isPlaying={isPlaying}
      onPlayPause={handlePlayPause}
      onStop={handleStop}
      onWavesurferReady={(ws) => { wsRef.current = ws; }}
      onAudioProcess={handleAudioProcess}
      onFinish={handleFinish}
      interact={true}
      className="space-y-1"
      borderColor="var(--color-primary)"
      backgroundColor="var(--background)"
    >
      {/* Detection region overlays — hovered sound only */}
      {detectedSounds.map((sound, soundIdx) => {
        if (!selectedMask[soundIdx]) return null;
        if (hoveredSoundIndex !== soundIdx) return null;

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
                backgroundColor: 'var(--color-primary-hover)',
                opacity: 0.75,
                pointerEvents: 'none',
                transition: 'opacity 0.25s ease',
                zIndex: 4,
              }}
            />
          );
        });
      })}
    </WaveSurferPlayer>
  );
}

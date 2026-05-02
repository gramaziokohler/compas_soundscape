'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import { WAVESURFER_TIMELINE, API_BASE_URL } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';
import { useAudioControlsStore } from '@/store';

interface WaveSurferTimelineProps {
  /** Array of scheduled sounds to display */
  sounds: TimelineSound[];
  /** Current playback time in milliseconds (controlled externally) */
  currentTime?: number;
  /** Callback when user clicks on timeline to seek */
  onSeek?: (timeMs: number) => void;
  /** Callback to reload all available sounds into the timeline */
  onRefresh?: () => void;
  /** Callback to export the full soundscape as a WAV file */
  onDownload?: () => Promise<void>;
}

interface WaveSurferInstance {
  id: string;
  wavesurfer: WaveSurfer;
  soundId: string;
  iterationIndex: number;
  startTimeMs: number;
  endTimeMs: number;
}

/**
 * WaveSurferTimeline Component
 *
 * Unified timeline with one track per sound, multiple waveform chunks per track
 * (one per scheduled iteration). Width is dynamically sized to total audio content.
 * Static low-resolution waveforms for performance — no zoom, no per-frame seeking.
 */
export function WaveSurferTimeline({
  sounds,
  currentTime = 0,
  onSeek,
  onRefresh,
  onDownload,
}: WaveSurferTimelineProps) {
  const mutedSounds        = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound        = useAudioControlsStore((s) => s.soloedSound);
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const timelineWaveSurferRef = useRef<WaveSurfer | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [waveSurferInstances, setWaveSurferInstances] = useState<WaveSurferInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const timeOffsetRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(false);
  const instancesValidRef = useRef<boolean>(false);
  const initializationIdRef = useRef<number>(0);

  const PIXELS_PER_SECOND = WAVESURFER_TIMELINE.PIXELS_PER_SECOND;

  // Generate stable hash of sounds data to detect actual changes (includes timeline duration)
  const soundsHash = useMemo(() => {
    if (sounds.length === 0) return 'empty';
    const base = sounds.map(s =>
      `${s.id}-${s.audioUrl}-${s.scheduledIterations.join(',')}-${s.soundDurationMs}-${s.intervalMs}`
    ).join('|');
    return `${base}@${timelineDurationMs}`;
  }, [sounds, timelineDurationMs]);

  // Fixed timeline duration in seconds (from store)
  const actualDuration = timelineDurationMs / 1000;

  const TIMELINE_WIDTH = actualDuration * PIXELS_PER_SECOND;

  // Derived iteration count for header display (avoids depending on waveSurferInstances)
  const totalIterations = useMemo(
    () => sounds.reduce((acc, s) => acc + s.scheduledIterations.length, 0),
    [sounds]
  );

  /**
   * Initialize WaveSurfer instances for each sound iteration.
   * Uses initialization ID to handle React Strict Mode double-invocation.
   */
  useEffect(() => {
    const currentInitId = ++initializationIdRef.current;

    if (isInitializingRef.current) {
      return;
    }

    if (!containerRef.current || sounds.length === 0) {
      setIsLoading(false);
      setWaveSurferInstances([]);
      return;
    }

    isInitializingRef.current = true;
    setIsLoading(true);
    setLoadError(null);

    // Clear container before creating new tracks
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    const pixelsPerSecond = WAVESURFER_TIMELINE.PIXELS_PER_SECOND;
    const timelineWidth = actualDuration * pixelsPerSecond;

    // Find the earliest timestamp to normalize positions
    let minTimestampMs = Infinity;
    sounds.forEach((sound) => {
      sound.scheduledIterations.forEach((timestamp) => {
        if (timestamp < minTimestampMs) {
          minTimestampMs = timestamp;
        }
      });
    });

    if (!isFinite(minTimestampMs)) {
      minTimestampMs = 0;
    }

    timeOffsetRef.current = minTimestampMs;

    const newInstances: WaveSurferInstance[] = [];
    const loadPromises: Promise<void>[] = [];

    sounds.forEach((sound) => {
      if (!sound.audioUrl) {
        console.warn(`[WaveSurferTimeline] No audioUrl for sound ${sound.displayName}, skipping`);
        return;
      }

      const audioUrlBase = sound.audioUrl;

      // Create track container for this sound
      const trackContainer = document.createElement('div');
      trackContainer.id = `track-${sound.id}`;
      trackContainer.style.position = 'relative';
      trackContainer.style.height = `${WAVESURFER_TIMELINE.TRACK_HEIGHT}px`;
      trackContainer.style.marginBottom = `${WAVESURFER_TIMELINE.TRACK_SPACING}px`;
      // Shift track right by initialDelayMs; shrink width by the same amount so the
      // right edge stays exactly at timelineWidth (prevents overflow → no spurious scrollbar).
      const initDelayPx = ((sound.initialDelayMs ?? 0) / 1000) * pixelsPerSecond;
      trackContainer.style.width = `${Math.max(0, timelineWidth - initDelayPx)}px`;
      trackContainer.style.backgroundColor = 'var(--color-secondary)';
      if (initDelayPx > 0) trackContainer.style.transform = `translateX(${initDelayPx}px)`;
      containerRef.current?.appendChild(trackContainer);

      // Add track label
      const labelContainer = document.createElement('div');
      labelContainer.id = `label-${sound.id}`;
      labelContainer.style.position = 'absolute';
      labelContainer.style.left = '5px';
      labelContainer.style.top = '5px';
      labelContainer.style.color = 'var(--foreground)';
      labelContainer.style.fontSize = '12px';
      labelContainer.style.fontWeight = 'bold';
      labelContainer.style.zIndex = '10';
      labelContainer.style.pointerEvents = 'none';
      labelContainer.textContent = sound.displayName.substring(0, 20);
      trackContainer.appendChild(labelContainer);

      // Determine mute state at init time
      const isSoundMuted = soloedSound !== null
        ? sound.id !== soloedSound
        : mutedSounds.has(sound.id);
      const waveformColor = isSoundMuted
        ? 'var(--color-secondary-hover)'
        : 'var(--color-secondary-hover)';

      // Create WaveSurfer instance for each scheduled iteration
      const delay = sound.initialDelayMs ?? 0;
      sound.scheduledIterations.forEach((timestamp, iterationIndex) => {
        const startTimeMs = timestamp;
        const endTimeMs = timestamp + sound.soundDurationMs;

        // Skip iterations that start at or after the fixed timeline boundary (accounting for delay)
        if (delay + startTimeMs >= timelineDurationMs) {
          return;
        }

        // Clip the visual end at the fixed boundary (track-local boundary = timelineDurationMs - delay)
        const clippedEndTimeMs = Math.min(endTimeMs, timelineDurationMs - delay);

        const normalizedStartMs = startTimeMs - minTimestampMs;
        const normalizedClippedEndMs = clippedEndTimeMs - minTimestampMs;

        const leftPx = (normalizedStartMs / 1000) * pixelsPerSecond;
        const widthPx = ((normalizedClippedEndMs - normalizedStartMs) / 1000) * pixelsPerSecond;

        // Create container for this iteration
        const iterationContainer = document.createElement('div');
        iterationContainer.id = `waveform-${sound.id}-${iterationIndex}`;
        iterationContainer.style.position = 'absolute';
        iterationContainer.style.left = `${leftPx}px`;
        iterationContainer.style.top = '10px';
        iterationContainer.style.width = `${widthPx}px`;
        iterationContainer.style.height = `${WAVESURFER_TIMELINE.ITERATION_HEIGHT}px`;
        iterationContainer.style.borderRadius = '4px';
        iterationContainer.style.overflow = 'hidden';
        iterationContainer.style.boxSizing = 'border-box';
        trackContainer.appendChild(iterationContainer);

        try {
          const wavesurfer = WaveSurfer.create({
            container: iterationContainer,
            waveColor: waveformColor,
            progressColor: waveformColor,
            cursorColor: 'transparent',
            cursorWidth: 0,
            height: WAVESURFER_TIMELINE.ITERATION_HEIGHT,
            barWidth: WAVESURFER_TIMELINE.BAR_WIDTH,
            barGap: WAVESURFER_TIMELINE.BAR_GAP,
            barRadius: WAVESURFER_TIMELINE.BAR_RADIUS,
            normalize: true,
            fillParent: true,
            interact: false,
            hideScrollbar: true,
          });

          wavesurfer.on('error', (error) => {
            if (error.name !== 'AbortError') {
              console.error(`[WaveSurferTimeline] Error loading ${sound.displayName} iteration ${iterationIndex}:`, error);
            }
          });

          let audioUrl: string;
          if (
            audioUrlBase.startsWith('http://') ||
            audioUrlBase.startsWith('https://') ||
            audioUrlBase.startsWith('blob:')
          ) {
            audioUrl = audioUrlBase;
          } else {
            audioUrl = `${API_BASE_URL}${audioUrlBase}`;
          }

          const instanceId = `${sound.id}-${iterationIndex}`;

          const loadPromise = wavesurfer
            .load(audioUrl)
            .then(() => {
              const borderColor = isSoundMuted ? 'var(--color-secondary-hover)' : sound.color;
              iterationContainer.style.border = `2px solid ${borderColor}`;
              const wrapper = wavesurfer.getWrapper();
              if (wrapper) {
                wrapper.style.border = 'none';
              }
            })
            .catch((error) => {
              if (error.name !== 'AbortError') {
                console.error(`[WaveSurferTimeline] Failed to load ${sound.displayName}:`, error);
              }
            });

          loadPromises.push(loadPromise);

          newInstances.push({
            id: instanceId,
            wavesurfer,
            soundId: sound.id,
            iterationIndex,
            startTimeMs,
            endTimeMs,
          });
        } catch (error) {
          console.error(`[WaveSurferTimeline] Failed to create WaveSurfer for ${sound.displayName} iteration ${iterationIndex}:`, error);
        }
      });
    });

    Promise.all(loadPromises)
      .then(() => {
        if (initializationIdRef.current === currentInitId) {
          instancesValidRef.current = true;
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('[WaveSurferTimeline] Error loading waveforms:', error);
        }
      })
      .finally(() => {
        if (initializationIdRef.current === currentInitId) {
          setIsLoading(false);
          isInitializingRef.current = false;
        }
      });

    setWaveSurferInstances(newInstances);

    return () => {
      instancesValidRef.current = false;

      newInstances.forEach((instance) => {
        try {
          if (instance.wavesurfer) {
            instance.wavesurfer.destroy();
          }
        } catch (error) {
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error('[WaveSurferTimeline] Error destroying instance:', error);
          }
        }
      });

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      setWaveSurferInstances([]);
      setIsLoading(false);
      isInitializingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundsHash, mutedSounds, soloedSound]);

  /**
   * Sync track labels when sound display names change.
   * Updates DOM labels without recreating WaveSurfer instances.
   */
  useEffect(() => {
    sounds.forEach((sound) => {
      const labelEl = document.getElementById(`label-${sound.id}`);
      if (labelEl) {
        labelEl.textContent = sound.displayName.substring(0, 20);
      }
    });
  }, [sounds]);

  /**
   * Sync track CSS translateX when initialDelayMs changes (e.g. after play-all scheduling).
   * Runs independently of soundsHash so WaveSurfer instances are NOT rebuilt.
   */
  useEffect(() => {
    sounds.forEach((sound) => {
      const trackEl = document.getElementById(`track-${sound.id}`);
      if (!trackEl) return;
      const delayPx = ((sound.initialDelayMs ?? 0) / 1000) * PIXELS_PER_SECOND;
      trackEl.style.transform = delayPx > 0 ? `translateX(${delayPx}px)` : '';
      trackEl.style.width = `${Math.max(0, TIMELINE_WIDTH - delayPx)}px`;
    });
  }, [sounds, PIXELS_PER_SECOND, TIMELINE_WIDTH]);

  /**
   * Add timeline ruler at the top.
   */
  useEffect(() => {
    if (!timelineContainerRef.current) return;

    timelineContainerRef.current.innerHTML = '';

    if (timelineWaveSurferRef.current) {
      try {
        timelineWaveSurferRef.current.destroy();
      } catch (e) {
        // Ignore
      }
      timelineWaveSurferRef.current = null;
    }

    const timelineWavesurfer = WaveSurfer.create({
      container: timelineContainerRef.current,
      height: 0,
      cursorWidth: 0,
    });

    timelineWaveSurferRef.current = timelineWavesurfer;

    timelineWavesurfer.registerPlugin(
      TimelinePlugin.create({
        height: 30,
        timeInterval: WAVESURFER_TIMELINE.TIME_INTERVAL,
        primaryLabelInterval: WAVESURFER_TIMELINE.PRIMARY_LABEL_INTERVAL,
        secondaryLabelInterval: WAVESURFER_TIMELINE.TIME_INTERVAL,
        style: {
          fontSize: '11px',
          color: 'var(--foreground)',
        },
      })
    );

    const emptyAudioUrl = createEmptyAudioDataUrl(actualDuration);

    setTimeout(() => {
      if (timelineWaveSurferRef.current) {
        timelineWaveSurferRef.current.load(emptyAudioUrl).catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('[WaveSurferTimeline] Error loading timeline ruler:', error);
          }
        });
      }
    }, 50);

    return () => {
      if (timelineWaveSurferRef.current) {
        try {
          timelineWaveSurferRef.current.destroy();
        } catch (e) {
          // Ignore
        }
        timelineWaveSurferRef.current = null;
      }
    };
  }, [timelineDurationMs]);

  /**
   * Sync cursor position with external currentTime and auto-scroll.
   * Tracks are positioned by CSS translateX (initialDelayMs), so cursor uses raw currentTime.
   */
  useEffect(() => {
    if (!cursorRef.current || !scrollContainerRef.current) return;

    // No timeOffset subtraction — track positions are shifted by CSS transform instead
    const cursorPosition = (currentTime / 1000) * PIXELS_PER_SECOND;
    cursorRef.current.style.left = `${cursorPosition}px`;

    const scrollContainer = scrollContainerRef.current;
    const containerWidth = scrollContainer.clientWidth;
    const scrollLeft = scrollContainer.scrollLeft;

    if (cursorPosition < scrollLeft || cursorPosition > scrollLeft + containerWidth) {
      scrollContainer.scrollTo({
        left: Math.max(0, cursorPosition - containerWidth / 2),
        behavior: 'auto',
      });
    }
  }, [currentTime]);

  /**
   * Update waveform colors and borders for mute/solo state changes.
   * Does not depend on playback state — static color scheme only.
   */
  useEffect(() => {
    if (waveSurferInstances.length === 0) return;

    waveSurferInstances.forEach((instance) => {
      if (!instance.wavesurfer) return;

      try {
        const isSoundMuted = soloedSound !== null
          ? instance.soundId !== soloedSound
          : mutedSounds.has(instance.soundId);

        const waveformColor = isSoundMuted
          ? 'var(--color-secondary-hover)'
          : 'var(--color-secondary-hover)';

        instance.wavesurfer.setOptions({
          waveColor: waveformColor,
          progressColor: waveformColor,
        });


      } catch (error) {
        console.debug('[WaveSurferTimeline] Error updating mute/solo colors:', error);
      }
    });
  }, [mutedSounds, soloedSound, waveSurferInstances, sounds]);

  /**
   * Handle click on timeline to seek.
   */
  const handleTimelineClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !scrollContainerRef.current) return;

      const rect = scrollContainerRef.current.getBoundingClientRect();
      const clickX = event.clientX - rect.left + scrollContainerRef.current.scrollLeft;
      const timeSeconds = clickX / PIXELS_PER_SECOND;
      const timeMs = timeSeconds * 1000;

      onSeek(Math.max(0, Math.min(timeMs, actualDuration * 1000)));
    },
    [onSeek, actualDuration]
  );

  /**
   * Handle soundscape WAV export.
   */
  const handleDownload = useCallback(async () => {
    if (!onDownload || isDownloading) return;
    setIsDownloading(true);
    try {
      await onDownload();
    } catch (err) {
      console.error('[WaveSurferTimeline] Export failed:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [onDownload, isDownloading]);

  const hasSounds = sounds.length > 0;

  if (!hasSounds) {
    return (
      <div
        className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 p-6 text-center"
        style={{ minHeight: `${WAVESURFER_TIMELINE.TRACK_HEIGHT}px` }}
      >
        <p className="text-neutral-400 text-sm">No sounds are playing</p>
      </div>
    );
  }

  // Outer width is the full timeline width, capped visually at 60vw via maxWidth.
  const componentWidth = Math.max(TIMELINE_WIDTH, WAVESURFER_TIMELINE.MIN_WIDTH) + 2;

  return (
    <div
      className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden"
      style={{ zIndex: 1000, position: 'relative', width: `${componentWidth}px`, maxWidth: '60vw' }}
    >
      {/* Header — full container width, does not scroll */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/60">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Timeline</h3>
          <span className="text-xs text-neutral-400">
            {sounds.length} sound{sounds.length !== 1 ? 's' : ''} • {totalIterations} iteration{totalIterations !== 1 ? 's' : ''} • {actualDuration}s
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => onRefresh?.()}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{
              color: 'var(--color-primary)',
              backgroundColor: 'var(--background)',
              border: '1px solid'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-primary-light)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--background)'}
            title="Reload all available sounds into the timeline"
          >
            Reload
          </button>
          {onDownload && (
            <button
              onClick={handleDownload}
              disabled={isDownloading || isLoading}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{
                color: 'var(--color-primary)',
                backgroundColor: 'var(--background)',
                border: '1px solid'
              }}
              onMouseEnter={(e) => {
                if (!isDownloading && !isLoading) e.currentTarget.style.backgroundColor = 'var(--color-primary-light)';
              }}
              onMouseLeave={(e) => {
                if (!isDownloading && !isLoading) e.currentTarget.style.backgroundColor = 'var(--background)';
              }}
              title={isDownloading ? 'Rendering soundscape…' : 'Download full soundscape as stereo WAV (includes spatial audio)'}
            >
              {isDownloading ? 'Rendering…' : '↓ Download'}
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="p-4 text-center border-b border-white/10">
          <p className="text-sm text-neutral-400">Loading waveforms...</p>
        </div>
      )}

      {/* Error State */}
      {loadError && (
        <div className="p-4 bg-error/10 border-b border-error/30">
          <p className="text-sm text-error">{loadError}</p>
        </div>
      )}

      {/* Unified scrollable area: ruler + tracks scroll together horizontally.
          maxHeight limits vertical growth; overflow-x-auto adds a scrollbar when
          componentWidth > 60vw (the outer div's maxWidth). */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto overflow-y-auto timeline-hscroll"
        style={{
          maxHeight: `${WAVESURFER_TIMELINE.TOTAL_HEIGHT + 30}px`,
          backgroundColor: 'var(--background)',
        }}
        onClick={handleTimelineClick}
      >
        {/* Timeline Ruler — sticky so it stays visible when scrolling vertically */}
        <div
          ref={timelineContainerRef}
          style={{
            width: `${TIMELINE_WIDTH}px`,
            backgroundColor: 'var(--background)',
            minHeight: '30px',
            position: 'sticky',
            top: 0,
            zIndex: 5,
          }}
        />

        {/* Waveform Tracks */}
        <div ref={containerRef} className="relative" />

        {/* Global Cursor — spans ruler + tracks */}
        <div
          ref={cursorRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${WAVESURFER_TIMELINE.CURSOR_WIDTH}px`,
            height: '100%',
            backgroundColor: 'var(--color-primary)',
            pointerEvents: 'none',
            zIndex: 100,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Create an empty audio data URL of specified duration (for the timeline ruler).
 */
function createEmptyAudioDataUrl(durationSeconds: number): string {
  const sampleRate = 44100;
  const numChannels = 1;
  const numSamples = sampleRate * durationSeconds;

  const buffer = new Float32Array(numSamples);
  const wavData = encodeWAV(buffer, sampleRate, numChannels);
  const blob = new Blob([wavData], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Encode Float32Array to WAV format.
 */
function encodeWAV(samples: Float32Array, sampleRate: number, numChannels: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

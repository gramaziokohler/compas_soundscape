'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.js';
import { WAVESURFER_TIMELINE, API_BASE_URL } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';

interface WaveSurferTimelineProps {
  /** Array of scheduled sounds to display */
  sounds: TimelineSound[];
  /** Optional timeline duration in milliseconds (calculated from sounds) */
  duration?: number;
  /** Current playback time in milliseconds (controlled externally) */
  currentTime?: number;
  /** Whether timeline is currently playing (controlled externally) */
  isPlaying?: boolean;
  /** Callback when user clicks on timeline to seek */
  onSeek?: (timeMs: number) => void;
  /** Individual sound states - used to disable progress color for individual playback */
  individualSoundStates?: { [key: string]: 'playing' | 'paused' | 'stopped' };
  /** Set of muted sound IDs */
  mutedSounds?: Set<string>;
  /** ID of the soloed sound */
  soloedSound?: string | null;
  /** Callback to reload all available sounds into the timeline */
  onRefresh?: () => void;
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
 * WaveSurferTimeline Component (Unified Timeline Architecture)
 *
 * Enhanced timeline using WaveSurfer.js with a unified timeline dynamically sized to content.
 *
 * Architecture:
 * - Dynamic timeline duration based on actual audio content
 * - One track (row) per sound
 * - Multiple horizontal waveform instances per track (one per scheduled iteration)
 * - Single cursor overlay synchronized across all instances
 * - Click-to-seek anywhere on timeline
 * - Optimized to prevent unnecessary reinitialization
 */
export function WaveSurferTimeline({
  sounds,
  currentTime = 0,
  onSeek,
  individualSoundStates = {},
  mutedSounds = new Set(),
  soloedSound = null,
  onRefresh,
}: WaveSurferTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const timelineWaveSurferRef = useRef<WaveSurfer | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [waveSurferInstances, setWaveSurferInstances] = useState<WaveSurferInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(WAVESURFER_TIMELINE.DEFAULT_ZOOM);
  const timeOffsetRef = useRef<number>(0);
  const isInitializingRef = useRef<boolean>(false);
  const instancesValidRef = useRef<boolean>(false);
  const initializationIdRef = useRef<number>(0);

  // Generate stable hash of sounds data to detect actual changes
  const soundsHash = useMemo(() => {
    if (sounds.length === 0) return 'empty';
    return sounds.map(s =>
      `${s.id}-${s.audioUrl}-${s.scheduledIterations.join(',')}-${s.soundDurationMs}-${s.intervalMs}`
    ).join('|');
  }, [sounds]);

  // Calculate actual timeline duration from sounds
  const actualDuration = useMemo(() => {
    let maxEndTime = 0;
    sounds.forEach((sound) => {
      sound.scheduledIterations.forEach((timestamp) => {
        const endTime = timestamp + sound.soundDurationMs;
        if (endTime > maxEndTime) {
          maxEndTime = endTime;
        }
      });
    });

    if (maxEndTime > 0) {
      const bufferTimeSeconds = (maxEndTime / 1000) * 1.1;
      return Math.ceil(bufferTimeSeconds / 30) * 30;
    }
    return WAVESURFER_TIMELINE.FIXED_DURATION_SECONDS;
  }, [sounds]);

  // Calculate these values but DON'T use them in initialization effect dependencies
  const PIXELS_PER_SECOND = WAVESURFER_TIMELINE.PIXELS_PER_SECOND * zoom;
  const TIMELINE_WIDTH = actualDuration * PIXELS_PER_SECOND;

  /**
   * Initialize WaveSurfer instances for each sound iteration
   * Uses initialization ID to handle React Strict Mode double-invocation
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

    // Clear container BEFORE creating new tracks (prevents double tracks from Strict Mode)
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    // Calculate PIXELS_PER_SECOND and TIMELINE_WIDTH at initialization time
    const pixelsPerSecond = WAVESURFER_TIMELINE.PIXELS_PER_SECOND * zoom;
    const timelineWidth = actualDuration * pixelsPerSecond;

    // Find the earliest timestamp across all sounds to normalize positions
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
      trackContainer.style.width = `${timelineWidth}px`;
      trackContainer.style.backgroundColor = WAVESURFER_TIMELINE.TRACK_BACKGROUND_COLOR;
      containerRef.current?.appendChild(trackContainer);

      // Add track label
      const labelContainer = document.createElement('div');
      labelContainer.style.position = 'absolute';
      labelContainer.style.left = '5px';
      labelContainer.style.top = '5px';
      labelContainer.style.color = WAVESURFER_TIMELINE.TEXT_COLOR;
      labelContainer.style.fontSize = '12px';
      labelContainer.style.fontWeight = 'bold';
      labelContainer.style.zIndex = '10';
      labelContainer.style.pointerEvents = 'none';
      labelContainer.textContent = sound.displayName.substring(0, 20);
      trackContainer.appendChild(labelContainer);

      // Create WaveSurfer instance for each scheduled iteration
      sound.scheduledIterations.forEach((timestamp, iterationIndex) => {
        const startTimeMs = timestamp;
        const endTimeMs = timestamp + sound.soundDurationMs;

        if (startTimeMs >= actualDuration * 1000) {
          return;
        }

        const normalizedStartMs = startTimeMs - minTimestampMs;
        const normalizedEndMs = endTimeMs - minTimestampMs;

        const leftPx = (normalizedStartMs / 1000) * pixelsPerSecond;
        const widthPx = ((normalizedEndMs - normalizedStartMs) / 1000) * pixelsPerSecond;

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
        iterationContainer.style.boxSizing = 'border-box'; // Ensure border doesn't add to dimensions
        trackContainer.appendChild(iterationContainer);

        try {
          // Determine if this sound should be greyed out (muted or not soloed)
          const isSoundMuted = soloedSound !== null 
            ? sound.id !== soloedSound  // If solo is active, mute all except soloed
            : mutedSounds.has(sound.id); // Otherwise check if explicitly muted
          
          const waveformColor = isSoundMuted 
            ? WAVESURFER_TIMELINE.MUTED_COLOR  // Grey color for muted sounds
            : WAVESURFER_TIMELINE.WAVEFORM_COLOR;
          
          const progressColorValue = isSoundMuted
            ? WAVESURFER_TIMELINE.MUTED_COLOR  // Grey for muted sounds
            : WAVESURFER_TIMELINE.WAVEFORM_COLOR; // Normal color for active sounds
          
          // Initialize WaveSurfer instance for this iteration
          const wavesurfer = WaveSurfer.create({
            container: iterationContainer,
            waveColor: waveformColor,
            progressColor: progressColorValue,
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
            // Suppress AbortErrors from Strict Mode cleanup
            if (error.name !== 'AbortError') {
              console.error(`[WaveSurferTimeline] Error loading ${sound.displayName} iteration ${iterationIndex}:`, error);
            }
          });

          // Prepare audio URL
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
              const borderColor = isSoundMuted ? WAVESURFER_TIMELINE.MUTED_COLOR : sound.color;
              iterationContainer.style.border = `2px solid ${borderColor}`;
              
              // Ensure WaveSurfer's internal wrapper doesn't have a border
              const wrapper = wavesurfer.getWrapper();
              if (wrapper) {
                wrapper.style.border = 'none';
              }
            })
            .catch((error) => {
              // Ignore abort errors during cleanup
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

    // Wait for all waveforms to load
    Promise.all(loadPromises)
      .then(() => {
        // Only update state if this initialization wasn't cancelled
        if (initializationIdRef.current === currentInitId) {
          instancesValidRef.current = true;
        }
      })
      .catch((error) => {
        // Ignore abort errors
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

    // Cleanup
    return () => {
      // Mark instances as invalid before destroying
      instancesValidRef.current = false;

      newInstances.forEach((instance) => {
        try {
          if (instance.wavesurfer) {
            instance.wavesurfer.destroy();
          }
        } catch (error) {
          // Ignore errors during cleanup
          if (error instanceof Error && error.name !== 'AbortError') {
            console.error('[WaveSurferTimeline] Error destroying instance:', error);
          }
        }
      });

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      // Clear state and reset flags
      setWaveSurferInstances([]);
      setIsLoading(false);
      isInitializingRef.current = false;
    };
    // Depend on soundsHash and mute/solo state to update waveform colors
    // instancesValidRef tracks validity without causing re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundsHash, mutedSounds, soloedSound]);

  /**
   * Handle zoom changes by updating layout WITHOUT recreating WaveSurfer instances
   */
  useEffect(() => {
    if (!containerRef.current || waveSurferInstances.length === 0) return;

    sounds.forEach((sound) => {
      const trackContainer = document.getElementById(`track-${sound.id}`);
      if (trackContainer) {
        trackContainer.style.width = `${TIMELINE_WIDTH}px`;
      }

      sound.scheduledIterations.forEach((timestamp, iterationIndex) => {
        const startTimeMs = timestamp;
        const endTimeMs = timestamp + sound.soundDurationMs;

        if (startTimeMs >= actualDuration * 1000) return;

        const normalizedStartMs = startTimeMs - timeOffsetRef.current;
        const normalizedEndMs = endTimeMs - timeOffsetRef.current;

        const leftPx = (normalizedStartMs / 1000) * PIXELS_PER_SECOND;
        const widthPx = ((normalizedEndMs - normalizedStartMs) / 1000) * PIXELS_PER_SECOND;

        const iterationContainer = document.getElementById(`waveform-${sound.id}-${iterationIndex}`);
        if (iterationContainer) {
          iterationContainer.style.left = `${leftPx}px`;
          iterationContainer.style.width = `${widthPx}px`;
        }
      });
    });

    waveSurferInstances.forEach((instance) => {
      if (instance.wavesurfer && instance.wavesurfer.getDuration() > 0) {
        try {
          instance.wavesurfer.zoom(PIXELS_PER_SECOND);
        } catch (error) {
          // Ignore zoom errors during state changes
        }
      }
    });
  }, [zoom, sounds, waveSurferInstances, PIXELS_PER_SECOND, TIMELINE_WIDTH, actualDuration]);

  /**
   * Add timeline ruler at the top
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
          color: WAVESURFER_TIMELINE.TEXT_COLOR,
        },
      })
    );

    const emptyAudioUrl = createEmptyAudioDataUrl(actualDuration);

    // Small delay to ensure proper rendering
    setTimeout(() => {
      if (timelineWaveSurferRef.current) {
        timelineWaveSurferRef.current.load(emptyAudioUrl).catch((error) => {
          // Ignore abort errors
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
  }, [zoom, actualDuration]);

  /**
   * Sync cursor position with external currentTime and auto-scroll
   */
  useEffect(() => {
    if (!cursorRef.current || !scrollContainerRef.current) return;

    const normalizedTime = currentTime - timeOffsetRef.current;
    const cursorPosition = (normalizedTime / 1000) * PIXELS_PER_SECOND;
    cursorRef.current.style.left = `${cursorPosition}px`;

    const scrollContainer = scrollContainerRef.current;
    const containerWidth = scrollContainer.clientWidth;
    const scrollLeft = scrollContainer.scrollLeft;
    const scrollRight = scrollLeft + containerWidth;

    if (cursorPosition < scrollLeft || cursorPosition > scrollRight) {
      const targetScroll = cursorPosition - containerWidth / 2;
      scrollContainer.scrollTo({
        left: Math.max(0, targetScroll),
        behavior: 'smooth',
      });
    }

    waveSurferInstances.forEach((instance) => {
      if (!instance.wavesurfer) return;

      if (currentTime >= instance.startTimeMs && currentTime < instance.endTimeMs) {
        const relativeTime = currentTime - instance.startTimeMs;
        const duration = instance.endTimeMs - instance.startTimeMs;
        const progress = relativeTime / duration;

        if (instance.wavesurfer.getDuration() > 0) {
          try {
            instance.wavesurfer.seekTo(Math.max(0, Math.min(1, progress)));
          } catch (error) {
            // Ignore seek errors
          }
        }
      } else if (currentTime < instance.startTimeMs) {
        if (instance.wavesurfer.getDuration() > 0) {
          try {
            instance.wavesurfer.seekTo(0);
          } catch (error) {
            // Ignore seek errors
          }
        }
      }
    });
  }, [currentTime, waveSurferInstances, PIXELS_PER_SECOND]);

  /**
   * Update waveform colors, progress colors, and borders
   * Combines playback mode detection with mute/solo visual feedback
   * This updates existing instances without recreating them (performance optimization)
   */
  useEffect(() => {
    if (waveSurferInstances.length === 0) return;

    // Count total sounds in session to determine timeline mode
    const soundsInSession = Object.entries(individualSoundStates).filter(
      ([_, state]) => state === 'playing' || state === 'paused'
    );
    const isTimelineMode = soundsInSession.length >= 2;

    waveSurferInstances.forEach((instance) => {
      if (!instance.wavesurfer) return;

      try {
        // Determine if this sound should be greyed out
        const isSoundMuted = soloedSound !== null 
          ? instance.soundId !== soloedSound  // If solo is active, mute all except soloed
          : mutedSounds.has(instance.soundId); // Otherwise check if explicitly muted
        
        const waveformColor = isSoundMuted 
          ? WAVESURFER_TIMELINE.MUTED_COLOR  // Grey color for muted sounds
          : WAVESURFER_TIMELINE.WAVEFORM_COLOR;
        
        // Determine progress color based on playback state AND mute state
        const soundState = individualSoundStates[instance.soundId];
        const isSoundPlaying = soundState === 'playing';
        
        // Show pink progress only if:
        // 1. This sound is playing AND
        // 2. We're in timeline mode (2+ sounds in session) AND
        // 3. Sound is NOT muted
        const progressColor = (isSoundPlaying && isTimelineMode && !isSoundMuted)
          ? WAVESURFER_TIMELINE.PROGRESS_COLOR // Pink for playing sound in timeline mode
          : waveformColor; // Grey for muted, paused, or individual mode
        
        // Update waveform and progress colors
        instance.wavesurfer.setOptions({ 
          waveColor: waveformColor,
          progressColor: progressColor
        });

        // Update border color
        const container = instance.wavesurfer.getWrapper().parentElement;
        if (container) {
          // Find the sound data to get its color
          const soundData = sounds.find((s: TimelineSound) => s.id === instance.soundId);
          if (soundData) {
            const borderColor = isSoundMuted ? WAVESURFER_TIMELINE.MUTED_COLOR : soundData.color;
            container.style.border = `2px solid ${borderColor}`;
          }
        }
      } catch (error) {
        // Ignore errors during option updates
        console.debug('[WaveSurferTimeline] Error updating mute/solo colors:', error);
      }
    });
  }, [mutedSounds, soloedSound, waveSurferInstances, sounds, individualSoundStates]);

  /**
   * Handle click on timeline to seek
   */
  const handleTimelineClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onSeek || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clickX = event.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0);
      const timeSeconds = clickX / PIXELS_PER_SECOND;
      const timeMs = timeSeconds * 1000;

      onSeek(Math.max(0, Math.min(timeMs, actualDuration * 1000)));
    },
    [onSeek, PIXELS_PER_SECOND, actualDuration]
  );

  /**
   * Handle zoom changes
   */
  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(newZoom);
  }, []);

  const hasSounds = sounds.length > 0;

  if (!hasSounds) {
    return (
      <div
        className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 p-6 text-center"
        style={{ minHeight: `${WAVESURFER_TIMELINE.TRACK_HEIGHT}px` }}
      >
        <p className="text-gray-400 text-sm">No sounds are playing</p>
      </div>
    );
  }

  return (
    <div
      className="bg-black/80 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden"
      style={{ zIndex: 1000, position: 'relative' }}
    >
      {/* Header with Title and Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/60">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">
            Timeline
          </h3>
          <span className="text-xs text-gray-400">
            {sounds.length} sound{sounds.length !== 1 ? 's' : ''} • {waveSurferInstances.length} iteration{waveSurferInstances.length !== 1 ? 's' : ''} • {actualDuration}s
          </span>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400">Zoom:</label>
          <input
            type="range"
            min={WAVESURFER_TIMELINE.MIN_ZOOM}
            max={WAVESURFER_TIMELINE.MAX_ZOOM}
            step={WAVESURFER_TIMELINE.ZOOM_STEP}
            value={zoom}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            className="w-32 h-2 rounded-lg appearance-none cursor-pointer accent-primary"
            style={{ 
              cursor: 'pointer',
              backgroundColor: 'rgba(156, 163, 175, 0.3)'
            }}
          />
          <span className="text-xs text-gray-400 min-w-[3rem]">{zoom.toFixed(1)}x</span>
          <button
            onClick={() => onRefresh?.()}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{
              color: '#F500B8',
              backgroundColor: 'rgba(245, 0, 184, 0.1)',
              border: '1px solid rgba(245, 0, 184, 0.3)'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(245, 0, 184, 0.2)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(245, 0, 184, 0.1)'}
            title="Reload all available sounds into the timeline"
          >
            Reload
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="p-4 text-center border-b border-white/10">
          <p className="text-sm text-gray-400">Loading waveforms...</p>
        </div>
      )}

      {/* Error State */}
      {loadError && (
        <div className="p-4 bg-red-900/20 border-b border-red-900/50">
          <p className="text-sm text-red-400">{loadError}</p>
        </div>
      )}

      {/* Timeline Ruler */}
      <div className="border-b border-white/10">
        <div
          ref={timelineContainerRef}
          style={{
            width: `${TIMELINE_WIDTH}px`,
            backgroundColor: WAVESURFER_TIMELINE.BACKGROUND_COLOR,
            minHeight: '30px',
          }}
        />
      </div>

      {/* Tracks Container with Cursor */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto overflow-y-auto max-h-96"
        style={{ backgroundColor: WAVESURFER_TIMELINE.BACKGROUND_COLOR }}
        onClick={handleTimelineClick}
      >
        {/* Waveform Tracks */}
        <div ref={containerRef} className="relative" />

        {/* Global Cursor */}
        <div
          ref={cursorRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${WAVESURFER_TIMELINE.CURSOR_WIDTH}px`,
            height: '100%',
            backgroundColor: WAVESURFER_TIMELINE.CURSOR_COLOR,
            pointerEvents: 'none',
            zIndex: 100,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Create an empty audio data URL of specified duration
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
 * Encode Float32Array to WAV format
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

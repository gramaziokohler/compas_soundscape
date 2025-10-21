/**
 * Sound Event Detection (SED) Hook
 *
 * Manages SED analysis state and interactions with backend API.
 * Provides functionality for analyzing audio files and formatting results.
 */

import { useState, useCallback } from 'react';
import type { SEDAudioInfo, DetectedSound, SoundGenerationConfig, SEDAnalysisOptions, UseSEDReturn } from '@/types';
import { loadAudioFileInfo } from '@/lib/audio/audio-info';

/**
 * Custom hook for Sound Event Detection
 *
 * @returns SED state and actions
 *
 * Usage example:
 * ```tsx
 * const { analyzeSoundEvents, sedDetectedSounds, formatForSoundGeneration } = useSED();
 *
 * // Analyze audio file
 * await analyzeSoundEvents(audioFile, 10);
 *
 * // Get results formatted for sound generation
 * const soundConfigs = formatForSoundGeneration();
 * ```
 */
export function useSED(): UseSEDReturn {
  const [isSEDAnalyzing, setIsSEDAnalyzing] = useState(false);
  const [sedAudioInfo, setSedAudioInfo] = useState<SEDAudioInfo | null>(null);
  const [sedDetectedSounds, setSedDetectedSounds] = useState<DetectedSound[]>([]);
  const [sedError, setSedError] = useState<string | null>(null);
  const [sedProgress, setSedProgress] = useState('');
  const [sedAnalysisOptions, setSedAnalysisOptions] = useState<SEDAnalysisOptions>({
    analyze_amplitudes: true,
    analyze_durations: true,
    analyze_frequencies: false,
  });

  /**
   * Load audio file metadata without analysis
   *
   * Decodes audio file using Web Audio API to extract duration, sample rate,
   * and channel information. This runs immediately when a file is selected,
   * before the user clicks "Analyze Sound Events".
   *
   * @param file - Audio file to load
   */
  const loadAudioInfo = useCallback(async (file: File) => {
    setSedError(null);

    try {
      const audioInfo = await loadAudioFileInfo(file);
      if (audioInfo) {
        setSedAudioInfo(audioInfo);
      } else {
        setSedError('Failed to load audio file info');
      }
    } catch (error) {
      console.error('Error loading audio info:', error);
      setSedError('Failed to read audio file');
    }
  }, []);

  /**
   * Analyze audio file for sound events
   *
   * Sends file to backend YAMNet analysis endpoint and updates state.
   *
   * @param file - Audio file to analyze (wav, mp3, flac, etc.)
   * @param numSounds - Number of top sounds to detect
   */
  const analyzeSoundEvents = useCallback(async (file: File, numSounds: number) => {
    setIsSEDAnalyzing(true);
    setSedError(null);
    setSedProgress('Uploading audio file...');

    try {
      // Create FormData to send file with parameters
      // FormData is used for multipart/form-data encoding (required for file uploads)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('num_sounds', numSounds.toString());
      formData.append('analyze_amplitudes', sedAnalysisOptions.analyze_amplitudes.toString());
      formData.append('analyze_durations', sedAnalysisOptions.analyze_durations.toString());
      formData.append('top_n_classes', '100'); // Analyze top 100 classes

      setSedProgress('Analyzing sound events...');

      // Send request to backend
      const response = await fetch('http://localhost:8000/api/analyze-sound-events', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(errorData.detail || 'Failed to analyze sound events');
      }

      setSedProgress('Processing results...');

      // Parse response
      // Response structure matches SEDAnalysisResult type
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed');
      }

      // Filter out sounds with 0% confidence only
      // Keep "Silence" class for display but will exclude it from sound generation
      const filteredSounds = result.detected_sounds.filter((sound: DetectedSound) => {
        const isZeroConfidence = sound.confidence <= 0;
        return !isZeroConfidence;
      });

      // Update state with results
      setSedAudioInfo(result.audio_info);
      setSedDetectedSounds(filteredSounds);
      setSedProgress('Analysis complete');

      console.log(`✓ SED Analysis complete: ${filteredSounds.length} sounds detected (filtered from ${result.detected_sounds.length})`);

    } catch (error) {
      console.error('SED analysis error:', error);
      setSedError(error instanceof Error ? error.message : 'Failed to analyze audio');
      setSedProgress('');
      setSedAudioInfo(null);
      setSedDetectedSounds([]);
    } finally {
      setIsSEDAnalyzing(false);
    }
  }, [sedAnalysisOptions.analyze_amplitudes, sedAnalysisOptions.analyze_durations]);

  /**
   * Toggle SED analysis option
   *
   * @param option - Option key to toggle
   * @param value - New value
   */
  const toggleSEDOption = useCallback((option: keyof SEDAnalysisOptions, value: boolean) => {
    setSedAnalysisOptions(prev => ({
      ...prev,
      [option]: value
    }));
  }, []);

  /**
   * Format detected sounds for sound generation service
   *
   * Converts SED results into SoundGenerationConfig format that can be
   * used by the sound generation tab.
   *
   * Mapping:
   * - max_silence_duration_sec → Playback interval (time between sound repetitions)
   * - max_amplitude_db → Volume (SPL in dB)
   * - max_detection_duration_sec → Duration (length of generated sound)
   *
   * Note: Excludes "Silence" class from sound generation, uses max values instead of averages
   *
   * @returns Array of sound generation configs
   *
   * Technical details:
   * - Uses detected sound class names as prompts
   * - Converts max_amplitude_db (dBFS) to SPL: dBFS is negative (0 = max), SPL is positive
   * - Uses silence duration for playback interval (time when sound is NOT present)
   * - Uses detection duration for sound generation duration
   * - All duration and dB values are rounded to 0.1 precision
   */
  const formatForSoundGeneration = useCallback((): SoundGenerationConfig[] => {
    // Filter out "Silence" class from sound generation (but show it in UI results)
    const soundsForGeneration = sedDetectedSounds.filter((sound) => {
      const isSilence = sound.name.toLowerCase().includes('silence');
      return !isSilence;
    });

    return soundsForGeneration.map((sound) => {
      // Convert max_amplitude_db (dBFS) to estimated SPL
      // max_amplitude_db represents the peak loudness during detection
      // dBFS: 0 = max amplitude, -60 = very quiet
      // SPL: 30 = whisper, 60 = conversation, 85 = traffic, 110 = concert
      // Mapping: dBFS -60 to -3 → SPL 30 to 85
      let volumeSPL = 70.0; // Default to conversation level
      if (sedAnalysisOptions.analyze_amplitudes && sound.max_amplitude_db !== null && isFinite(sound.max_amplitude_db)) {
        // Linear mapping from dBFS range to SPL range
        // dBFS typically ranges from -60 (quiet) to -3 (loud)
        const dbFS = Math.max(-60, Math.min(-3, sound.max_amplitude_db));
        // Map: -60 dBFS → 30 dB SPL, -3 dBFS → 85 dB SPL
        volumeSPL = 30 + ((dbFS + 60) / 57) * 55;
      }
      // Round to 0.1 precision
      volumeSPL = Math.round(volumeSPL * 10) / 10;

      // Use max_silence_duration_sec for playback interval
      // This represents the maximum time the sound is ABSENT (longest silence period)
      let playbackInterval = 30.0; // Default 30 seconds
      if (sedAnalysisOptions.analyze_durations && sound.max_silence_duration_sec !== null && sound.max_silence_duration_sec !== undefined) {
        // Use max silence duration as interval (how long to wait before repeating)
        playbackInterval = Math.max(5, Math.min(120, sound.max_silence_duration_sec));
      }
      // Round to 0.1 precision
      playbackInterval = Math.round(playbackInterval * 10) / 10;

      // Use max_detection_duration_sec for sound generation duration
      // This represents the maximum time the sound is PRESENT (longest detection)
      let soundDuration = 5.0; // Default 5 seconds
      if (sedAnalysisOptions.analyze_durations && sound.max_detection_duration_sec !== null && sound.max_detection_duration_sec !== undefined) {
        // Use max detection duration for generated sound length
        soundDuration = Math.max(1, Math.min(30, sound.max_detection_duration_sec));
      }
      // Round to 0.1 precision
      soundDuration = Math.round(soundDuration * 10) / 10;

      return {
        prompt: sound.name, // Use detected class name as prompt
        duration: soundDuration, // From max_detection_duration_sec (rounded to 0.1)
        negative_prompt: '', // No negative prompt by default
        seed_copies: 1, // Single variant
        steps: 50, // Default diffusion steps
        display_name: sound.name, // Display name from SED
        spl_db: volumeSPL, // From max_amplitude_db (rounded to 0.1)
        interval_seconds: playbackInterval, // From max_silence_duration_sec (rounded to 0.1)
      };
    });
  }, [sedDetectedSounds, sedAnalysisOptions.analyze_durations, sedAnalysisOptions.analyze_amplitudes]);

  /**
   * Clear SED analysis results
   *
   * Resets all SED state to initial values.
   */
  const clearSEDResults = useCallback(() => {
    setSedAudioInfo(null);
    setSedDetectedSounds([]);
    setSedError(null);
    setSedProgress('');
  }, []);

  return {
    // State
    isSEDAnalyzing,
    sedAudioInfo,
    sedDetectedSounds,
    sedAnalysisOptions,
    sedError,
    sedProgress,

    // Actions
    loadAudioInfo,
    analyzeSoundEvents,
    toggleSEDOption,
    formatForSoundGeneration,
    clearSEDResults,
  };
}

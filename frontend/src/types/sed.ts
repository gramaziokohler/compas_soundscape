/**
 * Sound Event Detection (SED) Type Definitions
 *
 * Types for YAMNet-based sound event detection analysis.
 */

/**
 * Audio file metadata returned from SED analysis
 */
export interface SEDAudioInfo {
  duration: number;           // Duration in seconds
  sample_rate: number;         // Sample rate in Hz (typically 16000 for YAMNet)
  num_samples: number;         // Total number of audio samples
  channels: string;            // Channel configuration (e.g., "Mono", "Stereo")
  filename: string;            // Original filename
}

/**
 * Detected sound event with confidence and statistics
 */
export interface DetectedSound {
  name: string;                          // Sound class name (e.g., "Speech", "Music")
  confidence: number;                    // Confidence score 0-1
  max_amplitude_db: number | null;       // Peak amplitude in dBFS (null if not analyzed)
  max_amplitude_0_1: number | null;      // Peak amplitude in linear scale [0-1] (null if not analyzed)
  avg_amplitude_db: number | null;       // RMS amplitude in dBFS (null if not analyzed)
  avg_amplitude_0_1: number | null;      // RMS amplitude in linear scale [0-1] (null if not analyzed)
  max_detection_duration_sec: number | null;   // Maximum duration when sound is detected (seconds, null if not analyzed)
  max_silence_duration_sec: number | null;     // Maximum silence duration between detections (seconds, null if not analyzed)
  detection_segments?: Array<{ start_sec: number; end_sec: number }>;  // Temporal segments where this class was detected
}

/**
 * Complete SED analysis result from backend
 */
export interface SEDAnalysisResult {
  success: boolean;
  audio_info: SEDAudioInfo;
  detected_sounds: DetectedSound[];
  total_classes_analyzed: number;       // Total number of classes checked
  error?: string;                       // Error message if success=false
}

/**
 * SED analysis options/configuration
 */
export interface SEDAnalysisOptions {
  analyze_amplitudes: boolean;          // Whether to compute amplitude stats
  analyze_durations: boolean;           // Whether to compute temporal durations
  analyze_frequencies: boolean;         // Whether to compute spectral features (future)
}

/**
 * UI state for SED analysis
 */
export interface SEDUIState {
  isAnalyzing: boolean;                 // Analysis in progress
  progress: string;                     // Progress message for UI
  analysisResult: SEDAnalysisResult | null;  // Analysis results
  selectedSounds: Set<string>;          // Set of selected sound class names
  error: string | null;                 // Error message
}

/**
 * useSED Hook Return Type
 */
export interface UseSEDReturn {
  isSEDAnalyzing: boolean;
  sedAudioInfo: SEDAudioInfo | null;
  sedAudioBuffer: AudioBuffer | null;
  sedDetectedSounds: DetectedSound[];
  sedAnalysisOptions: SEDAnalysisOptions;
  sedError: string | null;
  sedProgress: string;
  loadAudioInfo: (file: File) => Promise<void>;
  analyzeSoundEvents: (file: File, numSounds: number) => Promise<void>;
  toggleSEDOption: (option: keyof SEDAnalysisOptions, value: boolean) => void;
  formatForSoundGeneration: () => any[];
  clearSEDResults: () => void;
}

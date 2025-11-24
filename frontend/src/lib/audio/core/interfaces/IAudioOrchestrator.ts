/**
 * IAudioOrchestrator Interface
 *
 * Central coordinator for audio rendering modes and binaural decoder.
 * Manages mode switching, receiver constraints, and audio source lifecycle.
 *
 * Workflow:
 * 1. User selects mode (No IR, Anechoic, IR-based)
 * 2. Orchestrator activates appropriate mode implementation
 * 3. Mode processes audio sources
 * 4. Output routes through binaural decoder (for ambisonic modes)
 * 5. Final stereo output to headphones
 */

import type {
  AudioMode,
  AudioModeConfig,
  OrchestratorStatus,
  Position,
  Orientation
} from '@/types/audio';

export interface IAudioOrchestrator {
  /**
   * Initialize orchestrator with audio context
   * Sets up all mode instances and binaural decoder
   * @param audioContext - Web Audio API context
   */
  initialize(audioContext: AudioContext): Promise<void>;

  /**
   * Set audio rendering mode
   * Switches between No IR, Anechoic, and IR-based modes
   * @param config - Mode configuration including IR metadata if applicable
   */
  setMode(config: AudioModeConfig): Promise<void>;

  /**
   * Get current audio mode
   * @returns Current AudioMode enum value
   */
  getCurrentMode(): AudioMode;

  /**
   * Get orchestrator status for UI display
   * @returns Status object with mode, DOF, notices
   */
  getStatus(): OrchestratorStatus;

  /**
   * Set receiver mode (for IR-based modes)
   * Locks listener position, allows only head rotation
   * @param isActive - Whether receiver mode is active
   * @param receiverId - Optional receiver identifier
   */
  setReceiverMode(isActive: boolean, receiverId?: string): void;

  /**
   * Set ambisonic order for anechoic and IR modes
   * @param order - 1 for FOA (4ch), 2 for SOA (9ch), 3 for TOA (16ch)
   */
  setAmbisonicOrder(order: 1 | 2 | 3): Promise<void>;

  /**
   * Create audio source at given position
   * @param sourceId - Unique identifier for the source
   * @param audioBuffer - Audio buffer to play
   * @param position - 3D position (THREE.Vector3)
   */
  createSource(
    sourceId: string,
    audioBuffer: AudioBuffer,
    position: Position
  ): void;

  /**
   * Update source position (when source moves)
   * @param sourceId - Source identifier
   * @param position - New 3D position
   */
  updateSourcePosition(sourceId: string, position: Position): void;

  /**
   * Remove audio source
   * @param sourceId - Source identifier
   */
  removeSource(sourceId: string): void;

  /**
   * Update listener position and orientation (called every frame)
   * @param position - Listener 3D position
   * @param orientation - Listener orientation (yaw, pitch, roll)
   */
  updateListener(position: Position, orientation: Orientation): void;

  /**
   * Dispose of all resources
   */
  dispose(): void;
}

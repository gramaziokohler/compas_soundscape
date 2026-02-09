/**
 * Modal Impact Sound Synthesis Service
 * 
 * Physically-based audio synthesis using modal analysis results.
 * Generates realistic impact sounds based on resonant frequencies and damping.
 */

import { AUDIO_SAMPLE_RATE, IMPACT_SOUND } from '@/utils/constants';
import type {
  ImpactParameters,
  ModalAnalysisResult,
  ModeContribution,
  SynthesisParameters,
} from '@/types/modal';

/**
 * Modal Impact Sound Synthesizer
 * 
 * Synthesizes impact sounds using modal synthesis technique.
 * Each mode is a damped sinusoid: A(t) = A₀ * e^(-ζωt) * sin(ωt + φ)
 */
export class ModalImpactSynthesizer {
  private audioContext: AudioContext;

  constructor(audioContext?: AudioContext) {
    this.audioContext = audioContext || new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
  }

  /**
   * Synthesize an impact sound from modal analysis results
   */
  async synthesizeImpact(
    modalResult: ModalAnalysisResult,
    impactParams: ImpactParameters
  ): Promise<AudioBuffer> {
    // Calculate mode contributions based on impact parameters
    const modes = this.calculateModeContributions(
      modalResult,
      impactParams
    );

    // Create synthesis parameters
    const synthParams: SynthesisParameters = {
      modes,
      sampleRate: IMPACT_SOUND.SAMPLE_RATE,
      duration: impactParams.duration || IMPACT_SOUND.DEFAULT_DURATION,
      outputGain: IMPACT_SOUND.OUTPUT_GAIN,
    };

    // Generate the audio buffer
    return this.generateAudioBuffer(synthParams);
  }

  /**
   * Calculate mode contributions based on impact parameters
   * 
   * Mode amplitude depends on:
   * - Impact velocity (overall energy/force of impact)
   * - Impact location (mode shape evaluation - which modes are excited)
   * - Mode frequency (higher modes get less energy from typical impacts)
   * 
   * The impact force determines the INITIAL AMPLITUDE of each mode.
   * Each mode then rings freely according to its own damping.
   */
  private calculateModeContributions(
    modalResult: ModalAnalysisResult,
    impactParams: ImpactParameters
  ): ModeContribution[] {
    const { frequencies, mode_shapes } = modalResult;
    const { position, velocity, dampingRatio, material } = impactParams;

    // Determine damping ratio
    let damping = dampingRatio || IMPACT_SOUND.DEFAULT_DAMPING_RATIO;
    if (material && material in IMPACT_SOUND.DAMPING_RATIOS) {
      damping = IMPACT_SOUND.DAMPING_RATIOS[material as keyof typeof IMPACT_SOUND.DAMPING_RATIOS];
    }

    const modes: ModeContribution[] = [];
    const maxModes = Math.min(
      frequencies.length,
      IMPACT_SOUND.MAX_MODES_TO_SYNTHESIZE
    );

    for (let i = 0; i < maxModes; i++) {
      const frequency = frequencies[i];
      
      // Base amplitude: decays exponentially with mode number
      // Higher modes receive less energy from a typical impact
      let amplitude = IMPACT_SOUND.FUNDAMENTAL_AMPLITUDE * 
                      Math.pow(IMPACT_SOUND.MODE_AMPLITUDE_DECAY, i);

      // Scale by impact velocity (impact force determines initial energy)
      // This sets the initial amplitude - NOT a time-varying envelope
      amplitude *= Math.min(velocity, 10.0) / 10.0;

      // Modify amplitude based on impact location and mode shape
      // Modes with larger displacement at the impact point are excited more
      if (mode_shapes && mode_shapes[i]) {
        const modeShapeInfluence = this.evaluateModeShapeAtPoint(
          mode_shapes[i],
          position,
          modalResult.mesh_info
        );
        
        // Blend between uniform and position-dependent excitation
        const posInfluence = IMPACT_SOUND.POSITION_INFLUENCE_STRENGTH;
        amplitude *= (1 - posInfluence) + posInfluence * modeShapeInfluence;
      }

      // Skip modes with negligible amplitude
      if (amplitude < IMPACT_SOUND.MIN_MODE_AMPLITUDE) {
        continue;
      }

      // Random phase for natural sound (avoids phase alignment artifacts)
      const phase = Math.random() * 2 * Math.PI;

      modes.push({
        frequency,
        amplitude,
        damping,
        phase,
      });
    }

    return modes;
  }

  /**
   * Evaluate mode shape at impact point
   * 
   * This is a simplified approximation. In a full implementation,
   * you would interpolate the mode shape values at the exact impact point.
   * Here we use a spatial distance-based heuristic.
   */
  private evaluateModeShapeAtPoint(
    modeShape: number[],
    position: { x: number; y: number; z: number },
    meshInfo: { dimensions: number[] }
  ): number {
    // Normalize impact position to [0, 1] range
    const [dx, dy, dz] = meshInfo.dimensions;
    const normalizedPos = {
      x: (position.x + dx / 2) / dx, // Assume mesh centered at origin
      y: (position.y + dy / 2) / dy,
      z: (position.z + dz / 2) / dz,
    };

    // Simple heuristic: use spatial hash to sample mode shape
    // In production, interpolate actual mode shape values
    const idx = Math.floor(
      (normalizedPos.x + normalizedPos.y + normalizedPos.z) / 3 * (modeShape.length / 3)
    );
    const safeIdx = Math.max(0, Math.min(idx * 3, modeShape.length - 3));

    // Return magnitude of displacement at this point
    const dx_mode = modeShape[safeIdx] || 0;
    const dy_mode = modeShape[safeIdx + 1] || 0;
    const dz_mode = modeShape[safeIdx + 2] || 0;
    
    return Math.sqrt(dx_mode * dx_mode + dy_mode * dy_mode + dz_mode * dz_mode);
  }

  /**
   * Generate audio buffer from synthesis parameters
   * 
   * Each mode contributes a damped sinusoid that rings freely:
   * s_i(t) = A_i * e^(-ζ_i * ω_i * t) * sin(ω_i * t + φ_i)
   * 
   * Where:
   * - A_i is the initial amplitude (set by impact force and mode shape)
   * - ζ_i is the damping ratio (material property)
   * - ω_i is the angular frequency (2π * f_i)
   * - φ_i is the initial phase
   * 
   * The impact itself is instantaneous (at t=0) and only sets the initial
   * amplitudes. The modes then ring out naturally according to their damping.
   * 
   * Total signal: s(t) = Σ s_i(t)
   */
  private generateAudioBuffer(params: SynthesisParameters): AudioBuffer {
    const { modes, sampleRate, duration, outputGain } = params;
    
    const numSamples = Math.floor(duration * sampleRate);
    const buffer = this.audioContext.createBuffer(1, numSamples, sampleRate);
    const channelData = buffer.getChannelData(0);

    // Synthesize each mode - they all start at t=0 and ring freely
    for (const mode of modes) {
      const omega = 2 * Math.PI * mode.frequency;      // Angular frequency (rad/s)
      const zeta = mode.damping;                        // Damping ratio (dimensionless)
      const A = mode.amplitude;                         // Initial amplitude (set by impact)
      const phi = mode.phase;                           // Initial phase (randomized)

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        
        // Damped sinusoid: A * e^(-ζωt) * sin(ωt + φ)
        // The exponential provides the decay envelope
        // The sinusoid provides the oscillation at the mode frequency
        const envelope = Math.exp(-zeta * omega * t);
        const oscillation = Math.sin(omega * t + phi);
        
        // Sum all mode contributions
        channelData[i] += A * envelope * oscillation;
      }
    }

    // Normalize to prevent clipping
    this.normalizeBuffer(channelData, IMPACT_SOUND.NORMALIZATION_TARGET);

    // Apply output gain
    for (let i = 0; i < numSamples; i++) {
      channelData[i] *= outputGain;
    }

    return buffer;
  }

  /**
   * Normalize audio buffer to target peak amplitude
   */
  private normalizeBuffer(data: Float32Array, targetPeak: number): void {
    let maxAbsValue = 0;
    
    for (let i = 0; i < data.length; i++) {
      const absValue = Math.abs(data[i]);
      if (absValue > maxAbsValue) {
        maxAbsValue = absValue;
      }
    }

    if (maxAbsValue > 0) {
      const scale = targetPeak / maxAbsValue;
      for (let i = 0; i < data.length; i++) {
        data[i] *= scale;
      }
    }
  }

  /**
   * Play an audio buffer immediately
   */
  playBuffer(buffer: AudioBuffer): AudioBufferSourceNode {
    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);
    source.start(0);

    return source;
  }

  /**
   * Get the current audio context
   */
  getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Create a new synthesizer with a shared audio context
   */
  static create(audioContext?: AudioContext): ModalImpactSynthesizer {
    return new ModalImpactSynthesizer(audioContext);
  }
}

/**
 * Create a quick impact sound for testing
 */
export function createTestImpactSound(
  audioContext: AudioContext,
  frequency: number = 440,
  damping: number = 0.02,
  duration: number = 1.0
): AudioBuffer {
  const sampleRate = audioContext.sampleRate;
  const numSamples = Math.floor(duration * sampleRate);
  const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
  const data = buffer.getChannelData(0);

  const omega = 2 * Math.PI * frequency;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-damping * omega * t);
    data[i] = envelope * Math.sin(omega * t) * 0.3;
  }

  return buffer;
}

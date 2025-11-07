/**
 * Audio Orchestrator
 *
 * Central coordinator for audio rendering modes and output decoding.
 * Manages transitions between No IR, Mono IR, and Spatial IR modes.
 * Enforces receiver mode constraint for IR-based rendering.
 */

import type { IAudioOrchestrator } from './interfaces/IAudioOrchestrator';
import type { IAudioRenderer } from './interfaces/IAudioRenderer';
import type { IOutputDecoder } from './interfaces/IOutputDecoder';
import {
  AudioRenderMode,
  OutputDecoderType
} from './types';
import type {
  AudioSourceHandle,
  RenderingModeConfig,
  OrchestratorStatus
} from './types';

import { NoIRRenderer } from './renderers/NoIRRenderer';
import { MonoIRRenderer } from './renderers/MonoIRRenderer';
import { SpatialIRRenderer } from './renderers/SpatialIRRenderer';
import { BinauralDecoder } from './decoders/BinauralDecoder';
import { StereoDecoder } from './decoders/StereoDecoder';
import { IRFormatDetector } from './utils/IRFormatDetector';

export class AudioOrchestrator implements IAudioOrchestrator {
  private audioContext: AudioContext | null = null;
  private currentRenderer: IAudioRenderer | null = null;
  private outputDecoder: IOutputDecoder | null = null;
  private currentMode: AudioRenderMode = AudioRenderMode.NO_IR_THREEJS;
  private isReceiverModeActive: boolean = false;
  private activeReceiverId: string | null = null;
  private currentIRMetadata: any = null;

  // Renderer instances
  private noIRRenderer: NoIRRenderer;
  private monoIRRenderer: MonoIRRenderer;
  private spatialIRRenderer: SpatialIRRenderer;

  // Decoder instances
  private binauralDecoder: BinauralDecoder;
  private stereoDecoder: StereoDecoder;

  constructor() {
    this.noIRRenderer = new NoIRRenderer();
    this.monoIRRenderer = new MonoIRRenderer();
    this.spatialIRRenderer = new SpatialIRRenderer();
    this.binauralDecoder = new BinauralDecoder();
    this.stereoDecoder = new StereoDecoder();
  }

  initialize(audioContext: AudioContext): void {
    console.log('[AudioOrchestrator] Initializing...');
    this.audioContext = audioContext;

    // Initialize all renderers
    this.noIRRenderer.initialize(audioContext);
    this.monoIRRenderer.initialize(audioContext);
    this.spatialIRRenderer.initialize(audioContext);

    // Initialize decoders
    this.binauralDecoder.initialize(audioContext);
    this.stereoDecoder.initialize(audioContext);

    // Set default renderer and decoder
    this.currentRenderer = this.noIRRenderer;
    this.outputDecoder = this.binauralDecoder;
    this.currentMode = AudioRenderMode.NO_IR_THREEJS;

    // Wire audio graph
    this.wireAudioGraph();

    console.log('[AudioOrchestrator] Initialized successfully');
  }

  setRenderingMode(config: RenderingModeConfig): void {
    const { irMetadata, preferredNoIRMode } = config;

    console.log('[AudioOrchestrator] Setting rendering mode:', {
      hasIR: !!irMetadata,
      format: irMetadata?.format,
      preferredNoIRMode
    });

    // Disconnect current renderer
    if (this.currentRenderer) {
      this.currentRenderer.setEnabled(false);
    }

    if (!irMetadata) {
      // No IR mode
      this.currentRenderer = this.noIRRenderer;
      this.noIRRenderer.setPreferredMode(preferredNoIRMode);
      this.currentMode = preferredNoIRMode === 'threejs'
        ? AudioRenderMode.NO_IR_THREEJS
        : AudioRenderMode.NO_IR_RESONANCE;
      this.currentIRMetadata = null;
    } else if (irMetadata.format === 'mono') {
      // Mono IR mode
      this.currentRenderer = this.monoIRRenderer;
      this.monoIRRenderer.setImpulseResponse(irMetadata.buffer);
      this.currentMode = AudioRenderMode.MONO_IR;
      this.currentIRMetadata = irMetadata;
    } else {
      // Spatial IR mode
      this.currentRenderer = this.spatialIRRenderer;
      this.spatialIRRenderer.setImpulseResponse(
        irMetadata.buffer,
        irMetadata.format
      );
      this.currentMode = this.spatialIRRenderer.getMode();
      this.currentIRMetadata = irMetadata;
    }

    // Enable new renderer
    this.currentRenderer.setEnabled(true);

    // Rewire audio graph
    this.wireAudioGraph();

    // Apply receiver mode constraint
    this.enforceReceiverModeConstraint();

    console.log('[AudioOrchestrator] Rendering mode set to:', this.currentMode);
  }

  setOutputDecoder(type: OutputDecoderType): void {
    console.log('[AudioOrchestrator] Setting output decoder:', type);

    this.outputDecoder = type === OutputDecoderType.BINAURAL_HRTF
      ? this.binauralDecoder
      : this.stereoDecoder;

    // Notify current renderer to update panning model
    if (this.currentRenderer) {
      this.currentRenderer.setOutputDecoder(type);
    }

    // Also update all renderers so they're ready when switched
    this.noIRRenderer.setOutputDecoder(type);
    this.monoIRRenderer.setOutputDecoder(type);
    this.spatialIRRenderer.setOutputDecoder(type);

    this.wireAudioGraph();
  }

  setReceiverMode(isActive: boolean, receiverId: string | null): void {
    console.log('[AudioOrchestrator] Setting receiver mode:', { isActive, receiverId });

    this.isReceiverModeActive = isActive;
    this.activeReceiverId = receiverId;

    this.enforceReceiverModeConstraint();
  }

  private enforceReceiverModeConstraint(): void {
    if (!this.currentRenderer) return;

    const requiresReceiver = this.currentRenderer.requiresReceiverMode();

    if (requiresReceiver) {
      const shouldBeActive = this.isReceiverModeActive && this.activeReceiverId !== null;

      console.log('[AudioOrchestrator] Enforcing receiver mode constraint:', {
        requiresReceiver,
        shouldBeActive,
        isReceiverModeActive: this.isReceiverModeActive,
        activeReceiverId: this.activeReceiverId
      });

      // Notify renderer of receiver mode state
      if (this.currentRenderer instanceof MonoIRRenderer) {
        this.currentRenderer.setReceiverMode(shouldBeActive);
      } else if (this.currentRenderer instanceof SpatialIRRenderer) {
        this.currentRenderer.setReceiverMode(shouldBeActive);
      }
    }
  }

  private wireAudioGraph(): void {
    if (!this.currentRenderer || !this.outputDecoder || !this.audioContext) return;

    console.log('[AudioOrchestrator] Wiring audio graph');

    // Get connection points
    const rendererOutput = this.currentRenderer.getOutputNode();
    const decoderInput = this.outputDecoder.getInputNode();
    const decoderOutput = this.outputDecoder.getOutputNode();

    // Disconnect all first
    try {
      rendererOutput.disconnect();
      decoderOutput.disconnect();
    } catch (e) {
      // May not be connected yet
    }

    // Connect: Renderer → Decoder → AudioContext.destination
    rendererOutput.connect(decoderInput);
    decoderOutput.connect(this.audioContext.destination);

    console.log('[AudioOrchestrator] Audio graph wired successfully');
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.currentRenderer) {
      throw new Error('Orchestrator not initialized');
    }

    return this.currentRenderer.createSource(position, audioBuffer);
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    this.currentRenderer?.updateListener(position, orientation);
    this.outputDecoder?.updateOrientation(orientation);
  }

  getCurrentMode(): AudioRenderMode {
    return this.currentMode;
  }

  getStatus(): OrchestratorStatus {
    const requiresReceiver = this.currentRenderer?.requiresReceiverMode() ?? false;
    const isIRActive = requiresReceiver && this.isReceiverModeActive && this.activeReceiverId !== null;

    let dofDescription = '';
    let uiNotice = null;

    if (this.currentIRMetadata) {
      dofDescription = IRFormatDetector.getDOFDescription(this.currentIRMetadata.format);
      uiNotice = IRFormatDetector.getUINotice(this.currentIRMetadata.format, isIRActive);
    } else {
      dofDescription = '6 DOF (full movement + rotation)';
    }

    return {
      currentMode: this.currentMode,
      isReceiverModeActive: this.isReceiverModeActive,
      isIRActive,
      outputDecoderType: this.outputDecoder?.getType() ?? OutputDecoderType.BINAURAL_HRTF,
      dofDescription,
      uiNotice
    };
  }

  dispose(): void {
    console.log('[AudioOrchestrator] Disposing...');

    this.currentRenderer?.dispose();
    this.outputDecoder?.dispose();

    this.noIRRenderer.dispose();
    this.monoIRRenderer.dispose();
    this.spatialIRRenderer.dispose();
    this.binauralDecoder.dispose();
    this.stereoDecoder.dispose();
  }
}

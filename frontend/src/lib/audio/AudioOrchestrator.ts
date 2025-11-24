/**
 * AudioOrchestrator
 *
 * Audio manager supporting multiple rendering modes:
 * - AnechoicMode: No acoustics, dry spatial audio
 * - ResonanceMode: ShoeBox acoustics with room modeling
 * - IR Modes: Precise acoustics with impulse response convolution
 */

import type { IAudioOrchestrator } from './core/interfaces/IAudioOrchestrator';
import type { IAudioMode } from './core/interfaces/IAudioMode';
import type {
  AudioModeConfig,
  OrchestratorStatus,
  Position,
  Orientation,
  AmbisonicOrder
} from '@/types/audio';
import { AudioMode } from '@/types/audio';

import { AnechoicMode } from './modes/AnechoicMode';
import { ResonanceMode } from './modes/ResonanceMode';
import { MonoIRMode } from './modes/MonoIRMode';
import { StereoIRMode } from './modes/StereoIRMode';
import { AmbisonicIRMode } from './modes/AmbisonicIRMode';
import { BinauralDecoder } from './decoders/BinauralDecoder';

// Utilities
import {
  selectAudioMode,
  isSupportedChannelCount,
  getAmbisonicOrderFromChannels,
  isAmbisonicOrderSupported,
  getModeDescription
} from './utils/mode-selector';
import type { IRState, NoIRPreferences, ModeSelectionResult } from './utils/mode-selector';
import { smoothModeTransition, safeDisconnect, safeConnect } from './utils/mode-transition';
import {
  AudioErrorType,
  createAudioError,
  handleIRLoadFailure,
  handleUnsupportedChannelCount,
  handleHRTFLoadFailure,
  handleUnsupportedAmbisonicOrder,
  handleModeInitializationFailure,
  logAudioError,
  recoverFromError
} from './utils/error-handling';
import type { AudioError } from './utils/error-handling';
import {
  decodeAudioFile,
  getAudioFileMetadata,
  getAudioBufferInfo,
  formatAudioBufferInfo
} from './utils/audio-file-decoder';
import { AUDIO_CONTROL } from '@/lib/constants';

export class AudioOrchestrator implements IAudioOrchestrator {
  private audioContext: AudioContext | null = null;
  private currentMode: AudioMode = AudioMode.ANECHOIC;
  private currentModeInstance: IAudioMode | null = null;
  private ambisonicOrder: AmbisonicOrder = 1; // Default to FOA

  // Mode instances (lazy-loaded)
  private anechoicMode: AnechoicMode | null = null;
  private resonanceMode: ResonanceMode | null = null;
  private monoIRMode: MonoIRMode | null = null;
  private stereoIRMode: StereoIRMode | null = null;
  private ambisonicIRMode: AmbisonicIRMode | null = null;

  // Binaural decoder (shared by all ambisonic modes)
  private binauralDecoder: BinauralDecoder | null = null;
  private hrtfLoadFailed: boolean = false;

  // IR state
  private irState: IRState = {
    isImported: false,
    isSelected: false,
    channelCount: undefined,
    buffer: null,
    filename: undefined
  };

  // User preferences
  private noIRPreferences: NoIRPreferences = {
    preferredMode: 'anechoic',
    stereoIRInterpretation: 'binaural'
  };

  // Receiver mode state
  private isReceiverModeActive: boolean = false;
  private receiverId: string | null = null;
  private hasReceiversInScene: boolean = false;

  // Source registry - tracks all sources for re-creation on mode switch
  private sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }> = new Map();

  // Browser capabilities
  private browserCapabilities: {
    foa: boolean;
    soa: boolean;
    toa: boolean;
  } = {
    foa: false,
    soa: false,
    toa: false
  };

  // Error handling
  private lastError: AudioError | null = null;
  private warnings: string[] = [];

  // Initialization state
  private initialized: boolean = false;

  /**
   * Initialize orchestrator with audio context
   * Sets up binaural decoder and detects browser capabilities
   */
  // Limiter node to prevent harsh clipping
  private limiter: DynamicsCompressorNode | null = null;

  async initialize(audioContext: AudioContext): Promise<void> {
    if (this.initialized) {
      console.warn('[AudioOrchestrator] Already initialized');
      return;
    }

    this.audioContext = audioContext;
    
    // Create brick-wall limiter to prevent saturation/clipping
    this.limiter = audioContext.createDynamicsCompressor();
    this.limiter.threshold.value = AUDIO_CONTROL.LIMITER.THRESHOLD_DB;
    this.limiter.knee.value = AUDIO_CONTROL.LIMITER.KNEE_DB;
    this.limiter.ratio.value = AUDIO_CONTROL.LIMITER.RATIO;
    this.limiter.attack.value = AUDIO_CONTROL.LIMITER.ATTACK_SEC;
    this.limiter.release.value = AUDIO_CONTROL.LIMITER.RELEASE_SEC;
    this.limiter.connect(audioContext.destination);

    try {
      // Test ambisonic order support
      const foaSupported = isAmbisonicOrderSupported(audioContext, 1);
      const soaSupported = isAmbisonicOrderSupported(audioContext, 2);
      const toaSupported = isAmbisonicOrderSupported(audioContext, 3);

      this.browserCapabilities = {
        foa: foaSupported,
        soa: soaSupported,
        toa: toaSupported
      };

      console.log('[AudioOrchestrator] Ambisonic support:', {
        FOA: foaSupported,
        SOA: soaSupported,
        TOA: toaSupported
      });

      if (!foaSupported) {
        const error = handleUnsupportedAmbisonicOrder(1);
        logAudioError(error, 'AudioOrchestrator');
        this.warnings.push(error.message);
      }

      // Create binaural decoder (shared by all ambisonic modes)
      this.binauralDecoder = new BinauralDecoder();
      
      try {
        await this.binauralDecoder.initialize(audioContext, this.ambisonicOrder);
      } catch (error) {
        const audioError = handleHRTFLoadFailure(error as Error);
        logAudioError(audioError, 'AudioOrchestrator');
        this.hrtfLoadFailed = true;
        this.warnings.push('HRTF data unavailable - using basic panning');
      }

      // Initialize default mode based on preferences
      await this.autoSelectMode();

      this.initialized = true;
      console.log('[AudioOrchestrator] Initialized with mode:', this.currentMode);
    } catch (error) {
      console.error('[AudioOrchestrator] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Auto-select appropriate mode based on current IR state and preferences
   */
  private async autoSelectMode(): Promise<void> {
    const selection = selectAudioMode(this.irState, this.noIRPreferences);
    
    // Store warnings
    this.warnings = selection.warnings;
    
    // Log warnings
    selection.warnings.forEach(warning => {
      console.warn('[AudioOrchestrator]', warning);
    });

    // Initialize and set the selected mode
    const config: AudioModeConfig = {
      mode: selection.mode,
      ambisonicOrder: selection.ambisonicOrder || this.ambisonicOrder
    };

    await this.setMode(config);
  }

  /**
   * Connect a mode's output through the limiter to destination
   * @param mode - Mode instance to connect
   */
  private connectModeToOutput(mode: IAudioMode): void {
    if (!this.audioContext || !this.limiter) return;
    
    const outputNode = mode.getOutputNode();
    
    // Disconnect from destination if already connected
    try {
      outputNode.disconnect();
    } catch (error) {
      // Node not connected, ignore
    }
    
    // Connect through limiter
    outputNode.connect(this.limiter);
  }

  /**
   * Update IR buffer on a mode instance if it supports impulse responses
   * @param mode - Mode instance to update
   * @param irBuffer - New IR buffer to set
   */
  private updateModeIRBuffer(mode: IAudioMode, irBuffer: AudioBuffer): void {
    const channels = irBuffer.numberOfChannels;
    
    // Type guard to check if mode has setImpulseResponse method
    if ('setImpulseResponse' in mode && typeof (mode as any).setImpulseResponse === 'function') {
      // Check if buffer matches mode requirements
      if (mode === this.monoIRMode && channels === 1) {
        console.log('[AudioOrchestrator] Updating MonoIRMode with new IR buffer');
        this.monoIRMode.setImpulseResponse(irBuffer);
      } else if (mode === this.stereoIRMode && channels === 2) {
        console.log('[AudioOrchestrator] Updating StereoIRMode with new IR buffer');
        this.stereoIRMode.setImpulseResponse(irBuffer);
      } else if (mode === this.ambisonicIRMode && [4, 9, 16].includes(channels)) {
        console.log('[AudioOrchestrator] Updating AmbisonicIRMode with new IR buffer');
        this.ambisonicIRMode.setImpulseResponse(irBuffer);
      }
    }
  }

  /**
   * Initialize a specific mode (lazy initialization)
   * @param mode - Mode to initialize
   */
  private async initializeMode(mode: AudioMode): Promise<IAudioMode> {
    if (!this.audioContext) {
      throw new Error('[AudioOrchestrator] Not initialized');
    }

    try {
      switch (mode) {
        case AudioMode.NO_IR_RESONANCE:
          if (!this.resonanceMode) {
            this.resonanceMode = new ResonanceMode();
            await this.resonanceMode.initialize(this.audioContext);
            this.connectModeToOutput(this.resonanceMode);
          }
          return this.resonanceMode;

        case AudioMode.ANECHOIC:
          if (!this.anechoicMode) {
            this.anechoicMode = new AnechoicMode();
            await this.anechoicMode.initialize(this.audioContext, this.ambisonicOrder);
            
            // Connect to binaural decoder, then to limiter
            if (this.binauralDecoder) {
              // Reset rotation offset since AnechoicMode handles absolute positioning
              this.binauralDecoder.setRotationOffset(0);
              
              safeConnect(
                this.anechoicMode.getOutputNode(),
                this.binauralDecoder.getInputNode()
              );
              safeConnect(
                this.binauralDecoder.getOutputNode(),
                this.limiter!
              );
            }
          } else {
            // If mode already exists but we are switching back to it, ensure offset is reset
            if (this.binauralDecoder) {
              this.binauralDecoder.setRotationOffset(0);
            }
          }
          return this.anechoicMode;

        case AudioMode.MONO_IR:
          if (!this.monoIRMode) {
            this.monoIRMode = new MonoIRMode();
            await this.monoIRMode.initialize(this.audioContext);
            this.connectModeToOutput(this.monoIRMode);
            
            // Set ambisonic order
            await this.monoIRMode.setAmbisonicOrder(this.ambisonicOrder);
          }
          
          // Always update IR buffer if available (handles IR switching)
          if (this.irState.buffer && this.irState.buffer.numberOfChannels === 1) {
            this.monoIRMode.setImpulseResponse(this.irState.buffer);
          }
          
          return this.monoIRMode;

        case AudioMode.STEREO_IR:
          if (!this.stereoIRMode) {
            this.stereoIRMode = new StereoIRMode();
            await this.stereoIRMode.initialize(this.audioContext);
            this.connectModeToOutput(this.stereoIRMode);
            
            // Set interpretation mode from preferences (default to 'binaural')
            await this.stereoIRMode.setInterpretationMode(
              this.noIRPreferences.stereoIRInterpretation || 'binaural'
            );
            
            // Set ambisonic order (for speaker mode)
            await this.stereoIRMode.setAmbisonicOrder(this.ambisonicOrder);
          }
          
          // Always update IR buffer if available (handles IR switching)
          if (this.irState.buffer && this.irState.buffer.numberOfChannels === 2) {
            this.stereoIRMode.setImpulseResponse(this.irState.buffer);
          }
          
          return this.stereoIRMode;

        case AudioMode.AMBISONIC_IR:
          if (!this.ambisonicIRMode) {
            this.ambisonicIRMode = new AmbisonicIRMode();
            await this.ambisonicIRMode.initialize(this.audioContext);
            this.connectModeToOutput(this.ambisonicIRMode);
          }
          
          // Always update IR buffer if available (handles IR switching)
          const channels = this.irState.buffer?.numberOfChannels;
          if (this.irState.buffer && channels && [4, 9, 16].includes(channels)) {
            await this.ambisonicIRMode.setImpulseResponse(this.irState.buffer);
            
            // Update ambisonic order from IR
            const order = getAmbisonicOrderFromChannels(channels);
            if (order) {
              this.ambisonicOrder = order;
            }
          }
          
          return this.ambisonicIRMode;

        default:
          throw new Error(`[AudioOrchestrator] Unknown mode: ${mode}`);
      }
    } catch (error) {
      const audioError = handleModeInitializationFailure(mode, error as Error);
      logAudioError(audioError, 'AudioOrchestrator');
      
      // Try to recover by falling back to ANECHOIC
      if (mode !== AudioMode.ANECHOIC) {
        console.warn('[AudioOrchestrator] Falling back to ANECHOIC mode');
        return this.initializeMode(AudioMode.ANECHOIC);
      }
      
      throw error;
    }
  }

  /**
   * Set audio rendering mode
   * Switches between modes with smooth transitions
   */
  async setMode(config: AudioModeConfig): Promise<void> {
    if (!this.audioContext) {
      throw new Error('[AudioOrchestrator] Not initialized');
    }

    const newMode = config.mode;
    
    // Skip if already in this mode
    if (newMode === this.currentMode && !config.ambisonicOrder) {
      console.log(`[AudioOrchestrator] Already in ${newMode} mode`);
      return;
    }

    console.log(`[AudioOrchestrator] Switching from ${this.currentMode} to ${newMode}`);

    try {
      // Store references to existing sources (for re-creation after mode switch)
      const existingSources: Array<{id: string, buffer: AudioBuffer, position: Position}> = [];
      if (this.currentModeInstance) {
        // We can't easily extract sources from modes, so we'll rely on external re-registration
        // This will be handled by SoundSphereManager
      }

      // Initialize new mode if needed
      const newModeInstance = await this.initializeMode(newMode);

      // Perform smooth transition
      await smoothModeTransition(
        this.currentModeInstance,
        newModeInstance,
        this.audioContext
      );

      // Update state
      this.currentMode = newMode;
      this.currentModeInstance = newModeInstance;

      // Update ambisonic order if specified
      if (config.ambisonicOrder && config.ambisonicOrder !== this.ambisonicOrder) {
        await this.setAmbisonicOrder(config.ambisonicOrder);
      }

      // Update receiver mode constraint
      this.updateReceiverConstraint();

      // Re-create all registered sources in the new mode
      this.reCreateSourcesInCurrentMode();

      console.log(`[AudioOrchestrator] Switched to ${newMode}`);
    } catch (error) {
      const audioError = handleModeInitializationFailure(newMode, error as Error);
      const fallbackMode = await recoverFromError(audioError);
      
      if (fallbackMode && fallbackMode !== newMode) {
        // Try fallback mode
        console.warn(`[AudioOrchestrator] Attempting fallback to ${fallbackMode}`);
        await this.setMode({ mode: fallbackMode, ambisonicOrder: 1 });
      } else {
        throw error;
      }
    }
  }

  /**
   * Update receiver mode constraint based on current mode
   */
  private updateReceiverConstraint(): void {
    const requiresReceiver = this.currentModeInstance?.requiresReceiverMode() || false;

    if (requiresReceiver && !this.isReceiverModeActive) {
      if (!this.hasReceiversInScene) {
        console.warn('[AudioOrchestrator] Current mode requires receiver placement');
        this.warnings.push('Place a receiver in the scene to use IR mode');
      } else {
        console.warn('[AudioOrchestrator] Current mode requires receiver mode activation');
        this.warnings.push('Double click on a receiver to enter receiver mode');
      }
    }
  }

  /**
   * Get current audio mode
   */
  getCurrentMode(): AudioMode {
    return this.currentMode;
  }

  /**
   * Get orchestrator status for UI display
   */
  getStatus(): OrchestratorStatus {
    const requiresReceiver = this.currentModeInstance?.requiresReceiverMode() || false;
    const isAmbisonic = [
      AudioMode.ANECHOIC,
      AudioMode.AMBISONIC_IR,
      AudioMode.MONO_IR,
      AudioMode.STEREO_IR
    ].includes(this.currentMode);

    // Determine DOF description
    let dofDescription: string;
    if (requiresReceiver && this.isReceiverModeActive) {
      dofDescription = '3 DOF (Rotation only - Receiver active)';
    } else if (requiresReceiver && !this.isReceiverModeActive) {
      dofDescription = '3 DOF (Rotation only - Receiver required)';
    } else {
      dofDescription = '6 DOF (Position + Rotation)';
    }

    // Generate UI notice
    const notices: string[] = [];

    // Receiver warning
    if (requiresReceiver && !this.isReceiverModeActive) {
      if (!this.hasReceiversInScene) {
        notices.push('⚠️ Place a receiver in the scene to use IR mode');
      } else {
        notices.push('💡 Double click on a receiver to enter receiver mode');
      }
    }
    
    // Stereo IR interpretation mode info
    if (this.currentMode === AudioMode.STEREO_IR && this.stereoIRMode) {
      const interpretation = this.stereoIRMode.getInterpretationMode();
      if (interpretation === 'binaural') {
        notices.push('🎧 Binaural mode (direct stereo playback)');
      } else {
        notices.push(`🔊 Speaker mode (L/R at ±30°, ${this.ambisonicOrder === 1 ? 'FOA' : 'TOA'})`);
      }
    }
    
    // Ambisonic order info (for non-stereo modes or speaker mode)
    if (isAmbisonic && this.currentMode !== AudioMode.STEREO_IR) {
      const orderNames = { 1: 'FOA (4ch)', 2: 'SOA (9ch)', 3: 'TOA (16ch)' };
      notices.push(`🎵 ${orderNames[this.ambisonicOrder]} ambisonic rendering`);
    }
    
    // HRTF warning
    if (this.hrtfLoadFailed) {
      notices.push('⚠️ HRTF data unavailable - using basic panning');
    }
    
    // Add any other warnings
    this.warnings.forEach(warning => {
      if (!notices.some(n => n.includes(warning))) {
        notices.push(`⚠️ ${warning}`);
      }
    });

    return {
      currentMode: this.currentMode,
      isReceiverModeActive: this.isReceiverModeActive,
      isIRActive: this.irState.isImported && this.irState.isSelected,
      ambisonicOrder: this.ambisonicOrder,
      dofDescription,
      uiNotice: notices.length > 0 ? notices.join(' | ') : null
    };
  }

  /**
   * Load impulse response from file
   * Updates IR state and auto-selects appropriate mode
   */
  async loadImpulseResponse(file: File): Promise<void> {
    if (!this.audioContext) {
      throw new Error('[AudioOrchestrator] Not initialized');
    }

    try {
      console.log('[AudioOrchestrator] Loading IR:', file.name);

      // Extract file metadata for diagnostics
      const metadata = getAudioFileMetadata(file);
      console.log('[AudioOrchestrator] File info:', {
        size: `${metadata.fileSizeMB} MB`,
        type: metadata.mimeType
      });

      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();

      // Decode audio data with fallback strategy
      let audioBuffer: AudioBuffer;
      try {
        audioBuffer = await decodeAudioFile(this.audioContext, arrayBuffer, metadata);

        // Log success with full buffer info
        const bufferInfo = getAudioBufferInfo(audioBuffer, metadata);
        console.log('[AudioOrchestrator] ✅ Decode successful:', formatAudioBufferInfo(bufferInfo));
      } catch (error) {
        const audioError = handleIRLoadFailure(error as Error);
        logAudioError(audioError, 'AudioOrchestrator');
        throw audioError;
      }

      // Validate channel count
      const channels = audioBuffer.numberOfChannels;
      if (!isSupportedChannelCount(channels)) {
        const audioError = handleUnsupportedChannelCount(channels);
        logAudioError(audioError, 'AudioOrchestrator');
        throw audioError;
      }

      // Update IR state
      this.irState = {
        isImported: true,
        isSelected: false, // Not selected yet
        channelCount: channels,
        buffer: audioBuffer,
        filename: file.name
      };

      console.log(`[AudioOrchestrator] IR loaded: ${channels} channels, ${audioBuffer.duration.toFixed(2)}s`);

      // If currently in an IR mode, update the IR buffer immediately
      // This ensures that switching between IRs works correctly
      if (this.currentModeInstance) {
        this.updateModeIRBuffer(this.currentModeInstance, audioBuffer);
      }

      // Mode will be auto-selected when IR is activated via selectImpulseResponse()
    } catch (error) {
      // Clear IR state on error
      this.irState = {
        isImported: false,
        isSelected: false,
        channelCount: undefined,
        buffer: null,
        filename: undefined
      };
      throw error;
    }
  }

  /**
   * Select/activate the loaded impulse response
   * Triggers mode switch to appropriate IR mode
   */
  async selectImpulseResponse(): Promise<void> {
    if (!this.irState.isImported) {
      throw new Error('[AudioOrchestrator] No IR imported. Load IR first.');
    }

    this.irState.isSelected = true;
    
    // Auto-select appropriate mode based on IR channels
    await this.autoSelectMode();
    
    console.log('[AudioOrchestrator] IR activated');
  }

  /**
   * Deselect impulse response
   * Reverts to Anechoic or user's preferred no-IR mode
   */
  async deselectImpulseResponse(): Promise<void> {
    this.irState.isSelected = false;
    
    // Auto-select appropriate mode (will use no-IR or anechoic)
    await this.autoSelectMode();
    
    console.log('[AudioOrchestrator] IR deactivated');
  }

  /**
   * Clear impulse response
   * Removes IR data and reverts to no-IR mode
   */
  async clearImpulseResponse(): Promise<void> {
    this.irState = {
      isImported: false,
      isSelected: false,
      channelCount: undefined,
      buffer: null,
      filename: undefined
    };
    
    // Auto-select appropriate mode
    await this.autoSelectMode();
    
    console.log('[AudioOrchestrator] IR cleared');
  }

  /**
   * Set user preference for no-IR mode
   */
  setNoIRPreference(mode: 'resonance' | 'anechoic'): void {
    this.noIRPreferences.preferredMode = mode;
    
    // If currently in a no-IR mode, switch to preferred
    if (!this.irState.isImported || !this.irState.isSelected) {
      this.autoSelectMode();
    }
  }

  /**
   * Set receiver mode (for IR-based modes)
   * Locks listener position, allows only head rotation
   * @param isActive Whether receiver mode is active (first-person view)
   * @param receiverId ID of the active receiver (optional)
   * @param hasReceivers Whether any receivers exist in the scene
   */
  setReceiverMode(isActive: boolean, receiverId?: string, hasReceivers?: boolean): void {
    this.isReceiverModeActive = isActive;
    this.receiverId = receiverId || null;
    if (hasReceivers !== undefined) {
      this.hasReceiversInScene = hasReceivers;
    }

    console.log(
      `[AudioOrchestrator] Receiver mode ${isActive ? 'activated' : 'deactivated'}` +
      (receiverId ? ` (receiver: ${receiverId})` : '') +
      ` | Receivers in scene: ${this.hasReceiversInScene}`
    );
  }

  /**
   * Set ambisonic order for anechoic and IR modes
   * Updates both the mode and the binaural decoder
   * Checks browser support and adds warnings if needed
   */
  async setAmbisonicOrder(order: AmbisonicOrder): Promise<void> {
    if (!this.audioContext) {
      throw new Error('[AudioOrchestrator] Not initialized');
    }

    if (order === this.ambisonicOrder) {
      return;
    }

    // Check browser support for requested order
    const maxSupported = Math.max(
      this.browserCapabilities.foa ? 1 : 0,
      this.browserCapabilities.soa ? 2 : 0,
      this.browserCapabilities.toa ? 3 : 0
    );

    if (order > maxSupported) {
      const orderNames = { 1: 'FOA', 2: 'SOA', 3: 'TOA' };
      
      // Log warning
      console.warn(`[AudioOrchestrator] ${orderNames[order]} not supported - falling back to ${orderNames[maxSupported as 1 | 2 | 3]}`);
      
      // Add to warnings
      this.warnings.push(`${orderNames[order]} not supported - using ${orderNames[maxSupported as 1 | 2 | 3]}`);
      
      order = maxSupported as AmbisonicOrder;
    }

    console.log(`[AudioOrchestrator] Changing ambisonic order from ${this.ambisonicOrder} to ${order}`);

    // Update binaural decoder
    if (this.binauralDecoder) {
      await this.binauralDecoder.setOrder(order);
    }

    // Recreate current mode with new order (if ambisonic)
    const isAnechoic = this.currentMode === AudioMode.ANECHOIC;
    const isAmbisonicIR = this.currentMode === AudioMode.AMBISONIC_IR;
    const isMonoIR = this.currentMode === AudioMode.MONO_IR;
    const isStereoIR = this.currentMode === AudioMode.STEREO_IR;

    if (isAnechoic && this.anechoicMode) {
      // Save old mode
      const oldMode = this.anechoicMode;
      
      // Create new mode with new order
      this.anechoicMode = new AnechoicMode();
      await this.anechoicMode.initialize(this.audioContext!, order);

      // Reconnect to decoder
      if (this.binauralDecoder) {
        this.anechoicMode.getOutputNode().connect(this.binauralDecoder.getInputNode());
      }

      // Smooth transition
      await smoothModeTransition(oldMode, this.anechoicMode, this.audioContext!);
      
      // Cleanup old mode
      oldMode.dispose();
      
      // Update current instance
      this.currentModeInstance = this.anechoicMode;
    } else if (isMonoIR && this.monoIRMode) {
      // Update ambisonic order in MonoIRMode
      await this.monoIRMode.setAmbisonicOrder(order);
      
      console.log(`[AudioOrchestrator] MonoIRMode ambisonic order updated to ${order}`);
    } else if (isStereoIR && this.stereoIRMode) {
      // Update ambisonic order in StereoIRMode (speaker mode only)
      await this.stereoIRMode.setAmbisonicOrder(order);
      
      console.log(`[AudioOrchestrator] StereoIRMode ambisonic order updated to ${order}`);
    } else if (isAmbisonicIR && this.ambisonicIRMode) {
      // AmbisonicIRMode order is determined by IR channel count, cannot be changed manually
      const currentOrder = this.ambisonicIRMode.getAmbisonicOrder();
      console.warn(
        `[AudioOrchestrator] Cannot change ambisonic order in AmbisonicIRMode - order is determined by IR channel count (current: ${currentOrder})`
      );
      
      // Keep the current order from IR
      order = currentOrder;
    }

    this.ambisonicOrder = order;
    console.log(`[AudioOrchestrator] Ambisonic order updated to ${order}`);
  }

  /**
   * Set stereo IR interpretation mode
   * Only affects Stereo IR mode
   */
  async setStereoIRInterpretation(mode: 'binaural' | 'speaker'): Promise<void> {
    this.noIRPreferences.stereoIRInterpretation = mode;

    // If currently in stereo IR mode, apply the change immediately
    if (this.currentMode === AudioMode.STEREO_IR && this.stereoIRMode) {
      console.log(`[AudioOrchestrator] Applying stereo IR interpretation: ${mode}`);
      await this.stereoIRMode.setInterpretationMode(mode);
    } else {
      console.log(`[AudioOrchestrator] Stereo IR interpretation preference set to: ${mode}`);
    }
  }

  /**
   * Set normalization for IR convolution
   * Affects Mono IR, Stereo IR, and Ambisonic IR modes
   */
  setNormalize(normalize: boolean): void {
    console.log(`[AudioOrchestrator] Setting normalize: ${normalize}`);
    // TODO: Store normalize preference and apply to IR modes when they are created
    // For now, this is a placeholder for future implementation
    // The IR modes would need to expose a setNormalize method
  }

  /**
   * Update Resonance Audio room materials
   * Only affects Resonance Audio mode
   */
  updateResonanceRoomMaterials(materials: any): void {
    console.log('[AudioOrchestrator] Updating Resonance room materials:', materials);
    
    if (this.currentMode === AudioMode.NO_IR_RESONANCE && this.resonanceMode) {
      console.log('[AudioOrchestrator] Applying room materials to active Resonance mode');
      
      // Get current dimensions from the mode
      const dimensions = this.resonanceMode.getRoomDimensions();
      
      this.resonanceMode.setRoomProperties(dimensions, materials);
    } else {
      console.warn('[AudioOrchestrator] Cannot apply materials - Resonance mode not active');
    }
  }

  /**
   * Update Resonance Audio room dimensions
   * Only affects Resonance Audio mode
   */
  updateResonanceRoomDimensions(dimensions: any): void {
    console.log('[AudioOrchestrator] Updating Resonance room dimensions:', dimensions);
    
    if (this.currentMode === AudioMode.NO_IR_RESONANCE && this.resonanceMode) {
      console.log('[AudioOrchestrator] Applying room dimensions to active Resonance mode');
      
      // Get current materials from the mode
      const materials = this.resonanceMode.getRoomMaterials();
      
      this.resonanceMode.setRoomProperties(dimensions, materials);
    } else {
      console.warn('[AudioOrchestrator] Cannot apply dimensions - Resonance mode not active');
    }
  }

  /**
   * Get current warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Clear all warnings
   */
  clearWarnings(): void {
    this.warnings = [];
  }

  /**
   * Get IR state
   */
  getIRState(): IRState {
    return { ...this.irState };
  }

  /**
   * Get supported ambisonic orders
   */
  getSupportedOrders(): { foa: boolean; soa: boolean; toa: boolean } {
    return { ...this.browserCapabilities };
  }

  /**
   * Create audio source at given position
   * Routes to current mode implementation
   */
  createSource(
    sourceId: string,
    audioBuffer: AudioBuffer,
    position: Position
  ): void {
    if (!this.currentModeInstance) {
      throw new Error('[AudioOrchestrator] No mode active');
    }

    // Register source for re-creation on mode switch
    this.sourceRegistry.set(sourceId, { buffer: audioBuffer, position });

    this.currentModeInstance.createSource(sourceId, audioBuffer, position);
  }

  /**
   * Re-create all registered sources in the current mode
   * Called after mode switch to ensure sources exist
   */
  private reCreateSourcesInCurrentMode(): void {
    if (!this.currentModeInstance) return;

    console.log(`[AudioOrchestrator] Re-creating ${this.sourceRegistry.size} sources in new mode`);

    for (const [sourceId, { buffer, position }] of this.sourceRegistry) {
      try {
        this.currentModeInstance.createSource(sourceId, buffer, position);
        console.log(`[AudioOrchestrator] ✅ Re-created source: ${sourceId}`);
      } catch (error) {
        console.error(`[AudioOrchestrator] ❌ Failed to re-create source ${sourceId}:`, error);
      }
    }
  }

  /**
   * Update source position (when source moves)
   * Routes to current mode implementation
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    if (!this.currentModeInstance) {
      throw new Error('[AudioOrchestrator] No mode active');
    }

    // Update position in registry
    const existing = this.sourceRegistry.get(sourceId);
    if (existing) {
      this.sourceRegistry.set(sourceId, { ...existing, position });
    }

    this.currentModeInstance.updateSourcePosition(sourceId, position);
  }

  /**
   * Remove audio source
   * Routes to current mode implementation
   */
  removeSource(sourceId: string): void {
    if (!this.currentModeInstance) {
      throw new Error('[AudioOrchestrator] No mode active');
    }

    // Remove from registry
    this.sourceRegistry.delete(sourceId);

    this.currentModeInstance.removeSource(sourceId);
  }

  /**
   * Start audio playback for a source
   * Routes to current mode implementation
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0): void {
    if (!this.currentModeInstance) {
      console.error('[AudioOrchestrator] ❌ playSource failed: No mode active');
      throw new Error('[AudioOrchestrator] No mode active');
    }

    console.log(`[AudioOrchestrator] 🎵 Routing playback to ${this.currentMode} mode`);
    console.log(`  - Source ID: ${sourceId}`);
    console.log(`  - Loop: ${loop}`);
    console.log(`  - Offset: ${offset}s`);
    console.log(`  - Mode instance:`, this.currentModeInstance.constructor.name);

    this.currentModeInstance.playSource(sourceId, loop, offset);
  }

  /**
   * Stop audio playback for a source
   * Routes to current mode implementation
   */
  stopSource(sourceId: string): void {
    if (!this.currentModeInstance) {
      throw new Error('[AudioOrchestrator] No mode active');
    }

    this.currentModeInstance.stopSource(sourceId);
  }

  /**
   * Stop all audio sources immediately
   * Routes to current mode implementation
   */
  stopAllSources(): void {
    if (!this.currentModeInstance) {
      console.warn('[AudioOrchestrator] No mode active for stopAllSources');
      return;
    }

    console.log('[AudioOrchestrator] Stopping all sources');
    this.currentModeInstance.stopAllSources();
  }

  /**
   * Update listener position and orientation (called every frame)
   * Routes to current mode implementation
   * Also updates binaural decoder for head rotation
   */
  updateListener(position: Position, orientation: Orientation): void {
    if (!this.currentModeInstance) {
      return;
    }

    // Update mode (for position-based encoding)
    this.currentModeInstance.updateListener(position, orientation);

    // Update binaural decoder (for head rotation)
    if (this.binauralDecoder) {
      this.binauralDecoder.updateOrientation(orientation);
    }
  }

  /**
   * Set volume for a specific source (0.0 to 1.0)
   * Routes to current mode implementation
   */
  setSourceVolume(sourceId: string, volume: number): void {
    if (!this.currentModeInstance) {
      return;
    }

    this.currentModeInstance.setSourceVolume(sourceId, volume);
  }

  /**
   * Set mute state for a specific source
   * Routes to current mode implementation
   */
  setSourceMute(sourceId: string, muted: boolean): void {
    if (!this.currentModeInstance) {
      return;
    }

    this.currentModeInstance.setSourceMute(sourceId, muted);
  }

  /**
   * Set master/global volume (0.0 to 1.0)
   * Routes to current mode implementation
   */
  setMasterVolume(volume: number): void {
    if (!this.currentModeInstance) {
      return;
    }

    this.currentModeInstance.setMasterVolume(volume);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    console.log('[AudioOrchestrator] Disposing');

    // Dispose all mode instances
    if (this.anechoicMode) {
      this.anechoicMode.dispose();
      this.anechoicMode = null;
    }
    if (this.resonanceMode) {
      this.resonanceMode.dispose();
      this.resonanceMode = null;
    }
    if (this.monoIRMode) {
      this.monoIRMode.dispose();
      this.monoIRMode = null;
    }
    if (this.stereoIRMode) {
      this.stereoIRMode.dispose();
      this.stereoIRMode = null;
    }
    if (this.ambisonicIRMode) {
      this.ambisonicIRMode.dispose();
      this.ambisonicIRMode = null;
    }

    // Dispose binaural decoder
    if (this.binauralDecoder) {
      this.binauralDecoder.dispose();
      this.binauralDecoder = null;
    }

    this.currentModeInstance = null;
    this.audioContext = null;
    this.initialized = false;
  }
}

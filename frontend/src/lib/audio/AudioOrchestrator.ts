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
  AmbisonicOrder,
  SourceReceiverIRMapping,
  AcousticSimulationMode,
  ImpulseResponseMetadata
} from '@/types/audio';
import { AudioMode } from '@/types/audio';

import { AnechoicMode } from './modes/AnechoicMode';
import { ResonanceMode } from './modes/ResonanceMode';
import { AmbisonicIRMode } from './modes/AmbisonicIRMode';
import type { IBinauralDecoder } from './core/interfaces/IBinauralDecoder';
import { BinauralDecoder } from './decoders/BinauralDecoder';
import { OmnitoneFOADecoder } from './decoders/OmnitoneFOADecoder';

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
import { AUDIO_CONTROL, AMBISONIC } from '@/utils/constants';

export class AudioOrchestrator implements IAudioOrchestrator {
  private audioContext: AudioContext | null = null;
  private currentMode: AudioMode = AudioMode.ANECHOIC;
  private currentModeInstance: IAudioMode | null = null;
  private ambisonicOrder: AmbisonicOrder = 1; // Default to FOA

  // Mode instances (lazy-loaded)
  private anechoicMode: AnechoicMode | null = null;
  private resonanceMode: ResonanceMode | null = null;
  private ambisonicIRMode: AmbisonicIRMode | null = null;

  // Binaural decoder (shared by all ambisonic modes)
  // Uses either JSAmbisonics or Omnitone based on AMBISONIC.USE_OMNITONE_FOR_FOA constant
  private binauralDecoder: IBinauralDecoder | null = null;
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

  // Simulation-based acoustics state
  private simulationMode: AcousticSimulationMode = 'none';
  private sourceReceiverIRMapping: SourceReceiverIRMapping | null = null;
  private activeReceiverId: string | null = null;

  // Source registry - tracks all sources for re-creation on mode switch
  private sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }> = new Map();

  // IR cache - prevents double downloads of same IR (keyed by IR metadata id)
  private irCache: Map<string, AudioBuffer> = new Map();

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
      // For FOA, use Omnitone if enabled in constants, otherwise use JSAmbisonics
      // For SOA/TOA, always use JSAmbisonics (Omnitone doesn't support higher orders)
      const useFOA = this.ambisonicOrder === 1;
      const useOmnitone = useFOA && AMBISONIC.USE_OMNITONE_FOR_FOA;
      
      if (useOmnitone) {
        console.log('[AudioOrchestrator] Using Omnitone FOA decoder (Google SADIE HRTFs)');
        this.binauralDecoder = new OmnitoneFOADecoder();
      } else {
        console.log(`[AudioOrchestrator] Using JSAmbisonics decoder (order ${this.ambisonicOrder})`);
        this.binauralDecoder = new BinauralDecoder();
      }
      
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
    console.log('[AudioOrchestrator] autoSelectMode called with IR state:', {
      isImported: this.irState.isImported,
      isSelected: this.irState.isSelected,
      channelCount: this.irState.channelCount,
      filename: this.irState.filename
    });

    const selection = selectAudioMode(this.irState, this.noIRPreferences);
    
    console.log('[AudioOrchestrator] Mode selector result:', {
      selectedMode: selection.mode,
      ambisonicOrder: selection.ambisonicOrder,
      requiresReceiver: selection.requiresReceiver,
      dof: selection.dof
    });

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
      // Check if buffer matches mode requirements (all supported channel counts)
      if (mode === this.ambisonicIRMode && [1, 2, 4, 9, 16].includes(channels)) {
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

            // Apply pending room bounds if available
            if (this._pendingRoomBounds) {
              this.resonanceMode.setRoomBounds(
                this._pendingRoomBounds.min,
                this._pendingRoomBounds.max
              );
              this._pendingRoomBounds = null;
            }
          }
          return this.resonanceMode;

        case AudioMode.ANECHOIC:
          if (!this.anechoicMode) {
            this.anechoicMode = new AnechoicMode();
            await this.anechoicMode.initialize(this.audioContext, this.ambisonicOrder);

            // Connect to binaural decoder, then to limiter
            if (this.binauralDecoder) {
              safeConnect(
                this.anechoicMode.getOutputNode(),
                this.binauralDecoder.getInputNode()
              );
              safeConnect(
                this.binauralDecoder.getOutputNode(),
                this.limiter!
              );
            }
          }
          return this.anechoicMode;

        case AudioMode.AMBISONIC_IR:
          // Handles all IR types: Mono (1ch), Stereo (2ch), FOA (4ch), SOA (9ch), TOA (16ch)
          if (!this.ambisonicIRMode) {
            this.ambisonicIRMode = new AmbisonicIRMode();
            await this.ambisonicIRMode.initialize(this.audioContext);
            this.connectModeToOutput(this.ambisonicIRMode);
          }
          
          // Always update IR buffer if available (handles IR switching)
          // Supports all IR types: mono (1ch), stereo (2ch), FOA (4ch), SOA (9ch), and TOA (16ch)
          const channels = this.irState.buffer?.numberOfChannels;
          if (this.irState.buffer && channels && [1, 2, 4, 9, 16].includes(channels)) {
            await this.ambisonicIRMode.setImpulseResponse(this.irState.buffer);

            // Update ambisonic order from IR (for multi-channel IRs)
            if (channels > 1) {
              const order = getAmbisonicOrderFromChannels(channels);
              if (order) {
                this.ambisonicOrder = order;
              }
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
    
    console.log('[AudioOrchestrator] setMode called:', {
      requestedMode: newMode,
      currentMode: this.currentMode,
      ambisonicOrder: config.ambisonicOrder
    });

    // Skip if already in this mode with same ambisonic order AND mode instance exists
    // Must check currentModeInstance to ensure mode is actually initialized
    const sameOrder = !config.ambisonicOrder || config.ambisonicOrder === this.ambisonicOrder;
    if (newMode === this.currentMode && sameOrder && this.currentModeInstance) {
      console.log(`[AudioOrchestrator] Already in ${newMode} mode (order ${this.ambisonicOrder}), skipping switch`);
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
   * Set source-receiver IR mapping for simulation-based acoustics
   * Enables per-source IR assignment based on active receiver
   * @param mapping - Source-receiver IR mapping
   * @param simulationMode - Type of simulation (pyroomacoustics, choras)
   * @param initialReceiverId - Initial receiver to activate (optional)
   */
  async setSourceReceiverIRMapping(
    mapping: SourceReceiverIRMapping,
    simulationMode: AcousticSimulationMode,
    initialReceiverId?: string
  ): Promise<void> {
    this.sourceReceiverIRMapping = mapping;
    this.simulationMode = simulationMode;
    this.activeReceiverId = initialReceiverId || null;

    console.log('[AudioOrchestrator] Source-Receiver IR mapping set:', {
      simulationMode,
      sourceCount: Object.keys(mapping).length,
      receiverCount: Object.keys(mapping[Object.keys(mapping)[0]] || {}).length,
      activeReceiverId: this.activeReceiverId
    });

    // Get first IR to determine channel count for mode selection
    const firstSourceId = Object.keys(mapping)[0];
    const firstReceiverId = Object.keys(mapping[firstSourceId] || {})[0];
    const firstIRMetadata = mapping[firstSourceId]?.[firstReceiverId];

    if (firstIRMetadata) {
      // Mark IR state as imported and selected (simulation-based)
      this.irState = {
        isImported: true,
        isSelected: true,
        channelCount: firstIRMetadata.channels,
        buffer: null, // Will be loaded per-source
        filename: `Simulation: ${simulationMode}`
      };

      console.log('[AudioOrchestrator] IR state updated for simulation:', {
        channels: firstIRMetadata.channels,
        filename: this.irState.filename,
        isImported: this.irState.isImported,
        isSelected: this.irState.isSelected
      });

      // Only switch mode if not already in AMBISONIC_IR mode with initialized instance
      // This prevents unnecessary mode switches when switching between simulation tabs
      if (this.currentMode !== AudioMode.AMBISONIC_IR || !this.currentModeInstance) {
        console.log('[AudioOrchestrator] Calling autoSelectMode() to switch to IR mode...');
        await this.autoSelectMode();
        console.log('[AudioOrchestrator] Mode after autoSelectMode:', this.currentMode);
      } else {
        console.log('[AudioOrchestrator] Already in AMBISONIC_IR mode, skipping mode switch');
      }
    } else {
      console.warn('[AudioOrchestrator] No IR metadata found in mapping - cannot determine channel count');
    }

    // Update all source IRs based on active receiver (if set)
    if (this.activeReceiverId) {
      await this.updateSourceIRsForReceiver(this.activeReceiverId);
    }
  }

  /**
   * Update active receiver (called when receiver selection changes)
   * Loads corresponding IRs for all sources based on the new receiver
   * @param receiverId - ID of the receiver to activate
   */
  async updateActiveReceiver(receiverId: string): Promise<void> {
    console.log('[AudioOrchestrator] 🎯 updateActiveReceiver called:', receiverId);
    
    if (!this.sourceReceiverIRMapping) {
      console.warn('[AudioOrchestrator] ❌ No source-receiver mapping available');
      return;
    }

    console.log('[AudioOrchestrator] Source-receiver mapping exists:', {
      sourceCount: Object.keys(this.sourceReceiverIRMapping).length,
      sources: Object.keys(this.sourceReceiverIRMapping)
    });

    this.activeReceiverId = receiverId;
    console.log('[AudioOrchestrator] 📍 Set active receiver to:', receiverId);

    await this.updateSourceIRsForReceiver(receiverId);
  }

  /**
   * Update all source IRs based on active receiver
   * Downloads IR buffers and applies them to each source
   * @param receiverId - ID of the receiver to use for IR selection
   */
  private async updateSourceIRsForReceiver(receiverId: string): Promise<void> {
    if (!this.sourceReceiverIRMapping || !this.currentModeInstance) {
      console.warn('[AudioOrchestrator] Cannot update source IRs - missing mapping or mode');
      return;
    }

    console.log('[AudioOrchestrator] Updating source IRs for receiver:', receiverId);

    // Check if current mode supports per-source IR setting
    const supportsPerSourceIR = 'setSourceImpulseResponse' in this.currentModeInstance;
    if (!supportsPerSourceIR) {
      console.warn('[AudioOrchestrator] Current mode does not support per-source IR setting');
      return;
    }

    // For each source in the registry
    for (const [sourceId] of this.sourceRegistry) {
      const irMetadata = this.sourceReceiverIRMapping[sourceId]?.[receiverId];

      if (irMetadata) {
        try {
          // Download and decode IR buffer
          const irBuffer = await this.downloadAndDecodeIR(irMetadata);

          // Update mode with per-source IR
          (this.currentModeInstance as any).setSourceImpulseResponse(sourceId, irBuffer);

          console.log(`[AudioOrchestrator] ✅ Updated IR for source "${sourceId}" with receiver "${receiverId}"`);
        } catch (error) {
          console.error(`[AudioOrchestrator] ❌ Failed to update IR for source "${sourceId}":`, error);
        }
      } else {
        console.warn(`[AudioOrchestrator] No IR found for source "${sourceId}" and receiver "${receiverId}"`);
      }
    }

    console.log('[AudioOrchestrator] Finished updating source IRs');
  }

  /**
   * Download and decode an IR from metadata
   * @param irMetadata - IR metadata containing URL and file info
   * @returns Decoded AudioBuffer
   */
  private async downloadAndDecodeIR(irMetadata: ImpulseResponseMetadata): Promise<AudioBuffer> {
    if (!this.audioContext) {
      throw new Error('[AudioOrchestrator] Not initialized');
    }

    // Check cache first
    const cacheKey = irMetadata.id;
    const cached = this.irCache.get(cacheKey);
    if (cached) {
      console.log(`[AudioOrchestrator] Using cached IR: ${irMetadata.name}`);
      return cached;
    }

    try {
      // Build full URL (metadata.url is relative like "/static/impulse_responses/file.wav")
      const fullUrl = `http://localhost:8000${irMetadata.url}`;

      // Download the IR file
      const response = await fetch(fullUrl);
      if (!response.ok) {
        throw new Error(`Failed to download IR: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();

      // Decode audio data
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      // Cache the decoded buffer
      this.irCache.set(cacheKey, audioBuffer);

      console.log(`[AudioOrchestrator] Downloaded and decoded IR: ${irMetadata.name} (${audioBuffer.numberOfChannels}ch)`);

      return audioBuffer;
    } catch (error) {
      console.error('[AudioOrchestrator] Failed to download/decode IR:', error);
      throw error;
    }
  }

  /**
   * Clear IR cache (called when simulation changes)
   */
  private clearIRCache(): void {
    this.irCache.clear();
    console.log('[AudioOrchestrator] IR cache cleared');
  }

  /**
   * Hot-swap source-receiver IR mapping without stopping playback.
   * Only updates the mapping and per-source IRs — no mode switch, no source re-creation,
   * no timeline reset. Used when switching between completed simulations while audio is playing.
   * @param mapping - New source-receiver IR mapping
   * @param simulationMode - Type of simulation (pyroomacoustics, choras)
   * @param activeReceiverId - Receiver to use for IR selection
   */
  async hotSwapSourceReceiverIRMapping(
    mapping: SourceReceiverIRMapping,
    simulationMode: AcousticSimulationMode,
    activeReceiverId?: string
  ): Promise<void> {
    this.sourceReceiverIRMapping = mapping;
    this.simulationMode = simulationMode;
    this.activeReceiverId = activeReceiverId || this.activeReceiverId;

    console.log('[AudioOrchestrator] Hot-swapping IR mapping (no stop):', {
      simulationMode,
      sourceCount: Object.keys(mapping).length,
      activeReceiverId: this.activeReceiverId
    });

    // Update per-source IRs for the active receiver without any mode/source changes
    if (this.activeReceiverId) {
      await this.updateSourceIRsForReceiver(this.activeReceiverId);
    }
  }

  /**
   * Clear source-receiver IR mapping (exit simulation mode)
   */
  clearSourceReceiverIRMapping(): void {
    this.sourceReceiverIRMapping = null;
    this.simulationMode = 'none';
    this.activeReceiverId = null;
    this.clearIRCache();

    console.log('[AudioOrchestrator] Source-receiver IR mapping cleared');
  }

  /**
   * Get orchestrator status for UI display
   */
  getStatus(): OrchestratorStatus {
    const requiresReceiver = this.currentModeInstance?.requiresReceiverMode() || false;
    const isAmbisonic = [
      AudioMode.ANECHOIC,
      AudioMode.AMBISONIC_IR
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
    
    // Ambisonic order info
    if (isAmbisonic) {
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
   * Set Resonance Audio room bounds from model bounding box.
   * Computes room dimensions and center offset so sources sit inside the room.
   * @param min - Bounding box min corner [x, y, z]
   * @param max - Bounding box max corner [x, y, z]
   */
  updateResonanceRoomBounds(
    min: [number, number, number],
    max: [number, number, number]
  ): void {
    if (this.resonanceMode) {
      this.resonanceMode.setRoomBounds(min, max);
    } else {
      // Store for later application when mode is initialized
      this._pendingRoomBounds = { min, max };
    }
  }

  /** Pending room bounds to apply once ResonanceMode is initialized */
  private _pendingRoomBounds: { min: [number, number, number]; max: [number, number, number] } | null = null;

  /**
   * Get the current audio state needed for offline export.
   * Returns mode, source registry, listener state, and IR buffers.
   */
  getExportState(): {
    mode: AudioMode;
    ambisonicOrder: AmbisonicOrder;
    sampleRate: number;
    sourceRegistry: Map<string, { buffer: AudioBuffer; position: Position }>;
    listenerPosition: Position;
    listenerOrientation: Orientation;
    irBuffer: AudioBuffer | null;
    perSourceIRBuffers: Map<string, AudioBuffer>;
    originalIRChannelCount: number;
  } {
    // Extract listener state from current mode instance
    let listenerPosition: Position = { x: 0, y: 0, z: 0 } as Position;
    let listenerOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

    if (this.currentModeInstance) {
      const modeAny = this.currentModeInstance as any;
      if (modeAny.listenerPosition) listenerPosition = modeAny.listenerPosition;
      if (modeAny.listenerOrientation) listenerOrientation = modeAny.listenerOrientation;
    }

    // Get processed IR buffers from AmbisonicIRMode
    let irBuffer: AudioBuffer | null = null;
    let perSourceIRBuffers = new Map<string, AudioBuffer>();

    if (this.currentMode === AudioMode.AMBISONIC_IR && this.ambisonicIRMode) {
      irBuffer = this.ambisonicIRMode.getProcessedIRBuffer();
      perSourceIRBuffers = this.ambisonicIRMode.getSourceIRBuffers();
    }

    return {
      mode: this.currentMode,
      ambisonicOrder: this.ambisonicOrder,
      sampleRate: this.audioContext?.sampleRate ?? 48000,
      sourceRegistry: new Map(this.sourceRegistry),
      listenerPosition,
      listenerOrientation,
      irBuffer,
      perSourceIRBuffers,
      originalIRChannelCount: this.irState.channelCount ?? 0,
    };
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

    // If in simulation mode with active receiver, apply source-specific IR immediately
    if (this.sourceReceiverIRMapping && this.activeReceiverId && this.simulationMode !== 'none') {
      const irMetadata = this.sourceReceiverIRMapping[sourceId]?.[this.activeReceiverId];
      
      if (irMetadata) {
        console.log(`[AudioOrchestrator] Applying simulation IR for newly created source: ${sourceId}`);
        
        // Apply IR asynchronously (don't block source creation)
        this.downloadAndDecodeIR(irMetadata)
          .then(irBuffer => {
            // Check if mode supports per-source IR setting
            if ('setSourceImpulseResponse' in this.currentModeInstance!) {
              (this.currentModeInstance as any).setSourceImpulseResponse(sourceId, irBuffer);
              console.log(`[AudioOrchestrator] ✅ Applied IR to new source: ${sourceId}`);
            }
          })
          .catch(error => {
            console.error(`[AudioOrchestrator] ❌ Failed to apply IR to new source ${sourceId}:`, error);
          });
      }
    }
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

    // If in simulation mode with active receiver, re-apply all source IRs
    if (this.sourceReceiverIRMapping && this.activeReceiverId && this.simulationMode !== 'none') {
      console.log('[AudioOrchestrator] Re-applying simulation IRs after mode switch');
      this.updateSourceIRsForReceiver(this.activeReceiverId).catch(error => {
        console.error('[AudioOrchestrator] Failed to re-apply simulation IRs:', error);
      });
    }
  }

  /**
   * Update source position (when source moves)
   * Routes to current mode implementation
   */
  updateSourcePosition(sourceId: string, position: Position): void {
    // Update position in registry regardless of mode state
    const existing = this.sourceRegistry.get(sourceId);
    if (existing) {
      this.sourceRegistry.set(sourceId, { ...existing, position });
    }

    if (!this.currentModeInstance) {
      // Position saved in registry; will be applied when mode activates
      return;
    }

    this.currentModeInstance.updateSourcePosition(sourceId, position);
  }

  /**
   * Remove audio source
   * Routes to current mode implementation
   */
  removeSource(sourceId: string): void {
    // Remove from registry regardless of mode state
    this.sourceRegistry.delete(sourceId);

    if (!this.currentModeInstance) {
      // No mode active — source was only registered, nothing to tear down
      console.warn('[AudioOrchestrator] removeSource: no mode active, skipping', sourceId);
      return;
    }

    this.currentModeInstance.removeSource(sourceId);
  }

  /**
   * Start audio playback for a source
   * Routes to current mode implementation
   * @param sourceId - Source identifier
   * @param loop - Whether to loop the audio
   * @param offset - Start playback from this position in seconds (default: 0)
   */
  playSource(sourceId: string, loop: boolean = false, offset: number = 0, duration?: number): void {
    if (!this.currentModeInstance) {
      console.error('[AudioOrchestrator] ❌ playSource failed: No mode active');
      throw new Error('[AudioOrchestrator] No mode active');
    }

    console.log(`[AudioOrchestrator] 🎵 Routing playback to ${this.currentMode} mode`);
    console.log(`  - Source ID: ${sourceId}`);
    console.log(`  - Loop: ${loop}`);
    console.log(`  - Offset: ${offset}s`);
    console.log(`  - Duration: ${duration ?? 'full'}s`);
    console.log(`  - Mode instance:`, this.currentModeInstance.constructor.name);

    this.currentModeInstance.playSource(sourceId, loop, offset, duration);
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

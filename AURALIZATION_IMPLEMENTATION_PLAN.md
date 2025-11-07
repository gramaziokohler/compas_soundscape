# Auralization Workflow Implementation Plan

**Project:** COMPAS Soundscape - Physically Accurate Architectural Audio Rendering
**Date:** 2025-11-07
**Version:** 1.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Architecture Design](#3-architecture-design)
4. [Module Specifications](#4-module-specifications)
5. [Implementation Phases](#5-implementation-phases)
6. [Code Structure](#6-code-structure)
7. [Integration Points](#7-integration-points)
8. [Testing Strategy](#8-testing-strategy)
9. [Risk Assessment](#9-risk-assessment)
10. [Appendices](#10-appendices)

---

## 1. Executive Summary

### 1.1 Objective

Implement a modular, physically accurate auralization workflow for architectural audio rendering that intelligently adapts to user-provided impulse responses (IRs) while maintaining the highest level of spatial audio fidelity.

### 1.2 Key Design Principles

**Modular Architecture:**
- Single Responsibility Principle (SRP)
- Separation of Concerns
- Dependency Injection
- Interface-based Design
- Testability First

**Audio Rendering Principles:**
- Physical accuracy over convenience
- Explicit user control via UI
- Progressive enhancement based on available resources
- Clear feedback on spatial audio capabilities/limitations

### 1.3 High-Level Requirements

| Scenario | Spatial Rendering | Output Decoding | UI Feedback |
|----------|------------------|-----------------|-------------|
| **No IR** | Three.js Positional OR Resonance Audio | HRTF Binaural OR Stereo | Mode selector |
| **Mono IR** | Three.js Positional + ConvolverNode | HRTF Binaural OR Stereo | "Head-locked, no rotation" notice |
| **Spatial IR** (2/4/16-ch) | Ambisonics Convolver (3DoF) | HRTF Binaural OR Stereo | "3DoF rotation enabled" notice |

**Critical Constraint:** All IR-based convolution ONLY active when in receiver mode (first-person view).

---

## 2. Requirements Analysis

### 2.1 Functional Requirements

#### FR1: No Impulse Response Mode

**FR1.1:** When no IR is loaded, user can choose between:
- Three.js Positional Audio (simple distance-based attenuation)
- Resonance Audio (HRTF + room acoustics)

**FR1.2:** Output decoding selectable via UI:
- HRTF Binaural (headphones)
- Stereo Speakers (cross-talk cancellation)

**FR1.3:** Both spatial renderers support full 6DOF movement and rotation.

---

#### FR2: Mono Impulse Response Mode

**FR2.1:** When mono IR is loaded:
- Disable Resonance Audio automatically
- Enable convolution ONLY in receiver mode
- Use Three.js Positional Audio for sound source spatialization
- Apply mono IR via ConvolverNode to all spatialized sources

**FR2.2:** Degrees of Freedom:
- **0 DoF for IR**: Head-locked (no rotation affects IR)
- **6 DoF for sound sources**: Full positional audio from Three.js

**FR2.3:** UI Feedback:
- Display notice: "Mono IR loaded: Head-locked mode (no rotation)"
- Explain that IR represents a fixed room recording
- Show IR is only active in receiver mode

**FR2.4:** Signal Flow:
```
Sound Sources → Three.js PositionalAudio → ConvolverNode (Mono IR) → Binaural/Stereo Decoder → Output
```

---

#### FR3: Spatial Impulse Response Mode

**FR3.1:** When multi-channel IR is loaded (2, 4, or 16 channels):
- Disable Resonance Audio automatically
- Detect IR format: Binaural (2ch), FOA (4ch), TOA (16ch)
- Enable convolution ONLY in receiver mode
- Support 3 DoF head rotation (yaw, pitch, roll)

**FR3.2:** Robust Multi-Channel Handling:
- **2 channels**: Binaural IR (pre-rendered HRTF)
  - Direct convolution, rotation handled by head-tracking if available
  - OR use Mach1Decode for binaural rotation
- **4 channels**: First-Order Ambisonics (FOA)
  - Use ambisonics.js for decoding
  - Apply rotation matrix based on camera orientation
  - Decode to binaural or stereo
- **16 channels**: Third-Order Ambisonics (TOA)
  - Use ambisonics.js or Mach1Transcode
  - Apply rotation matrix
  - Decode to binaural or stereo

**FR3.3:** Degrees of Freedom:
- **3 DoF for IR**: Head rotation affects ambisonic decoding
- **Static position**: Listener stays at receiver position (no translation)
- **6 DoF for sound sources**: Full positional audio (encoded to ambisonics)

**FR3.4:** UI Feedback:
- Display notice: "Spatial IR loaded: 3DoF rotation enabled (static position)"
- Show IR format: "Binaural (2ch)" / "FOA (4ch)" / "TOA (16ch)"
- Explain rotation is supported, position is fixed at receiver
- Show IR is only active in receiver mode

**FR3.5:** Signal Flow (FOA/TOA example):
```
Sound Sources → Ambisonic Encoder (position) → Convolver (IR per channel) → Rotation Matrix (orientation) → Binaural/Stereo Decoder → Output
```

---

#### FR4: Receiver Mode Constraint

**FR4.1:** IR-based convolution is ONLY active when:
- User is in first-person receiver mode
- Camera is positioned at a receiver location
- IR toggle is enabled

**FR4.2:** When NOT in receiver mode:
- Convolution is bypassed/disabled
- Audio reverts to Three.js Positional OR Resonance Audio
- UI clearly indicates "IR inactive (not in receiver mode)"

**FR4.3:** Receiver mode detection:
- `isFirstPersonMode === true`
- `activeReceiverId !== null`

---

#### FR5: Output Decoding Selection

**FR5.1:** User can always choose output format via UI toggle:
- **HRTF Binaural**: For headphone listening
  - Use HRTF decoder (resonance-audio, ambisonics.js, or Mach1)
  - 2-channel output
- **Stereo Speakers**: For speaker playback
  - Use stereo decoder (cross-talk cancellation)
  - 2-channel output with speaker spacing compensation

**FR5.2:** Decoder choice is independent of:
- IR presence/absence
- IR format (mono/spatial)
- Spatial renderer choice (Three.js/Resonance/Ambisonics)

**FR5.3:** UI persistence:
- Remember user's decoder preference across sessions
- Default to HRTF Binaural

---

### 2.2 Non-Functional Requirements

#### NFR1: Modularity

- Each audio processing stage is an independent module
- Modules communicate via well-defined interfaces
- Easy to swap implementations (e.g., Mach1 vs ambisonics.js)

#### NFR2: Performance

- Audio processing must not exceed ~5ms latency
- No audio glitches when switching modes
- Efficient memory management for large IRs (TOA can be 16x size)

#### NFR3: Robustness

- Handle malformed IR files gracefully
- Fallback to simpler modes if decoding fails
- Clear error messages for users

#### NFR4: User Experience

- Instant visual feedback on mode changes
- No unexpected behavior when switching receivers
- Smooth transitions when enabling/disabling IR

#### NFR5: Maintainability

- Clear code documentation
- TypeScript type safety
- Unit tests for audio processing logic
- Integration tests for signal flow

---

## 3. Architecture Design

### 3.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │ Spatial Mode   │  │ Output Decoder   │  │ IR Upload       │ │
│  │ Selector       │  │ Toggle           │  │ Component       │ │
│  │ (UI Component) │  │ (HRTF/Stereo)    │  │                 │ │
│  └────────────────┘  └──────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            ↓ ↓ ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AUDIO ORCHESTRATOR                           │
│                   (Central Coordinator)                         │
│  - Manages mode state                                           │
│  - Routes audio to appropriate renderer                         │
│  - Handles mode transitions                                     │
│  - Enforces receiver mode constraint                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓ ↓ ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
┌───────────────┐  ┌────────────────┐  ┌─────────────────────┐
│   No IR Mode  │  │  Mono IR Mode  │  │  Spatial IR Mode    │
│   Renderer    │  │  Renderer      │  │  Renderer           │
│               │  │                │  │                     │
│ - Three.js    │  │ - Three.js     │  │ - Ambisonic Encoder │
│   Positional  │  │   Positional   │  │ - Convolver (IR)    │
│ - Resonance   │  │ - ConvolverNode│  │ - Rotation Matrix   │
│   Audio       │  │   (Mono IR)    │  │ - Decoder           │
└───────────────┘  └────────────────┘  └─────────────────────┘
        ↓                   ↓                   ↓
        └───────────────────┼───────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    OUTPUT DECODER STAGE                         │
│  ┌──────────────────┐           ┌──────────────────────┐       │
│  │  Binaural HRTF   │           │  Stereo Speakers     │       │
│  │  Decoder         │           │  Decoder             │       │
│  └──────────────────┘           └──────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                      WEB AUDIO OUTPUT                           │
│                   (AudioContext.destination)                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Module Dependency Graph

```
┌──────────────────────────────────────────────────────────────┐
│                       Core Interfaces                        │
│  - IAudioRenderer                                            │
│  - IOutputDecoder                                            │
│  - IImpulseResponseHandler                                   │
│  - IAudioOrchestrator                                        │
└──────────────────────────────────────────────────────────────┘
                            ↑
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────────────┐  ┌────────────────┐  ┌─────────────────────┐
│ NoIRRenderer  │  │ MonoIRRenderer │  │ SpatialIRRenderer   │
│ (implements   │  │ (implements    │  │ (implements         │
│ IAudioRenderer│  │ IAudioRenderer)│  │ IAudioRenderer)     │
│)              │  │                │  │                     │
│ - uses:       │  │ - uses:        │  │ - uses:             │
│   Three.js    │  │   Three.js     │  │   AmbisonicEncoder  │
│   Resonance   │  │   ConvolverNode│  │   ConvolverNode[]   │
│   Audio       │  │                │  │   RotationMatrix    │
└───────────────┘  └────────────────┘  └─────────────────────┘
                                                 ↓
                                    ┌────────────────────────┐
                                    │ IRFormatDetector       │
                                    │ - Mono (1ch)           │
                                    │ - Binaural (2ch)       │
                                    │ - FOA (4ch)            │
                                    │ - TOA (16ch)           │
                                    └────────────────────────┘
        ┌───────────────────────────────────────┐
        │                                       │
┌───────────────────┐              ┌────────────────────────┐
│ BinauralDecoder   │              │ StereoDecoder          │
│ (implements       │              │ (implements            │
│ IOutputDecoder)   │              │ IOutputDecoder)        │
│ - uses:           │              │ - uses:                │
│   HRTF filters    │              │   Cross-talk cancel    │
└───────────────────┘              └────────────────────────┘
```

### 3.3 State Machine: Audio Rendering Modes

```
┌──────────────────────────────────────────────────────────────────┐
│                      AUDIO RENDERING STATE                       │
└──────────────────────────────────────────────────────────────────┘

[INITIAL STATE]
     │
     ├─► NO_IR_MODE
     │   ├─ Renderer: Three.js Positional OR Resonance Audio
     │   ├─ DOF: 6 DOF (full movement + rotation)
     │   ├─ Receiver Constraint: None
     │   └─ Transitions:
     │       └─► MONO_IR_MODE (when mono IR uploaded)
     │       └─► SPATIAL_IR_MODE (when spatial IR uploaded)
     │
     ├─► MONO_IR_MODE
     │   ├─ Renderer: Three.js Positional + ConvolverNode (mono)
     │   ├─ DOF: 6 DOF sources, 0 DOF IR (head-locked)
     │   ├─ Receiver Constraint: ACTIVE ONLY in receiver mode
     │   ├─ Resonance Audio: DISABLED
     │   └─ Transitions:
     │       └─► NO_IR_MODE (when IR cleared)
     │       └─► SPATIAL_IR_MODE (when spatial IR uploaded)
     │
     └─► SPATIAL_IR_MODE
         ├─ Renderer: Ambisonic Encoder + Convolver + Rotation + Decoder
         ├─ DOF: 6 DOF sources, 3 DOF IR (rotation only)
         ├─ Receiver Constraint: ACTIVE ONLY in receiver mode
         ├─ Resonance Audio: DISABLED
         ├─ Sub-modes:
         │   ├─ BINAURAL (2ch): Direct convolution or Mach1 rotation
         │   ├─ FOA (4ch): 1st-order ambisonics
         │   └─ TOA (16ch): 3rd-order ambisonics
         └─ Transitions:
             └─► NO_IR_MODE (when IR cleared)
             └─► MONO_IR_MODE (when mono IR uploaded)
```

### 3.4 Receiver Mode Enforcement

```
┌────────────────────────────────────────────────────────────┐
│                  Receiver Mode Check                       │
└────────────────────────────────────────────────────────────┘

IF (currentMode === MONO_IR_MODE || currentMode === SPATIAL_IR_MODE)
   THEN
      IF (isFirstPersonMode === true && activeReceiverId !== null)
         THEN
            ✅ Enable IR convolution
            ✅ Show "IR Active" status in UI
         ELSE
            ❌ Disable IR convolution
            ⚠️ Show "IR Inactive: Not in receiver mode" in UI
            🔄 Fallback to Three.js Positional Audio
      END IF
   ELSE
      ℹ️ No receiver mode constraint
END IF
```

---

## 4. Module Specifications

### 4.1 Core Interfaces

#### 4.1.1 IAudioRenderer

```typescript
// frontend/src/services/audio/interfaces/IAudioRenderer.ts

export interface IAudioRenderer {
  /**
   * Initialize the renderer with audio context
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Create an audio source at a given position
   * @param position - 3D position [x, y, z]
   * @param audioBuffer - Audio buffer to play
   * @returns Audio source handle for control
   */
  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle;

  /**
   * Update listener position and orientation
   * @param position - 3D position [x, y, z]
   * @param orientation - Euler angles [yaw, pitch, roll] in radians
   */
  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void;

  /**
   * Enable or disable the renderer
   */
  setEnabled(enabled: boolean): void;

  /**
   * Check if receiver mode is required for this renderer
   */
  requiresReceiverMode(): boolean;

  /**
   * Get current renderer mode identifier
   */
  getMode(): AudioRenderMode;

  /**
   * Clean up resources
   */
  dispose(): void;
}

export enum AudioRenderMode {
  NO_IR_THREEJS = 'no_ir_threejs',
  NO_IR_RESONANCE = 'no_ir_resonance',
  MONO_IR = 'mono_ir',
  SPATIAL_IR_BINAURAL = 'spatial_ir_binaural',
  SPATIAL_IR_FOA = 'spatial_ir_foa',
  SPATIAL_IR_TOA = 'spatial_ir_toa'
}

export interface AudioSourceHandle {
  play(): void;
  pause(): void;
  stop(): void;
  setVolume(volume: number): void;
  setPosition(position: [number, number, number]): void;
  connect(destination: AudioNode): void;
  disconnect(): void;
}
```

#### 4.1.2 IOutputDecoder

```typescript
// frontend/src/services/audio/interfaces/IOutputDecoder.ts

export interface IOutputDecoder {
  /**
   * Initialize decoder with audio context
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Get the input node for connecting audio sources
   */
  getInputNode(): AudioNode;

  /**
   * Get the output node for connecting to destination
   */
  getOutputNode(): AudioNode;

  /**
   * Update decoder orientation (for HRTF)
   * @param orientation - Euler angles [yaw, pitch, roll] in radians
   */
  updateOrientation(orientation: [number, number, number]): void;

  /**
   * Get decoder type
   */
  getType(): OutputDecoderType;

  /**
   * Clean up resources
   */
  dispose(): void;
}

export enum OutputDecoderType {
  BINAURAL_HRTF = 'binaural_hrtf',
  STEREO_SPEAKERS = 'stereo_speakers'
}
```

#### 4.1.3 IImpulseResponseHandler

```typescript
// frontend/src/services/audio/interfaces/IImpulseResponseHandler.ts

export interface IImpulseResponseHandler {
  /**
   * Load and decode impulse response from file
   * @param file - IR audio file
   * @param audioContext - Web Audio API context
   * @returns IR metadata
   */
  loadIR(file: File, audioContext: AudioContext): Promise<IRMetadata>;

  /**
   * Get current IR buffer
   */
  getIRBuffer(): AudioBuffer | null;

  /**
   * Get IR metadata
   */
  getIRMetadata(): IRMetadata | null;

  /**
   * Clear loaded IR
   */
  clearIR(): void;
}

export interface IRMetadata {
  filename: string;
  format: IRFormat;
  channels: number;
  sampleRate: number;
  duration: number;
  fileSize: number;
  renderMode: AudioRenderMode;
}

export type IRFormat = 'mono' | 'binaural' | 'foa' | 'toa';
```

#### 4.1.4 IAudioOrchestrator

```typescript
// frontend/src/services/audio/interfaces/IAudioOrchestrator.ts

export interface IAudioOrchestrator {
  /**
   * Initialize orchestrator
   */
  initialize(audioContext: AudioContext): void;

  /**
   * Set current rendering mode based on IR and user preferences
   */
  setRenderingMode(config: RenderingModeConfig): void;

  /**
   * Set output decoder type
   */
  setOutputDecoder(type: OutputDecoderType): void;

  /**
   * Update receiver mode state
   */
  setReceiverMode(isActive: boolean, receiverId: string | null): void;

  /**
   * Create audio source
   */
  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle;

  /**
   * Update listener position and orientation
   */
  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void;

  /**
   * Get current rendering mode
   */
  getCurrentMode(): AudioRenderMode;

  /**
   * Get current status (for UI display)
   */
  getStatus(): OrchestratorStatus;

  /**
   * Clean up
   */
  dispose(): void;
}

export interface RenderingModeConfig {
  irMetadata: IRMetadata | null;
  preferredNoIRMode: 'threejs' | 'resonance';
}

export interface OrchestratorStatus {
  currentMode: AudioRenderMode;
  isReceiverModeActive: boolean;
  isIRActive: boolean;
  outputDecoderType: OutputDecoderType;
  dofDescription: string;
  uiNotice: string | null;
}
```

### 4.2 Implementation Modules

#### 4.2.1 NoIRRenderer

```typescript
// frontend/src/services/audio/renderers/NoIRRenderer.ts

export class NoIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private threeJSRenderer: ThreeJSPositionalRenderer | null = null;
  private resonanceRenderer: ResonanceAudioRenderer | null = null;
  private currentMode: 'threejs' | 'resonance' = 'threejs';

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.threeJSRenderer = new ThreeJSPositionalRenderer(audioContext);
    this.resonanceRenderer = new ResonanceAudioRenderer(audioContext);
  }

  setPreferredMode(mode: 'threejs' | 'resonance'): void {
    this.currentMode = mode;
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    const activeRenderer = this.currentMode === 'threejs'
      ? this.threeJSRenderer
      : this.resonanceRenderer;

    if (!activeRenderer) {
      throw new Error('Renderer not initialized');
    }

    return activeRenderer.createSource(position, audioBuffer);
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    // Update both renderers (only active one is connected)
    this.threeJSRenderer?.updateListener(position, orientation);
    this.resonanceRenderer?.updateListener(position, orientation);
  }

  requiresReceiverMode(): boolean {
    return false; // No IR = no receiver mode constraint
  }

  getMode(): AudioRenderMode {
    return this.currentMode === 'threejs'
      ? AudioRenderMode.NO_IR_THREEJS
      : AudioRenderMode.NO_IR_RESONANCE;
  }

  // ... other methods
}
```

#### 4.2.2 MonoIRRenderer

```typescript
// frontend/src/services/audio/renderers/MonoIRRenderer.ts

export class MonoIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private convolver: ConvolverNode | null = null;
  private irBuffer: AudioBuffer | null = null;
  private threeJSRenderer: ThreeJSPositionalRenderer | null = null;
  private isReceiverModeActive: boolean = false;
  private sources: Set<AudioSourceHandle> = new Set();

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.threeJSRenderer = new ThreeJSPositionalRenderer(audioContext);
  }

  setImpulseResponse(irBuffer: AudioBuffer): void {
    if (!this.audioContext) {
      throw new Error('Renderer not initialized');
    }

    // Verify mono
    if (irBuffer.numberOfChannels !== 1) {
      throw new Error(`Expected mono IR, got ${irBuffer.numberOfChannels} channels`);
    }

    this.irBuffer = irBuffer;
    this.convolver = this.audioContext.createConvolver();
    this.convolver.buffer = irBuffer;
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.threeJSRenderer) {
      throw new Error('Renderer not initialized');
    }

    // Create source with Three.js positional audio
    const source = this.threeJSRenderer.createSource(position, audioBuffer);

    // Connect through convolver if in receiver mode
    if (this.isReceiverModeActive && this.convolver) {
      source.connect(this.convolver);
    }

    this.sources.add(source);
    return source;
  }

  setReceiverMode(isActive: boolean): void {
    this.isReceiverModeActive = isActive;

    // Rewire all sources
    this.sources.forEach(source => {
      source.disconnect();
      if (isActive && this.convolver) {
        source.connect(this.convolver);
      }
    });
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    // Update Three.js listener for positional audio
    // Orientation does NOT affect mono IR (0 DOF for IR)
    this.threeJSRenderer?.updateListener(position, [0, 0, 0]);
  }

  requiresReceiverMode(): boolean {
    return true; // Mono IR requires receiver mode
  }

  getMode(): AudioRenderMode {
    return AudioRenderMode.MONO_IR;
  }

  // ... other methods
}
```

#### 4.2.3 SpatialIRRenderer

```typescript
// frontend/src/services/audio/renderers/SpatialIRRenderer.ts

export class SpatialIRRenderer implements IAudioRenderer {
  private audioContext: AudioContext | null = null;
  private irBuffer: AudioBuffer | null = null;
  private irFormat: IRFormat | null = null;
  private ambisonicEncoder: AmbisonicEncoder | null = null;
  private ambisonicDecoder: AmbisonicDecoder | null = null;
  private rotationMatrix: RotationMatrix | null = null;
  private convolvers: ConvolverNode[] = [];
  private isReceiverModeActive: boolean = false;
  private currentOrientation: [number, number, number] = [0, 0, 0];

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
  }

  setImpulseResponse(irBuffer: AudioBuffer, format: IRFormat): void {
    if (!this.audioContext) {
      throw new Error('Renderer not initialized');
    }

    this.irBuffer = irBuffer;
    this.irFormat = format;

    // Set up ambisonic processing chain
    switch (format) {
      case 'binaural':
        this.setupBinauralIR(irBuffer);
        break;
      case 'foa':
        this.setupFOAIR(irBuffer);
        break;
      case 'toa':
        this.setupTOAIR(irBuffer);
        break;
      default:
        throw new Error(`Unknown IR format: ${format}`);
    }
  }

  private setupFOAIR(irBuffer: AudioBuffer): void {
    // Create 4-channel convolution
    for (let i = 0; i < 4; i++) {
      const convolver = this.audioContext!.createConvolver();

      // Extract single channel from IR
      const channelBuffer = this.audioContext!.createBuffer(
        1,
        irBuffer.length,
        irBuffer.sampleRate
      );
      channelBuffer.copyToChannel(irBuffer.getChannelData(i), 0);
      convolver.buffer = channelBuffer;

      this.convolvers.push(convolver);
    }

    // Initialize ambisonics.js components
    this.ambisonicEncoder = new AmbisonicEncoder(this.audioContext!, 1); // FOA
    this.rotationMatrix = new RotationMatrix(this.audioContext!, 1); // FOA
    this.ambisonicDecoder = new AmbisonicDecoder(this.audioContext!, 1); // FOA
  }

  private setupTOAIR(irBuffer: AudioBuffer): void {
    // Similar to FOA but with 16 channels and 3rd-order
    for (let i = 0; i < 16; i++) {
      const convolver = this.audioContext!.createConvolver();

      const channelBuffer = this.audioContext!.createBuffer(
        1,
        irBuffer.length,
        irBuffer.sampleRate
      );
      channelBuffer.copyToChannel(irBuffer.getChannelData(i), 0);
      convolver.buffer = channelBuffer;

      this.convolvers.push(convolver);
    }

    this.ambisonicEncoder = new AmbisonicEncoder(this.audioContext!, 3); // TOA
    this.rotationMatrix = new RotationMatrix(this.audioContext!, 3); // TOA
    this.ambisonicDecoder = new AmbisonicDecoder(this.audioContext!, 3); // TOA
  }

  createSource(
    position: [number, number, number],
    audioBuffer: AudioBuffer
  ): AudioSourceHandle {
    if (!this.ambisonicEncoder) {
      throw new Error('Renderer not initialized with IR');
    }

    // Create audio source
    const source = this.audioContext!.createBufferSource();
    source.buffer = audioBuffer;

    // Encode to ambisonics based on position
    const encoderInput = this.ambisonicEncoder.createInput();
    source.connect(encoderInput.input);

    // Set azimuth/elevation from position
    const spherical = this.cartesianToSpherical(position);
    encoderInput.setAzimuthElevation(spherical.azimuth, spherical.elevation);

    // Connect to convolution chain if receiver mode active
    if (this.isReceiverModeActive) {
      this.connectAmbisonicChain();
    }

    return this.createSourceHandle(source, encoderInput);
  }

  private connectAmbisonicChain(): void {
    // Signal flow: Encoder → Convolvers → Rotation → Decoder
    const encoderOutput = this.ambisonicEncoder!.output;

    // Connect each ambisonic channel to its convolver
    for (let i = 0; i < this.convolvers.length; i++) {
      encoderOutput.connect(this.convolvers[i], i, 0);
    }

    // Connect convolvers to rotation matrix
    const merger = this.audioContext!.createChannelMerger(this.convolvers.length);
    this.convolvers.forEach((convolver, i) => {
      convolver.connect(merger, 0, i);
    });

    merger.connect(this.rotationMatrix!.input);

    // Connect rotation to decoder
    this.rotationMatrix!.output.connect(this.ambisonicDecoder!.input);

    // Decoder output connects to output decoder stage
  }

  updateListener(
    position: [number, number, number],
    orientation: [number, number, number]
  ): void {
    // Position is IGNORED (static at receiver)
    // Only orientation affects rotation matrix
    this.currentOrientation = orientation;

    if (this.rotationMatrix) {
      const [yaw, pitch, roll] = orientation;
      this.rotationMatrix.setRotation(yaw, pitch, roll);
    }
  }

  setReceiverMode(isActive: boolean): void {
    this.isReceiverModeActive = isActive;

    if (isActive) {
      this.connectAmbisonicChain();
    } else {
      this.disconnectAmbisonicChain();
    }
  }

  requiresReceiverMode(): boolean {
    return true; // Spatial IR requires receiver mode
  }

  getMode(): AudioRenderMode {
    switch (this.irFormat) {
      case 'binaural':
        return AudioRenderMode.SPATIAL_IR_BINAURAL;
      case 'foa':
        return AudioRenderMode.SPATIAL_IR_FOA;
      case 'toa':
        return AudioRenderMode.SPATIAL_IR_TOA;
      default:
        throw new Error('Unknown IR format');
    }
  }

  // ... helper methods
}
```

#### 4.2.4 AudioOrchestrator

```typescript
// frontend/src/services/audio/AudioOrchestrator.ts

export class AudioOrchestrator implements IAudioOrchestrator {
  private audioContext: AudioContext | null = null;
  private currentRenderer: IAudioRenderer | null = null;
  private outputDecoder: IOutputDecoder | null = null;
  private currentMode: AudioRenderMode = AudioRenderMode.NO_IR_THREEJS;
  private isReceiverModeActive: boolean = false;
  private activeReceiverId: string | null = null;

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

    // Connect renderer to decoder to output
    this.wireAudioGraph();
  }

  setRenderingMode(config: RenderingModeConfig): void {
    const { irMetadata, preferredNoIRMode } = config;

    // Disconnect current renderer
    this.currentRenderer?.disconnect();

    if (!irMetadata) {
      // No IR mode
      this.currentRenderer = this.noIRRenderer;
      this.noIRRenderer.setPreferredMode(preferredNoIRMode);
      this.currentMode = preferredNoIRMode === 'threejs'
        ? AudioRenderMode.NO_IR_THREEJS
        : AudioRenderMode.NO_IR_RESONANCE;
    } else if (irMetadata.format === 'mono') {
      // Mono IR mode
      this.currentRenderer = this.monoIRRenderer;
      this.monoIRRenderer.setImpulseResponse(irMetadata.buffer);
      this.currentMode = AudioRenderMode.MONO_IR;
    } else {
      // Spatial IR mode
      this.currentRenderer = this.spatialIRRenderer;
      this.spatialIRRenderer.setImpulseResponse(
        irMetadata.buffer,
        irMetadata.format
      );
      this.currentMode = this.spatialIRRenderer.getMode();
    }

    // Rewire audio graph
    this.wireAudioGraph();

    // Apply receiver mode constraint
    this.enforceReceiverModeConstraint();
  }

  setOutputDecoder(type: OutputDecoderType): void {
    this.outputDecoder = type === OutputDecoderType.BINAURAL_HRTF
      ? this.binauralDecoder
      : this.stereoDecoder;

    this.wireAudioGraph();
  }

  setReceiverMode(isActive: boolean, receiverId: string | null): void {
    this.isReceiverModeActive = isActive;
    this.activeReceiverId = receiverId;

    this.enforceReceiverModeConstraint();
  }

  private enforceReceiverModeConstraint(): void {
    if (!this.currentRenderer) return;

    const requiresReceiver = this.currentRenderer.requiresReceiverMode();

    if (requiresReceiver) {
      const shouldBeActive = this.isReceiverModeActive && this.activeReceiverId !== null;

      // Notify renderer of receiver mode state
      if (this.currentRenderer instanceof MonoIRRenderer) {
        this.currentRenderer.setReceiverMode(shouldBeActive);
      } else if (this.currentRenderer instanceof SpatialIRRenderer) {
        this.currentRenderer.setReceiverMode(shouldBeActive);
      }
    }
  }

  private wireAudioGraph(): void {
    if (!this.currentRenderer || !this.outputDecoder) return;

    // Get connection points
    const rendererOutput = this.currentRenderer.getOutputNode();
    const decoderInput = this.outputDecoder.getInputNode();
    const decoderOutput = this.outputDecoder.getOutputNode();

    // Connect: Renderer → Decoder → AudioContext.destination
    rendererOutput.connect(decoderInput);
    decoderOutput.connect(this.audioContext!.destination);
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

    switch (this.currentMode) {
      case AudioRenderMode.NO_IR_THREEJS:
      case AudioRenderMode.NO_IR_RESONANCE:
        dofDescription = '6 DOF (full movement + rotation)';
        break;

      case AudioRenderMode.MONO_IR:
        dofDescription = '6 DOF for sources, 0 DOF for IR (head-locked)';
        uiNotice = isIRActive
          ? 'Mono IR active: Head-locked mode (no rotation affects IR)'
          : 'Mono IR loaded but inactive (not in receiver mode)';
        break;

      case AudioRenderMode.SPATIAL_IR_BINAURAL:
      case AudioRenderMode.SPATIAL_IR_FOA:
      case AudioRenderMode.SPATIAL_IR_TOA:
        dofDescription = '3 DOF rotation (static position at receiver)';
        const formatName = this.currentMode === AudioRenderMode.SPATIAL_IR_BINAURAL
          ? 'Binaural (2ch)'
          : this.currentMode === AudioRenderMode.SPATIAL_IR_FOA
          ? 'FOA (4ch)'
          : 'TOA (16ch)';
        uiNotice = isIRActive
          ? `${formatName} IR active: 3DoF rotation enabled (static position)`
          : `${formatName} IR loaded but inactive (not in receiver mode)`;
        break;
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
    this.currentRenderer?.dispose();
    this.outputDecoder?.dispose();
  }
}
```

---

## 5. Implementation Phases

### Phase 1: Foundation & Interfaces (Week 1-2)

**Goal:** Establish modular architecture foundation

**Tasks:**
1. ✅ Define all core interfaces (IAudioRenderer, IOutputDecoder, etc.)
2. ✅ Set up TypeScript types and enums
3. ✅ Create base directory structure
4. ✅ Implement IRFormatDetector utility
5. ✅ Write unit tests for format detection

**Deliverables:**
- `frontend/src/services/audio/interfaces/` (all interfaces)
- `frontend/src/services/audio/types.ts` (shared types)
- `frontend/src/services/audio/utils/IRFormatDetector.ts`
- Unit tests with 100% coverage

**Acceptance Criteria:**
- All interfaces compile without errors
- Format detector correctly identifies mono/binaural/FOA/TOA
- Tests pass for edge cases (unusual channel counts, malformed files)

---

### Phase 2: No IR Renderer (Week 2-3)

**Goal:** Implement and test baseline rendering without IR

**Tasks:**
1. ✅ Implement ThreeJSPositionalRenderer wrapper
2. ✅ Implement ResonanceAudioRenderer wrapper
3. ✅ Implement NoIRRenderer with mode switching
4. ✅ Implement BinauralDecoder (using resonance-audio)
5. ✅ Implement StereoDecoder (basic stereo)
6. ✅ Create UI toggle for Three.js vs Resonance
7. ✅ Create UI toggle for Binaural vs Stereo output
8. ✅ Integration tests

**Deliverables:**
- `frontend/src/services/audio/renderers/NoIRRenderer.ts`
- `frontend/src/services/audio/decoders/BinauralDecoder.ts`
- `frontend/src/services/audio/decoders/StereoDecoder.ts`
- UI components for mode selection
- Integration tests

**Acceptance Criteria:**
- Sound sources play correctly with Three.js positional audio
- Sound sources play correctly with Resonance Audio
- User can switch between modes seamlessly
- Binaural vs Stereo toggle works correctly
- No audio glitches during transitions

---

### Phase 3: Mono IR Renderer (Week 3-4)

**Goal:** Implement mono IR convolution with receiver mode constraint

**Tasks:**
1. ✅ Implement MonoIRRenderer
2. ✅ Implement receiver mode enforcement
3. ✅ Add UI notice component for IR status
4. ✅ Integrate with existing auralization hook
5. ✅ Test convolution accuracy
6. ✅ Test receiver mode transitions

**Deliverables:**
- `frontend/src/services/audio/renderers/MonoIRRenderer.ts`
- UI component: `IRStatusNotice.tsx`
- Updated `useAuralization` hook
- Integration tests for receiver mode

**Acceptance Criteria:**
- Mono IR convolution works correctly when in receiver mode
- Convolution is disabled when not in receiver mode
- UI clearly shows IR status (active/inactive)
- No clicks/pops when toggling receiver mode
- Audio quality matches reference implementation

---

### Phase 4: Spatial IR Renderer - Binaural (Week 4-5)

**Goal:** Implement 2-channel binaural IR support

**Tasks:**
1. ✅ Implement basic binaural IR convolution
2. ✅ Add rotation support (if using Mach1)
3. ✅ Test with reference binaural IRs
4. ✅ Add UI feedback for 3DOF mode
5. ✅ Integration with orchestrator

**Deliverables:**
- SpatialIRRenderer (binaural mode)
- UI updates for binaural IR
- Tests with reference IRs

**Acceptance Criteria:**
- Binaural IRs load and convolve correctly
- Head rotation affects binaural rendering (if implemented)
- UI shows "3DoF rotation enabled" notice
- Receiver mode constraint enforced

---

### Phase 5: Spatial IR Renderer - FOA (Week 5-6)

**Goal:** Implement First-Order Ambisonics support

**Tasks:**
1. ✅ Integrate ambisonics.js library
2. ✅ Implement 4-channel convolution
3. ✅ Implement rotation matrix for FOA
4. ✅ Encode sound sources to ambisonics
5. ✅ Decode to binaural/stereo
6. ✅ Test with reference FOA IRs

**Deliverables:**
- SpatialIRRenderer (FOA mode)
- Ambisonic encoding/decoding integration
- Tests with FOA IRs

**Acceptance Criteria:**
- FOA IRs load and process correctly
- Sound sources encode correctly to FOA
- Rotation matrix updates based on camera orientation
- Binaural/stereo output sounds spatially correct
- Performance is acceptable (< 5ms latency)

---

### Phase 6: Spatial IR Renderer - TOA (Week 6-7)

**Goal:** Implement Third-Order Ambisonics support

**Tasks:**
1. ✅ Extend FOA implementation to TOA (16 channels)
2. ✅ Test with reference TOA IRs
3. ✅ Optimize performance (16-channel convolution is heavy)
4. ✅ Add UI warnings for large IR files
5. ✅ Implement Mach1Transcode fallback (optional)

**Deliverables:**
- SpatialIRRenderer (TOA mode)
- Performance optimizations
- Optional Mach1 integration

**Acceptance Criteria:**
- TOA IRs load and process correctly
- Performance is acceptable (may need GPU acceleration)
- UI warns users about large file sizes
- Fallback to FOA if TOA fails
- Quality is perceptually better than FOA

---

### Phase 7: Audio Orchestrator Integration (Week 7-8)

**Goal:** Integrate all renderers into unified orchestrator

**Tasks:**
1. ✅ Implement AudioOrchestrator
2. ✅ Implement mode state machine
3. ✅ Implement automatic mode switching based on IR
4. ✅ Integrate with ThreeScene component
5. ✅ Update all UI components
6. ✅ End-to-end testing

**Deliverables:**
- `frontend/src/services/audio/AudioOrchestrator.ts`
- Updated ThreeScene integration
- Updated sidebar UI
- End-to-end tests

**Acceptance Criteria:**
- Orchestrator correctly switches modes based on IR
- All renderers work seamlessly when activated
- UI reflects current mode accurately
- Receiver mode constraint enforced globally
- No memory leaks when switching modes

---

### Phase 8: UI/UX Enhancements (Week 8-9)

**Goal:** Polish user interface and add helpful feedback

**Tasks:**
1. ✅ Design IR status notice component
2. ✅ Add DOF explanation tooltips
3. ✅ Add mode selection UI
4. ✅ Add output decoder toggle
5. ✅ Add visual indicators for receiver mode
6. ✅ Improve error messages
7. ✅ Add loading states
8. ✅ User testing and feedback

**Deliverables:**
- Polished UI components
- Tooltips and help text
- Visual indicators
- User documentation

**Acceptance Criteria:**
- Users understand which mode is active
- Users understand DOF limitations
- Users know when IR is active/inactive
- Error messages are clear and actionable
- UI is visually consistent with existing design

---

### Phase 9: Testing & Optimization (Week 9-10)

**Goal:** Comprehensive testing and performance optimization

**Tasks:**
1. ✅ Unit tests for all modules (100% coverage)
2. ✅ Integration tests for audio graph wiring
3. ✅ End-to-end tests for user workflows
4. ✅ Performance profiling and optimization
5. ✅ Cross-browser testing
6. ✅ Mobile device testing
7. ✅ Accessibility testing
8. ✅ Load testing with many sound sources

**Deliverables:**
- Comprehensive test suite
- Performance benchmarks
- Cross-browser compatibility report
- Optimization improvements

**Acceptance Criteria:**
- All tests pass
- Code coverage > 90%
- Performance meets targets (< 5ms latency)
- Works on Chrome, Firefox, Safari, Edge
- Works on iOS and Android
- Handles 50+ simultaneous sound sources

---

### Phase 10: Documentation & Launch (Week 10)

**Goal:** Final documentation and production deployment

**Tasks:**
1. ✅ Write technical documentation
2. ✅ Write user guide
3. ✅ Create tutorial videos/screenshots
4. ✅ Update README
5. ✅ Final code review
6. ✅ Production deployment
7. ✅ Monitor for issues

**Deliverables:**
- Technical documentation
- User guide with examples
- Updated README
- Production deployment

**Acceptance Criteria:**
- All documentation is complete
- User guide is clear and helpful
- README accurately describes features
- Production deployment is stable
- No critical bugs reported in first week

---

## 6. Code Structure

### 6.1 Directory Layout

```
frontend/src/services/audio/
├── interfaces/
│   ├── IAudioRenderer.ts
│   ├── IOutputDecoder.ts
│   ├── IImpulseResponseHandler.ts
│   └── IAudioOrchestrator.ts
├── renderers/
│   ├── NoIRRenderer.ts
│   ├── MonoIRRenderer.ts
│   ├── SpatialIRRenderer.ts
│   ├── ThreeJSPositionalRenderer.ts
│   └── ResonanceAudioRenderer.ts
├── decoders/
│   ├── BinauralDecoder.ts
│   └── StereoDecoder.ts
├── utils/
│   ├── IRFormatDetector.ts
│   ├── AmbisonicHelpers.ts
│   └── AudioGraphWiring.ts
├── AudioOrchestrator.ts
├── ImpulseResponseHandler.ts
└── types.ts

frontend/src/components/audio/
├── IRStatusNotice.tsx
├── SpatialModeSelector.tsx
├── OutputDecoderToggle.tsx
└── DOFExplanation.tsx

frontend/src/hooks/
├── useAudioOrchestrator.ts (new)
└── useAuralization.ts (updated)
```

### 6.2 Module Dependencies

```
ThreeScene
    └── useAudioOrchestrator (hook)
            └── AudioOrchestrator
                    ├── NoIRRenderer
                    │       ├── ThreeJSPositionalRenderer
                    │       └── ResonanceAudioRenderer
                    ├── MonoIRRenderer
                    │       └── ThreeJSPositionalRenderer
                    ├── SpatialIRRenderer
                    │       ├── AmbisonicEncoder
                    │       ├── ConvolverNode[]
                    │       ├── RotationMatrix
                    │       └── AmbisonicDecoder
                    ├── BinauralDecoder
                    └── StereoDecoder
```

---

## 7. Integration Points

### 7.1 ThreeScene Component Integration

```typescript
// frontend/src/components/scene/ThreeScene.tsx

import { useAudioOrchestrator } from '@/hooks/useAudioOrchestrator';
import { IRStatusNotice } from '@/components/audio/IRStatusNotice';

export function ThreeScene(props: ThreeSceneProps) {
  const {
    orchestrator,
    currentMode,
    status,
    setRenderingMode,
    setOutputDecoder,
    updateReceiverMode
  } = useAudioOrchestrator();

  // Update receiver mode when first-person mode changes
  useEffect(() => {
    updateReceiverMode(isFirstPersonMode, activeReceiverId);
  }, [isFirstPersonMode, activeReceiverId]);

  // Update rendering mode when IR changes
  useEffect(() => {
    setRenderingMode({
      irMetadata: auralizationConfig.irMetadata,
      preferredNoIRMode: userPreferences.noIRMode
    });
  }, [auralizationConfig.irMetadata]);

  // Update listener on every frame
  useEffect(() => {
    if (!orchestrator) return;

    const animate = () => {
      const position = camera.position.toArray();
      const orientation = getCameraOrientation(camera);
      orchestrator.updateListener(position, orientation);

      requestAnimationFrame(animate);
    };

    animate();
  }, [orchestrator, camera]);

  // Create audio sources
  const createAudioSource = (soundData) => {
    const audioBuffer = await loadAudioBuffer(soundData.url);
    const source = orchestrator.createSource(
      soundData.position,
      audioBuffer
    );
    return source;
  };

  return (
    <>
      {/* 3D Scene */}
      <Canvas>
        {/* ... */}
      </Canvas>

      {/* IR Status Notice */}
      {status.uiNotice && (
        <IRStatusNotice
          message={status.uiNotice}
          dofDescription={status.dofDescription}
          isActive={status.isIRActive}
        />
      )}

      {/* ... other overlays */}
    </>
  );
}
```

### 7.2 Sidebar Integration

```typescript
// frontend/src/components/layout/Sidebar.tsx

import { SpatialModeSelector } from '@/components/audio/SpatialModeSelector';
import { OutputDecoderToggle } from '@/components/audio/OutputDecoderToggle';

export function Sidebar(props: SidebarProps) {
  return (
    <div className="sidebar">
      {/* Auralization Section */}
      <AuralizationSection {...auralizationProps} />

      {/* Spatial Mode Selector (No IR only) */}
      {!auralizationConfig.irMetadata && (
        <SpatialModeSelector
          currentMode={userPreferences.noIRMode}
          onModeChange={handleNoIRModeChange}
        />
      )}

      {/* Output Decoder Toggle (Always visible) */}
      <OutputDecoderToggle
        currentDecoder={audioSettings.outputDecoder}
        onDecoderChange={handleOutputDecoderChange}
      />

      {/* ... other sections */}
    </div>
  );
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

**Target Coverage:** > 90%

**Test Modules:**
- IRFormatDetector: All format detection logic
- AmbisonicHelpers: Coordinate conversions, coefficient calculations
- AudioGraphWiring: Connection management
- Each renderer in isolation (mocked Web Audio API)
- Each decoder in isolation

**Example Test:**

```typescript
// frontend/src/services/audio/utils/__tests__/IRFormatDetector.test.ts

describe('IRFormatDetector', () => {
  it('should detect mono IR (1 channel)', () => {
    const buffer = createMockAudioBuffer(1);
    const format = IRFormatDetector.detect(buffer);
    expect(format).toBe('mono');
  });

  it('should detect binaural IR (2 channels)', () => {
    const buffer = createMockAudioBuffer(2);
    const format = IRFormatDetector.detect(buffer);
    expect(format).toBe('binaural');
  });

  it('should detect FOA IR (4 channels)', () => {
    const buffer = createMockAudioBuffer(4);
    const format = IRFormatDetector.detect(buffer);
    expect(format).toBe('foa');
  });

  it('should detect TOA IR (16 channels)', () => {
    const buffer = createMockAudioBuffer(16);
    const format = IRFormatDetector.detect(buffer);
    expect(format).toBe('toa');
  });

  it('should throw error for unsupported channel counts', () => {
    const buffer = createMockAudioBuffer(7);
    expect(() => IRFormatDetector.detect(buffer)).toThrow();
  });
});
```

### 8.2 Integration Tests

**Test Scenarios:**
1. Mode switching: No IR → Mono IR → Spatial IR → No IR
2. Receiver mode transitions: Enter/exit receiver mode with IR loaded
3. Output decoder switching: Binaural ↔ Stereo
4. Audio graph wiring: Verify connections at each stage
5. Memory management: Check for leaks when switching modes

**Example Test:**

```typescript
describe('AudioOrchestrator Integration', () => {
  let orchestrator: AudioOrchestrator;
  let audioContext: AudioContext;

  beforeEach(() => {
    audioContext = new AudioContext();
    orchestrator = new AudioOrchestrator();
    orchestrator.initialize(audioContext);
  });

  it('should switch from No IR to Mono IR mode', async () => {
    // Start in No IR mode
    expect(orchestrator.getCurrentMode()).toBe(AudioRenderMode.NO_IR_THREEJS);

    // Load mono IR
    const monoIR = await loadTestIR('mono_church.wav');
    const metadata = { buffer: monoIR, format: 'mono' };

    orchestrator.setRenderingMode({ irMetadata: metadata, preferredNoIRMode: 'threejs' });

    // Verify mode switch
    expect(orchestrator.getCurrentMode()).toBe(AudioRenderMode.MONO_IR);

    // Verify IR not active (not in receiver mode)
    expect(orchestrator.getStatus().isIRActive).toBe(false);

    // Activate receiver mode
    orchestrator.setReceiverMode(true, 'receiver-1');

    // Verify IR now active
    expect(orchestrator.getStatus().isIRActive).toBe(true);
  });
});
```

### 8.3 End-to-End Tests

**User Workflows:**
1. Upload mono IR → Enter receiver mode → Hear convolution
2. Upload FOA IR → Rotate head → Hear spatial rotation
3. Switch output decoder → Hear difference
4. Exit receiver mode → IR convolution stops
5. Clear IR → Revert to Three.js positional

**Tools:**
- Playwright for UI automation
- Web Audio API mock for deterministic testing
- Reference audio comparisons for quality validation

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Ambisonic library bugs** | Medium | High | Use well-tested ambisonics.js, have Mach1 fallback |
| **TOA performance issues** | High | Medium | Optimize, offer GPU acceleration, fallback to FOA |
| **Browser compatibility** | Medium | High | Extensive cross-browser testing, polyfills |
| **Audio glitches on mode switch** | Medium | Medium | Use ramp nodes, fade transitions, proper cleanup |
| **Memory leaks** | Medium | High | Rigorous testing, cleanup on every transition |
| **Convolution artifacts** | Low | Medium | Normalize IRs, test with reference implementations |

### 9.2 UX Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **User confusion about modes** | High | Medium | Clear UI notices, tooltips, documentation |
| **Unexpected IR behavior** | Medium | Medium | Always show IR status, explain receiver mode constraint |
| **Poor audio quality** | Low | High | Test with high-quality IRs, validate against reference |
| **Difficult IR upload** | Low | Low | Drag-and-drop, clear file format instructions |

### 9.3 Timeline Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **TOA implementation delays** | Medium | Medium | TOA is optional, FOA is sufficient for MVP |
| **Integration complexity** | Medium | High | Phased approach, modular design allows parallel work |
| **Testing takes longer** | High | Medium | Allocate 2 weeks for testing, automate where possible |

---

## 10. Appendices

### 10.1 Glossary

- **IR**: Impulse Response
- **HRTF**: Head-Related Transfer Function
- **FOA**: First-Order Ambisonics (4 channels: W, X, Y, Z)
- **TOA**: Third-Order Ambisonics (16 channels)
- **DOF**: Degrees of Freedom (translation + rotation)
- **3 DOF**: Rotation only (yaw, pitch, roll)
- **6 DOF**: Full movement (x, y, z translation + yaw, pitch, roll rotation)
- **ConvolverNode**: Web Audio API node for convolution reverb
- **Binaural**: Two-channel audio for headphones
- **Ambisonics**: Spherical harmonic representation of sound field

### 10.2 Reference Materials

**Ambisonic Resources:**
- https://github.com/polarch/JSAmbisonics
- https://en.wikipedia.org/wiki/Ambisonics

**Web Audio API:**
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- https://www.w3.org/TR/webaudio/

**Mach1 Spatial:**
- https://github.com/Mach1Studios/m1-sdk
- https://dev.mach1.xyz/

**Impulse Response Databases:**
- OpenAIR (https://www.openair.hosted.york.ac.uk/)
- EchoThief (https://www.echothief.com/)

### 10.3 Example IR Files for Testing

**Mono IR:**
- `test_ir_mono_church.wav` (1 channel, 48kHz, 3 seconds)

**Binaural IR:**
- `test_ir_binaural_concert_hall.wav` (2 channels, 48kHz, 2 seconds)

**FOA IR:**
- `test_ir_foa_studio.amb` (4 channels, 48kHz, 1.5 seconds)

**TOA IR:**
- `test_ir_toa_cathedral.amb` (16 channels, 48kHz, 4 seconds)

---

## 11. Success Metrics

### 11.1 Technical Metrics

- ✅ All modes (No IR, Mono IR, Spatial IR) working correctly
- ✅ Latency < 5ms for all processing
- ✅ No audio glitches during mode transitions
- ✅ Memory usage stable over 1 hour of use
- ✅ Code coverage > 90%

### 11.2 User Experience Metrics

- ✅ Users can successfully upload IR on first attempt
- ✅ Users understand current mode (via survey)
- ✅ Users understand receiver mode constraint
- ✅ Users can switch between decoders easily
- ✅ No confusion-related support requests

### 11.3 Performance Benchmarks

| Scenario | Target | Measured |
|----------|--------|----------|
| No IR (Three.js) | < 2ms | TBD |
| No IR (Resonance) | < 3ms | TBD |
| Mono IR | < 4ms | TBD |
| FOA IR | < 5ms | TBD |
| TOA IR | < 8ms | TBD |
| Mode switch | < 100ms | TBD |
| Memory per source | < 2MB | TBD |

---

**END OF IMPLEMENTATION PLAN**

---

## Appendix: Mach1 Integration Notes

### When to Use Mach1

**Scenario 1: Binaural IR Rotation**
- If user uploads binaural IR (2ch) and we want to support head rotation
- Use Mach1Decode to rotate pre-rendered binaural audio
- Lower CPU than re-convolving FOA

**Scenario 2: Format Conversion**
- Use Mach1Transcode to convert between formats
- E.g., TOA → FOA if TOA is too heavy
- E.g., Import external Mach1 spatial mixes

**Scenario 3: Alternative to Ambisonics**
- Some users may prefer VVBP over ambisonics
- Offer Mach1 as alternative decoder
- Lower latency, no HRTF processing

### Integration Points

```typescript
// Optional Mach1 integration in SpatialIRRenderer

private useMach1 = false;
private mach1Decoder: Mach1Decode | null = null;

setUseMach1(enabled: boolean): void {
  this.useMach1 = enabled;

  if (enabled && !this.mach1Decoder) {
    this.mach1Decoder = new Mach1Decode();
    this.mach1Decoder.setPlatformType(Mach1PlatformType.DEFAULT);
    this.mach1Decoder.setDecodeAlgoType(Mach1DecodeAlgoType.SPATIAL_8);
  }
}

// In updateListener():
if (this.useMach1 && this.mach1Decoder) {
  const [yaw, pitch, roll] = orientation;
  this.mach1Decoder.setRotationDegrees(
    yaw * 180 / Math.PI,
    pitch * 180 / Math.PI,
    roll * 180 / Math.PI
  );
  const coeffs = this.mach1Decoder.decode();
  // Apply coeffs to audio channels
}
```

This appendix provides future-proofing for when Mach1 integration is desired, but the core implementation plan focuses on proven Web Audio API + ambisonics.js approach first.

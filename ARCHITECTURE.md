# Architecture Overview

System architecture of [the repository](https://github.com/bouiz/compas_soundscape)

```
compas_soundscape/
├── backend/
│   ├── main.py                      # FastAPI app initialization (updated)
│   ├── tasks.py                     # Background tasks
│   ├── config/
│   │   ├── __init__.py
│   │   └── constants.py             # All backend constants (updated - IR formats, ambisonic channels)
│   ├── data/
│   │   ├── AudioSet_classes.py      # AudioSet class definitions
│   │   ├── BBCSoundEffects.csv      # BBC sound effects database
│   │   └── [3D model samples]       # IFC, 3DM test files
│   ├── models/
│   │   └── schemas.py               # Pydantic request/response models (updated - IR schemas)
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── analysis.py              # 3D geometry analysis endpoints
│   │   ├── generation.py            # LLM text/prompt generation endpoints
│   │   ├── impulse_responses.py     # IR upload/list/delete endpoints
│   │   ├── library_search.py        # Sound library search (BBC, Freesound)
│   │   ├── modal_analysis.py        # Modal analysis endpoints
│   │   ├── reprocess.py             # Audio reprocessing (denoising)
│   │   ├── sed_analysis.py          # Sound Event Detection endpoints
│   │   ├── sounds.py                # Audio generation endpoints
│   │   └── upload.py                # File upload endpoints
│   ├── services/
│   │   ├── audio_service.py         # TangoFlux audio generation
│   │   ├── bbc_service.py           # BBC Sound Effects API
│   │   ├── freesound_service.py     # Freesound API integration
│   │   ├── geometry_service.py      # 3D file processing (COMPAS, rhino3dm)
│   │   ├── impulse_response_service.py  # IR processing & channel extraction
│   │   ├── llm_service.py           # Google Gemini LLM
│   │   ├── modal_analysis_service.py    # Modal analysis & mode shape visualization
│   │   └── sed_service.py           # Sound Event Detection
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── audio_processing.py      # Audio manipulation utilities
│   │   ├── file_operations.py       # File I/O and cleanup
│   │   ├── helpers.py               # General helpers
│   │   └── sed_processing.py        # SED processing utilities
│   ├── static/
│   │   ├── sounds/
│   │   │   └── generated/           # Generated audio files (served via /static/)
│   │   └── impulse_responses/       # NEW - Uploaded IR files (1/2/4/16 channels)
│   ├── temp/                        # Temporary processing files
│   ├── temp_uploads/                # Uploaded files staging area
│   └── temp_library_downloads/      # Downloaded library audio files
│
├── frontend/
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── public/
│   │   └── HRTF_KEMAR_front.sofa   # Spatial audio HRTF data
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # Root layout
│       │   ├── page.tsx             # Main page (116 lines - orchestration only)
│       │   └── globals.css          # Tailwind + CSS variables
│       ├── components/
│       │   ├── audio/               # Audio visualization components
│       │   │   ├── AudioWaveformDisplay.tsx  # Waveform display component
│       │   │   ├── AudioTimeline.tsx         # Classic timeline (canvas-based, scheduled iterations)
│       │   │   └── WaveSurferTimeline.tsx    # Enhanced timeline (WaveSurfer.js, waveform visualization)
│       │   ├── controls/            # Reusable UI controls
│       │   │   ├── FileUploadArea.tsx
│       │   │   └── PlaybackControls.tsx
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   └── sidebar/         # Sidebar sub-components
│       │   ├── overlays/            # UI overlays
│       │   └── scene/               # 3D scene components
│       ├── hooks/
│       │   ├── useAudioControls.ts  # Audio playback state & controls
│       │   ├── useAuralization.ts   # Spatial audio/auralization
│       │   ├── useFileUpload.ts     # File upload & processing
│       │   ├── useHorizontalScroll.ts # Mouse wheel horizontal scrolling
│       │   ├── useModalImpact.ts    # Modal analysis & impact sound synthesis & mode visualization
│       │   ├── useReceivers.ts      # Audio receiver management
│       │   ├── useSED.ts            # Sound Event Detection
│       │   ├── useSoundGeneration.ts # Sound generation workflow
│       │   ├── useTextGeneration.ts # Text/prompt generation
│       │   ├── useTimelineMode.ts   # Timeline mode toggle (classic vs enhanced)
│       │   ├── useTimelinePlayback.ts # Timeline playback state management
│       │   └── useWaveformInteraction.ts # Waveform zoom/pan interaction
│       ├── lib/
│       │   ├── constants.ts         # All constants (updated - AMBISONIC, IR_FORMAT)
│       │   ├── audio/               # Audio processing utilities
│       │   │   ├── ambisonic-encoder.ts     # NEW - FOA/TOA encoding (mono → 4/16 ch)
│       │   │   ├── ambisonic-rotator.ts     # NEW - Ambisonic field rotation
│       │   │   ├── ambisonic-decoder.ts     # NEW - Binaural decoding (virtual speakers)
│       │   │   ├── audio-info.ts           # Audio file loading & metadata
│       │   │   ├── modal-impact-synthesis.ts   # NEW - Impact sound synthesis from modal analysis
│       │   │   ├── waveform-utils.ts       # Waveform visualization (extraction & rendering)
│       │   │   ├── timeline-utils.ts       # Timeline data extraction (with audioUrl for WaveSurfer)
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling
│       │   │   └── auralization-service.ts      # Impulse response convolution (audio routing only)
│       │   ├── sound/               # Sound system utilities
│       │   ├── three/               # Three.js utilities (Service-Oriented Architecture)
│       │   │   ├── scene-coordinator.ts      # Scene init, camera, animation loop
│       │   │   ├── geometry-renderer.ts      # Geometry mesh rendering & highlighting
│       │   │   ├── sound-sphere-manager.ts   # Sound sphere creation & audio sources
│       │   │   ├── receiver-manager.ts          # Receiver cube management
│       │   │   ├── mode-visualizer.ts           # NEW - Mode shape visualization on meshes
│       │   │   ├── input-handler.ts             # User input (click, drag, keyboard)
│       │   │   ├── draggable-mesh-manager.ts    # Shared mesh update utilities
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling
│       │   │   ├── auralization-service.ts      # Impulse response convolution (audio routing only)
│       │   │   ├── sceneSetup.ts               # Scene setup helpers
│       │   │   ├── materials.ts                # Material definitions
│       │   │   └── mesh-cleanup.ts             # Resource disposal utilities
│       │   ├── audio-scheduler.ts   # Audio scheduling logic
│       │   ├── constants.ts         # Frontend constants (AUDIO_TIMELINE, WAVESURFER_TIMELINE, etc.)
│       │   └── utils.ts             # General utilities
│       ├── services/
│       │   └── api.ts               # API client (all backend HTTP calls)
│       └── types/
│           ├── audio.ts             # Audio type definitions
│           ├── auralization.ts      # Auralization types
│           ├── components.ts        # Component prop types
│           ├── index.ts             # Type exports
│           ├── modal.ts             # NEW - Modal analysis & mode visualization types
│           ├── receiver.ts          # Receiver types
│           ├── sed.ts               # SED types
│           └── three-scene.ts       # Three.js scene types
│
├── .claude/                         # Claude AI configuration
│   └── output-styles/
│       └── modular-coding.md        # Development guidelines (this file)
│
├── architecture.md                  # System architecture (this file)
├── CHANGELOG.md                     # Change log
├── README.md                        # Project overview
├── pyproject.toml                   # Python project configuration
├── requirements.txt                 # Python dependencies
└── requirements-dev.txt             # Python dev dependencies
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌───────────────┐  │
│  │   page.tsx  │─────▶│ Components   │◀─────│  Custom Hooks │  │
│  │  (Minimal)  │      │              │      │               │  │
│  └─────────────┘      │ - Sidebar    │      │ - useFile     │  │
│                       │ - ThreeScene │      │ - useSound    │  │
│                       │ - Overlays   │      │ - useAudio    │  │
│                       └──────┬───────┘      └───────┬───────┘  │
│                              │                      │           │
│                              └──────────┬───────────┘           │
│                                         │                       │
│                                         ▼                       │
│                              ┌──────────────────┐               │
│                              │  Services/API    │               │
│                              │  (Fetch Layer)   │               │
│                              └────────┬─────────┘               │
│                                       │                         │
└───────────────────────────────────────┼─────────────────────────┘
                                        │ HTTP
                                        │
┌───────────────────────────────────────┼─────────────────────────┐
│                         BACKEND (FastAPI)                        │
├───────────────────────────────────────┼─────────────────────────┤
│                                       │                          │
│                              ┌────────▼─────────┐                │
│                              │     main.py      │                │
│                              │  (Minimal Init)  │                │
│                              └────────┬─────────┘                │
│                                       │                          │
│              ┌────────────────────────┼────────────────────────┐ │
│              │                        │                        │ │
│    ┌─────────▼─────────┐   ┌─────────▼─────────┐   ┌─────────▼─────┐
│    │  Routers/         │   │  Routers/         │   │  Routers/      │
│    │  upload.py        │   │  analysis.py      │   │  generation.py │
│    │                   │   │                   │   │                │
│    │ - /api/upload     │   │ - /api/analyze    │   │ - /api/gen-    │
│    │ - /api/load-ifc   │   │    -3dm/-ifc      │   │    -text       │
│    └─────────┬─────────┘   └─────────┬─────────┘   └─────────┬──────┘
│              │                       │                       │      │
│    ┌─────────▼─────────┐             │                       │      │
│    │  Routers/         │             │                       │      │
│    │  sounds.py        │             │                       │      │
│    │                   │             │                       │      │
│    │ - /api/generate   │             │                       │      │
│    │    -sounds        │             │                       │      │
│    │ - /api/cleanup    │             │                       │      │
│    └─────────┬─────────┘             │                       │      │
│              │                       │                       │      │
│              └───────────┬───────────┴───────────┬───────────┘      │
│                          │                       │               │
│                          ▼                       ▼               │
│                ┌───────────────────────────────────────────┐     │
│                │           Services Layer                  │     │
│                ├───────────────────────────────────────────┤     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    GeometryService                  │ │     │
│                │  │  - Process OBJ/STL/IFC/3DM         │ │     │
│                │  │  - Extract meshes                   │ │     │
│                │  │  - Transform coordinates            │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    LLMService                       │ │     │
│                │  │  - Generate prompts                 │ │     │
│                │  │  - Select diverse entities          │ │     │
│                │  │  - Interact with Gemini            │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    AudioService                     │ │     │
│                │  │  - Generate audio from text         │ │     │
│                │  │  - Manage TangoFlux model          │ │     │
│                │  │  - Position sound sources           │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                └───────────────────────────────────────────┘     │
│                                                                  │
│                ┌───────────────────────────────────────────┐     │
│                │           Models/Schemas                  │     │
│                │  - Pydantic validation models             │     │
│                │  - Request/Response types                 │     │
│                └───────────────────────────────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Timeline Architecture (Dual-Mode System)

### Overview
The COMPAS Soundscape timeline system supports **two visualization modes** running in parallel:

1. **Classic Timeline** (Canvas-based)
   - Custom-built canvas rendering
   - Lightweight and performant
   - Shows scheduled iterations as colored rectangles
   - Default mode for stability

2. **Enhanced Timeline** (WaveSurfer.js)
   - Full waveform visualization
   - Multi-track layout with regions
   - Zoom & pan controls
   - Professional DAW-like experience

### Architecture Decision: Gradual Migration
We implemented a **parallel system** rather than a hard replacement to:
- Allow user testing and feedback before deprecating classic mode
- Provide fallback if enhanced mode has issues
- Enable A/B comparison for UX validation
- Minimize risk of breaking changes

### Component Hierarchy

```
ThreeScene.tsx
  ├── useTimelineMode() hook
  │   └── Manages mode state (classic | enhanced)
  │   └── Persists to localStorage
  │
  ├── Timeline Toggle Button
  │   └── Switches between modes
  │
  └── Conditional Rendering:
      ├── Classic Mode → <AudioTimeline />
      │   ├── Canvas-based rendering
      │   ├── Uses AUDIO_TIMELINE constants
      │   └── Scheduled iterations as rectangles
      │
      └── Enhanced Mode → <WaveSurferTimeline />
          ├── WaveSurfer.js instances (one per track)
          ├── RegionsPlugin (scheduled iterations)
          ├── TimelinePlugin (time markers)
          ├── Uses WAVESURFER_TIMELINE constants
          └── Zoom/pan controls
```

### Data Flow

```
PlaybackSchedulerService
  └── getAudioSchedulers() → Map<string, AudioScheduler>
      └── Each AudioScheduler has scheduled sounds

extractTimelineSounds(audioSchedulers)
  ├── Extracts: id, displayName, color, intervals, iterations
  ├── **NEW:** Extracts audioUrl from audio.userData.soundEvent.url
  └── Returns: TimelineSound[] (with optional audioUrl)

TimelineSound {
  id: string
  displayName: string
  color: string
  intervalMs: number
  soundDurationMs: number
  scheduledIterations: number[]  // For classic mode
  audioUrl?: string              // For enhanced mode (WaveSurfer)
}

Timeline Components
  ├── Classic: Uses scheduledIterations → draws rectangles
  └── Enhanced: Uses audioUrl → loads waveforms, creates regions
```

### Mode Toggle Implementation

**Hook:** `useTimelineMode.ts`
```typescript
const { timelineMode, toggleTimelineMode } = useTimelineMode();
// Reads/writes 'compas-timeline-mode' from localStorage
// Returns: 'classic' | 'enhanced'
```

**UI Integration:** `ThreeScene.tsx:770-810`
```tsx
{isClassicMode ? (
  <AudioTimeline {...props} />
) : (
  <WaveSurferTimeline {...props} />
)}
```

### WaveSurfer Integration Details

**Plugins Used:**
1. **RegionsPlugin** - Creates colored overlays for scheduled iterations
   - Each iteration becomes a region: `{ start, end, color, id }`
   - Regions are read-only (drag/resize disabled for now)

2. **TimelinePlugin** - Displays time markers and labels
   - Time markers every 5s
   - Primary labels every 10s

**Synchronization:**
- **External Control:** Parent manages playback state
- **currentTime Prop:** Syncs all WaveSurfer instances via `seekTo()`
- **onSeek Callback:** Click-to-seek triggers parent PlaybackScheduler

**Audio Loading:**
```typescript
// Extract URL from PositionalAudio userData
const audioUrl = audio.userData?.soundEvent?.url;

// WaveSurfer loads audio from URL
wavesurfer.load(`${API_BASE_URL}${audioUrl}`);

// Creates waveform visualization automatically
```

### Performance Considerations

**Classic Timeline:**
- ✅ Very fast (simple canvas drawing)
- ✅ No audio loading needed
- ✅ Minimal memory footprint

**Enhanced Timeline:**
- ⚠️ Loads audio buffers for waveform generation
- ⚠️ Higher memory usage (one WaveSurfer per track)
- ✅ Lazy loading (only when timeline visible)
- ✅ Caching by WaveSurfer
- ⚠️ May need virtualization for 20+ tracks

### Future Migration Path

**Phase 1: Parallel System** ✅ (Current)
- Both timelines available
- Classic is default
- User can toggle

**Phase 2: User Testing** (1-2 weeks)
- Gather feedback on enhanced mode
- Monitor performance metrics
- Fix bugs and polish UX

**Phase 3: Default Switch** (Week 3)
- Make enhanced mode default for new users
- Keep toggle available

**Phase 4: Deprecation** (Week 4+)
- Show migration prompt for classic users
- Eventually remove classic mode
- Archive AudioTimeline.tsx for reference

### Configuration

**Classic Timeline:** `AUDIO_TIMELINE` in [constants.ts](frontend/src/lib/constants.ts)
- Track height, spacing, padding
- Iteration styling
- Cursor color/width
- Color scheme (TTA/Library/Import)

**Enhanced Timeline:** `WAVESURFER_TIMELINE` in [constants.ts](frontend/src/lib/constants.ts)
- Waveform colors (grey/pink)
- Track height (80px vs 25px classic)
- Zoom limits (1x - 100x)
- Regions styling (alpha, border)
- Timeline markers (5s/10s intervals)
- Performance limits (max canvas width)

### Known Limitations

1. **Audio URL Requirement**
   - Enhanced mode needs `audioUrl` in TimelineSound
   - Works with: generated sounds, uploaded audio, library sounds
   - May not work with: synthetic sounds without file URLs

2. **Zoom Performance**
   - Experimental for many tracks (10+)
   - May need throttling/debouncing

3. **Region Editing**
   - Currently read-only
   - Future: enable drag-to-reschedule

4. **Bundle Size**
   - WaveSurfer adds ~50KB gzipped
   - Acceptable trade-off for enhanced UX

---

## Multi-Channel Auralization Architecture

### Overview
COMPAS Soundscape implements a **2-path auralization system** supporting multiple IR formats:
- **Path 1 (Ambisonic):** FOA (4-ch) or TOA (16-ch) with real-time rotation → Binaural output
- **Path 2 (Convolution):** Mono (1-ch) or Binaural (2-ch) → Three.js PositionalAudio

### Supported IR Formats

| Format | Channels | Description | Use Case |
|--------|----------|-------------|----------|
| **Mono** | 1 | Single-channel IR | Simple room acoustics |
| **Binaural** | 2 | Stereo HRTF | Pre-spatialized headphone output |
| **FOA** | 4 | First-Order Ambisonics | Low CPU, good spatial accuracy |
| **TOA** | 16 | Third-Order Ambisonics | High CPU, excellent spatial accuracy |

### Ambisonic Pipeline (Path 1)

**With Listener Rotation (NEW - Implemented):**

```
┌─────────────────────────────────────────────────────────────┐
│ Mono Source                                                 │
│   ↓                                                         │
│ 4-ch IR Convolution (FOA) / 16-ch IR Convolution (TOA)     │
│   • IR already contains spatial room encoding              │
│   • No encoder needed (SPARTA MultiConv approach)          │
│   ↓                                                         │
│ Real-Time Rotator Node (FOA only - ScriptProcessorNode)    │
│   • Rotates ambisonic field based on listener orientation  │
│   • Updated every frame via animation loop                 │
│   • Uses 3x3 rotation matrix (yaw, pitch, roll)            │
│   • W channel unchanged (omnidirectional)                  │
│   • X, Y, Z rotated via matrix multiplication              │
│   ↓                                                         │
│ JSAmbisonics HRTF-based Binaural Decoder                   │
│   • Proper HRTF convolution per ambisonic channel          │
│   • Accurate spatial localization                          │
│   ↓                                                         │
│ Limiter (safety) → Stereo Output (L/R)                     │
└─────────────────────────────────────────────────────────────┘
```

**Rotation Pipeline Data Flow:**

```
SceneCoordinator.getListenerOrientation()
  │ (called in animation loop)
  ├─> Returns { yaw, pitch, roll } in radians
  │   • First-person mode: stored rotation values
  │   • Orbit mode: calculated from camera direction
  │
  ↓
ThreeScene animation effect
  │ (updates every frame when auralization enabled)
  ├─> Calls auralizationService.updateOrientation(orientation)
  │
  ↓
AuralizationService.updateOrientation()
  │ (stores orientation and updates rotator)
  ├─> Calls rotatorUpdateFn(orientation)
  │   • Updates rotation matrix in ScriptProcessorNode
  │   • Matrix recalculated from Euler angles
  │
  ↓
Rotator ScriptProcessorNode.onaudioprocess
  │ (processes audio in real-time)
  └─> Applies rotation matrix to X, Y, Z channels
      • W channel unchanged (omnidirectional)
      • Smooth rotation without artifacts
```

**Single-IR Physical Accuracy:**

✅ **What Works (Rotation):**
- Head rotation in first-person mode
- Ambisonic field rotates with listener orientation
- Sound sources appear to stay fixed in space as you turn your head
- Physically accurate for single static receiver position

⚠️ **Current Limitations (Translation):**
- Only ONE impulse response per scene
- IR is recorded from a FIXED position in the room
- Moving the listener position (translation) uses the SAME IR
- This is NOT physically accurate for translation
- Source position is "baked into" the IR recording

**Why Translation Doesn't Work:**
- IR encodes the room response from recording position to source
- Moving listener would require DIFFERENT IR from new position
- Would need IR library: `IRs[receiver_position][source_position]`
- Not feasible with current single-IR approach

**Rotation vs. Translation:**

| Action | Physical Accuracy | Implementation |
|--------|-------------------|----------------|
| **Head Rotation** | ✅ Accurate | Rotate ambisonic field via matrix |
| **Listener Translation** | ❌ Not accurate | Uses same IR (wrong!) |
| **Source Translation** | ❌ Not accurate | Would need new IR recording |

**UI Considerations:**
- In first-person mode, position is LOCKED (correct behavior)
- Arrow keys rotate head (yaw/pitch), NOT translate
- When ambisonic IR is loaded:
  - Consider disabling source dragging (or show warning)
  - Add notice: "Source position fixed (from IR recording)"
  - Add orientation indicator for rotation feedback

**Future Enhancement: Multiple IR Support**
To enable accurate translation, would need:
1. IR library with multiple recording positions
2. Interpolation between nearest IRs
3. Dynamic IR switching based on listener position
4. Significant storage/bandwidth requirements

**Legacy Implementation (Encoder-based - deprecated for FOA/TOA):**

```
┌─────────────────────────────────────────────────────────────┐
│ Mono Source → Ambisonic Encoder (position-based)            │
│   ↓                                                         │
│ 4-ch (FOA) or 16-ch (TOA) Ambisonic Signal                 │
│   ↓                                                         │
│ Convolution with IR                                         │
│   • FOA: Single 4-ch ConvolverNode                         │
│   • TOA: 16 parallel mono ConvolverNodes (Web Audio limit) │
│   ↓                                                         │
│ Binaural Decoding (virtual speakers)                       │
│   • FOA: 8 virtual speakers (cube layout)                  │
│   • TOA: 12 virtual speakers (8 horizontal + 4 elevated)   │
│   • Speaker compensation: 1/√N gain (energy conservation)  │
│   • Equal-power panning to L/R channels                    │
│   ↓                                                         │
│ Stereo Output (L/R) for headphones                         │
└─────────────────────────────────────────────────────────────┘
```

**Critical Implementation Details:**
- **Speaker Compensation**: Applied in both offline (`decodeAmbisonicToBinaural`) and real-time (`createAmbisonicDecoderNodes`) decoders
  - FOA: 1/√8 ≈ 0.354 (-9.0dB)
  - TOA: 1/√12 ≈ 0.289 (-10.8dB)
  - Prevents clipping when summing multiple virtual speakers
- **TOA Parallel Convolution**: Web Audio ConvolverNode only supports 1/2/4 channels, so 16-ch TOA uses splitter → 16 mono convolvers → merger
- **Sample Rate Resampling**: Linear interpolation when IR sample rate ≠ AudioContext sample rate

### Convolution Pipeline (Path 2)

```
┌─────────────────────────────────────────────────────────────┐
│ Mono Source (44.1kHz)                                       │
│   ↓                                                         │
│ Convolve with IR (1-ch or 2-ch)                            │
│   • ConvolverNode in Web Audio API                         │
│   • Mono IR → Mono output                                  │
│   • Binaural IR → Stereo output                            │
│   ↓                                                         │
│ Three.js Spatial Audio (distance + panning)                │
│   • PositionalAudio for 3D positioning                     │
│   • Distance attenuation                                   │
│   ↓                                                         │
│ Stereo Output (L/R)                                         │
└─────────────────────────────────────────────────────────────┘
```

### Backend IR Processing Flow

```
1. User uploads WAV file (any channel count)
   └→ POST /api/impulse-responses/upload

2. ImpulseResponseService.process_ir_file()
   ├→ Read audio: soundfile.read(always_2d=True)
   ├→ Detect original channels
   ├→ Determine target channels:
   │  • 1-2 channels → Keep as-is
   │  • 3-15 channels → Extract first 4 (FOA)
   │  • 16+ channels → Extract first 16 (TOA)
   ├→ extract_channels() - Get first N channels
   ├→ Resample to 44.1kHz (if needed)
   ├→ detect_ir_format() - Auto-detect format
   ├→ Save as: {name}_{format}_{hash}.wav
   └→ Return ImpulseResponseMetadata

3. File served via /static/impulse_responses/{filename}
```

### Frontend Integration Points

**Constants:** `frontend/src/lib/constants.ts`
- `AMBISONIC` - Channel counts, weights, decoder config, performance limits
- `IR_FORMAT` - Format string constants (mono, binaural, foa, toa)
- `IMPULSE_RESPONSE.MAX_CHANNELS` - Updated from 2 to 16

**Types:** `frontend/src/types/audio.ts`
- `IRFormat`, `AmbisonicOrder`, `ImpulseResponseMetadata`
- `Position3D`, `SphericalPosition`, `Orientation`
- `FOACoefficients`, `TOACoefficients`

**Core Libraries:**
- `ambisonic-encoder.ts` - Spatial encoding (mono → 4/16 ch)
- `ambisonic-rotator.ts` - Field rotation based on camera
- `ambisonic-decoder.ts` - Virtual speaker binaural decoding

**API Integration:** `frontend/src/services/api.ts`
- `uploadImpulseResponse()`, `listImpulseResponses()`, `deleteImpulseResponse()`

### Performance Characteristics

| Format | Convolutions | CPU Load | Max Concurrent | Mobile |
|--------|--------------|----------|----------------|--------|
| **Mono** | 1 | Very Low | 20+ | ✅ |
| **Binaural** | 2 | Low | 15+ | ✅ |
| **FOA** | 4 | Medium | 8 | ✅ |
| **TOA** | 16 | High | 4 | ⚠️ (use FOA) |

**Performance Settings:** `AMBISONIC.PERFORMANCE` in constants.ts
- `MAX_TOA_SOURCES: 4` - Limit concurrent TOA auralizations
- `MAX_FOA_SOURCES: 8` - Limit concurrent FOA auralizations
- `PREFER_FOA_ON_MOBILE: true` - Auto-fallback on mobile devices

### Channel Extraction Examples

| Input File | Original Ch | Target Ch | Result Format |
|------------|-------------|-----------|---------------|
| Room mono | 1 | 1 | Mono |
| Binaural HRTF | 2 | 2 | Binaural |
| Odeon FOA export | 8 | 4 | FOA (first 4) |
| CATT TOA export | 32 | 16 | TOA (first 16) |

### SN3D Normalization

All ambisonic encoding/decoding uses **SN3D (Schmidt semi-normalized)** standard:
- **W channel:** `1/√2` (~0.707)
- **Directional channels (X,Y,Z,...):** `1.0`
- Ensures consistent energy distribution across orders
- Industry-standard for ambisonic interchange

### Future Enhancements

**Phase 1 (Current):** ✅
- Backend IR upload/processing
- Ambisonic encoder/rotator/decoder libraries
- API integration

**Phase 2 (Completed):** ✅
- ✅ Rewrite `auralization-service.ts` for multi-format support
- ✅ Integration with ThreeScene camera rotation (real-time listener rotation)
- ✅ ScriptProcessorNode-based rotator for FOA
- [ ] UI component for IR upload/management (`ImpulseResponseUpload.tsx`)

**Phase 3 (In Progress):**
- ✅ Real-time FOA rotation (ScriptProcessorNode)
- [ ] Higher-order TOA rotation (Wigner D-matrices for orders 2-3)
- [ ] HRTF-based binaural decoding via JSAmbisonics (partially done)
- [ ] Real-time AudioWorklet processing (replace ScriptProcessorNode)

**Phase 4 (Future):**
- [ ] Multiple IR support for accurate translation
- [ ] IR interpolation for smooth position transitions
- [ ] UI orientation indicator in first-person mode
- [ ] Source position locking/warning when ambisonic IR loaded
- [ ] IR reversal for auralization/deauralization workflows

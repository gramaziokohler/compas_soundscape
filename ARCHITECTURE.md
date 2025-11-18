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
│   │   ├── audio_service.py         # Multi-model audio generation (TangoFlux + AudioLDM2)
│   │   ├── audioldm2_service.py     # AudioLDM2 audio generation service
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
│   ├── pnpm-lock.yaml
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── public/
│   │   ├── hrtf/                   # HRTF data files
│   │   │   ├── HRTF_KEMAR_front.sofa         # KEMAR HRTF for binaural audio
│   │   │   └── D1_48K_24bit_256tap_FIR_SOFA.sofa  # High-quality FIR HRTF
│   │   └── [SVG icons]             # UI icons (file.svg, globe.svg, etc.)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # Root layout
│       │   ├── page.tsx             # Main page (orchestration only)
│       │   └── globals.css          # Tailwind + CSS variables
│       ├── components/
│       │   ├── audio/               # Audio UI components
│       │   │   ├── AudioWaveformDisplay.tsx     # Waveform display
│       │   │   ├── WaveSurferTimeline.tsx       # Enhanced timeline (WaveSurfer.js)
│       │   │   ├── ImpulseResponseUpload.tsx    # IR file upload UI
│       │   │   ├── IRManagementPanel.tsx        # IR file management UI
│       │   │   ├── IRStatusNotice.tsx           # IR status notifications
│       │   │   ├── SpatialModeSelector.tsx      # Spatial audio mode selector
│       │   │   ├── AudioModeSelector.tsx        # Audio rendering mode selector
│       │   │   ├── AudioRenderingModeSelector.tsx  # Rendering mode UI
│       │   │   ├── AmbisonicOrderSelector.tsx   # FOA/TOA order selector
│       │   │   ├── AnechoicModeToggle.tsx       # Anechoic mode toggle
│       │   │   ├── AudioStatusDisplay.tsx       # Audio status display
│       │   │   └── OutputDecoderToggle.tsx      # Output decoder controls
│       │   ├── controls/            # Reusable UI controls
│       │   │   ├── FileUploadArea.tsx
│       │   │   ├── PlaybackControls.tsx
│       │   │   ├── OrientationIndicator.tsx
│       │   │   └── ResonanceAudioControls.tsx
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   └── sidebar/         # Sidebar sub-components
│       │   ├── overlays/            # UI overlays
│       │   ├── scene/               # 3D scene components
│       │   │   ├── ThreeScene.tsx              # Main 3D scene component
│       │   │   ├── SceneControlButton.tsx      # Reusable scene control button
│       │   │   ├── SettingsButton.tsx          # Settings button (top-right)
│       │   │   └── AdvancedSettingsPanel.tsx   # Advanced settings panel UI
│       │   └── ui/                  # Reusable UI components
│       │       └── ErrorToast.tsx   # Toast notification component
│       ├── hooks/
│       │   ├── useApiErrorHandler.ts     # API error handling with toast notifications
│       │   ├── useAudioControls.ts       # Audio playback state & controls
│       │   ├── useAudioOrchestrator.ts   # Audio orchestrator integration
│       │   ├── useAudioNormalization.ts  # Audio normalization utilities
│       │   ├── useRoomMaterials.ts       # Room material management
│       │   ├── useFileUpload.ts          # File upload & processing (with error notifications)
│       │   ├── useHorizontalScroll.ts    # Mouse wheel horizontal scrolling
│       │   ├── useModalImpact.ts         # Modal analysis & impact sound synthesis
│       │   ├── useReceivers.ts           # Audio receiver management
│       │   ├── useSED.ts                 # Sound Event Detection
│       │   ├── useSoundGeneration.ts     # Sound generation workflow
│       │   ├── useTextGeneration.ts      # Text/prompt generation
│       │   ├── useTimelinePlayback.ts    # Timeline playback state management
│       │   └── useWaveformInteraction.ts # Waveform zoom/pan interaction
│       ├── lib/
│       │   ├── constants.ts         # All constants (AMBISONIC, IR_FORMAT, AUDIO_MODES, etc.)
│       │   ├── audio/               # Audio processing architecture
│       │   │   ├── AudioOrchestrator.ts         # Main orchestrator (audio graph management)
│       │   │   ├── ambisonic-core.ts            # Core ambisonic utilities
│       │   │   ├── jsambisonic-decoder.ts       # JSAmbisonics HRTF decoder integration
│       │   │   ├── audio-info.ts                # Audio file loading & metadata
│       │   │   ├── audio-upload.ts              # Audio upload utilities
│       │   │   ├── ir-utils.ts                  # IR processing utilities
│       │   │   ├── modal-impact-synthesis.ts    # Impact sound synthesis
│       │   │   ├── rt60-analysis.ts             # RT60 reverb time analysis
│       │   │   ├── waveform-utils.ts            # Waveform visualization
│       │   │   ├── timeline-utils.ts            # Timeline data extraction
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling
│       │   │   ├── scheduled-sounds-logger.ts    # Debug logging for scheduled sounds
│       │   │   ├── emergency-audio-kill.ts       # Emergency audio shutdown
│       │   │   ├── wav-parser.ts                # WAV file parser
│       │   │   ├── core/                        # Core interfaces & abstractions
│       │   │   │   └── interfaces/
│       │   │   │       ├── IAudioMode.ts        # Audio mode interface
│       │   │   │       ├── IAudioOrchestrator.ts # Orchestrator interface
│       │   │   │       ├── IBinauralDecoder.ts  # Binaural decoder interface
│       │   │   │       └── IOutputDecoder.ts    # Output decoder interface
│       │   │   ├── modes/                       # Audio rendering modes
│       │   │   │   ├── AmbisonicIRMode.ts       # Ambisonic IR convolution mode
│       │   │   │   ├── AnechoicMode.ts          # Anechoic (dry) mode
│       │   │   │   ├── MonoIRMode.ts            # Mono IR convolution mode
│       │   │   │   ├── ResonanceMode.ts         # Resonance Audio mode
│       │   │   │   ├── StereoIRMode.ts          # Stereo/binaural IR mode
│       │   │   │   └── ThreeJSMode.ts           # Three.js PositionalAudio mode
│       │   │   ├── decoders/                    # Audio decoders
│       │   │   │   └── BinauralDecoder.ts       # Binaural output decoder
│       │   │   ├── utils/                       # Audio utilities
│       │   │   │   ├── error-handling.ts        # Error handling utilities
│       │   │   │   ├── mode-selector.ts         # Mode selection logic
│       │   │   │   └── mode-transition.ts       # Mode transition handling
│       │   │   └── debug/                       # Debug utilities
│       │   │       └── audio-flow-debugger.ts   # Audio graph flow debugging
│       │   ├── sound/               # Sound system utilities
│       │   ├── three/               # Three.js utilities (Service-Oriented Architecture)
│       │   │   ├── scene-coordinator.ts      # Scene init, camera, animation loop
│       │   │   ├── geometry-renderer.ts      # Geometry mesh rendering & highlighting
│       │   │   ├── sound-sphere-manager.ts   # Sound sphere creation & audio sources
│       │   │   ├── receiver-manager.ts       # Receiver cube management
│       │   │   ├── mode-visualizer.ts        # Mode shape visualization on meshes
│       │   │   ├── input-handler.ts          # User input (click, drag, keyboard)
│       │   │   ├── draggable-mesh-manager.ts # Shared mesh update utilities
│       │   │   ├── sceneSetup.ts             # Scene setup helpers
│       │   │   ├── materials.ts              # Material definitions
│       │   │   ├── mesh-cleanup.ts           # Resource disposal utilities
│       │   │   ├── entityMeshes.ts           # Entity mesh management
│       │   │   └── projection-utils.ts       # 3D projection utilities
│       │   └── utils.ts             # General utilities
│       ├── contexts/
│       │   └── ErrorContext.tsx     # Global error notification context provider
│       ├── services/
│       │   └── api.ts               # API client (all backend HTTP calls with error handling)
│       └── types/
│           ├── audio.ts             # Audio type definitions (modes, IR, ambisonic, etc.)
│           ├── components.ts        # Component prop types
│           ├── index.ts             # Type exports
│           ├── modal.ts             # Modal analysis & mode visualization types
│           ├── receiver.ts          # Receiver types
│           ├── resonance-audio.d.ts # Resonance Audio library type declarations
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
│                │  │  - Manage multiple models           │ │     │
│                │  │    (TangoFlux + AudioLDM2)         │ │     │
│                │  │  - Route to selected model          │ │     │
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


### Ambisonic IR Mode Pipeline


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

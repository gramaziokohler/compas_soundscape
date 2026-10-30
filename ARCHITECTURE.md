# Architecture Overview

System architecture of [the repository](https://github.com/bouiz/compas_soundscape)

```
compas_soundscape/
├── backend/
│   ├── main.py                      # FastAPI app initialization
│   ├── tasks.py                     # Background tasks
│   ├── config/
│   │   ├── __init__.py
│   │   └── constants.py             # All backend constants (IR formats, ambisonic channels, etc.)
│   ├── data/
│   │   ├── AudioSet_classes.py      # AudioSet class definitions
│   │   ├── BBCSoundEffects.csv      # BBC sound effects database
│   │   └── [3D model samples]       # IFC, OBJ test files
│   ├── pffdtd_backend/              # Vendored PFFDTD (MIT) + compas driver, compas-pffdtd env only
│   │   ├── python/ c_cuda/          # Upstream sources (local patches marked `compas:`, VENDORED.md)
│   │   ├── sim_prepare.py engine.py outputs.py materials.py postprocess.py
│   │   ├── pipeline.py              # Job CLI (simulation / voxel_preview / animation) called by the pffdtd services
│   │   ├── animation.py             # Kept voxelisation of a finished run + on-demand wave-animation runs
│   │   ├── fields.py                # Strength G (3D lattice volume, outputs.lattice_nodes) + animation-plane frames
│   │   ├── free_grid.py free_ir.py free_runs.py  # Free positioning: candidate grid, raw store, reciprocal runs
│   │   ├── ir_server.py             # Resident IR server (free positioning), started by services/pffdtd_ir_server.py
│   │   ├── air_absorption.py        # numba build of upstream's visco air-absorption filter (bit-identical, ~80x faster)
│   │   └── validation/              # A1–A4, B1–B3 tests + REPORT.md (measured benchmark: backend/tests/benchmarks/bras/, scenes.py)
│   ├── models/
│   │   └── schemas.py               # Pydantic request/response models
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── pffdtd.py                 # PFFDTD GPU wave simulation (run, materials, status, results, field files, voxel preview)
│   │   ├── pffdtd_free.py           # Free positioning: IRs of a moved listener / source (direct request), grid points
│   │   ├── generation.py            # LLM text/prompt generation endpoints
│   │   ├── impulse_responses.py     # IR upload/list/delete endpoints
│   │   ├── library_search.py        # Sound library search (BBC, Freesound)
│   │   ├── modal_analysis.py        # Modal analysis endpoints
│   │   ├── pyroomacoustics.py       # Pyroomacoustics acoustic simulation (ISM, RT60)
│   │   ├── reprocess.py             # Audio reprocessing (denoising)
│   │   ├── sed_analysis.py          # Sound Event Detection endpoints
│   │   ├── simulation_preflight.py  # Pre-simulation geometry check (pyroomacoustics / pffdtd)
│   │   ├── sounds.py                # Audio generation endpoints
│   │   └── upload.py                # File upload endpoints
│   ├── services/
│   │   ├── audio_service.py         # Multi-model audio generation (TangoFlux + AudioLDM2)
│   │   ├── audioldm2_service.py     # AudioLDM2 audio generation service
│   │   ├── bbc_service.py           # BBC Sound Effects API
│   │   ├── freesound_service.py      # Freesound API integration
│   │   ├── impulse_response_service.py  # IR processing & channel extraction
│   │   ├── llm_service.py           # Google Gemini LLM
│   │   ├── modal_analysis_service.py    # Modal analysis & mode shape visualization
│   │   ├── pffdtd_job.py            # PFFDTD worker child: mesh prep → compas-pffdtd pipeline → WAV/results/field
│   │   ├── pffdtd_preview_job.py    # CPU worker child: voxelise-only grid check → preview payload + points
│   │   ├── pffdtd_animation_job.py  # pffdtd worker child: wave animation of a finished run on a chosen plane
│   │   ├── pffdtd_scene_export.py   # SimulationMesh → PFFDTD scene + material coefficients
│   │   ├── pffdtd_free.py           # Free positioning (compas-toy side): job/results blocks, nearest grid point, WAV names
│   │   ├── pffdtd_ir_server.py      # Owns the resident compas-pffdtd IR server process (API side)
│   │   ├── pyroomacoustics_service.py   # Pyroomacoustics simulation (ISM, RT60, EDT)
│   │   ├── pyroomacoustics_room_builder.py  # pra.Room from a prepared SimulationMesh
│   │   ├── simulation_geometry_loader.py    # Speckle fetch + per-face materials (all engines)
│   │   ├── simulation_mesh_service.py   # Weld → air-side orientation → classify → merge
│   │   ├── simulation_preflight_service.py  # Geometry issues (per-engine severities)
│   │   ├── simulation_preflight_worker.py   # CPU-worker entry of the preflight job
│   │   ├── sed_service.py           # Sound Event Detection
│   │   ├── speckle_demo.py          # Speckle demo/testing
│   │   └── speckle_service.py       # Speckle integration service
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── acoustic_measurement.py  # Acoustic measurement utilities
│   │   ├── audio_processing.py      # Audio manipulation utilities
│   │   ├── resampling.py            # Single resampler → AUDIO_SAMPLE_RATE (numpy/scipy only)
│   │   ├── file_operations.py       # File I/O and cleanup
│   │   ├── helpers.py               # General helpers
│   │   ├── mesh_topology.py         # KD-tree weld, dedupe, edges, components, loops
│   │   ├── mesh_raycast.py          # numba ray/triangle queries
│   │   ├── air_visibility.py        # Diffuse random walk from sources/receivers
│   │   ├── mesh_orientation.py      # Hierarchical one-/two-sided orientation
│   │   ├── mesh_coplanar.py         # Coplanar triangles → polygon walls, hull test
│   │   ├── pffdtd_grid.py           # PFFDTD grid spacing (bbox-aligned), cost, oblique walls
│   │   ├── preflight_payload.py     # Preview payload for the frontend
│   │   └── sed_processing.py        # SED processing utilities
│   └── temp/                        # Parent temporary directory (all temp files)
│       ├── static/                  # Static files served via /static/
│       │   ├── sounds/
│       │   │   └── generated/       # Generated audio files
│       │   ├── impulse_responses/   # Uploaded IR files (1/2/4/16 channels)
│       │   ├── pyroomacoustics_rir/ # Pyroomacoustics generated RIR files
│       │   └── pffdtd_rir/          # PFFDTD IR WAVs (float32, 48 kHz, band-limited)
│       ├── uploads/                 # Uploaded files staging area
│       ├── library_downloads/       # Downloaded library audio files
│       └── simulations/             # Pyroomacoustics/PFFDTD simulation results
│
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── pnpm-lock.yaml
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.mjs
│   ├── public/
│   │   ├── hrtf/                   # HRTF data files
│   │   │   ├── HRTF_KEMAR_front.json           # KEMAR HRTF (JSON from SOFA)
│   │   │   ├── D1_48K_24bit_256tap_FIR_SOFA.json  # High-quality FIR HRTF
│   │   │   └── IRC_1076_C_HRIR_48000.sofa.json # IRCAM HRIR dataset
│   │   └── [SVG icons]             # UI icons (file.svg, globe.svg, etc.)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx           # Root layout
│       │   ├── page.tsx             # Main page (orchestration only)
│       │   └── globals.css          # Tailwind + CSS variables
│       ├── components/
│       │   ├── acoustics/           # Acoustic simulation components
│       │   │   ├── ResonanceAudioMaterialUI.tsx      # Resonance Audio material config
│       │   │   ├── SpeckleMaterialAssignmentUI.tsx   # Speckle-based material assignment
│       │   │   ├── SpeckleSurfaceMaterialsSection.tsx # Speckle surface materials section
│       │   │   └── SurfaceMaterialsSection.tsx       # Shared surface materials component
│       │   ├── audio/               # Audio UI components
│       │   │   ├── AudioRenderingModeSelector.tsx  # Rendering mode selector UI
│       │   │   ├── AudioWaveformDisplay.tsx        # Waveform display
│       │   │   ├── ImpulseResponseUpload.tsx       # IR file upload UI
│       │   │   ├── SoundCardWaveSurfer.tsx         # Sound card with WaveSurfer
│       │   │   └── WaveSurferTimeline.tsx          # Enhanced timeline (WaveSurfer.js)
│       │   ├── controls/            # Reusable UI controls
│       │   │   ├── FileUploadArea.tsx
│       │   │   ├── OrientationIndicator.tsx
│       │   │   └── PlaybackControls.tsx
│       │   ├── layout/
│       │   │   ├── ObjectExplorer.tsx      # Object explorer tree (right sidebar)
│       │   │   ├── RightSidebar.tsx        # Right sidebar container
│       │   │   ├── Sidebar.tsx             # Left sidebar (main navigation)
│       │   │   └── sidebar/               # Sidebar sub-components
│       │   │       ├── acoustics/          # Acoustics tab sub-components
│       │   │       │   ├── index.ts
│       │   │       │   ├── PyroomAcousticsSimulationSettings.tsx # Pyroomacoustics settings
│       │   │       │   ├── ResonanceAudioControls.tsx         # Resonance Audio controls
│       │   │       │   ├── ResonanceContent.tsx               # Resonance mode content
│       │   │       │   ├── SimulationResultContent.tsx        # Simulation results display
│       │   │       │   └── SimulationSetupContent.tsx         # Simulation setup form
│       │   │       ├── analysis/           # Analysis tab sub-components
│       │   │       │   ├── index.ts
│       │   │       │   ├── AnalysisResultContent.tsx          # Analysis results display
│       │   │       │   ├── AudioContextContent.tsx            # Audio context analysis
│       │   │       │   ├── AnalyzeModelContent.tsx           # 3D model analysis
│       │   │       │   ├── TextContextContent.tsx             # Text-based card
│       │   │       ├── sound/              # Sound tab sub-components
│       │   │       │   ├── index.ts
│       │   │       │   ├── CardTypeSwitcher.tsx               # Sound card type selector
│       │   │       │   ├── LibraryMode.tsx                    # Library search mode
│       │   │       │   ├── SampleAudioMode.tsx                # Sample audio mode
│       │   │       │   ├── SoundConfigContent.tsx             # Sound configuration
│       │   │       │   ├── SoundResultContent.tsx             # Sound result display
│       │   │       │   ├── TextToAudioMode.tsx                # Text-to-audio generation
│       │   │       │   └── UploadMode.tsx                     # Audio file upload mode
│       │   │       ├── AcousticsSection.tsx        # Acoustic simulations manager
│       │   │       ├── AdvancedSettingsSection.tsx  # Advanced settings panel
│       │   │       ├── AnalysisSection.tsx          # Analysis section manager
│       │   │       ├── ControlsInfo.tsx             # Controls information
│       │   │       ├── EntityInfoPanel.tsx          # Entity info (bottom right sidebar)
│       │   │       ├── ReceiversSection.tsx         # Audio receivers section
│       │   │       └── SoundGenerationSection.tsx   # Sound generation controls
│       │   ├── scene/               # 3D scene components
│       │   │   ├── SpeckleScene.tsx          # Main Speckle 3D scene component
│       │   │   ├── ModelUploadProgress.tsx   # Live Speckle ingestion stage/% in the upload overlay (poll → apiService.uploadFile onProgress → uiStore.globalModelUploadProgress)
│       │   │   └── VirtualTreeItem.tsx       # Virtual tree item for object explorer
│       │   └── ui/                  # Reusable UI components
│       │       ├── ButtonGroup.tsx           # Grouped button component
│       │       ├── Card.tsx                  # Card container component
│       │       ├── CardSection.tsx           # Card section layout
│       │       ├── CheckboxField.tsx         # Checkbox with label
│       │       ├── EmptyState.tsx             # Empty state placeholder
│       │       ├── Notice.tsx                 # Severity-aware message bar / tag
│       │       ├── Badge.tsx                  # Compact status pill
│       │       ├── ErrorToast.tsx             # Toast notification component
│       │       ├── Icon.tsx                  # Icon component
│       │       ├── RangeSlider.tsx           # Range slider input
│       │       ├── SceneControlButton.tsx    # Scene control button
│       │       ├── VerticalTabButton.tsx     # Vertical tab button
│       │       └── VerticalVolumeSlider.tsx  # Volume slider (vertical)
│       ├── contexts/
│       │   ├── AcousticMaterialContext.tsx   # Acoustic material state (ref-based bridge)
│       │   ├── ErrorContext.tsx              # Global error notification context
│       │   ├── RightSidebarContext.tsx       # Right sidebar state management
│       │   ├── SpeckleSelectionModeContext.tsx # Speckle selection mode state
│       │   └── SpeckleViewerContext.tsx      # Speckle viewer instance context
│       ├── Documentation/
│       │   ├── FilteringExtension-doc.md    # Speckle filtering extension docs
│       │   ├── SelectionExtension-doc.md    # Speckle selection extension docs
│       │   ├── WorldTree-doc.md             # Speckle world tree docs
│       │   └── speckle_docs.md              # General Speckle documentation
│       ├── hooks/
│       │   ├── useAcousticsMaterials.ts     # Acoustic material management
│       │   ├── useAcousticsSimulation.ts    # Main acoustic simulation manager
│       │   ├── useAnalysis.ts               # Analysis state management
│       │   ├── useApiErrorHandler.ts        # API error handling with toast
│       │   ├── useAudioControls.ts          # Audio playback state & controls
│       │   ├── useAudioNormalization.ts     # Audio normalization utilities
│       │   ├── useAudioOrchestrator.ts      # Audio orchestrator integration
│       │   ├── useFileUpload.ts             # File upload & processing
│       │   ├── useHorizontalScroll.ts       # Mouse wheel horizontal scrolling
│       │   ├── useModalImpact.ts            # Modal analysis & impact sound synthesis
│       │   ├── usePyroomAcousticsSimulation.ts # Pyroomacoustics simulation state
│       │   ├── useReceivers.ts              # Audio receiver management
│       │   ├── useRoomMaterials.ts          # Room material management
│       │   ├── useSED.ts                    # Sound Event Detection
│       │   ├── useSoundGeneration.ts        # Sound generation workflow
│       │   ├── useSpeckleFiltering.ts       # Speckle object filtering
│       │   ├── useSpeckleInteractions.ts    # Speckle user interactions (click, hover)
│       │   ├── useSpeckleSurfaceMaterials.ts # Speckle surface material management
│       │   ├── useSpeckleTree.ts            # Speckle world tree navigation
│       │   ├── useTextGeneration.ts         # Text/prompt generation
│       │   ├── useTimelinePlayback.ts       # Timeline playback state management
│       │   └── useWaveformInteraction.ts    # Waveform zoom/pan interaction
│       ├── lib/
│       │   ├── audio/               # Audio processing architecture
│       │   │   ├── AudioOrchestrator.ts         # Main orchestrator (audio graph management)
│       │   │   ├── audio-scheduler.ts           # Audio scheduling utilities
│       │   │   ├── modal-impact-synthesis.ts    # Impact sound synthesis
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling
│       │   │   ├── core/                        # Core interfaces & abstractions
│       │   │   │   └── interfaces/
│       │   │   │       ├── IAudioMode.ts        # Audio mode interface
│       │   │   │       ├── IAudioOrchestrator.ts # Orchestrator interface
│       │   │   │       └── IBinauralDecoder.ts  # Binaural decoder interface
│       │   │   ├── modes/                       # Audio rendering modes
│       │   │   │   ├── AmbisonicIRMode.ts       # Ambisonic IR convolution mode
│       │   │   │   ├── AnechoicMode.ts          # Anechoic (dry) mode
│       │   │   │   └── ResonanceMode.ts         # Resonance Audio mode
│       │   │   ├── decoders/                    # Audio decoders
│       │   │   │   ├── index.ts                 # Decoder exports
│       │   │   │   ├── BinauralDecoder.ts       # Binaural output decoder (IRCAM HRTFs)
│       │   │   │   ├── OmnitoneFOADecoder.ts    # Omnitone FOA binaural decoder
│       │   │   │   └── VirtualSpeakersDecoder.ts # Virtual speaker binaural decoder
│       │   │   ├── output/                      # Multichannel ambisonic send (Dante / DAW)
│       │   │   │   ├── AmbisonicSendController.ts # Send lifecycle: device, layout, binaural swap
│       │   │   │   ├── AmbisonicSendBus.ts      # 16-ch bus: tap crossfade + HOA rotator
│       │   │   │   └── destination-layout.ts    # 16-ch discrete destination / stereo restore
│       │   │   └── utils/                       # Audio utilities
│       │   │       ├── ambisonic-utils.ts       # Ambisonic encoding/decoding utilities
│       │   │       ├── ambisonic-convolver.ts   # Mono → ACN IR convolver; no ConvolverNode for all-zero channels (shared per filter by AmbisonicIRMode)
│       │   │       ├── ambisonic-encoder.ts     # Mono → ACN/SN3D spherical-harmonic encoder (replaces JSAmbisonics monoEncoder)
│       │   │       ├── global-source.ts         # Global (non-spatial) background beds: omni encoder / W-only IR
│       │   │       ├── audio-file-decoder.ts    # Audio file decoding
│       │   │       ├── audio-info.ts            # Audio file loading & metadata
│       │   │       ├── audio-upload.ts          # Audio upload utilities
│       │   │       ├── emergency-audio-kill.ts  # Emergency audio shutdown
│       │   │       ├── error-handling.ts        # Error handling utilities
│       │   │       ├── ir-utils.ts              # IR processing utilities
│       │   │       ├── mode-selector.ts         # Mode selection logic
│       │   │       ├── mode-transition.ts       # Mode transition handling
│       │   │       ├── scheduled-sounds-logger.ts # Debug logging for scheduled sounds
│       │   │       ├── timeline-utils.ts        # Timeline data extraction
│       │   │       └── waveform-utils.ts        # Waveform visualization
│       │   └── three/               # Three.js / Speckle utilities
│       │       ├── BoundingBoxManager.ts        # Bounding box management
│       │       ├── draggable-mesh-manager.ts    # Shared mesh update utilities
│       │       ├── mesh-cleanup.ts              # Resource disposal utilities
│       │       ├── receiver-manager.ts          # Receiver cube management
│       │       ├── sound-sphere-manager.ts      # Sound sphere creation & audio sources
│       │       ├── speckle-audio-coordinator.ts # Speckle + audio coordination
│       │       ├── speckle-camera-controller.ts # Speckle camera controls
│       │       ├── speckle-drag-handler.ts      # Speckle drag interaction handler (one gizmo moves a multi-selection)
│       │       ├── speckle-event-bridge.ts      # Speckle event bridge (click, Shift/Ctrl multi-select, box-select)
│       │       ├── custom-object-box-select.ts  # Screen-rect projection + selectable sound/listener collection for box-select
│       │       ├── custom-selection-highlight.ts # Box outlines around multi-selected sound spheres / listeners
│       │       ├── speckle-scene-adapter.ts     # Speckle scene adapter (Three.js bridge)
│       │       └── spiral-placement.ts          # Spiral placement algorithm
│       ├── services/
│       │   └── api.ts               # API client (all backend HTTP calls)
│       ├── types/
│       │   ├── acoustics.ts         # Acoustic simulation types
│       │   ├── ambisonics.d.ts      # Ambisonics library type declarations
│       │   ├── analysis.ts          # Analysis types
│       │   ├── audio.ts             # Audio type definitions (modes, IR, etc.)
│       │   ├── card.ts              # Sound card types
│       │   ├── components.ts        # Component prop types
│       │   ├── index.ts             # Type exports
│       │   ├── materials.ts         # Acoustic material types
│       │   ├── modal.ts             # Modal analysis & mode visualization types
│       │   ├── omnitone.d.ts        # Omnitone library type declarations
│       │   ├── omnitone-module.d.ts # Omnitone module type declarations
│       │   ├── receiver.ts          # Receiver types
│       │   ├── resonance-audio.d.ts # Resonance Audio library type declarations
│       │   ├── sed.ts               # SED types
│       │   ├── speckle-materials.ts # Speckle material types
│       │   ├── speckle-scene.ts     # Speckle scene types
│       │   ├── three-scene.ts       # Three.js scene types
│       │   └── wav-decoder.d.ts     # WAV decoder type declarations
│       └── utils/
│           ├── acousticMetrics.ts   # Acoustic metrics calculations
│           ├── constants.ts         # All frontend constants (colors, sizes, config)
│           ├── event-factory.ts     # Sound event factory
│           ├── positioning.ts       # Sound positioning utilities
│           ├── state-utils.ts       # State management utilities
│           ├── useNameEditing.ts    # Name editing hook utility
│           └── utils.ts             # General utilities
│
├── .bmad-core/                      # BMAD framework configuration
│   ├── agents/                      # Agent definitions (analyst, architect, dev, etc.)
│   ├── agent-teams/                 # Team configurations
│   ├── checklists/                  # QA and review checklists
│   ├── data/                        # Knowledge base and reference data
│   ├── tasks/                       # Task definitions
│   ├── templates/                   # Document templates
│   ├── workflows/                   # Development workflows
│   └── core-config.yaml            # Core BMAD configuration
│
├── .claude/                         # Claude AI configuration
│   ├── commands/BMad/              # BMAD slash commands
│   └── settings.local.json         # Local Claude settings
│
├── .github/
│   ├── ISSUE_TEMPLATE/             # Bug report / feature request templates
│   └── workflows/                  # CI/CD (build, docs, pr-checks, release)
│
├── ARCHITECTURE.md                  # System architecture (this file)
├── CHANGELOG.md                     # Change log
├── README.md                        # Project overview
├── pyproject.toml                   # Python project configuration
└── requirements.txt                 # Python dependencies
```

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 15)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐      ┌──────────────┐      ┌───────────────┐  │
│  │   page.tsx  │─────▶│ Components   │◀─────│  Custom Hooks │  │
│  │  (Minimal)  │      │              │      │               │  │
│  └─────────────┘      │ - Sidebar    │      │ - useFile     │  │
│                       │ - Speckle    │      │ - useSound    │  │
│                       │ - Overlays   │      │ - useAudio    │  │
│                       └──────┬───────┘      │ - useSpeckle* │  │
│                              │              └───────┬───────┘  │
│                              │                      │           │
│                              └──────────┬───────────┘           │
│                                         │                       │
│  ┌──────────────────────────────────────┼────────────────────┐ │
│  │              Context Providers        │                    │ │
│  │  ErrorProvider > SpeckleViewerProvider >                   │ │
│  │  SpeckleSelectionModeProvider > AcousticMaterialProvider   │ │
│  └──────────────────────────────────────┼────────────────────┘ │
│                                         │                       │
│                                         ▼                       │
│                              ┌──────────────────┐               │
│                              │  Services/API    │               │
│                              │  (api.ts)        │               │
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
│    │  upload.py        │   │  pyroomacoustics  │   │  generation.py │
│    │                   │   │                   │   │                │
│    │ - /api/upload     │   │ - /api/simulate   │   │ - /api/gen-    │
│    │                   │   │                   │   │    -text       │
│    └─────────┬─────────┘   └─────────┬─────────┘   └─────────┬──────┘
│              │                       │                       │      │
│    ┌─────────▼─────────┐             │                       │      │
│    │  Routers/         │             │                       │      │
│    │  sounds.py        │             │                       │      │
│    │  library_search   │             │                       │      │
│    │                   │             │                       │      │
│    │ - /api/generate   │             │                       │      │
│    │    -sounds        │             │                       │      │
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
│                │  │    SpeckleService                   │ │     │
│                │  │  - Speckle model integration        │ │     │
│                │  │  - Object traversal & filtering     │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    LLMService                       │ │     │
│                │  │  - Generate prompts                 │ │     │
│                │  │  - Select analysis entities        │ │     │
│                │  │  - Interact with Gemini            │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    AudioService                     │ │     │
│                │  │  - Generate audio from text         │ │     │
│                │  │  - Manage multiple models           │ │     │
│                │  │    (TangoFlux + AudioLDM2)         │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    PyroomAcousticsService           │ │     │
│                │  │  - ISM simulation                   │ │     │
│                │  │  - RT60, EDT, C80 computation       │ │     │
│                │  │  - RIR generation                   │ │     │
│                │  └─────────────────────────────────────┘ │     │
│                │                                           │     │
│                │  ┌─────────────────────────────────────┐ │     │
│                │  │    ImpulseResponseService           │ │     │
│                │  │  - IR upload & validation           │ │     │
│                │  │  - Channel extraction               │ │     │
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

### Frontend Context Provider Nesting

```
ErrorProvider
  └── SpeckleViewerProvider
        └── SpeckleSelectionModeProvider
              └── AcousticMaterialProvider
                    └── RightSidebarContext (implicit)
                          └── App Components
```

### UI Modes — Simple (bubbles) vs Expert (sidebars)

`uiStore.uiMode` (persisted, default `simple`) picks the presentation; it is switched in
Settings › Display › Interface (`AdvancedSettingsSection` → `sceneWorkflowStore.switchUIMode`).

```
page.tsx
  ├── expert → <Sidebar {...sidebarProps}/>          (Context → Usage → Sounds wizard)
  │   simple → <SimpleSoundscapes sidebarProps/>     (components/simple/)
  │              ├── scene bubbles (useSoundScenes + useSceneProgress)
  │              ├── "+" → ScenePromptComposer ──► sceneWorkflowStore.startScene
  │              │     (chips: speech, people, duration — people/duration are
  │              │      components/ui/EditableCycleChip: click cycles, double-click exact value;
  │              │      0 people disables speech; diffusion steps always SIMPLE_MODE.DIFFUSION_STEPS)
  │              ├── running bubble → SceneWorkflowDetail (live step detail,
  │              │     footer SceneWorkflowActions: Stop/Resume + "Open in detailed mode",
  │              │     right of the trash via BubblePanel.footerActions;
  │              │     done Analyze / Scenario steps → SceneStepHighlights: "Show colors" /
  │              │     "Show objects" toggles + expandable group / event lists,
  │              │     ThinkingDisclosure ← analysisStore.analysisThinking /
  │              │     soundscapeStore.orchestrateThinking + isOrchestrating ("Orchestrate agent"),
  │              │     "Scene settings" = getSceneSettingsRows + SettingsSummary tone="neutral")
  │              └── done bubble → select for DAW/3D + SoundGenerationSection panel
  └── <RightSidebar uiMode>  — same element tree in both modes (no remount):
        ├── AcousticsSection  presentation='section' | 'bubbles' (top-right column)
        └── ListenersSection  presentation='section' | 'bubbles' (bottom-right, grows upward)
              (listeners/ListenerBubbles.tsx for the bubble presentation)

Listener cards — expand ≠ power (one powered listener at a time, off by default):
  expand  = UI only (ListenersSection.expandedItemId). Viewer click on a listener mesh /
            grid point (event bridge debounced single click → SpeckleScene.onListenerClicked),
            double-click and acoustics "go to listener" set page.listenerExpandRequest {id, seq}.
  power   = Card.onTogglePower. Single → page.handleGoToReceiver (locked FPS view +
            receiver audio mode; poweredListenerId). Grid → page.handleToggleGridListenerPower
            (activeGridListenerId → grid showListeners → points in the viewer).
            Leaving FPS (Esc / bubble exit / exitGoToListenerMode) keeps a grid powered;
            only its power button turns it off. Simple mode: viewer double-click powers
            on without opening the floating card.
  grid boundary: GridListenerContent picks placementMode while no boundary exists —
            'objects' (useObjectSelectionPhase → bbox of picked surfaces, default) or
            'area' (areaDrawingStore.startGridDrawing(gridId) → useSpeckleAreaDrawing →
            gridListenersStore.setGridListenerArea; points = bbox grid clipped to the
            polygon, lib/three/grid-listener-geometry.ts). The grid polygon is stored on the
            grid listener (drawnArea), not in areaDrawingStore.drawnAreas.
  area drawing undo: while drawing, useSpeckleAreaDrawing installs an
            undoRedoRegistry.setUndoRedoOverride → Ctrl+Z / Ctrl+Y (and the toolbar) undo /
            redo placed points (AreaDrawingManager.undoPoint / redoPoint). Right-click is a no-op.
  orientation: ListenerOrientationWidget — Y/P/R editable (PositionWidget); while powered it
            mirrors the FPS camera and autosaves to receiversStore (debounced,
            LISTENER_ORIENTATION). useSpeckleFPS reads receivers via ref so saves never
            re-enter FPS. First FPS entry ever (per user, uiStore.seenHints synced via
            user preferences) shows components/scene/FpsHelpPopup in Simple mode.

Bubble columns overflow (all three columns):
  useBubbleColumnSpace (viewport − headings − bottom bar − uiStore.dawDockBottomSpace;
    right edge split by utils/bubbleOverflow.splitRightBudget using uiStore.bubbleColumnCounts)
  └── components/ui/BubbleScrollColumn — renders only the bubbles that fit, between two
      BubbleScrollButton pills ("N more"); wheel / drag / arrows scroll, focusIndex kept in view,
      "+" always visible

Bubble cards vs docked DAW (stacking):
  hooks/useBubbleFrontLayer(openKey) — scene panel (SimpleSoundscapes), acoustics card,
    listener card: pointerdown (capture) or opening a card → sceneWorkflowStore.simpleFrontLayer
    = 'panel' → z SIMPLE_MODE.PANEL_RAISED_Z_INDEX (205, above DAW 200, below bottom bar 210);
    DAWDock pointerdown (capture) → 'daw' → cards drop back to SIMPLE_MODE.Z_INDEX.

Simple-mode sound sphere click vs the scene panel:
  useSpeckleCoordinatorCallbacks (simple mode) → uiStore.requestSoundSphereReveal(promptIndex)
  └── hooks/useSoundSphereReveal — only while a scene panel is open: switch it to the sphere's
      scene cards → SoundGenerationSection `revealCardRequest` ({index, version}) expands the card
  hooks/useDismissOnSceneClick(…, keepOnTypes=['sound']) — a press on a visible sound sphere
    (coordinator.getVisibleCustomObjectTypeAt) never reduces the panel; other 3D clicks do.
  Global background cards (isConfigGlobal) never select their (hidden) sphere / gizmo
    (useSpeckleSoundHighlight).

sceneWorkflowStore (scenes run concurrently + independently, no frontend queue; runs keyed by
  scenario card index, each with a stable runId)
  Throttling is backend-side only: LLM steps → io_jobs LLM_SEMAPHORE, generate → worker queues.
  analysisStore runs per card (analyzingConfigIndices / analysisStatusByIndex,
  handleStopCardAnalysis); soundscapeStore generations are per invocation
  (handleStopGenerationFor, handleGenerateFiltered(…, { audioModel })).
  In-flight jobs follow their card through a LiveIndexRef (utils/liveIndexRegistry), so removing
  one scene never corrupts or blocks another. Scenes sharing an un-analyzed context await one
  analysis of it. Only the focus scene (selectFocusRun: open panel, else latest started) drives
  the expert sidebar, the DAW / 3D scene and the 3D highlights.
  analyze   → analysisStore.handleAnalyze(context)        (skipped/reused if analyzed)
  scenario  → analysisStore.handleScenarioAnalyze(usage)
  foley     → analysisStore.handleAnalyze(usage)          (foley + speech; ScenarioConfig.includeSpeech)
  generate  → page.handleSendAnalysisToGeneration (registered) → soundscapeStore.handleGenerateFiltered
  Composer reference image → ScenarioConfig.referenceImages → /api/scenarist `screenshots`
  (always), plus a fresh model-analysis card when a model is loaded and "Re-run model analysis" is on.
  Empty composer prompt is allowed when a model is loaded (scenario built from the analysis alone).
  Each step is idempotent (skipped when its result exists) → same runner powers Resume.
  Each step writes sidebarWizardStep / cardFlowStore + uiStore.sidebarNavCommand so a
  mounted expert Sidebar follows the pipeline live.

Simple-mode 3D highlights (hooks/useSimpleSceneHighlights, mounted by SimpleSoundscapes)
  analysis groups  → speckleStore.setAnalysisObjectGroups only while the Analyze step runs,
                     or sceneHighlightStore.analysisContextIndex ("Show colors") / focusedGroup
                     (hovered group alone); otherwise cleared (overrides handleAnalyzeModel's
                     final colors).
  scenario objects → scenarioPreviewStore.setPreview(utils/scenarioObjectRefs.buildScenarioPreview)
                     only while the Scenario step streams, or sceneHighlightStore.scenarioUsageIndex.
  Unmount (switch to Detailed) clears both; the expert card syncs take over.

Sound Scene Duplicate (scene bubble right-click → Duplicate; utils/duplicateSoundScene.ts)
  1. scenario scene → POST /api/scenarios/{id}/duplicate clones temp/analysis/scenarios_<id>.json
     under a new scenarioId (foley / orchestrate load it by id; a shared id would let
     re-orchestration group and overwrite BOTH scenes' sounds).
  2. One undo step (begin/endUndoInteraction):
     analysisStore.duplicateConfigAt(from, from + 2, { keepResults, overrides })
       → usage card copy right after its source, results kept, new scenarioId / orchestrateId
     soundscapeStore.duplicateSceneSounds(from, from + 1, ids)
       → sound cards appended (new config_id, remapped scenarioSource / orchestrateMeta ids),
         events cloned with the same audio files + positions (ids via remapEventIdToConfig)
     audioControlsStore.copySoundState(idMap) → per-sound DAW edits, then re-sync + re-bake.
  Shared audio files: handleRefreshScenario / handleRegenerateText delete only files no other
  scene still plays (utils/sceneAudioUrls.collectUnsharedSceneAudioUrls).
  Rename (same menu) edits the panel title inline → usage card display_name.
  "Save object visibility" / "Clear saved visibility" (same menu; also the simulation bubble menu and the
  Expert usage / simulation card kebabs) store the Object Explorer hide / isolate / exclude view on the card
  (`savedObjectVisibility`); powering the scene or simulation on restores it (`useApplySavedObjectVisibility`,
  see .cursor/rules/object-explorer.mdc § Saved Object Visibility).

SpeckleScene
  └── SceneBottomBar (full width, both modes): home · undo/redo · save
        | transport (play/stop/time/timeline) | volume · view · explorer · shortcuts · notifications · settings
```

### Generated-Card Settings & Regenerate

Once a card has a result, `Card` renders its pending-state editors (`settingsContent`) inside the
collapsible `SettingsSummary` ("Change … settings") instead of a read-only recap: a bordered
"card inside a card" (`.card-settings-inset`) styled like a pending card — the `.card-generated`
on-blue overrides are scoped out of it with `:not(.card-settings-inset *)`. Editing a setting puts
**Regenerate** (`settingsDirty` + `onRegenerate`) at the bottom of that box (scrolled into view when
it first appears; clicking it collapses the section), a warning-coloured reload icon right of the
section title (**Revert**, `onRevertSettings`), and marks the edited labels with a "*" (`modifiedSettings` → `ModifiedFieldsProvider` →
`useIsFieldModified` / `RangeSlider`·`ToggleField` `modified`). There is no header Reset button.

```
utils/generationSignature.ts   per-type whitelist of generation inputs → stable string (null = cannot regenerate)
  captureGenerationSignature   written as config.generatedSignature in the SAME store write as the result:
                                 soundscapeStore generate merge · AcousticsSection pyroom completion ·
                                 analysisStore text result / scenario result · serializer restore (baseline)
  isGenerationDirty            live config vs snapshot → Card settingsDirty
  getModifiedGenerationFields  edited keys (`duration`, `settings.max_order`, `materials`, `prompt`…) → "*" marks
  getGenerationRevertPatch     snapshot values of the differing fields → "Revert" (sounds:
                                 soundscapeStore.revertGenerationSettings; text also re-syncs areaDrawingStore)
Regenerate actions             sounds → soundscapeStore.handleRegenerateConfig (handleGenerateInternal force:
                                 same event ids, stale variants dropped) · pyroom → runSimulation ·
                                 text → analysisStore.handleRegenerateText · scenario → handleScenarioAnalyze
Read-only (no signature)       upload, sample-audio, import-irs, audio & model analysis, freeform, listeners
```

The snapshot is transient (never sent to the backend). Simulation material edits on a completed card
no longer reset it — the assignments are part of the signature, so they surface Regenerate instead.

### Analysis Card Index Links

Context/usage cards are addressed by array index, so inserting or removing one shifts every
later card. `analysisStore.handleRemoveConfig` / `duplicateConfigAt` build an `IndexMapper`
(`utils/cardIndexRemap.ts`: old index → new index, `null` = removed) and pass every link through it:

```
analysisStore (own state)   parentContextOriginalIndex, drawnArea.cardIndex, analysisResults[].configIndex,
                            activeAnalysisTab, uploading/rehydrating sets, analyzingConfigIndex
store/cardIndexLinks.ts     soundscapeStore parentUsageOriginalIndex (incl. -(contextIndex + 1) namespace),
  remapLinkedCardIndices    uiStore.activeSoundParentIndex, cardFlowStore (active indices, advance sets/maps),
                            areaDrawingStore, analysisPreviewStore, sceneWorkflowStore.remapUsageIndices
```

Any new state keyed by an analysis card index must be added to `remapLinkedCardIndices`.

### Speckle Integration Architecture

```
┌────────────────────────────────────────────────────────────┐
│ SpeckleViewerContext (viewer instance)                      │
│   ↓                                                         │
│ SpeckleScene.tsx (viewer mount, extensions setup)           │
│   ├── useSpeckleTree         → Object tree navigation      │
│   ├── useSpeckleFiltering    → Object visibility filtering │
│   ├── useSpeckleInteractions → Click/hover handling        │
│   └── useSpeckleSurfaceMaterials → Material assignment     │
│   ↓                                                         │
│ Three.js Bridge (speckle-scene-adapter.ts)                 │
│   ├── speckle-camera-controller.ts  → Camera sync          │
│   ├── speckle-drag-handler.ts       → Drag interactions    │
│   ├── speckle-event-bridge.ts       → Event forwarding     │
│   ├── speckle-audio-coordinator.ts  → Audio source sync    │
│   ├── sound-sphere-manager.ts       → Sound visualization  │
│   └── receiver-manager.ts           → Receiver management  │
└────────────────────────────────────────────────────────────┘
```

### Model Versions & Update Impact

Architects iterate the model in their CAD tool and come back to the web app. The
viewer always loads the **latest** version; the user may view an older one for
the session. Results tied to geometry (simulations) remember the version they ran
on and are flagged only when the acoustic region changed **above tolerance**.

```
Bottom bar ModelPill (file name + vN tag)        components/scene/model-version/
  ├─ hover card  → file / Speckle name, version N of M, author, time
  └─ ModelVersionMenu
       ├─ versions  GET /api/speckle/models/{id}/versions   (speckle_version_service.py:
       │            bundle + legacy copy collapsed, file names from ingestion history)
       │     click → modelVersionStore.switchToVersion → SpeckleScene model URL
       │             `models/<id>@<version>` (pinned) or latest + reload nonce → in-place reload
       ├─ Upload new version… → POST /api/upload {file, model_id} → load latest in place
       └─ Open another model… → SpeckleModelModal (autosave flushed first)

useModelVersionSession (page)  — resets the store per model, reports each loaded
  version, polls /latest → ModelVersionBanner ("vN was loaded … / vN was published")
soundscape.json `version_id` = the LOADED version → open-time banner compares with it
  "vN was loaded" shows only the first time this browser opens vN
  (localStorage `compas-seen-model-versions`, per model)

Impact  POST /api/speckle/version-impact  (model_version_impact_service.py)
  per-version object stats cached in process; objects matched by applicationId,
  identical hash = unchanged, else centroid / extents / area / planar normal vs
  tolerance (5 cm · 1° · 2 % by default) → changed | below_tolerance | added | removed,
  region totals, listener / free-sound placement (outside the room, inside a solid)
  ├─ ModelVersionReviewPanel  — region changes with material dropdowns (grouped by layer,
  │                              else change type, above 10 rows; "Assign" switches to
  │                              Acoustics and expands a simulation card when materials are
  │                              not editable yet), outdated simulations (Re-run), sounds
  │                              followed / lost (Re-link, Keep free), misplaced listeners
  │                              (Locate). Impact rows open their card: a sound activates
  │                              its scene (syncExpertNavigation) then expands the card.
  └─ SimulationOutdatedNotice — completed card: `simulatedVersionId` → loaded version,
                                 card region; outdated = still playable, with warning
```

Undo / redo: version switches and impact reports are navigation / derived state
(`modelVersionStore` is not undoable). The geometry reconciliation that follows a
load (linked sounds follow moved objects, drop deleted ones) is replayed onto the
recorded history per entity (`store/geometryReconciliationUndo.ts`), so Ctrl+Z /
Ctrl+Y never restore links or positions of the previous geometry while undoing a
link creation still removes it. `simulatedVersionId` is a run-written (live-only)
field like the other results.

### Viewport Render Styles

```
SceneBottomBar → SceneRenderStyleButton (dropdown: Rendered · Ghosted · Arctic · Wireframe)
  → uiStore.renderStyle (persisted in compas-ui-state)
  → useSpeckleRenderStyle (SpeckleScene, declared BEFORE useSpeckleDarkMode)
      effective = viewMode === 'dark' ? 'rendered' : renderStyle
  → lib/three/speckle-render-style.ts  applyRenderStyle(viewer, style)
      renderer.pipeline = DefaultPipeline | ArcticViewPipeline (stock)
                        | GhostedViewPipeline | WireframeViewPipeline (speckle-render-pipelines.ts)
```

- Ghosted / Wireframe use a pass's `overrideBatchMaterial`. Each frame, it swaps only the mesh batches'
  *base* material.
- Filter-colored surfaces (Acoustics materials, linked objects) are restyled per frame by
  `FilterMaterialStyler` (`speckle-filter-material-styler.ts`). It patches them in
  `onBeforePipelineRender` (translucent / wireframe, keeping their color) and restores them in
  `onAfterPipelineRender`. Selection (stencil) and hidden/ghost materials are untouched,
  so no enforcement loop is needed. Arctic keeps filter colors solid.
- Hover never swaps the hovered object's material (Speckle's hover does, and a swapped material
  escapes every render style). `HoverOutline` (`speckle-hover-outline.ts`, driven by the
  `applyHover` patch in `useSpeckleViewerInit`) copies the render view's triangles out of its
  batch into an OVERLAY-layer mesh and draws a screen-space border with a stencil dilation
  (mask → silhouette shifted in 8 directions → unmask). Plain mesh batches only; instanced
  batches get no hover border.- The Sounds view (dark mode) always runs on the stock pipeline, because it hooks the current pipeline's
  GEOMETRY passes when it enables. That is why the render-style hook must run first.
- We set `renderer.pipeline` directly instead of using Speckle's `ViewModes` extension. That
  extension caches its mode and would ignore "back to DEFAULT" after one of our custom pipelines.

### Audio Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ AudioOrchestrator (main entry point)                        │
│   ↓                                                         │
│ Mode Selection (mode-selector.ts)                           │
│   ├── AnechoicMode        → Direct audio, no reverb        │
│   ├── ResonanceMode       → Google Resonance Audio          │
│   └── AmbisonicIRMode     → Ambisonic IR convolution        │
│   ↓                                                         │
│ Binaural Decoders                                           │
│   ├── BinauralDecoder.ts         → IRCAM HRTF decoder      │
│   ├── OmnitoneFOADecoder.ts      → Omnitone FOA decoder    │
│   └── VirtualSpeakersDecoder.ts  → Virtual speaker layout   │
│   ↓                                                         │
│ Playback Scheduling (playback-scheduler-service.ts)         │
│   ↓                                                         │
│ Stereo Output (L/R) for headphones                          │
└─────────────────────────────────────────────────────────────┘
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
│ Binaural Decoder (HRTF-based)                              │
│   • Proper HRTF convolution per ambisonic channel          │
│   • Accurate spatial localization                          │
│   ↓                                                         │
│ Limiter (safety) → Stereo Output (L/R)                     │
└─────────────────────────────────────────────────────────────┘
```

### Multichannel Ambisonic Send (Dante → Holophonix / DAW)

Streams the active mode's **pre-decoder** bus live as (order+1)² discrete ACN/SN3D (AmbiX)
channels — third order / 16 ch by default, first order / 4 ch for small devices — to a chosen output device — typically Dante Virtual Soundcard, routed in Dante
Controller to a Holophonix processor (decodes to the loudspeaker dome) and optionally to a DAW
recorder (Reaper) that only listens. Frontend-only (Chrome/Edge). Needs ONE output device with
≥ (order+1)² channels: DVS on macOS works; DVS on Windows (WDM) only exposes stereo pairs, so
Windows uses the **local ASIO bridge** instead: `BridgeSendTransport` (AudioWorklet
`public/assets/worklets/ambisonic-capture-processor.js` → `ws://127.0.0.1:8765`) →
`scripts/ambisonic_bridge/ambisonic_bridge.py` (drift-compensating buffer → ASIO: DVS, or ReaRoute
into Reaper). The send picker probes channel counts (`lib/audio/output/probe-output-channels.ts`).

```
Mode pre-decoder bus (SN3D, before masterGain)          ── IAudioMode.getAmbisonicSendTap()
  Anechoic: ambisonicMixBus (world frame)
  AmbisonicIR: irMixBus (receiver frame)
  Resonance: scene.ambisonicOutput (already listener-rotated)
        ▼
AmbisonicSendBus: tapGain (80 ms crossfade on graph rebuild) → HOARotator(3) → sum
        │   rotation: R (rotate with listener) / identity / transpose(R) for pre-rotated taps
        ▼
outGain (= BottomBar master volume) → ctx.destination (16 ch, explicit, discrete)
        ▼
setSinkId override on the orchestrator context only → DVS TX 1–16 → Dante → Holophonix
                                                                     └→ DVS RX 1–16 → Reaper
```

- While on, `limiter → meter → destination` is cut (one sink per context): no browser binaural.
- Previews / modal impacts keep the regular output device (`setOutputDeviceOverride`).
- The device must expose ≥ 16 channels (`destination.maxChannelCount`), else the send refuses
  with an error. Lower-order modes are zero-padded, so the 16-ch patch never changes.
- State: `audioControlsStore.ambisonicSend*` (device + rotate persisted, enabled session-only),
  applied by `hooks/useAmbisonicSendSync.ts`; UI `components/audio/AmbisonicSendControls.tsx`
  (Settings → Rendering). Setup guide: `docs/dante-ambisonic-send.md`.

### Global Background Sounds (non-spatial beds)

Each background card has a **Global** switch beside its "Background" badge
(`SoundGenerationConfig.global_playback`, unset = `GLOBAL_SOURCE.DEFAULT_ENABLED` = on; persisted
in `soundscape.json` as `global_playback`). A global card plays without direction or distance
attenuation, still through the room, and its sound sphere (label, dark-mode light) is hidden.

```
useSpeckleAudioSync: per event → card (utils/sound-card-match.ts) → isConfigGlobal(config)
  ├─ orchestrator.setSourceGlobal(id, …)   (globalSources survive mode switches / re-creates)
  │    Anechoic:    encoder W = OMNI_LEVEL_GAIN[order], directional ch = 0, distance gain 1
  │    AmbisonicIR: convolver gets the IR's W channel × OMNI_LEVEL_GAIN (reverb, no direction);
  │                 peak / L2 / normalization still measured on the original IR
  │    Resonance:   source pinned to the listener, setSourceWidth(360) (Resonance's own compensation)
  └─ soundSphereManager.setHiddenSounds(globalIds)  (picking / box-select skip invisible meshes)
SoundscapeExporter mirrors it via config.globalSoundIds (= orchestrator.isSourceGlobal per track)
```

- **Levels:** W-only decodes quieter than a point source. `GLOBAL_SOURCE.OMNI_LEVEL_GAIN`
  (FOA 1.297 / SOA 1.992 / TOA 2.033, measured on Omnitone's built-in HRIRs) makes a global
  source as loud as the same sound at the 1 m reference distance, averaged over directions.
- **Positions are never touched.** Hidden spheres keep their stored position (in AMBISONIC_IR it
  still picks which simulation IR convolves the bed), so switching a card off re-spatializes it
  and shows its sphere exactly where it was.
- The bus stays ACN/SN3D, so the multichannel send carries global beds as an omni component.

### Low-Output Helper Hints

When scene playback is too quiet, a popover above the bottom-bar play button explains why and
offers a one-click fix.

```
limiter → OutputLevelMeter (inline AnalyserNode) → destination
            │  averaged RMS dBFS
            ▼
AudioOrchestrator.getOutputDiagnostics()   ← per playing source: post-fader level,
            │                                 engine mute, listener distance (6DOF modes),
            │                                 IR status / broadband gain (AmbisonicIRMode)
            ▼
useLowOutputHints (polls every 250 ms while playing; output < −42 dBFS for 2 s)
            ▼
diagnoseLowOutput()  — first matching rule wins:
  browser suspended → master volume → all muted/soloed out → quiet tracks →
  sounds outside simulated positions (zero IR) → low-energy IRs → camera too far → generic
            ▼
LowOutputHintPopover (SceneBottomBar playback group): Enable audio / Turn up /
  Unmute all / Open timeline / Normalize IRs / Move closer, or dismiss for the session
```

Files: `lib/audio/utils/output-level-meter.ts`, `lib/audio/utils/low-output-diagnosis.ts`,
`hooks/useLowOutputHints.ts`, `components/scene/LowOutputHintPopover.tsx`. Thresholds live in
`utils/constants.ts` → `LOW_OUTPUT_HINT`. Master volume lives in
`audioControlsStore.masterVolume` (session-only) so hints can raise it; `SceneVolumeButton`
mirrors it onto the orchestrator.

### In-App Bug Reports

A bug icon opens a "Report a problem" popover with a category, a description, an optional
screenshot, and an "anonymous" toggle (off by default); the diagnostics snapshot is always sent. In Detailed mode the icon sits at the far left
of the bottom bar. In Simple mode it floats above the bar's left end and rises with the docked
DAW. `useBubbleColumnSpace` shortens the Soundscapes column so the two never overlap.

```
diagnosticsBuffer (installed on mount)  ← console.error/warn, window error/unhandledrejection,
            │                              non-OK responses from fetchWithErrorHandling
            ▼
useBugReport.submit()
  ├─ collectBugReportContext()  URL, model_id, UI mode, browser, viewport, app version
  │                             + notifications, in-flight jobs, logs, failed requests
  ├─ html-to-image toJpeg(body)  (popover excluded via data-bug-report-ignore)
  ▼
apiService.submitBugReport → POST /api/bug-reports (routers/bug_reports.py)
            ▼
BugReportService.save (asyncio.to_thread): validate, decode screenshot,
  data/bug_reports/<id>/screenshot.{png,jpg} + app.db `bug_reports` row
  (identity from request.state unless `anonymous`, backend git commit added to the context)
```

There is deliberately no listing endpoint. To read reports on the server, run
`python scripts/list_bug_reports.py [-n N] [--status open] [--full]` from `backend/`.

Files:
- Frontend: `components/scene/BugReportButton.tsx`, `components/ui/BugReportPanel.tsx`,
  `hooks/useBugReport.ts`, `lib/diagnostics/*`, `types/bugReport.ts`.
- Backend: `routers/bug_reports.py`, `services/bug_report_service.py`.
- Constants: `BUG_REPORT` (frontend) and `BUG_REPORT_*` (backend).

### Research-Study Interaction Logging

Off by default. With env `STUDY_LOGGING_ENABLED=1`, the app records a per-participant,
append-only interaction log for design-studio research: what students listened to and from
where, what they edited before and after listening, how they used the AI features, their
design-intent answers per model version and the "moments" they bookmark. With the switch
off, every `/api/study` route returns 404, the frontend registers no listener or
subscription, and the UI is unchanged. Per-feature env switches (`STUDY_FEATURE_*`:
snapshots, state_diff, pose_sampling, audio_archive, server_job_events, moment_screenshot)
are kill switches that need only a backend restart.

```
GET /api/study/config ──► studyLogger.init (enabled? pseudonym, features)
                              │
useStudyLogging (page.tsx) ───┤ field-level store subscriptions:
                              │   audioControls play state / previewingSoundId ─► listeningTracker
                              │   render mode, IR, active simulation, UI mode, model / version
                              │ undo registry addUndoStepListener ─► editTracker ─► stateDiff (idle)
                              │ PerformanceObserver longtask ─► perf.longtask
explicit logStudyEvent calls ─┤ analysisStore (LLM jobs, prompts, accept/reject), soundscapeStore
                              │ (gen.request/result, variants, library), AcousticsSection (sim.*),
                              │ sceneWorkflowStore (Simple mode), page.tsx (model import / version upload)
                              ▼
queue (sanitised plain JSON) ─► POST /api/study/events every 5 s (sendBeacon on pagehide)
snapshot.ts (fingerprint → idle build) ─► POST /api/study/snapshots (deduplicated by hash)
Moment tab (bug button, key B) ─► POST /api/study/moments (+ /note)
                              ▼
routers/study.py → study_service → study_log_store (data/study/study_log.db, WAL, own lock)
                 └─ audio_refs → study_audio_archive → data/study/audio/<ws>/...
job_store.enqueue / io_jobs → study_server_events (job.*, identity via request ContextVar)
scripts/export_study_logs.py → per-group events.jsonl/csv, listening_sessions.csv,
                               intent_notes.csv, moments, snapshots, audio (pseudonymised)
```

Key rules:
- `lib/study/studyLogger.ts` never imports `@/store`: stores import the logger, and the
  barrel registers temporal stores at module init. Store reads live in
  `lib/study/storeReaders.ts`, which only hooks and components import.
- `logStudyEvent` never throws and clones payloads to plain JSON at enqueue time, so it
  keeps no references to buffers or store objects. Call sites pass primitives.
- Listening sessions: `listen.start` is logged once the design snapshot hash resolves (on
  idle). The real click time is `payload.started_at`, and the export uses it.
- The undo registry is only observed: listeners queue references, and diffs run on idle.
- A version upload shows the shared model-loading overlay. `DesignIntentPrompt` (study
  store `pendingIntentPrompt`) stays up after loading until the student submits or skips.

Files:
- Frontend: `lib/study/*`, `hooks/useStudyLogging.ts`, `hooks/useMomentCapture.ts`,
  `store/studyStore.ts`, `components/scene/DesignIntentPrompt.tsx`,
  `components/ui/{FeedbackPanel,MomentPanel,ChipToggleGroup}.tsx`, `types/study.ts`.
- Backend: `routers/study.py`, `services/study_*.py`, `utils/{study_sanitize,request_context}.py`,
  `scripts/export_study_logs.py`, `scripts/smoke_study_log.py`.
- Constants: `STUDY_LOG` (frontend) and `STUDY_*` (backend). Operations: `deploy/PRODUCTION.md`.

### Viewer Right-Click Menu

Right-click selects what is under the cursor (like a left click) and opens a command menu on it.
There is no hover tooltip.

```
useSceneContextMenu (contextmenu on the viewer container; ignored after a right-drag / in FPS)
  └─▶ SpeckleEventBridge.selectForContextMenu(x, y) → ContextMenuHit
        (guards against Speckle's own right-button ObjectClicked undoing the selection)
SceneContextMenu → ui/ActionMenu (icon rows, key chips, separators)
  model object : Hide (Shift+H) · Isolate · Reveal in explorer · Fit to view · Copy application ID
  sound sphere : Mute · Solo · Reveal in sidebar · Fit to view · Copy sound ID
  listener     : Listen from here · Reveal in sidebar · Fit to view · Copy listener ID
  all          : ── · Clear selection (Esc)
```

Model-object actions are plain functions in `lib/three/speckle-selection-actions.ts`, shared with
the Shift+H shortcut. Grid listener points get no menu.

### Keyboard Shortcuts

One global listener routes keys. The components that own each action publish it to a small
registry, because the transport and the card previews live deep inside components.

```
SpeckleScene ──useSceneShortcutTargets──▶ registry 'timeline' (play/pause/stop/rewind), 'viewer' (frame)
SoundGenerationSection ──useSoundCardShortcutTargets──▶ 'cardPreview' (expanded card's audio),
                                                       'soundCards' (step/collapse/remove/zoom)
                                  │   lib/shortcuts/shortcut-targets.ts (module state, no renders)
                                  ▼
useGlobalShortcuts (page.tsx, window keydown)
  Space        → cardPreview if playable, else timeline   (resolvePlaybackTarget)
  Shift+Space  → stop · Home → rewind · M → mute · F → frame · ? → shortcuts popover
  Alt+↑/↓      → step cards · Delete → remove expanded card
  Shift+H      → hide selected model objects (lib/three/speckle-selection-actions.ts)
  Esc (deferred a tick, skipped if a local handler preventDefault'ed or a dialog is open)
               → stop preview → collapse card → clear 3D selection
```

- **Skips:** text fields (`isTypingTarget`), open modals (`[aria-modal="true"]`), and
  Ctrl/Cmd combos. Space also skips buttons reached with Tab (focus source tracked by pointerdown / Tab). A clicked button is blurred so Space plays audio instead of clicking it again.
- **Ctrl/Cmd+Enter** is handled per card in `ui/Card.tsx`: from any text field inside an
  expanded card it calls `onRun`, but only while the Generate button is clickable. Undo/redo
  stays in `useUndoRedo`.
- **Definitions** (keys, label, hint, group) live in `utils/constants.ts` →
  `KEYBOARD_SHORTCUTS`. They drive the handler docs, the `ShortcutTooltip` hover cards and
  the grouped `SceneShortcutsButton` popover.
- **Tooltips:** `BarButton`, `CardButton`, `GenerateButton` and `WaveSurferPlayer` take an
  optional `shortcut` (or `showShortcuts`) prop. It swaps the native `title` for the tooltip
  and sets `aria-keyshortcuts`.

### Pyroomacoustics Ray-Count Estimate

The "Rays" slider in `PyroomAcousticsSimulationSettings.tsx` shows a single `rec` tick marker and a
tooltip ("Recommended ≈ N (V m³ acoustic layer bbox)") computed by
`frontend/src/lib/acoustics/ray-count-estimate.ts` from the bounding box of the **acoustic region**
(`useAcousticLayerStore.selectedAcousticGeometryIds`, unioned via `lib/three/speckle-object-bounds.ts`).
Falls back to the whole-model box (Speckle `World.worldBox`, then `useFileUploadStore.geometryBounds`)
when no region is resolved or the region is the whole model.

Criterion: Vorländer's receiver-sphere bound `N ≥ (4.34/ΔL)² · V / (π r² c Δt)` with ΔL = 1 dB,
r = 0.5 m, Δt = 4 ms (pyroomacoustics defaults); independent of the Image-Source order. Full
derivation, pyroomacoustics specifics and references are in the header comment of
`ray-count-estimate.ts`. Marker ticks are inset by `--slider-thumb-size` to align with the thumb.

### Load-Test Identity (Cloudflare service token)

`scripts/loadtest/` simulates N concurrent users against a deployment behind Cloudflare Access.
A Cloudflare **service token** gets past the edge, but its JWT has `common_name` and no `email`.
When that client id is listed in `LOADTEST_SERVICE_TOKEN_IDS` (off by default),
`access_service.extract_loadtest_email()` maps the `X-Loadtest-User: vu-NN` header to
`loadtest-vu-nn@loadtest.local`. `middleware/session.py` then resolves it like any real email
(user → default workspace → session), so each virtual user exercises the real identity path. The
mapping requires a verified JWT from an allowlisted token, so it can't be used to forge an identity.
Setup and usage: `scripts/loadtest/README.md`.

### Shared Workspaces — Owner-Only Saving

Roles are **owner** and **viewer** only. The legacy `editor` role is migrated to viewer in
`metadata_store._migrate()`. Only the owner's changes are saved: `save`, `upload-audio` and
`DELETE /{model_id}` in `routers/soundscape.py` require `ROLE_OWNER`. Viewers can still edit
locally. The frontend gates this with `selectIsReadOnlyWorkspace` (`workspaceStore.ts`):

- The `page.tsx` autosave and manual save both return early for viewers.
- `SceneBottomBar` shows the Save button disabled, with a "View only" hint.
- Settings → History disables Autosave and Delete history for viewers.

The owner always autosaves, even while others are present, because viewers never write.
On Home (no `model_id`), `workspaceStore.init({ preferOwn: true })` moves the session back to the
user's own workspace, so the owner/viewer split only applies once a shared model is open.
`workspaces.owner_hash` is the source of truth: `_migrate()` repairs any owner whose membership row
was demoted.
Any member can copy a view-only model invite link (`POST /invites` allows owner + viewer, and the
role is always viewer). Listing and revoking invites, the link-sharing mode, removing members and
"Make owner" (`/transfer`, where the old owner becomes a viewer) are owner-only. They live in
Settings → Workspaces (`CollaborationPanel`). The presence heartbeat returns the caller's `role`, so
a transfer is picked up within one heartbeat. If a model's soundscape belongs to someone else's
private workspace (`requires_invite`), the user stays on their own version.
`notifyPrivateWorkspaceModel()` (`utils/workspaceNotifications.ts`) shows a clickable notice that
opens Settings → Workspaces (`openAdvancedSettingsAt('workspaces')`).

### Public Share Links (read-only, embeddable)

A designer shares a model at `/share/<share_id>`. Anyone can open it without a Cloudflare Access
login and can only select and play. It also works inside an iframe.

**Designer side**
- Settings → Share is built by `ShareSettingsSection.tsx` and `ShareLinkBoard.tsx`.
- It picks scenes, simulations and listeners, and link groups made of at most one scene, one
  simulation and one listener.
- The link board has three columns. Click an item, then an item in another column, to connect
  them. The selection then clears, so the next two clicks make the next link. Clicking a
  connected pair again disconnects it, and a group left with fewer than two items is removed
  (`shareConfigStore.toggleConnection`). A connection joins a group of the first item that has
  no item of that kind yet, otherwise a new group starts. An item can therefore be in several
  groups, for example one scene with several listeners. Each link is drawn as a faint SVG curve
  (`utils/shareBoardGeometry.ts`) and listed under the board with a remove button. A scene →
  listener link with no simulation is drawn dashed, passing behind the opaque chips of the
  middle column.
- The selection lives in `shareConfigStore` and is saved by autosave as `soundscape.json` →
  `share_config`. Ids that no longer exist are pruned at save time (`pruneShareConfig`).
- Scenes get a stable `scene_id` from `utils/scene-id.ts`. It is installed on `analysisStore`
  and assigned outside undo history.
- The link itself is a `model_shares` row in `app.db`, holding one live share per workspace and
  model. It is managed by the owner-only `/api/speckle/soundscape/{model_id}/share` routes:
  create, regenerate and revoke (`routers/share.py`).

**Viewer side**
- `app/share/[shareId]/page.tsx` enters `shareViewStore`, then renders the normal `Home`.
- The bootstrap loads `GET /api/public/share/{id}`. That route is in the middleware's
  `_SKIP_PREFIXES`, so it runs with no identity and sets no cookie.
- `services/share_service.py` filters the saved soundscape:
  - Non-shared scenes and their sound configs become stubs (`share_hidden`), so index links
    stay valid.
  - Events, IRs and listeners are pruned to the shared items.
  - `auth_token` becomes the read-only `SPECKLE_SHARE_TOKEN`. The viewer loads geometry
    straight from Speckle in the browser, so whatever token it gets is readable by anyone with
    the link. The server `SPECKLE_TOKEN` can create projects, upload files and write versions,
    so it must never be sent.
  - Audio and IRs are served only through `/api/public/share/{id}/audio|ir/{file}`, which is
    allowlisted to the filtered payload.
  - `custom_materials` keeps only the custom materials a shared simulation assigns.
  - `/api/public/share/{id}/results/{run_id}` serves a shared run's results JSON (acoustic
    metrics), with its per-pair results pruned to the shared listeners.
    `/api/public/share/{id}/materials` serves the built-in absorption database, which colors the
    acoustic view. The frontend builds both URLs in `services/api.ts`
    (`simulationResultsJsonUrl`, `getPyroomacousticsMaterials`).
- In share view, `fetchWithErrorHandling` refuses any other backend call.
- The viewer init (`useSpeckleViewerInit`) is cancellation-safe. A share load runs it once,
  with no sandbox viewer and no `ensure-ready`.
- Simulation cards list their IRs from the restored mapping, not from the per-user IR library.
- The right-click menu and Object Explorer are available but read-only: no material or
  scattering edits, no Re-assign, no region-selection prompt, no auto-open.
- `useCanEdit()` hides every editing control: bottom-bar app, history, model and settings
  buttons, card add / delete / rename / run, card editors, DAW snap / drag / trim / menus, the
  3D gizmo, card FX (an active FX shows as a read-only badge), and the undo and delete shortcuts.
- `useShareLinkActivation` activates the rest of a link group when one item is activated:
  selecting a scene bubble, powering a simulation, or double-clicking a headphone. The first
  group is activated only once the model is loaded, so a linked listener really enters FPS.
  When the item is in several groups, a group the active items already match wins, otherwise
  the first one is used.
- Share view player behavior:
  - A circle click activates its item. An acoustics circle opens and powers its card. A
    listener circle toggles first-person view and never opens a card (hover menu only).
  - While in FPS, `FpsControlsHint` lists the controls above the bottom bar.
  - Opening a simulation card keeps the current view mode.
  - Waveforms only seek (no trim), and sounds or listeners never get the move gizmo.
- `next.config.ts` sets `frame-ancestors` from `SHARE_FRAME_ANCESTORS`. Deploy steps:
  `deploy/PRODUCTION.md` § Public share links.

### Simulation Mesh Preparation & Geometry Preflight

pyroomacoustics and PFFDTD never consume the raw Speckle mesh. Both go through
`SimulationMeshService.prepare()`. The pre-simulation **geometry check** (preflight) calls the
same function with the same inputs and shows its output, so **what the user inspects is exactly
what gets simulated**. The preparation is deterministic, using a fixed RNG seed.

```
Speckle layer ──simulation_geometry_loader──▶ vertices, faces, object face ranges, face materials
        │                                    (identical for the pyroom worker, the PFFDTD job, the preflight)
        ▼
SimulationMeshService.prepare(seeds = sources + receivers, MeshPrepSettings)
  1. drop faces without material (both engines, Speckle + Grasshopper)
  2. KD-tree weld · drop degenerate/sliver · dedupe   (NO non-manifold pruning)
  3. topology: components, closed/manifold, BFS winding, open-edge loops
  4. air_visibility: diffuse random walk from each seed → hits per face SIDE,
     seed inside/leaky/outside, leaks, reachable faces per seed, mean free path
  5. mesh_orientation (hierarchical):
       closed welded component  → whole-component vote, one-sided
       loose-face closed object → parity test (solid: normals in; air shell: normals out)
       open manifold component  → vote; two-sided if air clearly hits both sides
       non-manifold leftovers   → per-face vote; two-sidedness smoothed per object
  6. classes: outer shell / inside the room / skipped (probes; two-sided is a separate flag)
  7. air volume = mean free path × S / 4 (RT tail density)
  8. coplanar merge → simple polygon walls (pyroomacoustics only)
        │
        ├─ pyroomacoustics_worker → pyroomacoustics_room_builder.build_room (recentred, two_sided walls)
        ├─ pffdtd_job → pffdtd_scene_export.build_scene (triangles as-is, no merge)
        └─ simulation_preflight_worker → SimulationPreflightService.analyze → preflight_<id>.json
```

- **Endpoints:**
  - `POST /api/simulation/preflight-speckle` is a CPU job (variant `pyroomacoustics_preflight`).
  - `GET /api/simulation/preflight/{id}` returns the payload, scoped to the workspace.
  - The run endpoints of both engines accept the same `mesh_settings` JSON.
- **Frontend:**
  - `utils/simulationRequest.ts` builds the inputs for runs and the preflight, plus the staleness signature.
  - `store/simulationPreflightStore.ts` holds per-card results and the preview options.
  - `SimulationPreflightPanel` sits in the card setup.
  - `lib/three/simulation-mesh-preview.ts` and `useSpeckleSimulationPreflight` handle the 3D preview.
    While it is on, the Speckle model (`ContentGroup`) is hidden, so only the simulation mesh shows.
    Legend rows double as visibility checkboxes (`PREVIEW_CATEGORIES` in `simulation-mesh-colors.ts`).
  - Mesh settings live in `uiStore.simulationMeshSettings` (Advanced settings > Acoustics > Simulation geometry).
- **Run gating:** `AcousticsSection.runSimulation` reuses a preflight computed for identical inputs, or runs one first.
  - Errors stop the run and ask "Run anyway".
  - Warnings, or a preflight that fails to run, never block.
- **pyroomacoustics fork** (`../pyroomacoustics`, rebuild with `python setup.py build_ext --inplace`):
  - `Wall.two_sided`: the ISM reflects from both sides and never reflects twice in a row on the same wall.
  - The RT scatter lobe is mirrored into the side the ray arrived from.
  - `find_non_convex_walls` uses scale-aware hull planes and includes wall 0.
  - Two-sided surfaces fail loudly on a pra build without `two_sided`; there is no silent fallback.

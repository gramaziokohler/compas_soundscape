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
│   ├── models/
│   │   └── schemas.py               # Pydantic request/response models
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── choras.py                # Choras acoustic simulation integration
│   │   ├── generation.py            # LLM text/prompt generation endpoints
│   │   ├── impulse_responses.py     # IR upload/list/delete endpoints
│   │   ├── library_search.py        # Sound library search (BBC, Freesound)
│   │   ├── modal_analysis.py        # Modal analysis endpoints
│   │   ├── pyroomacoustics.py       # Pyroomacoustics acoustic simulation (ISM, RT60)
│   │   ├── reprocess.py             # Audio reprocessing (denoising)
│   │   ├── sed_analysis.py          # Sound Event Detection endpoints
│   │   ├── sounds.py                # Audio generation endpoints
│   │   └── upload.py                # File upload endpoints
│   ├── services/
│   │   ├── audio_service.py         # Multi-model audio generation (TangoFlux + AudioLDM2)
│   │   ├── audioldm2_service.py     # AudioLDM2 audio generation service
│   │   ├── bbc_service.py           # BBC Sound Effects API
│   │   ├── choras_openapi.json      # Choras API OpenAPI spec
│   │   ├── freesound_service.py     # Freesound API integration
│   │   ├── impulse_response_service.py  # IR processing & channel extraction
│   │   ├── llm_service.py           # Google Gemini LLM
│   │   ├── modal_analysis_service.py    # Modal analysis & mode shape visualization
│   │   ├── pyroomacoustics_service.py   # Pyroomacoustics simulation (ISM, RT60, EDT)
│   │   ├── sed_service.py           # Sound Event Detection
│   │   ├── speckle_demo.py          # Speckle demo/testing
│   │   └── speckle_service.py       # Speckle integration service
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── acoustic_measurement.py  # Acoustic measurement utilities
│   │   ├── audio_processing.py      # Audio manipulation utilities
│   │   ├── file_operations.py       # File I/O and cleanup
│   │   ├── helpers.py               # General helpers
│   │   └── sed_processing.py        # SED processing utilities
│   └── temp/                        # Parent temporary directory (all temp files)
│       ├── static/                  # Static files served via /static/
│       │   ├── sounds/
│       │   │   └── generated/       # Generated audio files
│       │   ├── impulse_responses/   # Uploaded IR files (1/2/4/16 channels)
│       │   └── pyroomacoustics_rir/ # Pyroomacoustics generated RIR files
│       ├── uploads/                 # Uploaded files staging area
│       ├── library_downloads/       # Downloaded library audio files
│       └── simulations/             # Choras/Pyroomacoustics simulation results
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
│       │   │       │   ├── ChorasSimulationSettings.tsx       # Choras settings UI
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
│       │   ├── useChoras.ts                 # Choras simulation state management
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
│       │   │   └── utils/                       # Audio utilities
│       │   │       ├── ambisonic-utils.ts       # Ambisonic encoding/decoding utilities
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
│       │       ├── speckle-drag-handler.ts      # Speckle drag interaction handler
│       │       ├── speckle-event-bridge.ts      # Speckle event bridge (click, hover)
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
│       │   ├── Choras.ts            # Choras simulation types
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
│    │                   │   │  choras.py        │   │                │
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
  │              ├── running bubble → SceneWorkflowDetail (live step detail, Stop/Resume)
  │              └── done bubble → select for DAW/3D + SoundGenerationSection panel
  └── <RightSidebar uiMode>  — same element tree in both modes (no remount):
        ├── AcousticsSection  presentation='section' | 'bubbles' (top-right column)
        └── ListenersSection  presentation='section' | 'bubbles' (bottom-right, grows upward)

sceneWorkflowStore (one run at a time, FIFO queue, keyed by scenario card index)
  analyze   → analysisStore.handleAnalyze(context)        (skipped/reused if analyzed)
  scenario  → analysisStore.handleScenarioAnalyze(usage)
  foley     → analysisStore.handleAnalyze(usage)          (foley + speech; ScenarioConfig.includeSpeech)
  generate  → page.handleSendAnalysisToGeneration (registered) → soundscapeStore.handleGenerateFiltered
  Composer reference image → ScenarioConfig.referenceImages → /api/scenarist `screenshots`
  (always), plus a fresh model-analysis card when a model is loaded and "Re-run model analysis" is on.
  Each step is idempotent (skipped when its result exists) → same runner powers Resume.
  Each step writes sidebarWizardStep / cardFlowStore + uiStore.sidebarNavCommand so a
  mounted expert Sidebar follows the pipeline live.

SpeckleScene
  └── SceneBottomBar (full width, both modes): home · undo/redo · save
        | transport (play/stop/time/timeline) | volume · view · explorer · shortcuts · notifications · settings
```

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

### Pyroomacoustics Ray-Count Estimate

The "Rays" slider in `PyroomAcousticsSimulationSettings.tsx` shows `min` / `rec` tick markers
computed by `frontend/src/lib/acoustics/ray-count-estimate.ts` from the model bounding box
(`useFileUploadStore.geometryBounds`, metres). With `V = xyz`, `S = 2(xy+yz+zx)`, `MFP = 4V/S`:

- **min** — Rindel (1995) eq. 1, `N ≥ 8π c² t² / A`, over the ISM window `t = m·MFP/c`
  (`m` = Image-Source order, so `N = 8π (m·MFP)² / A`; `A` = smallest resolved surface, 1 m²).
- **rec** — `max(min, K·V / (π r² c Δt))`: K = 100 receiver hits per histogram bin
  (r = 0.5 m, Δt = 4 ms, mirrored from the backend constants).

Both are rounded to the slider step and clamped to the 1,000–50,000 range. Constants live in
`utils/constants.ts` (`PYROOMACOUSTICS_RAY_TRACING_*`).

## TTS language → voice (Gemini 3.8)

Gemini 3.8 TTS reads the transcript verbatim and speaks the **language of the text**;
`speech_config.language` only biases accent and must be a **BCP-47 tag** (free text such as
"Swiss German" → HTTP 400). Dialect/accent comes from the **voice**. The UI language stays free text.

```
"Swiss German" ──► utils/language_resolver.resolve_language(text, dialects, custom_voices)
                     1. custom   user's prompted voice (SQLite custom_voices)      → custom voice id
                     2. library  exact voice-library accent ("Egyptian Arabic")     → regional voices
                     3. tag      Babel/CLDR name or tag ("Swiss German" → gsw);
                                 upgraded to library when native voices exist ("German" → de-DE)
                     4. unknown  → auto-detect, classic voices
                 ──► services/tts_voice_service.pick_voice(match, classic_voice)
                       same-gender regional voice (stable per character) | custom voice | classic voice
                 ──► tts_service.generate_speech(voice, language_code=<BCP-47 or None>)
```

- `services/tts_voice_catalog.py` — live Extended Voice Library (`client.voices.list`, ≈2 000 voices,
  50 accents) cached in Redis `tts:voice_catalog` for 24 h; nothing is hard-coded, stale cache beats empty.
- `routers/tts_voices.py` — `GET /api/tts/dialects`, `POST /api/tts/resolve-language`,
  `GET|POST /api/tts/custom-voices`, `DELETE /api/tts/custom-voices/{id}`. Creation is an IO job
  (`JOB_TYPE_TTS_VOICE`) that makes a female + male `prompted` voice (`voices.create`, ≈30 s each,
  expires after 1 year) and stores it per `user_hash` in SQLite `custom_voices`.
- `routers/tts.py` resolves once per job; character names are unchanged (only the Gemini voice id is
  swapped), so the character ↔ voice naming in `TTS_VOICE_CHARACTERS` / `TTS_CHARACTER_VOICES` is intact.
- Frontend: `components/ui/TtsLanguageInput.tsx` (settings) and `ScenePromptComposer` resolve on
  Enter/commit via `hooks/useTtsLanguageResolver.ts`; `TtsLanguageStatus` shows regional/custom badges or
  the "create a custom voice for this dialect?" prompt.
- The speech agent (`llm_service._build_speech_agent_prompts`) receives the display name and is told to
  write dialects as spoken; it may only use Gemini 3.8 angle-bracket vocal tags (`TTS_INLINE_VOCAL_TAGS`).

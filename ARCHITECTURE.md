# Architecture Overview

System architecture of [the repository](https://github.com/bouiz/compas_soundscape)

```
compas_soundscape/
├── backend/
│   ├── main.py                      # FastAPI app initialization (62 lines)
│   ├── tasks.py                     # Background tasks
│   ├── config/
│   │   ├── __init__.py
│   │   └── constants.py             # All backend constants
│   ├── data/
│   │   ├── AudioSet_classes.py      # AudioSet class definitions
│   │   ├── BBCSoundEffects.csv      # BBC sound effects database
│   │   └── [3D model samples]       # IFC, 3DM test files
│   ├── models/
│   │   └── schemas.py               # Pydantic request/response models
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── analysis.py              # 3D geometry analysis endpoints
│   │   ├── generation.py            # LLM text/prompt generation endpoints
│   │   ├── library_search.py        # Sound library search (BBC, Freesound)
│   │   ├── reprocess.py             # Audio reprocessing (denoising)
│   │   ├── sed_analysis.py          # Sound Event Detection endpoints
│   │   ├── sounds.py                # Audio generation endpoints
│   │   └── upload.py                # File upload endpoints
│   ├── services/
│   │   ├── audio_service.py         # TangoFlux audio generation
│   │   ├── bbc_service.py           # BBC Sound Effects API
│   │   ├── freesound_service.py     # Freesound API integration
│   │   ├── geometry_service.py      # 3D file processing (COMPAS, rhino3dm)
│   │   ├── llm_service.py           # Google Gemini LLM
│   │   └── sed_service.py           # Sound Event Detection
│   ├── utils/
│   │   ├── __init__.py
│   │   ├── audio_processing.py      # Audio manipulation utilities
│   │   ├── file_operations.py       # File I/O and cleanup
│   │   ├── helpers.py               # General helpers
│   │   └── sed_processing.py        # SED processing utilities
│   ├── static/
│   │   └── sounds/
│   │       └── generated/           # Generated audio files (served via /static/)
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
│       │   │   └── AudioTimeline.tsx         # Timeline visualization for scheduled sounds
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
│       │   ├── useReceivers.ts      # Audio receiver management
│       │   ├── useSED.ts            # Sound Event Detection
│       │   ├── useSoundGeneration.ts # Sound generation workflow
│       │   ├── useTextGeneration.ts # Text/prompt generation
│       │   ├── useTimelinePlayback.ts # Timeline playback state management
│       │   └── useWaveformInteraction.ts # Waveform zoom/pan interaction
│       ├── lib/
│       │   ├── audio/               # Audio processing utilities
│       │   │   ├── audio-info.ts           # Audio file loading & metadata
│       │   │   ├── waveform-utils.ts       # Waveform visualization (extraction & rendering)
│       │   │   ├── timeline-utils.ts       # Timeline data extraction from PlaybackSchedulerService
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling
│       │   │   └── auralization-service.ts      # Impulse response convolution (audio routing only)
│       │   ├── sound/               # Sound system utilities
│       │   ├── three/               # Three.js utilities (Service-Oriented Architecture)
│       │   │   ├── scene-coordinator.ts      # Scene init, camera, animation loop
│       │   │   ├── geometry-renderer.ts      # Geometry mesh rendering & highlighting
│       │   │   ├── sound-sphere-manager.ts   # Sound sphere creation & audio sources
│       │   │   ├── receiver-manager.ts          # Receiver cube management
│       │   │   ├── input-handler.ts             # User input (click, drag, keyboard)
│       │   │   ├── draggable-mesh-manager.ts    # Shared mesh update utilities (NEW)
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling (NEW)
│       │   │   ├── auralization-service.ts      # Impulse response convolution (audio routing only)
│       │   │   ├── sceneSetup.ts               # Scene setup helpers
│       │   │   ├── materials.ts                # Material definitions
│       │   │   └── mesh-cleanup.ts             # Resource disposal utilities
│       │   ├── audio-scheduler.ts   # Audio scheduling logic
│       │   ├── constants.ts         # Frontend constants (includes AUDIO_VISUALIZATION)
│       │   └── utils.ts             # General utilities
│       ├── services/
│       │   └── api.ts               # API client (all backend HTTP calls)
│       └── types/
│           ├── audio.ts             # Audio type definitions
│           ├── auralization.ts      # Auralization types
│           ├── components.ts        # Component prop types
│           ├── index.ts             # Type exports
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
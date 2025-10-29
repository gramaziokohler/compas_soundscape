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
│       │   ├── useReceivers.ts      # Audio receiver management
│       │   ├── useSED.ts            # Sound Event Detection
│       │   ├── useSoundGeneration.ts # Sound generation workflow
│       │   ├── useTextGeneration.ts # Text/prompt generation
│       │   ├── useTimelineMode.ts   # Timeline mode toggle (classic vs enhanced)
│       │   ├── useTimelinePlayback.ts # Timeline playback state management
│       │   └── useWaveformInteraction.ts # Waveform zoom/pan interaction
│       ├── lib/
│       │   ├── audio/               # Audio processing utilities
│       │   │   ├── audio-info.ts           # Audio file loading & metadata
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
│       │   │   ├── input-handler.ts             # User input (click, drag, keyboard)
│       │   │   ├── draggable-mesh-manager.ts    # Shared mesh update utilities (NEW)
│       │   │   ├── playback-scheduler-service.ts # Audio playback scheduling (NEW)
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
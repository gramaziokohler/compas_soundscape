# Architecture Overview

## System Architecture

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

## Data Flow

### File Upload Flow:

```
User Action
    │
    ▼
[page.tsx] useFileUpload hook
    │
    ▼
[services/api.ts] apiService.uploadFile()
    │
    │ HTTP POST /api/upload
    ▼
[routers/upload.py] upload_and_process_file()
    │
    ▼
[services/geometry_service.py] GeometryService.process_xxx_file()
    │
    ▼
[COMPAS/rhino3dm] Process geometry
    │
    ▼
Return {vertices, faces}
    │
    ▼
Update state in useFileUpload hook
    │
    ▼
Re-render components with new geometry
```

### Sound Generation Flow:

```
User Action (Generate Sounds)
    │
    ▼
[page.tsx] useSoundGeneration hook
    │
    ▼
[services/api.ts] apiService.generateSounds()
    │
    │ HTTP POST /api/generate-sounds
    ▼
[routers/sounds.py] generate_sounds()
    │
    ▼
[services/audio_service.py] AudioService.generate_multiple_sounds()
    │
    ├─▶ [services/audio_service.py] generate_sound_file()
    │       │
    │       ▼
    │   [TangoFlux] Generate audio
    │       │
    │       ▼
    │   Save to ./static/sounds/generated/
    │
    ▼
Return sound metadata with URLs
    │
    ▼
Update state in useSoundGeneration hook
    │
    ▼
[ThreeScene] Creates 3D spheres for sounds
    │
    ▼
[SoundUIOverlay] Displays playback controls
```

## Component Hierarchy (Frontend)

```
App (layout.tsx)
└── Home (page.tsx)
    ├── Sidebar
    │   ├── Header (Logo + Title)
    │   ├── Tabs (Text Gen / Sound Gen)
    │   │
    │   ├── ModelLoadSection
    │   │   ├── Upload Tab
    │   │   │   ├── Drag & Drop Zone
    │   │   │   └── Upload Button
    │   │   └── Sample Tab
    │   │       └── Load Sample Button
    │   │
    │   ├── TextGenerationSection
    │   │   ├── Prompt Textarea
    │   │   ├── Number of Sounds Slider
    │   │   ├── Generate Button
    │   │   └── Results Display
    │   │
    │   ├── SoundGenerationSection
    │   │   ├── Sound Config Tabs
    │   │   ├── Config Editor
    │   │   │   ├── Prompt Input
    │   │   │   ├── Duration Slider
    │   │   │   ├── Guidance Slider
    │   │   │   └── Seed Copies Slider
    │   │   ├── Generate Sounds Button
    │   │   └── Playback Controls
    │   │       ├── Play All
    │   │       ├── Pause All
    │   │       └── Stop All
    │   │
    │   └── ControlsInfo
    │       └── 3D Controls Help
    │
    └── ThreeScene (Main)
        ├── 3D Canvas (Three.js)
        │   ├── Geometry Mesh
        │   └── Sound Spheres
        │
        └── UI Overlays (2D)
            └── SoundUIOverlay (for each sound)
                ├── Sound Name
                ├── Variant Selector
                └── Play/Pause Button
```

## Service Responsibilities

### Frontend Services:

```
apiService (services/api.ts)
├── uploadFile()           → POST /api/upload
├── loadSampleIfc()        → GET /api/load-sample-ifc
├── analyze3dm()           → POST /api/analyze-3dm
├── analyzeIfc()           → GET /api/analyze-ifc
├── generateText()         → POST /api/generate-text
├── generateSounds()       → POST /api/generate-sounds
└── cleanupGeneratedSounds() → POST /api/cleanup-generated-sounds
```

### Backend Services:

```
GeometryService
├── create_sphere_geometry()
├── process_obj_file()
├── process_stl_file()
├── process_ifc_file()
├── process_3dm_file()
└── rhino_geom_to_mesh()

LLMService
├── select_diverse_entities()
├── generate_sound_prompt_for_entity()
└── generate_text_based_prompts()

AudioService
├── generate_sound_file()
├── generate_multiple_sounds()
├── get_random_position()
└── cleanup_generated_sounds()
```

## Key Design Patterns

### 1. **Single Responsibility Principle**
   - Each class/component has ONE reason to change
   - GeometryService only handles geometry
   - LLMService only handles LLM interactions
   - AudioService only handles audio generation

### 2. **Separation of Concerns**
   - **Presentation Layer**: React components (UI only)
   - **Business Logic**: Hooks and Services
   - **Data Layer**: API service and backend services

### 3. **Dependency Injection**
   - Services are injected into routes
   - Hooks are composed in main component
   - Easy to mock for testing

### 4. **API Layer Pattern**
   - All HTTP calls centralized in api.ts
   - Type-safe requests/responses
   - Easy to add interceptors/middleware

### 5. **Custom Hooks Pattern**
   - Reusable state logic
   - Composable in components
   - Testable independently

## Benefits

1. **Maintainability**:
   - Small, focused files
   - Easy to find code
   - Clear responsibilities

2. **Testability**:
   - Services can be unit tested
   - Components can be tested in isolation
   - Hooks can be tested with React Testing Library

3. **Scalability**:
   - Easy to add new features
   - New developers can navigate quickly
   - Services can be reused

4. **Type Safety**:
   - TypeScript interfaces in frontend
   - Pydantic models in backend
   - Catch errors at compile time

5. **Code Reuse**:
   - Services shared across endpoints
   - Hooks shared across components
   - Utils shared everywhere

## Migration Results

### Before Refactoring:
- **Frontend**: `page.tsx` - 1,519 lines (all logic in one file)
- **Backend**: `main.py` - 1,671 lines (all endpoints in one file)
- **Issues**: Hard to maintain, test, and extend

### After Refactoring:
- **Frontend**: `page.tsx` - 116 lines (orchestration only)
  - Logic moved to custom hooks (useFileUpload, useTextGeneration, useSoundGeneration, useAudioControls)
  - UI split into focused components (ModelLoadSection, TextGenerationSection, SoundGenerationSection, ControlsInfo)
  - API calls centralized in services/api.ts

- **Backend**: `main.py` - 62 lines (initialization only)
  - Logic moved to services (GeometryService, LLMService, AudioService)
  - Endpoints split into routers (upload, analysis, generation, sounds)
  - Request/response models in models/schemas.py

### Improvements:
- **92% reduction** in main file sizes
- **Better organization** with clear folder structure
- **Easier testing** with isolated components/services
- **Type safety** throughout the stack
- **Faster development** - easy to find and modify code

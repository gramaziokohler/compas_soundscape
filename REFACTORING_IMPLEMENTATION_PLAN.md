# Code Reorganization Implementation Plan

This document contains the complete reorganization plan split into manageable packets.
Each packet is designed to be self-contained and can be executed independently.

**Estimated Total Time**: 3-4 weeks
**Context Budget per Packet**: ~15,000-20,000 tokens

---

## CRITICAL: Testing & Validation Strategy

### After Every Packet:
1. **Syntax Check**: Verify no syntax errors in modified files
2. **Import Check**: Test that all imports resolve correctly
3. **Type Check**: Run TypeScript compiler (frontend) or Python import test (backend)
4. **Commit**: Create a git checkpoint after successful validation

### Testing Commands:

#### Frontend Testing:
```bash
# Type checking
cd frontend
npx tsc --noEmit

# Build test
npm run build

# Run dev server
npm run dev
```

#### Backend Testing:
```bash
# Import validation (from backend directory)
cd backend
python -c "from config.constants import LLM_MODEL_NAME; print('✓ Config OK')"
python -c "from utils.file_operations import sanitize_filename; print('✓ Utils OK')"

# Start server
python main.py
```

### Integration Testing (After PACKET 10):
- [ ] Load 3D model successfully
- [ ] Generate sound from text prompts
- [ ] Upload audio file
- [ ] Play sounds in 3D scene
- [ ] Place receivers
- [ ] Apply auralization

---

## PACKET 1: Frontend Types - Core Scene & Audio
**Priority**: CRITICAL
**Estimated Lines**: ~200
**Files Created**: 3

### Tasks:
1. Create `frontend/src/types/three-scene.ts`
   - Extract ThreeSceneProps interface (currently ThreeScene.tsx lines 29-55)
   - Add all prop interfaces for the scene component

2. Create `frontend/src/types/audio.ts`
   - Extract ScheduledSound interface (from audio-scheduler.ts)
   - Add WAVHeader interface (from useAuralization.ts)
   - Add ConvolverConfig interface

3. Create `frontend/src/types/auralization.ts`
   - Extract AuralizationConfig (from useAuralization.ts lines 6-11)
   - Add related audio processing types

### Files to Read:
- `frontend/src/components/scene/ThreeScene.tsx` (lines 1-100)
- `frontend/src/lib/audio/audio-scheduler.ts` (lines 1-50)
- `frontend/src/hooks/useAuralization.ts` (lines 1-130)

### Files to Update After Creation:
- Import new types in ThreeScene.tsx
- Import new types in audio-scheduler.ts
- Import new types in useAuralization.ts

---

## PACKET 2: Frontend Component Types
**Priority**: HIGH
**Estimated Lines**: ~150
**Files Created**: 1

### Tasks:
1. Create `frontend/src/types/components.ts`
   - Extract SidebarProps (from Sidebar.tsx)
   - Extract ModelLoadSectionProps
   - Extract SoundGenerationSectionProps
   - Extract TextGenerationSectionProps
   - Extract ControlsInfoProps

2. Expand existing `frontend/src/types/sed.ts`
   - Add SEDOptions interface (from useSED.ts lines 15-18)
   - Add UseSEDReturn interface

### Files to Read:
- `frontend/src/components/layout/Sidebar.tsx`
- `frontend/src/components/layout/sidebar/ModelLoadSection.tsx`
- `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`
- `frontend/src/components/layout/sidebar/TextGenerationSection.tsx`
- `frontend/src/hooks/useSED.ts`

### Files to Update:
- Update all component files to import from types/components.ts
- Update useSED.ts to use new types

---

## PACKET 3: Backend Constants
**Priority**: HIGH
**Estimated Lines**: ~80
**Files Created**: 2

### Tasks:
1. Create `backend/config/` directory
2. Create `backend/config/constants.py`
   - LLM Configuration (from llm_service.py)
   - Audio Processing constants (from utils/audio_processing.py)
   - SED Parameters (from utils/sed_processing.py)
   - BBC Search constants (from services/bbc_service.py)
   - Directory paths

3. Create `backend/config/__init__.py`

### Files to Read:
- `backend/services/llm_service.py`
- `backend/services/bbc_service.py`
- `backend/utils/sed_processing.py`

### Files to Update:
- `backend/services/llm_service.py` (import constants)
- `backend/services/bbc_service.py` (import constants)
- `backend/utils/sed_processing.py` (import constants)

---

## PACKET 4: Backend File Operations
**Priority**: HIGH
**Estimated Lines**: ~100
**Files Created**: 1

### Tasks:
1. Create `backend/utils/file_operations.py`
   - `sanitize_filename()` function
   - `handle_upload_file()` async context manager
   - `ensure_directory()` helper
   - `cleanup_temp_files()` helper

### Files to Read:
- `backend/routers/upload.py`
- `backend/routers/analysis.py`
- `backend/routers/sed_analysis.py`
- `backend/services/freesound_service.py`

### Files to Update:
- `backend/routers/upload.py` (replace duplicated code)
- `backend/routers/analysis.py` (replace duplicated code)
- `backend/routers/sed_analysis.py` (replace duplicated code)
- `backend/services/freesound_service.py` (replace duplicated code)

**Estimated Savings**: ~40 lines of duplicated code

---

## PACKET 5: Frontend Utilities Part 1 - Sound & Materials
**Priority**: HIGH
**Estimated Lines**: ~200
**Files Created**: 4

### Tasks:
1. Create `frontend/src/lib/sound/` directory

2. Create `frontend/src/lib/sound/positioning.ts`
   - Extract `calculateSoundPosition()` (from useSoundGeneration.ts)
   - Extract `calculateGeometryCenter()` helper

3. Create `frontend/src/lib/sound/event-factory.ts`
   - Extract `createSoundEvent()` (from useSoundGeneration.ts)
   - Extract `generateSoundId()` helper

4. Create `frontend/src/lib/sound/grouping.ts`
   - Extract `groupSoundsByPromptIndex()` (from ThreeScene.tsx)

5. Create `frontend/src/lib/three/materials.ts`
   - Extract material definitions (from ThreeScene.tsx lines 534-545, 640-651, 951-957)
   - Create MATERIALS constant object
   - Create COLORS constant object

### Files to Read:
- `frontend/src/hooks/useSoundGeneration.ts` (lines 100-300)
- `frontend/src/components/scene/ThreeScene.tsx` (lines 500-1000)

### Files to Update:
- `frontend/src/hooks/useSoundGeneration.ts`
- `frontend/src/components/scene/ThreeScene.tsx`

---

## PACKET 6: Frontend Utilities Part 2 - Cleanup & Audio
**Priority**: MEDIUM
**Estimated Lines**: ~180
**Files Created**: 2

### Tasks:
1. Create `frontend/src/lib/three/mesh-cleanup.ts`
   - Extract `disposeMesh()` (from ThreeScene.tsx)
   - Extract `disposeGroup()` helper
   - Extract `clearScene()` helper

2. Create `frontend/src/lib/audio/wav-parser.ts`
   - Extract `parseWAVHeader()` (from useAuralization.ts lines 17-127)
   - Extract WAV parsing helpers

### Files to Read:
- `frontend/src/components/scene/ThreeScene.tsx` (lines 588-604, 902-911, 1073-1077)
- `frontend/src/hooks/useAuralization.ts` (lines 17-127)

### Files to Update:
- `frontend/src/components/scene/ThreeScene.tsx`
- `frontend/src/hooks/useAuralization.ts`

---

## PACKET 7: ThreeScene Split - Core Services (CRITICAL)
**Priority**: CRITICAL
**Estimated Lines**: ~350
**Files Created**: 3

### Tasks:
1. Create `frontend/src/lib/three/` directory (if not exists)

2. Create `frontend/src/lib/three/scene-coordinator.ts`
   - Scene initialization logic
   - Camera setup
   - Renderer configuration
   - Resize handling
   - Animation loop coordination

3. Create `frontend/src/lib/three/geometry-renderer.ts`
   - Entity rendering logic (ThreeScene.tsx lines 480-685)
   - Highlight management
   - Mesh creation/updates
   - Geometry type handling

### Files to Read:
- `frontend/src/components/scene/ThreeScene.tsx` (lines 1-800)

### Dependencies:
- Requires PACKET 1 (types/three-scene.ts)
- Requires PACKET 5 (lib/three/materials.ts)

---

## PACKET 8: ThreeScene Split - Sound & Receiver Managers
**Priority**: CRITICAL
**Estimated Lines**: ~350
**Files Created**: 2

### Tasks:
1. Create `frontend/src/lib/three/sound-sphere-manager.ts`
   - Sound sphere creation (ThreeScene.tsx lines 860-1060)
   - Sphere updates/animations
   - Sound event visualization
   - Sphere removal/cleanup

2. Create `frontend/src/lib/three/receiver-manager.ts`
   - Receiver creation/placement (ThreeScene.tsx lines 1064-1166)
   - Receiver position updates
   - Visual representation
   - Receiver removal

### Files to Read:
- `frontend/src/components/scene/ThreeScene.tsx` (lines 800-1200)

### Dependencies:
- Requires PACKET 5 (lib/three/materials.ts)
- Requires PACKET 6 (lib/three/mesh-cleanup.ts)

---

## PACKET 9: ThreeScene Split - Audio & Input Services
**Priority**: CRITICAL
**Estimated Lines**: ~350
**Files Created**: 2

### Tasks:
1. Create `frontend/src/lib/audio/auralization-service.ts`
   - Sound scheduling (ThreeScene.tsx lines 1180-1406)
   - Impulse response application
   - Volume calculation based on distance
   - Audio context management

2. Create `frontend/src/lib/three/input-handler.ts`
   - Click handling
   - Drag operations
   - Raycasting logic
   - Mouse interaction management

### Files to Read:
- `frontend/src/components/scene/ThreeScene.tsx` (lines 1150-1517)

### Dependencies:
- Requires PACKET 1 (types/audio.ts, types/auralization.ts)

---

## PACKET 10: Refactor ThreeScene.tsx (CRITICAL)
**Priority**: CRITICAL
**Estimated Lines**: ~300 (from 1,517)
**Files Modified**: 1

### Tasks:
1. Refactor `frontend/src/components/scene/ThreeScene.tsx`
   - Import all service classes
   - Create service instances with useRef
   - Coordinate between services
   - Keep only orchestration logic
   - Remove all extracted code

### Dependencies:
- **MUST complete PACKETS 7, 8, 9 first**
- Requires all lib/three/* modules
- Requires all lib/audio/* modules

### Testing Required:
- Verify scene rendering
- Test sound sphere creation
- Test receiver placement
- Test entity highlighting
- Test audio playback
- Test drag interactions

---

## PACKET 11: Frontend Service Layer (Optional - Week 2)
**Priority**: HIGH
**Estimated Lines**: ~400
**Files Created**: 3

### Tasks:
1. Create `frontend/src/services/sound-generation-service.ts`
   - Extract API logic from useSoundGeneration.ts
   - Sound generation methods
   - Upload handling
   - Library download

2. Create `frontend/src/services/text-generation-service.ts`
   - Extract from useTextGeneration.ts
   - Prompt generation
   - Entity selection logic

3. Create `frontend/src/services/sed-service.ts`
   - Extract from useSED.ts
   - Audio analysis
   - Format conversion

### Files to Refactor:
- `frontend/src/hooks/useSoundGeneration.ts` (reduce to state management)
- `frontend/src/hooks/useTextGeneration.ts` (reduce to state management)
- `frontend/src/hooks/useSED.ts` (reduce to state management)

---

## PACKET 12: Backend Geometry Operations (Optional)
**Priority**: MEDIUM
**Estimated Lines**: ~100
**Files Modified**: 2

### Tasks:
1. Add to `backend/services/geometry_service.py`:
   - `extract_mesh_from_geometry()` method
   - `extract_vertices_and_faces()` method
   - Consolidate mesh extraction logic (8+ occurrences)

### Files to Update:
- `backend/services/geometry_service.py`
- `backend/routers/analysis.py`

---

## PACKET 13: Backend Logging Infrastructure (Optional)
**Priority**: MEDIUM
**Estimated Lines**: ~60 initial + 87 replacements
**Files Created**: 1
**Files Modified**: 12

### Tasks:
1. Create `backend/utils/logging_config.py`
   - Logger setup function
   - Error logging decorator
   - Standard formatters

2. Replace all `print()` statements:
   - 87 occurrences across 12 files
   - Use proper logging levels

### Files to Update (Contains print statements):
- All backend router files
- All backend service files

---

## PACKET 14: Split Large Components (Optional - Week 3)
**Priority**: MEDIUM
**Estimated Lines**: ~400
**Files Created**: 5

### Tasks:
1. Split `SoundGenerationSection.tsx` (540 → 250 lines):
   - Create `SoundConfigTabs.tsx`
   - Create `GlobalSoundSettings.tsx`
   - Create `IndividualSoundConfig.tsx`

2. Split `ModelLoadSection.tsx` (395 → 200 lines):
   - Create `ModelUploadForm.tsx`
   - Create `EntityAnalysisPanel.tsx`

---

## EXECUTION ORDER

### Week 1 - Foundation (Quick Wins)
Day 1-2: PACKET 1 → PACKET 2 (Types)
Day 3-4: PACKET 3 → PACKET 4 (Backend Utils)
Day 5: PACKET 5 (Frontend Utils Part 1)

### Week 2 - Major Refactoring
Day 1: PACKET 6 (Frontend Utils Part 2)
Day 2-3: PACKET 7 (Scene Core Services)
Day 4: PACKET 8 (Sound & Receiver Managers)
Day 5: PACKET 9 (Audio & Input Services)

### Week 3 - Integration & Testing
Day 1-2: PACKET 10 (Refactor ThreeScene.tsx) - **CRITICAL**
Day 3-4: Testing & bug fixes
Day 5: PACKET 11 (Service Layer - Optional)

### Week 4 - Polish (Optional)
PACKET 12, 13, 14 as needed

---

## SUCCESS METRICS

### Code Quality
- [ ] ThreeScene.tsx reduced from 1,517 to ~300 lines
- [ ] No file exceeds 400 lines
- [ ] Zero code duplication in file handling
- [ ] All constants centralized
- [ ] All types centralized

### Maintainability
- [ ] Each module has single responsibility
- [ ] Clear separation of concerns
- [ ] Service layer separates business logic from UI
- [ ] Easy to locate functionality

### Testing
- [ ] All existing functionality works
- [ ] No regressions in scene rendering
- [ ] Sound generation still works
- [ ] Entity interactions preserved

---

## NOTES

1. **Context Management**: Each packet is designed to fit within token budget
2. **Dependencies**: Some packets must be completed in order (see dependencies)
3. **Testing**: Test after each packet, especially PACKET 10
4. **Rollback**: Keep git commits clean - one commit per packet
5. **Documentation**: Update inline comments as you refactor

---

## QUICK REFERENCE

**Most Critical Packets** (Must Do):
- PACKET 1, 7, 8, 9, 10 (ThreeScene refactoring)

**High Value Packets** (Should Do):
- PACKET 3, 4, 5 (Backend & Frontend utils)

**Optional Packets** (Nice to Have):
- PACKET 11, 12, 13, 14 (Services & polish)

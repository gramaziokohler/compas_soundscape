# CHANGELOG

## [2025-11-18 21:30] - Cleaned Up Unused Timeline Constants

### Removed
- **Removed unused Timeline constants from `constants.ts`**
  - [frontend/src/lib/constants.ts](frontend/src/lib/constants.ts) - Cleaned up Timeline configuration
    - Removed `TIMELINE_DEFAULTS.UPDATE_INTERVAL_MS` (line 933) - never used in codebase
    - Removed all unused `AUDIO_TIMELINE` layout properties:
      - `MIN_HEIGHT`, `MAX_HEIGHT`, `DEFAULT_HEIGHT` - unused layout dimensions
      - `TRACK_HEIGHT`, `TRACK_SPACING` - unused track dimensions
      - `PADDING_TOP`, `PADDING_BOTTOM`, `PADDING_LEFT`, `PADDING_RIGHT` - unused padding values
      - `ITERATION_MIN_WIDTH`, `ITERATION_BORDER_RADIUS` - unused iteration styling
      - `CURSOR_WIDTH`, `CURSOR_COLOR` - unused cursor styling
    - **Kept only actively used properties:**
      - `TIMELINE_DEFAULTS.DURATION_MS` - used in [ThreeScene.tsx:251](frontend/src/components/scene/ThreeScene.tsx#L251)
      - `TIMELINE_LAYOUT.*` - all properties used in [ThreeScene.tsx:2087-2089](frontend/src/components/scene/ThreeScene.tsx#L2087-L2089)
      - `AUDIO_TIMELINE.DEFAULT_DURATION_MS` - used in [useTimelinePlayback.ts](frontend/src/hooks/useTimelinePlayback.ts) and [timeline-utils.ts](frontend/src/lib/audio/timeline-utils.ts)
      - `AUDIO_TIMELINE.MAX_ITERATIONS_TO_DISPLAY` - used in [timeline-utils.ts](frontend/src/lib/audio/timeline-utils.ts)
      - `AUDIO_TIMELINE.SOUND_COLORS` - used in [timeline-utils.ts](frontend/src/lib/audio/timeline-utils.ts)
      - `WAVESURFER_TIMELINE.*` - actively used in [WaveSurferTimeline.tsx](frontend/src/components/audio/WaveSurferTimeline.tsx)
  - **Result:** Reduced constant file size by removing ~20 unused properties, improved maintainability

## [2025-11-18 21:15] - Fixed Sound Position Update When Relinking to New Entity

### Fixed
- **Sound position now updates correctly when attaching to a new entity**
  - [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts) - Updated `handleAttachSoundToEntity` method (lines 634-650, 664)
    - Now calculates entity position from bounds.center or entity.position
    - Updates sound event's position to match new entity's position
    - Previously only updated entity_index, causing sound to play from old position
    - Now properly updates position in both soundscapeData and generatedSounds
  - **Issue:** When unlinking from entity A and linking to entity B, sound still played from entity A's position
  - **Fix:** Position is now updated to entity B's position when linking
  - **Result:** Sound plays from correct entity position after relinking

## [2025-11-18 21:00] - Inverse Workflow: Attach Sound to Entity from Sidebar

### Added
- **Sound attachment to entity now properly handles sphere destruction**
  - [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts) - Added `handleAttachSoundToEntity` method (lines 628-662)
    - Adds entity to sound config
    - Updates soundscapeData to add entity_index to sound events
    - Updates generatedSounds to keep state consistent
    - Ensures sound sphere is destroyed and overlay moves to entity
  - [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Updated `handleEntityLinked` to use new methods (lines 198, 215)
    - Uses `handleAttachSoundToEntity` when linking entity to sound
    - Uses `handleDetachSoundFromEntity` when unlinking via sidebar
    - Previously only updated config, not soundscape data
    - Now both config and actual sound events are updated in both directions

### Changed
- **Complete bidirectional linking workflow**
  - **From entity overlay (green link → pink):**
    - Detaches sound from entity
    - Creates sound sphere at entity position
    - Adds entity to diverse selection
  - **From sidebar (link icon → select entity):**
    - Destroys existing sound sphere (if any)
    - Moves sound overlay to selected entity
    - Adds entity to diverse selection
  - Both workflows now properly synchronize:
    - Sound configs
    - Soundscape data (entity_index)
    - Generated sounds
    - Entity highlighting
    - UI overlays (sphere ↔ entity)

## [2025-11-18 20:45] - Fixed Sound Detachment and Updated Impact Icon

### Fixed
- **Sound detachment from entity now works correctly**
  - [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts) - Added `handleDetachSoundFromEntity` method (lines 591-621)
    - Properly removes entity from sound config
    - Updates soundscapeData to remove entity_index from sound events
    - Updates generatedSounds to keep state consistent
    - Ensures sound sphere is created when entity is detached
  - [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Updated `handleDetachSound` to use new method (line 267)
    - Previously only updated config, not soundscape data
    - Now both config and actual sound events are updated
    - Sound overlay correctly disappears from entity
    - Sound sphere appears at entity's last position
    - Entity link button changes from green to pink as expected

### Changed
- **Impact Sound button icon updated**
  - [frontend/src/components/overlays/EntityInfoBox.tsx](frontend/src/components/overlays/EntityInfoBox.tsx) - Changed icon to lightning bolt (line 177-179)
    - Replaced flask icon with lightning/impact icon
    - Simplified tooltip to just "Impact sound" (line 155)
    - Better represents impact/collision concept

## [2025-11-18 20:30] - Entity Information Overlay Enhanced Link Button

### Added
- **Link button in entity information overlay with 3 visual states**
  - [frontend/src/components/overlays/EntityInfoBox.tsx](frontend/src/components/overlays/EntityInfoBox.tsx) - Added link button to title bar (lines 104-123)
    - Grey state: Entity is unlinked and not in diverse selection
    - Pink/Primary state: Entity is selected for diverse LLM prompts (not linked to sound)
    - Green state: Entity is linked to a sound source
    - Uses same link icon as sidebar sound generation tab
    - Positioned next to Impact Sound button in title bar
  - State priority: Green (linked) > Pink (diverse) > Grey (unlinked)

- **Toggle diverse entity selection from overlay**
  - [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Added `handleToggleDiverseSelection` handler (lines 239-250)
    - Clicking grey link button: Adds entity to `selectedDiverseEntities` (turns pink)
    - Clicking pink link button: Removes entity from `selectedDiverseEntities` (turns grey)
    - Updates entity highlighting in 3D scene

- **Detach sound from entity to create sound sphere**
  - [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Added `handleDetachSound` handler (lines 256-272)
    - Clicking green link button: Detaches sound from entity
    - Creates sound sphere at entity's position (handled by ThreeScene)
    - Adds entity to diverse selection (turns from green to pink)
    - Synchronizes with sound generation sidebar tab

### Changed
- **Compact Impact Sound button**
  - [frontend/src/components/overlays/EntityInfoBox.tsx](frontend/src/components/overlays/EntityInfoBox.tsx) - Redesigned Impact Sound button (lines 126-188)
    - Changed from large text button to small icon button (w-6 h-6)
    - Uses hammer/flask icon instead of emoji
    - Matches link button size for consistent UI
    - Maintains all functionality (analyze, ready, playing states)
    - Positioned in title bar next to link button

- **Entity overlay title layout**
  - [frontend/src/components/overlays/EntityInfoBox.tsx](frontend/src/components/overlays/EntityInfoBox.tsx) - Updated title section (lines 92-190)
    - Format: "Entity Information  [link]  [impact sound]"
    - Both buttons in title bar (right side)
    - Removed separate impact button section above title

- **Props and handlers wiring**
  - [frontend/src/types/three-scene.ts](frontend/src/types/three-scene.ts) - Added new callback props (lines 127-131)
    - `onToggleDiverseSelection?: (entity: EntityData) => void`
    - `onDetachSound?: (entity: EntityData) => void`
  - [frontend/src/components/scene/ThreeScene.tsx](frontend/src/components/scene/ThreeScene.tsx) - Wired new handlers (lines 111-112, 1982-1984, 1998-2000)
    - Destructured new props from ThreeSceneProps
    - Passed handlers to EntityInfoBox
    - Calculated `isDiverseSelected` state for each entity
  - [frontend/src/app/page.tsx](frontend/src/app/page.tsx) - Passed handlers to ThreeScene (lines 600-601)

## [2025-11-18 19:00] - Modal Analysis Timeout Protection

### Added
- **20-second timeout for modal analysis to prevent infinite loops on problematic meshes**
  - `backend/config/constants.py` - Added timeout constant (line 222)
    - `MODAL_ANALYSIS_TIMEOUT = 20.0` - Maximum execution time in seconds for mesh creation
    - Prevents backend from hanging indefinitely on meshes with complex self-intersections
  - `backend/services/modal_analysis_service.py` - Implemented timeout wrapper using multiprocessing (lines 47-84, 127, 334-401)
    - Added module-level `_run_mesh_creation_worker()` function for Windows compatibility (lines 47-84)
    - Added `_create_fe_mesh_with_timeout()` method that wraps mesh creation with process-based timeout
    - **Uses multiprocessing** (not threading) to run TetGen in a separate process that can be forcefully killed
    - Worker function must be at module level (not nested) for Windows pickling
    - If mesh creation exceeds 20 seconds, process is terminated and TimeoutError is raised
    - Calls `_create_fe_mesh_with_timeout()` instead of direct `_create_fe_mesh()` call
    - Uses **file-based IPC** (temporary pickle files) to pass results between processes
    - Mesh data is extracted and reconstructed using `Mesh.from_data()` since Mesh objects aren't picklable

  **Why multiprocessing (not threading):**
  - TetGen runs in native C code that **cannot be interrupted by Python threads**
  - Threading's `thread.join(timeout=X)` detects timeout but can't stop the C code
  - Multiprocessing creates a separate OS process that can be forcefully terminated
  - `process.terminate()` sends SIGTERM (graceful), `process.kill()` sends SIGKILL (forceful)

  **How it works:**
  1. Mesh creation runs in a separate process
  2. Main process waits up to 20 seconds using `process.join(timeout=20.0)`
  3. If process completes: Results retrieved from pickle file and returned
  4. If process still running after 20s:
     - Call `process.terminate()` to request graceful shutdown (wait 2s)
     - If still alive, call `process.kill()` to force kill (wait 1s)
     - Raise TimeoutError with user-friendly message
  5. Mesh data is passed via temporary pickle file (file-based IPC) and reconstructed using `Mesh.from_data()`

  **IPC Implementation:**
  - **File-based IPC** (not Queue): Uses temporary pickle files to pass mesh data between processes
  - Why not Queue: `multiprocessing.Queue.put()` blocks indefinitely on large numpy arrays (2000+ nodes)
  - Worker saves result to temp pickle file, main process reads after subprocess completes
  - Connectivity extracted using `conn = mesh.get_conn(mesh.descs[0])` (returns array, not tuple)
  - Connectivity kept in 2D format (n_elements × 4) as expected by SFepy's `Mesh.from_data()`

### Fixed
- **Connectivity extraction bug in worker process** ([modal_analysis_service.py:81](backend/services/modal_analysis_service.py#L81))
  - Fixed `ValueError: too many values to unpack (expected 2)` error
  - Changed from `conn, gel = mesh.get_conn(...)` to `conn = mesh.get_conn(...)`
  - SFepy's `get_conn()` returns just the connectivity array, not a tuple
- **Suppressed TetGen coincident point warnings** ([modal_analysis_service.py:533-536](backend/services/modal_analysis_service.py#L533-L536))
  - Added `contextlib.redirect_stdout/stderr` to suppress "Point #X is coincident with #Y. Ignored!" warnings
  - These warnings are harmless - TetGen automatically merges coincident vertices
  - Reduces console clutter while preserving actual error messages

  **Error message shown to users:**
  ```
  Mesh creation exceeded 20 second timeout. This indicates the mesh has severe
  self-intersecting geometry that causes TetGen to hang indefinitely. Even though
  validation passed, the mesh has complex overlapping faces that TetGen cannot resolve.
  Please use advanced mesh repair tools (e.g., MeshLab 'Remove Duplicate Faces',
  Blender 'Merge by Distance', or Rhino 'ExtractBadSrf' followed by 'MeshRepair')
  to fix the geometry.
  ```

  **What this prevents:**
  - Backend hanging indefinitely on meshes that pass basic validation but have complex self-intersections
  - User and frontend waiting indefinitely without feedback
  - Need to manually restart backend server after encountering problematic mesh
  - Zombie TetGen processes consuming CPU
  - Scenario: Mesh passes non-manifold edge validation (<1%) but TetGen still gets stuck due to subtle geometric issues

  **Technical details:**
  - Cross-platform solution using Python multiprocessing (works on Windows and Unix)
  - Separate OS process can be forcefully killed (unlike threads)
  - Queue-based IPC for passing mesh data between processes
  - Mesh reconstruction using `FEDomain.from_data()` since Mesh objects aren't picklable
  - Graceful termination (SIGTERM) followed by force kill (SIGKILL) if needed
  - Timeout is configurable via `MODAL_ANALYSIS_TIMEOUT` constant

## [2025-11-18 18:45] - Modal Analysis Validation Improvements

### Changed
- **Moved mesh validation thresholds to constants.py and removed blocking duplicate vertex check**
  - `backend/config/constants.py` - Added mesh validation constants (lines 223-227)
    - `MODAL_ANALYSIS_MAX_DEGENERATE_RATIO = 0.05` - Maximum 5% degenerate triangles allowed
    - `MODAL_ANALYSIS_MAX_NONMANIFOLD_RATIO = 0.01` - Maximum 1% non-manifold edges allowed
    - `MODAL_ANALYSIS_DEGENERATE_AREA_THRESHOLD = 1e-10` - Minimum triangle area threshold (m²)
    - `MODAL_ANALYSIS_VERTEX_COINCIDENCE_DECIMALS = 6` - Decimal precision for vertex comparison (unused after removal of duplicate check)
  - `backend/services/modal_analysis_service.py` - Updated validation to use constants and focus on real issues (lines 39-42, 190-290)
    - Imported validation constants from config
    - Replaced all hardcoded thresholds with named constants
    - **REMOVED duplicate vertex check** that was incorrectly blocking valid meshes
    - Enhanced error message for non-manifold edges to specifically mention TetGen errors
    - Updated docstring to clarify validation focuses on TetGen failure causes

### Fixed
- **Duplicate vertex check was blocking valid meshes (20-60% duplicates is normal for CAD exports)**
  - Previous implementation rejected meshes with >10% duplicate vertices
  - Many valid CAD formats (IFC, 3DM, STEP) naturally have coincident vertices at edge boundaries
  - This was causing false positives and preventing modal analysis on perfectly valid geometry
  - **Solution:** Removed the duplicate vertex check entirely - it's not the cause of TetGen failures
  - The real issue causing TetGen to hang is **non-manifold edges** (self-intersecting geometry)
  - Non-manifold edge detection remains at 1% threshold to catch actual self-intersections

  **Technical details:**
  - TetGen errors like "Two facets exactly intersect" are caused by non-manifold edges (3+ faces sharing an edge)
  - Duplicate/coincident vertices are a normal artifact of CAD exports and don't cause TetGen to fail
  - Validation now focuses exclusively on geometry topology issues, not vertex redundancy
  - Error message now explicitly mentions TetGen errors users see: "Two facets exactly intersect", "A segment and a facet intersect"

## [2025-11-18 18:30] - Fix Model Replacement in Analysis Tab

### Fixed
- **3D model replacement not working when using "Choose a different file"**
  - `frontend/src/hooks/useFileUpload.ts` - Updated `handleFileChange()` (lines 34-51)
    - Now clears `modelEntities`, `geometryData`, and `analysisProgress` when a new 3D model file is selected
    - This ensures the auto-upload effect in page.tsx triggers properly
  - `frontend/src/hooks/useFileUpload.ts` - Updated `handleDrop()` (lines 66-87)
    - Same clearing logic applied when dropping a new 3D model file
    - Maintains consistency between file picker and drag-and-drop workflows

  **What was broken:**
  - When a 3D model was already loaded and user clicked "Choose a different file" to select a new model, nothing happened
  - The auto-upload effect in `page.tsx:158-163` only triggers when `modelEntities.length === 0`
  - Since old model data wasn't cleared, the condition was never met

  **What's fixed:**
  - Selecting a new 3D model file (via file picker or drag-and-drop) now:
    1. Clears all previous model data (entities, geometry, analysis progress)
    2. Sets the new model file
    3. Triggers the auto-upload effect automatically
    4. Loads and analyzes the new model, replacing the old one

## [2025-11-18 18:00] - Mesh Validation for Modal Analysis

### Added
- **Pre-validation of mesh quality before modal analysis to prevent simulation failures**
  - `backend/services/modal_analysis_service.py` - Added `_validate_mesh_quality()` method (lines 190-290)
    - Validates mesh before attempting tetrahedralization/FE mesh creation
    - Checks for degenerate triangles (zero or near-zero area): Rejects if >5% are degenerate
    - Checks for invalid face indices: Ensures all vertex indices are within valid range
    - Checks for non-manifold edges (edges shared by >2 faces): Rejects if >1% are non-manifold
    - Returns detailed error messages explaining the specific issue and how to fix it
    - Integrated validation in `_analyze_mesh_internal()` before `_create_fe_mesh()` (lines 115-118)
  - `frontend/src/components/scene/ThreeScene.tsx` - Enhanced error handling for modal analysis (lines 32, 208, 620, 626)
    - Added `useApiErrorHandler` import
    - Initialized `handleError` hook for displaying error toasts
    - Modal analysis errors now displayed in UI via ErrorToast component
    - Error messages from backend validation are shown to user with specific guidance

  **Error messages shown to users:**
  - **Degenerate triangles:** "Mesh has too many degenerate triangles (X/Y, Z%). This indicates a very poor quality mesh with overlapping or zero-area faces. Please clean up the mesh in your 3D modeling software before attempting modal analysis."
  - **Non-manifold edges:** "Mesh has X non-manifold edges (Z% of all edges). Non-manifold edges indicate self-intersecting or overlapping geometry (facets that share edges incorrectly). This causes TetGen errors like 'Two facets exactly intersect' or 'A segment and a facet intersect'. Please repair the mesh using 'Mesh Repair', 'Make2Manifold', or 'Check and Fix' tools in your 3D modeling software."
  - **Invalid face indices:** "Found X faces with invalid vertex indices. Check your mesh topology."

  **What this prevents:**
  - Backend hanging indefinitely with TetGen warnings about self-intersecting geometry
  - Cryptic TetGen errors: "A segment and a facet intersect", "Two facets exactly intersect"
  - Failed modal analysis attempts that waste computation time
  - Unclear error states where users don't know what went wrong

  **User workflow:**
  - User clicks entity for modal impact sound synthesis
  - If mesh has quality issues (self-intersections, overlapping faces, etc.):
    - Validation fails immediately (before attempting expensive tetrahedralization)
    - Error toast appears in top-right corner with specific issue and fix instructions
    - Modal analysis is cancelled, user can continue working
  - If mesh passes validation:
    - Modal analysis proceeds as normal
    - User sees progress overlay → ready state → can click to play impact sounds

  **Technical details:**
  - Validation runs in O(n) time for most checks (n = number of faces)
  - Non-manifold edge check uses edge-to-face mapping for efficient detection
  - Thresholds are conservative to catch problematic meshes while allowing minor imperfections
  - All error messages include actionable guidance for fixing the mesh

## [2025-11-18 17:30] - Independent Sound Count from Selected Entities

### Changed
- **Sound generation now respects user-specified number of sounds independently of selected entities**
  - `frontend/src/hooks/useTextGeneration.ts` - Modified to use user's numSounds value instead of selectedEntities.length (lines 145-152, 188-194)
    - **Before:** If 5 entities were selected, generation was forced to produce exactly 5 sounds
    - **After:** If 5 entities are selected and user requests 7 sounds, LLM generates 7 sounds (mixed entity-linked and context sounds)
    - Changed `requestBody.num_sounds = selectedEntities.length` → `requestBody.num_sounds = numSounds`
    - Allows flexible mixed generation: e.g., 5 entities + 7 sounds = up to 5 entity-linked + 2+ context sounds
    - Progress messages now show the breakdown:
      - More sounds than entities: "Generating 7 sound prompts (5 entity-linked + 2 context sounds)..."
      - Fewer sounds than entities: "Generating 5 sound prompts from 10 selected objects..."
      - Equal: "Generating 5 sound prompts for selected objects..."

  **Use cases:**
  - **More sounds than entities:** 3 selected entities, request 10 sounds → LLM generates up to 3 entity-linked + 7+ context sounds
  - **Fewer sounds than entities:** 10 selected entities, request 5 sounds → LLM picks most relevant 5 (or mix of entity-linked + context)
  - **Equal sounds and entities:** 5 selected entities, request 5 sounds → LLM decides best mix (could be all entity-linked or mixed)

  **Backend compatibility:** Backend LLM prompt already supported this (since "Mixed Entity and Context Sound Generation" feature), frontend now fully leverages it

## [2025-11-18 17:00] - Mixed Highlighting for Entity-Linked Sounds

### Changed
- **Entity-linked sounds now show solid color highlighting, while other diverse entities keep wireframe**
  - `frontend/src/lib/three/geometry-renderer.ts` - Enhanced updateDiverseHighlights to support mixed highlighting (lines 85-202)
    - Added optional `entitiesWithLinkedSounds` parameter (Set<number>)
    - Separates diverse entities into two groups:
      1. **Entities with linked sounds**: Show solid pink mesh (same style as individual selection)
      2. **Entities without linked sounds**: Show wireframe edges only (existing behavior)
    - Solid mesh uses PRIMARY_COLOR with opacity 0.6, emissive intensity 0.5, renderOrder 1000
    - Wireframe uses boundary edge overlay with linewidth 3, renderOrder 999
    - Both render on top of main grey mesh
  - `frontend/src/components/scene/ThreeScene.tsx` - Added logic to detect entity-linked sounds (lines 713-746)
    - Added `entitiesWithLinkedSounds` useMemo hook
    - Extracts entity indices from soundscapeData where `entity_index` is not null/undefined
    - Groups sounds by prompt_index and checks selected variants
    - Returns Set<number> of entity indices with linked sounds
  - `frontend/src/components/scene/ThreeScene.tsx` - Updated diverse highlights effect (lines 1063-1071)
    - Now passes `entitiesWithLinkedSounds` to geometryRenderer.updateDiverseHighlights()
    - Added `entitiesWithLinkedSounds` to effect dependencies
    - Highlighting updates when sound variants change (solid vs wireframe)

  **User Experience:**
  - After generating sound ideas with entity-linked prompts:
    - Objects with linked sounds: **Solid pink highlight** (no wireframe) - clearly shows sound is attached
    - Selected objects without linked sounds: **Wireframe edges only** - shows selection but distinguishes from linked sounds
  - Clicking an object still shows solid pink highlight as before
  - Visual distinction makes it clear which entities have sounds attached vs. just selected

  **Example:**
  - User loads model with 10 objects
  - Selects 5 diverse entities for sound generation
  - LLM generates 3 entity-linked sounds + 2 context sounds
  - Result:
    - 3 objects with linked sounds: **Solid pink highlight**
    - 2 objects without linked sounds: **Pink wireframe edges**
    - All other objects: **Grey mesh only**

## [2025-11-18] - Automatic LLM Retry with Exponential Backoff

### Added
- **Automatic retry mechanism for LLM requests when service is overloaded**
  - `backend/config/constants.py` - Added LLM retry configuration constants (lines 21-25)
    - `LLM_MAX_RETRIES = 5` - Maximum number of retry attempts
    - `LLM_INITIAL_RETRY_DELAY = 2.0` - Initial delay in seconds before first retry
    - `LLM_MAX_RETRY_DELAY = 30.0` - Maximum delay in seconds between retries
    - `LLM_BACKOFF_MULTIPLIER = 2.0` - Exponential backoff multiplier (doubles delay each time)
  - `backend/services/llm_service.py` - Implemented retry logic with exponential backoff (lines 6-8, 20-23, 32-110)
    - Added `set_progress_callback()` method to enable progress updates during retries
    - Added `_call_llm_with_retry()` method that wraps LLM API calls
    - Detects retryable errors: 503 status, 'overloaded', 'UNAVAILABLE', 'ServerError'
    - Non-retryable errors are raised immediately (no retry)
    - Exponential backoff: 2s → 4s → 8s → 16s → 30s (capped at MAX_DELAY)
    - Logs each retry attempt to backend console with countdown timer
    - Supports AbortController for stop button functionality (frontend can cancel during request)
  - `backend/services/llm_service.py` - Updated all LLM calls to use retry mechanism (lines 229, 388, 456)
    - `select_diverse_entities()` - Now retries with "Entity selection" operation name
    - `generate_prompts_for_entities()` - Now retries with "Sound prompt generation" operation name
    - `generate_text_based_prompts()` - Now retries with "Text-based prompt generation" operation name
  - `frontend/src/lib/constants.ts` - Added frontend retry constants (lines 339-345)
    - `LLM_RETRY.MAX_ATTEMPTS = 5` - Matches backend configuration
    - `LLM_RETRY.INITIAL_DELAY = 2.0` - Matches backend configuration
    - `LLM_RETRY.MAX_DELAY = 30.0` - Matches backend configuration
    - `LLM_RETRY.BACKOFF_MULTIPLIER = 2.0` - Matches backend configuration
  - `frontend/src/hooks/useTextGeneration.ts` - Updated error messages to inform users about retry (lines 12, 99-103, 298-301)
    - Error message now shows: "LLM service is overloaded even after 5 retry attempts"
    - Informs users that "The system automatically retried with exponential backoff"
    - Progress messages show "(Auto-retry enabled)" during entity selection/generation

  **How it works:**
  - User triggers LLM request (text generation or entity selection)
  - If LLM returns 503 "overloaded" error:
    1. System waits 2 seconds, retries
    2. If fails again, waits 4 seconds, retries
    3. If fails again, waits 8 seconds, retries
    4. If fails again, waits 16 seconds, retries
    5. If fails again, waits 30 seconds, retries
    6. If still fails, shows error message to user
  - User can press "Stop Generation" button at any time to abort
  - Backend logs each attempt: "⏳ Entity selection failed (attempt 1/5): ... Retrying in 2.0 seconds..."

  **Benefits:**
  - Handles transient LLM service overload automatically
  - No user intervention needed for temporary failures
  - Exponential backoff prevents hammering overloaded service
  - Clear feedback in error messages when all retries exhausted
  - Stop button still works - user can cancel at any time

## [2025-11-17 16:00] - Fixed Entity Linkage in Mixed Sound Generation

### Fixed
- **Entity linkage now properly preserved in mixed sound generation**
  - `backend/services/llm_service.py` - Added ENTITY field to LLM output format (lines 228-234)
    - LLM now outputs `ENTITY: [number]` or `ENTITY: NONE` for each sound
    - Indicates which entity (1-based index) the sound is linked to, or NONE for context sounds
    - Example output: `ENTITY: 1` (links to first entity), `ENTITY: NONE` (non-entity context sound)
  - `backend/services/llm_service.py` - Updated parsing to extract entity linkage (lines 27-104)
    - Added entity_match regex to parse ENTITY field: `r'ENTITY:\s*(\d+|NONE|none|None)'`
    - Converts 1-based LLM index to 0-based entity_index in returned dict
    - Returns `entity_index: None` for non-entity context sounds or parsing failures
    - All sound dictionaries now include `entity_index` field (int or None)
  - `backend/routers/generation.py` - Fixed router to use parsed entity linkage (lines 103-122)
    - Extracts `entity_index` from each sound_data dictionary
    - Links sound to `entities_to_use[entity_index]` if valid index
    - Sets `entity: None` for context sounds (where entity_index is None)
  - **Before Bug:** All sounds had `entity: None` even when some should be entity-linked
  - **After Fix:** Entity-linked sounds properly reference their entities, context sounds have `entity: None`

  **Example:**
  - User selects 3 entities, requests 5 sounds with context "busy restaurant"
  - LLM generates:
    1. Door sound → `ENTITY: 1` → Links to entities_to_use[0] (door entity)
    2. Chair sound → `ENTITY: 2` → Links to entities_to_use[1] (chair entity)
    3. Cutlery clinking → `ENTITY: NONE` → entity: None (context sound)
    4. Conversation → `ENTITY: NONE` → entity: None (context sound)
    5. Coffee machine → `ENTITY: NONE` → entity: None (context sound)
  - Result: 2 entity-linked sounds + 3 context sounds, with correct entity associations

## [2025-11-17 15:00] - Entity Selection UI Improvements

### Changed
- **Diverse entity highlighting now shows only naked/boundary edges on top of grey mesh**
  - `frontend/src/lib/three/geometry-renderer.ts` - Modified updateDiverseHighlights method (lines 85-163)
    - Changed from separate colored mesh to boundary edge overlay approach
    - **Grey mesh remains visible for all entities** (including diverse ones)
    - Creates LineSegments with PRIMARY_COLOR for **naked edges only** (boundary/outline edges)
    - Uses 1-degree angle threshold in EdgesGeometry to capture only sharp/boundary edges (not internal edges)
    - Increased linewidth to 3 for better visibility
    - Edges rendered on top with renderOrder=999 and depthWrite=false
    - Updated cleanup methods to properly dispose LineSegments (lines 93-106, 329-342)
  - `frontend/src/lib/three/geometry-renderer.ts` - Fixed updateEntitySelection method (lines 265-280)
    - **Fixed bug where main grey mesh was hidden when diverse entities were selected**
    - Changed logic to ALWAYS show main grey mesh when no individual entity is selected
    - Diverse highlights (edge overlays) now properly visible alongside grey mesh
    - Removed old logic that hid main mesh in favor of separate diverse mesh
  - **Result:** Selected diverse entities appear as grey mesh with colored boundary edge highlights on top

### Added
- **Entity information overlay now displays linked LLM prompt number**
  - `frontend/src/components/overlays/EntityInfoBox.tsx` - Added linkedPromptIndex prop and badge display (lines 13, 34, 138-149)
    - Displays prompt number as a badge (e.g., "#1", "#2") next to "Entity Information" title
    - Badge styled with PRIMARY_COLOR background for visibility
    - Hover tooltip shows full link description: "Linked to LLM Prompt #X"
    - Dynamically updates when new LLM prompts are generated
    - **Only displays for entity-linked sounds** (entity_index !== null/undefined)
  - `frontend/src/types/index.ts` - Extended EntityOverlay interface (line 68)
    - Added optional linkedPromptIndex field to store prompt association
  - `frontend/src/components/scene/ThreeScene.tsx` - Updated entity overlay logic (lines 1150-1177, 1193, 1247, 1930, 1943)
    - Extracts prompt index from soundOverlay when entity has linked sound
    - Passes linkedPromptIndex to EntityInfoBox component
    - Updates dynamically when sound variants change or new sounds are generated
    - **Fixed entity linking logic** to explicitly check for null/undefined entity_index (lines 1150-1156)
      - Now requires entity_index to be a valid number (not null, not undefined)
      - Ensures badges only show for actual entity-linked sounds, not context sounds
    - Also updated isEntityLinked check to validate entity_index properly (line 1247)

## [2025-11-17] - Mixed Entity and Context Sound Generation

### Added
- **LLM can now generate both entity-linked and non-entity context sounds in a single workflow**
  - `backend/services/llm_service.py` - Updated generate_prompts_for_entities to support mixed generation (lines 255-269)
    - Added `num_sounds` parameter (can be different from number of entities)
    - LLM now generates a mix of entity-based sounds and pure context sounds
    - No priority between entity vs. context sounds - LLM decides best mix for immersive soundscape
  - `backend/services/llm_service.py` - Enhanced prompt to guide mixed generation (lines 161-217)
    - Explicitly instructs LLM to generate TWO types of sounds:
      * Entity-linked: sounds from specific objects (door closing, chair scraping)
      * Non-entity context: ambient/human activity sounds (conversation, footsteps, background music)
    - Allows generating MORE non-entity sounds than entity sounds if it improves realism
    - Allows generating FEWER sounds than number of entities (not every object needs a sound)
    - Added examples: "busy restaurant" → entity sounds (door, chair) + context sounds (cutlery clinking, conversation chatter)
  - `backend/routers/generation.py` - Updated endpoint to handle mixed generation (lines 68-116)
    - Passes `num_sounds` to `generate_prompts_for_entities()`
    - All sounds in mixed mode are treated as context sounds (entity = null)
    - Updated docstring to explain mixed generation workflow

  **Example workflow:**
  - User selects 3 entities (door, chair, table) and requests 5 sounds with context "busy restaurant at lunch time"
  - LLM generates:
    1. Kitchen swing door pushed by waitstaff (entity-linked)
    2. Chair scraping as guest sits down (entity-linked)
    3. Clinking cutlery and plates (non-entity)
    4. Background conversation chatter (non-entity)
    5. Coffee machine hissing (non-entity)
  - Result: 2 entity-linked + 3 context sounds = more immersive soundscape

## [2025-11-17] - Context-Aware Sound Generation Fix
### Fixed
- **LLM now properly considers context when generating sounds for selected entities**
  - `backend/services/llm_service.py` - Strengthened context emphasis in prompt (lines 177-224)
    - Made context uppercase and emphasized at the very beginning: "IMPORTANT CONTEXT: {context.upper()}"
    - Reframed instruction to prioritize context first, entity properties second
    - Added concrete examples showing how same entity produces different sounds in different contexts
    - Added "CRITICALLY IMPORTANT" emphasis for context in all parameter guidelines (prompts, SPL, interval, duration)
    - Changed from "Remember that this sound is happening in this context" to "MUST make sense in the context of"
  - **Before:** With context "busy restaurant at lunch time" + 3 entities (fridge, door, chair), LLM generated generic sounds: "Fridge Door Close", "Sliding Wooden Door", "Office Chair Roll"
  - **After:** LLM will now generate context-appropriate sounds like "Kitchen fridge opening during food prep", "Waitstaff pushing through kitchen door", "Chair scraping as guests sit down"

- **Fixed LLM generating multiple sounds per entity (doubling issue)**
  - `backend/services/llm_service.py` - Clarified one-to-one mapping between entities and sounds (lines 185-199)
    - Changed "For each object, generate a sound" to "generate EXACTLY ONE sound"
    - Added explicit instruction: "Generate exactly {len(entities)} sounds total - ONE sound per object, no more, no less"
    - Fixed examples that showed multiple sound variations (e.g., "door → waitstaff door, guests door") to show single sounds
    - Repeated the count constraint at the end: "Generate exactly {len(entities)} sounds (one per object)"
  - **Before:** Selecting 2 entities generated 4 prompts (2 per entity: "Sliding Door", "Guest Door", "Laptop Typing", "Laptop Lid")
  - **After:** Selecting 2 entities generates exactly 2 prompts (1 per entity)

## [2025-11-14 21:30] - Sound Loading UX Improvements
### Fixed
- **Consistent button styling in Analysis tab**
  - `frontend/src/components/layout/sidebar/TextGenerationSection.tsx` - Updated "Load Sounds →" button styling (lines 123-140)
    - Now uses UI_BUTTON constants (BORDER_RADIUS_MD, PADDING_MD, FONT_SIZE, FONT_WEIGHT) matching first button
    - Uses backgroundColor hover instead of opacity for consistency
    - Changed from rounded-full (9999px) to standard button radius

### Changed
- **Load sounds buttons now append instead of replacing existing sounds**
  - `frontend/src/hooks/useSoundGeneration.ts` - Modified setSoundConfigsFromPrompts to append (lines 304-313)
    - Intelligently replaces only when there's a single empty config at start
    - Otherwise appends new sound configs to existing ones
    - Prevents losing user's work when loading sounds from different sources
  - `frontend/src/app/page.tsx` - Updated comment to reflect append behavior (line 133)
    - Changed from "replaces existing configs" to "appends to existing configs"

## [2025-11-14 20:00] - UX Improvements for Entity Analysis
### Fixed
- **Improved entity analysis UX and error handling**
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx` - Cleaner analysis UI (lines 212-228, 230-258, 278-323)
    - "Model loaded with X objects" message now hides when analyzing or analyzed (line 212)
    - Single "Analyze 3D Model" button that changes to "Re-analyze 3D Model" after analysis (lines 231-258)
    - Removed separate "Re-analyze with different selection" button for cleaner UI
    - Success message only shows when not analyzing (line 278)
  - `frontend/src/components/layout/sidebar/TextGenerationSection.tsx` - Fixed duplicate progress message (lines 156-157)
    - Progress message now only shows when generating prompts, NOT when analyzing entities
    - Added isAnalyzingEntities check to prevent duplicate progress display
  - `frontend/src/types/components.ts` - Added isAnalyzingEntities prop to TextGenerationSectionProps (line 232)
  - `frontend/src/components/layout/Sidebar.tsx` - Wired up isAnalyzingEntities prop (line 137)

- **Graceful handling of LLM API overload during re-analysis**
  - `frontend/src/hooks/useTextGeneration.ts` - Store and restore previous selection on error (lines 41-42, 86-103)
    - Saves previous entity selection before making API call
    - Restores previous selection if API call fails
    - Shows friendly error message: "⏳ LLM service is overloaded. Please try again in a moment. Previous selection kept."
    - Detects overload errors by checking for 503, 'overloaded', or 'UNAVAILABLE' in error message
  - `backend/services/llm_service.py` - Propagate LLM errors instead of silent fallback (lines 144-148)
    - Changed from silently returning first entities to re-raising exception
    - Allows frontend to handle errors appropriately
  - `backend/routers/generation.py` - Proper HTTP 503 error for API overload (lines 50-65)
    - Catches LLM overload exceptions and returns HTTP 503 with clear message
    - Detects '503', 'overloaded', or 'UNAVAILABLE' in exception text
    - Returns: "LLM service is currently overloaded. Please try again in a moment."

### Technical Details
**UX Flow Improvements:**
1. Before: "Model loaded" → "Analyze" button → "X objects selected" → "Re-analyze" button
2. After: "Analyze" button (hides "Model loaded") → "X objects selected" + "Re-analyze" button (same button)
3. Progress only shows once (in Model section, not duplicated in Generate section)

**Error Handling Flow:**
1. User clicks "Re-analyze 3D Model" button
2. Frontend stores current selection: `previousSelection = [1, 42, 44, 45]`
3. API call fails with 503 UNAVAILABLE (LLM overloaded)
4. Backend raises exception with 503 status code
5. Frontend catches error, restores `previousSelection`
6. User sees error message but keeps previous highlighted entities
7. User can continue using the previous selection for sound generation

## [2025-11-14 19:00] - Separate Entity Analysis from Sound Generation (Two-Step LLM Workflow)
### Added
- **Two-step LLM workflow for 3D model context**
  - `frontend/src/hooks/useTextGeneration.ts` - Added handleAnalyzeModel function (lines 35-92)
    - New separate function for LLM Step 1: Entity selection only
    - Sets isAnalyzingEntities state during analysis
    - Stores selected entities in selectedDiverseEntities
    - Shows progress messages and clears after completion
  - `frontend/src/hooks/useTextGeneration.ts` - Added handleClearAnalysis function (lines 296-300)
    - Clears analyzed entities when model changes or is unloaded
    - Resets error and progress states
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx` - Added "Analyze 3D Model" button (lines 227-255)
    - Appears below "Model loaded with X objects" message
    - Shows spinner and progress during analysis
    - Button label shows number of diverse objects to select
    - Only visible before entities are analyzed
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx` - Analysis results UI (lines 274-338)
    - Shows "X diverse objects selected" success message
    - Displays "Re-analyze with different selection" button
    - Checkbox "Use model as context" only appears AFTER analysis
    - Moved from appearing immediately on model load

### Changed
- **Entity selection workflow now requires explicit user action**
  - `frontend/src/hooks/useTextGeneration.ts` - Modified handleGenerateText (lines 117-167)
    - Now checks if entities were pre-analyzed (selectedDiverseEntities.length > 0)
    - Uses pre-analyzed entities directly if available (skips LLM Step 1)
    - Only performs entity selection if not pre-analyzed
    - Progress message: "Generating sound prompts for selected objects..."
  - `frontend/src/app/page.tsx` - Added useEffect to clear analysis (lines 94-98)
    - Automatically clears analyzed entities when model changes
    - Triggers on modelFile or modelEntities.length change
  - `frontend/src/types/components.ts` - Extended interfaces with analysis props
    - ModelLoadSectionProps: Added selectedDiverseEntities, isAnalyzingEntities, llmProgress, numSounds, onAnalyzeModel, onStopGeneration (lines 170-176)
    - SidebarProps: Added selectedDiverseEntities, isAnalyzingEntities, onAnalyzeModel (lines 111-114)
  - `frontend/src/components/layout/Sidebar.tsx` - Wired up new props (lines 123-128)
  - `frontend/src/app/page.tsx` - Passed analysis functions to Sidebar (lines 431-432, 436)
  - `backend/routers/generation.py` - Cleaned up debug logging
    - Removed verbose console.log statements from select-entities endpoint
    - Removed debug prints from generate-prompts endpoint
    - Kept minimal logging for production use

### Technical Details
**New Workflow:**
1. User loads 3D model → Shows "Analyze 3D Model" button
2. User clicks "Analyze 3D Model" → LLM Step 1 selects diverse entities → Entities highlighted in pink
3. "Use model as context" checkbox appears (checked by default)
4. User types prompt (optional) and clicks "Generate Ideas" → LLM Step 2 generates sound prompts for selected entities
5. User can click "Re-analyze" to select different entities

**Benefits:**
- Separates entity selection from prompt generation
- Gives users control over when LLM calls happen
- Shows selected entities before generating prompts
- Allows re-analysis without re-generating prompts
- Clearer UX with explicit analysis step
- Prevents unintended double LLM calls

## [2025-11-14 18:15] - Fix Audio Waveform Persisting When Loading Model After Audio
### Fixed
- **Audio waveform and SED results now persist when loading a 3D model after audio file**
  - `frontend/src/app/page.tsx` - Fixed `handleFileChangeWithSEDClear` (lines 136-150)
    - Now only clears SED results when an **audio** file is selected (to replace previous audio)
    - Previously cleared SED results for **any** file type, causing audio waveform to disappear when model was selected
    - Model file selection no longer affects loaded audio data

### Technical Details
**Bug:** When audio was loaded first, then user selected a model file:
1. `handleFileChangeWithSEDClear` was called
2. `sed.clearSEDResults()` was called unconditionally
3. This cleared `sedAudioBuffer`, `sedAudioInfo`, and `sedDetectedSounds`
4. Audio waveform disappeared from UI

**Fix:** Only clear SED results when replacing audio file with new audio file, not when loading model file.

## [2025-11-14 18:00] - Simplify File Loading: Remove Replace Buttons and Auto-Load Models
### Changed
- **Removed "Load Another Model" and "Load Another Audio File" buttons - files now auto-load**
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx` - Removed replace buttons
    - Removed "Load Another Model" button (was lines 250-265)
    - Removed "Load Another Audio File" button (was lines 422-437)
    - Removed intermediate "Load Model" button - models auto-load when selected (removed lines 442-515)
    - Added loading indicator UI for model uploading/analyzing (lines 407-447)
    - Cleaner UI: Once loaded, files stay until user selects different file via upload area
  - `frontend/src/types/components.ts` - Removed clear handler props
    - Removed `onClearModel` and `onClearAudio` from `ModelLoadSectionProps` (lines 166-167 removed)
    - Removed same handlers from `SidebarProps` (lines 70-71 removed)
  - `frontend/src/components/layout/Sidebar.tsx` - Updated props passed to ModelLoadSection
    - Removed `onClearModel` and `onClearAudio` prop passing (lines 112-113 removed)
  - `frontend/src/app/page.tsx` - Auto-trigger model loading
    - Added useEffect to automatically load model when `modelFile` changes (lines 152-157)
    - Removed `handleClearAudio` wrapper function (no longer needed)
    - Removed passing `onClearModel` and `onClearAudio` to Sidebar (lines 406-407 removed)

### Technical Details
**New User Flow:**
1. User drags or selects a 3D model (.ifc/.3dm) → stored as `modelFile` → **automatically loads**
2. Loading indicator shows "Loading model..." and "Analyzing model..." during process
3. Once complete, UI shows "✓ Model loaded with N objects"
4. To replace: User selects new model via same upload area → new model replaces old one automatically
5. Audio files work similarly but were already auto-loading via SED hook

**Implementation:**
- `useEffect` hook watches `modelFile` changes and triggers `handleUploadModel()` when:
  - `modelFile` is not null
  - Not currently uploading or analyzing
  - No model entities loaded yet (prevents re-loading same model)
- Removed buttons simplifies UI and makes workflow more intuitive
- Upload area remains accessible for selecting replacement files

## [2025-11-14 17:30] - Enable Loading Both 3D Model AND Audio File Simultaneously
### Changed
- **Analysis tab now supports uploading both a 3D model and an audio file at the same time**
  - `frontend/src/hooks/useFileUpload.ts` - Refactored to track both file types separately
    - Added separate state for `modelFile` and `audioFile` (lines 10-11)
    - Single upload area determines file type and stores appropriately (lines 34-47)
    - Unified drag handlers work for both file types (lines 50-79)
    - `clearAudio()` function added to clear audio file independently (lines 195-197)
    - Export both `modelFile` and `audioFile` in return object (lines 201-202)
  - `frontend/src/types/components.ts` - Updated prop interfaces for dual-file support
    - `ModelLoadSectionProps`: Changed from single `file` to `modelFile` and `audioFile` (lines 151-152)
    - `ModelLoadSectionProps`: Simplified drag state to single `isDragging` (line 153)
    - `ModelLoadSectionProps`: Updated handlers to use single upload area pattern (lines 167-170)
    - `SidebarProps`: Same updates for consistency (lines 31-32, 53, 64-71)
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx` - Refactored UI to show both loaded files
    - Completely rewritten to display both model and audio UIs simultaneously (full file)
    - Upload area shown only when at least one file type not loaded (line 49)
    - Loaded model UI displays when `modelEntities.length > 0` (lines 204-267)
    - Audio file UI displays when `audioFile !== null` (lines 270-439)
    - Both UIs can be visible at the same time, one below the other
    - Each file type has its own "Load Another..." button for replacement
    - Model file waiting-to-upload UI only shows if no audio file (line 442)
  - `frontend/src/components/layout/Sidebar.tsx` - Updated props passed to ModelLoadSection
    - Pass `modelFile` and `audioFile` instead of single `file` (lines 98-99)
    - Pass `onUploadModel` instead of `onUpload` (line 110)
    - Added `onClearAudio` handler (line 113)
  - `frontend/src/app/page.tsx` - Updated to use new file handlers
    - Pass separate `modelFile` and `audioFile` props to Sidebar (lines 384-385)
    - Use `onUploadModel` instead of `onUpload` (line 398)
    - `handleAnalyzeSoundEvents` uses `audioFile` instead of `file` (line 111)
    - Added `handleClearAudio` wrapper to clear both audio file and SED results (lines 153-156)
    - Pass `handleClearAudio` to Sidebar (line 407)

### Technical Details
**User Flow:**
1. User drags or selects a 3D model (.ifc/.3dm) → stored as `modelFile`
2. User clicks "Load Model" → model analyzed, UI shows "Model loaded with N objects"
3. User drags or selects audio file (.wav/.mp3) → stored as `audioFile`
4. Audio waveform displays immediately, analysis options shown
5. User clicks "Analyze Sound Events" → SED analysis runs
6. Both model UI and audio UI visible simultaneously
7. User can click "Load Another Model" or "Load Another Audio File" independently
8. Uploading new file of same type replaces the previous one

**Implementation Details:**
- Single unified upload area determines file type by extension
- Model requires explicit "Load Model" action to process geometry
- Audio file info loads automatically via SED hook when file selected
- Each file type maintains independent state and can be cleared separately
- Upload area hides when both files are loaded to reduce UI clutter

## [2025-11-14 16:00] - Fix Entity Selection with LLM Prompts
### Fixed
- **Entity selection now correctly preserves diverse entities when using LLM prompts**
  - `backend/routers/generation.py` - Fixed /api/generate-prompts endpoint
    - Added debug logging to track entity selection flow (lines 68-72, 91-93)
    - Changed re-selection logic to respect pre-selected entities (lines 74-88)
    - Now only re-selects if entities >> num_sounds (using 1.5x threshold)
    - Previously would re-select based on simple count comparison
  - `backend/routers/generation.py` - Updated /api/generate-text legacy endpoint (line 156)
    - Now returns `selected_entities` in response for frontend verification
    - Ensures consistency between highlighted and positioned entities
  - `frontend/src/hooks/useTextGeneration.ts` - Fixed entity synchronization (lines 86-88)
    - Now updates `num_sounds` to match selected entities count before sending to backend
    - Prevents backend from re-selecting when entities are already pre-selected
  - `frontend/src/hooks/useTextGeneration.ts` - Added verification logic (lines 132-149)
    - Compares backend-returned entities with frontend-selected entities
    - Logs warning if mismatch detected for debugging
    - Updates highlights to match backend's actual selection
    - Fallback to extracting entities from prompts if needed

### Technical Details
**Root Cause:** When calling /api/select-entities followed by /api/generate-text with a context/prompt:
1. Frontend pre-selected N diverse entities
2. Frontend sent these N entities with original num_sounds value (e.g., M where M ≠ N)
3. Backend would re-select if N > M, causing different entities to be used
4. Frontend highlighting showed pre-selected entities, but sounds positioned at different entities

**Solution:**
- Frontend now synchronizes num_sounds with selected entity count
- Backend uses smarter heuristic (1.5x threshold) to detect pre-selected entities
- Backend returns selected_entities for verification
- Frontend validates and updates highlights if mismatch detected

## [2025-11-14] - Move Sound Generation Advanced Settings to Scene Panel
### Added
- **Settings button and advanced settings panel in ThreeScene**
  - `frontend/src/components/scene/SettingsButton.tsx` - Settings gear button for top-right corner
    - Consistent styling with SceneControlButton design system
    - Active state when panel is open (pink highlight)
    - Hover effects with rotation animation
    - Small size (24x24px) matching other scene controls
  - `frontend/src/components/scene/AdvancedSettingsPanel.tsx` - Advanced settings panel for sound generation
    - Positioned in top-right corner below settings button
    - **Audio Generation Model** section: TangoFlux/AudioLDM2 dropdown with descriptions
    - **Text-to-Audio Parameters** section: Global duration (1-30s), diffusion steps (10-100), negative prompt textarea
    - **Audio Processing** section: Remove background noise checkbox
    - Reset button (styled like IR Library Upload button) next to close button
    - All changes apply immediately (no Apply button)
    - Consistent overlay styling with backdrop blur and dark theme
  - `frontend/src/components/scene/ThreeScene.tsx` - Integrated settings button and panel (lines 1955-1995)
    - Added `isSettingsPanelOpen` state for panel visibility
    - Settings button positioned at top-6 right-6 with z-index 40
    - Settings panel receives sound generation props from page.tsx
    - Added sound generation props to ThreeSceneProps interface
  - `frontend/src/types/three-scene.ts` - Extended interface with sound generation settings (lines 154-186)
    - Added optional props: globalDuration, globalSteps, globalNegativePrompt, applyDenoising, audioModel
    - Added callbacks: onGlobalDurationChange, onGlobalStepsChange, onGlobalNegativePromptChange, onApplyDenoisingChange, onAudioModelChange, onResetAdvancedSettings
  - `frontend/src/hooks/useSoundGeneration.ts` - Added handleResetToDefaults function (lines 544-551)
    - Resets all advanced settings to default values
    - Exposed in hook return object
  - `frontend/src/app/page.tsx` - Connected ThreeScene to sound generation state (lines 549-559)
    - Pass globalDuration, globalSteps, globalNegativePrompt, applyDenoising, audioModel to ThreeScene
    - Wire up all change handlers and resetToDefaults callback

### Changed
- **Removed Advanced Options section from sidebar**
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Removed collapsible Advanced Options section
    - Removed showAdvancedOptions state
    - Removed auto-collapse effect on sound generation
    - Removed denoising confirmation dialog (now handled globally via settings panel)
    - Removed Audio Model dropdown (moved to settings panel)
    - Removed Global Duration slider (moved to settings panel)
    - Removed Diffusion Steps slider (moved to settings panel)
    - Removed Global Negative Prompt textarea (moved to settings panel)
    - Removed Background Noise Removal checkbox (moved to settings panel)
    - Sidebar is now cleaner with only per-sound controls
- **Updated architecture documentation**
  - `ARCHITECTURE.md` - Expanded scene/ directory listing to show individual components
    - Added ThreeScene.tsx, SceneControlButton.tsx, SettingsButton.tsx, AdvancedSettingsPanel.tsx with descriptions

### Removed
- **Advanced Options collapsible section from Sound Generation tab**
  - All advanced settings moved to 3D scene settings panel for better accessibility
  - Denoising confirmation dialog (settings changes now apply immediately)

**User Experience:**
- Advanced sound generation settings now accessible via gear icon in top-right corner of 3D scene
- Settings panel floats over the 3D scene (not hidden in sidebar)
- All changes apply immediately without confirmation dialogs
- Reset button quickly restores default values
- Cleaner sidebar focused on per-sound configuration
- Settings accessible while viewing the 3D scene

## [2025-11-14] - Centralized Error Handling System
### Added
- **Global error notification system with toast UI**
  - `frontend/src/contexts/ErrorContext.tsx` - Error notification context provider
    - Manages error notification state globally across the app
    - Auto-dismisses notifications after 5 seconds
    - Supports error, warning, and info notification types
  - `frontend/src/components/ui/ErrorToast.tsx` - Toast notification UI component
    - Displays errors in top-right corner with color-coded badges
    - Slide-in animation for new notifications
    - Manual dismiss button for each notification
    - Uses UI_COLORS constants for consistent styling
  - `frontend/src/hooks/useApiErrorHandler.ts` - Error handling hooks
    - `useApiErrorHandler()` - Hook for manual error handling with toast notifications
    - `useApiWithErrorHandling()` - Hook for wrapping async API calls with automatic error handling

### Changed
- **Enhanced API service with comprehensive error handling**
  - `frontend/src/services/api.ts` - All API methods now use centralized error handling
    - Added `handleApiError()` helper for consistent error message formatting
    - Added `fetchWithErrorHandling()` wrapper for all fetch calls
    - Converts network errors ("Failed to fetch") into user-friendly messages
    - Indicates server connection issues with backend URL
    - Updated all 14 API methods: uploadFile, loadSampleIfc, analyze3dm, analyzeIfc, generateText, generateSounds, cleanupGeneratedSounds, uploadImpulseResponse, listImpulseResponses, deleteImpulseResponse, analyzeModal, getModalMaterials
  - `frontend/src/app/page.tsx` - Wrapped app with ErrorProvider and added ErrorToast component
    - Split into `Home` (wrapper with ErrorProvider) and `HomeContent` (main logic)
    - Ensures all hooks have access to error context before they're called
  - `frontend/src/hooks/useFileUpload.ts` - Integrated error notifications with existing error state
    - Upload errors now show in both inline UI (uploadError state) and toast notifications
    - Uses `useApiErrorHandler()` hook for consistent error display
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Added toast notifications for IR operations
    - Loading IR list errors now show in toast notifications
    - Upload errors now show in toast notifications
    - Delete errors now show in toast notifications
    - Selection errors now show in toast notifications

### Fixed
- **Network errors now display user-friendly messages**
  - "Failed to fetch" errors now show helpful message: "Unable to connect to the server. Please check if the backend is running at {API_BASE_URL}"
  - All API errors now properly caught and displayed to users
  - Silent failures (like cleanup operations) no longer crash the app

**User Experience:**
- All API errors now visible to users via toast notifications
- Errors automatically dismiss after 5 seconds
- Users can manually dismiss notifications
- Consistent error styling across the entire app
- Network issues clearly communicated with actionable messages

## [2025-11-14] - Streamline IR Library Upload UX
### Changed
- **Removed confirmation step for IR uploads**
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Removed confirmation UI from "Upload New IR" section
    - Removed "Upload & Process" button
    - Removed IR name input field
    - Files now upload immediately upon selection or drop
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Updated upload handlers to upload directly (lines 133-211)
    - Created unified `uploadFiles()` function for immediate upload
    - `handleFileChange()` and `handleDrop()` now call `uploadFiles()` directly
    - Shows upload progress inline during processing
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Enhanced IR Library section (lines 344-465)
    - Replaced "Refresh" button with "Upload" button in IR Library header
    - Upload button triggers hidden file input for direct file selection
    - `handleIRLibraryUpload()` handler uploads files immediately (lines 205-211)
    - Only shows when library has items (`impulseResponses.length > 0`)
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - "Upload New IR" section updated (lines 289-325)
    - Kept drag-and-drop FileUploadArea for first-time uploads
    - Only shows when library is empty
    - Uploads immediately on file selection or drop
    - Shows upload progress message during processing

### Removed
- **Confirmation step UI elements**
  - No more "Upload & Process" button requiring manual confirmation
  - No more file name input field
  - No more multi-file selection indicator with confirmation

**User Experience:**
- Significantly faster workflow: Select/Drop File(s) → Auto-upload immediately
- Dual upload interfaces:
  - Empty library: Drag-and-drop area for first IR upload
  - Library with items: Clean Upload button in library header
- Files are named automatically from their filename (without extension)
- Upload progress shown inline during processing

## [2025-11-14] - Fix Race Condition in Stop All Audio
### Fixed
- **Stop All now reliably prevents sounds from playing after being stopped**
  - `frontend/src/lib/audio-scheduler.ts` - Added race condition protection in `triggerPlayback()` (lines 213-221)
    - Check if sound is still scheduled before playing (`!this.scheduledSounds.has(soundId)`)
    - Return early with detailed logging if sound was unscheduled during timer callback execution
    - Prevents race condition where `setTimeout` callback executes AFTER `unscheduleSound()` is called
  - `frontend/src/lib/audio-scheduler.ts` - Optimized `unscheduleSound()` (lines 151-154)
    - Delete from `scheduledSounds` map FIRST before calling `clearTimeout()`
    - Minimizes race window where timer callback could execute during unschedule
  - `frontend/src/lib/audio-scheduler.ts` - Optimized `unscheduleAll()` (lines 183-185)
    - Copy timers and clear map FIRST before canceling timers
    - Ensures all timer callbacks see empty map when checking if they should play

**Why This Change:**
- User reported sounds occasionally playing AFTER pressing "Stop All"
- Root cause: JavaScript `setTimeout` callbacks that have already been queued cannot be stopped by `clearTimeout()`
- If a timer fires and starts executing just before `unscheduleSound()` is called, `clearTimeout()` has no effect
- The callback continues executing and calls `orchestrator.playSource()`, playing the sound after stop

**Technical Details:**
```
Race condition timeline:
T+0ms:  Timer fires → callback starts executing
T+1ms:  Callback calls playOnce(audio, soundId)
T+2ms:  User clicks "Stop All"
T+3ms:  clearTimeout() called - BUT callback is ALREADY RUNNING
T+4ms:  playOnce → triggerPlayback → orchestrator.playSource() ← BUG: Plays after stop!
```

**Solution - Defense in Depth:**
1. **Guard check in triggerPlayback:** Check if sound is still in map before playing
2. **Delete map entry first:** Remove from map BEFORE clearTimeout to minimize race window
3. **Clear map atomically:** In unscheduleAll, clear entire map before canceling timers

This ensures even if a timer callback is mid-execution, it will see the sound is no longer scheduled and abort.


## [2025-11-13] - Auto-Orient Ambisonic Scene to Closest Sound Source
### Changed
- **Mono IR and Stereo IR modes now auto-orient towards closest sound**
  - `frontend/src/lib/audio/modes/MonoIRMode.ts` - Calculate orientation to closest source
  - `frontend/src/lib/audio/modes/StereoIRMode.ts` - Calculate orientation to closest source
  - Orbiting camera now dynamically rotates the ambisonic scene towards nearest sound
  - Provides intuitive spatial audio behavior when moving camera around scene

## [2025-11-13] - Fix ResonanceMode Acoustic Material Updates
### Fixed
- **Room materials and dimensions now properly affect sound in ShoeBox Acoustics mode**
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Implemented material/dimension update methods
  - `frontend/src/lib/audio/modes/ResonanceMode.ts` - Added state tracking and getters for room properties

## [2025-11-13 XX:XX] - Restore IR Waveform Visualization in Acoustics Tab
### Fixed
- **Impulse response waveform display now appears after importing IR**
  - `frontend/src/lib/audio/utils/mode-selector.ts` - Added `filename` field to `IRState` interface
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Store filename when loading IR
    - Line 564: Set `filename: file.name` in `loadImpulseResponse()`
    - Line 577: Clear filename on error
    - Line 88: Initialize filename as undefined
    - Line 624: Clear filename when clearing IR
  - `frontend/src/app/page.tsx` - Use IR state from orchestrator for waveform display
    - Line 296: Get IR state from orchestrator via `getIRState()`
    - Line 300-301: Use `irState.buffer` and `irState.filename` for auralization config
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Already had waveform visualization (lines 276-286)

**Why This Change:**
- User reported missing waveform visualizer when importing IR in Acoustics tab
- Root cause: `auralizationConfig` in `page.tsx` had `impulseResponseBuffer` and `impulseResponseFilename` hardcoded to `null`
- Solution: Store filename in IR state and populate config from orchestrator's IR state

**Technical Details:**
- `IRState` interface now tracks filename alongside buffer and channel count
- AudioOrchestrator stores filename when loading IR file
- Page component retrieves IR state and passes buffer + filename to waveform component
- Waveform component requires both buffer AND filename to display (line 242 condition)

- **Deleting a selected IR now properly deselects it and switches audio mode**
  - `frontend/src/components/audio/ImpulseResponseUpload.tsx` - Fixed `handleDeleteIR()` (line 167-169)
    - Check if deleted IR is currently selected (`selectedIRId === irId`)
    - If true, call `onClearIR()` before deleting to deselect and switch mode
    - This prevents IR mode from staying active after deletion

**Why This Change:**
- User reported that deleting a selected IR kept IR mode active, preventing mode switching
- Root cause: Delete operation didn't check if the deleted IR was currently selected
- Solution: Deselect IR before deletion if it's the currently selected one

**Technical Details:**
- `onClearIR()` callback triggers `audioOrchestrator.clearImpulseResponse()`
- Orchestrator clears IR state and calls `autoSelectMode()` to switch to appropriate no-IR mode
- Then the IR is deleted from server and list is reloaded
- This ensures audio mode switches back to anechoic/resonance/basic_mixer when selected IR is deleted

- **Bounding box now automatically hides when switching away from ResonanceMode**
  - `frontend/src/app/page.tsx` - Added useEffect to auto-hide bounding box (line 77-86)
    - Monitors current audio mode via `audioOrchestrator.status.currentMode`
    - If mode is not `'no_ir_resonance'` and bounding box is visible, hide it automatically
    - Prevents bounding box from staying visible when switching to IR modes

**Why This Change:**
- User reported that ResonanceMode and IR mode effects were mixing when IR was selected while previously in ResonanceMode
- User requested that bounding box should only be displayed in ResonanceMode
- Root cause: Bounding box visibility was user-controlled and not tied to audio mode
- Solution: Automatically hide bounding box when leaving ResonanceMode

**Technical Details:**
- ResonanceMode is already properly disabled by AudioOrchestrator's mode switching (`smoothModeTransition` calls `oldMode.disable()`)
- `resonanceAudioConfig.enabled` is already correctly set to false when not in ResonanceMode (line 306)
- Added useEffect to enforce bounding box visibility constraint: only show in ResonanceMode
- When switching from ResonanceMode to any IR mode, bounding box is automatically hidden
- This ensures visual consistency: bounding box only shown when Resonance spatial audio is active

## [2025-11-13 16:40] - Enhanced IR File Decoding with Fallback Strategy
### Added
- **Multi-channel WAV file support with robust fallback decoding**
  - `frontend/package.json` - Added `wav-decoder` library for handling complex WAV formats
  - `frontend/src/lib/audio/utils/audio-file-decoder.ts` - NEW: Robust audio file decoding with diagnostics
    - Two-stage decoding: Native Web Audio API first, wav-decoder as fallback
    - Handles 32-bit float WAVs and high channel count files (16+ channels)
    - Detailed file diagnostics (size, format, channels, sample rate)
    - Clear error messages with actionable solutions
    - **Fixed ArrayBuffer detachment issue**: Clone ArrayBuffer before native decode attempt
  - `frontend/src/types/wav-decoder.d.ts` - NEW: TypeScript type definitions for wav-decoder
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Integrated new decoder in `loadImpulseResponse()`
    - File metadata extraction and logging
    - Better error messages with file details
    - Comprehensive success/failure diagnostics
  - `frontend/src/lib/audio/utils/error-handling.ts` - Improved `handleIRLoadFailure()` to preserve detailed error messages

**Why This Change:**
- Users reported `EncodingError: Unable to decode audio data` when loading 16-channel IR files from Odeon
- Native Web Audio API `decodeAudioData()` fails on certain WAV formats:
  - 32-bit float encoding (common in Odeon exports)
  - High channel count files (>8 channels)
  - Non-standard WAV variants
- Solution: Use wav-decoder library as fallback when native decoding fails

**Technical Details:**
- `decodeAudioFile()` implements two-stage fallback:
  1. Try native `audioContext.decodeAudioData()` (fastest, best compatibility)
     - Uses a **cloned ArrayBuffer** to prevent detachment issue
  2. If fails, try `wav-decoder` library with original buffer (handles more formats)
  3. If both fail, provide detailed error with file info and solutions
- **ArrayBuffer Detachment Fix** (Line 92):
  - Native `decodeAudioData()` detaches the ArrayBuffer even on failure
  - Clone buffer before native attempt: `arrayBuffer.slice(0)`
  - Fallback decoder uses original (non-detached) buffer
  - Prevents: "Cannot perform DataView constructor on a detached ArrayBuffer" error
- Metadata extraction provides diagnostic info: file name, size (MB), MIME type
- Buffer info logged after success: channels, sample rate, duration, length
- Error messages include:
  - File details (name, size, type)
  - Both native and fallback error messages
  - Actionable solutions (convert to 16-bit PCM, check channel count, verify file integrity)

**Supported Channel Counts:** 1 (mono), 2 (stereo), 4 (FOA), 9 (SOA), 16 (TOA)

## [2025-11-14 00:45] - Improve Receiver Mode Warning Messages
### Fixed
- **Distinguish between "no receiver exists" and "receiver exists but not activated"**
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Track `hasReceiversInScene` separately from `isReceiverModeActive`
  - `frontend/src/hooks/useAudioOrchestrator.ts` - Updated `setReceiverMode` to accept `hasReceivers` parameter
  - `frontend/src/app/page.tsx` - Pass receiver count to orchestrator when mode changes and when receivers are added/removed
  - Warning messages now properly reflect the actual state:
    - **No receivers exist**: "⚠️ Place a receiver in the scene to use IR mode"
    - **Receiver exists but not activated**: "💡 Double click on a receiver to enter receiver mode"
    - **Receiver active**: No warning, IR mode works correctly

**Technical Details:**
- Added `hasReceiversInScene` field at line 93 in AudioOrchestrator.ts
- Updated `setReceiverMode` method to accept optional `hasReceivers` parameter
- Modified warning logic in `updateReceiverConstraint` (lines 418-426) to check both flags
- Modified UI notice generation in `getStatus` (lines 462-468) to show context-appropriate messages
- Added useEffect at lines 324-333 in page.tsx to sync receiver count changes with orchestrator

## [2025-11-14 00:30] - Fix Receiver Mode Warning Not Clearing
### Fixed
- **Wire up receiver mode notification to AudioOrchestrator**
  - `frontend/src/hooks/useAudioOrchestrator.ts` - Added `setReceiverMode` method to hook's return value
  - `frontend/src/app/page.tsx` - Connected `handleReceiverModeChange` to call `audioOrchestrator.setReceiverMode`
  - Fixed issue where "Place a receiver in the scene to use IR mode" warning persisted even after entering receiver mode
  - Warnings are now automatically cleared when receiver mode is activated

**Root Cause:**
- The `handleReceiverModeChange` handler existed but was a stub with a TODO comment
- AudioOrchestrator's `setReceiverMode` method existed but was not exposed through the hook
- Result: AudioOrchestrator never knew when receiver mode was activated, so the warning persisted

**Technical Details:**
- Added `setReceiverMode` callback at line 303-318 in useAudioOrchestrator.ts
- Automatically calls `clearWarnings()` when receiver mode is activated
- Updated `handleReceiverModeChange` at line 319 in page.tsx to call the orchestrator method
- Status updates immediately after receiver mode changes

## [2025-11-14 00:10] - Fix AudioOrchestrator Initialization Error
### Fixed
- **SoundSphereManager constructor now accepts optional AudioOrchestrator**
  - `frontend/src/lib/three/sound-sphere-manager.ts` - Allow null AudioOrchestrator during construction
  - `frontend/src/components/scene/ThreeScene.tsx` - Update orchestrator via setter when available
  - Fixed runtime error: "[SoundSphereManager] AudioOrchestrator and AudioContext are required"
  - Added `setAudioOrchestrator()` method to update orchestrator after initialization
  - Added null checks before using AudioOrchestrator in all methods

**Technical details:**
- Constructor now accepts null audioOrchestrator and warns if not available
- Effect at line 837 of ThreeScene.tsx updates orchestrator when it becomes available
- Graceful degradation: audio features disabled if orchestrator not available
- All orchestrator method calls now check for null before use

## [2025-11-14 00:05] - Fixed Ambisonic Normalization for Physical Accuracy
### Fixed
- **Corrected ambisonic encoding normalization to SN3D standard**
  - Fixed `AMBISONIC.WEIGHTS.DIRECTIONAL` from incorrect 1.732 (√3, N3D) to correct 1.0 (SN3D)
  - Fixed `AMBISONIC.NORMALIZATION` constant from 'N3D' to 'SN3D' to match implementation
  - Removed all artificial gain scaling (0.3x, 0.5x) from IR modes - now physically accurate
  - Restored unity gain (1.0) in all IR mode convolution chains
  - Limiter remains at -3dB threshold for safety without compromising physical accuracy

**Root Cause Analysis:**
The excessive volume in IR modes was caused by **incorrect ambisonic normalization weights**, not by convolution gain. The encoder was using N3D weights (√3 ≈ 1.732) instead of SN3D weights (1.0), amplifying all directional components by 73%.

**Technical Details:**
- **SN3D (Schmidt Semi-Normalized)**: All FOA components (W, X, Y, Z) have weight = 1.0
- **N3D (Fully Normalized)**: FOA directional components have weight = √3 ≈ 1.732
- The code comments claimed SN3D but used N3D weights, causing √3 gain boost
- Now using proper SN3D normalization throughout the pipeline
- Volume range: 0.0 to 10.0 linear gain (physically accurate ±20dB range)
- Limiter: threshold=-3dB, knee=0, ratio=20:1, attack=0ms, release=100ms (unchanged)

**Physical Accuracy Restored:**
- ✅ Ambisonic encoding uses correct SN3D weights
- ✅ Convolution at unity gain (no artificial attenuation)
- ✅ Volume controls map directly to dB SPL without hidden scaling
- ✅ Limiter protects against clipping while preserving signal integrity

## [2025-11-13 23:58] - Enhanced Saturation Prevention [SUPERSEDED]
### Note
This entry documents an incorrect fix that used artificial gain scaling (0.3x) to compensate for normalization errors. The issue has been properly resolved in [2025-11-14 00:05] by fixing the ambisonic normalization instead.

## [2025-11-13 23:55] - Remove Legacy THREE.PositionalAudio Code
### Removed
- **Removed all legacy THREE.PositionalAudio playback code (migration complete)**
  - `frontend/src/lib/three/sound-sphere-manager.ts` - Removed legacy PositionalAudio playback, mute/solo gain nodes, convolver routing, and Resonance Audio service
  - `frontend/src/components/scene/ThreeScene.tsx` - Removed legacy volume and mute/solo effect handlers
  - `frontend/src/lib/three/scene-coordinator.ts` - Cleaned up migration comments
  - All audio now exclusively routed through AudioOrchestrator
  - Dummy PositionalAudio objects retained only for scheduler metadata compatibility

### Changed
- **SoundSphereManager now requires AudioOrchestrator**
  - Constructor throws error if AudioOrchestrator or AudioContext is null
  - Enforces AudioOrchestrator dependency from initialization

### Removed Methods
- `SoundSphereManager.setConvolverNode()` - IR convolution now handled by AudioOrchestrator
- `SoundSphereManager.setResonanceAudioService()` - Resonance Audio now handled by AudioOrchestrator ResonanceMode
- `SoundSphereManager.createResonanceAudioSources()` - Obsolete after AudioOrchestrator migration
- `SoundSphereManager.updateVolumes()` - Volume control now exclusively via AudioOrchestrator
- `SoundSphereManager.updateMuteSoloStates()` - Mute/solo now exclusively via AudioOrchestrator

**Technical details:**
- Legacy mute/solo GainNodes removed - AudioOrchestrator modes handle mute/solo internally
- Convolver routing removed - IR modes manage convolution chains
- Resonance Audio service removed - ResonanceMode encapsulates all Resonance Audio functionality
- Dummy PositionalAudio objects still created for PlaybackSchedulerService metadata (buffer, position, userData)

## [2025-11-13 23:45] - Mono IR Mode Mute/Solo Fix
### Fixed
- **Mono IR: Mute and Solo controls now working correctly**
  - Fixed audio chain bypass in `playSource` method
  - Was reconnecting nodes and skipping gainNode and muteGainNode
  - Now correctly uses permanent audio chain: convolver → gainNode → muteGainNode → wetGain → encoder
  - Mute and solo now function identically to other IR modes

**Technical details:**
- Root cause: `playSource` was calling `chain.convolver.connect(chain.wetGain)` which created a direct path bypassing volume/mute gain nodes
- Solution: Removed redundant reconnections, rely on permanent chain established in `createSource`
- Audio graph: bufferSource → [permanent chain from createSource] → output

## [2025-11-13 23:30] - IR Mode Audio Quality Fixes
### Fixed
- **Mono IR, Stereo IR, Ambisonic IR: Volume slider minimum now properly silent**
  - Reduced base convolution gain from 1.0 to 0.5 in all IR modes to compensate for convolution energy
  - Applied 0.5 scaling factor to volume control (maintains same range but prevents minimum volume from being audible)
  - Volume slider now properly mutes at minimum position

- **IR Modes: Reduced excessive volume from convolution**
  - Added 0.5x gain compensation in MonoIRMode, StereoIRMode, and AmbisonicIRMode
  - Prevents convolution from boosting signal above intended levels
  - Maintains natural dynamic range while preventing clipping

- **AudioOrchestrator: Added limiter to prevent harsh clipping**
  - Implemented DynamicsCompressorNode as brick-wall limiter at -1dB threshold
  - All audio modes now route through limiter before destination
  - Fast attack (1ms) and release (10ms) for transparent limiting
  - Prevents harsh clipping at maximum volumes or multiple simultaneous sources

- **Ambisonic IR: Fixed reverb feedback loop on pause**
  - Properly disconnect convolver nodes when stopping playback to kill impulse response tail
  - Reconnect convolver chain when resuming playback
  - Prevents infinite reverb buildup when pausing/resuming sounds
  - Applied to both FOA (single convolver) and SOA/TOA (multi-mono convolvers)

**Technical details:**
- Limiter configuration: threshold=-1dB, knee=0, ratio=20:1, attack=1ms, release=10ms
- IR gain compensation: 0.5x base gain, 0.5x volume scaling → effective 0.25x at unity volume
- Volume range: 0.0 to 5.0 linear gain (was 0.0 to 10.0, scaled down by 0.5)
- Convolver disconnect strategy: Disconnect on stop, reconnect on play

## [2025-11-13 23:00] - Complete Volume/Mute/Solo Implementation for All Audio Modes
### Fixed
- **Volume, mute, solo, and global volume controls fully functional in all audio modes**
  - `frontend/src/lib/audio/modes/StereoIRMode.ts` - Implemented full volume/mute controls with gainNode and muteGainNode in both binaural and speaker interpretation modes
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts` - Implemented full volume/mute controls for FOA/SOA/TOA ambisonic IR convolution
  - `frontend/src/lib/audio/modes/AnechoicMode.ts` - Fixed master gain pipeline connection (mixerOutput → masterGain → output)
  - `frontend/src/lib/audio/modes/BasicMixerMode.ts` - Raised volume clamp from 1.0 to 10.0 (allows +20dB boost)
  - `frontend/src/lib/audio/modes/ResonanceMode.ts` - Raised volume clamp from 1.0 to 10.0
  - `frontend/src/lib/audio/modes/MonoIRMode.ts` - Raised volume clamp from 1.0 to 10.0

**Bug fixes resolved:**
- ✅ Fixed volume clamping - now allows volumes up to +20dB (gain 10.0) instead of limiting at 70dB baseline
- ✅ Fixed Spatial Anechoic global volume - master gain now properly connected in audio pipeline
- ✅ Fixed Stereo IR mute/solo/volume - added gainNode → muteGainNode chain for both binaural and speaker modes
- ✅ Fixed Ambisonic IR all controls - added gain chain to FOA convolver and multi-mono SOA/TOA convolvers

**Audio graph architecture:**
- StereoIRMode: bufferSource → convolver → gainNode → muteGainNode → [binaural gain OR splitter+encoders]
- AmbisonicIRMode (FOA): bufferSource → foaConvolver → gainNode → muteGainNode → wetGain → ambisonicMerger
- AmbisonicIRMode (SOA/TOA): bufferSource → monoConvolvers → convolverMerger → gainNode → muteGainNode → wetGain → ambisonicMerger

## [2025-11-13 22:30] - Volume/Mute/Solo Controls Fix for AudioOrchestrator
### Fixed
- **Volume, mute, solo, and global volume controls now work across all audio modes**
  - `frontend/src/lib/audio/core/interfaces/IAudioMode.ts` - Added `setSourceVolume()`, `setSourceMute()`, and `setMasterVolume()` methods to interface
  - `frontend/src/lib/audio/modes/BasicMixerMode.ts` - Implemented volume/mute controls with separate gain nodes (gainNode for volume, muteGainNode for mute)
  - `frontend/src/lib/audio/modes/AnechoicMode.ts` - Added volume/mute controls to ambisonic encoding pipeline
  - `frontend/src/lib/audio/modes/ResonanceMode.ts` - Added volume/mute gain nodes in audio chain
  - `frontend/src/lib/audio/modes/MonoIRMode.ts` - Implemented volume/mute in convolution + ambisonic pipeline
  - `frontend/src/lib/audio/modes/StereoIRMode.ts` - Added stub methods (master volume implemented)
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts` - Added stub methods (master volume implemented)
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Added `setSourceVolume()`, `setSourceMute()`, and `setMasterVolume()` wrapper methods
  - `frontend/src/components/scene/ThreeScene.tsx` - Connected volume/mute/solo/globalVolume state to AudioOrchestrator effects

**Implementation details:**
- Each audio mode now has separate gain nodes for volume and mute control (won't interfere with each other)
- Volume control: converts dB SPL to linear gain and applies via gainNode
- Mute control: uses separate muteGainNode (0.0 = muted, 1.0 = audible)
- Solo control: mutes all sources except the soloed one
- Global volume: applies master gain at the mode level
- All controls work in all audio modes (Anechoic, BasicMixer, Resonance, Mono IR, etc.)
- No use of THREE.PositionalAudio - all audio routing through AudioOrchestrator

## [2025-11-13 21:00] - Replace ThreeJSMode with BasicMixerMode
### Changed
- **Replaced spatial audio mode with basic mixer** - Simplified audio workflow to basic mono mixing
  - `frontend/src/lib/audio/modes/BasicMixerMode.ts` - NEW: Simple mono sources → individual gains → master gain (no spatial audio)
  - `frontend/src/lib/audio/modes/ThreeJSMode.ts` - DELETED: Removed Web Audio PannerNode spatial audio mode
  - `frontend/src/lib/audio/AudioOrchestrator.ts` - Updated to use BasicMixerMode instead of ThreeJSMode
  - `frontend/src/types/audio.ts` - Replaced `NO_IR_THREEJS` with `BASIC_MIXER` in AudioMode enum
  - `frontend/src/lib/audio/utils/mode-selector.ts` - Updated NoIRPreferences type and mode selection logic
  - `frontend/src/lib/constants.ts` - Updated mode configuration for basic_mixer
  - `frontend/src/components/audio/AudioRenderingModeSelector.tsx` - Updated to use 'basic_mixer' instead of 'threejs'
  - `frontend/src/components/audio/SpatialModeSelector.tsx` - Updated to use 'basic_mixer' instead of 'threejs'

**Key changes:**
- NO spatial information, NO panning, NO Ambisonics, NO positional audio
- All other modes preserved (Resonance, Anechoic, Mono IR, Stereo IR, Ambisonic IR)
- Simple workflow: mono sources → individual volume gains → global mixer
- Removed all PannerNode, AudioListener, and HRTF references from BasicMixerMode

## [2025-11-13 16:30] - Live Distance Display in Sound UI Overlays
### Added
- **Live distance indicator** in sound UI overlays showing real-time camera-to-sound distance
  - `frontend/src/types/index.ts` - Added `distance?: number` property to `UIOverlay` interface
  - `frontend/src/components/scene/ThreeScene.tsx` - Calculate distance from camera to sound source during animation loop (lines 1222-1296)
  - `frontend/src/components/overlays/SoundUIOverlay.tsx` - Display distance above close button (×) outside overlay box (lines 128-142)

**Display characteristics:**
- Very small text (9px monospace font)
- Positioned above the "×" button, outside the overlay box
- Semi-transparent white with text shadow for readability
- Shows distance with 1 decimal place (e.g., "12.3m")
- Updates live during camera movement AND when sound sources are moved
- Works for both entity-linked and free-floating sound sources

### Fixed
- `frontend/src/components/scene/ThreeScene.tsx` - Explicitly preserve distance property when rendering overlays (line 1849) to ensure distance updates propagate correctly when sound sources are dragged

## [2025-11-13] - Constants Cleanup - Removed Unused and Duplicate Constants
### Removed Unused Constants
**Summary:** Comprehensive cleanup of `frontend/src/lib/constants.ts` to remove unused constant groups and duplicate definitions. Reduced file size by ~160 lines while maintaining all actively used functionality.

### Constant Groups Removed (Never Imported)
1. **MACH1** (67 lines) - Comprehensive Mach1 Spatial Audio configuration
   - Platform types, decode algorithms, filter settings, encoding positions, performance settings
   - Never referenced in codebase - future feature placeholder

2. **WAVEFORM_RENDERING** (10 lines) - Alternative waveform constants
   - Duplicate of AUDIO_VISUALIZATION (which is actively used)
   - Removed in favor of AUDIO_VISUALIZATION

3. **WAVEFORM_COLORS** (5 lines) - Waveform color definitions
   - Never imported or used

4. **SVG_STROKE** (5 lines) - SVG stroke width constants
   - Only used once, replaced inline with literal "2" in SVG_ICON_PROPS.STROKE_WIDTH

5. **ROTATION_CONFIG** (15 lines) - First-person rotation speeds
   - Yaw/pitch speeds, pitch limits, mouse sensitivity
   - Feature not implemented

6. **FIRST_PERSON_MODE** (17 lines) - First-person camera configuration
   - Default ear height, initial orientation, UI feedback settings
   - Feature not implemented

### Individual Constants Removed
**Duplicate SED (Sound Event Detection) constants** (never imported):
- `SED_DEFAULT_SPL_CONVERSION = 70.0` - duplicate of `DEFAULT_SPL_DB = 70` (used)
- `SED_DEFAULT_DURATION = 5.0` - duplicate of `DEFAULT_DURATION_SECONDS = 5` (used)
- `SED_DEFAULT_INTERVAL_SECONDS = 30.0` - unused
- `SED_DEFAULT_STEPS = 50` - unused
- `SED_ZERO_CONFIDENCE_THRESHOLD = 0` - unused

**Unused range constants**:
- `SPL_MIN_DB = 30`, `SPL_MAX_DB = 85`, `SPL_RANGE = 55`, `DBFS_RANGE = 57`
  - Superseded by `UI_VOLUME_SLIDER.MIN/MAX` (actively used)
- `INTERVAL_MIN_SECONDS = 5`, `INTERVAL_MAX_SECONDS = 120`
- `DURATION_MIN_SECONDS = 1`, `DURATION_MAX_SECONDS = 30`

**Other removed constants**:
- `DEFAULT_INTERVAL_BETWEEN_SOUNDS = 0` - Removed, value inlined into `LLM_SUGGESTED_INTERVAL_SECONDS`

### Constants Kept (Despite Initial Analysis Showing Unused)
After TypeScript compilation, the following constants were **restored** because they ARE actively used:
- `PRIMARY_COLOR`, `PRIMARY_COLOR_HEX` - Used in geometry-renderer.ts, materials.ts, sound-sphere-manager.ts, waveform-utils.ts
- `DEFAULT_SOUND_CONFIG` - Used in event-factory.ts
- `AUDIO_PLAYBACK.DEFAULT_INTERVAL_SECONDS` - Used in playback-scheduler-service.ts (3 locations)
- `RT60_ANALYSIS` - Used in rt60-analysis.ts
- `AUDIO_MODE_UI` - Used in IRManagementPanel.tsx

### Files Modified
1. `frontend/src/lib/constants.ts`
   - Removed 6 unused constant groups (~119 lines)
   - Removed 13 unused individual constants (~41 lines)
   - Inlined literal value "2" for SVG_STROKE_WIDTH
   - Inlined value 0 for LLM_SUGGESTED_INTERVAL_SECONDS
   - **Total reduction: ~160 lines**
   - **No breaking changes** - TypeScript compilation successful
   - **Final line count: 1267 lines (from original ~1427 lines)**

### Impact
- ✅ Reduced file size by ~11% (from ~1427 lines to 1267 lines)
- ✅ Eliminated duplicate SED constants and unused range definitions
- ✅ Removed unimplemented feature placeholders (MACH1, ROTATION_CONFIG, FIRST_PERSON_MODE)
- ✅ Improved code maintainability
- ✅ No impact on functionality - TypeScript compilation passes
- ✅ All actively used constants preserved

### Constants Kept (Actively Used)
- UI design system (`UI_COLORS`, `UI_BUTTON`, `UI_INPUT`, etc.)
- Audio configuration (`AMBISONIC`, `RESONANCE_AUDIO`, `STEREO_SPEAKER`, `RT60_ANALYSIS`, `AUDIO_MODE_UI`)
- Sound generation (`DEFAULT_DURATION_SECONDS`, `DEFAULT_SPL_DB`, `DEFAULT_SOUND_CONFIG`, etc.)
- Timeline/playback (`AUDIO_TIMELINE`, `WAVESURFER_TIMELINE`, `AUDIO_PLAYBACK`)
- Scene configuration (`CAMERA_CONFIG`, `SOUND_SPHERE`, etc.)
- File types (`MODEL_FILE_EXTENSIONS`, `AUDIO_FILE_EXTENSIONS`)
- Legacy exports (`PRIMARY_COLOR`, `PRIMARY_COLOR_HEX`) - still in use, migration needed

---

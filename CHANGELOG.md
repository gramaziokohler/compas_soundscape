# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed - [2025-10-21] - 3D Controls UI Repositioned

**Changes**:
- **Moved 3D controls info to bottom-left of 3D scene** (previously in sidebar)
- **Minimalistic, compact design** with no background
- Fixed position overlay with `text-[10px]` size
- Non-interactive (`pointer-events-none`) to avoid blocking scene interaction
- Shortened control descriptions for compactness:
  - "Left click + drag: Rotate view" → "Left click + drag: Rotate"
  - "Double-click receiver (blue cube): First-person view" → "Double-click cube: First-person"
  - "ESC: Exit first-person mode" → "ESC: Exit mode"

**Files Changed**:
- `frontend/src/components/layout/sidebar/ControlsInfo.tsx`:
  - Changed from sidebar component to scene overlay component
  - Removed border, background, and heading
  - Reduced text size and spacing for minimal footprint
  - Updated positioning to `absolute bottom-6 left-6`
- `frontend/src/components/scene/ThreeScene.tsx`:
  - Added `ControlsInfo` import and render
  - Positioned as overlay in scene container
- `frontend/src/components/layout/Sidebar.tsx`:
  - Removed `ControlsInfo` import and usage

**Technical Details**:
- Uses Tailwind classes: `text-[10px]`, `space-y-0.5`, `leading-tight`
- Positioned to avoid collision with playback controls (bottom-center) and control buttons (bottom-right)

---

### Changed - [2025-10-21] - Receiver Visual Updates & Display Name Trimming

**Changes**:
1. **Receivers now render as cubes instead of spheres** for better visual distinction from sound sources
   - Uses same sizing logic as sound spheres (0.3 * scaleForSounds)
   - Blue color (sky-500: #0ea5e9) maintained for consistency
   - Applied to both placed receivers and preview during placement mode

2. **Display names trimmed to 5 words maximum** to prevent UI clutter
   - Applies to 3D scene overlays and sidebar titles
   - Names longer than 5 words are truncated with "..." suffix
   - Affects all display names from text generation, library sounds, and uploaded audio

3. **Updated UI controls documentation** to reflect cube shape (was "sphere")

**Files Changed**:
- `frontend/src/components/scene/ThreeScene.tsx`:
  - Changed receiver geometry from `SphereGeometry` to `BoxGeometry`
  - Updated preview receiver to use cube geometry
  - Applied `trimDisplayName` to overlay display names
  - Updated comments: "receiver sphere" → "receiver cube"
- `frontend/src/lib/utils.ts`:
  - Added `trimDisplayName` utility function
- `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`:
  - Applied `trimDisplayName` to sidebar tab titles
- `frontend/src/components/layout/sidebar/ControlsInfo.tsx`:
  - Updated controls text: "blue sphere" → "blue cube"

**Technical Details**:
- `trimDisplayName`: Splits name by whitespace, takes first 5 words, adds "..." if truncated
- Cube size calculation: `0.3 * scaleForSounds` (matches sound sphere radius formula)
- DragControls already prevents scene rotation during drag (OrbitControls disabled on dragstart)

---

### Changed - [2025-10-21] - Receiver First-Person View Rotation

**Issue**:
Mouse-based rotation from receiver perspective was difficult to control and not working well.

**Solution**:
Replaced mouse drag rotation with arrow key rotation for better control in first-person view:
- Arrow Left/Right: Rotate view horizontally (yaw)
- Arrow Up/Down: Rotate view vertically (pitch)
- Rotation happens around the receiver's fixed position
- Smooth rotation with appropriate speed (0.05 rad/keypress for horizontal, 0.03 rad/keypress for vertical)
- Pitch clamped to ±90° to prevent camera flipping
- ESC key exits first-person mode

**Files Changed**:
- `frontend/src/components/scene/ThreeScene.tsx`:
  - Replaced mouse drag rotation handlers with arrow key rotation in `handleKeyDown`
  - Changed rotation from spherical coordinates (theta/phi) to yaw/pitch for clearer semantics
  - Simplified animation loop rotation calculation
  - Removed mouse down/up/move rotation event listeners
  - Updated ESC key handler to exit first-person mode
- `frontend/src/components/layout/sidebar/ControlsInfo.tsx`:
  - Added controls explanation for first-person mode
  - Listed arrow key controls and ESC to exit

**Technical Details**:
- Rotation uses yaw (horizontal) and pitch (vertical) angles converted to direction vector
- Direction vector: `[sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)]`
- Camera position locked at receiver, lookAt target calculated from direction
- Arrow keys provide discrete rotation steps for precise control

---

### Fixed - [2025-10-20 18:30] - Receiver Dragging & Camera First-Person View

**Issue**: 
1. Receiver spheres were not draggable during drag operations
2. Camera rotation after double-clicking receiver had severe resistance - nearly impossible to rotate

**Root Cause**:
1. **Receiver Dragging**: DragControls was being recreated mid-drag when `onUpdateReceiverPosition` triggered re-renders, disposing the active DragControls instance
2. **Camera Rotation Resistance**: The combination of distance constraints (`minDistance = maxDistance`) and position locking created a double-constraint that made OrbitControls nearly unable to calculate new camera orientations. OrbitControls needs freedom to move the camera temporarily before we lock it back.

**Solution**:
1. **Receiver Dragging**: Added `isDraggingRef` to track active drag state and prevent `setupDragControls()` from recreating DragControls during drag
2. **Smooth First-Person Rotation**: 
   - **Removed distance constraints entirely** - let OrbitControls work freely
   - Set target very close to camera (1 unit) for natural first-person feel
   - Order: `controls.update()` first (calculate new orientation) → then lock position
   - Disabled damping for immediate response
   - This allows OrbitControls to freely calculate rotation while position is locked each frame

**Files Changed**:
- `frontend/src/components/scene/ThreeScene.tsx`:
  - Added `isDraggingRef` to track drag state
  - Added `lockedReceiverPositionRef` to track locked camera position
  - Modified `setupDragControls()` to skip setup during active drag
  - Animation loop: `controls.update()` FIRST, then lock position (allows rotation calculation)
  - Double-click handler: No distance constraints, very short target distance (1 unit), disabled damping
  - Updated `handleResetZoom` and `handleKeyDown` to reset damping and distance constraints
  - Enhanced DragControls logging for better debugging

**Technical Details**:
- **Drag Issue**: React re-renders during drag caused receiver effect to run → `setupDragControls()` called → DragControls disposed and recreated → drag interrupted
- **Solution**: Guard `setupDragControls()` with `isDraggingRef` to prevent recreation during active drag
- **Rotation Resistance Root Cause**: 
  - `minDistance = maxDistance = X` constrained OrbitControls to a fixed sphere
  - Position lock every frame added second constraint
  - Double constraint = OrbitControls couldn't calculate valid camera positions = sluggish/stuck
- **Solution**: 
  - Remove distance constraints (let OrbitControls move camera freely during calculation)
  - Let `controls.update()` calculate new orientation based on mouse input
  - Then lock position back to receiver each frame
  - Result: OrbitControls can rotate freely, position is locked only at render time

### Added - Acoustic Receivers & Tab Reorganization (2025-10-20 Session 5 + Fixes v5)

**Session Description**: Implemented acoustic receiver spheres with click-to-place functionality, draggable positioning after placement, camera lock at receiver position with smooth rotation, and reorganized sidebar with streamlined Acoustics tab.

**Key Features**:
1. **Receiver Spheres** (Click-to-Place + Draggable):
   - Blue spheres (distinct from pink sound spheres, color: sky-500 #0ea5e9)
   - **Placement**: Click "Create Receiver" → Transparent preview follows mouse → Click to place (ESC to cancel)
   - **Dragging**: After placement, receivers are fully draggable (unified DragControls with sound spheres)
   - Placement at horizontal plane (y=1.6m ear height)
   - **Double-click** → Camera **locks** at receiver position (x,y,z fixed), looks at sound spheres average
   - **Rotation after lock** → Free rotation around sound spheres, camera position stays locked at receiver
   - **Unlock camera** → ESC key or reset zoom button (clicking elsewhere removed)
   - Real-time position display in sidebar (updated via drag/placement)

2. **Streamlined Acoustics Tab**:
   - Third tab in sidebar: Analysis | Sound Generation | **Acoustics**
   - Horizontally scrollable tabs without visible scrollbar
   - **Receivers Section**: Direct UI (no grey box/collapsible), create/list/rename/delete receivers
   - **Auralization Section**: Direct UI (removed collapsible wrapper), moved from Sound Generation tab
   - Clean, consistent styling matching Analysis tab layout

3. **Global UI Improvements**:
   - All vertical scrollbars hidden throughout the application (CSS `scrollbar-width: none`)

**Files Created**:
- [frontend/src/types/receiver.ts](frontend/src/types/receiver.ts): ReceiverData and ReceiverOverlay types
- [frontend/src/hooks/useReceivers.ts](frontend/src/hooks/useReceivers.ts): Receiver state management with placing mode
- [frontend/src/components/layout/sidebar/ReceiversSection.tsx](frontend/src/components/layout/sidebar/ReceiversSection.tsx): Receivers UI section
- [frontend/src/components/layout/sidebar/AcousticsTab.tsx](frontend/src/components/layout/sidebar/AcousticsTab.tsx): Combined Acoustics tab component

**Files Modified**:
- [frontend/src/types/index.ts](frontend/src/types/index.ts): Export receiver types, add 'acoustics' to ActiveTab
- [frontend/src/components/scene/ThreeScene.tsx](frontend/src/components/scene/ThreeScene.tsx):
  - Added receiver sphere rendering with blue material (**now draggable**)
  - Implemented transparent preview sphere for click-to-place mode
  - `mousemove` handler updates preview position via raycasting to horizontal plane
  - `click` handler places receiver at preview position when in placing mode
  - `keydown` handler (ESC) cancels placement mode
  - Double-click detection with 300ms timeout
  - **FIXED v3-v4: Camera position lock** - Camera position locked at receiver via animation loop enforcement
  - **FIXED v3-v4: Unified DragControls** - Separate effect for DragControls (works with receivers-only or sounds-only)
  - Added `lockedCameraPositionRef` to track locked camera position
  - Animation loop enforces locked position every frame: `camera.position.copy(lockedCameraPositionRef.current)`
  - **v4: Zoom also disabled** when camera locked (`controls.enableZoom = false`) for smoother rotation
  - Pan and zoom disabled when locked, lock set BEFORE controls.target update
  - ESC key or reset zoom unlocks camera and re-enables pan/zoom (clicking elsewhere removed)
  - New effect for preview sphere lifecycle (created/destroyed based on `isPlacingReceiver`)
  - Added `receiverDraggableObjectsRef` to track draggable receiver meshes
- [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx):
  - Added horizontally scrollable tabs container with `scrollbar-hide` class
  - Removed AuralizationSection from Sound Generation tab
  - Added Acoustics tab with direct UI (no wrappers)
  - Updated receiver props: `isPlacingReceiver`, `onStartPlacingReceiver` (changed from `onCreateReceiver`)
- [frontend/src/components/layout/sidebar/ReceiversSection.tsx](frontend/src/components/layout/sidebar/ReceiversSection.tsx):
  - **FIXED: Removed grey box and padding**, direct content rendering
  - Button text changes based on `isPlacingReceiver` state
  - Help text updated to explain click-to-place workflow
- [frontend/src/components/layout/sidebar/AuralizationSection.tsx](frontend/src/components/layout/sidebar/AuralizationSection.tsx):
  - **FIXED: Removed collapsible wrapper and grey box**
  - Direct content rendering (no header/expand/collapse)
  - Removed `isExpanded` state (always visible)
- [frontend/src/components/layout/sidebar/AcousticsTab.tsx](frontend/src/components/layout/sidebar/AcousticsTab.tsx):
  - Added "Auralization" heading wrapper for AuralizationSection
  - Increased gap between sections (gap-6)
- [frontend/src/app/globals.css](frontend/src/app/globals.css):
  - Added `.scrollbar-hide` utility class (cross-browser)
  - **FIXED: Added global scrollbar hiding** (`* { scrollbar-width: none }` for all elements)
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx):
  - Integrated useReceivers hook
  - Passed placing mode props to Sidebar and ThreeScene
  - Added `onPlaceReceiver`, `isPlacingReceiver`, `onCancelPlacingReceiver` to ThreeScene

**Technical Details**:
- **Click-to-Place Workflow**:
  - `isPlacingReceiver` state activates preview mode
  - Preview sphere created with 50% opacity, follows mouse via `mousemove` + raycasting against horizontal plane
  - OrbitControls disabled during placement to prevent camera rotation
  - Click → `onPlaceReceiver` called with preview position, creates actual receiver
  - ESC key → `onCancelPlacingReceiver` cancels placement mode
- **Camera Lock Logic (FIXED v3-v5)**:
  - Raycaster checks receiver intersection first (priority over entity selection)
  - Double-click detection: `clickCount` + 300ms timeout
  - Camera position set to receiver position and **locked** via `lockedCameraPositionRef`
  - Camera looks at sound spheres average (or 5 units forward if none)
  - OrbitControls target = sound spheres average (allows rotation around it)
  - Animation loop enforces lock: `if (lockedCameraPositionRef.current) camera.position.copy(...)`
  - Pan and zoom disabled when locked to prevent camera movement
  - **v5 Rotation Fix**: Explicitly remove rotation restrictions (lines 360-363):
    - `controls.minAzimuthAngle = -Infinity` (horizontal rotation left)
    - `controls.maxAzimuthAngle = Infinity` (horizontal rotation right)
    - `controls.minPolarAngle = 0` (vertical rotation up)
    - `controls.maxPolarAngle = Math.PI` (vertical rotation down)
    - Allows full 360° rotation around target point
  - **Unlock triggers (v4 updated)**: ESC key, reset zoom → clears lock + re-enables pan/zoom (click elsewhere removed)
- **Unified DragControls (FIXED v3-v4-v5)**:
  - **v3 Problem**: Separate DragControls for sounds and receivers caused conflict (receivers barely moved)
  - **v3 Solution**: Single DragControls instance in sound spheres effect
  - **v4 Problem**: DragControls only ran when sounds exist (receivers-only didn't work)
  - **v4 Solution**: Separate effect for DragControls that depends on BOTH sounds and receivers
  - **v5 Problem**: DragControls effect still didn't work for receivers-only (same trigger as receiver creation)
  - **v5 Root Cause**: Both receiver creation effect and DragControls effect had `receivers` dependency, but effects with same dependencies run in unpredictable order. DragControls could run before `receiverDraggableObjectsRef.current` was populated.
  - **v5 Solution**: Converted DragControls to `useCallback` helper function, called directly from both sound and receiver effects AFTER mesh creation
  - Combined array: `[...draggableObjectsRef.current, ...receiverDraggableObjectsRef.current]`
  - Function called at end of sound spheres effect (line 1056) and receiver spheres effect (line 1103)
  - Drag event checks `userData.promptKey` (sound) or `userData.receiverId` (receiver)
  - Calls appropriate position update handler based on object type
- **Inline Editing**: Double-click receiver name to edit (Enter saves, Escape cancels)
- **Separation of Concerns**: `useReceivers` hook handles state, ThreeScene renders spheres, ReceiversSection provides UI

**Styling Consistency**:
- Receiver color: `0x0ea5e9` (sky-500 blue) to distinguish from sound spheres (pink)
- Button styling: bg-primary hover:bg-primary-hover (consistent with existing buttons)
- **Direct UI**: No grey boxes or collapsible wrappers in Acoustics tab (matches Analysis tab)
- Tab styling: Uses existing border-b-2 border-primary active state
- Global scrollbar hiding for cleaner UI

**Bug Fixes**:
- **v1 Issue**: Camera couldn't rotate after double-click (target was at camera position)
- **v1 Fix**: Set orbit target 5 units in front of camera using world direction
- **v2 Issue**: Receivers not draggable after placement
- **v2 Fix**: Added DragControls to receivers using same pattern as sound spheres
- **v3 Issue #1**: Camera position not locked (moved when rotating after double-click)
- **v3 Fix #1**: Animation loop enforces locked position every frame, pan disabled
- **v3 Issue #2**: Receiver dragging barely worked (conflict between two DragControls)
- **v3 Fix #2**: Unified DragControls handles both sounds and receivers in single instance
- **v4 Issue #1**: Receiver dragging only worked when sounds exist in scene
- **v4 Fix #1**: Moved DragControls to separate effect that depends on both sounds and receivers
- **v4 Issue #2**: Camera rotation very buggy/difficult after double-click on receiver
- **v4 Fix #2**: Disabled zoom when locked, set lock BEFORE target update, proper control order
- **v4 Issue #3**: Clicking elsewhere unlocked camera (unintended)
- **v4 Fix #3**: Removed click-elsewhere unlock trigger, only ESC and reset zoom unlock
- **v5 Issue #1**: Receiver dragging not working when receivers-only (no sounds in scene)
- **v5 Fix #1**: Converted DragControls effect to useCallback helper function called directly after mesh creation
- **v5 Issue #2**: Camera rotation restricted to ~10 degrees on each side after double-click
- **v5 Fix #2**: Explicitly set rotation angle limits to infinity (minAzimuthAngle/maxAzimuthAngle = -Infinity/Infinity)
### Added - BBC Sound Library Search Integration (2025-10-20 Session 4)

**Session Description**: Implemented complete sound library search feature with BBC Sound Effects integration, enabling users to search 30,000+ professional sounds and use them exactly like uploaded files.

**Backend Implementation**:
1. **Streamlined BBC Service** ([backend/services/bbc_service.py](backend/services/bbc_service.py)):
   - Removed 300+ lines of unnecessary download code
   - Created clean API with `BBCSoundLibrary` class
   - `search(prompt, max_results=5)`: Fuzzy matching on category/description
   - `download_sound(location, output_path)`: Downloads ZIP, extracts WAV
   - Singleton pattern for efficient CSV loading (30k+ entries)
   - Scoring: Category weight 2.0, Description weight 1.0, Threshold: 120

2. **Library Search Router** ([backend/routers/library_search.py](backend/routers/library_search.py)):
   - `POST /api/library/search`: Returns top 5 results with score/duration/category
   - `POST /api/library/download`: Downloads selected sound as WAV
   - `GET /api/library/health`: Health check endpoint
   - Integrated into main FastAPI app

**Frontend Implementation**:
3. **Type Definitions** ([frontend/src/types/index.ts](frontend/src/types/index.ts)):
   - `LibrarySearchResult`: location, description, category, duration, score
   - `LibrarySearchState`: isSearching, results, selectedSound, error
   - Added to `SoundGenerationConfig` for per-tab search state

4. **Sound Generation Hook** ([frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts)):
   - `handleLibrarySearch(index)`: Calls search API, stores results in config
   - `handleLibrarySoundSelect(index, sound)`: Marks sound as selected
   - Updated `handleGenerate()`: Downloads selected sounds, creates sound events
   - Library sounds treated identically to uploaded sounds (blob URLs, same volume/interval defaults)

5. **UI Component** ([frontend/src/components/layout/sidebar/SoundGenerationSection.tsx](frontend/src/components/layout/sidebar/SoundGenerationSection.tsx)):
   - **Search Input + Button**: Disabled when empty or searching
   - **Results List**: Clickable cards showing description, category, duration
   - **Visual Selection**: Selected sound highlighted in primary color
   - **States**: Loading, no results, error messages
   - **Help Text**: Instructions when no search performed

**Workflow**:
1. User selects "Sound Library Search" mode
2. Enters search term (e.g., "urban traffic")
3. Clicks "Search" → API returns 5 best matches
4. User clicks desired sound → Highlights selection
5. Clicks "Generate Sounds" → Downloads WAV, creates sound sphere
6. Playback/controls work identically to uploaded files

**Integration Points**:
- [backend/main.py](backend/main.py): Registered library_search router
- [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx): Added library handlers to props
- [frontend/src/app/page.tsx](frontend/src/app/page.tsx): Connected handlers from hook

**Technical Details**:
- **Search Algorithm**: Fuzzy token set ratio (thefuzz library)
- **Scoring Formula**: `(2.0 × category_score) + (1.0 × description_score)`
- **Download**: Fetches BBC ZIP → Extracts first WAV → Returns as blob
- **Memory**: Object URLs created for downloaded sounds (revoked on cleanup)
- **Volume/Interval**: Defaults to 70dB / 30s (same as uploaded sounds)

**Benefits**:
- Access to 30,000+ professional BBC sound effects
- No manual downloads required
- Seamless integration with existing upload workflow
- Same playback controls, volume, interval settings
- Fast search with relevance scoring

### Fixed - Uploaded Sound Playback & Control Issues (2025-10-20 Session 3)

**Session Description**: Fixed critical playback issues where uploaded sounds had zero volume and weren't included in Play All functionality.

**Issues Fixed**:
1. **Zero Volume on Uploaded Sounds (Critical)**:
   - **Problem**: Uploaded sounds defaulted to `volume_db: 0`, making them inaudible
   - **Root Cause**: Line 29 in useSoundGeneration.ts used `|| 0` instead of `?? 70`
   - **Impact**: Users couldn't hear uploaded sounds even with volume slider at max
   - **Solution**: Changed default from `0` to `70 dB` (matching TTA-generated sounds)
   - **Files Modified**: [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts):190

2. **Zero Playback Interval (Critical)**:
   - **Problem**: Uploaded sounds defaulted to `interval_seconds: 0`, causing rapid looping issues
   - **Root Cause**: Same line used `|| 0` instead of proper default
   - **Solution**: Changed default from `0` to `30 seconds` (matching TTA sounds)
   - **Files Modified**: [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts):192

**Uniformity Verification** (All Sound Controls Work Across All Modes):
- ✅ **Volume Control**: Works uniformly (ThreeScene.tsx:1168-1180)
- ✅ **Playback Interval**: AudioScheduler handles all types equally
- ✅ **Play All Button**: Groups by prompt_index, works for all modes (useAudioControls.ts:97-124)
- ✅ **Individual Play/Pause**: Uses soundId map, no type discrimination (useAudioControls.ts:25-34)
- ✅ **Pause All / Stop All**: Works across all sound types (useAudioControls.ts:129-154)
- ✅ **Volume Slider**: Applied via soundVolumes state map uniformly
- ✅ **Interval Slider**: AudioScheduler.updateInterval() for all types
- ✅ **Audio Loading**: Handles both blob: URLs (uploaded) and backend URLs (TTA) (ThreeScene.tsx:863)

**Technical Fix**:
```typescript
// Before: Silent uploaded sounds
volume_db: config.spl_db || 0,           // Defaults to 0 (silent)
interval_seconds: config.interval_seconds || 0,  // Defaults to 0 (no interval)

// After: Audible uploaded sounds with proper interval
volume_db: config.spl_db ?? 70,          // Defaults to 70 dB (audible)
interval_seconds: config.interval_seconds ?? 30, // Defaults to 30s (standard)
```

**Code Quality**:
- **Consistency**: All sound types now have identical default values
- **Logic**: Changed from falsy check (`||`) to nullish check (`??`) for proper 0-value handling
- **Uniformity**: No special cases - all sound types treated equally by playback system

**Breaking Changes**: None - fixes bugs, doesn't change API

### Fixed - Sound Generation Mode System Improvements (2025-10-20 Session 2)

**Session Description**: Fixed critical workflow collisions, updated Auralization UI consistency, and added safeguards for mode switching.

**Issues Fixed**:
1. **Sound Variant Collision (Critical)**:
   - **Problem**: Generating uploaded sound at index 0, then TTA sound at index 1 created TTA as variant of uploaded sound
   - **Root Cause**: Backend returns `prompt_index` based on filtered array order, not original `soundConfigs` indices
   - **Solution**: Track original indices through entire generation pipeline, map backend response correctly
   - **Files Modified**: [frontend/src/hooks/useSoundGeneration.ts](frontend/src/hooks/useSoundGeneration.ts) (lines 65-141)

2. **Auralization UI Inconsistency**:
   - **Problem**: Auralization section used different upload UI (button) instead of drag-and-drop
   - **Solution**: Replaced with `FileUploadArea` component for consistency
   - **Benefits**: Consistent UX, drag-and-drop support, matches Sound Generation Upload mode
   - **Files Modified**: [frontend/src/components/layout/sidebar/AuralizationSection.tsx](frontend/src/components/layout/sidebar/AuralizationSection.tsx)

**Workflow Collision Audit** (All 10 Scenarios Tested):
- ✅ **Scenario 1**: Upload → Add Tab → Generate TTA - FIXED with index mapping
- ✅ **Scenario 2**: Multiple modes in same generation - SAFE (separate filters)
- ✅ **Scenario 3**: Mode switch without clearing data - SAFE (filter checks mode + data)
- ✅ **Scenario 4**: TTA to Upload with prompt - SAFE (mode determines workflow)
- ✅ **Scenario 5**: Re-generate after partial success - WORKING AS DESIGNED
- ✅ **Scenario 6**: Delete tab after generation - WORKING AS DESIGNED (must regenerate)
- ✅ **Scenario 7**: Mode change with uploaded file - SAFE (uploadedAudioUrl check)
- ✅ **Scenario 8**: Clear audio in wrong mode - SAFE (UI prevents)
- ✅ **Scenario 9**: Empty prompts with mixed modes - SAFE (prompt validation)
- ✅ **Scenario 10**: Library mode without API - SAFE (placeholder logs only)

**Safeguards Added**:
- **Mode Switch Cleanup**: When switching from Upload mode to another mode, uploaded audio is automatically cleared (memory freed, state cleaned)
- **Index Mapping**: All modes (TTA, Upload, Library) track `originalIndex` separately from filtered array indices
- **Validation**: Each mode validates its required fields (prompt, uploadedAudioUrl, etc.)

**Technical Implementation**:
```typescript
// Before: Simple filter by mode
const uploadedConfigs = soundConfigs.filter(config => config.mode === 'upload');

// After: Track original indices through pipeline
const uploadedConfigsWithIndices = soundConfigs
  .map((config, idx) => ({ config, originalIndex: idx }))
  .filter(({ config }) => config.mode === 'upload' && config.uploadedAudioUrl);

// Map backend response back to original indices
const actualOriginalIndex = generationConfigsWithIndices[backendIndex]?.originalIndex ?? backendIndex;
```

**Code Quality**:
- **DRY**: FileUploadArea reused in Auralization section
- **Defensive**: Mode switching cleans up resources (revokeAudioUrl)
- **Type-Safe**: All indices properly typed and validated
- **Memory-Safe**: Object URLs revoked when no longer needed

**Breaking Changes**: None - backward compatible

### Added - Sound Generation Mode System (2025-10-20)

**Session Description**: Restructured Sound Generation Section with 3 distinct modes accessible via dropdown menu, enabling flexible workflows for text-to-audio generation, file upload, and library search.

**Files Created**:
- **Reusable Upload Component** (`frontend/src/components/controls/FileUploadArea.tsx`): Generic drag-and-drop file upload UI
  - Extracted from ModelLoadSection for reusability (DRY principle)
  - Props: file, isDragging, acceptedFormats, acceptedExtensions, handlers
  - Features: Drag-and-drop, click-to-browse, file info display, dynamic styling
  - Configurable via props for different contexts (model upload, sound upload, etc.)

**Files Modified**:
- **Types** (`frontend/src/types/index.ts`):
  - Added `SoundGenerationMode` type: `'text-to-audio' | 'upload' | 'library'`
  - Added `mode?: SoundGenerationMode` field to `SoundGenerationConfig`
  - Fixed TypeScript import for `SEDAudioInfo` (import before use)
- **Hook** (`frontend/src/hooks/useSoundGeneration.ts`):
  - Added `handleModeChange()` for switching between modes
  - Updated `handleGenerate()` to filter configs by mode:
    - `text-to-audio`: Existing generation workflow
    - `upload`: Uses uploaded audio files (existing upload logic)
    - `library`: Placeholder for future search API (logs search requests)
  - New configs default to `mode: 'text-to-audio'`
- **UI Component** (`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`):
  - **Dropdown Menu** (top-left): 3 mode options with clear labels
    - "Text-to-Audio Generation" (default)
    - "Upload File"
    - "Sound Library Search"
  - **Conditional UI Rendering** based on selected mode:
    - **Mode 1 (Text-to-Audio)**: Prompt textarea + duration/guidance/variants sliders
    - **Mode 2 (Upload)**: FileUploadArea component → Audio info display → Clear button
    - **Mode 3 (Library)**: Prompt textarea only + "API coming soon" message
  - **Removed**: Top-right upload button (now integrated into Mode 2)
  - **Kept**: Remove button (×) on right side, all Advanced Options
- **Integration** (`frontend/src/app/page.tsx`, `frontend/src/components/layout/Sidebar.tsx`):
  - Added `onSoundModeChange` prop with `handleModeChange` handler
  - Proper prop threading through component hierarchy

**UI/UX Improvements**:
- **Cleaner Interface**: Upload functionality moved to dedicated mode (no button clutter)
- **Clear Workflow**: Dropdown explicitly shows what each mode does
- **Future-Ready**: Library search mode prepared for API integration
- **Consistent Styling**: Dropdown matches project design (Tailwind, primary colors)
- **State Preservation**: Mode selection persists per sound tab

**Technical Implementation**:
- **Mode Routing**: `handleGenerate()` separates configs by mode for proper workflow handling
- **Backward Compatibility**: Configs without `mode` default to `'text-to-audio'`
- **Memory Management**: Upload mode still uses object URLs with proper cleanup
- **Error Handling**: Each mode validates inputs appropriately
- **TypeScript Safety**: Full type checking for mode values and props

**Code Quality**:
- **DRY**: FileUploadArea extracted for reuse (no code duplication with ModelLoadSection)
- **SRP**: Each mode has focused UI and clear responsibility
- **Modular**: New component file follows project structure (`components/controls/`)
- **Type Safety**: Strict TypeScript types for mode enum and handlers
- **Maintainable**: Clear separation between mode selection and mode-specific UI

**Future Extension Points**:
- Library search mode ready for API endpoint integration
- Additional modes can be added by extending `SoundGenerationMode` type
- FileUploadArea can be reused in other features

### Added - Per-Sound Audio Upload Feature (2025-10-17 17:00-18:00)

**Session Description**: Implemented upload functionality for individual sounds in the Sound Generation tab, allowing users to import their own audio files and bypass sound generation. Reused existing audio processing utilities from the impulse response feature.

**Files Created**:
- **Audio Upload Utility** (`frontend/src/lib/audio/audio-upload.ts`): Reusable audio file upload and processing functions
  - `loadAudioFile()`: Reads file, decodes to AudioBuffer, creates object URL, extracts metadata
  - `revokeAudioUrl()`: Memory cleanup for object URLs
  - `isValidAudioFile()`: File type validation
  - `formatFileSize()`: Size formatting utility
  - Uses Web Audio API (FileReader + AudioContext.decodeAudioData)
  - Supports all browser-supported formats (wav, mp3, ogg, flac, m4a, etc.)

**Files Modified**:
- **Types** (`frontend/src/types/index.ts`):
  - Added `uploadedAudioBuffer`, `uploadedAudioInfo`, `uploadedAudioUrl` to SoundGenerationConfig
  - Added `isUploaded` flag to SoundEvent interface
- **UI Component** (`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`):
  - Added circular upload button (↑) with styling matching "+" button
  - Replaced "Remove" text button with "×" button in circular style
  - Conditional UI: Shows audio info when uploaded, generation controls when not
  - Audio info display: filename, duration, sample rate, channels, samples (same as impulse response)
  - Hidden file input with accept="audio/*"
  - "Clear Uploaded Audio" button (grey, same as IR clear button)
- **Hook** (`frontend/src/hooks/useSoundGeneration.ts`):
  - `handleUploadAudio()`: Loads audio file using audio-upload utility, updates config with buffer/info/URL
  - `handleClearUploadedAudio()`: Revokes URL, clears audio data from config
  - Updated `handleGenerate()`: Separates uploaded and generation configs, creates SoundEvents for uploaded audio with proper positioning
- **Integration** (`frontend/src/app/page.tsx`, `frontend/src/components/layout/Sidebar.tsx`):
  - Connected upload/clear handlers from hook to UI component
  - Proper prop threading through component hierarchy

**Technical Implementation**:
- Uploaded audio bypasses backend generation completely
- Uses object URLs for audio playback (revoked on clear to prevent memory leaks)
- Positioning: Uses entity position if available, otherwise bounding box center
- SoundEvent created with `isUploaded: true` flag for ThreeScene identification
- Display name defaults to filename (without extension) if not set
- Validation error messages on upload failure

**UI Styling**:
- Upload button: `w-6 h-6` circular, `bg-gray-200 dark:bg-gray-700`, hover effects
- Remove button: `w-6 h-6` circular, red text (`text-red-500`), hover background (`hover:bg-red-50`)
- Buttons positioned together with `gap-2` spacing
- Consistent with existing project styling (Tailwind classes, primary colors)

**Code Quality**:
- **DRY**: Extracted common audio loading logic to `audio-upload.ts` (reusable across features)
- **SRP**: Separate files for upload utilities, separate functions for upload/clear/generate
- **Modular**: New utility file instead of duplicating impulse response code
- **Type Safety**: Full TypeScript types for all new interfaces and props
- **Error Handling**: Try-catch blocks, user-friendly error messages, proper cleanup

**Bug Fixes (2025-10-17 18:00-18:15)**:
- **URL Construction** (`frontend/src/components/scene/ThreeScene.tsx:858-859`): Fixed blob URL handling for uploaded sounds
  - Added check to detect blob: URLs vs backend relative paths
  - Prevents incorrect URL construction like `http://127.0.0.1:8000blob:http://localhost:3000/...`
  - Uploaded sounds now use direct blob URLs without prepending API_BASE_URL
- **Audio Node Disconnect** (`frontend/src/components/scene/ThreeScene.tsx:777-782`): Wrapped disconnect() in try-catch
  - Prevents "Failed to execute 'disconnect' on 'AudioNode'" error
  - Audio nodes may already be disconnected during cleanup, error is expected and now silently handled

### Added - Editable Sound Display Titles (2025-10-17 18:15-18:30)

**Session Description**: Implemented minimalistic inline editing for sound tab titles, allowing users to customize display names without cluttering the UI.

**Implementation Details**:
- **Inline Editing UI** (`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx:55-56, 111-136, 144-179`):
  - Added `editingTabIndex` and `editingValue` state for tracking editing mode
  - Conditional rendering: Input field when editing, button with hover pencil when viewing
  - Pencil icon (✏️) appears on hover with opacity transition (subtle visual hint)
  - Auto-focus on input when entering edit mode

**User Interaction**:
- **Double-click** any sound tab to enter edit mode
- **Enter key** or **blur** (clicking away) to save changes
- **Escape key** to cancel editing without saving
- Pencil icon (✏️) shows on hover to indicate editability
- Input maintains active tab styling (primary color or default)

**Technical Implementation**:
- Uses existing `onUpdateConfig(index, 'display_name', value)` handler (no new hook functions needed)
- `display_name` field already exists in SoundGenerationConfig type
- Local state only for UI (editing state), persistent state via hook
- Input styling matches tab appearance for seamless transition

**UI/UX Benefits**:
- **Minimalistic**: No extra buttons or UI elements in default state
- **Discoverable**: Pencil icon hint on hover, tooltip says "Double-click to edit"
- **Intuitive**: Standard double-click-to-edit pattern
- **Keyboard-friendly**: Enter/Escape shortcuts for power users
- **Clean**: Inline editing maintains compact tab layout
- **Responsive**: minWidth/maxWidth constraints prevent layout shifts

**Code Quality**:
- **DRY**: Reuses existing `onUpdateConfig` handler (no code duplication)
- **SRP**: Edit handlers focused on UI state management only
- **Maintainable**: Simple state machine (view/edit modes)
- **Type-Safe**: TypeScript for all event handlers and state

**Bug Fix (2025-10-17 18:30-18:35)**:
- **Tab Title Overflow** (`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx:145, 160, 167, 174`): Fixed tab titles wrapping to multiple lines
  - Added `max-w-[120px]` constraint on tab buttons to prevent wrapping
  - Applied `truncate` class to tab title text for ellipsis overflow
  - Added `flex-shrink-0` to tab containers to maintain fixed width
  - Fixed input width to `120px` (was dynamic minWidth/maxWidth)
  - Removed `whitespace-nowrap` from button (handled by truncate)
  - Full title now visible in tooltip on hover
  - Pencil icon set to `flex-shrink-0` to always remain visible
  - Result: Single-line tabs that scroll horizontally when needed, no wrapping

**Bug Fix (2025-10-17 18:35-18:40)**:
- **Main Tab Navigation Wrapping** (`frontend/src/components/layout/Sidebar.tsx:114, 124`): Fixed "Text Generation" and "Sound Generation" tab titles wrapping to multiple lines when scrollbar appears
  - Added `whitespace-nowrap` to both tab buttons to prevent text wrapping
  - Reduced horizontal padding from `px-4` to `px-3` (more compact)
  - Added `text-sm` class for slightly smaller font size
  - Result: Tab titles stay on single line even when vertical scrollbar reduces horizontal space
  - More compact tabs fit better in sidebar width (384px minus scrollbar ~17px = 367px available)

### Added - Sound Event Detection (SED) Feature (2025-01-17)

**Session 1 - Initial Implementation (14:00-15:30)**
- **Backend Services** (`backend/services/sed_service.py`): YAMNet-based sound event detection with 521 AudioSet classes
- **Backend Utilities** (`backend/utils/sed_processing.py`): Reusable audio processing functions (RMS, dBFS conversion, segment analysis)
- **Backend API** (`backend/routers/sed_analysis.py`): POST `/api/analyze-sound-events` endpoint with lazy-loading singleton pattern
- **Frontend Types** (`frontend/src/types/sed.ts`): Complete TypeScript definitions for SED analysis
- **Frontend Hook** (`frontend/src/hooks/useSED.ts`): State management for SED with API integration
- **Frontend Utils** (`frontend/src/lib/audio/audio-info.ts`): Audio metadata extraction and formatting utilities
- **Dual Workflow UI** (`frontend/src/components/layout/sidebar/ModelLoadSection.tsx`): Conditional interface supporting both 3D models and audio files

**Session 2 - Full Integration (15:30-16:00)**
- **Page Integration** (`frontend/src/app/page.tsx`): Connected useSED hook with handlers for analysis, loading, and file changes
- **Sidebar Props** (`frontend/src/components/layout/Sidebar.tsx`): Added 7 SED-specific props with proper TypeScript types
- **Load Sounds Feature**: "Load Sounds to Generation" button formats SED results as sound configs and auto-switches tabs

**Session 3 - Refinements (16:00-17:00)**
- **Audio Info Pre-Analysis** (`frontend/src/lib/audio/audio-info.ts`): `loadAudioFileInfo()` function using Web Audio API for immediate metadata display
- **Sample Rate Conversion** (`backend/utils/sed_processing.py`): Explicit detection and logging of resampling from any rate to 16kHz
- **Results Filtering** (`frontend/src/hooks/useSED.ts`): Automatic removal of "Silence" class and 0% confidence sounds
- **Scrollable Results** (`ModelLoadSection.tsx`): max-h-64 overflow container matching Text Generation style
- **Amplitude Display**: Conditional dB display next to confidence when "Analyze amplitudes" is checked
- **SPL Conversion**: Fixed dBFS→SPL mapping (dBFS -60 to -3 → SPL 30 to 85 dB) for realistic sound pressure levels
- **Temporal Intervals**: Detection duration parsing (×2) for intelligent playback interval calculation

**Session 4 - Bug Fix: Audio Loading Simplified (2025-10-17 13:30-14:30)**
- **Simplified** (`backend/utils/sed_processing.py`): Cleaned up audio loading to use only librosa
  - Removed: Attempted WAV header repair and soundfile fallback logic
  - Updated: `librosa.resample()` to use explicit `y=` parameter for librosa 0.11.0+ compatibility
  - Error handling: Now raises clear errors for corrupted files instead of attempting repair
  - Advice: Users should use properly formatted audio files (16kHz WAV recommended)

**Session 5 - SED Conditional Analysis & Error UI (2025-10-17 14:30-15:30)**
- **Fixed** (`frontend/src/hooks/useSED.ts:112`): Now sends both `analyze_amplitudes` and `analyze_durations` parameters to backend
  - Backend already supported conditional analysis, frontend now properly sends both flags
  - Dependencies updated in useCallback to trigger re-analysis when options change
- **Fixed** (`frontend/src/hooks/useSED.ts:178-266`): Corrected SED→Sound Generation mapping
  - **silence_duration_range** → playback interval (time between repetitions) [5-120s range]
  - **max_amplitude_db** → volume/SPL (peak loudness) [30-85 dB SPL range]
  - **detection_duration_range** → sound duration (length of generated sound) [1-30s range]
  - Previous mapping used detection_duration for interval (incorrect)
  - Conditional checks: Only use amplitude/duration data if respective options are enabled
- **Added** (`frontend/src/components/layout/sidebar/ModelLoadSection.tsx:18, 275-290`): User-friendly error UI
  - New `sedError` prop with error icon and formatted message display
  - Helpful tips: "Try checking file format, ensuring it's not corrupted, or using 16kHz WAV"
  - Error only shows when: audio file selected, no results, and error exists
  - Prevents UI crash by gracefully displaying errors in sidebar
- **Prop Threading**: Added `sedError` through component hierarchy
  - `page.tsx:142` → `Sidebar.tsx:77, 157` → `ModelLoadSection.tsx:18, 51`

**Session 6 - Numerical Duration Fields & Silence Handling (2025-10-17 15:30-16:15)**
- **Changed** (`backend/utils/sed_processing.py:166-189, 236`): Return numerical duration lists instead of formatted strings
  - `analyze_class_segments()` now returns `(detected_durations_sec, silent_durations_sec)` as lists of floats
  - Removed formatting logic from utility function (Single Responsibility Principle)
  - Updated return type signature: `Tuple[list, list]` instead of `Tuple[str, str]`
- **Changed** (`backend/services/sed_service.py:159-167, 184-193`): Calculate and send average durations
  - Computes `avg_detection_duration` and `avg_silence_duration` as numerical seconds
  - Response fields changed: `avg_detection_duration_sec`, `avg_silence_duration_sec` (instead of `_range` strings)
  - Fixed JSON serialization: Use `None` instead of `-np.inf` when `analyze_amplitudes=False`
- **Fixed** (`backend/routers/sed_analysis.py:122-123`): Updated router to use new field names
  - Was still accessing `detection_duration_range`, `silence_duration_range` (KeyError)
  - Now correctly accesses `avg_detection_duration_sec`, `avg_silence_duration_sec`
  - Updated API docstring to reflect nullable fields
- **Changed** (`frontend/src/types/sed.ts:21-30`): Updated DetectedSound interface
  - Removed: `detection_duration_range`, `silence_duration_range` (string fields)
  - Added: `avg_detection_duration_sec`, `avg_silence_duration_sec` (number | null fields)
  - All nullable fields now properly typed for conditional analysis
- **Changed** (`frontend/src/hooks/useSED.ts:139-143, 197-232`): Updated to use numerical fields
  - Removed string parsing logic (no more regex matching on "1.50s - 3.20s")
  - Direct numerical comparison: `sound.avg_silence_duration_sec !== null`
  - Silence class: Show in UI results but exclude from sound generation via filter
  - Cleaner, more maintainable code without string parsing
- **Improved** (`frontend/src/components/layout/sidebar/ModelLoadSection.tsx:284-293`): Conditional error helper
  - Audio format helper now only shows for loading/format errors
  - Checks error message for keywords: 'load', 'corrupt', 'format', 'audio file', '0 samples'
  - Analysis errors (non-loading) show error message only, without confusing format suggestions
- **Fixed** (`backend/services/sed_service.py:180-184`): Convert numpy floats to Python floats for JSON serialization
  - When `analyze_amplitudes=True`, amplitude values were returned as numpy.float32
  - FastAPI's JSON encoder cannot serialize numpy types, causing TypeError
  - Solution: Explicitly convert all amplitude values to Python float() with None for -inf values
  - Handles: max_amp_0_1, max_amp_db, avg_amp_0_1, avg_amp_db

**Session 7 - Value Rounding & Guidance Removal (2025-10-17 16:15-16:30)**
- **Changed** (`frontend/src/hooks/useSED.ts:220, 230, 240`): Round all numerical values to 0.1 precision
  - Formula: `Math.round(value * 10) / 10`
  - Applied to: `volumeSPL` (dB), `playbackInterval` (seconds), `soundDuration` (seconds)
  - Ensures clean, consistent values for sound generation (e.g., 5.0s, 70.5dB, 12.3s)
- **Removed** (`frontend/src/hooks/useSED.ts:206-208, 243`): All guidance_scale calculation and usage
  - Deleted: Commented-out guidance_scale calculation code
  - Removed: `guidance_scale` field from returned SoundGenerationConfig
  - Reason: Not needed for SED workflow, simplifies config object
- **Fixed** (`frontend/src/types/index.ts:59`): Made `guidance_scale` optional in SoundGenerationConfig
  - Was causing NaN display when SED configs were loaded without guidance_scale
  - Changed from `guidance_scale: number` to `guidance_scale?: number`
- **Updated** (`frontend/src/hooks/useSED.ts:191-196`): Documentation reflects rounding and no guidance

**Session 8 - Use Max Values Instead of Averages (2025-10-17 16:30-16:45)**
- **Changed** (`backend/services/sed_service.py:163-167, 196-197`): Use max instead of average for durations
  - `np.max()` instead of `np.mean()` for detected_durations_sec and silent_durations_sec
  - Field names: `max_detection_duration_sec`, `max_silence_duration_sec` (was `avg_*`)
  - Reason: Max values better represent the longest occurrences for sound generation parameters
- **Changed** (`backend/routers/sed_analysis.py:124-125, 69-70`): Updated router for max field names
- **Changed** (`frontend/src/types/sed.ts:28-29`): Updated DetectedSound interface
  - `max_detection_duration_sec` and `max_silence_duration_sec` (was `avg_*`)
- **Changed** (`frontend/src/hooks/useSED.ts:183-187, 222-240, 244, 250`): Updated to use max values
  - Uses `sound.max_silence_duration_sec` for playback interval
  - Uses `sound.max_detection_duration_sec` for sound duration
  - Comments clarified: "maximum time" instead of "average"

### Changed

- **Audio Loading**: Enhanced error handling with explicit exception types and stack traces
- **Type Safety**: Unified option types (`'analyzeAmplitudes' | 'analyzeDurations'`) across Sidebar and ModelLoadSection
- **UI/UX**: Checkboxes now hide after analysis, audio info appears immediately on file selection

### Technical Details

**Architecture**: Modular design following DRY and SRP principles
- Backend: Utilities → Service → Router separation
- Frontend: Types → Utils → Hook → Component hierarchy
- No code duplication (audio loading reuses impulse-response patterns)

**API Flow**: FormData upload → YAMNet inference → Amplitude/temporal analysis → Filtered results
**File Type Detection**: Automatic differentiation between audio (.wav, .mp3, .flac) and 3D models (.obj, .ifc, .3dm)
**Data Conversion**:
- Frontend dBFS (Web Audio) ↔ Backend SPL (sound generation)
- Detection duration → Playback interval (minimum 5s)


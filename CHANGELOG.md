# CHANGELOG

## [2025-12-12] - Fixed Material Coloring Visualization Issues
### Fixed
- **`frontend/src/components/scene/ThreeScene.tsx`** - Fixed face-to-triangle mapping to correctly color triangulated faces (quads/n-gons)
- **`frontend/src/components/scene/ThreeScene.tsx`** - Set mesh base color to white during material coloring to prevent grey mixing with vertex colors
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Unified color generation using hash-based approach matching ThreeScene for consistent colors
- **`frontend/src/components/scene/ThreeScene.tsx`** - Restored ARCTIC_THEME geometry color when leaving Acoustics tab
- **`frontend/src/lib/three/geometry-renderer.ts`** - Added wireframe highlight mode to preserve material colors when faces are selected
- **`frontend/src/components/scene/ThreeScene.tsx`** - Use wireframe highlighting when material coloring is active to avoid obscuring colors
- Material assignment now correctly maps face indices to all triangles in triangulated geometry (fixes Face 15 → Face 7 mismapping)

## [2025-12-12] - Fixed Missing simulation_mode Field in Pyroomacoustics Config
### Fixed
- **`frontend/src/hooks/useAcousticsSimulation.ts`** - Added missing `simulation_mode` field to Pyroomacoustics config initialization
- Fixes "Invalid simulation mode: undefined" error for mono mode simulations

## [2025-12-12] - Added Comprehensive RIR Validation and Error Handling
### Added
- **`backend/routers/pyroomacoustics.py`** - Added defensive checks for empty RIR arrays with detailed error messages
- **`backend/routers/pyroomacoustics.py`** - Added debug logging showing RIR structure (total mics, sources, and lengths)
- **`backend/services/pyroomacoustics_service.py`** - Added validation for empty RIRs in export_impulse_response method
### Fixed
- Prevents "zero-size array to reduction operation maximum" error with clear diagnostics
- Error messages now identify which specific channel/microphone has invalid RIR data
- Better debugging output to diagnose ray tracing and geometry issues

## [2025-12-12] - Fixed Multi-Channel RIR Dimension Mismatch in Binaural and FOA Modes
### Fixed
- **`backend/routers/pyroomacoustics.py`** - Added RIR channel padding to handle different impulse response lengths before stacking
- **`backend/services/pyroomacoustics_service.py`** - Fixed incorrect RIR indexing in export_impulse_response (was [source][mic], now [mic][source])
- Multi-source/multi-receiver simulations now work correctly for Binaural (2-ch) and FOA (4-ch) modes
- Fixes "dimension mismatch" error when RIRs have different lengths across channels

## [2025-12-12] - Fixed Source Creation and Pipeline Initialization in IR Modes
### Fixed
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - Removed `!this.irBuffer` check in `createSource()` to allow source creation without global IR
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - Removed `!this.irBuffer` checks in `createSource()` and `initializePipeline()`
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - Pipeline now initializes on mode creation (not just when IR is set) to ensure `ambisonicMixBus` exists for source connections
- Sources can now be created in simulation mode before per-source IRs are applied via `setSourceImpulseResponse()`
- Fixes "Source not found" error and no-audio bug when playing sounds with PyroomAcoustics stereo (2ch) and ambisonic (4ch) simulations

## [2025-12-12] - Added Binaural and FOA Ambisonics Simulation Modes to Pyroomacoustics
### Added
- **`backend/config/constants.py`** - Added simulation mode constants (MONO, BINAURAL, FOA) and microphone array configuration parameters
- **`frontend/src/lib/constants.ts`** - Added frontend simulation mode constants and display names
- **`backend/services/pyroomacoustics_service.py`** - Added multi-channel microphone support (binaural: 2-ch, FOA: 4-ch)
- **`backend/routers/pyroomacoustics.py`** - Added simulation_mode parameter and multi-channel IR export logic
- **`frontend/src/components/acoustics/PyroomAcousticsSimulationSection.tsx`** - Added simulation mode dropdown UI
### Changed
- Multi-channel IRs are now properly exported and imported to the IR library
- Binaural mode places two microphones at ear positions (±10.75cm from center)
- FOA mode uses tetrahedral microphone array for W, X, Y, Z ambisonics components

## [2025-12-12] - Removed RT60 Analysis Module
### Removed
- **`frontend/src/lib/audio/rt60-analysis.ts`** - Deleted unused RT60 calculation module
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Removed RT60 display from IR library
- **`frontend/src/lib/constants.ts`** - Removed RT60_ANALYSIS constants
- RT60 values are now shown from simulation results instead of client-side calculation

## [2025-12-12] - Fixed Acoustic Metrics Not Displaying in Simulation Tab
### Fixed
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Added acoustic metrics fetching from JSON results file
- `runPyroomSimulation()` now fetches and parses acoustic parameters (RT60, EDT, D50, C80) from simulation results
- `runChorasSimulation()` now fetches and parses acoustic parameters (T30, EDT, D50, C80) with frequency range
- Acoustic metrics now display correctly in completed Choras and PyroomAcoustics simulation tabs

## [2025-12-11] - Fixed Audio Mode Not Switching to IR Mode in Simulation
### Fixed
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - Fixed audio staying in Anechoic mode even with completed simulation
- `setSourceReceiverIRMapping()` now marks IR state as selected and triggers mode switch to appropriate IR mode
- Detects channel count from first IR in simulation mapping to select correct mode (Mono/Stereo/Ambisonic)
- Now properly switches to IR mode (with convolution) when simulation is activated

## [2025-12-11] - Fixed Convolution Not Applied in Simulation Mode
### Fixed
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - Fixed convolution not happening in receiver mode with completed simulation
- `createSource()` now applies source-specific IR immediately when source is created in simulation mode
- `reCreateSourcesInCurrentMode()` now re-applies simulation IRs after mode switch
- Sources are created asynchronously during audio loading, so IRs must be applied at source creation time, not just during initial mapping setup

## [2025-12-11] - Integrated Source-Receiver IR Pairing with UI
### Added
- **`frontend/src/app/page.tsx`** - Added handleReceiverSelected callback to update AudioOrchestrator when receiver is selected
- **`frontend/src/app/page.tsx`** - Added useEffect to set source-receiver IR mapping in AudioOrchestrator when Pyroomacoustics simulation completes
- **`frontend/src/lib/three/input-handler.ts`** - Added onReceiverSelected callback triggered on double-click receiver
- **`frontend/src/types/three-scene.ts`** - Added onReceiverSelected callback prop to ThreeSceneProps
### Changed
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Added isSimulationMode={true} prop to ImpulseResponseUpload in Choras and PyroomAcoustics modes
- **`frontend/src/components/scene/ThreeScene.tsx`** - Wire up receiver double-click to call onReceiverSelected callback
- **`frontend/src/hooks/useReceivers.ts`** - Added UseReceiversProps with onReceiverSelected callback support
- Double-clicking a receiver now automatically loads corresponding IRs for all sources
- IR Library selection disabled in simulation mode with warning notice displayed

## [2025-12-11] - Source-Receiver IR Pairing for Acoustic Simulations
### Added
- **`frontend/src/types/audio.ts`** - SourceReceiverIRMapping type, AcousticSimulationMode type, updated AudioModeConfig with simulation support
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Builds source-receiver IR mapping during simulation import, stores mapping in state
- **`frontend/src/hooks/useReceivers.ts`** - Added receiver selection (selectReceiver, deselectReceiver, selectedReceiverId), onReceiverSelected callback
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - setSourceReceiverIRMapping(), updateActiveReceiver(), downloadAndDecodeIR() methods for simulation-based audio
- **`frontend/src/lib/audio/modes/MonoIRMode.ts`** - setSourceImpulseResponse() method for per-source IR assignment
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - setSourceImpulseResponse() method for per-source stereo IR assignment
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - setSourceImpulseResponse() method for per-source ambisonic IR assignment
### Changed
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Added isSimulationMode prop to disable IR selection in simulation mode, shows warning notice
- Precise Acoustics Mode now pairs each source with its corresponding receiver-specific IR
- Selecting a receiver dynamically loads correct IRs for all sources based on source-receiver pairs
- IR Library selection disabled when in simulation mode (source-receiver pairs take precedence)

## [2025-12-11] - Face Selection Auto-Expand in Material Tree
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Fixed entityKey format mismatch: auto-expand effect now uses `entity-${index}` format (was `entity-${layerId}-${index}`)
- Added scroll-into-view for selected faces with ID attributes on face rows
- Fixed infinite re-render by removing setExpandedItems from useEffect dependencies

## [2025-12-11] - Consolidated Temporary Directories
### Changed
- **`backend/config/constants.py`** - Consolidated all temp folders into `backend/temp/` parent with subfolders: static/, uploads/, library_downloads/, simulations/
- **`backend/utils/file_operations.py`** - Updated cleanup to recursively clean all subfolders in temp parent directory
- **`backend/main.py`**, **`backend/routers/choras.py`**, **`backend/routers/pyroomacoustics.py`** - Updated to use new TEMP_SIMULATIONS_DIR constant

## [2025-12-11] - Input Handler Mode Separation (Face vs Entity Selection)
### Fixed
- **`frontend/src/app/page.tsx`** - Fixed layerId normalization (use 'Default' for entities without a layer) to match MaterialAssignmentUI grouping logic
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Fixed auto-expand effect to use 'Default' for layerId (was using empty string, causing entity expansion to fail)
### Changed
- **`frontend/src/lib/three/input-handler.ts`** - Implemented Mode 1 (entity selection) and Mode 2 (face selection); Mode 2 only when state is 'before-simulation' or 'running'
- **`frontend/src/types/three-scene.ts`** - Added activeAiTab prop to ThreeSceneProps
- **`frontend/src/app/page.tsx`** - Pass activeAiTab to ThreeScene; added logging to handleFaceSelected
- **`frontend/src/components/scene/ThreeScene.tsx`** - Face highlighting now triggers in Mode 2 instead of precise audio mode; clear entity overlay in Mode 2; reset colors when leaving Acoustics tab

## [2025-12-11] - CUDA Memory Management and Auto CPU Fallback
### Fixed
- **`backend/services/audio_service.py`** - Added CUDA cache clearing before/after generation; auto-fallback to CPU on OOM errors
- **`backend/config/constants.py`** - Added FORCE_CPU_MODE env variable to force CPU mode for low-memory systems
### Changed
- TangoFlux now clears CUDA cache between generations to prevent memory buildup
- On CUDA out-of-memory, automatically retries on CPU instead of failing
- Set `FORCE_CPU_MODE=true` in .env to always use CPU mode

## [2025-12-06] - Sound Source Position Updates on Drag End
### Fixed
- **`frontend/src/hooks/useSoundGeneration.ts`** - Added `updateSoundPosition()` callback to update soundscapeData when sound sphere drag ends
- **`frontend/src/types/three-scene.ts`** - Added `onUpdateSoundPosition` prop to ThreeSceneProps
- **`frontend/src/lib/three/input-handler.ts`** - Added `onSphereDragEnd` and `onReceiverDragEnd` callbacks to update data state only when drag completes
- **`frontend/src/components/scene/ThreeScene.tsx`** - Call `onUpdateSoundPosition` on drag end (not during drag) to prevent sound sphere recreation mid-drag
- **`frontend/src/app/page.tsx`** - Wire `soundGen.updateSoundPosition` to ThreeScene component
### Changed
- Sound source positions now update in soundscapeData when drag **ends** (not during drag)
- Visual position updates smoothly during drag without triggering data state changes
- Pyroomacoustics and Choras simulations now receive current sound positions instead of stale initial positions
- Dragging remains smooth and uninterrupted since spheres aren't recreated until drag completes

## [2025-12-05] - Material Assignment Callback Updates Simulation FaceToMaterialMap
### Fixed
- **`frontend/src/app/page.tsx`** - handleAssignMaterial now updates active simulation's faceToMaterialMap; strips material ID prefix (choras_/pyroom_)
- **`frontend/src/lib/constants.ts`** - Removed alpha channel from MATERIAL_GRADIENT colors (Three.js requires 6-char hex, not 8-char)
- **`frontend/src/components/scene/ThreeScene.tsx`** - Material colors now generated deterministically from material ID hash (each material has stable unique color)
### Changed
- Material assignments now immediately reflect in 3D model coloring (face, entity, layer, and global assignments all supported)
- Different materials now display different colors (hash-based gradient positioning instead of index-based)
- Added comprehensive logging for material assignment and color generation debugging

## [2025-12-05] - Multi-Source to Multi-Receiver IR Import (Efficient Array-Based)
### Fixed
- **`backend/routers/pyroomacoustics.py`** - Refactored to use pyroomacoustics' built-in multi-source/multi-receiver arrays; computes all RIRs in single call; added `ir_filename` query parameter
- **`backend/utils/acoustic_measurement.py`** - Added `calculate_acoustic_parameters_from_rir()` method to compute metrics from raw RIR arrays
- **`frontend/src/services/api.ts`** - Added `getPyroomacousticsIRFile()` method to fetch specific IR files by filename
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Now imports ALL generated IRs to library; stores array of IR IDs for per-simulation filtering (currently unused - AcousticsTab runs simulation directly)
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Fixed duplicate Pyroomacoustics simulation code to import ALL IRs instead of just first one
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Changed to accept array of IR IDs instead of single metadata object for filtering
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Updated to pass `importedIRIds` array instead of single metadata
### Changed
- Pyroomacoustics now creates ONE room with all sources/receivers, then computes all RIRs at once via `room.rir[receiver_idx][source_idx]` (much more efficient)
- IR names in library include source and receiver IDs (e.g., "Pyroom_{name}_S{sourceId}_R{receiverId}")
- Each simulation tab now correctly shows ALL its imported IRs instead of just the first one
- IR library filtering now uses array-based ID matching to support multiple IRs per simulation

## [2025-12-05] - Face Coloring and Clicking Active on Simulation Tab Selection
### Changed
- **`frontend/src/app/page.tsx`** - Lifted useAcousticsSimulation hook; passed simulation state to Sidebar (avoiding duplicate hook calls)
- **`frontend/src/types/components.ts`** - Added simulation state props to SidebarProps
- **`frontend/src/components/layout/Sidebar.tsx`** - Passes simulation state down to AcousticsTab
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Receives simulation state as props instead of calling useAcousticsSimulation
- **`frontend/src/types/three-scene.ts`** - Added activeSimulationIndex and activeSimulationConfig props
- **`frontend/src/components/scene/ThreeScene.tsx`** - Material coloring uses active simulation's faceToMaterialMap; enabled when tab selected
- **`frontend/src/lib/three/input-handler.ts`** - Face clicking enabled when simulation tab active; added setActiveSimulationIndexGetter
### Fixed
- Material assignments now immediately update 3D model face colors (eliminated duplicate hook calls)
- Face colors update dynamically when switching between simulation tabs
- Faces clickable for material assignment when simulation tab selected (even before running simulation)

## [2025-12-05] - IR Waveform as Hover Overlay
### Changed
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - IR waveform appears as minimal interactive overlay to the right of selected IR when hovering; shows only waveform canvas without text or extra padding; uses z-index 9999 to appear above ThreeScene
- **`frontend/src/components/audio/AudioWaveformDisplay.tsx`** - Added hideTextInfo prop to optionally hide filename and metadata text below waveform

## [2025-12-05] - Sound Generation Button Validation
### Changed
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Generate button now grays out when no sounds exist or pending sounds have invalid settings (empty prompts, missing uploads, no library selection)

## [2025-12-05] - Per-Instance Simulation State Management
### Fixed
- **`frontend/src/hooks/useChorasSimulation.ts`** - Refactored to use Map-based per-instance state instead of singleton
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Refactored to use Map-based per-instance state instead of singleton
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Updated to run simulations independently per tab using instance IDs; added missing imports; fixed state transition to 'completed' after simulation
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Fixed Choras IR library filtering to show only simulation-specific IR
### Changed
- Multiple Choras/Pyroomacoustics simulation tabs can now run independently without affecting each other
- Each simulation maintains its own state (progress, status, results, materials) based on simulationInstanceId
- Shared materials cache updated across all instances when materials are loaded
- Material assignments now stored directly in config's faceToMaterialMap (no hook dependency)
- Simulation state now explicitly set to 'completed' when simulation finishes and IR is imported

## [2025-12-05] - Choras IR Library Filtering Fix
### Fixed
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Choras now displays only its related IR in library (added simulationIRMetadata prop)

## [2025-12-05] - Simulation Tab Improvements: IR Auto-Selection & Material Persistence
### Changed
- **`frontend/src/types/acoustics.ts`** - Added faceToMaterialMap to ChorasSimulationConfig; added simulationInstanceId to BaseSimulationConfig
- **`frontend/src/hooks/useAcousticsSimulation.ts`** - Initialize faceToMaterialMap and unique simulationInstanceId for each simulation
- **`frontend/src/hooks/useChorasSimulation.ts`** - Capture and store importedIRMetadata when importing IR to library
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Capture and store importedIRMetadata when importing IR to library
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Auto-select simulation's IR when activating completed tab; sync importedIRMetadata to configs
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Pass simulationIRMetadata and initialAssignments to child components
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Added simulationIRMetadata prop; filter IR library to show only simulation's IR
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Added initialAssignments prop; initialize material state from faceToMaterialMap
- **`frontend/src/components/acoustics/SurfaceMaterialsSection.tsx`** - Pass initialAssignments through to MaterialAssignmentUI
### Fixed
- Switching to completed simulation tab now stops audio and applies its IR automatically
- Material assignments now persist when switching between simulation tabs (stored in faceToMaterialMap, restored via initialAssignments)
- Each simulation now has unique instance tracking for independence
- IR Library in completed simulations shows only that simulation's IR (filtered by importedIRMetadata)

## [2025-12-05] - Simulation Results Display Refinement
### Changed
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Hide Surface Materials after simulation; show only acoustic metrics in white text; update IR Library text colors to white on dark background
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Removed "Last Simulation Results" section; adapted IR Library card backgrounds and text colors to match completed simulation dark theme

## [2025-12-05] - Surface Materials State Persistence & Gradient
### Changed
- **`frontend/src/types/acoustics.ts`** - Added expandedMaterialItems to Choras and Pyroomacoustics configs for state persistence
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Added expandedItems prop; persists expanded state across tab switches
- **`frontend/src/components/acoustics/SurfaceMaterialsSection.tsx`** - Added expandedItems props; passes state to MaterialAssignmentUI
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Connected expandedMaterialItems from config to SurfaceMaterialsSection
- **`frontend/src/components/acoustics/ResonanceAudioMaterialUI.tsx`** - Updated gradient to use teal→orange from constants (MATERIAL_GRADIENT_START/END)
- **`frontend/src/components/scene/ThreeScene.tsx`** - Updated bounding box face colors to use teal→orange gradient matching material absorption
### Fixed
- Material assignments and expanded state now preserved when switching between simulation tabs
- Resonance Audio material colors now use consistent gradient (teal for reflective, orange for absorptive)
- Bounding box faces visually reflect their acoustic properties with color-coded materials

## [2025-12-05] - First-Person Mode Exit Button + Camera Restoration
### Added
- **`frontend/src/components/controls/OrientationIndicator.tsx`** - Exit button in orientation indicator; error-colored styling; ESC alternative
- **`frontend/src/components/scene/ThreeScene.tsx`** - Wired onExitFirstPersonMode callback; pointer-events-auto for button interaction
- **`frontend/src/lib/three/scene-coordinator.ts`** - Camera state restoration: saves position/target before entering first-person mode; restores on exit

## [2025-12-05] - Surface Materials UI Improvements
### Changed
- **`frontend/src/components/acoustics/SurfaceMaterialsSection.tsx`** - Removed collapsible dropdown; now plain text header
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Fixed missing count display; removed truncate class; background color now shows inherited material color
- **`frontend/src/components/acoustics/ResonanceAudioMaterialUI.tsx`** - New component with cascading inheritance (All faces → individual faces)
- **`frontend/src/components/controls/ResonanceAudioControls.tsx`** - Replaced individual dropdowns with ResonanceAudioMaterialUI for consistent styling

## [2025-12-05] - Receivers Section Moved to Soundscape Tab + Go To Receiver
### Changed
- **`frontend/src/components/layout/sidebar/ReceiversSection.tsx`** - Redesigned UI; compact layout; receiver count with + button; "Go to" button activates first-person view
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Added ReceiversSection at bottom
- **`frontend/src/types/three-scene.ts`** - Added goToReceiverId prop for programmatic first-person view trigger
- **`frontend/src/components/scene/ThreeScene.tsx`** - Added effect to activate first-person mode when goToReceiverId changes
- **`frontend/src/app/page.tsx`** - Added goToReceiverId state; updated handleGoToReceiver to trigger camera movement

## [2025-12-05] - Acoustics Tab UX Polish and Real-Time State Sync
### Changed
- **`frontend/src/components/layout/sidebar/ChorasSimulationSettings.tsx`** - Added hover effects to Start Simulation button; changed loading text from "Running simulation..." to "Calculating..."
- **`frontend/src/components/layout/sidebar/PyroomAcousticsSimulationSettings.tsx`** - Added hover effects to Start Simulation button; changed loading text to "Calculating..."
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Added two useEffect hooks for real-time state synchronization; Choras and Pyroomacoustics hook states (isRunning, progress, status, simulationResults, error) now continuously sync to simulationConfigs; simplified handleRunSimulation to set initial state and let useEffect handle ongoing updates
### Fixed
- Start Simulation button now has visual hover feedback (color darkens on hover with smooth transition)
- Simulation completion now properly updates UI to show IR Library section (fixed by continuous state sync)
- Simulation state changes (progress, completion, errors) now update in real-time without requiring manual refresh

## [2025-12-05] - Acoustics Tab UI Fixes and Improvements
### Changed
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Removed duplicate Surface Materials section from Resonance Audio mode (kept only ResonanceAudioControls)
- **`frontend/src/components/acoustics/SurfaceMaterialsSection.tsx`** - Added collapsible functionality with defaultCollapsed prop; clickable header with chevron icon
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Connected simulation execution to backend via useChorasSimulation and usePyroomAcousticsSimulation hooks; added handleRunSimulation and handleCancelSimulation callbacks
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Added getDisplayValue helper to show "various" when children have different materials and "(n faces missing)" when faces aren't assigned; created MaterialSelect component for consistent dropdown rendering
### Fixed
- Choras and Pyroomacoustics simulations now properly execute when clicking "Start Simulation"
- Surface Materials sections now start collapsed by default in Choras and Pyroomacoustics tabs
- Material dropdowns show aggregated state for parent nodes (All Entities, Layers, Entities)

## [2025-12-05] - Acoustics Tab Complete Refactor Implementation
### Added
- **`frontend/src/hooks/useAcousticsSimulation.ts`** - Main hook managing multiple simulation configs; handles add/remove/update/activate; auto-expands new simulations
### Changed
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Refactored to use AcousticsSection; integrated useAcousticsSimulation hook; materials loaded from Choras/Pyroomacoustics hooks; syncs active simulation with audio rendering mode
- **`frontend/src/components/layout/Sidebar.tsx`** - Added onGoToReceiver prop to AcousticsTab
- Architecture now complete: tab-based simulation management matching SoundGenerationSection pattern

## [2025-12-05] - Acoustics Tab Refactor: Modular Simulation Pattern
### Added
- **`frontend/src/types/acoustics.ts`** - New types for simulation configs (ResonanceSimulationConfig, ChorasSimulationConfig, PyroomAcousticsSimulationConfig)
- **`frontend/src/components/layout/sidebar/SimulationTab.tsx`** - Analogous to SoundTab; displays simulation configs with expand/collapse; supports before/after simulation states
- **`frontend/src/components/layout/sidebar/AcousticsSection.tsx`** - Analogous to SoundGenerationSection; manages simulation tabs with mode selector dropdown
- **`frontend/src/components/layout/sidebar/ChorasSimulationSettings.tsx`** - Extracted Choras settings UI for use in SimulationTab
- **`frontend/src/components/layout/sidebar/PyroomAcousticsSimulationSettings.tsx`** - Extracted Pyroomacoustics settings UI for use in SimulationTab
- **`frontend/src/components/acoustics/SurfaceMaterialsSection.tsx`** - Shared surface materials component for all simulation modes
### Changed
- **`frontend/src/types/index.ts`** - Export acoustics types for use across the app
- Pattern follows modular-coding.md guidelines: each simulation is a tab with expand/collapse; active simulation applies to audio orchestrator

## [2025-12-05] - Receivers Section Moved to Soundscape Tab
### Changed
- **`frontend/src/components/layout/sidebar/ReceiversSection.tsx`** - Redesigned UI to match SoundGenerationSection style; compact layout without position display; receiver count status with + button; "Go to" button to activate first-person view; both buttons styled with receiver color
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Added ReceiversSection at bottom of Soundscape tab; added receiver props to component interface
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Removed ReceiversSection from Acoustics tab; receivers prop now optional (only used for simulation sections)
- **`frontend/src/components/layout/Sidebar.tsx`** - Pass receiver props (including onGoToReceiver) to SoundGenerationSection
- **`frontend/src/types/components.ts`** - Added onGoToReceiver callback to SidebarProps and SoundGenerationSectionProps
- **`frontend/src/app/page.tsx`** - Added handleGoToReceiver function that activates receiver mode for specific receiver
- **`frontend/src/lib/constants.ts`** - Imported RECEIVER_CONFIG for receiver color styling

## [2025-12-05] - Sound Tab Mode Selection Refactor
### Added
- **`frontend/src/services/api.ts`** - Added loadSampleAudio() method to fetch sample audio from backend
### Changed
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Added mode selector dropdown to + button (right-aligned, primary color on hover); auto-loads sample audio when "Sample Audio" selected; no default expanded tabs
- **`frontend/src/components/layout/sidebar/SoundTab.tsx`** - Removed mode selector dropdown from all sound tabs
- **`frontend/src/hooks/useSoundGeneration.ts`** - Updated handleAddConfig to accept optional mode parameter; removed default sound tab (starts with 0 tabs)
- **`frontend/src/types/components.ts`** - Updated onAddConfig and onAddSoundConfig signatures to accept optional mode parameter; removed onModeChange prop

## [2025-12-05] - Ray Tracing Parameters & UI Improvements for Pyroomacoustics
### Added
- **`backend/config/constants.py`** - Ray tracing parameter ranges (n_rays: 1000-50000, scattering: 0.0-1.0)
- **`frontend/src/lib/constants.ts`** - Frontend ray tracing constants (n_rays, scattering)
### Changed
- **`frontend/src/components/acoustics/PyroomAcousticsSimulationSection.tsx`** - Compact UI with CheckboxField component; 2-column grid for ray tracing params; shortened labels
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Added n_rays and scattering to simulation settings
- **`frontend/src/services/api.ts`** - Sends n_rays and scattering parameters
- **`backend/routers/pyroomacoustics.py`** - Accepts and applies n_rays and scattering parameters; logs ray tracing settings

## [2025-12-04] - Pyroomacoustics Per-Face Material Assignment
### Changed
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - Changed from single material to per-face material assignments map
- **`frontend/src/services/api.ts`** - Updated to send face_materials instead of selected_material_id
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Material assignments now forwarded to Pyroomacoustics hook; materials memoized for stability
- **`frontend/src/components/acoustics/PyroomAcousticsSimulationSection.tsx`** - Now receives state/methods as props to avoid duplicate hook instances
- **`backend/routers/pyroomacoustics.py`** - Accepts face_materials JSON; added detailed logging of simulation parameters
- **`backend/services/pyroomacoustics_service.py`** - Improved error messages for sources/receivers outside room geometry

## [2025-12-04] - Pyroomacoustics Simulation Integration
### Added
- **`backend/routers/pyroomacoustics.py`** - Simulation endpoints with material selection and IR export
- **`backend/config/constants.py`** - Pyroomacoustics UI defaults (max_order, ray_tracing, air_absorption)
- **`frontend/src/hooks/usePyroomAcousticsSimulation.ts`** - State management hook for simulations
- **`frontend/src/components/acoustics/PyroomAcousticsSimulationSection.tsx`** - UI with sliders and toggles
- **`frontend/src/lib/constants.ts`** - Frontend constants for parameter ranges
- **`frontend/src/services/api.ts`** - API methods for materials and simulation execution
### Changed
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Added mode dropdown to select between Choras and Pyroomacoustics
- **`backend/main.py`** - Registered pyroomacoustics router

## [2025-12-04] - Pyroomacoustics Service Simplification & Refactoring
### Added
- **`backend/utils/acoustic_measurement.py`** - New utility class for acoustic parameter calculations (RT60, EDT, C50, C80, D50, DRR)
### Changed
- **`backend/services/pyroomacoustics_service.py`** - Merged `create_room_from_mesh` and `create_room_from_mesh_with_entity_materials` into single method with optional parameters
- **`backend/services/pyroomacoustics_service.py`** - Now uses `AUDIO_SAMPLE_RATE` from constants as default sample rate (48kHz)
- **`backend/config/constants.py`** - Removed ShoeBox-specific constants (default room dimensions and positions)
- **`backend/test_ray_tracing.py`** - Updated to use new `AcousticMeasurement` utility class
### Removed
- **`backend/services/pyroomacoustics_service.py`** - Removed `create_shoebox_room()` method (mesh-only workflow)
- **`backend/services/pyroomacoustics_service.py`** - Removed `calculate_sabine_rt60()` method (unused)
- **`backend/services/pyroomacoustics_service.py`** - Removed `calculate_optimal_max_order()` method (unused)
- **`backend/services/pyroomacoustics_service.py`** - Removed `calculate_acoustic_parameters()` and helper methods (moved to utils)
- **`backend/test_mesh_acoustics.py`** - Deleted (consolidated into test_ray_tracing.py)
- **`backend/test_real_room_acoustics.py`** - Deleted (consolidated into test_ray_tracing.py)
- **`backend/test_pyroomacoustics.py`** - Deleted (consolidated into test_ray_tracing.py)
- **`backend/test_rt60_fix.py`** - Deleted (obsolete debug file)
- **`backend/debug_rt60.py`** - Deleted (obsolete debug file)
- **`backend/visualize_room_setup.py`** - Deleted (obsolete helper file)
- **`backend/routers/pyroomacoustics_router.py`** - Deleted (used removed ShoeBox methods, not used by frontend)
- **`backend/main.py`** - Removed pyroomacoustics_router import and initialization

## [2025-12-04] - Hybrid ISM and Ray Tracing Simulator Support
### Added
- **`backend/config/constants.py`** - Ray tracing configuration constants (n_rays, receiver_radius, energy_thres, time_thres, hist_bin_size, default scattering)
- **`backend/services/pyroomacoustics_service.py`** - `enable_ray_tracing()` method to configure hybrid ISM/ray tracing simulator
### Changed
- **`backend/services/pyroomacoustics_service.py`** - `create_room_from_mesh()` now supports ray_tracing, air_absorption, and face_scattering parameters
- **`backend/services/pyroomacoustics_service.py`** - `simulate_room_acoustics()` automatically enables ray tracing if room was created with ray_tracing=True

## [2025-12-04] - Pyroomacoustics Mesh-Based Room Support
### Added
- **`backend/services/pyroomacoustics_service.py`** - `create_room_from_mesh()` converts mesh faces to pra.Wall objects for arbitrary room geometries
- **`backend/services/pyroomacoustics_service.py`** - `create_room_from_mesh_with_entity_materials()` for entity-based material assignment (IFC/OBJ groups)
- **`backend/test_mesh_acoustics.py`** - Test suite with simple box mesh (all tests passed)
- **`backend/test_real_room_acoustics.py`** - Real test using MeasurmentRoom_medium.obj (RT60=0.046s, C50=14.99dB)
- **`backend/visualize_room_setup.py`** - ASCII visualization of source/receiver placement
- **`backend/MESH_ACOUSTICS_GUIDE.md`** - Complete guide with examples and material database
### Changed
- **`backend/services/pyroomacoustics_service.py`** - Updated methods to support both pra.Room and pra.ShoeBox types

## [2025-12-04] - Global Volume Slider Hover Functionality
### Changed
- **`frontend/src/components/scene/ThreeScene.tsx`** - Volume slider now appears on hover instead of requiring a click

## [2025-12-04 17:30] - Fixed Progress Freeze on Tab Navigation & Added Refresh Button
### Added
- **`frontend/src/hooks/useChorasSimulation.ts`** - Added `refreshProgress()` method to fetch live simulation status from backend
- **`frontend/src/hooks/useChorasSimulation.ts`** - Added `irImported` flag to prevent duplicate IR imports when refreshing
- **`frontend/src/hooks/useChorasSimulation.ts`** - Added success notification pop-up when simulation completes
- **`frontend/src/components/acoustics/ChorasSimulationSection.tsx`** - Added refresh button next to "Simulation Settings" header
### Changed
- **`frontend/src/hooks/useChorasSimulation.ts`** - Store `currentSimulationRunId` in persistent state for progress tracking across tab changes
- **`frontend/src/hooks/useChorasSimulation.ts`** - Centralized result loading into single `loadSimulationResults` function (eliminates duplicate IR imports)
- **`frontend/src/hooks/useChoras.ts`** - Updated `onSimulationCreated` callback to pass both simulationId and simulationRunId
- **`frontend/src/components/acoustics/ChorasSimulationSection.tsx`** - Display simulation results even when `isRunning=true` (fixes frozen progress after tab navigation)
### Fixed
- **`frontend/src/hooks/useChorasSimulation.ts`** - Fixed race condition causing duplicate IR imports (set `irImported` flag immediately, not after async completion)

## [2025-12-04 11:50] - Enhanced Choras Error Handling & Backend Crash Detection
### Added
- **`frontend/src/hooks/useChoras.ts`** - Added `extractErrorMessage` helper to properly parse backend error responses (JSON/text)
- **`frontend/src/hooks/useChoras.ts`** - Detect backend crashes (ERR_EMPTY_RESPONSE) and check simulation status for error details
- **`frontend/src/hooks/useChoras.ts`** - Fetch detailed simulation status when error detected to find error messages
### Changed
- **`frontend/src/hooks/useChoras.ts`** - All fetch error handling now extracts and displays actual backend error messages
- **`frontend/src/hooks/useChoras.ts`** - When simulation fails, tries multiple error fields (error, errorMessage, message)
- **`frontend/src/hooks/useChoras.ts`** - Fallback error directs users to check backend logs with example errors
- **`frontend/src/hooks/useChoras.ts`** - Better error propagation from status checks to avoid "Could not check status" errors

## [2025-12-04 02:10] - Fixed Choras Simulation Settings & Results Display
### Fixed
- **`frontend/src/hooks/useChoras.ts`** - Simulation settings (IR length, characteristic length) now properly passed to Choras API
- **`frontend/src/hooks/useChorasSimulation.ts`** - Fixed JSON parsing to extract frequency-band averages from `responses[0].parameters`
- **`frontend/src/hooks/useChorasSimulation.ts`** - Display format: "T30: X.XXs, EDT: X.XXs, D50: XX.X, C80: XX.X dB" with frequency range

## [2025-12-04 00:35] - Auto-Delete Old Simulations to Prevent Crashes
### Added
- **`frontend/src/hooks/useChoras.ts`** - Automatically delete all old simulations for a model before creating new one; prevents Choras from crashing when polling old broken simulations

## [2025-12-04 00:30] - Restored Live Percentage Updates with Robust Error Handling
### Changed
- **`frontend/src/hooks/useChoras.ts`** - Back to using `/simulations/run` for live percentage; retry logic handles occasional crashes from old simulations

## [2025-12-04 00:10] - Fixed Choras Polling Interval (8s delay on every poll)
### Fixed
- **`frontend/src/hooks/useChoras.ts`** - Fixed polling to only wait 8s on first poll, then 4s between subsequent polls (was waiting 8s every time due to pollAttempts being reset)
- **`frontend/src/hooks/useChoras.ts`** - Removed cleanup step that was causing crashes
- **`frontend/src/hooks/useChoras.ts`** - Added 8s initial delay before first poll to let Choras initialize files
- **`frontend/src/lib/constants.ts`** - Added CHORAS_INITIAL_POLL_DELAY (8000ms)

## [2025-12-03 23:55] - Fixed Choras Model Creation API Call
### Fixed
- **`frontend/src/hooks/useChoras.ts`** - Removed invalid `outputFileId` parameter; uses `.geo` file ID as `sourceFileId`

## [2025-12-03 23:45] - Fixed Fast Simulation Polling Error (ERR_EMPTY_RESPONSE)
### Fixed
- **`frontend/src/hooks/useChoras.ts`** - Added timeout & retry logic for simulation polling
  - 10s timeout per poll request, 30s timeout for simulation start
  - Retry logic with 3 max attempts when Choras backend doesn't respond
  - Immediate first poll (skip 2s wait) to catch fast simulations
  - Direct status check fallback after max retries
- **`frontend/src/lib/constants.ts`** - Added Choras timeout constants (CHORAS_POLL_TIMEOUT, CHORAS_RUN_TIMEOUT, CHORAS_MAX_POLL_RETRIES)

## [2025-12-03 23:30] - Auto-Import IR & Display Simulation Results
### Changed
- **`frontend/src/components/audio/ImpulseResponseUpload.tsx`** - Added simulationResults & refreshTrigger props; displays acoustic metrics instead of help text
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Passes simulation results to IR Library
- **`frontend/src/app/page.tsx`** - Added irRefreshTrigger state to auto-refresh IR library after simulation
- **`frontend/src/types/components.ts`** - Added irRefreshTrigger to SidebarProps
- **`frontend/src/hooks/useChorasSimulation.ts`** - Fixed path access; replaced module-level callback with React ref; uses dedicated file endpoint
- **`frontend/src/hooks/useChoras.ts`** - Moved save-results call outside polling loop to ensure it always executes
- **`backend/routers/choras.py`** - Added GET /choras/get-result-file/{simulation_id}/{file_type} endpoint to serve WAV and JSON files
### Fixed
- IR library now automatically refreshes when Choras simulation completes
- Simulation results (RT60, EDT, C80, D50, Ts) replace help text in IR Library section
- Fixed live progress updates not displaying during simulation (replaced module-level state with React ref pattern)
- **CRITICAL:** Fixed save-results never being called when simulation completes via fallback status check (moved outside polling loop)
- **CRITICAL:** Fixed 404 errors when fetching result files (added dedicated endpoint instead of relying on static file server)

## [2025-12-03 23:00] - Choras Simulation Integration Enhancement
### Changed
- **`frontend/src/components/acoustics/ChorasSimulationSection.tsx`** - Added receivers, soundscapeData props, validation
- **`frontend/src/hooks/useChorasSimulation.ts`** - Auto-import IR, display RT60/EDT/C80/D50/Ts results
- **`frontend/src/hooks/useChoras.ts`** - Use real receiver and sound source positions from scene
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Pass soundscapeData and onIRImported callback
- **`frontend/src/app/page.tsx`** - Added handleIRImported callback for library refresh
- **`backend/main.py`** - Mounted /static/temp for serving simulation results
### Fixed
- Validation: Simulation cannot start without receivers or sound sources
- Auto-imports impulse response to IR Library after simulation completes
- Displays acoustic metrics (RT60, EDT, C80, D50, Ts) instead of generic status

## [2025-12-03 22:45] - Geometry Transparency Enhancement
### Changed
- **`frontend/src/lib/constants.ts`** - Added GEOMETRY_OPACITY (0.9) to ARCTIC_THEME constants
- **`frontend/src/lib/three/sceneSetup.ts`** - Applied 0.9 opacity to all geometry materials

## [2025-12-03 22:30] - Fixed RT60 Calculation Accuracy
### Fixed
- **`backend/services/pyroomacoustics_service.py`** - RT60 improved from 89% error to 11% error
  - Auto-calculates optimal max_order based on room size/materials (was fixed at 3)
  - Uses Eyring formula for highly absorptive spaces (α > 0.3), Sabine otherwise

## [2025-12-03 22:00] - Pyroomacoustics Integration (Phase 1 Backend)
### Added
- **`backend/services/pyroomacoustics_service.py`** - Acoustic simulation service (shoebox rooms, ISM, RT60/EDT/C50/C80/D50/DRR)
- **`backend/routers/pyroomacoustics_router.py`** - Endpoints: POST /pyroomacoustics/simulate, GET /pyroomacoustics/materials
- **`backend/config/constants.py`** - Pyroomacoustics constants (11 materials, defaults, RIR export)
- **`backend/models/schemas.py`** - Pyroomacoustics schemas (simulation request/response, acoustic parameters)

## [2025-12-03 21:30] - Fixed Global Material Inheritance Key Mismatch
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Global key consistency
  - Fixed global material key from `global--` to `global---` to match key construction format
  - Global material assignments now properly inherited by all entities and faces
  - Material cascading fully functional: global → layer → entity → face hierarchy

## [2025-12-03 21:25] - Fixed Global Material Cascading for Models Without Layers
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Global cascade handling
  - Detected whether model has real layers or just grouped under 'Default'
  - For models without layers, entities use empty layerId (e.g., `entity--0-`)
  - Global cascading now deletes correct keys based on layer structure
  - "All Entities" dropdown now properly cascades to entities without layers

## [2025-12-03 21:20] - Fixed Material Cascading with Zero-Based Indices
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Handle entityIndex=0 and faceIndex=0
  - Changed from `||` to `??` operator in key construction to properly handle 0 values
  - Previously `entityIndex: 0` was treated as falsy, creating wrong keys like `entity---` instead of `entity--0-`
  - Material cascading now works correctly for entities and faces with index 0
  - Inheritance lookup properly matches keys for all indices including 0

## [2025-12-03 21:10] - Fixed Material Cascading Logic (Delete vs Set)
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Proper inheritance cascading
  - Changed cascading from explicitly setting child materials to deleting them
  - Children now dynamically inherit from parents through getMaterialForSelection
  - When parent material changes, all children without explicit assignments inherit the new value
  - Fixes issue where cascading would set explicit values that prevented future inheritance

## [2025-12-03 21:05] - Fixed Material Cascading Re-render & Progress Polling Persistence
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Material cascading UI updates
  - Added updateCounter state to force re-render when parent materials change
  - Child dropdowns now immediately reflect inherited materials after parent assignment
  - Material cascading now both assigns AND displays correctly
- **`frontend/src/hooks/useChorasSimulation.ts`** - Progress polling across tab changes
  - Implemented module-level updatePersistentState callback for async operations
  - Progress updates now use persistent callback that survives component unmount/remount
  - Simulation progress continues updating even when switching tabs and returning

## [2025-12-03 20:50] - Fixed Material Cascading Display & Simulation State Persistence
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Material inheritance
  - getMaterialForSelection now checks parent hierarchy (entity → layer → global)
  - Child dropdowns now properly show inherited materials from parents
  - Material cascading visually works as expected
- **`frontend/src/hooks/useChorasSimulation.ts`** - State persistence
  - Added module-level singleton to persist state across tab changes
  - Simulation progress preserved when switching between tabs
  - Running simulations continue in background when user navigates away

## [2025-12-03 20:40] - Fixed Simulation UI and Material Cascading
### Fixed
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Restored ChorasSimulationSection
  - Simulation parameters and Start Simulation button now visible again
  - Section order: IR Library → Surface Materials → Run Simulation → Receivers
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Fixed material cascading
  - Entity material assignments now properly cascade to all child faces
  - Force component re-render by creating new Map instance

## [2025-12-03 20:30] - Integrated Choras with Material Assignment UI
### Changed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Now uses Choras materials
  - Removed dummy materials, accepts availableMaterials prop from Choras library
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Restored Material Assignment UI
  - Integrated useChorasSimulation hook to load Choras materials
  - Surface Materials section shows hierarchical material assignment with Choras library
  - Materials populate from Choras backend automatically
- **`frontend/src/components/acoustics/ChorasSimulationSection.tsx`** - Simplified UI
  - Removed material dropdown (now in Surface Materials section)
  - Removed Speed of Sound and Energy Decay Threshold parameters
  - Only IR Length and Characteristic Length remain
- **`frontend/src/services/api.ts`** - Fixed VITE_CHORAS_API_BASE error
  - Replaced import.meta.env with dynamic import of CHORAS_API_BASE constant

## [2025-12-03 20:00] - Integrated Choras Acoustic Simulation
### Added
- **`backend/config/constants.py`** - Added Choras simulation constants
  - CHORAS_API_BASE, default simulation parameters (c0, IR length, EDT, etc.)
  - Simulation parameter ranges for UI validation
- **`frontend/src/lib/constants.ts`** - Added frontend Choras constants
  - Mirrored backend constants for client-side validation
- **`frontend/src/services/api.ts`** - Added Choras API methods
  - getChorasMaterials(), runChorasSimulation(), getChorasSimulationStatus()
  - cancelChorasSimulation(), saveChorasResults()
- **`frontend/src/hooks/useChorasSimulation.ts`** - New hook for simulation state
  - Material selection, parameter controls, progress tracking
  - Typed state management following modular pattern
- **`frontend/src/components/acoustics/ChorasSimulationSection.tsx`** - New UI component
  - Material dropdown from Choras library, simulation parameter sliders
  - Progress tracking, cancel capability, status display
  - Uses RangeSlider and app color scheme
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Integrated Choras
  - Replaced Material Assignment UI with ChorasSimulationSection in Precise mode
  - Added modelFile prop for geometry submission

## [2025-12-03 19:20] - Fixed Face Selection in Precise Mode (Stale Closure Issue)
### Fixed
- **`frontend/src/components/scene/ThreeScene.tsx`** - Fixed audioRenderingMode stale closure preventing face selection
  - Added `audioRenderingModeRef` to track current mode value (lines 187, 374)
  - Updated `setAudioRenderingModeGetter` to use ref instead of captured value (line 1065)
  - InputHandler now correctly detects precise mode and triggers face selection callback
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Fixed entity ID format in auto-expand logic
  - Changed from `entity-${layerId}-${entity.index}` to `entity-${entity.index}` to match rendering
- **`frontend/src/app/page.tsx`** - Added debug logging to track callback chain
- Removed excessive console logs that were polluting the output

## [2025-12-03 19:10] - Fixed Face Selection Auto-Expand in Material Assignment UI
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Auto-expand tree when face is selected
  - Added useEffect to automatically expand layer and entity nodes when a face is selected from 3D scene
  - Face selection from 3D scene now properly highlights the corresponding row in sidebar
  - Tree automatically expands to reveal selected face, entity, or layer

## [2025-12-03 19:00] - Fixed Mode Switching and Face Selection Issues
### Fixed
- **`frontend/src/components/scene/ThreeScene.tsx`** - Clear entity UI overlays when switching to precise mode
  - Added effect to clear all UI overlays and selected entity when entering precise mode (lines 1387-1396)
  - Modified face highlighting effect to clear highlights when leaving precise mode (lines 1401-1405)
  - Prevents entity UI from persisting when switching from other modes to precise mode
  - Prevents face highlights from persisting when switching away from precise mode
- **`frontend/src/app/page.tsx`** - Fixed face selection not updating sidebar
  - Modified `handleFaceSelected` to call `handleSelectGeometry` instead of directly calling `setSelectedGeometry`
  - Face clicks in 3D scene now properly select the corresponding row in material assignment sidebar

## [2025-12-03 18:45] - Fixed Entity UI Still Appearing in Precise Mode
### Fixed
- **`frontend/src/components/scene/ThreeScene.tsx`** - Entity selection callback in effect was missing precise mode check
  - Added `audioRenderingMode === 'precise'` check as Priority 2 in the effect's `setOnEntitySelected` callback (line 1316)
  - Added `audioRenderingMode` to effect dependencies (line 1354)
  - Entity UI overlay now correctly suppressed in precise acoustics mode
  - Face selection now works properly when clicking geometry

## [2025-12-03 18:30] - Fixed Material Assignment UI Behavior
### Fixed
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Material assignments now cascade to children
  - Assigning material at global level applies to all layers, entities, and faces
  - Assigning at layer level applies to all entities and faces in that layer
  - Assigning at entity level applies to all faces in that entity
- **`frontend/src/lib/three/geometry-renderer.ts`** - New `highlightFaces()` method for multi-face highlighting
  - Selecting entity highlights all its faces in 3D scene
  - Selecting layer highlights all faces in that layer
  - Selecting global highlights all faces in the model
- **`frontend/src/components/scene/ThreeScene.tsx`** - Fixed entity UI overlay appearing in precise mode
  - `setOnEntitySelected` callback now checks `audioRenderingMode` and exits early if 'precise'
  - Entity UI overlay only appears in non-precise modes
  - Face highlighting effect now supports entity, layer, and global selections

## [2025-12-03 18:00] - Hierarchical Material Assignment UI for Precise Acoustics
### Added
- **`frontend/src/types/materials.ts`** - New type definitions for acoustic material assignment
- **`frontend/src/components/acoustics/MaterialAssignmentUI.tsx`** - Hierarchical tree UI component
  - Displays model structure: All Entities > Layers/Groups > Entities > Faces
  - Material dropdown for each level (global, layer, entity, face)
  - Handles 3dm (layers), obj (groups), and ifc (entities) differently
  - Reciprocal selection with 3D scene (click face highlights row, click row highlights face)
- **`frontend/src/lib/three/geometry-renderer.ts`** - `highlightFace()` method (lines 394-458)
  - Highlights individual faces in secondary color (sky blue)
- **`frontend/src/lib/three/input-handler.ts`** - Face selection in precise mode
  - `setOnFaceSelected()` callback (line 523)
  - `setAudioRenderingModeGetter()` for mode-aware input handling (line 609)
  - Modified `handleClick()` to detect faces without showing entity UI in precise mode (lines 333-438)
### Changed
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Added MaterialAssignmentUI in precise mode (lines 106-119)
- **`frontend/src/components/scene/ThreeScene.tsx`** - Integrated face selection callbacks (lines 1020-1031, 1375-1389)
- **`frontend/src/app/page.tsx`** - Added state management for material assignments (lines 89-110, 407-430, 757-758)
- **`frontend/src/types/components.ts`** - Extended SidebarProps with material assignment props (lines 166-170)
- **`frontend/src/types/three-scene.ts`** - Extended ThreeSceneProps with face selection props (lines 203-207)

## [2025-12-03 15:30] - Added Configurable OBJ Coordinate Rotation
### Added
- **`backend/config/constants.py`** - New `OBJ_ROTATE_Y_TO_Z` constant (line 205, default: False)
  - Controls whether OBJ files are rotated from Y-up to Z-up coordinate system
  - Disabled by default to preserve original OBJ orientation
### Changed
- **`backend/services/geometry_service.py`** - Conditionally apply rotation based on constant (lines 103-106)
- **`backend/routers/analysis.py`** - Conditionally apply rotation to entity bounds (lines 343-350)

## [2025-12-03 15:15] - Fixed OBJ Entity Clicking and Highlighting
### Changed
- **`backend/services/geometry_service.py`** - Updated `process_obj_file()` to include `face_entity_map` (lines 30-111)
  - Parses OBJ groups inline during geometry processing
  - Creates face-to-entity mapping for raycasting and entity selection
  - Enables clicking on OBJ groups to display EntityUIOverlay (same as .3dm/.ifc)

## [2025-12-03 15:00] - OBJ Files Now Support Entity Analysis Workflow
### Added
- **`backend/routers/analysis.py`** - New `/api/analyze-obj` endpoint (lines 293-371)
- **`frontend/src/services/api.ts`** - New `analyzeObj()` method (lines 138-161)
### Changed
- **`frontend/src/hooks/useFileUpload.ts`** - Updated `analyzeModel()` to call backend for OBJ analysis (lines 134-148)
  - Enables LLM context generation and entity linking for OBJ files

## [2025-12-03 14:30] - Fixed Infinite Loop When Loading OBJ Files
### Changed
- **`frontend/src/app/page.tsx`** - Fixed auto-upload useEffect to check `geometryData` instead of `modelEntities.length` (line 151)

## [2025-12-03 11:00] - Save Results to Backend & Fix Duplicate Upload Issue
### Added
- **`backend/routers/choras.py`** - New router for Choras integration
  - `/choras/save-results` endpoint saves WAV and JSON to `backend/temp`
### Changed
- **`frontend/src/hooks/useChoras.ts`** - Unique filename on upload (lines 57-66)
  - Appends timestamp to prevent file ID collision on duplicate uploads
- **`frontend/src/hooks/useChoras.ts`** - Results saved to backend (lines 310-330)
  - Calls `/choras/save-results` instead of browser downloads
- **`frontend/src/app/Choras/page.tsx`** - Removed "View Results" link (port 5173)

## [2025-12-03 10:15] - Added Stop Simulation Feature
### Added
- **`frontend/src/hooks/useChoras.ts`** - Added `stopSimulation()` function (lines 378-395)
  - POSTs to `/simulations/cancel` endpoint with simulationId
  - Enables users to cancel running simulations
- **`frontend/src/app/Choras/page.tsx`** - Added stop simulation UI (lines 165-183)
  - Red "Stop Simulation" button appears when simulation is running
  - Tracks currentSimulationId state for cancellation support
### Changed
- **`frontend/src/hooks/useChoras.ts`** - Added `onSimulationCreated` callback parameter
  - Allows parent component to receive simulationId immediately after creation (line 225)
  - Enables cancellation before simulation completes

## [2025-12-02 20:45] - Fixed Progress Polling & Direct Backend Downloads
### Changed
- **`frontend/src/hooks/useChoras.ts`** - Fixed progress polling to use correct endpoint (lines 247-292)
  - Changed from `/simulations/{id}` to `/simulations/run` array endpoint
  - Real-time percentage now updates correctly in UI
- **`frontend/src/hooks/useChoras.ts`** - Changed to download files directly from backend (lines 301-340)
  - Downloads WAV from `/auralizations/{id}/impulse/wav` endpoint
  - Saves results as JSON file (no backend zip endpoint dependency)
  - Files: `simulation_{id}_impulse_response.wav` and `simulation_{id}_results.json`

## [2025-12-02 20:05] - Fixed Progress Display & Added Automatic Results Download
### Changed
- **`frontend/src/app/Choras/page.tsx`** - Fixed progress callback to always update status
  - Status now updates during setup phase even when percentage is 0
  - Progress bar still only appears when percentage > 0

## [2025-12-02 18:45] - Choras Integration with Real-Time Simulation Progress
### Added
- **`frontend/src/hooks/useChoras.ts`** - Complete workflow for running acoustic simulations
  - Parses .geo files to extract surface UUIDs (regex: `Physical Surface\("([a-f0-9-]+)"\)`)
  - Polls backend every 2 seconds for real-time simulation progress
  - Returns results with link to Choras frontend visualization
- **`frontend/src/app/Choras/page.tsx`** - Simplified UI showing only actual simulation progress
  - Progress bar appears only when backend reports progress > 0%
  - Shows real-time percentage from solver
  - "View Results" link when complete

### Fixed
- Surface UUID extraction: now parses .geo files instead of hardcoded references
- Material assignments: all surfaces correctly mapped before simulation start
- Quote handling in file URLs from backend API

## [2025-11-27] - Integrate useFileUpload Hook with Choras Page
### Changed
- **`frontend/src/hooks/useFileUpload.ts`** - Added .obj file support and removed ErrorProvider dependency
  - Added .obj file recognition to 3D model file types
  - Replaced `useApiErrorHandler` with simple error logging to eliminate ErrorProvider dependency
  - Removed unused `isDraggingAudio` state
- **`frontend/src/app/Choras/page.tsx`** - Refactored to use centralized useFileUpload hook
  - Replaced local file handling with useFileUpload hook
  - Added drag-and-drop support for .obj files
  - Added upload error display and file selection confirmation
  - .obj files now properly connect to Choras workflow via runFullSimulation

## [2025-11-23] - Keep Timeline Expanded When Sounds Stop
### Fixed
- **`frontend/src/lib/audio/timeline-utils.ts`** - Added functions to populate timeline from soundscape data
  - **New Functions:**
    - `extractTimelineSoundsFromData()` - Creates timeline visualization from configured sounds, independent of schedulers
    - `calculateTimelineDurationFromData()` - Calculates timeline duration from soundscape data
  - These functions extract timeline data from `soundMetadata` and `soundIntervals` instead of from schedulers
  - Allows timeline to stay populated even when all sounds are stopped
- **`frontend/src/components/scene/ThreeScene.tsx`** - Timeline persistence when sounds stop
  - **Problem:** Timeline was cleared when Stop All was clicked because schedulers were disposed
    - Previous code cleared timeline when `audioSchedulers.size === 0`
    - This caused timeline to "collapse" or "get reduced" whenever interval slider was moved or individual sounds were stopped
  - **Solution:** Always use soundMetadata as the source of truth (lines 2109-2122)
    - Schedulers are transient (created when playing, destroyed when stopped)
    - soundMetadata persists as long as the soundscape exists
    - Timeline always extracts from soundMetadata + soundIntervals (never from schedulers)
    - Timeline is never cleared when sounds stop, only when soundscape is removed
  - **Benefits:**
    - Timeline stays visible when moving interval slider (Stop All triggered on mouse release)
    - Timeline stays visible when clicking play/pause on individual soundcards
    - Timeline represents "what sounds are configured" not "what sounds are currently playing"
    - Same behavior as clicking play on a soundcard (timeline doesn't collapse)
    - Robust against race conditions between scheduler disposal and timeline updates

## [2025-11-23] - Fix Interval Slider Issues (Stop All Workflow + Mouse Release Update)
### Fixed
- **`frontend/src/hooks/useAudioControls.ts`** + **`frontend/src/lib/audio-scheduler.ts`** - Robust interval change workflow
  - **Previous Issues:**
    1. Timeline took too long to load when pressing Play All after interval change
    2. Moving interval slider stopped playing sounds mid-playback
    3. Seek functionality had delays after interval changes
    4. Overlapping sounds when dragging slider rapidly
    5. Stop All triggered on every slider movement (even while dragging)
  - **Root Cause:** Attempting to update intervals while sounds are playing caused complex state management:
    - Stopping/restarting sounds during slider drag created race conditions
    - Multiple buffer sources created but not properly tracked
    - Scheduler state became inconsistent with actual playback
    - handleIntervalChange called on every onChange event (rapid Stop All calls)
  - **ROBUST SOLUTION - Stop All Workflow + Mouse Release Update:**
    - **`handleIntervalChange` (useAudioControls.ts:281-292):** Now calls `stopAll()` BEFORE updating interval
    - **`VerticalVolumeSlider` (VerticalVolumeSlider.tsx):** Added `onChangeCommitted` prop
      - `onChange`: Updates visual feedback immediately (local state)
      - `onChangeCommitted`: Fires only on mouse release (onMouseUp/onTouchEnd)
    - **`SoundTab` (SoundTab.tsx:163-169, 460-464):** Uses temporary state for visual feedback
      - While dragging: Shows updated value but doesn't trigger Stop All
      - On mouse release: Calls `onIntervalChange` which triggers Stop All
      - **Slider Stuck Bug Fix:** Replaced setState-in-render (lines 166-168) with useEffect
        - Previous code set state during render phase, causing slider to reset immediately during drag
        - Now uses `useEffect` to sync temp state with current interval when it changes externally
        - Allows slider to move freely while dragging, stays in sync with external updates
    - This gives a clean slate: all schedulers disposed, all sources stopped, state reset
    - User sees timeline update with new interval spacing (visual feedback during drag)
    - User manually clicks Play All to resume with new interval (explicit, predictable)
    - **`updateInterval` (audio-scheduler.ts:125-141):** Reverted to simple implementation and marked as deprecated
  - **Benefits:**
    - Simple, bulletproof workflow: Drag → Release → Stop → Update → User plays
    - No overlapping sounds, no race conditions, no scheduler bugs
    - Timeline loads instantly (no complex state reconciliation)
    - Seek works perfectly (clean state)
    - Smooth slider interaction (no interruptions while dragging)
    - Predictable behavior that user controls
  - **Trade-off:** User must manually click Play All after changing interval (explicit action, but more reliable)

## [2025-11-23] - Fix Timeline Not Starting + Play All Audio Not Playing
### Fixed
- **`frontend/src/lib/three/sound-sphere-manager.ts`** - Fixed timeline not starting by including required metadata properties
  - **Root Cause:** After refactoring to remove PositionalAudio, the SoundMetadata only included minimal properties (id, display_name, color, prompt_index)
  - Timeline component needs `url` property to load waveforms via WaveSurfer (line 85 in timeline-utils.ts, line 154 in WaveSurferTimeline.tsx)
  - Missing `url` caused timeline to skip all sounds and not render
  - **Fix:** Added critical metadata properties when creating SoundMetadata (lines 231-233):
    - `url: soundEvent.url` - Required for timeline waveform visualization
    - `isUploaded: soundEvent.isUploaded` - Needed for timeline color coding (uploaded vs generated vs library)
    - `interval_seconds: soundEvent.interval_seconds` - Needed for accurate playback scheduling
  - Timeline now displays correctly with waveforms and proper color coding

- **`frontend/src/components/scene/ThreeScene.tsx`** + **`frontend/src/lib/audio/playback-scheduler-service.ts`** - **CRITICAL FIX:** Play All audio not playing on first click
  - **Root Cause Chain:**
    1. `useAudioOrchestrator` hook creates AudioContext **asynchronously** in a useEffect (line 33-85 in useAudioOrchestrator.ts)
    2. On first render, `audioContextRef.current` is `null`, so hook returns `audioContext: null`
    3. ThreeScene initialization effect (line 882-1048) runs with `audioContext = null` from props
    4. PlaybackSchedulerService is constructed with `audioContext = null` (line 915)
    5. When AudioScheduler instances are created, they receive `this.audioContext` which is `null` (line 122 in playback-scheduler-service.ts)
    6. AudioScheduler.playOnce() checks for audio context and fails: "Cannot play - missing buffer or context" (line 245 in audio-scheduler.ts)
    7. Console logs confirmed: `Has audioContext: false`, `Context state: undefined`

  - **The Fix (ThreeScene.tsx lines 1072-1077):**
    - ThreeScene already had a useEffect (lines 1053-1084) that updates manager references when orchestrator becomes available
    - However, it was ONLY updating `audioOrchestrator` and **forgetting to update `audioContext`**
    - **Added:** `(playbackScheduler as any).audioContext = audioContext;` to update the audio context reference
    - Now when audioContext becomes available (async), it gets propagated to PlaybackSchedulerService
    - PlaybackSchedulerService then creates AudioScheduler instances with valid audio context
    - Added logging to confirm update: "Updated PlaybackScheduler with orchestrator and context"

  - **Supporting Changes (playback-scheduler-service.ts):**
    - Made `updateSoundPlayback()` async to properly await audio context resume (line 52)
    - Added audio context state logging for debugging (line 62)
    - Properly await `audioContext.resume()` with error handling (lines 64-83)
    - Updated call site in ThreeScene.tsx to await async function (lines 1757-1763)

  - **Result:** Play All now produces audio immediately on first click without requiring seek

### Technical Details
- **SoundMetadata interface** (`frontend/src/types/audio.ts`) uses `[key: string]: any` in soundEvent to allow flexible metadata
- **Audio Context Lifecycle:** suspended → running (via resume()) → playing audio
- **Timeline data flow:** AudioScheduler → ScheduledSound → extractTimelineSounds() → WaveSurferTimeline
- **Play All staggered start:** Each sound gets random initial delay (0 to half its interval) for natural audio layering

## [2025-11-21] - Fix React Render Error When Switching Sound Cards
### Fixed
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Fixed "Cannot update a component while rendering a different component" error
  - **Root Cause:** `onPreviewStop` was being called inside the `setExpandedTabs` state setter callback (lines 88, 94)
  - This violated React's rendering rules: updating parent state (`setPreviewingSoundId`) during child state update (`setExpandedTabs`)
  - **Fix:** Moved `onPreviewStop` call BEFORE `setExpandedTabs` (line 84-86)
  - Now parent state updates happen before child state updates, which is the correct React pattern
  - Error no longer occurs when switching between sound cards or collapsing cards

## [2025-11-21] - Fix AmbisonicIRMode Poor Localization (SN3D→N3D Conversion + Fixed Gain)
### Fixed
- **`frontend/src/lib/audio/ir-utils.ts`** - Added SN3D to N3D conversion + fixed gain multiplier
  - **Issue 1:** Most ambisonic IRs are recorded in SN3D normalization, but JSAmbisonics expects N3D
    - Without conversion, directional channels (X,Y,Z) were 1.73x (√3) weaker than they should be
    - Now automatically detects ambisonic IRs (4/9/16 channels) and applies conversion factors
    - Confirmed via RMS diagnostics: IR was SN3D format (directional ratio 0.534 vs expected 0.577)
  - **Issue 2 (CRITICAL):** Normalization was destroying localization
    - Global normalization (even with same scale on all channels) affected temporal dynamics
    - Different channels peak at different times in the IR
    - Normalizing to global peak compressed dynamic range in ways that hurt localization
    - **Solution:** Use fixed gain multiplier (0.3) instead of normalization for ambisonic IRs
    - This preserves both channel balance AND temporal characteristics
  - Added `diagnoseAmbisonicNormalization()` to detect IR format (SN3D/N3D/FuMa) via RMS analysis
  - Added `convertSN3DtoN3D` parameter (default: true) to allow disabling if IR is already N3D
- **`frontend/src/lib/constants.ts`** - Added `IMPULSE_RESPONSE.AMBISONIC_IR_GAIN_MULTIPLIER`
  - Fixed gain of 0.3 (-10.5dB) provides headroom without clipping
  - Works with FOA gain compensation (0.5) for proper output levels
- **`frontend/src/lib/constants.ts`** - Fixed FOA gain compensation
  - Was 0.25, should be 0.5 (1/sqrt(4) = 0.5, not 0.25)
  - This was making FOA IRs 6dB quieter than intended

### Added
- **`frontend/src/lib/constants.ts`** - Added `AMBISONIC.SN3D_TO_N3D` conversion factors
  - FOA: W=1.0, X/Y/Z=√3 (1.732)
  - SOA: W=1.0, 1st order=√3, 2nd order=√5 (2.236)
  - TOA: W=1.0, 1st order=√3, 2nd order=√5, 3rd order=√7 (2.646)
  - Reference: https://en.wikipedia.org/wiki/Ambisonic_data_exchange_formats

### Technical Details
**Root Causes:**
1. **Normalization mismatch:** JSAmbisonics uses N3D internally, most IRs are SN3D
2. **Per-channel normalization:** Destroyed the relative levels between W and directional channels

**Why this caused poor localization:**
- SN3D directional channels are 1/√3 ≈ 0.577 of W channel strength
- N3D expects all channels at equal strength (1.0)
- Per-channel normalization made all channels peak at 0.5, regardless of the conversion
- Result: W channel dominated, directional cues were lost, rotation had minimal effect

**Impact:**
- **Before:** Camera rotation barely noticeable, no spatial localization
- **After:** Full 3 DOF head tracking with accurate spatial localization in ReceiverMode

## [2025-11-21] - Fix Double Playback When Seeking on Timeline (Nuclear Solution)
### Fixed
- **`frontend/src/lib/audio/playback-scheduler-service.ts`** - Nuclear approach + orchestrator source stopping
  - **Seek operation:** Disposes ALL schedulers → Waits 50ms for event loop to clear → Creates fresh schedulers
  - **Individual stop:** Added `orchestrator.stopSource()` + seek timer cleanup in `updateSoundPlayback()` when sounds stop/pause
  - **KEY FIX:** Seek creates direct buffer sources via `orchestrator.playSource()` - these MUST be stopped
  - This eliminates ALL race conditions (both seek-to-seek and soundcard preview scenarios)
  - Timer callbacks simply check if scheduler still exists (disposed = skip)
- **`frontend/src/lib/audio-scheduler.ts`** - Simplified timer callback checking
  - Removed complex generation tracking (was insufficient)
  - Timer callbacks now only check if sound is still scheduled before playing
- **`frontend/src/types/audio.ts`** - Removed unused `generation` field from `ScheduledSound` interface
- **`frontend/src/hooks/useAudioControls.ts`** - Updated `handlePreviewPlayPause` comment to note automatic cleanup

### Technical Details
**Root Causes:**
1. **Seek-to-seek:** `clearTimeout()` doesn't prevent callbacks already queued in event loop
   - When seeking multiple times, old timer callbacks execute after new seek starts
   - Old callbacks would call `scheduleSound()` → immediate playback → double/triple audio
2. **Soundcard preview:** When playing soundcard preview after seek, timeline seek timers weren't cleared
   - Seek creates timers → User plays soundcard preview → Timeline stops → Seek timers fire later → Timeline restarts

**Nuclear Solution (for seeking):**
1. Clear all seek timers
2. Stop all orchestrator sources
3. Stop all THREE.PositionalAudio objects
4. **DISPOSE all schedulers** (completely destroys them, not just unschedule)
5. **Wait 50ms** for JavaScript event loop to clear all queued callbacks
6. Create completely fresh schedulers for current seek position
7. Old callbacks check if scheduler exists → NULL → return early (no playback)

**Seek Timer Cleanup (for individual stops):**
- When any sound transitions to 'stopped' or 'paused' in `updateSoundPlayback()`
- Clear any seek timer associated with that sound
- Prevents soundcard preview scenario where seek timers restart timeline sounds

**Why this works:**
- **Nuclear disposal** ensures seek-to-seek operations are bulletproof
- **Individual cleanup** ensures other stop mechanisms (like soundcard preview) also clear seek timers
- Simple, deterministic - no complex state tracking needed

**Trade-off:**
- 50ms delay when seeking (barely noticeable, acceptable per user)
- Bulletproof prevention of double playback in all scenarios
- Much simpler, more maintainable code than generation tracking approach

## [2025-11-21] - Fix Gain Compensation Being Overwritten by setMasterVolume
### Fixed
- **`frontend/src/lib/audio/modes/MonoIRMode.ts`** - Added separate `boostGain` node for compensation
  - `setMasterVolume()` was overwriting boost; now boost is on separate gain node in chain
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - Added separate `boostGain` node for compensation
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - Added separate `boostGain` node for order-dependent gain compensation, added cleanup in `dispose()`

## [2025-11-21] - Fix Timeline Seek with IR Convolution
### Fixed
- **`frontend/src/lib/audio/playback-scheduler-service.ts`** - `seekToTime()` now routes playback through AudioOrchestrator
  - Previously called `audio.play()` directly, bypassing IR convolution processing
  - Now calls `orchestrator.playSource(soundId, false, offsetSeconds)` to ensure convolution is applied
  - Added `orchestrator.stopAllSources()` at start of seek to prevent double playback

### Changed
- **`frontend/src/lib/audio/core/interfaces/IAudioMode.ts`** - Added optional `offset` parameter to `playSource()`
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - `playSource()` now accepts `offset` parameter
- **`frontend/src/lib/audio/modes/MonoIRMode.ts`** - `playSource()` supports offset via `bufferSource.start(0, offset)`
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - `playSource()` supports offset
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - `playSource()` supports offset
- **`frontend/src/lib/audio/modes/AnechoicMode.ts`** - `playSource()` supports offset
- **`frontend/src/lib/audio/modes/ResonanceMode.ts`** - `playSource()` supports offset

## [2025-11-21] - Fix AmbisonicIRMode Head Rotation and Level Compensation
### Fixed
- **`frontend/src/lib/audio/decoders/BinauralDecoder.ts`** - `updateOrientation()` now actually applies rotation when enabled
  - Added `rotationEnabled` flag to differentiate AmbisonicIRMode (rotation needed) from AnechoicMode (no rotation)
  - Added `setRotationEnabled()` method
  - Converts radians to degrees for JSAmbisonics sceneRotator
  - Negated yaw/pitch for proper head tracking (scene rotates opposite to head)
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - Enable rotation + order-dependent gain compensation
  - FOA: -6dB, SOA: -9.5dB, TOA: -12dB for consistent loudness across orders
- **`frontend/src/lib/audio/modes/MonoIRMode.ts`** - Added 2x boost to match compensated ambisonic levels
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - Added 2x boost to match compensated ambisonic levels
- **`frontend/src/lib/constants.ts`** - Added `AMBISONIC.ORDER_GAIN_COMPENSATION`, `MONO_IR_BOOST`, `STEREO_IR_BOOST`
- **`frontend/src/hooks/useAudioOrchestrator.ts`** - Exposed `updateListener` method for head tracking

## [2025-11-21] - Auto-switch to Soundscape Tab on Sound Selection
### Changed
- **`frontend/src/app/page.tsx`** - `handleSelectSoundCard` now switches to Soundscape tab before expanding the card
  - Clicking a sound sphere or sound-linked mesh from any tab (e.g., Acoustics) now auto-switches to Soundscape tab

## [2025-11-21] - Fix Stop All Button Not Immediately Stopping Sounds
### Added
- **`frontend/src/lib/audio/core/interfaces/IAudioMode.ts`** - Added `stopAllSources()` method to interface
- **`frontend/src/lib/audio/modes/MonoIRMode.ts`** - Implemented `stopAllSources()`
- **`frontend/src/lib/audio/modes/StereoIRMode.ts`** - Implemented `stopAllSources()`
- **`frontend/src/lib/audio/modes/AmbisonicIRMode.ts`** - Implemented `stopAllSources()`
- **`frontend/src/lib/audio/modes/ResonanceMode.ts`** - Implemented `stopAllSources()`
- **`frontend/src/lib/audio/modes/AnechoicMode.ts`** - Implemented `stopAllSources()`
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - Added `stopAllSources()` method

### Fixed
- **`frontend/src/lib/audio/playback-scheduler-service.ts`** - `stopAllSounds()` now calls orchestrator's `stopAllSources()` first
- **`frontend/src/lib/audio-scheduler.ts`** - `unscheduleAll()` now stops audio sources through orchestrator
- Sounds now stop immediately when clicking "Stop All" instead of playing until end of cycle

## [2025-11-21] - Audio Rendering Mode Refactor
### Removed
- **Flat Anechoic mode** - Removed `basic_mixer` mode entirely
  - Deleted `frontend/src/lib/audio/modes/BasicMixerMode.ts`
  - Removed from `AudioMode` enum in `frontend/src/types/audio.ts`
  - Removed from AudioOrchestrator, mode-selector, and constants

### Changed
- **`frontend/src/components/audio/AudioRenderingModeSelector.tsx`** - Renamed modes
  - 'Spatial Anechoic' → 'No Acoustics' (left position)
  - 'ShoeBox Acoustics' (middle position, unchanged)
  - New 'Precise Acoustics' mode (right position) for IR-based convolution
- **`frontend/src/components/layout/sidebar/AcousticsTab.tsx`** - Conditional IR section visibility
  - IR Library/Upload only visible in 'Precise Acoustics' mode
  - Hidden in 'No Acoustics' and 'ShoeBox Acoustics' modes
- **`frontend/src/app/page.tsx`** - Mode sync logic
  - Sets 'precise' mode when IR is active
  - Only calls setNoIRPreference for 'anechoic' and 'resonance' modes
- **`frontend/src/lib/constants.ts`** - Updated mode descriptions
- **`frontend/src/lib/audio/AudioOrchestrator.ts`** - Removed BasicMixerMode
- **`frontend/src/lib/audio/utils/mode-selector.ts`** - Updated mode selection logic

## [2025-11-21] - Sound Card WaveSurfer Preview Player
### Added
- **`frontend/src/components/audio/SoundCardWaveSurfer.tsx`** - New WaveSurfer-based audio preview component for sound cards
  - Waveform visualization with play/pause/stop controls
  - Volume control via volumeDb prop (0-100 range with exponential curve)
  - Mute support - respects card mute state
  - Proper abort handling to suppress React Strict Mode errors
  - Auto-reset to beginning on playback finish

### Changed
- **`frontend/src/components/layout/sidebar/SoundTab.tsx`** - Updated generated sound UI
  - Replaced horizontal sliders with vertical sliders for Interval and Volume
  - Added WaveSurfer waveform display for sound preview
  - Repositioned variant selector to left side below play/stop buttons
  - Removed globalVolume dependency (soundcard preview is independent)
- **`frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`** - Fixed variant selection
  - `getGeneratedSound()` now returns the currently selected variant, not just the first sound
  - Properly passes preview state to SoundTab
- **`frontend/src/hooks/useAudioControls.ts`** - Added soundcard preview state management
  - New `previewingSoundId` state to track which soundcard is playing
  - `handlePreviewPlayPause()` - Stops timeline if playing, toggles soundcard preview
  - `handlePreviewStop()` - Stops soundcard preview
  - `handleVariantChange()` - Now switches preview to new variant if preview was playing
  - `playAll()` - Stops any soundcard preview before starting timeline
- **`frontend/src/types/components.ts`** - Added preview-related props to SidebarProps and SoundGenerationSectionProps
- **`frontend/src/components/layout/Sidebar.tsx`** - Pass preview props to SoundGenerationSection
- **`frontend/src/app/page.tsx`** - Pass preview props from audioControls to Sidebar

### Mutual Exclusion Logic
- Soundcard preview and Timeline are mutually exclusive:
  - Playing soundcard stops timeline
  - Playing timeline (Play All) stops soundcard preview
  - Collapsing a sound card stops its preview
  - Switching variants while preview is playing switches to new variant's preview

## [2025-11-21] - Entity-Linked Sound Prompt Guarantee
### Changed
- **`backend/services/llm_service.py`** - Updated `_create_base_sound_prompt()` (lines 287-321)
  - LLM now guarantees entity-linked sounds when diverse entities are selected
  - If num_sounds >= num_entities: ALL entities get a linked sound + remaining as context sounds
  - If num_sounds < num_entities: LLM chooses most relevant entities for the context
  - Example: 3 entities, 5 sounds → 3 entity-linked + 2 context sounds
  - Example: 3 entities, 2 sounds → 2 entity-linked sounds (most relevant)

## [2025-11-21] - Anechoic Mode Spatial Audio Fix
### Fixed
- **`frontend/src/lib/audio/modes/AnechoicMode.ts`** - Fixed sound scene rotating incorrectly when orbiting
  - **Root cause**: sceneRotator is designed for VR head tracking, NOT camera orbit compensation
  - **Impact**: When orbiting around a sound source, sound appeared to rotate instead of staying "in front"
  - **Fix**: Encode sources in listener-local coordinates
    - `updateSourcePosition()` rotates relative position by listener yaw before encoding
    - `createSource()` also rotates by listener orientation for initial encoding
  - **Result**: When orbiting around a sound source at the orbit target, sound stays "in front" as expected
- **`frontend/src/lib/audio/decoders/BinauralDecoder.ts`** - Disabled sceneRotator for orbit compensation
  - `updateOrientation()` now keeps sceneRotator at identity (yaw=0, pitch=0, roll=0)
  - sceneRotator reserved for future VR head tracking use only

## [2025-01-20] - Anechoic Mode Rotation Fix
### Fixed
- **`frontend/src/lib/audio/modes/AnechoicMode.ts`** - Fixed spatial audio rotating around origin instead of tracking with camera view
  - Changed `rotatePosition()` method (lines 205-207) to use **right-handed rotation matrix** matching Three.js
  - **Root cause**: Code used LEFT-HANDED Y-axis rotation matrix with incorrect signs:
    - Was: `x1 = x*cos - z*sin`, `z1 = x*sin + z*cos`
    - Should be: `x1 = x*cos + z*sin`, `z1 = -x*sin + z*cos`
  - **Impact**: Rotations went in opposite direction, causing sounds to appear rotated around origin (0,0,0) instead of maintaining correct spatial relationship to camera
  - **Fix**: Corrected rotation matrix to use standard right-handed formula
  - Sounds now correctly track with camera orientation regardless of camera position
- **`frontend/src/lib/three/scene-coordinator.ts`** - Restored proper orientation calculation from camera direction (lines 294-333)
  - Reverted incorrect fix that set orientation to (0,0,0)
  - Properly calculates yaw/pitch from `camera.getWorldDirection()` in orbit mode
  - Listener faces their actual view direction, not fixed world -Z

## [2025-11-20 IRCAM HRTF Auto-Loading] - Full HRTF Implementation with Virtual Speaker Selection

### Added
- **Complete IRCAM HRTF loader with automatic ambisonic decoding filter generation**
  - `frontend/src/lib/audio/utils/hrir-loader-ircam.ts` - New IRCAM SOFA HRIR loader (454 lines)
    - `loadIRCAMSOFA()` - Fetches IRCAM SOFA JSON files with timeout
    - `parseIRCAMSOFA()` - Extracts HRIRs and source positions from IRCAM structure
    - `angularDistance()` - Calculates great circle distance between spherical coordinates
    - `findNearestHRTF()` - Finds nearest measured HRTF to virtual speaker position
    - `generateAmbisonicFilters()` - Creates multi-channel AudioBuffer with (order+1)^2 * 2 channels
    - `loadIRCAMHRIR()` - Main entry point for loading and processing
    - `loadIRCAMHRIRWithRetry()` - Retry logic with exponential backoff
  - Virtual speaker layouts for optimal ambisonic decoding:
    - FOA (order 1): 4 speakers in tetrahedral arrangement
    - SOA (order 2): 9 speakers (cube + center)
    - TOA (order 3): 16 speakers (dodecahedron vertices)
  - `frontend/public/hrtf/IRC_1076_C_HRIR_48000.sofa.json` - IRCAM subject 1076 HRTF dataset

### Changed
- **HRTF auto-loading now ENABLED by default**
  - `frontend/src/lib/constants.ts:467` - Updated DEFAULT_HRTF_PATH to IRC_1076_C_HRIR_48000.sofa.json
  - `frontend/src/lib/constants.ts:474` - Changed FORMAT from 'json' to 'ircam'
  - `frontend/src/lib/constants.ts:477` - Added AUTO_LOAD: true
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:29` - Import loadIRCAMHRIRWithRetry instead of loadHRTFWithRetry
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:105-111` - Auto-load HRTFs if HRTF.AUTO_LOAD is enabled
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:118-130` - Added autoLoadHRTFs() private method
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:238-293` - Updated loadHRTFs() to use IRCAM loader
  - System now automatically loads measured HRTFs on startup (falls back to cardioid if loading fails)

### Technical Details
- **Virtual speaker selection algorithm:**
  - Optimal t-design layouts for spherical sampling
  - Angular distance calculation using great circle formula
  - Nearest-neighbor search in HRTF measurement grid
  - Logs mapping: virtual speaker position → nearest measured HRTF position
- **Channel layout:** Interleaved L/R pairs: [L0, R0, L1, R1, L2, R2, ...]
  - FOA: 8 channels (4 virtual speakers × 2 ears)
  - SOA: 18 channels (9 virtual speakers × 2 ears)
  - TOA: 32 channels (16 virtual speakers × 2 ears)
- **IRCAM SOFA format:** Hierarchical JSON with leaves structure
  - Data.SamplingRate: Sample rate (Hz)
  - Data.IR: 3D array [numPositions, 2 channels, irLength]
  - SourcePosition: Spherical coordinates [azimuth, elevation, distance]
- **Processing workflow:**
  1. Load IRCAM SOFA JSON
  2. Parse HRIR data and source positions
  3. Select virtual speaker layout based on ambisonic order
  4. Find nearest measured HRTF for each virtual speaker
  5. Create multi-channel AudioBuffer with L/R pairs
  6. Pass to JSAmbisonics binDecoder
- **Performance:** Async loading with graceful fallback - no blocking, no crashes
- **Future work:** Interpolation between nearest HRTFs for even better accuracy

## [2025-11-20 Sample Rate & SSR Fixes] - Critical Bug Fixes

### Fixed
- **Sample rate mismatch causing IR convolution errors**
  - `backend/config/constants.py:60` - Changed `AUDIO_SAMPLE_RATE` from 44100 Hz to 48000 Hz
  - **Issue:** Backend resampled all IRs to 44100 Hz, but browser AudioContext defaults to 48000 Hz
  - **Error:** `Failed to set the 'buffer' property on 'ConvolverNode': The buffer sample rate of 44100 does not match the context rate of 48000 Hz`
  - **Fix:** Backend now resamples to 48000 Hz to match Web Audio API default
  - **Impact:** All IR-based modes (MonoIRMode, StereoIRMode, AmbisonicIRMode) now work correctly
  - **Backend resampling logic:** `backend/services/impulse_response_service.py:143-153` uses `scipy.signal.resample_poly`

- **Server-side rendering (SSR) error with JSAmbisonics library**
  - `frontend/src/lib/audio/modes/AnechoicMode.ts:34-41` - Added lazy loading for `ambisonics` import
  - `frontend/src/lib/audio/modes/MonoIRMode.ts:38-45` - Added lazy loading for `ambisonics` import
  - `frontend/src/lib/audio/modes/StereoIRMode.ts:49-56` - Added lazy loading for `ambisonics` import
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts:42-49` - Added lazy loading for `ambisonics` import
  - **Issue:** JSAmbisonics library accesses `window` during module evaluation, causing "window is not defined" error during Next.js SSR
  - **Error:** `window is not defined` in `src\lib\audio\modes\AnechoicMode.ts`
  - **Fix:** Changed from `import * as ambisonics from 'ambisonics'` to dynamic import with SSR guard:
    ```typescript
    let ambisonics: any = null;
    async function loadAmbisonics() {
      if (!ambisonics && typeof window !== 'undefined') {
        ambisonics = await import('ambisonics');
      }
      return ambisonics;
    }
    ```
  - **Implementation:** Library loaded in `initialize()` method: `await loadAmbisonics()`
  - **Impact:** All ambisonic modes now work with Next.js SSR without errors

### Technical Details
- **Sample rate standardization:** 48000 Hz is the Web Audio API default on most browsers/hardware
- **Resampling quality:** Backend uses `scipy.signal.resample_poly` for high-quality resampling
- **SSR compatibility:** Dynamic imports ensure code only runs in browser environment
- **TypeScript compilation:** All changes verified with `npx tsc --noEmit` (no errors)

## [2025-11-20 JSAmbisonics Integration & SOA Support] - Ambisonic Encoding Refactoring

### Changed
- **Refactored entire Ambisonics workflow to use JSAmbisonics built-in functions**
  - `frontend/src/lib/audio/modes/AnechoicMode.ts` - Replaced custom encoding with `ambisonics.monoEncoder` for all sources
    - Uses JSAmbisonics for accurate spherical harmonics calculation
    - Simplified encoder creation: `new ambisonics.monoEncoder(audioContext, order)`
    - Position updates via `encoder.azim`, `encoder.elev`, `encoder.updateGains()`
    - Removed manual gain node approach (~30 lines simpler)
  - `frontend/src/lib/audio/modes/MonoIRMode.ts` - Replaced custom encoding with `ambisonics.monoEncoder` for wet signal
    - Convoluted signal now encoded using JSAmbisonics library
    - Position-based encoding for proper spatial reverb placement
    - Supports dynamic ambisonic order switching (FOA/SOA/TOA)
  - `frontend/src/lib/audio/modes/StereoIRMode.ts` - Replaced custom encoding with dual `ambisonics.monoEncoder` (L/R channels)
    - Left encoder: azimuth +30°, Right encoder: azimuth -30°
    - Cleaner integration with JSAmbisonics ecosystem
    - Updated SourceChain interface to use `any` type for encoders
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts` - Replaced manual multi-channel convolution with `ambisonics.convolver`
    - Removed `createFOAConvolver()` and `createMultiMonoConvolvers()` helper functions (~160 lines removed)
    - Uses JSAmbisonics convolver for all orders (FOA/SOA/TOA)
    - Simplified IR update: `convolver.updateFilters(irBuffer)`
    - Cleaner audio graph: `source → gainNode → convolver.in → convolver.out → ambisonicMerger`
    - Handles multi-channel IR internally (no manual channel splitting needed)
  - `frontend/src/lib/audio/ambisonic-core.ts` - Cleaned up from 259 to 41 lines
    - Removed `calculateFOACoefficients()` (replaced by JSAmbisonics)
    - Removed `calculateTOACoefficients()` (replaced by JSAmbisonics)
    - Removed `encodeMonoToAmbisonic()` (no longer used)
    - Removed `createAmbisonicEncoderNodes()` (replaced by `ambisonics.monoEncoder`)
    - **Kept:** `cartesianToSpherical()` - Still used for coordinate conversion
  - `frontend/src/lib/constants.ts:425-430` - Removed unused `AMBISONIC.WEIGHTS` object
    - No longer needed since JSAmbisonics handles SN3D normalization internally
  - **Benefits:**
    - More accurate spherical harmonic calculations (library-optimized)
    - Consistent API across all audio modes
    - Easier to maintain and extend
    - Reduced custom math code by ~360 lines total

### Added
- **Full Second-Order Ambisonics (SOA) support across all systems**
  - `backend/config/constants.py:277-279` - Added `AMBISONIC_SOA_CHANNELS = 9`
  - `backend/config/constants.py:292` - Added SOA to `SUPPORTED_IR_CHANNELS` list
  - `backend/config/constants.py:299` - Added `IR_FORMAT_SOA = "soa"` constant
  - `frontend/src/lib/constants.ts:433-437` - Added `SOA: 2` to AMBISONIC.ORDER
  - `frontend/src/lib/constants.ts:440-444` - Added `SOA: 9` to AMBISONIC.CHANNELS
  - `frontend/src/lib/constants.ts:455-460` - Added `SOA_CHANNEL_NAMES` (W, Y, Z, X, V, T, R, S, U)
  - `frontend/src/lib/constants.ts:510-516` - Added `SOA: "soa"` to IR_FORMAT
  - `frontend/src/types/ambisonics.d.ts` - **NEW FILE:** TypeScript declarations for JSAmbisonics library
    - Defines types for `monoEncoder`, `convolver`, `binDecoder`, `sceneRotator`, and other JSAmbisonics classes
    - Enables TypeScript compilation for JSAmbisonics imports
  - **All audio modes now support 3 ambisonic orders:**
    - FOA (First-Order): 4 channels, order = 1
    - **SOA (Second-Order): 9 channels, order = 2** (newly supported)
    - TOA (Third-Order): 16 channels, order = 3
  - **Verified SOA support in:**
    - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts:121-122` - Already had SOA detection (9 channels)
    - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:109` - Already supported order 2

### Technical Details
- **JSAmbisonics integration:**
  - Library: `ambisonics@0.4.0` (from package.json)
  - Normalization: SN3D (Schmidt semi-normalized) - standard for ambisonics
  - Channel ordering: ACN (Ambisonic Channel Number) - standard ordering
  - Position format: Azimuth/elevation in degrees (not radians like custom code)
- **Channel count calculation:** All modes now use `Math.pow(order + 1, 2)` for consistency
  - FOA: (1+1)² = 4 channels
  - SOA: (2+1)² = 9 channels
  - TOA: (3+1)² = 16 channels
- **TypeScript compilation:** All changes compile successfully with `npx tsc --noEmit`
- **No breaking changes:** Public API remains the same (internal implementation updated)

## [2025-11-19 HRTF Loading Infrastructure] - HRTF Loading Framework (Auto-loading Disabled)

### Added
- **HRTF loading infrastructure for future binaural spatial accuracy improvements**
  - `frontend/src/lib/constants.ts:462-475` - Added HRTF configuration constants (DEFAULT_HRTF_PATH, FETCH_TIMEOUT_MS, RETRY_ATTEMPTS, FORMAT)
  - `frontend/src/lib/audio/utils/hrtf-loader.ts` - New HRTF loader utility for JSON/SOFA format
    - `loadHRTFJSON()` - Fetches and parses HRTF JSON files with timeout
    - `parseSOFAData()` - Extracts IR data, sample rate, and source positions from SOFA structure
    - `createHRTFAudioBuffer()` - Converts parsed HRTF to Web Audio AudioBuffer (currently 2-channel stereo)
    - `loadHRTFAudioBuffer()` - Convenience function combining load and convert
    - `loadHRTFWithRetry()` - Retry logic with exponential backoff (1s, 2s, 4s...)
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:29-30` - Imported HRTF loader and constants
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:192-240` - Added public `loadHRTFs()` method with channel count validation
  - `frontend/src/lib/audio/decoders/BinauralDecoder.ts:242-246` - Added `hasHRTFs()` status check method
  - `frontend/public/hrtf/HRTF_KEMAR_front.json` - KEMAR HRTF dataset (828 positions, 2 channels, 256 samples @ 44.1kHz)

### Important Note - Auto-loading Disabled
- **Auto-loading is currently DISABLED** - System uses default cardioid virtual microphone decoding
- **Reason:** Format mismatch between raw SOFA HRTFs (2-channel stereo) and JSAmbisonics requirements
- **JSAmbisonics expects:** Pre-processed ambisonic decoding filters with `(order+1)^2` channels
  - FOA (order 1): 4 channels
  - SOA (order 2): 9 channels
  - TOA (order 3): 16 channels
- **Missing processing steps:**
  - Virtual speaker selection algorithm (choose optimal HRTF positions for ambisonic order)
  - Ambisonic decoding matrix computation (map ambisonic channels to virtual speakers)
  - HRTF interpolation for selected speaker positions
- **Current decoder behavior:** Uses cardioid virtual microphones (works well for general spatial audio)
- **Future work:** Implement missing processing or integrate JSAmbisonics HRIRloader utilities

### Technical Details
- **HRTF format:** JSON exported from SOFA (Spatially Oriented Format for Acoustics)
- **SOFA structure:** Contains `Data.IR` (828 binaural impulse responses), `Data.SamplingRate`, `SourcePosition` (azimuth/elevation/distance)
- **Validation:** BinauralDecoder validates channel count and provides clear error messages
- **Error handling:** Helpful guidance pointing to JSAmbisonics documentation
- **Alternative approach:** Use JSAmbisonics built-in utilities for proper filter generation:
  - `HRIRloader_local` - Processes SOFA files with Python (requires h5py)
  - `HRIRloader_ircam` - Loads pre-processed IRCAM SOFA files
- **Reference:** https://github.com/polarch/JSAmbisonics#integration-with-sofa-hrtfs

## [2025-11-19 Ambisonic IR Physical Accuracy Fix] - Critical Auralization Corrections

### Fixed
- **Ambisonic IR channel routing and level matching for physical accuracy**
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts:237-282` - Fixed FOA convolver channel routing with splitter/merger chain
  - `frontend/src/lib/audio/modes/AmbisonicIRMode.ts:284-356` - Fixed SOA/TOA multi-mono convolver channel routing
  - `frontend/src/lib/audio/modes/MonoIRMode.ts:220-247` - Fixed encoder output routing with channel splitter
  - **Problem 1 - FOA routing bug:** 4-channel convolver output was incorrectly routed (all channels → merger ch 0) instead of proper channel mapping
  - **Problem 2 - Missing W-channel boost:** Added √2 (+3dB) gain to W channel (ACN index 0) for proper ambisonic level matching
  - **Problem 3 - Multi-channel node output bug:** ChannelMerger and GainNode only have 1 output, cannot directly access channels 1, 2, 3...
  - **Solution:** Added ChannelSplitter after encoder/gain to split multi-channel signal before routing to ambisonic merger
  - **Impact:** Mono IR (single channel) now has comparable loudness to 16-channel ambisonic IR as expected
  - **Impact:** Auralization spatial distribution now matches professional convolution tools (proper L/R/center balance)

### Technical Details
- **FOA signal flow:** Convolver (4-ch) → Splitter → W-gain boost (√2) → Merger → Volume/Mute/Wet → Output Splitter → Ambisonic Merger
- **SOA/TOA signal flow:** 16x Mono Convolvers → W-gain boost (√2) → Merger → Volume/Mute/Wet → Output Splitter → Ambisonic Merger
- **MonoIR signal flow:** Convolver → Gain/Mute/Wet → Encoder (multi-ch) → Encoder Splitter → Ambisonic Merger
- **Key insight:** Web Audio nodes (GainNode, ChannelMerger) output multi-channel as single stream - must use ChannelSplitter to route individual channels
- **Web Audio API quirk:** `node.connect(dest, outputIndex, inputIndex)` - outputIndex refers to the source node's output channel, not the multi-channel stream's channels
- **W-channel boost rationale:** Ambisonic W channel (omnidirectional) needs √2 scaling for proper level matching when decoded to binaural
- **ACN channel ordering:** W (0), Y (1), Z (2), X (3), ... properly preserved through routing chain

## [2025-11-19 Sound Sphere Spacing] - Unified Spacing for All Sound Generation Modes

### Fixed
- **Sound sphere spacing now works consistently across all 4 sound generation modes**
  - `frontend/src/lib/constants.ts:283-289` - Added position generation constants (DEFAULT_POSITION_SPACING, DEFAULT_POSITION_OFFSET, DEFAULT_POSITION_Y, DEFAULT_POSITION_Z)
  - `frontend/src/lib/sound/positioning.ts:9-14` - Imported position spacing constants
  - `frontend/src/lib/sound/positioning.ts:87-128` - Created `calculateSoundPositionWithSpacing()` function that handles spacing for all modes
  - `frontend/src/lib/sound/event-factory.ts:9` - Updated import to use `calculateSoundPositionWithSpacing`
  - `frontend/src/lib/sound/event-factory.ts:32-33,41,45` - Updated `createSoundEventFromUpload()` to accept `totalSounds` parameter for proper spacing calculation
  - `frontend/src/hooks/useSoundGeneration.ts:183-184` - Calculate total sounds count across all modes (text-to-audio, upload, sample-audio, library)
  - `frontend/src/hooks/useSoundGeneration.ts:252-260` - Pass `totalSoundsCount` to uploaded sound event creation
  - `frontend/src/hooks/useSoundGeneration.ts:294-301` - Pass `totalSoundsCount` to library sound event creation
  - Previously: Upload, sample-audio, and library modes used simple geometry center, while text-to-audio had proper spacing
  - Now: All 4 modes share the same spacing logic with 3 priority levels:
    1. Entity position (if sound is linked to an entity)
    2. Random position within bounding box (if model is loaded and no entity)
    3. Linear spacing along X-axis with 5m intervals (default fallback)
  - When mixing modes (e.g., 2 text-to-audio + 3 uploaded + 1 library), all 6 sounds are spaced evenly
  - Spacing matches backend logic: `x = (index * 5) - (total * 1.5)`, `y = 1`, `z = 0`

### Technical Details
- **Unified position calculation:** Single function `calculateSoundPositionWithSpacing()` replaces per-mode logic
- **Total sound count:** Calculated before generating any sounds to ensure consistent spacing across all modes
- **Bounding box behavior:** When model is loaded, sounds are randomly placed within the geometry bounds
- **No bounding box:** Sounds are evenly spaced along X-axis centered around origin
- **Entity attachment:** Takes highest priority - sound stays at entity position regardless of bounding box

## [2025-11-19 Sound Reset Fix] - Fix Reset Button Stale Closure Issue

### Fixed
- **Reset button stale closure bug causing labels to persist**
  - `frontend/src/app/page.tsx:179-194` - Updated `handleResetSound` to use functional setState for soundscapeData
  - `frontend/src/hooks/useSoundGeneration.ts:616-644` - Added `handleResetSoundConfig` with functional setState for soundConfigs
  - Fixed issue where reset button would fail on 3rd+ sound due to stale closure capturing old soundscapeData
  - Previously used direct state access which created race conditions with multiple sequential resets
  - Now uses `prev =>` functional updates to always work with latest state
  - Labels now properly disappear for all sounds regardless of reset order
  - Sound configs properly revert to generation UI for all indices

### Technical Details
- **Root cause:** React closures captured stale state when callback dependencies didn't change
- **Solution:** Functional setState pattern (`prev => ...`) ensures access to current state
- **Affected operations:**
  - Filtering soundscapeData to remove reset sound
  - Clearing config fields (display_name, uploadedAudio*, selectedLibrarySound, librarySearchState)
  - Memory cleanup (revoking object URLs)

## [2025-11-19 Variant Selection UI] - Add Variant Selector to Sound Cards

### Added
- **Variant selector in sound cards** - Users can now select between multiple generated variants
  - `frontend/src/components/layout/sidebar/SoundTab.tsx:38-39` - Added `variants` and `selectedVariantIdx` props
  - `frontend/src/components/layout/sidebar/SoundTab.tsx:77-78` - Destructure variant props with defaults
  - `frontend/src/components/layout/sidebar/SoundTab.tsx:432-458` - Implemented variant selector UI with horizontal numbered buttons
  - Appears below volume/interval sliders when multiple variants exist (>1)
  - Shows numbered buttons (1, 2, 3, etc.) for each variant
  - Selected variant highlighted with primary color, unselected with neutral gray
  - Displays "Variant X/N" text below buttons showing current selection
  - Matches the same UI pattern as SoundUIOverlay.tsx for consistency

- **Variant data passed through component hierarchy**
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx:63-70` - Added helper functions to get variants and selected index
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx:163-164` - Calculate variants for each prompt
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx:189-190` - Pass `variants` and `selectedVariantIdx` to SoundTab
  - `frontend/src/components/layout/Sidebar.tsx:203` - Pass `selectedVariants` prop from parent
  - `frontend/src/types/components.ts:251` - Added `selectedVariants` to SoundGenerationSectionProps type

### Changed
- **Sound card UI** - Enhanced with variant selection capability
  - Variant selector only shows when sound is generated and expanded
  - Automatically hides when only 1 variant exists
  - Integrated seamlessly with existing volume/interval controls

## [2025-11-19 Sound Card Reset Enhancement] - Proper Sound Config State Reset

### Fixed
- **Reset button race condition with multiple sounds**
  - `frontend/src/hooks/useSoundGeneration.ts:616-639` - Added `handleResetSoundConfig` for atomic state updates
  - `frontend/src/app/page.tsx:179-191` - Updated `handleResetSound` to use atomic reset function
  - Fixed issue where resetting second sound would leave label visible and config not properly cleared
  - Now uses functional setState to avoid race conditions from multiple sequential state updates
  - All generated-state fields are cleared in a single atomic operation

### Changed
- **Reset button now properly reverts sound card to pre-generation state**
  - Now clears: display_name, uploadedAudioBuffer, uploadedAudioInfo, uploadedAudioUrl, selectedLibrarySound, librarySearchState
  - Revokes uploaded audio URL to free memory
  - Keeps core config intact: prompt, entity, mode, duration, guidance_scale, etc.
  - Sound card returns to generation UI with original settings
  - Removes sound from scene and soundscape data
  - Works correctly for all sound indices (first, second, nth sound)

## [2025-11-19 Entity-Linked Sound Improvements] - Fix Entity Click Coloring and Sound Label Display

### Fixed
- **Entity info overlay not hiding on sound sphere click** - Clicking on a sound sphere now clears entity selection
  - `frontend/src/components/scene/ThreeScene.tsx:1001-1002` - Added `setSelectedEntity(null)` to sound sphere click handler
  - Entity information overlay now properly hides when switching from entity to sound sphere
  - Consistent behavior: clicking anywhere (empty space, sound sphere, etc.) clears entity selection

- **Double shade artifact on entity click** - Entity click no longer applies conflicting coloring for sound-linked entities
  - `frontend/src/lib/three/geometry-renderer.ts:254-260` - Added `entitiesWithLinkedSounds` parameter to `updateEntitySelection`
  - `frontend/src/lib/three/geometry-renderer.ts:280-297` - Skip creating highlight mesh when entity has a linked sound
  - `frontend/src/components/scene/ThreeScene.tsx:1341-1346` - Pass `entitiesWithLinkedSounds` to `updateEntitySelection`
  - Sound card selection coloring (via `updateDiverseHighlights`) now takes priority for sound-linked entities
  - Entity click highlighting only applies to entities without linked sounds
  - Prevents double shading artifact where both systems tried to color the same entity

### Added
- **Sound label in entity information overlay** - Entity overlay now displays linked sound information
  - `frontend/src/components/overlays/EntityInfoBox.tsx:14` - Added `linkedSoundName` prop for sound display name
  - `frontend/src/components/overlays/EntityInfoBox.tsx:218-231` - Added "Linked Sound" section with sound number and name
  - `frontend/src/components/scene/ThreeScene.tsx:2200,2217` - Pass `soundOverlay.displayName` to EntityInfoBox
  - Shows sound number (e.g., "#4") in green color and sound name
  - Only displays when entity has a linked sound
  - Separated by a border line for visual clarity

### Changed
- **Entity highlighting logic** - More intelligent handling of sound-linked entities
  - Entity selection highlighting now checks if entity has linked sound before applying
  - Sound card selection coloring remains active even when entity is selected
  - Clearer visual feedback: green link button + sound info in overlay + sound card coloring

## [2025-11-19 Sound Labels & Entity Interaction] - Fix Sound Sphere Labels, Drag, and Entity-Linked Sound Visualization

### Fixed
- **Sound sphere number labels** - Labels now appear immediately after sound generation without requiring a click
  - `frontend/src/components/scene/ThreeScene.tsx:193` - Added `sphereUpdateCounter` state to trigger label updates
  - `frontend/src/components/scene/ThreeScene.tsx:1630-1634` - Trigger label update after spheres are created using setTimeout
  - `frontend/src/components/scene/ThreeScene.tsx:1217` - Added `sphereUpdateCounter` to label effect dependencies
  - Labels are created in the effect that runs after `updateSoundSpheres` completes

- **Entity-linked sound labels** - Labels now display correctly above entities with linked sounds
  - `frontend/src/components/scene/ThreeScene.tsx:272-303` - Added `calculateEntityBounds` helper to compute entity bounding boxes from geometry data
  - `frontend/src/components/scene/ThreeScene.tsx:1202-1212` - Use `calculateEntityBounds` to position labels above entity-linked sounds
  - Previously tried to find entity meshes that don't exist individually (geometry is unified)
  - Now properly calculates entity center and bounds from `geometryData.face_entity_map`

- **Sound-linked object coloring** - Entities with linked sounds now get colored when their sound card is selected
  - `frontend/src/components/scene/ThreeScene.tsx:845-863` - Added `selectedSoundEntityIndices` memoized value to track selected sound's entity
  - `frontend/src/lib/three/geometry-renderer.ts:90-96` - Added `selectedSoundEntityIndices` parameter to `updateDiverseHighlights`
  - `frontend/src/lib/three/geometry-renderer.ts:151-220` - Modified solid highlight rendering to separate selected vs unselected entity-linked sounds
    - Selected sound entities → SECONDARY color (#ff6b9d)
    - Unselected sound entities → PRIMARY color (pink)
  - `frontend/src/components/scene/ThreeScene.tsx:1313-1318` - Pass `selectedSoundEntityIndices` to `updateDiverseHighlights`
  - Removed manual color manipulation from sound visualization effect (now handled in GeometryRenderer)

- **Entity click vs sound selection** - Entity left-click coloring no longer competes with sound card selection coloring
  - Entity click highlighting uses `updateEntitySelection` which hides diverse highlights and shows individual entity
  - Sound card selection uses `updateDiverseHighlights` with priority coloring (SECONDARY > PRIMARY)
  - The two systems work in separate visual layers and don't conflict
  - Individual entity selection (left-click) takes priority over diverse selection highlighting

- **Labels not following sphere during drag** - Number labels now move with sound spheres when dragged
  - `frontend/src/components/scene/ThreeScene.tsx:1210-1211` - Tag labels with `promptIndex` and `isEntityLinked` for identification
  - `frontend/src/components/scene/ThreeScene.tsx:1225-1226` - Tag entity-linked labels with `promptIndex` and `isEntityLinked`
  - `frontend/src/components/scene/ThreeScene.tsx:972-989` - Update label position during sphere drag via `setOnSpherePositionUpdated` callback
  - Labels are filtered by `promptIndex` and `isEntityLinked` to ensure only sphere labels move (not entity labels)
  - Drag system uses Three.js DragControls in InputHandler, which triggers `onSpherePositionUpdated`

- **Entity click doesn't expand sound card** - Clicking on entity with linked sound now expands corresponding sound card
  - `frontend/src/components/scene/ThreeScene.tsx:1292-1305` - Added logic to find linked sound and call `onSelectSoundCard`
  - `frontend/src/components/scene/ThreeScene.tsx:1315-1316` - Added `soundscapeData` and `onSelectSoundCard` to effect dependencies
  - When entity is clicked, searches `soundscapeData` for sound with matching `entity_index`
  - Calls `onSelectSoundCard` with the sound's prompt index to expand the card in sidebar

### Changed
- **GeometryRenderer coloring logic** - Now handles sound selection coloring at the renderer level
  - More efficient: colors are set during mesh creation, not manipulated after
  - Cleaner separation: ThreeScene manages state, GeometryRenderer handles rendering
  - Better organization: all entity coloring logic centralized in one place

- **Label management** - Labels now tagged with metadata for better identification
  - All labels have `promptIndex` to match with their sound
  - All labels have `isEntityLinked` flag to distinguish sphere labels from entity labels
  - Enables precise label updates during drag without affecting entity labels

## [2025-11-19 Editable Sound Names] - Sound Card Names Editable with Timeline Sync

### Added
- **Editable sound card names** - Sound card names can now be edited inline and sync to timeline
  - `frontend/src/components/layout/sidebar/SoundTab.tsx:100-137` - Added inline name editing state and handlers
    - Double-click on sound card title to edit name
    - Enter to save, Escape to cancel
    - Shows pencil icon on hover to indicate editability
    - Input field appears with focus when editing
  - `frontend/src/components/layout/sidebar/SoundTab.tsx:203-236` - Updated header UI with conditional editing/display mode
    - Replaced simple button with editable div that shows input on double-click
    - Maintains expand/collapse functionality when clicking (not double-clicking)
  - `frontend/src/hooks/useSoundGeneration.ts:704-733` - Added effect to propagate name changes to soundscape data
    - Watches for display_name changes in soundConfigs
    - Updates corresponding sounds in soundscapeData with matching prompt_index
    - Updates generatedSounds to keep in sync
    - Ensures timeline receives updated names via audio source userData

### Changed
- **Name propagation flow** - Display name changes now propagate through entire audio pipeline
  - Config → SoundscapeData → Audio Sources → Timeline labels
  - Timeline automatically updates when sound card name is edited

## [2025-11-19 Receiver Fix] - Fix Receiver Numbering Issue

### Fixed
- **Receiver numbering** - Receivers now correctly number sequentially (Receiver 1, 2, 3...)
  - `frontend/src/hooks/useReceivers.ts:44-54` - Fixed stale closure issue in placeReceiver callback
    - Changed from using `receivers.length` (stale value from closure) to `prev.length` (current state)
    - Used functional update pattern: `setReceivers(prev => ...)` instead of accessing external state
    - Removed `receivers.length` from dependency array (no longer needed)
  - Previously all receivers were named "Receiver 1" due to stale state in the callback
  - Now receivers correctly increment: "Receiver 1", "Receiver 2", "Receiver 3", etc.

### Verified
- **Receiver names are editable** - Confirmed existing functionality in [ReceiversSection.tsx:115-143](frontend/src/components/layout/sidebar/ReceiversSection.tsx#L115-L143)
  - Double-click on receiver name to edit
  - Enter to save, Escape to cancel
  - Name updates propagate through `onUpdateReceiverName` callback

## [2025-11-18 Entity Display] - Unified Entity Information Positioning

### Fixed
- **Entity information overlay positioning** - All entities now display at same position
  - `frontend/src/components/scene/ThreeScene.tsx` - Removed conditional offset logic for entity-linked sounds
  - EntityInfoBox now always positioned directly at entity, regardless of link state
  - Simplified code by removing unnecessary soundOverlay visibility checks and VERTICAL_STACK_OFFSET calculation

## [2025-11-18 Final] - Sound Card Selection from 3D Scene

### Added
- **Click sound sphere or entity to select card** - Implemented full bidirectional selection
  - `frontend/src/types/three-scene.ts` - Added onSelectSoundCard callback prop
  - `frontend/src/components/scene/ThreeScene.tsx` - Wire sphere and entity clicks to callback
    - Extract promptIndex from sphere promptKey and find entity-linked sounds
    - Call onSelectSoundCard when clicking sound sphere or entity with linked sound
  - `frontend/src/app/page.tsx` - Added selectedCardIndex state and handleSelectSoundCard
  - `frontend/src/types/components.ts` - Added selectedCardIndex prop to SidebarProps and SoundGenerationSectionProps
  - `frontend/src/components/layout/Sidebar.tsx` - Pass selectedCardIndex through
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Watch selectedCardIndex and auto-expand card
    - Scroll selected card into view with smooth animation
    - Only one card expanded at a time

### Fixed
- **Sound card click expansion** - Fixed double-toggle bug preventing card from opening
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Removed duplicate handleToggleExpand call in onSelectCard

### Changed
- **Add Sound button** - Moved next to Generate button as small green "+" icon
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Changed from full-width button to compact icon button
  - Only shows when not generating (replaced by Stop button during generation)

## [2025-11-18 Latest] - Sound Card Bug Fixes and Enhancements

### Fixed
- **Slider responsiveness** - Volume and interval sliders now respond immediately to changes
  - `frontend/src/types/components.ts` - Added soundVolumes and soundIntervals props to SidebarProps and SoundGenerationSectionProps
  - `frontend/src/app/page.tsx` - Pass soundVolumes and soundIntervals from audioControls to Sidebar
  - `frontend/src/components/layout/Sidebar.tsx` - Forward soundVolumes and soundIntervals to SoundGenerationSection
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Pass soundVolumes and soundIntervals to each SoundTab
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - Read live values from soundVolumes/soundIntervals instead of stale generatedSound object

- **Deletion behavior** - Sound cards now properly remove on first click
  - `frontend/src/hooks/useSoundGeneration.ts` - handleRemoveConfig now removes both config and generated sound atomically in one operation

- **Add Sound creates fresh config** - No longer restores previous sound config
  - `frontend/src/hooks/useSoundGeneration.ts` - Added librarySearchState: undefined to clear all library search state

- **Sound count display** - Now shows actual generated sounds count instead of card count
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Changed totalCards to totalSounds in status calculation

### Added
- **Reset button functionality** - Wire up to remove generated sound while keeping config
  - `frontend/src/types/components.ts` - Added onResetSound callback prop
  - `frontend/src/app/page.tsx` - Implemented handleResetSound to filter soundscapeData
  - `frontend/src/components/layout/Sidebar.tsx` - Pass onResetSound through to SoundGenerationSection
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Call onResetSound when reset button clicked

- **Sound card selection from scene** - Placeholder for clicking sound sphere/entity to select card
  - `frontend/src/types/components.ts` - Added onSelectSoundCard callback prop
  - `frontend/src/app/page.tsx` - Implemented handleSelectSoundCard placeholder
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - Added onSelectCard callback that triggers when title clicked

### TODO
- Wire ThreeScene click events to call onSelectSoundCard with promptIndex
- Add visual pulse/highlight effect on sphere/entity when selecting corresponding card

## [2025-11-18] - Sound Card Improvements and Bug Fixes

### Changed
- **Single-card expansion behavior** - Only one sound card can be expanded at a time
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Modified handleToggleExpand to collapse other tabs when expanding one
  - Auto-expand newly added sound cards and collapse others
  
- **Fixed slider responsiveness** - Volume and interval sliders now respond immediately to changes
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - Added key props to RangeSlider components for proper reactivity
  
- **Improved deletion behavior** - Delete now properly removes sounds from scene and timeline
  - `frontend/src/hooks/useSoundGeneration.ts` - Enhanced handleRemoveConfig to also remove generated sounds from soundscapeData
  
- **Fixed Add Sound behavior** - Now creates completely fresh config instead of restoring previous state
  - `frontend/src/hooks/useSoundGeneration.ts` - Modified handleAddConfig to explicitly clear all optional fields
  
- **Visual feedback for mute/solo** - Cards grey out when muted
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - Added opacity: 0.5 when isMuted is true

### Added
- **Sound status counter** - Shows total sounds and pending count below Generate button
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Added useMemo calculation and display
  
### Removed
- **Play button** - Removed from sound cards as sounds are now controlled via timeline
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - Removed Play/Pause button section

### TODO
- Implement highlight/pulse effect on sphere/entity when selecting card
- Wire up Reset button to properly remove generated sound while keeping config

## [2025-11-18] - Refactored Sound Generation Tab to Vertical Card Layout

### Changed
- **Complete redesign of Sound Generation UI in sidebar**
  - `frontend/src/components/layout/Sidebar.tsx` - Changed tab label from "Sound Generation" to "Soundscape"
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx` - Major refactor:
    - Replaced horizontal tab navigation with vertical list of sound cards
    - Added "Generate All Sounds" button at top instead of bottom
    - Removed global generation controls (duration, steps, etc.)
    - Each sound now displayed as collapsible card in vertical list
  - `frontend/src/components/layout/sidebar/SoundTab.tsx` - New component:
    - **Collapsed state**: Shows only title, link, reset, mute, solo, and close buttons
    - **Expanded (not generated)**: Shows full generation UI (mode selector, prompt, duration, guidance, variants)
    - **Expanded (generated)**: Shows playback controls (volume slider, interval slider, play/pause)
    - Background color changes based on generation state (neutral for not generated, success-tint for generated)
  - `frontend/src/components/scene/ThreeScene.tsx` - Removed SoundUIOverlay rendering:
    - Commented out SoundUIOverlay import and rendering logic
    - Removed "Toggle Sound Boxes" button from scene controls
    - Deprecated overlay interaction handlers (drag, hide toggle)
  - `frontend/src/types/components.ts` - Updated props:
    - Added audio control props to SidebarProps and SoundGenerationSectionProps
    - Added individualSoundStates, onToggleSound, onVolumeChange, onIntervalChange, onMute, onSolo
  - `frontend/src/app/page.tsx` - Pass audio controls to Sidebar

### Added
- **Sound playback controls integrated into sidebar cards**
  - Volume slider (40-100 dB SPL)
  - Playback interval slider (0-120 seconds, 0 = loop)
  - Mute button (compact icon)
  - Solo button (compact icon with star)
  - Play/Pause button
- **Reset button** - Allows reverting generated sound back to generation UI
- **Visual feedback** - Different backgrounds for generated vs non-generated sounds

### Removed
- Horizontal sound tabs navigation
- Global generation settings UI
- SoundUIOverlay from 3D scene (controls moved to sidebar)
- "Toggle Sound Boxes" button from scene controls
- Individual sound overlay dragging and hiding features

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

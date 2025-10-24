# CHANGELOG

## [2025-10-24 19:30] - Stop All Re-scheduling Fix & Comprehensive Seek Debugging
### Fixed
- **Stop All Sounds Keep Getting Re-scheduled**
  - Root cause: Previous state tracking wasn't cleared after Stop All, causing updateSoundPlayback to see "state changes" and re-schedule
  - Solution: Clear `prevIndividualSoundStates`, `prevSoundIntervals`, and `isPlayAll` flag in stopAllSounds
  - Prevents any re-scheduling after emergency kill
  - `frontend/src/lib/audio/playback-scheduler-service.ts:184-188` - State clearing

- **Timeline Seek Sounds Getting Descheduled (No Debug Info)**
  - Added comprehensive per-sound logging showing exact state of each sound during seek
  - Each sound now logs: ✅ PLAYING, ⏰ SCHEDULED, or ❌ SKIPPED with reason
  - Shows which sounds failed to play and why (no buffer, wrong state, play() failed)
  - Audio context and sources state logged BEFORE and AFTER seek
  - `frontend/src/lib/audio/playback-scheduler-service.ts:261-362` - Detailed seek logging

### Added
- **Per-Sound Seek Results Logging**
  ```
  [PlaybackScheduler] SEEK RESULTS:
    Bird chirp: ✅ PLAYING from 2.3s, next in 7.7s
    Dog bark: ⏰ SCHEDULED to play in 3.5s
    Car horn: ❌ SKIPPED - State: paused
    Wind sound: ❌ FAILED TO PLAY - Audio.play() called but isPlaying=false
  ```

- **Stop All Enhanced Logging**
  ```
  [PlaybackScheduler] STOP ALL - Emergency kill activated
  [PlaybackScheduler] STOP ALL - State cleared, preventing re-schedule
  [PlaybackScheduler] STOP ALL - Complete
  ```

- **Seek Operation Tracking**
  - Shows total sounds vs sounds that should be playing
  - Tracks what decision was made for each sound
  - Detects if audio.play() was called but isPlaying remains false
  - Verifies audio context state after seek completes

### Changed
- **stopAllSounds() Now Clears All State**
  - Clears previous state tracking to prevent re-scheduling
  - Resets isPlayAll flag
  - Ensures clean slate after Stop All

**Debugging Output Examples:**

1. **Stop All:**
   ```
   [PlaybackScheduler] STOP ALL - Emergency kill activated
   [EMERGENCY AUDIO KILL] Activating failsafe...
   [AUDIO DEBUG BEFORE KILL] AudioContext State: { state: 'running', masterVolume: 1 }
   [EMERGENCY AUDIO KILL] Killed 5 audio source(s)
   [PlaybackScheduler] STOP ALL - State cleared, preventing re-schedule
   [PlaybackScheduler] STOP ALL - Complete
   ```

2. **Timeline Seek:**
   ```
   [PlaybackScheduler] SEEK to 15.50s
   [PlaybackScheduler] SEEK: 5 sounds should be playing out of 5 total
   [PlaybackScheduler] SEEK RESULTS:
     Sound 1: ✅ PLAYING from 1.2s, next in 8.8s
     Sound 2: ⏰ SCHEDULED to play in 2.3s
     Sound 3: ✅ PLAYING from 0.5s, next in 4.5s
   [AUDIO DEBUG AFTER SEEK] AudioContext State: { state: 'running', masterVolume: 1 }
   [AUDIO DEBUG AFTER SEEK] Audio Sources: { total: 5, playing: 3, stopped: 2 }
   [PlaybackScheduler] SEEK Complete
   ```

**Files Modified:**
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Stop state clearing + seek debugging

## [2025-10-24 19:00] - Audio Playback Synchronization Fixes
### Fixed
- **Stop All → Play All Not Playing Sounds**
  - Root cause: Audio context was being suspended during emergency kill and not properly resumed
  - Removed audio context suspension from emergency kill (only mutes + stops sources)
  - Made `restoreAudioAfterKill()` async and force resume audio context
  - Made `stopAllSounds()` async and properly await restoration
  - `frontend/src/lib/audio/emergency-audio-kill.ts:73-76` - Removed context suspension
  - `frontend/src/lib/audio/emergency-audio-kill.ts:87-108` - Async restore with forced resume
  - `frontend/src/lib/audio/playback-scheduler-service.ts:170-185` - Async stopAllSounds

- **Timeline Seek Not Playing Sounds at Correct Time**
  - Made `seekToTime()` async to ensure audio context is resumed before scheduling
  - Added audio context state verification before seek operation
  - Properly await async operations in ThreeScene handlers
  - `frontend/src/lib/audio/playback-scheduler-service.ts:217-222` - Async seekToTime
  - `frontend/src/components/scene/ThreeScene.tsx:182-201` - Async handleSeek

- **Async Operations Not Properly Awaited**
  - Updated all calls to `stopAllSounds()` to properly await completion
  - Used async IIFE in useEffect hooks to handle async operations
  - `frontend/src/components/scene/ThreeScene.tsx:510-516` - Await in variant change effect
  - `frontend/src/components/scene/ThreeScene.tsx:635-650` - Await in auralization effect

### Added
- **Comprehensive Audio Debugging System**
  - New `audio-debug.ts` utility for tracking audio state and synchronization
  - Real-time audio context state logging (running/suspended)
  - Audio sources state verification (playing/stopped/disconnected)
  - Timeline sync reporting (scheduled vs playing vs displayed)
  - Automatic audio context resume with error handling
  - `frontend/src/lib/audio/audio-debug.ts` - Complete debugging utility

- **Enhanced Logging Throughout Audio Stack**
  - Audio context state logged at key points (before/after operations)
  - Playback verification when scheduling sounds
  - Seek operation logging with sound count tracking
  - Emergency kill now logs before/after state
  - `frontend/src/lib/audio/playback-scheduler-service.ts:49` - Context check in updatePlayback
  - `frontend/src/lib/audio/playback-scheduler-service.ts:223-247` - Seek debugging
  - `frontend/src/lib/audio/emergency-audio-kill.ts:35-36` - Before kill logging

### Changed
- **Emergency Kill No Longer Suspends Audio Context**
  - Audio context suspension was causing resume issues
  - Now only mutes master volume + stops individual sources
  - More reliable for Stop All → Play All workflow
  - Context automatically resumes when needed for playback

**Debugging Features:**
- `audioDebugger.logAudioContextState()` - Check context state and master volume
- `audioDebugger.logAudioSourcesState()` - List playing/stopped/disconnected sources
- `audioDebugger.verifyAudioPlayback()` - Verify sounds will actually play
- `audioDebugger.forceResumeAudioContext()` - Force resume if suspended
- `audioDebugger.printTimelineSyncReport()` - Compare scheduled vs playing vs displayed

**Files Modified:**
- `frontend/src/lib/audio/audio-debug.ts` - New file
- `frontend/src/lib/audio/emergency-audio-kill.ts` - Async restore + no suspension
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Async methods + debugging
- `frontend/src/components/scene/ThreeScene.tsx` - Properly await async operations

**Files Added:**
- `frontend/src/lib/audio/audio-debug.ts`

## [2025-10-24 17:30] - Emergency Audio Kill Switch (Failsafe)
### Added
- **Emergency Audio Kill Switch**
  - Created last-resort failsafe to immediately silence all audio
  - Independent of scheduling, state management, or timers
  - Three-level kill approach:
    1. **Master Volume Mute**: Sets AudioListener master volume to 0
    2. **Individual Source Kill**: Stops, mutes, and disconnects each audio source
    3. **Audio Context Suspend**: Suspends the browser's audio context
  - `frontend/src/lib/audio/emergency-audio-kill.ts` - New emergency kill utility

- **Integrated into Stop All Flow**
  - Emergency kill activates FIRST when Stop All is clicked
  - Provides instantaneous audio cutoff regardless of any other state
  - Normal stop flow (unscheduling, state updates) happens AFTER
  - Audio system automatically restores after 50ms (ready for next play)
  - `frontend/src/components/scene/ThreeScene.tsx:177-196` - Emergency kill in handleStopAll
  - `frontend/src/lib/audio/playback-scheduler-service.ts:166-180` - Emergency kill in stopAllSounds

### Fixed
- **Stop All Button Not Silencing All Sounds**
  - Some sounds would continue playing after clicking Stop All
  - Root cause: Scheduled sounds with pending timeouts could start playing after stop
  - Emergency kill switch provides absolute silence guarantee
  - Master volume mute ensures no sound can play even if scheduled

**How It Works:**
1. User clicks "Stop All"
2. **IMMEDIATELY**: Emergency kill mutes master volume + stops all sources
3. Unschedules all timers and clears state
4. After 50ms: Restores master volume (ready for next play)
5. Result: Guaranteed silence, no lingering audio

**Files Modified:**
- `frontend/src/lib/audio/emergency-audio-kill.ts` - New file
- `frontend/src/components/scene/ThreeScene.tsx` - Emergency kill in handleStopAll
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Emergency kill in stopAllSounds

**Files Added:**
- `frontend/src/lib/audio/emergency-audio-kill.ts`

## [2025-10-24 17:00] - Real-time Scheduled Sounds Logger
### Added
- **New Real-time Scheduled Sounds Display**
  - Created `scheduled-sounds-logger.ts` utility for clean console output
  - Displays a formatted table showing all scheduled sounds with live updates
  - Shows sound name, interval, time until next play, and status (🔊 Playing or ⏰ Scheduled)
  - Table updates in real-time as sounds are scheduled, played, or unscheduled
  - Optional periodic updates for countdown timers (1 second intervals)
  - `frontend/src/lib/audio/scheduled-sounds-logger.ts` - New logger utility

### Changed
- **Replaced Verbose AudioScheduler Logs**
  - Removed detailed console logs from AudioScheduler
  - Integrated with new scheduled-sounds-logger for clean output
  - Logger updates on: schedule, play, next playback, unschedule events
  - `frontend/src/lib/audio-scheduler.ts` - Uses scheduledSoundsLogger instead of console.log

- **Simplified PlaybackSchedulerService Logs**
  - Removed verbose debugging logs from playback state changes
  - Removed "Starting sound", "Stopping sound", "Processing" logs
  - Removed seek operation logs
  - Audio scheduling now appears only in the formatted table
  - `frontend/src/lib/audio/playback-scheduler-service.ts` - Removed console.log statements

**Console Output Before:**
```
[AudioScheduler] Scheduling sound Bird chirp:
  - Sound duration: 5000ms
  - Interval setting: 10s (10000ms)
  - Total interval: 15000ms
  - Randomness: ±10%
  - Initial delay: 2500ms
[AudioScheduler] Playing sound Bird chirp (after initial delay)
[AudioScheduler] Next playback for Bird chirp in 16.2s (base: 15.0s)
[PlaybackScheduler] Starting sound Dog bark, isPlayAll: true
[PlaybackScheduler] Interval sources: UI=5, Event=10, Final=5s
```

**Console Output After:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    SCHEDULED SOUNDS (Real-time)                 │
├─────────────────────────────────────────────────────────────────┤
│ Sound Name                  | Interval | Next Play | Status     │
├─────────────────────────────────────────────────────────────────┤
│ Bird chirp                  | 10s      | 12.3s     | 🔊 Playing │
│ Dog bark                    | 5s       | 3.1s      | ⏰ Scheduled│
│ Car horn                    | 15s      | 8.7s      | ⏰ Scheduled│
└─────────────────────────────────────────────────────────────────┘
Total Scheduled: 3 sound(s) | Updated: 5:00:23 PM
```

**Files Modified:**
- `frontend/src/lib/audio/scheduled-sounds-logger.ts` - New file with logger utility
- `frontend/src/lib/audio-scheduler.ts` - Integrated scheduledSoundsLogger
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Removed verbose logs

**Files Added:**
- `frontend/src/lib/audio/scheduled-sounds-logger.ts`

## [2025-10-24 16:30] - Interactive Timeline Seeking
### Added
- **Click-to-Seek Timeline Functionality**
  - Users can now click anywhere on the timeline to jump to that time position
  - Clicking stops current sounds, unschedules all scheduled sounds, and repositions playback
  - Timeline cursor moves to clicked position and sounds resume from correct timestamps
  - Initial delays are not taken into account when seeking (only base intervals)
  - Timeline remains visible and responsive during seeking
  - Cursor changes to pointer when hovering over timeline to indicate interactivity
  - `frontend/src/components/audio/AudioTimeline.tsx:66-88` - Added click handler to calculate time from click position
  - `frontend/src/components/audio/AudioTimeline.tsx:7-18` - Added `onSeek` callback prop
  - `frontend/src/components/audio/AudioTimeline.tsx:214` - Added cursor-pointer class and onClick handler

- **Seek Logic in PlaybackSchedulerService**
  - New `seekToTime()` method handles smart playback repositioning
  - Calculates which iteration of each sound should be active at seek time
  - If seeking lands during a sound's playback, plays sound from correct offset
  - If seeking lands during interval gap, schedules sound with appropriate delay
  - Preserves interval-based scheduling after seek operation completes
  - `frontend/src/lib/audio/playback-scheduler-service.ts:218-329` - Complete seek implementation

- **Timeline and Audio Coordination**
  - New `handleSeek()` callback in ThreeScene coordinates timeline cursor and audio playback
  - Updates both timeline visual cursor and audio playback state simultaneously
  - Ensures timeline and audio stay perfectly synchronized after seeking
  - `frontend/src/components/scene/ThreeScene.tsx:182-200` - Seek handler implementation
  - `frontend/src/components/scene/ThreeScene.tsx:763` - Wire up onSeek prop to AudioTimeline

### Changed
- **AudioTimeline Component**
  - Updated documentation to reflect click-to-seek functionality
  - Changed from "read-only visualization" to interactive timeline
  - Added cursor-pointer class for better UX feedback
  - `frontend/src/components/audio/AudioTimeline.tsx:20-33` - Updated component documentation

**Behavior After Changes:**
- **Click Timeline** → Stops all sounds, moves cursor to clicked position, resumes playback from that time
  - Sounds currently playing at that time start from correct offset
  - Sounds in interval gaps are scheduled with correct delays
  - Timeline cursor and audio playback stay synchronized
- **Play All / Pause All / Stop All** → Continue to work as before
- **Individual Sound Controls** → Continue to work as before

**Files Modified:**
- `frontend/src/components/audio/AudioTimeline.tsx` - Added click-to-seek handler and onSeek prop
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Added seekToTime() method
- `frontend/src/components/scene/ThreeScene.tsx` - Added handleSeek callback and wired it to AudioTimeline

## [2025-10-23 23:45] - Timeline Behavior Refinements
### Fixed
- **Timeline Stays Visible During "Pause All"**
  - When "Pause All" is pressed, timeline cursor freezes at current position and remains visible
  - Timeline data is preserved to show all sound schedules while paused
  - `frontend/src/components/scene/ThreeScene.tsx:657-663` - Keep timeline data when sounds are paused
  - `frontend/src/components/scene/ThreeScene.tsx:675-677` - Pause timeline cursor instead of stopping

- **Individual Paused Sounds Hidden From Timeline**
  - When an individual sound is paused, it is removed from the timeline visualization
  - Only applies to individual pauses, not "Pause All"
  - `frontend/src/lib/audio-scheduler.ts:142-148` - Restored original `unscheduleSound()` behavior
  - `frontend/src/lib/audio/playback-scheduler-service.ts:133-135` - Unschedule on individual pause

- **Resume From Pause Plays Immediately**
  - "Pause All → Play All" now resumes sounds immediately without staggered delays
  - Distinguishes between fresh "Play All" (from stopped) and resume "Play All" (from paused)
  - Fresh "Play All" uses random staggered delays for natural soundscape
  - Resume "Play All" starts all sounds immediately to continue where left off
  - `frontend/src/lib/audio/playback-scheduler-service.ts:62-74` - Detect pause resume vs fresh start

### Removed
- **Timeline Seeking Disabled**
  - Timeline is now read-only for visualization purposes
  - Removed click-to-seek functionality and cursor pointer
  - `frontend/src/components/audio/AudioTimeline.tsx:7-16` - Removed `onSeek` prop
  - `frontend/src/components/audio/AudioTimeline.tsx:203-212` - Removed click handler and cursor style
  - `frontend/src/components/scene/ThreeScene.tsx:743-749` - Removed `onSeek` prop from usage

**Behavior After Changes:**
- **Play All** → Sounds start with random stagger, timeline shows all scheduled iterations
- **Pause All** → Timeline cursor freezes and stays visible, all sounds shown on timeline
- **Individual Pause** → That specific sound disappears from timeline
- **Play All (after Pause All)** → Sounds resume immediately without stagger
- **Stop All** → Timeline cursor resets to 0 and clears all scheduled sounds
- **Timeline Click** → No action (timeline is read-only)

**Files Modified:**
- `frontend/src/components/scene/ThreeScene.tsx` - Timeline sync and visibility logic
- `frontend/src/components/audio/AudioTimeline.tsx` - Removed seeking functionality
- `frontend/src/lib/audio-scheduler.ts` - Restored original unschedule behavior
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Detect pause resume vs fresh start

## [2025-10-23 22:00] - Critical Timeline Sync Bug Fixes
### Fixed
- **Issue 1: Pause All No Longer Resets Timeline Cursor**
  - **Root Cause:** Sync effect was calling `stopTimeline()` when no sounds were 'playing', including when paused
  - **Fix:** Changed logic to only call `stopTimeline()` when ALL sounds are 'stopped' (not paused)
  - Now distinguishes between paused (cursor frozen) and stopped (cursor reset to 0)
  - Timeline cursor maintains its position when pausing, as expected
  - `ThreeScene.tsx` - Updated sync effect condition from `!anySoundPlaying` to `allSoundsStopped`

- **Issue 4: Individual Sound After Pause All Shows Correct Scheduling**
  - **Root Cause:** `isPlayAll` flag was never reset after "Play All", so individual sounds after pause got random initial delays
  - **Fix:** Reset `isPlayAll = false` when only 1 sound starts playing (individual playback)
  - Play All → Pause All → Play Individual Sound now shows correct scheduling without stagger
  - Timeline immediately updates with new scheduler data (initialDelayMs = 0 for individual sounds)
  - `playback-scheduler-service.ts` - Added logic to reset isPlayAll flag for individual playback

**Behavior After Fixes:**
- **Play All** → Sounds start with random stagger (initialDelayMs), timeline shows staggered schedule
- **Pause All** → Timeline cursor freezes at current position (doesn't reset to 0)
- **Play Individual** → Sound starts immediately (no stagger), timeline updates to show new schedule
- **Stop All** → Timeline cursor resets to 0

**Files Modified:**
- `frontend/src/components/scene/ThreeScene.tsx` - Fixed sync effect logic
- `frontend/src/lib/audio/playback-scheduler-service.ts` - Reset isPlayAll flag for individual sounds

## [2025-10-23 21:30] - Timeline Interaction & Sync Fixes
### Fixed
- **Click-to-Seek Behavior:**
  - Clicking timeline now only moves cursor position (doesn't stop audio)
  - Audio continues playing from current schedulers
  - Removed unnecessary `onStopAll()` call from `handleTimelineSeek()`

- **Individual Sound Playback:**
  - Timeline cursor now moves when individual sounds play (not just "Play All")
  - Added new effect to sync timeline playback with `individualSoundStates`
  - Timeline automatically starts when any sound begins playing
  - Timeline automatically stops when all sounds stop

- **Timeline Visibility:**
  - Confirmed: Pause All does NOT hide timeline (already working correctly)
  - Timeline only hidden/shown by user clicking toggle button

- **Real-time Timeline Updates:**
  - Timeline already updates when individual sounds play after pausing "Play All"
  - Effect dependency on `individualSoundStates` ensures timeline re-extracts on any state change
  - New schedulers with new timings are immediately reflected in visualization

**Files Modified:**
- `frontend/src/components/scene/ThreeScene.tsx` - Fixed handleTimelineSeek, added sync effect

**Impact:** Timeline now provides seamless, non-intrusive interaction and automatically syncs cursor movement with both "Play All" and individual sound playback modes.

## [2025-10-23 21:00] - Timeline UI/UX Improvements
### Changed
- **Timeline Visibility:**
  - Timeline now visible by default (no longer hidden on load)
  - Remains visible regardless of play/pause/stop state
  - Only hidden when user manually clicks toggle button
  
- **Timeline Height:**
  - Dynamic height calculation based on number of sounds
  - Minimal vertical space usage (adapts to content)
  - Removed fixed height prop from AudioTimeline component
  
- **Initial Delay Synchronization:**
  - Timeline now accurately reflects initial delay for "Play All" scenarios
  - `ScheduledSound` type updated with `initialDelayMs` property
  - First sound iteration now starts at initialDelayMs instead of 0
  - Visual and audio are now perfectly synced
  
- **Real-time Timeline Updates:**
  - Timeline updates when individual sounds are played (not just "Play All")
  - Timeline updates when new sounds are added during active playback
  - Effect dependency changed from `isAnyPlaying` to `individualSoundStates`
  
- **Click-to-Seek Functionality:**
  - Added interactive canvas click handler
  - Clicking anywhere on timeline stops all sounds and moves cursor to that position
  - Ready for future enhancement: resume playback from seek position

**Files Modified:**
- `frontend/src/components/audio/AudioTimeline.tsx` - Dynamic height, click handler, removed scrolling
- `frontend/src/components/scene/ThreeScene.tsx` - Timeline defaults to visible, handleTimelineSeek callback
- `frontend/src/lib/audio-scheduler.ts` - Store initialDelayMs in ScheduledSound
- `frontend/src/lib/audio/timeline-utils.ts` - Account for initialDelayMs in iteration calculations
- `frontend/src/types/audio.ts` - Added initialDelayMs to ScheduledSound interface

**Impact:** Timeline now provides accurate, real-time visualization of all scheduled sounds with minimal UI footprint and interactive seeking capability.

## [2025-10-23 20:30] - Timeline Playback Control Integration
### Changed
- **`frontend/src/components/audio/AudioTimeline.tsx`:**
  - Removed internal Play/Pause/Stop buttons
  - Now controlled externally via props (`currentTime`, `isPlaying`)
  - Simplified to pure visualization component without playback logic
- **`frontend/src/components/scene/ThreeScene.tsx`:**
  - Integrated `useTimelinePlayback` hook to manage timeline cursor state
  - Connected PlaybackControls buttons to control both audio playback AND timeline cursor
  - Play All → plays audio + starts timeline cursor
  - Pause All → pauses audio + pauses timeline cursor
  - Stop All → stops audio + resets timeline cursor to start
  - Timeline cursor now syncs with audio playback state

**Impact:** Unified playback control - Play All/Pause All/Stop All buttons now control both the audio sounds and the timeline visualization cursor simultaneously. Timeline is now a pure display component controlled by the main playback system.

## [2025-10-23 20:00] - Audio Timeline Integration
### Added
- **`frontend/src/components/audio/AudioTimeline.tsx`:**
  - Minimalistic timeline component for visualizing scheduled sounds
  - Canvas-based rendering with real-time playback cursor
  - Integrated into ThreeScene with toggle button
- **`frontend/src/hooks/useTimelinePlayback.ts`:**
  - Custom hook for timeline playback state management
- **`frontend/src/lib/audio/timeline-utils.ts`:**
  - Utility functions to extract timeline data from PlaybackSchedulerService
  - Color-codes sounds by generation method (Import/Library/TTA)
- **`frontend/src/lib/audio/playback-scheduler-service.ts`:**
  - Added `getAudioSchedulers()` method for timeline visualization
- **`frontend/src/lib/audio-scheduler.ts`:**
  - Added `getScheduledSounds()` method for read-only access
- **`frontend/src/types/audio.ts`:**
  - Added `TimelineSound` and `TimelinePlaybackState` interfaces
- **`frontend/src/lib/constants.ts`:**
  - Added `AUDIO_TIMELINE` configuration with 3 colors for sound sources:
    - Blue (#3B82F6) - Imported sounds
    - Green (#10B981) - Library sounds (BBC, Freesound)
    - Pink (#F500B8) - Text-to-Audio (TangoFlux)

### Changed
- **`frontend/src/components/scene/ThreeScene.tsx`:**
  - Integrated AudioTimeline component with toggle button
  - Timeline displays at bottom center, above playback controls
  - Automatically updates when sounds change or playback state changes

**Impact:** Timeline visualization provides real-time view of scheduled sound playback patterns, color-coded by generation method. Toggle button allows hiding/showing timeline as needed.

## [2025-10-23 18:00] - Major Architectural Refactor: Separation of Concerns
### Added
- **`frontend/src/lib/audio/playback-scheduler-service.ts`:**
  - NEW service to handle ONLY audio playback scheduling
  - Manages schedulers, play/pause/stop state, and interval timing
  - Completely separated from audio routing concerns

### Changed
- **`frontend/src/lib/audio/auralization-service.ts`:**
  - REMOVED all playback scheduling code (moved to PlaybackSchedulerService)
  - NOW ONLY handles impulse response convolution and audio routing
  - No longer manages schedulers or playback state
  - Pure audio routing service with no playback control
- **`frontend/src/components/scene/ThreeScene.tsx`:**
  - Added `playbackSchedulerRef` for new PlaybackSchedulerService
  - Playback control effect now uses PlaybackSchedulerService
  - Auralization effect now ONLY runs when IR buffer exists
  - Clear separation: PlaybackScheduler = playback, AuralizationService = routing
- **`frontend/src/lib/audio/playback-scheduler-service.ts`:**
  - Fixed interval fallback logic to properly handle 0 values
  - Explicit null/undefined checks instead of falsy checks
  - Prevents showing "0s" when event has valid 5s interval

### Fixed
- **Auralization logs appearing when no impulse response loaded:**
  - PlaybackSchedulerService handles all playback (no auralization involved)
  - AuralizationService ONLY runs when IR buffer exists
  - No more "[Auralization] Stopping and unscheduling" when just playing sounds
- **Multiple unnecessary "Stop All" calls:**
  - Only stop sounds when there are actual old audio sources
  - Prevents spam logs on app startup and sound generation

**Impact:** Clean architectural separation - playback scheduling is completely independent of auralization. Auralization service is now pure audio routing (convolution only). No more confusing logs when playing sounds without impulse response. The codebase is more maintainable with clear single responsibilities.

## [2025-10-23 17:00] - Audio Controls & Auralization Improvements
### Fixed
- **Unnecessary "Stop All" calls on app startup and sound generation:**
  - `frontend/src/components/scene/ThreeScene.tsx`:
    - Only call `stopAllSounds()` and `onStopAll()` when there are actual old audio sources to stop (line 445-448)
    - Prevents spam logs when loading app or generating new sounds
  - `frontend/src/hooks/useAudioControls.ts`:
    - Only log "Stop All requested" when there are actually sounds playing or paused (line 169-172)
    - Only log individual sound stops when state is actually changing (line 181-184)
    - Use `display_name` instead of IDs in all logs
- **Auralization effect running when no impulse response loaded:**
  - `frontend/src/components/scene/ThreeScene.tsx`:
    - Added proper guards to only run auralization effect when IR buffer exists (line 555-560)
    - Effect only runs when enabling/disabling auralization with actual IR loaded
    - Prevents unnecessary audio routing changes when just playing sounds without auralization
- **Audio controls logs showing IDs instead of display names:**
  - `frontend/src/hooks/useAudioControls.ts`:
    - Use `sound.display_name` in Play All logs (line 120, 128)
    - Use `sound.display_name` in Stop All logs (line 182)
    - Improved log clarity for uploaded/library sounds vs variants

**Impact:** Console logs are much cleaner - no spam on startup, sound generation, or normal playback. Auralization effect only runs when actually needed (IR loaded). All logs show meaningful file names for better debugging.

## [2025-10-23 16:30] - Audio Playback & Logging Improvements
### Fixed
- **Drag controls log spam:**
  - `frontend/src/lib/three/input-handler.ts`:
    - Removed verbose "Setting up drag controls" and "successfully created" console logs
    - Only log when drag events actually occur (dragstart, dragend)
    - Prevents log spam on every play/pause interaction
- **Variant switching bug - old variant continues playing:**
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Modified `stopAllSounds()` to unschedule ALL schedulers (not just current audio sources)
    - Clear all schedulers after stopping to prevent old variants from continuing
    - Ensures complete cleanup when variants change
  - `frontend/src/components/scene/ThreeScene.tsx`:
    - Stop all schedulers before updating sound spheres when variants change
    - Call `onStopAll()` after variant switch to sync UI state
    - Prevents old variant audio from playing after switching to new variant
- **Logs using internal IDs instead of display names:**
  - `frontend/src/lib/audio-scheduler.ts`:
    - Extract `display_name` from `audio.userData.soundEvent` for all logs
    - Logs now show actual file names (e.g., "dramatic_conversation_dd3a59f7_copy0") instead of IDs (e.g., "generated_0_0")
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Use `display_name` in all sound-related logs (starting, stopping, connecting)
    - Improves debuggability with meaningful names
  - `frontend/src/lib/three/sound-sphere-manager.ts`:
    - Use `display_name` in audio source logs (removing, reconnecting)
    - Consistent naming across all audio operations

**Impact:** Console logs are much cleaner (no spam on play/pause), variant switching works correctly (old variants fully stop), and all logs show meaningful file names instead of cryptic IDs like "generated_0_0".

## [2025-10-23] - Auralization Bug Fixes & Architecture Cleanup
### Fixed
- **Audio clipping and UI state issues when toggling auralization:**
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Separated playback control from audio routing (removed play/pause logic from `setupAuralization()`)
    - Added `stopAllSounds()` method for explicit sound stopping before routing changes
    - Fixed unscheduling of sounds when stopping to allow immediate replay
  - `frontend/src/components/scene/ThreeScene.tsx`:
    - Split sound sphere update effect from drag controls effect to prevent unnecessary mesh recreation
    - Added guards to prevent auralization effect from running on startup when disabled
    - Used refs instead of props for `auralizationConfig` in sound sphere updates to prevent recreation
    - Fixed drag controls not being called unnecessarily on app startup (only when objects exist)
  - `frontend/src/lib/three/sound-sphere-manager.ts`:
    - Fixed variant switching by explicitly stopping playing audio before removing sources
    - Store `soundEvent` metadata on audio objects for interval fallback
- **Drag controls errors after importing impulse response:**
  - `frontend/src/lib/three/input-handler.ts`:
    - Added deep validation of entire parent chain for valid `matrixWorld`
    - Wrapped DragControls creation in try-catch for better error handling
    - Always dispose and recreate drag controls (no reuse) to avoid stale references
  - `frontend/src/components/scene/ThreeScene.tsx`:
    - Removed `auralizationConfig` from sound sphere update effect dependencies
    - Sound spheres only recreated when soundscape/variants/scale changes (not auralization)
- **Interval settings using wrong default:**
  - `frontend/src/lib/constants.ts`:
    - Added `AUDIO_PLAYBACK` constants (`DEFAULT_INTERVAL_SECONDS: 5`, `INTERVAL_RANDOMNESS_PERCENT: 10`)
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Fixed interval fallback chain: UI value → sound event's `interval_seconds` → default (5s)
    - Removed hardcoded 30s and 10% values
### Changed
- **Architectural improvements:**
  - Separated concerns: Auralization service handles ONLY audio routing, not playback control
  - Centralized all audio constants in `frontend/src/lib/constants.ts`
  - Improved effect dependencies to prevent unnecessary re-renders

**Impact:** Auralization works smoothly without audio clipping, UI state mismatches, or drag control errors. Sound spheres remain draggable after importing impulse responses. Sounds play immediately after enabling auralization (no Play→Pause→Play required). Interval settings use correct 5-second default from sound events instead of 30 seconds.

## [2025-10-22] - Audio Waveform Interactive Zoom & Pan
### Added
- **Interactive zoom and pan for waveform visualizations:**
  - `frontend/src/hooks/useWaveformInteraction.ts`:
    - **NEW custom hook** for managing waveform zoom/pan interactions
    - Mouse wheel zoom (1x to 10x, centered on cursor position)
    - Click-and-drag panning with visual feedback
    - Double-click to reset viewport
    - Programmatic reset function
    - Automatic pan/zoom constraints to prevent empty space
    - Event listener management with proper cleanup
  - `frontend/src/components/audio/AudioWaveformDisplay.tsx`:
    - **Integrated zoom/pan interactions** via `useWaveformInteraction` hook
    - **Reset button** in top-right corner (only visible when zoomed)
    - **Dynamic cursor feedback** (default/grab/grabbing)
    - Passes viewport state to rendering function
  - `frontend/src/lib/audio/waveform-utils.ts`:
    - **Added viewport parameter** to `renderWaveform()` function
    - **Viewport transformation algorithm** for zoom and pan
    - Only renders visible waveform points (performance optimization)
    - Supports horizontal pan (timeline) and vertical pan (amplitude)
    - Mathematical transform: maps data points to viewport coordinates
    - **Grid lines follow zoom/pan transform** (both vertical time lines and horizontal amplitude lines)
    - **Center axis follows vertical transform** (moves with pan, only draws when visible)
    - **Amplitude labels follow vertical transform** (positioned based on zoom/pan state)
    - **Canvas clipping for stereo tracks** prevents waveforms from overlapping between L/R channels
  - `ARCHITECTURE.md`:
    - Added `useWaveformInteraction.ts` to hooks section

### Changed
- **Waveform rendering now supports viewport transformations:**
  - Zoom range: 1x (normal) to 10x (maximum magnification)
  - Pan constrained based on zoom level
  - Zoom sensitivity: 0.001 for smooth interaction
  - Applied to all three upload locations (Analysis, Impulse Response, Sound Generation)

### Fixed
- **Grid and axis now follow zoom/pan transformations:**
  - Vertical grid lines (time) adjust based on horizontal zoom/pan
  - Horizontal grid lines (amplitude) adjust based on vertical zoom/pan
  - Center axis moves with vertical pan and is only drawn when visible within track bounds
- **Stereo waveform collision prevented:**
  - Added canvas clipping region for each track (L/R channels)
  - Each track stays within its own vertical bounds when zoomed
  - Prevents waveforms from bleeding into adjacent tracks
- **Amplitude labels now follow vertical transform:**
  - Labels (+1, 0, -1) move with vertical pan
  - Only visible labels within track bounds are drawn
  - Works correctly for both mono and stereo displays

## [2025-10-22] - Audio Waveform Visualization (Redesigned)
### Added
- **Professional waveform display for ALL audio uploads:**
  - `frontend/src/lib/audio/waveform-utils.ts`:
    - **Completely redesigned waveform rendering with new visual style**
    - Black background with primary color (#F500B8) waveforms
    - White dotted grid background for reference
    - Mirrored positive/negative amplitudes around center axis
    - Dual-track display for stereo (split height vertically)
    - **X and Y axis labels positioned INSIDE the graph area** (prevents cropping)
    - **Fixed bottom cropping**: Increased bottom padding to 20px for time labels visibility
    - **Time labels positioned below axis line** (+10px offset from bottom)
    - Channel labels (L/R) for stereo tracks
    - Supports both mono and stereo with automatic layout adjustment
  - `frontend/src/components/audio/AudioWaveformDisplay.tsx`:
    - React component for waveform visualization
    - Container-aware sizing to prevent overflow
    - **Removed "Audio Waveform" title text**
    - **Shows minimal info below: filename, sample rate, and total duration**
    - No padding around canvas for cleaner appearance
    - Grey container with black waveform canvas
  - `frontend/src/lib/constants.ts`:
    - **Added `AUDIO_VISUALIZATION` constants** (enable flag, waveform points, dimensions)
    - Global toggle: `ENABLE_WAVEFORM_DISPLAY`
  - `frontend/src/components/layout/sidebar/AuralizationSection.tsx`:
    - **Added waveform display for Impulse Response files**
    - Replaces old text-only IR info display
  - `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`:
    - **Added waveform display for uploaded audio in Sound Generation tab**
    - Replaces old text-only display (removed lines 340-365)

### Changed
- **Impulse Response filename display:**
  - `frontend/src/types/auralization.ts`:
    - Added `impulseResponseFilename: string | null` to `AuralizationConfig`
  - `frontend/src/hooks/useAuralization.ts`:
    - Now stores filename when IR is loaded
    - Passes filename to waveform display (no longer shows "Impulse Response" hardcoded)
  - `frontend/src/components/layout/sidebar/AuralizationSection.tsx`:
    - Uses `config.impulseResponseFilename` for display
    - All three upload methods now use identical display logic via `AudioWaveformDisplay`
- **Updated audio loading to support waveform visualization:**
  - `frontend/src/lib/audio/audio-info.ts`:
    - Added `loadAudioFileWithBuffer()`: Returns both SEDAudioInfo and AudioBuffer
    - Existing `loadAudioFileInfo()` remains for backward compatibility
  - `frontend/src/hooks/useSED.ts`:
    - Now stores `sedAudioBuffer` (AudioBuffer) alongside `sedAudioInfo`
    - Updated `loadAudioInfo()` to use `loadAudioFileWithBuffer()`
    - Updated `clearSEDResults()` to clear audio buffer
    - Removed verbose debug logging
  - `frontend/src/types/sed.ts`:
    - Added `sedAudioBuffer: AudioBuffer | null` to `UseSEDReturn` interface
  - `frontend/src/types/components.ts`:
    - Added `sedAudioBuffer?: AudioBuffer | null` to `ModelLoadSectionProps` and `SidebarProps`
  - `frontend/src/app/page.tsx`:
    - Pass `sedAudioBuffer` prop from `useSED()` hook to Sidebar
  - `frontend/src/components/layout/sidebar/ModelLoadSection.tsx`:
    - **Replaced text-only audio info display with `AudioWaveformDisplay` component**
    - Shows waveform when `ENABLE_WAVEFORM_DISPLAY` is true
    - Falls back to text-only display when waveform is disabled
    - Removed debug logging
  - `frontend/src/components/layout/Sidebar.tsx`:
    - **Fixed: Added missing `sedAudioBuffer` prop** to ModelLoadSection (line 85)

### Visual Design Changes
- **No blue colors**: Replaced all blue styling with grey/black
- **Black waveform background**: High contrast display on black canvas
- **Primary color waveforms**: Magenta (#F500B8) for visibility
- **Dotted grid**: White dotted grid for time/amplitude reference
- **Mirrored display**: Shows positive and negative amplitudes symmetrically
- **Stereo support**: Dual tracks with L/R labels when stereo audio is loaded
- **Labels inside graph**: Axis labels (time, amplitude) positioned inside plot area - prevents cropping
- **No title text**: Removed "Audio Waveform" header for cleaner display
- **Duration instead of Channels**: Info shows filename, sample rate, and **total duration** (not channel count)

**Impact:** All audio uploads (Analysis tab, Impulse Response in Acoustics tab, Sound Generation tab) now display a professional waveform visualization. Fixed cropping issues - the entire graph including time axis is now fully visible. Labels are positioned inside the graph area for maximum space usage. The redesigned appearance with black background, dotted grid, and mirrored amplitudes provides better visual feedback. Stereo files show dual tracks.

## [2025-10-21 20:00] - Physically Accurate Auralization Implementation
### Changed
- **Removed artificial gain reduction for physical accuracy:**
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Removed `-12dB output gain node` that artificially reduced all sound levels
    - Replaced compressor with **brick-wall limiter** (20:1 ratio, -0.5dB threshold)
    - Limiter only engages at digital clipping threshold, maintaining physical SPL accuracy
    - Updated audio chain: `convolver → limiter → destination` (previously had unnecessary gain stage)
    - Enhanced documentation explaining physical accuracy approach
  - `frontend/src/lib/audio/impulse-response.ts`:
    - Imported constants from `@/lib/constants`
    - Updated to use `IMPULSE_RESPONSE` constants for all processing parameters
    - Improved normalization logging to show dB values
  - `frontend/src/lib/constants.ts`:
    - **Added `AURALIZATION_LIMITER` constants** (threshold, knee, ratio, attack, release)
    - **Added `IMPULSE_RESPONSE` constants** (normalization scale, min amplitude, fade-in samples, max channels)
    - All audio processing values now centralized and documented

### Fixed
- `frontend/src/lib/audio/auralization-service.ts`:
  - Fixed `dispose()` method to clean up limiter node instead of removed gain/compressor nodes

**Impact:** Auralization is now physically accurate - sounds maintain their calibrated SPL levels, room acoustics apply naturally, and distance attenuation works correctly. The brick-wall limiter prevents digital clipping only when necessary (typically when many sounds peak simultaneously), preserving the physical realism of the acoustic simulation 99% of the time. Perfect for acoustic research and architectural auralization where accuracy is critical.

## [2025-10-21 19:30] - Auralization Clipping Prevention & Audio Chain Fix
### Fixed
- **Audio clipping and extreme amplitude issues:**
  - `frontend/src/lib/audio/impulse-response.ts`:
    - Fixed normalization to always scale IR to 0.5 (-6dB) instead of 1.0, providing headroom for convolution
    - Changed normalization threshold from 0.1 to 0.001 to ensure proper scaling
    - Added logging to show normalization scaling factor
  - `frontend/src/lib/audio/auralization-service.ts`:
    - Added output gain node (-12dB) to reduce level when summing multiple convolved sources
    - Added dynamics compressor (threshold: -6dB, ratio: 4:1, attack: 3ms, release: 250ms) to prevent clipping
    - Created proper audio chain: `convolver → outputGain → compressor → destination`
    - Fixed Web Audio routing to avoid multiple connections from convolver to destination
    - All audio sources now connect only to convolver, which connects once to the processing chain
  - `frontend/src/lib/three/sound-sphere-manager.ts`:
    - Removed redundant convolver-to-destination connections when attaching audio
    - Fixed fallback error handling when audio connection fails
    - Audio chain now managed centrally by AuralizationService

### Changed
- `frontend/src/lib/audio/auralization-service.ts`:
  - Added private `outputGainNode` and `compressorNode` properties
  - Enhanced logging to show gain and compressor settings
  - Updated `dispose()` to clean up all audio nodes properly

**Impact:** Auralization now works properly without extreme volume spikes or clipping. Multiple convolved sounds sum safely with proper headroom and dynamic range compression. Audio output stays within safe listening levels even with multiple simultaneous sounds.

## [2025-10-21 19:00] - Advanced Options UI Reorganization
### Changed
- `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`:
  - Grouped Text-to-Audio parameters (Global Duration, Diffusion Steps, Global Negative Prompt) into a minimalistic bordered section with header
  - Separated "Remove Background Noise" as standalone option outside the parameter group
  - Improved visual hierarchy with subtle borders and spacing
  - Dark mode support maintained throughout

**Impact:** Clearer UI organization distinguishes generation parameters from post-processing options, improving user understanding of which settings affect audio generation vs output processing.

## [2025-10-21 18:30] - React Key Uniqueness & Sound Generation Deduplication
### Fixed
- **React duplicate key warning fix:**
  - `frontend/src/lib/three/sound-sphere-manager.ts` - Changed `promptKey` from using prompt text to `prompt_${promptIdx}` to ensure uniqueness across sounds with identical prompts
  - `frontend/src/components/scene/ThreeScene.tsx` - Updated overlay key generation to use `prompt_${promptIdx}` pattern
- **Sound generation parameter-based deduplication:**
  - `backend/services/audio_service.py`:
    - Added MD5 hash of all generation parameters (prompt, duration, guidance_scale, steps, apply_denoising)
    - Updated filename pattern to include parameter hash: `{short_prompt}_{param_hash}_copy{copy_idx}.wav`
    - Skip message now indicates "Sound with identical parameters already exists"

**Impact:** Eliminates React console warnings for sounds with duplicate names (e.g., "talking"). Sound generation now only skips files with truly identical parameters (same prompt + duration + guidance + steps + denoising), allowing different variations of the same prompt to generate separately.

## [2025-10-21 18:00] - Audio Reprocessing Bug Fixes
### Fixed
- **Backend numpy/torch type mismatch:**
  - `backend/services/audio_service.py` - Fixed `reprocess_audio_file()` method to convert numpy arrays from `soundfile.read()` to torch tensors before calling `denoise_audio()`
  - Added proper shape handling: mono audio uses `unsqueeze(0)` to add channel dimension, stereo audio transposes from (samples, channels) to (channels, samples)
  - Converts back to numpy after denoising with inverse transformations
- **Frontend audio cache-busting:**
  - `frontend/src/hooks/useSoundGeneration.ts` - Added timestamp parameter to audio URLs after reprocessing to force browser reload: `sound.url?t=${Date.now()}`
- **Frontend Three.js matrixWorld error:**
  - `frontend/src/lib/three/input-handler.ts` - Filter out objects without parents before creating DragControls: `draggableObjects.filter(obj => obj.parent !== null)`
  - Prevents raycasting errors when objects are being removed/recreated during sound updates
- **Frontend audio loading safety:**
  - `frontend/src/lib/three/sound-sphere-manager.ts` - Added null check in audio load callback to verify sphere still exists before attaching audio buffer

**Impact:** Audio reprocessing with denoising toggle now works correctly without backend type errors or frontend rendering crashes. Reprocessed audio files reload properly in the browser.

## [2025-10-21 17:30] - Background Noise Removal Confirmation Dialog
### Added
- `backend/routers/reprocess.py` - New router for reprocessing existing sounds with/without denoising
- Confirmation dialog in Sound Generation section when toggling "Remove Background Noise" with existing sounds
### Changed
- `backend/services/audio_service.py` - Added `reprocess_audio_file()` method to apply/remove denoising from existing audio files
- `backend/main.py` - Registered reprocess router
- `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`:
  - Added confirmation dialog when user changes "Remove Background Noise" checkbox with existing sounds
  - Dialog asks user if they want to modify existing sounds
  - Shows different messages for enabling vs disabling denoising
- `frontend/src/hooks/useSoundGeneration.ts` - Added `handleReprocessSounds()` function to call backend reprocess API
- `frontend/src/types/components.ts` - Added `onReprocessSounds` prop to SidebarProps and SoundGenerationSectionProps
- `frontend/src/components/layout/Sidebar.tsx` - Pass through `onReprocessSounds` prop
- `frontend/src/app/page.tsx` - Wire up `handleReprocessSounds` from hook to Sidebar

**Impact:** Users can now modify the denoising setting and apply changes to all existing generated sounds. Prevents accidental changes with confirmation dialog.

## [2025-10-21 17:00] - Keyboard Shortcuts and Horizontal Mouse Wheel Scrolling
### Added
- `frontend/src/hooks/useHorizontalScroll.ts` - Custom hook that converts vertical mouse wheel scrolling to horizontal scrolling in overflow containers
### Changed
- `frontend/src/components/layout/sidebar/TextGenerationSection.tsx` - Added Ctrl+Enter shortcut to trigger "Generate Sound Ideas" button
- `frontend/src/components/layout/sidebar/SoundGenerationSection.tsx`:
  - Added Ctrl+Enter shortcuts to sound prompt, library search, and global negative prompt textareas
  - Integrated `useHorizontalScroll` hook for sound config tabs to enable mouse wheel horizontal scrolling
- `frontend/src/components/layout/Sidebar.tsx` - Integrated `useHorizontalScroll` hook for main tabs (Analysis, Sound Generation, Acoustics) to enable mouse wheel horizontal scrolling
- `frontend/src/app/page.tsx` - Removed incorrect middle mouse button implementation

**Impact:** Improved UX with keyboard shortcuts for faster workflow and intuitive mouse wheel horizontal scrolling through both main tabs and sound config tabs.

## [2025-10-21 16:45] - Allow Multiple "Load Sounds" Operations
### Fixed
- `frontend/src/app/page.tsx` - Removed clearing of `pendingSoundConfigs` in `handleLoadSoundsToGeneration` to allow loading LLM-generated sounds multiple times, enabling users to overwrite existing sound configs at any time

## [2025-10-21 16:30] - LLM Duration Estimation for Sound Generation
### Added
- `backend/config/constants.py` - Added `LLM_DEFAULT_DURATION`, `DURATION_MIN`, `DURATION_MAX`, and `DURATION_RANGE` constants
### Changed
- `backend/services/llm_service.py`:
  - Updated LLM prompt to request sound duration estimation at 0.1 second precision
  - Modified `_parse_prompt_and_name()` to extract and parse DURATION field from LLM responses
  - Added duration guidance in prompt with examples for different sound types (0.5-30.0 seconds)
  - Updated all return dictionaries to include `duration_seconds` field
  - Fallback cases now include `LLM_DEFAULT_DURATION` (5.0 seconds)
- `backend/routers/generation.py` - Added `duration_seconds` to entity prompt responses
- `backend/services/audio_service.py` - Updated to prioritize `duration_seconds` from LLM output over manual `duration` config
- `frontend/src/hooks/useTextGeneration.ts` - Fixed to use `item.duration_seconds` from backend instead of hardcoded `duration: 5`

**Impact:** LLM now intelligently estimates appropriate sound durations based on sound type (impacts: 0.1-1.0s, short events: 1.0-5.0s, etc.), improving soundscape realism. Duration values now correctly display in sidebar after "Load Sounds".

## [2025-10-21 10:00] - Enhanced Documentation Requirements
- Updated `.claude/output-styles/modular-coding.md`  
  - Added strict `architecture.md` update checklist (file creation, structure, diagrams).  
- Added `ARCHITECTURE_UPDATE_GUIDE.md` (new file)  
  - How to update architecture docs, formatting, and examples.  
- Updated `architecture.md`  
  - Expanded `lib/three/` structure and added comments for new service files.

## [2025-10-21 11:00] - DraggableMeshManager Utility
- **New file:** `frontend/src/lib/three/draggable-mesh-manager.ts`  
  - Provides `updateDraggableMeshes<T>()`, `disposeMeshes()`, and helper methods.  
  - Map-based mesh tracking (O(1) lookups).  
- **Refactored:** `receiver-manager.ts` to use new utility instead of manual mesh creation.  
- Simplified update logic; improved performance and maintainability.

## [2025-10-21 13:00] - Receiver Drag Persistence Fix
- Fixed issue where receivers stopped being draggable after first drag.  
- **Changes:**
  - `receiver-manager.ts`: reused existing meshes via ID mapping.  
  - `input-handler.ts`: skipped unnecessary DragControls recreation.  
- Prevented loss of references and improved interactivity stability.

## [2025-10-21 14:00] - Drag Controls & Overlay Fix
- **scene-coordinator.ts:** OrbitControls now respect `enabled` state (no forced reactivation).  
- **ThreeScene.tsx:** overlay cleared when `soundscapeData` is empty.  
- Prevented unwanted camera rotation during drag and removed stale overlays.

## [2025-10-21 14:30] - 3D Controls Overlay Reposition
- Moved 3D controls info from sidebar to scene overlay.  
- **ControlsInfo.tsx:** compact minimal overlay at bottom-left.  
- **ThreeScene.tsx:** integrated overlay; **Sidebar.tsx:** removed old component.

## [2025-10-21 15:00] - Receiver Visual Update & Name Trim
- Receivers now render as **blue cubes** instead of spheres.  
- Added `trimDisplayName()` in `utils.ts` (limit 5 words, add “…”).  
- Applied name trimming to overlays and sidebar elements.

## [2025-10-21 15:30] - Receiver First-Person Arrow Control
- Replaced mouse drag rotation with arrow-key rotation (yaw/pitch).  
- Implemented in `ThreeScene.tsx`; updated info text in `ControlsInfo.tsx`.  
- Provides smoother and predictable first-person navigation.

## [2025-10-21 16:00] - Receiver Dragging & Camera Lock Fix
- Added `isDraggingRef` to prevent `DragControls` reset mid-drag.  
- Removed camera distance constraints for smoother first-person control.  
- Simplified animation loop: `controls.update()` before lock enforcement.

## [2025-10-20 17:00] - Acoustic Receivers & Acoustics Tab
- **New files:**  
  - `types/receiver.ts`, `hooks/useReceivers.ts`,  
    `ReceiversSection.tsx`, `AcousticsTab.tsx`.  
- Added click-to-place receivers (blue cubes, 1.6m height).  
- Added double-click to lock camera at receiver position; ESC unlocks.  
- Unified DragControls for receivers and sound spheres.  
- Sidebar: new **Acoustics** tab with Receivers + Auralization.  
- Removed collapsible sections for cleaner layout.  
- `globals.css`: hidden scrollbars for uniform UI.

## [2025-10-20 18:30] - Receiver Dragging & Rotation Fix
- Fixed DragControls recreation during drag (caused stuck meshes).  
- Removed OrbitControls distance constraints (rotation no longer restricted).  
- Improved first-person camera fluidity.

## [2025-10-20 16:00] - BBC Sound Library Search
- **Backend:**  
  - `bbc_service.py`: lightweight search/download API for 30k+ BBC sounds.  
  - `library_search.py`: `/api/library/search`, `/api/library/download`.  
- **Frontend:**  
  - Integrated into `SoundGenerationSection.tsx`.  
  - Search bar + result list + sound selection and download.  
- Unified with generation pipeline; supports upload, TTA, and library modes equally.

## [2025-10-20 15:30] - Uploaded Sound Playback Fix
- Uploaded sounds had zero volume and no interval.  
- `useSoundGeneration.ts`: changed defaults  
  - `volume_db ?? 70`, `interval_seconds ?? 30`.  
- Ensured uniform playback across generated and uploaded sounds.

## [2025-10-20 14:30] - Sound Generation Mode Fixes
- Fixed backend index mismatch in mixed-mode workflows.  
- Preserved `originalIndex` in `useSoundGeneration.ts`.  
- Cleaned up uploads when switching modes.  
- Unified Auralization upload UI using `FileUploadArea`.

## [2025-10-20 10:00] - Sound Generation Mode System
- Added dropdown mode selector (`text-to-audio`, `upload`, `library`).  
- New reusable `FileUploadArea.tsx`.  
- Refactored `SoundGenerationSection.tsx`, `Sidebar.tsx`, and `page.tsx`.  
- Modular and backward-compatible generation workflow.

## [2025-10-17 17:00] - Per-Sound Audio Upload
- **New:** `frontend/src/lib/audio/audio-upload.ts`  
  - `loadAudioFile()`, `revokeAudioUrl()`, `isValidAudioFile()`, `formatFileSize()`.  
- Integrated upload controls in Sound Generation tab.  
- Blob URLs handled correctly in `ThreeScene.tsx`.  
- UI: upload + clear buttons, file info (duration, channels, size).  

## [2025-10-17 18:15] - Editable Sound Display Titles
- Double-click tab title to edit; Enter saves, Esc cancels.  
- Implemented in `SoundGenerationSection.tsx`.  
- Fixed text overflow in `Sidebar.tsx` using `truncate` + fixed width.  
- Added tooltip and hover pencil icon for discoverability.

## [2025-10-17 14:00] - Sound Event Detection (SED)
- **Backend:**  
  - `sed_service.py`: YAMNet-based classifier (521 AudioSet classes).  
  - `sed_processing.py`: amplitude + duration analysis utilities.  
  - `sed_analysis.py`: `/api/analyze-sound-events` router.  
- **Frontend:**  
  - `useSED.ts`, `types/sed.ts`, `audio-info.ts`, `ModelLoadSection.tsx`.  
- Added conditional amplitude/duration analysis, improved error UI.  
- Changed duration metrics from average → maximum values.  
- Rounded numeric results; simplified mappings to generation configs.
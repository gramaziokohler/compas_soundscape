# Audio Workflow State Matrix

**Purpose:** Comprehensive mapping of all possible audio workflow states and their behavior.

---

## State Variables

| Variable | Possible Values |
|----------|----------------|
| **IR Loaded** | None, Mono (1ch), Binaural (2ch), FOA (4ch), TOA (16ch) |
| **Receiver Mode** | Active (first-person at receiver), Inactive (orbit/free camera) |
| **Spatial Renderer** | Three.js Positional, Resonance Audio, Ambisonics |
| **User Actions** | Load IR, Clear IR, Move Camera, Rotate Camera, Enter/Exit Receiver Mode |

---

## State 1: No IR Loaded (Any Camera Mode)

### Behavior:
- **Spatial Renderer**: User choice (Three.js OR Resonance Audio)
- **Camera Translation**: ✅ ALLOWED (6 DOF)
- **Camera Rotation**: ✅ ALLOWED (6 DOF)
- **IR Active**: N/A
- **Resonance Audio**: Can be enabled if user selects it

### UI Display:
- ✅ Spatial Mode Selector (Three.js / Resonance toggle)
- ✅ Output Decoder Toggle (Binaural / Stereo)
- ✅ Resonance Audio Controls (if Resonance mode selected)
- ❌ IR Status Notice (hidden)

### User Actions Allowed:
- ✅ Load IR (transitions to State 2/4 based on IR type)
- ✅ Toggle between Three.js and Resonance
- ✅ Toggle Output Decoder
- ✅ Move camera freely
- ✅ Rotate camera freely

---

## State 2: Mono IR Loaded + NOT in Receiver Mode

### Behavior:
- **Spatial Renderer**: Three.js Positional ONLY (Resonance disabled)
- **Camera Translation**: ✅ ALLOWED (6 DOF)
- **Camera Rotation**: ✅ ALLOWED (6 DOF)
- **IR Active**: ❌ NO (convolution bypassed)
- **Audio Output**: Dry Three.js positional audio (no convolution)
- **Resonance Audio**: ❌ DISABLED (automatically)

### UI Display:
- ❌ Spatial Mode Selector (hidden - IR loaded)
- ✅ Output Decoder Toggle
- ❌ Resonance Audio Controls (hidden - IR loaded)
- ✅ IR Status Notice: **YELLOW** "Mono IR loaded but inactive (not in receiver mode)"
- ✅ DOF Description: "Head-locked mode (0 DOF for IR, 6 DOF for sources)"

### User Actions Allowed:
- ✅ Clear IR (transitions to State 1)
- ✅ Enter Receiver Mode (transitions to State 3)
- ✅ Toggle Output Decoder
- ✅ Move camera freely
- ✅ Rotate camera freely
- ❌ Enable Resonance Audio (disabled/hidden)

---

## State 3: Mono IR Loaded + IN Receiver Mode (First-Person)

### Behavior:
- **Spatial Renderer**: Three.js Positional + ConvolverNode (Mono IR)
- **Camera Translation**: ✅ ALLOWED (6 DOF) - can move around room
- **Camera Rotation**: ✅ ALLOWED (6 DOF) - can look around
- **IR Active**: ✅ YES (convolution applied)
- **IR DOF**: 0 DOF (IR acoustic response is fixed, doesn't change with rotation)
- **Sound Sources DOF**: 6 DOF (full Three.js positional audio)
- **Resonance Audio**: ❌ DISABLED (automatically)

### Key Understanding:
- "0 DOF for IR" means IR acoustic response is HEAD-LOCKED (doesn't rotate)
- User CAN still move and rotate their head/camera
- The convolution is applied with a fixed IR that doesn't change orientation

### UI Display:
- ❌ Spatial Mode Selector (hidden)
- ✅ Output Decoder Toggle
- ❌ Resonance Audio Controls (hidden)
- ✅ IR Status Notice: **BLUE** "Mono IR active"
- ✅ DOF Description: "Head-locked mode (0 DOF for IR, 6 DOF for sources)"

### User Actions Allowed:
- ✅ Clear IR (transitions to State 1)
- ✅ Exit Receiver Mode (transitions to State 2)
- ✅ Toggle Output Decoder
- ✅ Move camera freely (within room)
- ✅ Rotate camera freely
- ❌ Enable Resonance Audio (disabled/hidden)

---

## State 4: Spatial IR Loaded (2/4/16ch) + NOT in Receiver Mode

### Behavior:
- **Spatial Renderer**: Three.js Positional ONLY (fallback)
- **Camera Translation**: ✅ ALLOWED (6 DOF)
- **Camera Rotation**: ✅ ALLOWED (6 DOF)
- **IR Active**: ❌ NO (convolution bypassed)
- **Audio Output**: Dry Three.js positional audio
- **Resonance Audio**: ❌ DISABLED (automatically)

### UI Display:
- ❌ Spatial Mode Selector (hidden)
- ✅ Output Decoder Toggle
- ❌ Resonance Audio Controls (hidden)
- ✅ IR Status Notice: **YELLOW** "Spatial IR (FOA/TOA) loaded but inactive (not in receiver mode)"
- ✅ DOF Description: "3 DOF rotation enabled (static position when active)"

### User Actions Allowed:
- ✅ Clear IR (transitions to State 1)
- ✅ Enter Receiver Mode (transitions to State 5)
- ✅ Toggle Output Decoder
- ✅ Move camera freely
- ✅ Rotate camera freely
- ❌ Enable Resonance Audio (disabled/hidden)

---

## State 5: Spatial IR Loaded (2/4/16ch) + IN Receiver Mode

### Behavior:
- **Spatial Renderer**: Ambisonics with rotation matrix
- **Camera Translation**: ❌ LOCKED to receiver position (cannot move away)
- **Camera Rotation**: ✅ ALLOWED (rotation updates ambisonic decoding)
- **IR Active**: ✅ YES (convolution applied)
- **IR DOF**: 3 DOF (rotation affects ambisonic decoding)
- **Sound Sources DOF**: 6 DOF (encoded to ambisonics based on position)
- **Resonance Audio**: ❌ DISABLED (automatically)

### Key Understanding:
- "3 DOF for IR" means rotation affects the ambisonic decoding
- "Static position" means camera CANNOT translate away from receiver
- Camera rotation IS allowed and updates the spatial audio rendering

### UI Display:
- ❌ Spatial Mode Selector (hidden)
- ✅ Output Decoder Toggle
- ❌ Resonance Audio Controls (hidden)
- ✅ IR Status Notice: **BLUE** "Spatial IR (FOA/TOA) active"
- ✅ DOF Description: "3 DOF rotation enabled (static position)"

### User Actions Allowed:
- ✅ Clear IR (transitions to State 1)
- ✅ Exit Receiver Mode (transitions to State 4)
- ✅ Toggle Output Decoder
- ❌ Move camera (LOCKED to receiver position)
- ✅ Rotate camera (updates ambisonic rendering)
- ❌ Enable Resonance Audio (disabled/hidden)

---

## State Transition Diagram

```
         Load IR (Mono)
State 1 ──────────────────> State 2
   ↑                           ↓
   │ Clear IR     Enter Receiver Mode
   │                           ↓
   └───────────────────────  State 3
                               ↑
                               │ Exit Receiver Mode
                               ↓
                            State 2


         Load IR (Spatial)
State 1 ──────────────────> State 4
   ↑                           ↓
   │ Clear IR     Enter Receiver Mode
   │                           ↓
   └───────────────────────  State 5
                               ↑
                               │ Exit Receiver Mode
                               ↓
                            State 4
```

---

## Critical Implementation Requirements

### 1. IR Loading (Any State → State 2/4)
- ✅ User CAN load IR at any time (even when not in receiver mode)
- ✅ IR is loaded but marked as INACTIVE
- ✅ Resonance Audio is automatically DISABLED when IR is loaded
- ✅ UI shows yellow "inactive" notice

### 2. Receiver Mode Constraint (State 2→3, State 4→5)
- ✅ IR becomes ACTIVE only when entering receiver mode
- ✅ Audio routing changes: convolution enabled
- ✅ UI notice changes to blue "active"
- ⚠️ For Spatial IR (State 5): Camera translation must be LOCKED

### 3. Camera Movement Constraints
- **State 1, 2, 4**: Full 6 DOF (translation + rotation)
- **State 3**: Full 6 DOF (translation + rotation) - IR doesn't rotate
- **State 5**: 3 DOF ONLY (rotation only, translation locked)

### 4. DOF Semantics
- **0 DOF for IR** (Mono): IR doesn't change with head movement (head-locked)
- **3 DOF for IR** (Spatial): IR changes with head rotation (not translation)
- **6 DOF for Sources**: Sound sources always have full positional tracking

### 5. UI Consistency
- Spatial Mode Selector: Only visible in State 1 (no IR)
- Resonance Controls: Only visible in State 1 + Resonance mode selected
- Output Decoder: Always visible (all states)
- IR Status Notice: Visible in States 2-5, color-coded by active state

---

## Implementation Checklist

- [ ] IR can be loaded without being in receiver mode
- [ ] IR transitions from inactive (yellow) to active (blue) when entering receiver mode
- [ ] Resonance Audio auto-disables when IR is loaded
- [ ] Camera movement unrestricted in States 1-4
- [ ] Camera translation LOCKED in State 5 (Spatial IR + Receiver Mode)
- [ ] Camera rotation always allowed (affects rendering differently per state)
- [ ] UI components show/hide based on state
- [ ] Audio routing changes based on receiver mode + IR presence
- [ ] Clear IR returns to State 1 from any state
- [ ] Exit receiver mode transitions State 3→2 or State 5→4

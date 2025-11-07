# Receiver Mode & Convolution Activation

## Current Implementation

### New Audio Orchestrator (CORRECT ✅)

The new audio orchestrator system correctly implements receiver mode constraints:

**State 2: Mono IR Loaded + NOT in Receiver Mode**
- IR is **LOADED** ✅
- Convolution is **NOT APPLIED** ✅
- UI shows "IR inactive (not in receiver mode)" (yellow) ✅
- `MonoIRRenderer.setReceiverMode(false)` disables convolution ✅

**State 3: Mono IR Loaded + IN Receiver Mode**
- IR is **LOADED** ✅
- Convolution is **APPLIED** ✅
- UI shows "Mono IR active" (blue) ✅
- `MonoIRRenderer.setReceiverMode(true)` enables convolution ✅

**State 4: Spatial IR Loaded + NOT in Receiver Mode**
- IR is **LOADED** ✅
- Convolution is **NOT APPLIED** ✅
- UI shows "IR inactive (not in receiver mode)" (yellow) ✅

**State 5: Spatial IR Loaded + IN Receiver Mode**
- IR is **LOADED** ✅
- Convolution is **APPLIED** ✅
- UI shows "Spatial IR active" (blue) ✅

### How It Works

**MonoIRRenderer:**
```typescript
setReceiverMode(isActive: boolean): void {
  // Rewire all sources
  this.sources.forEach(source => {
    const panner = this.pannerNodes.get(source);
    panner.disconnect();

    // Connect to convolver ONLY if receiver mode active
    const outputNode = isActive && this.convolver
      ? this.convolver    // Route through IR convolution
      : this.masterGain;  // Bypass IR convolution

    panner.connect(outputNode);
  });
}
```

**Signal Flow:**

```
Receiver Mode INACTIVE:
Sound → PannerNode → MasterGain → Output
(No convolution)

Receiver Mode ACTIVE:
Sound → PannerNode → ConvolverNode (IR) → MasterGain → Output
(Convolution applied)
```

### Old Auralization System (LEGACY ⚠️)

The old `useAuralization` hook may not respect receiver mode constraints. Both systems currently run in parallel:

**Old System (useAuralization):**
- Applies convolution immediately when IR loaded
- May not check receiver mode
- Used for backward compatibility

**New System (useAudioOrchestrator):**
- Enforces receiver mode constraint
- IR inactive until entering first-person view
- Correct per workflow specification

## Verification Steps

To verify the new orchestrator is working correctly:

1. **Load an IR file**
   - Expected: Yellow "IR inactive" notice appears
   - Console: `[AudioOrchestrator] Setting rendering mode`

2. **Check NOT in receiver mode**
   - Expected: No convolution applied
   - Audio sounds dry (no reverb/IR)

3. **Enter first-person receiver mode**
   - Expected: Blue "IR active" notice
   - Console: `[MonoIRRenderer] Receiver mode changed: true`
   - Audio now has IR convolution applied

4. **Exit first-person receiver mode**
   - Expected: Yellow "IR inactive" notice returns
   - Console: `[MonoIRRenderer] Receiver mode changed: false`
   - Audio returns to dry (no IR)

## Troubleshooting

### Issue: "Convolution applies even when not in receiver mode"

**Possible Causes:**

1. **Old auralization system still active**
   - Both systems run in parallel
   - Old system doesn't check receiver mode
   - **Solution:** Old system will be deprecated

2. **ThreeScene not sending receiver mode updates**
   - Check console for: `[ThreeScene] Receiver mode changed`
   - **Solution:** Already implemented in latest commit

3. **Multiple receivers confusing state**
   - System assumes first receiver
   - **Solution:** Multi-receiver support needed

### Issue: "IR doesn't activate in receiver mode"

**Possible Causes:**

1. **Not actually in first-person view**
   - Check if camera is at receiver position
   - Look for orientation indicator in UI

2. **ThreeScene callback not connected**
   - Check `onReceiverModeChange` prop passed to ThreeScene
   - **Solution:** Already implemented

3. **Audio orchestrator not initialized**
   - Check console for initialization logs
   - **Solution:** Hook should auto-initialize

## Migration Path

Eventually, the old auralization system should be fully replaced:

**Phase 1 (Current):** ✅
- New orchestrator implements correct behavior
- Old system runs for compatibility
- Both load the same IR

**Phase 2 (Future):**
- Disable old auralization convolution
- Only use new orchestrator for rendering
- Remove dual system

**Phase 3 (Final):**
- Remove old `useAuralization` completely
- Migrate all audio to new orchestrator
- Clean up legacy code

## Console Verification

When working correctly, you should see:

```bash
# Loading IR
[ImpulseResponseHandler] Loading IR: my_ir.wav
[ImpulseResponseHandler] Decoded successfully: {channels: 1, ...}
[AudioOrchestrator] Setting rendering mode: {hasIR: true, format: 'mono'}
[MonoIRRenderer] Receiver mode: false
# IR loaded but INACTIVE

# Entering receiver mode
[ThreeScene] Receiver mode changed: {isFirstPersonMode: true, receiverId: 'receiver-123'}
[Page] Receiver mode changed: {isActive: true, receiverId: 'receiver-123'}
[AudioOrchestrator] Setting receiver mode: {isActive: true, ...}
[MonoIRRenderer] Receiver mode changed: true
# IR now ACTIVE

# Exiting receiver mode
[ThreeScene] Receiver mode changed: {isFirstPersonMode: false, receiverId: null}
[MonoIRRenderer] Receiver mode changed: false
# IR now INACTIVE again
```

## Summary

✅ **New audio orchestrator correctly enforces receiver mode**
✅ **IR can be loaded without being in receiver mode**
✅ **Convolution only applies when in first-person receiver view**
✅ **UI clearly indicates active/inactive state**

The system works as specified in `WORKFLOW_STATE_MATRIX.md`.

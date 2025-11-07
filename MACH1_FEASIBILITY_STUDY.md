# Mach1 Spatial Audio Integration - Feasibility Study

**Project:** COMPAS Soundscape
**Date:** 2025-11-07
**Author:** Claude (Technical Feasibility Analysis)

---

## Executive Summary

This feasibility study assesses the integration of **Mach1 Spatial Audio SDK** into the COMPAS Soundscape workflow as an alternative or complement to the current **Google Resonance Audio** implementation.

**Key Findings:**
- ✅ **FEASIBLE** - Mach1 can be integrated into the existing workflow
- ⚠️ **MODERATE COMPLEXITY** - Requires significant refactoring of audio pipeline
- 💰 **NOW FREE** - Mach1 SDK is now open-source (formerly $499)
- 🔄 **COMPLEMENTARY** - Could coexist with Resonance Audio for different use cases

**Recommendation:** Proceed with a phased implementation approach, starting with a prototype integration for evaluation.

---

## 1. Current Architecture Analysis

### 1.1 Existing Sound Workflow

**Backend (Python/FastAPI):**
```
Audio Generation → SPL Calibration → Denoising → File Storage
├─ TangoFlux (default)
├─ AudioLDM2
└─ Library/Upload sources
```

**Frontend (React/Next.js/Three.js):**
```
Web Audio API → Spatial Processing → Output
├─ Google Resonance Audio (HRTF + Ambisonics)
├─ Custom Auralization (Impulse Response Convolution)
├─ 3D Positional Audio (Three.js)
└─ Timeline-based Playback Scheduler
```

### 1.2 Key Technologies in Use

| Technology | Purpose | Location |
|------------|---------|----------|
| **Google Resonance Audio** | HRTF spatial rendering, room acoustics | Frontend |
| **Ambisonics.js** | Multi-channel ambisonic decoding | Frontend (package.json) |
| **Web Audio API** | Audio processing and routing | Frontend |
| **Three.js** | 3D visualization and positional audio | Frontend |
| **TangoFlux/AudioLDM2** | AI audio generation | Backend |

### 1.3 Current Spatial Audio Features

- ✅ **HRTF binaural rendering** via Resonance Audio
- ✅ **Room acoustics modeling** (6-surface material system)
- ✅ **Impulse response convolution** (up to 16-channel TOA)
- ✅ **3D sound source positioning** with geometry-based placement
- ✅ **First-person receiver mode** with orientation tracking
- ✅ **Multi-receiver support** for different listening positions

---

## 2. Mach1 Spatial Audio Overview

### 2.1 What is Mach1?

**Mach1 Spatial System** is a vector-based amplitude panning (VVBP) spatial audio framework that:
- Uses **VVBP (Virtual Vector Based Panning)** instead of ambisonics
- Provides **format-agnostic transcoding** between spatial audio formats
- Offers **transparent decoding** without runtime DSP processing
- Supports **Web Audio API** via WebAssembly

### 2.2 Core Components

| API | Purpose |
|-----|---------|
| **Mach1Encode** | Encode audio streams into Mach1Spatial VVBP format |
| **Mach1Decode** | Decode VVBP with orientation/head-tracking |
| **Mach1DecodePositional** | 6DOF positional + orientational decoding |
| **Mach1Transcode** | Convert between any spatial/surround formats |

### 2.3 Key Advantages

1. **No Runtime Processing** - Pre-rendered filters/delays in mix, no additional DSP at playback
2. **Format Agnostic** - Can encode/decode from any format (Ambisonics, 5.1, 7.1, etc.)
3. **Lossless Conversions** - Ambisonics → Mach1 is lossless (reverse is lossy)
4. **Open Source** - Now free and fully open-source (2025 release)
5. **Web Support** - WebAssembly deployment for Web Audio API
6. **Lightweight** - No proprietary codecs or metadata required

### 2.4 Key Differences from Resonance Audio

| Feature | Resonance Audio | Mach1 Spatial |
|---------|----------------|---------------|
| **Core Approach** | Ambisonics + HRTF DSP | Vector-based amplitude panning |
| **Processing** | Runtime HRTF filtering | Pre-rendered spatial mix |
| **Room Acoustics** | Built-in room modeling | Requires pre-rendered IRs |
| **Format** | Scene-based (Ambisonics) | Channel-based (VVBP) |
| **Latency** | Higher (DSP processing) | Lower (amplitude only) |
| **Quality** | Excellent at close range | Excellent transparency |
| **Flexibility** | Fixed ambisonics order | Scalable channel configs |

---

## 3. Integration Analysis

### 3.1 Integration Points

**Where Mach1 Would Fit:**

```
┌─────────────────────────────────────────────────────┐
│ BACKEND (Python)                                     │
│ ┌─────────────────┐                                 │
│ │ Audio Generation │ → [POTENTIAL: Mach1Encode]     │
│ │ (TangoFlux, etc) │                                │
│ └─────────────────┘                                 │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ FRONTEND (React/Three.js)                           │
│ ┌──────────────────────────────────────────────┐   │
│ │ Web Audio API                                 │   │
│ │   ├─ [NEW] Mach1Decode (WASM)                │   │
│ │   ├─ [EXISTING] Resonance Audio               │   │
│ │   ├─ [EXISTING] Auralization Service          │   │
│ │   └─ Mixer → Output                           │   │
│ └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 3.2 Proposed Architecture Scenarios

#### Scenario A: Parallel Implementation (Recommended)

**Description:** Run Mach1 alongside Resonance Audio, letting users choose per-sound or globally.

**Pros:**
- No disruption to existing functionality
- Users can compare spatial rendering quality
- Gradual migration path
- Different sounds could use different renderers

**Cons:**
- Increased complexity in audio routing
- Need UI controls to switch modes
- Higher maintenance burden

**Implementation Effort:** **Medium** (3-4 weeks)

---

#### Scenario B: Hybrid Approach

**Description:** Use Mach1Transcode to convert between formats dynamically.

**Pros:**
- Best of both worlds
- Can import pre-rendered Mach1 mixes
- Leverage Resonance Audio's room modeling
- Use Mach1 for pre-authored content

**Cons:**
- Most complex architecture
- Potential format conversion overhead
- Requires understanding both systems deeply

**Implementation Effort:** **High** (5-6 weeks)

---

#### Scenario C: Full Replacement

**Description:** Replace Resonance Audio entirely with Mach1.

**Pros:**
- Single spatial audio system to maintain
- Lower latency (no runtime DSP)
- More control over spatial rendering

**Cons:**
- Lose Resonance Audio's room modeling
- Need to implement custom room acoustics
- Breaking change for existing users
- Riskier migration

**Implementation Effort:** **High** (4-5 weeks)

**Recommendation:** ❌ **Not recommended** unless Resonance Audio limitations are critical

---

### 3.3 Technical Requirements

#### Frontend Integration

**1. WebAssembly Mach1 SDK**
```javascript
// Load Mach1 WASM module
import Mach1DecodeModule from '@mach1/spatial-sdk-wasm';

// Initialize decoder
const decoder = new Mach1Decode();
decoder.setPlatformType(Mach1PlatformType.DEFAULT);
decoder.setDecodeAlgoType(Mach1DecodeAlgoType.SPATIAL_8);

// Update orientation from camera
function updateOrientation(yaw, pitch, roll) {
  decoder.setRotationDegrees(yaw, pitch, roll);
  const coeffs = decoder.decode();
  // Apply coeffs to audio channels
}
```

**2. Audio Channel Management**
- Need multi-channel audio buffer support
- Mach1 typically uses 8-channel VVBP format
- Current system uses mono/stereo sources
- Would need to generate or transcode to Mach1 format

**3. Integration with Existing Services**
- Modify `ResonanceAudioService` → `SpatialAudioService` (abstraction)
- Add `Mach1Service` implementation
- Update `PlaybackSchedulerService` to route to correct renderer
- UI controls to switch between modes

#### Backend Considerations

**Option 1: Pre-render Spatial Mixes**
- Generate 8-channel Mach1 format during audio generation
- Requires Mach1Encode API (Python bindings available)
- Larger file sizes (8 channels vs. mono)
- Better quality, no runtime transcoding

**Option 2: Client-side Transcoding**
- Keep generating mono audio
- Use Mach1Transcode to convert at runtime
- Smaller file sizes
- Some CPU overhead on client

---

## 4. Technical Feasibility Assessment

### 4.1 Strengths for Integration

| Factor | Assessment | Notes |
|--------|------------|-------|
| **Web Audio Support** | ✅ Strong | WebAssembly available, well-documented |
| **Open Source** | ✅ Strong | Now free, full source access |
| **Format Flexibility** | ✅ Strong | Can work with existing mono sources via transcode |
| **Performance** | ✅ Strong | Lower CPU than Resonance (no HRTF DSP) |
| **Documentation** | ⚠️ Moderate | Developer docs available, examples exist |
| **Community** | ⚠️ Moderate | Smaller than Resonance Audio |

### 4.2 Challenges & Risks

| Challenge | Risk Level | Mitigation Strategy |
|-----------|-----------|---------------------|
| **Learning Curve** | Medium | Start with simple decoder-only integration |
| **Multi-channel Audio** | Medium | Use Mach1Transcode for mono→VVBP conversion |
| **Room Acoustics** | High | Keep Resonance Audio for room modeling OR implement custom IR convolution |
| **Compatibility** | Low | WASM works in all modern browsers |
| **License Compliance** | Low | Open source, permissive terms |
| **File Size Increase** | Medium | 8-channel vs mono (8x larger if pre-rendered) |

### 4.3 Dependencies

**New Frontend Dependencies:**
```json
{
  "dependencies": {
    "@mach1/spatial-sdk-wasm": "^x.x.x",
    // OR include as local WASM module
  }
}
```

**Backend (Optional for encoding):**
```python
# Python bindings available via ctypes or direct C++ integration
# Currently uses: TangoFlux, AudioLDM2, torchaudio
# Would add: Mach1Encode API (C++ lib with Python wrapper)
```

---

## 5. Implementation Roadmap

### Phase 1: Proof of Concept (1-2 weeks)

**Goal:** Validate basic Mach1 integration

**Tasks:**
1. Set up Mach1 WebAssembly SDK in frontend
2. Create basic Mach1Decode service (parallel to Resonance)
3. Test with pre-rendered 8-channel test file
4. Wire up orientation tracking to Mach1 decoder
5. Compare audio quality with Resonance Audio

**Deliverables:**
- Working prototype with switchable renderers
- Performance benchmarks (CPU, latency)
- Audio quality assessment

---

### Phase 2: Audio Pipeline Integration (2-3 weeks)

**Goal:** Integrate Mach1 into existing audio generation workflow

**Tasks:**
1. Implement Mach1Transcode for mono → VVBP conversion
2. Add UI toggle: "Spatial Renderer: [Resonance Audio | Mach1]"
3. Update `SoundSphereManager` to support multi-channel buffers
4. Test with generated TangoFlux audio
5. Optimize buffer management for 8-channel audio

**Deliverables:**
- Full audio pipeline with Mach1 option
- UI controls for renderer selection
- Documentation for users

---

### Phase 3: Advanced Features (2-3 weeks)

**Goal:** Leverage Mach1's unique capabilities

**Tasks:**
1. Implement Mach1DecodePositional for 6DOF
2. Add support for custom Mach1 spatial presets
3. Backend Mach1Encode for pre-rendered spatial mixes
4. Format conversion tools (import external Mach1 content)
5. Performance optimization and caching

**Deliverables:**
- Full-featured Mach1 integration
- Import/export tools for Mach1 formats
- Performance-optimized implementation

---

### Phase 4: Production Hardening (1-2 weeks)

**Goal:** Polish and production-ready deployment

**Tasks:**
1. Cross-browser testing (Chrome, Firefox, Safari, Edge)
2. Mobile device testing (iOS Safari, Android Chrome)
3. Error handling and fallbacks
4. User documentation and examples
5. A/B testing with user feedback

**Deliverables:**
- Production-ready Mach1 integration
- User guide and documentation
- Test coverage and validation

---

## 6. Resource Requirements

### 6.1 Development Time Estimate

| Scenario | Timeline | Developer Effort |
|----------|----------|------------------|
| **Scenario A** (Parallel) | 6-8 weeks | 1 full-time developer |
| **Scenario B** (Hybrid) | 8-10 weeks | 1 full-time developer |
| **Scenario C** (Replacement) | 7-9 weeks | 1 full-time developer |

### 6.2 Technical Skills Required

- ✅ **Strong JavaScript/TypeScript** (already have)
- ✅ **Web Audio API expertise** (already have)
- ✅ **Three.js knowledge** (already have)
- ⚠️ **WebAssembly integration** (new, but well-documented)
- ⚠️ **Spatial audio theory** (VVBP vs Ambisonics)
- ⚠️ **Multi-channel audio processing** (new requirement)

### 6.3 Testing Requirements

- Audio quality A/B testing
- Cross-browser compatibility testing
- Performance benchmarking (CPU, memory, latency)
- User acceptance testing
- Regression testing for existing Resonance Audio features

---

## 7. Cost-Benefit Analysis

### 7.1 Costs

| Cost Category | Estimated Cost | Notes |
|---------------|----------------|-------|
| **Development Time** | 6-10 weeks | ~$30k-$50k at $100/hr |
| **Testing & QA** | 1-2 weeks | ~$5k-$10k |
| **Documentation** | 1 week | ~$5k |
| **Maintenance** | Ongoing | Additional system to maintain |
| **Learning Curve** | 1-2 weeks | Developer ramp-up time |
| **Total Estimated** | **8-15 weeks** | **~$40k-$70k** |

### 7.2 Benefits

| Benefit | Value | Impact |
|---------|-------|--------|
| **Lower Latency** | High | Better real-time performance |
| **CPU Efficiency** | High | Less processing overhead |
| **Format Flexibility** | High | Import/export spatial formats |
| **Transparency** | Medium | No runtime HRTF coloration |
| **Innovation** | Medium | Cutting-edge spatial audio |
| **Open Source** | High | No licensing fees (was $499) |
| **Future-proof** | High | Active development, growing adoption |

### 7.3 ROI Assessment

**Positive Indicators:**
- ✅ Free SDK (now open-source) = zero licensing cost
- ✅ Performance improvements could enable more complex scenes
- ✅ Format flexibility adds professional workflow features
- ✅ Innovation differentiator for research project

**Concerns:**
- ⚠️ Moderate development cost for uncertain user benefit
- ⚠️ Existing Resonance Audio works well
- ⚠️ Increased maintenance complexity

**Verdict:** **ROI is POSITIVE if:**
- Project requires maximum performance
- Need to import/export professional spatial audio formats
- Research goals include comparing spatial audio approaches
- Have budget and time for 8-15 weeks of development

---

## 8. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Poor browser compatibility** | Low | High | Test early, provide fallbacks |
| **Performance worse than expected** | Low | Medium | Benchmark in Phase 1 POC |
| **File size issues (8-ch audio)** | Medium | Medium | Use compression, client-side transcode |
| **User confusion (two systems)** | Medium | Low | Clear UI, good documentation |
| **Development overrun** | Medium | Medium | Phased approach, stop if POC fails |
| **Maintenance burden** | Medium | Medium | Good documentation, abstraction layer |
| **Mach1 SDK abandonment** | Low | High | Open source, can fork if needed |

---

## 9. Alternatives Considered

### Alternative 1: Stick with Resonance Audio Only
**Pros:** No additional work, stable, proven
**Cons:** Missing Mach1's benefits (performance, format flexibility)
**Verdict:** Safe choice, but no innovation

### Alternative 2: Use Only Web Audio API Panner Nodes
**Pros:** Simplest, no external dependencies
**Cons:** Basic HRTF, no room acoustics, lower quality
**Verdict:** Step backward in quality

### Alternative 3: Implement Custom HRTF System
**Pros:** Full control, optimized for use case
**Cons:** Extremely complex, reinventing the wheel
**Verdict:** Not recommended, too much effort

### Alternative 4: Explore Other Solutions (Dolby Atmos, Sony 360RA)
**Pros:** Industry-standard solutions
**Cons:** Proprietary, expensive, complex licensing
**Verdict:** Overkill for research project

---

## 10. Recommendations

### 10.1 Recommended Approach

**Proceed with Scenario A: Parallel Implementation**

**Rationale:**
1. ✅ Lowest risk - existing features remain intact
2. ✅ Enables direct A/B comparison for research
3. ✅ Gradual migration path
4. ✅ Users can choose best renderer for their content
5. ✅ Learning opportunity without commitment

### 10.2 Go/No-Go Decision Criteria

**Proceed if:**
- [ ] Phase 1 POC shows performance improvement ≥20%
- [ ] Audio quality is comparable or better than Resonance Audio
- [ ] File size increase is manageable (<2x with compression)
- [ ] WebAssembly integration is stable across browsers
- [ ] Development timeline fits project schedule

**Do NOT proceed if:**
- [ ] Performance is worse than Resonance Audio
- [ ] Audio quality is noticeably degraded
- [ ] Browser compatibility issues are severe
- [ ] Development cost exceeds budget
- [ ] Existing system meets all needs

### 10.3 Next Steps

**Immediate Actions:**
1. **Approve/Reject** this feasibility study
2. **Allocate resources** for Phase 1 POC (1-2 weeks)
3. **Set up development environment** with Mach1 SDK
4. **Create evaluation criteria** for POC success

**Phase 1 POC Goals:**
- Working Mach1 decoder integrated into ThreeScene
- Side-by-side comparison demo (Resonance vs Mach1)
- Performance benchmarks documented
- Go/No-Go decision for Phase 2

---

## 11. Conclusion

Integrating **Mach1 Spatial Audio** into COMPAS Soundscape is **FEASIBLE** with **moderate complexity**. The newly open-source SDK eliminates licensing concerns, and the Web Audio API support makes integration straightforward.

**Key Takeaways:**
- ✅ **Technical feasibility:** High
- ⚠️ **Implementation complexity:** Moderate
- 💰 **Cost:** $40k-$70k (8-15 weeks)
- 🎯 **Value proposition:** Strong if performance/flexibility matters
- 🏆 **Recommended approach:** Parallel implementation (Scenario A)

**Final Recommendation:**
**Proceed with Phase 1 Proof of Concept** to validate performance and quality assumptions before committing to full implementation. The POC will provide concrete data to make an informed go/no-go decision for Phase 2.

---

## Appendix A: Technical References

### Mach1 Resources
- **Main Website:** https://www.mach1.tech/
- **Developer Docs:** https://dev.mach1.xyz/
- **GitHub SDK:** https://github.com/Mach1Studios/m1-sdk
- **Web Player Example:** https://github.com/Mach1Studios/m1-web-spatialaudioplayer

### Current System References
- **Google Resonance Audio:** https://resonance-audio.github.io/
- **Ambisonics.js:** https://github.com/polarch/JSAmbisonics
- **Web Audio API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

### Research Papers
- VVBP White Paper: https://dev.mach1.xyz/research/Mach1SpatialSystem-WhitePaper_180523.pdf
- Comparing Binaural Decoders: https://research.mach1.tech/posts/comparing-binaural-decoders/

---

## Appendix B: Code Integration Examples

### Example 1: Mach1 Service Abstraction

```typescript
// frontend/src/services/spatial-audio/ISpatialAudioService.ts
export interface ISpatialAudioService {
  initialize(audioContext: AudioContext): void;
  createSource(position: Vector3): SpatialAudioSource;
  updateOrientation(yaw: number, pitch: number, roll: number): void;
  setRoomProperties?(dimensions: Vector3, materials: RoomMaterials): void;
  dispose(): void;
}

// frontend/src/services/spatial-audio/Mach1Service.ts
export class Mach1Service implements ISpatialAudioService {
  private decoder: Mach1Decode;
  private audioContext: AudioContext;

  initialize(audioContext: AudioContext): void {
    this.audioContext = audioContext;
    this.decoder = new Mach1Decode();
    this.decoder.setPlatformType(Mach1PlatformType.DEFAULT);
    this.decoder.setDecodeAlgoType(Mach1DecodeAlgoType.SPATIAL_8);
  }

  updateOrientation(yaw: number, pitch: number, roll: number): void {
    this.decoder.setRotationDegrees(yaw, pitch, roll);
    // Apply decoding coefficients to audio channels
  }

  // ... implementation
}

// frontend/src/services/spatial-audio/ResonanceService.ts
export class ResonanceService implements ISpatialAudioService {
  // Existing Resonance Audio implementation
}

// frontend/src/services/spatial-audio/SpatialAudioFactory.ts
export class SpatialAudioFactory {
  static create(type: 'resonance' | 'mach1'): ISpatialAudioService {
    switch (type) {
      case 'mach1':
        return new Mach1Service();
      case 'resonance':
      default:
        return new ResonanceService();
    }
  }
}
```

### Example 2: UI Toggle Component

```typescript
// frontend/src/components/controls/SpatialRendererToggle.tsx
export function SpatialRendererToggle({
  currentRenderer,
  onRendererChange
}: {
  currentRenderer: 'resonance' | 'mach1';
  onRendererChange: (renderer: 'resonance' | 'mach1') => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium">Spatial Audio Renderer</label>
      <div className="flex gap-2">
        <button
          onClick={() => onRendererChange('resonance')}
          className={`px-3 py-1 text-xs rounded ${
            currentRenderer === 'resonance'
              ? 'bg-primary text-white'
              : 'bg-gray-200'
          }`}
        >
          Resonance Audio (HRTF)
        </button>
        <button
          onClick={() => onRendererChange('mach1')}
          className={`px-3 py-1 text-xs rounded ${
            currentRenderer === 'mach1'
              ? 'bg-primary text-white'
              : 'bg-gray-200'
          }`}
        >
          Mach1 (VVBP)
        </button>
      </div>
      <p className="text-xs text-gray-600">
        {currentRenderer === 'resonance'
          ? 'Using Ambisonics + HRTF with room modeling'
          : 'Using Vector-Based Panning for transparent spatial audio'}
      </p>
    </div>
  );
}
```

---

**End of Feasibility Study**

/**
 * Audio Controls Store
 *
 * Replaces useAudioControls hook. Manages all audio playback state globally so
 * SpeckleScene, SoundGenerationSection, WaveSurferTimeline, and EntityInfoPanel
 * can all read from one source of truth without prop drilling through page.tsx.
 *
 * Sync:  page.tsx must call syncGeneratedSounds() whenever soundGen.generatedSounds
 *        changes so that playAll / stopAll / handleVariantChange / handleVolumeChange
 *        have the correct sound list available.
 *
 * zundo partializes on: soundVolumes, soundTrims, soundTimestamps, selectedVariants,
 *                       mutedSounds, soloedSound  (the "user-facing" config — excludes play state).
 *
 * Scheduling is purely timestamp-driven: `soundTimestamps[soundId]` is the only stored
 * schedule. A track with NO entry is an "auto" track — the timeline derives a default
 * loop from its event's interval_seconds (0 = back-to-back) reactively; the first DAW
 * edit freezes those positions into soundTimestamps (see ensureTrackMaterialized).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import type { SoundState, SoundGenerationConfig } from '@/types';
import type { IterationLink } from '@/types/audio';
import { parseSoundCopyIndex } from '@/lib/audio/utils/variant-sound-id';
import { isParamExpression } from '@/lib/audio/utils/trigger-ref';
import { solveOrchestrateSchedule, scheduleEntryKey } from '@/lib/audio/orchestrate-schedule';
import { serializeTrackOverlaps } from '@/lib/audio/utils/serialize-track-overlaps';
import { parseAuthoredSeconds } from '@/lib/audio/utils/timeline-utils';
import { pausePreviewInstance, pauseAllPreviewInstances } from '@/lib/audio/previewRegistry';
import { AUDIO_PLAYBACK, AUDIO_TIMELINE, AUDIO_OUTPUT, DEFAULT_DBFS, DEFAULT_MAXIMUM_FOLEY_SOUNDS, TTS_DEFAULT_LANGUAGE } from '@/utils/constants';
import { apiService } from '@/services/api';
import { useSoundscapeStore } from './soundscapeStore';
import { useSpeckleEngineStore } from './speckleEngineStore';
import { useUIStore } from './uiStore';
import { useAnalysisStore } from './analysisStore';
import { recordInflightJob, removeInflightJob } from '@/lib/job-tracker';
import type { ScenarioConfig } from '@/types/analysis';

/**
 * Write-through: when the active sound section belongs to a scenario card, persist any
 * DAW timeline-length change (inline DAW edit, bake auto-extend) back to that scenario's
 * own timelineDurationMs, so each scenario keeps its own sound-scene duration across
 * section switches and page refreshes. Non-scenario sections keep the global value.
 */
function syncTimelineToActiveScenario(ms: number): void {
  const active = useUIStore.getState().activeSoundParentIndex;
  if (active === null || active === undefined) return;
  const cfg = useAnalysisStore.getState().analysisConfigs[active];
  if (!cfg || cfg.type !== 'scenario') return;
  if (cfg.timelineDurationMs === ms) return;
  useAnalysisStore.getState().handleUpdateConfig(active, { timelineDurationMs: ms } as Partial<ScenarioConfig>);
}

/** Timeline bound of the currently-active scenario section (ms), or null when none. */
function getActiveScenarioTimelineMs(): number | null {
  const active = useUIStore.getState().activeSoundParentIndex;
  if (active === null || active === undefined) return null;
  const cfg = useAnalysisStore.getState().analysisConfigs[active];
  if (!cfg || cfg.type !== 'scenario') return null;
  const ms = cfg.timelineDurationMs;
  return ms && ms > 0 ? ms : null;
}

/**
 * Every sound ID that belongs to the same DAW track as `soundId` — i.e. all
 * variant copies sharing its `prompt_index`. Mute/solo are track-level: muting
 * any variant must silence the whole track (the timeline may play a different
 * copy per iteration). Falls back to `[soundId]` when the sound isn't known or
 * carries no `prompt_index`.
 */
function resolveTrackSoundIds(sounds: any[], soundId: string): string[] {
  const target = sounds.find((s) => s.id === soundId);
  const pi = target?.prompt_index;
  if (pi === undefined || pi === null) return [soundId];
  const ids = sounds.filter((s) => s.prompt_index === pi).map((s) => s.id);
  return ids.length > 0 ? ids : [soundId];
}


export interface AudioControlsStoreState {
  // ── State ──
  individualSoundStates: Record<string, SoundState>;
  selectedVariants: Record<number, number>;
  soundVolumes: Record<string, number>;
  soundTrims: Record<string, { start: number; end: number }>;
  mutedSounds: Set<string>;
  soloedSound: string | null;
  previewingSoundId: string | null;
  /** Fixed timeline length in milliseconds — both visual and audio are bounded to this. */
  timelineDurationMs: number;
  /** Internal: synced from useSoundGeneration. Used by playAll / stopAll / handleVariantChange. */
  _generatedSounds: any[];
  /** Internal: synced from soundscapeStore. Used by bakeOrchestrateSchedule. */
  _soundConfigs: SoundGenerationConfig[];
  /** Actual decoded audio buffer durations (seconds), keyed by soundId. Set by SoundSphereManager on load. */
  soundBufferDurations: Record<string, number>;
  /**
   * Per-sound explicit playback timestamps in seconds. This is the ONLY stored
   * schedule. A track with NO entry is "auto": the timeline derives a default
   * loop from its event's interval_seconds (see extractTimelineSoundsFromData).
   */
  soundTimestamps: Record<string, number[]>;
  /**
   * Per-sound loopable flag, keyed by soundId. When true, DAW playback
   * narrows to the detected loop region (the sound's trim) and applies a seam
   * fade so the loop wraps without clicking.
   */
  soundLoopable: Record<string, boolean>;
  /** Per-sound flag while loop analysis is running (id → true). */
  loopAnalysisInProgress: Record<string, boolean>;
  /**
   * Per-iteration audio durations in seconds, keyed by soundId.
   * Parallel to soundTimestamps — each entry matches the iteration array length.
   * Used so that DAW blocks show the correct visual width when variants have different lengths.
   */
  soundIterationDurations: Record<string, number[]>;
  /**
   * Per-sound iteration indices the orchestrate solver EXCLUDED because a link
   * could not be satisfied strictly (cycle, bad ref, missing duration, no
   * anchor). Keyed by soundId; persisted so the DAW can mark them across refresh.
   */
  excludedIterations: Record<string, number[]>;
  /** Reason per excluded iteration. Key = `${soundId}-${iterationIndex}`. */
  exclusionReasons: Record<string, string>;
  /** True while bakeOrchestrateSchedule is asynchronously computing; used to show a loading UI. */
  isBakingSchedule: boolean;
  /** True when bake ran before all variant buffers were loaded; DFS is deferred.
   *  Cleared to false once all durations are known and DFS has run successfully. */
  isDeferredCycleBakePending: boolean;
  /** Internal: set to true by playAll() so PlaybackSchedulerService applies stagger.
   *  Consumed and cleared on the first updateSoundPlayback call. */
  _pendingPlayAllStagger: boolean;
  /**
   * Monotonic nonce bumped on every playAll(). Lets UI (e.g. the right sidebar
   * handle) react to a "Play all" press without subscribing to play state.
   * Transient — never persisted.
   */
  playAllNonce: number;
  /** Internal: true while sounds are actively being generated (suppress bake mid-gen). */
  _generationInProgress: boolean;
  /**
   * Per-iteration overrides.  Key = `${soundId}-${iterationIndex}`.
   * Stores variant and/or entity overrides for individual DAW blocks.
   */
  iterationLinks: Record<string, IterationLink>;

  // ── Sync ──
  syncGeneratedSounds: (sounds: any[]) => void;
  syncSoundConfigs: (configs: SoundGenerationConfig[]) => void;

  // ── Actions ──
  toggleSound: (soundId: string) => void;
  handleVariantChange: (promptIdx: number, variantIdx: number) => void;
  handleVolumeChange: (soundId: string, volumeDbfs: number) => void;
  handleTimestampsChange: (soundId: string, timestamps: number[]) => void;
  /** Apply timestamp updates for multiple tracks in a single store commit — one undo entry per gesture, instead of one per affected track. */
  handleTimestampsChangeBatch: (updates: Record<string, number[]>) => void;
  handleRemoveTimestamp: (soundId: string, iterationIndex: number) => void;
  /** Shift iterationLinks for one track so a newly-inserted clip at `insertAt` doesn't silently reassign existing overrides. */
  remapIterationLinksForInsert: (soundId: string, insertAt: number) => void;
  setIterationLink: (soundId: string, iterationIndex: number, link: Partial<IterationLink>) => void;
  /** Apply one override (variant / entity) to every listed iteration of a track in a single store commit. */
  setIterationLinkForAllIterations: (soundId: string, iterationIndices: number[], link: Partial<IterationLink>) => void;
  clearIterationLink: (soundId: string, iterationIndex: number) => void;
  clearAllIterationLinksForSound: (soundId: string) => void;
  /** Re-derive every iteration link's stored `entityPosition` from the current
   *  config entity bounds (called after a model update moves linked objects). */
  refreshIterationEntityPositions: () => void;
  /** Break trigger link for a single iteration (clears iterationLink + orchestrateMeta trigger). */
  breakIterationTriggerLink: (soundId: string, iterationIndex: number, promptIndex: number) => void;
  handleMute: (soundId: string) => void;
  handleSolo: (soundId: string) => void;
  setSoundTrim: (soundId: string, trim: { start: number; end: number }) => void;
  /**
   * Toggle "loopable" for a generated sound. Turning it on runs the client-side
   * loop analysis against `url`, then narrows the sound's trim to the detected
   * periodic loop region (so DAW playback loops seamlessly with a seam
   * fade). Turning it off restores nothing else — the trim is left wherever it
   * landed so the user can keep a manual trim if desired.
   */
  toggleSoundLoopable: (soundId: string, url: string) => Promise<void>;
  setTimelineDurationMs: (ms: number) => void;
  resetTimelineDurationMs: () => void;
  /** Global base volume reference level for all generated sounds (dBFS). */
  globalBaseDbfs: number;
  setGlobalBaseDbfs: (dbfs: number) => void;
  resetGlobalBaseDbfs: () => void;
  /** Maximum number of foley sound events generated by the foley artist. */
  maximumFoleySounds: number;
  setMaximumFoleySounds: (n: number) => void;
  /** Language/accent passed to Gemini 3.8 TTS as `speech_config.language`. */
  ttsLanguage: string;
  setTtsLanguage: (lang: string) => void;
  /**
   * Global IR peak-normalization toggle. Applied by the AudioOrchestrator to
   * every ambisonic-IR convolution (kept in the store so it survives refresh
   * and syncs to the user's preferences).
   */
  normalizeImpulseResponses: boolean;
  setNormalizeImpulseResponses: (v: boolean) => void;
  /**
   * Selected audio output device (`AudioDeviceInfo.deviceId`). The sentinel
   * AUDIO_OUTPUT.DEFAULT_DEVICE_ID routes playback to the system default output.
   */
  outputDeviceId: string;
  setOutputDeviceId: (deviceId: string) => void;
  /** Set actual buffer duration for a sound — called by SoundSphereManager on buffer load. */
  setSoundBufferDuration: (soundId: string, durationSec: number) => void;
  /** Set generation-in-progress flag — gates bake during active generation. */
  setGenerationInProgress: (p: boolean) => void;
  /**
   * Called once after orchestrate pipeline sends configs to sound generation.
   * Sets iterationLinks (variant + entity per iteration) from orchestrateMeta.
   */
  setOrchestrateIterationLinks: (configs: SoundGenerationConfig[]) => void;
  /**
   * Re-bakes all orchestrate schedule timestamps from the dependency graph.
   * Safe to call repeatedly — only updates when values change.
   * Call after: initial config load, each sound generation, or trim changes.
   * @param onDone Optional callback fired after the (async) bake applies its result.
   * @param opts Optional. `notify: true` marks this as an authoritative bake that
   *   may surface orchestrate warnings (exclusions / authored-fallback placement /
   *   self-overlap) as toasts. Only the orchestrator-agent job (initial finalize +
   *   re-orchestrate) sets it — passive re-bakes (buffer loads, timeline edits,
   *   project restore) must stay silent to avoid toast spam.
   */
  bakeOrchestrateSchedule: (onDone?: () => void, opts?: { notify?: boolean }) => void;
  handlePreviewPlayPause: (soundId: string) => void;
  handlePreviewStop: (soundId: string) => void;
  stopSoundcardPreview: () => void;
  playAll: () => void;
  pauseAll: () => void;
  stopAll: () => void;
  isAnyPlaying: () => boolean;
  forceStopAll: () => void;
  /** Restore per-sound volumes after a soundscape load. */
  restoreVolumes: (volumes: Record<string, number>) => void;
  /** Restore the stored per-track timestamps after a soundscape load. Tracks without an entry stay "auto". */
  restoreSoundTimestamps: (timestamps: Record<string, number[]>) => void;
  /** Restore persisted per-iteration exclusions after a soundscape load. */
  restoreExclusions: (excluded: Record<string, number[]>, reasons: Record<string, string>) => void;
  /**
   * Remove one iteration from the exclusion set (and its reason). Used when the
   * user manually places/duplicates a clip onto an excluded slot — the hatched
   * ghost disappears because the user has taken over that iteration.
   */
  clearIterationExclusion: (soundId: string, iterationIndex: number) => void;
  /** Remove a track's stored schedule entirely — it returns to its auto default loop. */
  clearSoundTimestampsEntry: (soundId: string) => void;
  /**
   * Drop every stored per-sound schedule/state for the given ids. Used right
   * after a fresh generation so a reused sound id (config indices are recycled
   * across scenarios/models) cannot inherit a stale manual timestamp from a
   * previous soundscape via the persisted `soundTimestamps`.
   */
  clearSoundTimestampsFor: (soundIds: string[]) => void;
  restoreIterationLinks: (links: Record<string, IterationLink>) => void;
  restoreMuteSolo: (mutedSoundIds: string[], soloedSoundId: string | null) => void;
  /**
   * Snapshot of the LAST orchestrator-produced schedule (per-track timestamps +
   * iteration links), captured right after an orchestrate bake. "Reset track"
   * restores a track from this so it reverts to the orchestrator's result rather
   * than to an empty/auto loop.
   */
  orchestrateResult: {
    timestamps: Record<string, number[]>;
    iterationLinks: Record<string, IterationLink>;
  } | null;
  /** Capture the current schedule as the orchestrator result (called after an orchestrate bake). */
  saveOrchestrateResult: () => void;
  /** Restore a track from the saved orchestrator result; falls back to clearing it. */
  resetTrack: (soundId: string) => void;
  /**
   * Drop all per-sound state (timestamps / iteration durations / volumes / trims
   * / loop flags / iterationLinks / mute-solo membership) for the given sound IDs.
   * Used when a sound config is deleted so its orphaned schedule can never be
   * baked back into the timeline, then re-bakes the parametric schedule.
   */
  pruneSounds: (soundIds: string[]) => void;
}

// ─── Partialize (exported for snapshot registry) ───────────────────────────

export const audioControlsPartialize = (state: AudioControlsStoreState) => ({
  soundVolumes: { ...state.soundVolumes },
  soundTrims: { ...state.soundTrims },
  selectedVariants: { ...state.selectedVariants },
  mutedSounds: new Set(state.mutedSounds),
  soloedSound: state.soloedSound,
  timelineDurationMs: state.timelineDurationMs,
  globalBaseDbfs: state.globalBaseDbfs,
  maximumFoleySounds: state.maximumFoleySounds,
  ttsLanguage: state.ttsLanguage,
  outputDeviceId: state.outputDeviceId,
  normalizeImpulseResponses: state.normalizeImpulseResponses,
  soundTimestamps: { ...state.soundTimestamps },
  soundLoopable: { ...state.soundLoopable },
  excludedIterations: { ...state.excludedIterations },
  exclusionReasons: { ...state.exclusionReasons },
});

// Module-level counter used to cancel superseded bake calls (set inside setTimeout).
let _pendingBakeId = 0;
// Carried across superseded bakes: if the bake that requested a callback is
// replaced by a newer bake (e.g. a late buffer load), the newer bake invokes it
// instead — so the final applied schedule is the one captured.
let _pendingBakeOnDone: (() => void) | null = null;
// Carried across superseded bakes (like `_pendingBakeOnDone`): true when an
// authoritative orchestrator-job bake requested user-facing reporting. The next
// bake that actually completes reports (a deferred authoritative bake carries
// the flag to the later, duration-complete bake).
let _pendingBakeNotify = false;
// Signature of the last broken-link set surfaced to the user, so a persistent
// failure (e.g. a cycle) does not fire a toast on every re-bake.
let _lastReportedBrokenLinks = '';
// Signature of the last same-track overlap serialization, so it does not re-toast.
let _lastReportedSelfOverlap = '';
// Signature of the last authored-fallback set, so the warning does not re-toast.
let _lastReportedFallbacks = '';

export const useAudioControlsStore = create<AudioControlsStoreState>()(
  persist(
    temporal(
      devtools(
      (set, get) => ({
        // ── Initial state ──
        individualSoundStates: {},
        selectedVariants: {},
        soundVolumes: {},
        soundTrims: {},
        mutedSounds: new Set(),
        soloedSound: null,
        previewingSoundId: null,
        timelineDurationMs: AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS,
        globalBaseDbfs: DEFAULT_DBFS,
        maximumFoleySounds: DEFAULT_MAXIMUM_FOLEY_SOUNDS,
        ttsLanguage: TTS_DEFAULT_LANGUAGE,
        outputDeviceId: AUDIO_OUTPUT.DEFAULT_DEVICE_ID,
        normalizeImpulseResponses: false,
        _generatedSounds: [],
        _soundConfigs: [],
        soundBufferDurations: {},
        soundTimestamps: {},
        soundLoopable: {},
        loopAnalysisInProgress: {},
        soundIterationDurations: {},
        excludedIterations: {},
        exclusionReasons: {},
        isBakingSchedule: false,
        isDeferredCycleBakePending: false,
        _pendingPlayAllStagger: false,
        playAllNonce: 0,
        _generationInProgress: false,
        iterationLinks: {},
        orchestrateResult: null,

        // ── Sync ──
        syncGeneratedSounds: (sounds) => {
          set({ _generatedSounds: sounds }, false, 'audio/syncGeneratedSounds');
        },

        syncSoundConfigs: (configs) =>
          set({ _soundConfigs: configs }, false, 'audio/syncSoundConfigs'),

        setSoundBufferDuration: (soundId, durationSec) => {
          set(
            (state) => ({ soundBufferDurations: { ...state.soundBufferDurations, [soundId]: durationSec } }),
            false,
            'audio/setSoundBufferDuration',
          );
          // Skip the rebake when generation is in progress — the final bake
          // runs once when generation completes.
          if (!get()._generationInProgress) {
            get().bakeOrchestrateSchedule();
          }
        },

        setGenerationInProgress: (p) => {
          set({ _generationInProgress: p }, false, 'audio/setGenerationInProgress');
        },

        // ── Actions ──
        toggleSound: (soundId) =>
          set(
            (state) => {
              const current = state.individualSoundStates[soundId] || 'stopped';
              return {
                individualSoundStates: {
                  ...state.individualSoundStates,
                  [soundId]: current === 'playing' ? 'paused' : 'playing',
                },
              };
            },
            false,
            'audio/toggleSound',
          ),

        handleVariantChange: (promptIdx, variantIdx) => {
          // Timeline playback is intentionally decoupled from the card variant selector.
          // Only update selectedVariants (drives sphere display + card preview) and
          // transfer the preview sound ID if the user was previewing the old variant.
          // individualSoundStates is NOT touched so the timeline keeps playing variant 0.
          const { _generatedSounds, selectedVariants, previewingSoundId } = get();

          const byPrompt: Record<number, any[]> = {};
          _generatedSounds.forEach((s) => {
            const idx = s.prompt_index ?? 0;
            if (!byPrompt[idx]) byPrompt[idx] = [];
            byPrompt[idx].push(s);
          });

          let sounds = byPrompt[promptIdx];

          // If promptIdx is a card index (not found directly), it may be a
          // speech-line TTS card where sounds encode the card index as
          // prompt_index = cardIndex * 10000 + lineIdx. Collect all matching
          // sounds sorted by line index (lowest remains).
          if (!sounds) {
            sounds = _generatedSounds.filter((s) => {
              const pi = s.prompt_index ?? 0;
              return pi >= 10000 && Math.floor(pi / 10000) === promptIdx;
            });
            if (sounds.length > 0) {
              sounds.sort((a, b) => (a.prompt_index ?? 0) - (b.prompt_index ?? 0));
            }
          }

          if (!sounds || sounds.length === 0) return;

          const oldVariantIdx = selectedVariants[promptIdx] || 0;
          const oldSound = sounds[oldVariantIdx];
          const newSound = sounds[variantIdx];
          const wasPreviewPlaying = oldSound && previewingSoundId === oldSound.id;

          set(
            {
              selectedVariants: { ...selectedVariants, [promptIdx]: variantIdx },
              previewingSoundId:
                wasPreviewPlaying && newSound ? newSound.id : previewingSoundId,
            },
            false,
            'audio/handleVariantChange',
          );
        },

        handleVolumeChange: (soundId, volumeDbfs) =>
          set(
            (state) => ({ soundVolumes: { ...state.soundVolumes, [soundId]: volumeDbfs } }),
            false,
            'audio/handleVolumeChange',
          ),

        handleTimestampsChange: (soundId, timestamps) => {
          // No stopAll(): the transport rebuilds its score reactively (see
          // Transport.ts) — dragging/deleting/duplicating a clip no longer needs to
          // interrupt playback for the change to take effect on the next tick.
          set(
            (state) => ({
              soundTimestamps: { ...state.soundTimestamps, [soundId]: timestamps },
            }),
            false,
            'audio/handleTimestampsChange',
          );
        },

        handleTimestampsChangeBatch: (updates) => {
          // No stopAll(): see handleTimestampsChange. A single set() call here means
          // one drag that propagates through several trigger-linked tracks produces
          // exactly one undo entry, instead of one per affected track.
          set(
            (state) => ({
              soundTimestamps: { ...state.soundTimestamps, ...updates },
            }),
            false,
            'audio/handleTimestampsChangeBatch',
          );
        },

        handleRemoveTimestamp: (soundId, iterationIndex) =>
          set(
            (state) => {
              const timestamps = state.soundTimestamps[soundId] ?? [];
              const newTimestamps = timestamps.filter((_, i) => i !== iterationIndex);

              // Remap iterationLinks so overrides on iterations AFTER the removed one
              // keep following their own clip instead of being silently reassigned by
              // the array-index shift — this was one of two root causes of variant/
              // entity overrides appearing to "revert" after deleting an earlier clip.
              const prefix = `${soundId}-`;
              const remapped: Record<string, IterationLink> = {};
              Object.entries(state.iterationLinks).forEach(([key, link]) => {
                if (!key.startsWith(prefix)) {
                  remapped[key] = link;
                  return;
                }
                const idx = parseInt(key.slice(prefix.length), 10);
                if (Number.isNaN(idx)) {
                  remapped[key] = link;
                  return;
                }
                if (idx === iterationIndex) return; // dropped with the removed clip
                const newIdx = idx > iterationIndex ? idx - 1 : idx;
                remapped[`${soundId}-${newIdx}`] = link;
              });

              return {
                soundTimestamps: { ...state.soundTimestamps, [soundId]: newTimestamps },
                iterationLinks: remapped,
              };
            },
            false,
            'audio/handleRemoveTimestamp',
          ),

        remapIterationLinksForInsert: (soundId, insertAt) =>
          set(
            (state) => {
              // Shift every iterationLink at/after `insertAt` up by one index — used
              // when a new clip (e.g. from duplicate) is spliced into the middle of a
              // track's timestamp array, so existing overrides keep following their
              // own clip instead of the array-index shift silently reassigning them.
              const prefix = `${soundId}-`;
              const remapped: Record<string, IterationLink> = {};
              Object.entries(state.iterationLinks).forEach(([key, link]) => {
                if (!key.startsWith(prefix)) {
                  remapped[key] = link;
                  return;
                }
                const idx = parseInt(key.slice(prefix.length), 10);
                if (Number.isNaN(idx)) {
                  remapped[key] = link;
                  return;
                }
                const newIdx = idx >= insertAt ? idx + 1 : idx;
                remapped[`${soundId}-${newIdx}`] = link;
              });
              return { iterationLinks: remapped };
            },
            false,
            'audio/remapIterationLinksForInsert',
          ),

        setIterationLink: (soundId, iterationIndex, link) =>
          set(
            (state) => {
              const key = `${soundId}-${iterationIndex}`;
              const existing = state.iterationLinks[key] ?? {};
              return { iterationLinks: { ...state.iterationLinks, [key]: { ...existing, ...link } } };
            },
            false,
            'audio/setIterationLink',
          ),

        setIterationLinkForAllIterations: (soundId, iterationIndices, link) =>
          set(
            (state) => {
              if (iterationIndices.length === 0) return {};
              const next = { ...state.iterationLinks };
              for (const iterationIndex of iterationIndices) {
                const key = `${soundId}-${iterationIndex}`;
                next[key] = { ...(next[key] ?? {}), ...link };
              }
              return { iterationLinks: next };
            },
            false,
            'audio/setIterationLinkForAllIterations',
          ),

        clearIterationLink: (soundId, iterationIndex) =>
          set(
            (state) => {
              const key = `${soundId}-${iterationIndex}`;
              const { [key]: _removed, ...rest } = state.iterationLinks;
              return { iterationLinks: rest };
            },
            false,
            'audio/clearIterationLink',
          ),

        clearAllIterationLinksForSound: (soundId) =>
          set(
            (state) => {
              const prefix = `${soundId}-`;
              const filtered = Object.fromEntries(
                Object.entries(state.iterationLinks).filter(([k]) => !k.startsWith(prefix)),
              );
              return { iterationLinks: filtered };
            },
            false,
            'audio/clearAllIterationLinksForSound',
          ),

        refreshIterationEntityPositions: () =>
          set(
            (state) => {
              const { iterationLinks, _soundConfigs, _generatedSounds } = state;
              if (Object.keys(iterationLinks).length === 0) return {};

              // soundId → config card index (speech sounds encode cardIndex*10000+line).
              const cardIndexBySoundId = new Map<string, number>();
              _generatedSounds.forEach((s: any) => {
                const pi = s.prompt_index;
                if (pi === undefined || pi === null) return;
                cardIndexBySoundId.set(s.id, pi >= 10000 ? Math.floor(pi / 10000) : pi);
              });

              const next: Record<string, IterationLink> = { ...iterationLinks };
              let changed = false;
              for (const [key, link] of Object.entries(iterationLinks)) {
                if (link.entityIndex === undefined) continue;
                const dash = key.lastIndexOf('-');
                const soundId = dash > 0 ? key.substring(0, dash) : key;
                const cardIndex = cardIndexBySoundId.get(soundId);
                if (cardIndex === undefined) continue;
                const entity = _soundConfigs[cardIndex]?.entities?.[link.entityIndex];
                const live = entity?.bounds?.center ?? entity?.position;
                if (!live || live.length < 3) continue;
                const prev = link.entityPosition;
                if (
                  prev &&
                  prev[0] === live[0] &&
                  prev[1] === live[1] &&
                  prev[2] === live[2]
                ) {
                  continue;
                }
                next[key] = {
                  ...link,
                  entityPosition: [live[0], live[1], live[2]] as [number, number, number],
                };
                changed = true;
              }

              if (!changed) return {};
              return { iterationLinks: next };
            },
            false,
            'audio/refreshIterationEntityPositions',
          ),

        breakIterationTriggerLink: (soundId, iterationIndex, promptIndex) => {
          get().clearIterationLink(soundId, iterationIndex);
          if (promptIndex >= 0) {
            useSoundscapeStore.getState().clearOrchestrateTrigger(promptIndex, iterationIndex);
          }
        },

        handleMute: (soundId) =>
          set(
            (state) => {
              // Track-level mute: every variant copy of the sound card is
              // toggled together, so the DAW's per-iteration variant overrides
              // all go silent when the track is muted.
              const sounds = state._generatedSounds.length > 0
                ? state._generatedSounds
                : useSoundscapeStore.getState().generatedSounds;
              const trackIds = resolveTrackSoundIds(sounds, soundId);
              const newMuted = new Set(state.mutedSounds);
              const isMuted = trackIds.some((id) => newMuted.has(id));
              if (isMuted) {
                trackIds.forEach((id) => newMuted.delete(id));
              } else {
                trackIds.forEach((id) => newMuted.add(id));
              }
              return {
                mutedSounds: newMuted,
                soloedSound:
                  state.soloedSound && trackIds.includes(state.soloedSound)
                    ? null
                    : state.soloedSound,
              };
            },
            false,
            'audio/handleMute',
          ),

        handleSolo: (soundId) =>
          set(
            (state) => {
              // Track-level: clearing mute must drop every variant copy, otherwise
              // a mute→solo→unsolo cycle would leave the track half-muted.
              const sounds = state._generatedSounds.length > 0
                ? state._generatedSounds
                : useSoundscapeStore.getState().generatedSounds;
              const trackIds = resolveTrackSoundIds(sounds, soundId);
              const newMuted = new Set(state.mutedSounds);
              trackIds.forEach((id) => newMuted.delete(id));
              return {
                mutedSounds: newMuted,
                soloedSound: state.soloedSound === soundId ? null : soundId,
              };
            },
            false,
            'audio/handleSolo',
          ),

        setSoundTrim: (soundId, trim) => {
          set(
            (state) => ({ soundTrims: { ...state.soundTrims, [soundId]: trim } }),
            false,
            'audio/setSoundTrim',
          );
          // Recompute orchestrate schedule so alignEnd placements stay valid after trim
          if (get()._soundConfigs.some(c => c.orchestrateMeta)) {
            get().bakeOrchestrateSchedule();
          }
        },

        toggleSoundLoopable: async (soundId, url) => {
          const currentlyLoopable = get().soundLoopable[soundId] ?? false;
          if (currentlyLoopable) {
            set(
              (state) => ({
                soundLoopable: { ...state.soundLoopable, [soundId]: false },
              }),
              false,
              'audio/setSoundLoopableOff',
            );
            return;
          }

          if (get().loopAnalysisInProgress[soundId]) return;

          set(
            (state) => ({
              loopAnalysisInProgress: { ...state.loopAnalysisInProgress, [soundId]: true },
            }),
            false,
            'audio/loopAnalysisStart',
          );

          let loopJobId: string | null = null;
          try {
            // The heavy period-search runs server-side on the CPU pool (same
            // queue pattern as trim_silence / SED) — the browser only polls.
            const { analysis_id } = await apiService.analyzeLoop(url);
            loopJobId = analysis_id;
            recordInflightJob(analysis_id, 'loop', { soundId });

            const deadline = Date.now() + 60_000;
            let outcome: { start: number; end: number; length_sec?: number; match_score?: number } | null | undefined;
            for (;;) {
              if (Date.now() > deadline) {
                throw new Error('Loop analysis timed out.');
              }
              const st = await apiService.getLoopAnalysisStatus(analysis_id);
              if (st.error) {
                throw new Error(st.error);
              }
              if (st.completed) {
                outcome = st.result ?? null;
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 700));
            }

            if (!outcome) {
              throw new Error('Could not find a loopable region in this audio.');
            }

            const startFrac = Math.max(0, Math.min(1, outcome.start));
            const endFrac = Math.max(0, Math.min(1, outcome.end));

            set(
              (state) => ({
                soundLoopable: { ...state.soundLoopable, [soundId]: true },
              }),
              false,
              'audio/setSoundLoopableOn',
            );
            // The loop region IS the trim — DAW blocks, playback and the
            // card preview all narrow to it automatically.
            get().setSoundTrim(soundId, {
              start: startFrac,
              end: Math.max(startFrac + 0.02, endFrac),
            });

            const { notifyError } = await import('@/store/errorsStore');
            notifyError(
              `Loop ready — ${(outcome.length_sec ?? 0).toFixed(1)}s, ${Math.round((outcome.match_score ?? 0) * 100)}% match`,
              'info',
            );
          } catch (err) {
            const { notifyError } = await import('@/store/errorsStore');
            notifyError(err instanceof Error ? err.message : 'Loop analysis failed');
            set(
              (state) => ({
                soundLoopable: { ...state.soundLoopable, [soundId]: false },
              }),
              false,
              'audio/loopAnalysisFailed',
            );
          } finally {
            if (loopJobId) removeInflightJob(loopJobId);
            set(
              (state) => {
                const next = { ...state.loopAnalysisInProgress };
                delete next[soundId];
                return { loopAnalysisInProgress: next };
              },
              false,
              'audio/loopAnalysisEnd',
            );
          }
        },

        setTimelineDurationMs: (ms) => {
          syncTimelineToActiveScenario(ms);
          set({ timelineDurationMs: ms }, false, 'audio/setTimelineDurationMs');
        },

        resetTimelineDurationMs: () =>
          set({ timelineDurationMs: AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS }, false, 'audio/resetTimelineDurationMs'),

        setGlobalBaseDbfs: (dbfs) =>
          set({ globalBaseDbfs: dbfs }, false, 'audio/setGlobalBaseDbfs'),

        resetGlobalBaseDbfs: () =>
          set({ globalBaseDbfs: DEFAULT_DBFS }, false, 'audio/resetGlobalBaseDbfs'),

        setMaximumFoleySounds: (n) =>
          set({ maximumFoleySounds: n }, false, 'audio/setMaximumFoleySounds'),

        setTtsLanguage: (lang) =>
          set({ ttsLanguage: lang }, false, 'audio/setTtsLanguage'),

        setNormalizeImpulseResponses: (v) =>
          set({ normalizeImpulseResponses: v }, false, 'audio/setNormalizeImpulseResponses'),

        setOutputDeviceId: (deviceId) =>
          set({ outputDeviceId: deviceId }, false, 'audio/setOutputDeviceId'),

        setOrchestrateIterationLinks: (configs) => {
          const { _generatedSounds, iterationLinks } = get();

          // Build configIndex → primary generated sound ID
          // (mirrors extractTimelineSoundsFromData: lowest copy_index per prompt_index)
          const promptPrimary = new Map<number, { id: string; copyIdx: number }>();
          _generatedSounds.forEach((s: any) => {
            const pi = s.prompt_index;
            if (pi === undefined || pi === null) return;
            const ci = parseSoundCopyIndex(s.id, s.copy_index);
            const existing = promptPrimary.get(pi);
            if (!existing || ci < existing.copyIdx) promptPrimary.set(pi, { id: s.id, copyIdx: ci });
          });

          // Build new links first so we know which soundIds are being re-linked
          const freshLinks: Record<string, IterationLink> = {};

          configs.forEach((config, configIndex) => {
            const meta = config.orchestrateMeta;
            if (!meta) return;
            const normCat = (config.category ?? '').toLowerCase().replace(/[\s_-]+/g, '_');
            if (normCat === 'background' || normCat === 'background_sound') return;

            const soundId = promptPrimary.get(configIndex)?.id;
            if (!soundId) return; // not yet generated

            const variants = meta.variants; // 1-based [1,2,1,2]
            const entities = (config.entities ?? []) as any[];
            const entityCount = entities.length;

            variants.forEach((variantOneBased, iterIdx) => {
              const key = `${soundId}-${iterIdx}`;
              const entityIdx = entityCount > 0 ? iterIdx % entityCount : undefined;
              const entity = entityIdx !== undefined ? entities[entityIdx] : undefined;
              const link: IterationLink = {
                variantIndex: variantOneBased - 1,
                ...(entity ? {
                  entityIndex: entityIdx,
                  entityNodeId: entity.nodeId ?? entity.id,
                  ...(entity.bounds?.center
                    ? { entityPosition: [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]] as [number, number, number] }
                    : entity.position?.length >= 3
                      ? { entityPosition: [entity.position[0], entity.position[1], entity.position[2]] as [number, number, number] }
                      : {}),
                } : {}),
              };
              freshLinks[key] = link;
            });
          });

          if (Object.keys(freshLinks).length === 0) return;

          // Remove stale keys for sound IDs that are being re-linked so that
          // an old tts_8_0_Kore-2 from a previous (3-variant) generation doesn't
          // linger when the current generation only has 2 variants.
          // Key format: "${soundId}-${iterIdx}" — we extract soundId via lastIndexOf('-').
          const freshSoundIds = new Set<string>();
          Object.keys(freshLinks).forEach(k => {
            const dash = k.lastIndexOf('-');
            if (dash > 0) freshSoundIds.add(k.substring(0, dash));
          });

          const filteredExisting: Record<string, IterationLink> = {};
          Object.entries(iterationLinks).forEach(([k, v]) => {
            const dash = k.lastIndexOf('-');
            const sid = dash > 0 ? k.substring(0, dash) : k;
            if (!freshSoundIds.has(sid)) filteredExisting[k] = v;
          });

          set(
            { iterationLinks: { ...filteredExisting, ...freshLinks } },
            false,
            'audio/setOrchestrateIterationLinks',
          );
        },

        bakeOrchestrateSchedule: (onDone, opts) => {
          if (onDone) _pendingBakeOnDone = onDone;
          // An authoritative (orchestrator-job) bake arms reporting; it survives
          // supersession so a deferred bake's eventual duration-complete re-bake
          // still reports.
          if (opts?.notify) _pendingBakeNotify = true;
          // Show loading indicator immediately, then do computation in the next tick
          // so React can render the skeleton before the synchronous work blocks the thread.
          const bakeId = ++_pendingBakeId;
          set({ isBakingSchedule: true }, false, 'audio/bakeOrchestrateSchedule/start');

          setTimeout(() => {
          if (bakeId !== _pendingBakeId) return; // superseded — the newer bake will run the pending callback

          const { _soundConfigs, _generatedSounds, soundTrims, soundTimestamps, soundBufferDurations, soundIterationDurations } = get();

          if (!_soundConfigs.some(c => c.orchestrateMeta)) {
            _pendingBakeNotify = false;
            if (bakeId === _pendingBakeId) {
              set(
                { isBakingSchedule: false, excludedIterations: {}, exclusionReasons: {} },
                false,
                'audio/bakeOrchestrateSchedule/noop',
              );
            }
            const cb = _pendingBakeOnDone; _pendingBakeOnDone = null; cb?.();
            return;
          }

          // User-facing orchestrate warnings are only surfaced from an
          // authoritative orchestrator-job bake — never from the passive re-bakes
          // that project restore triggers as each audio buffer loads.
          const notify = _pendingBakeNotify;

          // Build configIndex → primary generated sound ID
          // (mirrors extractTimelineSoundsFromData: lowest copy_index per prompt_index)
          const promptPrimary = new Map<number, { id: string; copyIdx: number }>();
          _generatedSounds.forEach((s: any) => {
            const pi = s.prompt_index;
            if (pi === undefined || pi === null) return;
            const ci = parseSoundCopyIndex(s.id, s.copy_index);
            const existing = promptPrimary.get(pi);
            if (!existing || ci < existing.copyIdx) promptPrimary.set(pi, { id: s.id, copyIdx: ci });
          });

          type EntryInfo = {
            configIndex: number;
            soundId: string | null; // primary generated sound ID (null = not yet generated)
            meta: NonNullable<SoundGenerationConfig['orchestrateMeta']>;
            /** Duration per variant copy (0-based). null = not yet generated. */
            variantDurations: (number | null)[];
            /** Resolved start time per expression/iteration slot. null = not yet resolved. */
            timestamps: (number | null)[];
            /** Iteration indices the solver excluded (unsatisfiable constraint). */
            excludedIndices: number[];
            /** False while durations are still theoretical (pre-generation). */
            durationsKnown: boolean;
            /** Existing manual schedule for this sound (seconds), per iteration. */
            manualTimestamps: (number | null | undefined)[];
            /** Solver expressions (backgrounds are pinned to a constant anchor). */
            expressions: string[];
            /** Solver delays, parallel to `expressions`. */
            delays: number[];
            /** True for background tracks — anchor-only, never schedule-written. */
            isBackground: boolean;
          };

          // Keyed by `orchestrateId::entryId` so duplicate entry ids across
          // scenario sets can never collide.
          const entryMap = new Map<string, EntryInfo>();

          _soundConfigs.forEach((config, configIndex) => {
            const meta = config.orchestrateMeta;
            if (!meta) return;
            // Background sounds are not parametrically placed — they keep their own
            // auto/back-to-back schedule and are never overwritten by the bake.
            // Normalize category to handle variations like "background sound" / "background_sound".
            const normCat = (config.category ?? '').toLowerCase().replace(/[\s_-]+/g, '_');
            const isBackground = normCat === 'background' || normCat === 'background_sound';

            const soundId = promptPrimary.get(configIndex)?.id ?? null;
            const generatedForConfig = _generatedSounds.filter((s: any) => s.prompt_index === configIndex);
            const numCopies = Math.max(1, config.seed_copies ?? 1);
            const variantDurations: (number | null)[] = new Array(numCopies).fill(null);

            generatedForConfig.forEach((s: any) => {
              // Prefer the REAL decoded buffer duration over the requested/reported
              // `s.duration` — for ML (TangoFlux) the backend reports the requested
              // length, which differs from the actual WAV, so using it makes
              // after()/alignEnd() place dependent sounds at the wrong time.
              const rawDur = soundBufferDurations[s.id] ?? s.duration ?? 0;
              if (rawDur <= 0) return;
              const copyIdx = parseSoundCopyIndex(s.id, s.copy_index);
              // Trim is keyed by the primary timeline sound id (sound card level).
              // Trim values are FRACTIONS (0-1) of the buffer, so the effective
              // duration is `rawDur * (end - start)` — matching timeline-utils.
              const trim = soundId ? soundTrims[soundId] : undefined;
              let effectiveDur = rawDur;
              if (trim) {
                const startFrac = Math.max(0, Math.min(1, trim.start ?? 0));
                const endFrac = trim.end > 0 ? Math.min(1, trim.end) : 1;
                effectiveDur = Math.max(0, rawDur * (endFrac - startFrac));
              }
              if (copyIdx >= 0 && copyIdx < variantDurations.length) {
                variantDurations[copyIdx] = effectiveDur;
              }
              if (variantDurations[0] === null) variantDurations[0] = effectiveDur;
            });

            // Durations are only "known" once EVERY generated copy has a decoded
            // buffer — otherwise the solver defers instead of guessing from the
            // backend's requested length.
            const durationsKnown =
              generatedForConfig.length > 0 &&
              generatedForConfig.every((s: any) => soundBufferDurations[s.id] != null);

            // Backgrounds are pinned to a constant anchor at t=0 so other sounds
            // may reference them (e.g. `overlap(hvac_hum_1)`). They are never
            // schedule-written — their timeline loop is generated downstream.
            const expressions = isBackground ? ['0'] : meta.trigger.expression;
            const delays = isBackground ? [0] : (meta.trigger.delay ?? []);
            // Fallback for slots the parametric graph cannot satisfy strictly:
            // the user's DAW edits win, otherwise the entry's authored times
            // (MM:SS or seconds) keep the track sequenced instead of dropping it.
            const editedTimestamps = soundId ? soundTimestamps[soundId] : undefined;
            const authoredTimestamps = (meta.timestamps ?? []).map((t) => parseAuthoredSeconds(t));
            entryMap.set(scheduleEntryKey(meta.orchestrateId, meta.entryId), {
              configIndex,
              soundId,
              meta,
              variantDurations,
              timestamps: new Array(expressions.length).fill(null),
              excludedIndices: [],
              durationsKnown: isBackground ? true : durationsKnown,
              manualTimestamps: editedTimestamps && editedTimestamps.length > 0
                ? editedTimestamps
                : authoredTimestamps,
              expressions,
              delays,
              isBackground,
            });
          });

          // ── Strict constraint resolution + same-track serialization ───────────
          // Every slot is resolved by its exact formula (after / alignEnd /
          // overlap). Anything unsatisfiable is EXCLUDED per iteration and
          // reported. Then one sound track can never have two iterations playing
          // at once, so overlapping iterations are serialized. A serialized param
          // slot deviates from its formula, so it is pinned as an absolute anchor
          // and the whole graph is RE-SOLVED — otherwise dependents keep the
          // pre-nudge end and can overlap the iteration that was pushed forward.
          const buildSolverInputs = (overrides: Map<string, number>) =>
            Array.from(entryMap.values()).map((entry) => {
              const entryKey = scheduleEntryKey(entry.meta.orchestrateId, entry.meta.entryId);
              const expressions = entry.expressions.map((e, i) => {
                const ov = overrides.get(`${entryKey}::${i}`);
                return ov === undefined ? e : ov.toFixed(3);
              });
              const delays = entry.delays.map((d, i) =>
                overrides.has(`${entryKey}::${i}`) ? 0 : d,
              );
              return {
                orchestrateId: entry.meta.orchestrateId,
                entryId: entry.meta.entryId,
                expressions,
                delays,
                variants: entry.meta.variants ?? [],
                variantDurations: entry.variantDurations,
                durationsKnown: entry.durationsKnown,
                manualTimestamps: entry.manualTimestamps,
              };
            });

          const projectEntries = (result: ReturnType<typeof solveOrchestrateSchedule>) => {
            entryMap.forEach((entry) => {
              const resolved = result.byEntry[scheduleEntryKey(entry.meta.orchestrateId, entry.meta.entryId)];
              if (resolved) {
                entry.timestamps = resolved.timestamps;
                entry.excludedIndices = resolved.excludedIndices;
              }
            });
          };

          const serializeEntries = (): number => {
            let paramNudges = 0;
            entryMap.forEach((entry) => {
              if (entry.isBackground) return;
              const exprs = entry.meta.trigger.expression;
              const durations = entry.timestamps.map((_, i) => {
                const variantIdx = (entry.meta.variants[i] ?? 1) - 1;
                return (entry.variantDurations[variantIdx] ?? entry.variantDurations[0] ?? 0) as number;
              });
              const paramFlags = entry.timestamps.map((_, i) => isParamExpression(exprs[i]));
              const result = serializeTrackOverlaps(entry.timestamps, durations, paramFlags);
              entry.timestamps = result.starts;
              paramNudges += result.paramNudges;
            });
            return paramNudges;
          };

          const overrides = new Map<string, number>();
          const MAX_SERIALIZE_PASSES = 6;
          let serializedParamCount = 0;
          let solver = solveOrchestrateSchedule(buildSolverInputs(overrides));

          for (let pass = 0; pass < MAX_SERIALIZE_PASSES && !solver.deferred; pass++) {
            projectEntries(solver);
            serializedParamCount = Math.max(serializedParamCount, serializeEntries());

            // Feed any serialized slot back as a fixed anchor so dependents move
            // with it, then re-solve. Stop once nothing new was nudged.
            let changed = false;
            entryMap.forEach((entry) => {
              const entryKey = scheduleEntryKey(entry.meta.orchestrateId, entry.meta.entryId);
              const resolved = solver.byEntry[entryKey];
              if (!resolved) return;
              entry.timestamps.forEach((t, i) => {
                const s = resolved.timestamps[i];
                if (t !== null && s !== null && Math.abs(t - s) > 0.001) {
                  const nk = `${entryKey}::${i}`;
                  if (!overrides.has(nk)) {
                    overrides.set(nk, t);
                    changed = true;
                  }
                }
              });
            });
            if (!changed) break;
            solver = solveOrchestrateSchedule(buildSolverInputs(overrides));
          }

          // Normalize to the final solver result (the loop may have exited right
          // after a re-solve).
          if (!solver.deferred) {
            projectEntries(solver);
            serializedParamCount = Math.max(serializedParamCount, serializeEntries());
          }

          if (solver.deferred) {
            // A real measured duration is still missing — never persist a guessed
            // schedule. A later buffer-load bake will run authoritatively.
            if (bakeId === _pendingBakeId) {
              set(
                { isBakingSchedule: false, isDeferredCycleBakePending: true },
                false,
                'audio/bakeOrchestrateSchedule/deferred',
              );
            }
            const cb = _pendingBakeOnDone; _pendingBakeOnDone = null; cb?.();
            return;
          }

          // Map the solver's per-iteration exclusions onto generated sound ids so
          // the DAW can mark them and the schedule can skip them.
          const newExcludedIterations: Record<string, number[]> = {};
          const newExclusionReasons: Record<string, string> = {};
          solver.exclusions.forEach((ex) => {
            const entry = entryMap.get(scheduleEntryKey(ex.orchestrateId, ex.entryId));
            if (!entry?.soundId) return;
            const list = newExcludedIterations[entry.soundId] ?? [];
            if (!list.includes(ex.iterationIndex)) list.push(ex.iterationIndex);
            newExcludedIterations[entry.soundId] = list;
            newExclusionReasons[`${entry.soundId}-${ex.iterationIndex}`] = ex.reason;
          });

          // Only exclusions that map to a real generated sound are user-visible —
          // the raw solver count also includes configs whose audio was never made.
          const mappedExclusionCount = Object.values(newExcludedIterations)
            .reduce((n, list) => n + list.length, 0);

          // Surface excluded iterations once per distinct set. Only an
          // authoritative orchestrator-job bake (`notify`) may toast — passive
          // re-bakes during project restore stay silent.
          if (notify && (mappedExclusionCount > 0 || solver.cycles.length > 0)) {
            const detail = solver.exclusions
              .map((ex) => `${ex.entryId}[${ex.iterationIndex}] ${ex.reason}`)
              .join('\n  ');
            console.warn(
              `[bakeOrchestrateSchedule] ${mappedExclusionCount} excluded iteration(s)` +
              ` (solver reported ${solver.exclusions.length})` +
              (solver.cycles.length ? ` / ${solver.cycles.length} cycle(s):\n  ${solver.cycles.join('\n  ')}` : '') +
              `\n  ${detail}`,
            );
            const signature = [...solver.cycles, ...solver.exclusions.map((e) => `${e.entryId}-${e.iterationIndex}-${e.reason}`)].join('|');
            if (signature !== _lastReportedBrokenLinks) {
              _lastReportedBrokenLinks = signature;
              if (mappedExclusionCount > 0) {
                void import('@/store/errorsStore').then(({ notifyError }) => {
                  notifyError(
                    `Orchestrate: ${mappedExclusionCount} iteration(s) excluded (timing link could not be satisfied). Marked in the timeline.`,
                    'warning',
                  );
                });
              }
            }
          } else if (notify) {
            _lastReportedBrokenLinks = '';
          }

          // Slots the parametric graph could not satisfy strictly but which were
          // placed from the authored / edited time. These ARE scheduled — surface
          // a gentle, deduped warning so the deviation is visible.
          if (notify && solver.fallbacks.length > 0) {
            const signature = `fallback:${solver.fallbacks
              .map((f) => `${f.entryId}-${f.iterationIndex}`)
              .join(',')}`;
            if (signature !== _lastReportedFallbacks) {
              _lastReportedFallbacks = signature;
              console.warn('[bakeOrchestrateSchedule] authored-fallback placement:', solver.fallbacks);
              void import('@/store/errorsStore').then(({ notifyError }) => {
                notifyError(
                  `Orchestrate: ${solver.fallbacks.length} timing link(s) could not be satisfied strictly — authored times used.`,
                  'warning',
                );
              });
            }
          } else if (notify) {
            _lastReportedFallbacks = '';
          }

          if (notify && serializedParamCount > 0) {
            const signature = `self-overlap:${serializedParamCount}`;
            if (signature !== _lastReportedSelfOverlap) {
              _lastReportedSelfOverlap = signature;
              void import('@/store/errorsStore').then(({ notifyError }) => {
                notifyError(
                  `Orchestrate: ${serializedParamCount} same-track iteration(s) overlapped and were serialized.`,
                  'warning',
                );
              });
            }
          } else if (notify) {
            _lastReportedSelfOverlap = '';
          }

          // Reporting is one-shot per authoritative orchestrate bake — clear the
          // carried flag now that this duration-complete bake has consumed it.
          _pendingBakeNotify = false;

          // Apply resolved timestamps — use actual generated sound ID as key.
          const UNRESOLVED = 999999; // >> any real timeline duration (seconds)
          const newTimestamps = { ...soundTimestamps };
          let anyChange = false;
          let maxResolvedSec = 0; // track furthest resolved timestamp for auto-extending

          entryMap.forEach(({ soundId, timestamps, meta, variantDurations, excludedIndices, isBackground }) => {
            // Backgrounds own their loop downstream — never write their schedule.
            if (!soundId || isBackground) return;

            // Interval-type triggers with nothing resolved yet stay "auto" (no
            // stored timestamps) — writing UNRESOLVED sentinels would empty them.
            const isIntervalType = meta.trigger.type === 'interval';
            if (isIntervalType && !timestamps.some(t => t !== null)) return;

            // Build final timestamps: use resolved parametric values for non-empty
            // expressions; excluded iterations are cleared to UNRESOLVED (never
            // preserve a stale value — that produced far-away ghost-slot clips);
            // for empty expressions (cleared by manual drag), preserve the existing
            // concrete timestamp so dragged positions survive save/load.
            const finalTs = timestamps.map((t, i) => {
              if (t !== null) return parseFloat(t.toFixed(3));
              if (excludedIndices.includes(i)) return UNRESOLVED;
              const existingT = soundTimestamps[soundId]?.[i];
              if (existingT != null && existingT < UNRESOLVED) return existingT;
              return UNRESOLVED;
            });

            // Track the furthest real timestamp to potentially extend the timeline
            finalTs.forEach((t, i) => {
              if (t < UNRESOLVED) {
                const variantIdx = (meta.variants[i] ?? 1) - 1;
                const dur = variantDurations[variantIdx] ?? variantDurations[0] ?? 0;
                maxResolvedSec = Math.max(maxResolvedSec, t + (dur as number));
              }
            });

            const existing = newTimestamps[soundId];
            const isDifferent = !existing ||
              existing.length !== finalTs.length ||
              existing.some((v, i) => v !== finalTs[i]);

            if (isDifferent) {
              newTimestamps[soundId] = finalTs;
              anyChange = true;
            }
          });

          // Auto-extend timeline so that all resolved content is visible.
          // Round up to the nearest 30s with a 10s margin.
          const currentDurationMs = get().timelineDurationMs;
          const requiredMs = Math.ceil((maxResolvedSec + 10) / 30) * 30 * 1000;
          // When the active sound section is a scenario card, its own slider
          // duration is the authoritative DAW timeline bound — never auto-extend
          // past it (content beyond the bound is trimmed, like any fixed timeline).
          const activeScenarioMs = getActiveScenarioTimelineMs();
          const newDurationMs = activeScenarioMs !== null
            ? activeScenarioMs
            : Math.min(
                requiredMs > currentDurationMs ? requiredMs : currentDurationMs,
                AUDIO_TIMELINE.MAX_DURATION_MS,
              );

          // Compute per-iteration durations (ms) so each DAW block shows its
          // actual variant length rather than the primary copy's length.
          const newIterDurations = { ...soundIterationDurations };
          entryMap.forEach(({ soundId, timestamps, meta, variantDurations, isBackground }) => {
            if (!soundId || isBackground) return;
            const UNRESOLVED_CHECK = 999999;
            const iterDursMs = timestamps.map((t, i) => {
              if (t === null || t >= UNRESOLVED_CHECK) return 0;
              const variantIdx = (meta.variants[i] ?? 1) - 1;
              const dur = variantDurations[variantIdx] ?? variantDurations[0] ?? 0;
              return (dur as number) * 1000;
            });
            newIterDurations[soundId] = iterDursMs;
          });

          // Check whether iteration durations changed separately from timestamps
          // (buffers can load AFTER timestamps are already resolved, so timestamps won't
          //  flag anyChange but the per-iteration widths still need updating).
          const iterDurationsChanged = Object.keys(newIterDurations).some(k => {
            const prev = soundIterationDurations[k];
            const next = newIterDurations[k];
            if (!prev || prev.length !== next.length) return true;
            return next.some((v, i) => v !== prev[i]);
          });

          if (bakeId !== _pendingBakeId) return; // superseded

          if (anyChange || newDurationMs !== currentDurationMs || iterDurationsChanged) {
            set({
              soundTimestamps: newTimestamps,
              soundIterationDurations: newIterDurations,
              excludedIterations: newExcludedIterations,
              exclusionReasons: newExclusionReasons,
              timelineDurationMs: newDurationMs,
              isBakingSchedule: false,
              isDeferredCycleBakePending: false,
            }, false, 'audio/bakeOrchestrateSchedule');
          } else {
            // Timestamps unchanged but still clear the loading flag.
            // Always write newIterDurations so UI picks up correct variant widths.
            set({
              isBakingSchedule: false,
              soundIterationDurations: newIterDurations,
              excludedIterations: newExcludedIterations,
              exclusionReasons: newExclusionReasons,
              isDeferredCycleBakePending: false,
            }, false, 'audio/bakeOrchestrateSchedule/done');
          }
          const cb = _pendingBakeOnDone; _pendingBakeOnDone = null; cb?.();
          }, 0); // end of setTimeout
        },

        handlePreviewPlayPause: (soundId) => {
          const { individualSoundStates, previewingSoundId } = get();
          // Starting a card preview must stop the timeline transport (not just the
          // legacy individualSoundStates bookkeeping) so the two playback paths
          // never sound simultaneously.
          const scheduler = useSpeckleEngineStore.getState().playbackScheduler;
          if (scheduler?.isPlaying()) {
            scheduler.stop();
          }
          if (Object.values(individualSoundStates).some((s) => s === 'playing')) {
            const stopped: Record<string, SoundState> = {};
            Object.keys(individualSoundStates).forEach((id) => { stopped[id] = 'stopped'; });
            set({ individualSoundStates: stopped }, false, 'audio/previewStopTimeline');
          }
          // Pause imperatively — a prop-driven `isPlaying=false` effect may never
          // run if the previous card unmounts/collapses in the same React commit.
          if (previewingSoundId) pausePreviewInstance(previewingSoundId);
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : soundId,
            }),
            false,
            'audio/handlePreviewPlayPause',
          );
        },

        handlePreviewStop: (soundId) => {
          pausePreviewInstance(soundId);
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : state.previewingSoundId,
            }),
            false,
            'audio/handlePreviewStop',
          );
        },

        stopSoundcardPreview: () => {
          pauseAllPreviewInstances();
          set({ previewingSoundId: null }, false, 'audio/stopSoundcardPreview');
        },

        playAll: () => {
          pauseAllPreviewInstances();
          set({ previewingSoundId: null }, false, 'audio/playAll/clearPreview');
          set({ _pendingPlayAllStagger: true }, false, 'audio/playAll/stagger');

          const { _generatedSounds } = get();

          const byPrompt: Record<number, any[]> = {};
          _generatedSounds.forEach((s) => {
            const idx = s.prompt_index ?? 0;
            if (!byPrompt[idx]) byPrompt[idx] = [];
            byPrompt[idx].push(s);
          });

          // Always play copy-index 0 (variant A) per prompt so that timeline playback
          // is completely independent of the sound card's variant selector.
          // The copy index is the trailing number in the sound ID (e.g. "generated_0_1" → 1).
          const copyIndexOf = (id: string): number => {
            const n = parseInt(id.split('_').pop() ?? '', 10);
            return isNaN(n) ? 0 : n;
          };

          set(
            (state) => {
              const newStates = { ...state.individualSoundStates };
              Object.entries(byPrompt).forEach(([, sounds]) => {
                // Stop all variants for this prompt first.
                sounds.forEach((s) => { newStates[s.id] = 'stopped'; });
                // Play the variant with the lowest copy index (variant A / the default).
                const sel = [...sounds].sort((a, b) => copyIndexOf(a.id) - copyIndexOf(b.id))[0];
                if (sel) newStates[sel.id] = 'playing';
              });
              return { individualSoundStates: newStates, playAllNonce: state.playAllNonce + 1 };
            },
            false,
            'audio/playAll',
          );
        },

        pauseAll: () =>
          set(
            (state) => {
              const newStates = { ...state.individualSoundStates };
              Object.keys(newStates).forEach((id) => {
                if (newStates[id] === 'playing') newStates[id] = 'paused';
              });
              return { individualSoundStates: newStates };
            },
            false,
            'audio/pauseAll',
          ),

        stopAll: () =>
          set(
            (state) => {
              // Stop ALL tracked sounds — not just _generatedSounds, which may lag behind
              // individualSoundStates and leave orphaned 'playing' entries that cause
              // the sync effect to restart the timeline after it ends naturally.
              const newStates: Record<string, SoundState> = {};
              Object.keys(state.individualSoundStates).forEach((id) => {
                newStates[id] = 'stopped';
              });
              return { individualSoundStates: newStates };
            },
            false,
            'audio/stopAll',
          ),

        isAnyPlaying: () =>
          Object.values(get().individualSoundStates).some((s) => s === 'playing'),

        forceStopAll: () =>
          set(
            { individualSoundStates: {}, soundVolumes: {} },
            false,
            'audio/forceStopAll',
          ),

        restoreVolumes: (volumes) =>
          set(
            { soundVolumes: volumes },
            false,
            'audio/restoreVolumes',
          ),

        restoreSoundTimestamps: (timestamps) =>
          set(
            { soundTimestamps: timestamps },
            false,
            'audio/restoreSoundTimestamps',
          ),

        clearSoundTimestampsEntry: (soundId) =>
          set(
            (state) => {
              const { [soundId]: _removed, ...rest } = state.soundTimestamps;
              return { soundTimestamps: rest };
            },
            false,
            'audio/clearSoundTimestampsEntry',
          ),

        clearSoundTimestampsFor: (soundIds) =>
          set(
            (state) => {
              if (soundIds.length === 0) return {};
              const drop = new Set(soundIds);
              const soundTimestamps = { ...state.soundTimestamps };
              const soundIterationDurations = { ...state.soundIterationDurations };
              const excludedIterations = { ...state.excludedIterations };
              const exclusionReasons = { ...state.exclusionReasons };
              drop.forEach((id) => {
                delete soundTimestamps[id];
                delete soundIterationDurations[id];
                delete excludedIterations[id];
                Object.keys(exclusionReasons).forEach((k) => {
                  if (k.startsWith(`${id}-`)) delete exclusionReasons[k];
                });
              });
              return { soundTimestamps, soundIterationDurations, excludedIterations, exclusionReasons };
            },
            false,
            'audio/clearSoundTimestampsFor',
          ),

        restoreExclusions: (excluded, reasons) =>
          set(
            { excludedIterations: excluded, exclusionReasons: reasons },
            false,
            'audio/restoreExclusions',
          ),

        clearIterationExclusion: (soundId, iterationIndex) =>
          set(
            (state) => {
              const current = state.excludedIterations[soundId];
              if (!current || !current.includes(iterationIndex)) return {};
              const nextList = current.filter((i) => i !== iterationIndex);
              const nextExcluded = { ...state.excludedIterations };
              if (nextList.length === 0) delete nextExcluded[soundId];
              else nextExcluded[soundId] = nextList;
              const nextReasons = { ...state.exclusionReasons };
              delete nextReasons[`${soundId}-${iterationIndex}`];
              return { excludedIterations: nextExcluded, exclusionReasons: nextReasons };
            },
            false,
            'audio/clearIterationExclusion',
          ),

        restoreIterationLinks: (links) =>
          set(
            { iterationLinks: links },
            false,
            'audio/restoreIterationLinks',
          ),

        restoreMuteSolo: (mutedSoundIds, soloedSoundId) =>
          set(
            { mutedSounds: new Set(mutedSoundIds), soloedSound: soloedSoundId },
            false,
            'audio/restoreMuteSolo',
          ),

        pruneSounds: (soundIds) => {
          if (soundIds.length === 0) return;
          const remove = new Set(soundIds);
          // iterationLinks keys are `${soundId}-${iterIdx}` and soundIds may
          // themselves contain '-' (duplicate-*, sed-*), so strip the trailing
          // iteration segment with lastIndexOf.
          const stripIteration = (key: string): string => {
            const dash = key.lastIndexOf('-');
            return dash > 0 ? key.substring(0, dash) : key;
          };
          set(
            (state) => {
              const keep = <T,>(obj: Record<string, T>): Record<string, T> => {
                const next: Record<string, T> = {};
                for (const [k, v] of Object.entries(obj)) if (!remove.has(k)) next[k] = v;
                return next;
              };
              const keepLinks = (obj: Record<string, IterationLink>): Record<string, IterationLink> => {
                const next: Record<string, IterationLink> = {};
                for (const [k, v] of Object.entries(obj)) if (!remove.has(stripIteration(k))) next[k] = v;
                return next;
              };
              const newMuted = new Set(state.mutedSounds);
              soundIds.forEach((id) => newMuted.delete(id));
              const prunedOrchestrateResult = state.orchestrateResult
                ? {
                    timestamps: keep(state.orchestrateResult.timestamps),
                    iterationLinks: keepLinks(state.orchestrateResult.iterationLinks),
                  }
                : state.orchestrateResult;
              const keepReasons = (obj: Record<string, string>): Record<string, string> => {
                const next: Record<string, string> = {};
                for (const [k, v] of Object.entries(obj)) if (!remove.has(stripIteration(k))) next[k] = v;
                return next;
              };
              return {
                soundTimestamps: keep(state.soundTimestamps),
                soundIterationDurations: keep(state.soundIterationDurations),
                excludedIterations: keep(state.excludedIterations),
                exclusionReasons: keepReasons(state.exclusionReasons),
                soundVolumes: keep(state.soundVolumes),
                soundTrims: keep(state.soundTrims),
                soundLoopable: keep(state.soundLoopable),
                iterationLinks: keepLinks(state.iterationLinks),
                orchestrateResult: prunedOrchestrateResult,
                mutedSounds: newMuted,
                soloedSound: state.soloedSound && remove.has(state.soloedSound) ? null : state.soloedSound,
              };
            },
            false,
            'audio/pruneSounds',
          );
          // Callers are responsible for re-syncing _soundConfigs / _generatedSounds
          // and re-baking afterwards (they own the fresh config arrays).
        },

        saveOrchestrateResult: () => {
          const { soundTimestamps, iterationLinks } = get();
          set(
            {
              orchestrateResult: {
                timestamps: JSON.parse(JSON.stringify(soundTimestamps)),
                iterationLinks: JSON.parse(JSON.stringify(iterationLinks)),
              },
            },
            false,
            'audio/saveOrchestrateResult',
          );
        },

        resetTrack: (soundId) => {
          const { orchestrateResult } = get();
          const savedTs = orchestrateResult?.timestamps[soundId];
          if (!savedTs || savedTs.length === 0) {
            // Not an orchestrator track (or no saved result) — fall back to the
            // previous behaviour: drop the schedule so it reverts to the auto loop.
            get().clearSoundTimestampsEntry(soundId);
            get().clearAllIterationLinksForSound(soundId);
            return;
          }
          set(
            (state) => {
              // Restore this track's timestamps + iteration links from the saved
              // orchestrator result, leaving every other track untouched.
              const prefix = `${soundId}-`;
              const restoredLinks: Record<string, IterationLink> = {};
              Object.entries(state.iterationLinks).forEach(([k, v]) => {
                if (!k.startsWith(prefix)) restoredLinks[k] = v;
              });
              Object.entries(orchestrateResult!.iterationLinks).forEach(([k, v]) => {
                if (k.startsWith(prefix)) restoredLinks[k] = v;
              });
              return {
                soundTimestamps: { ...state.soundTimestamps, [soundId]: [...savedTs] },
                iterationLinks: restoredLinks,
              };
            },
            false,
            'audio/resetTrack',
          );
        },
      }),
      { name: 'AudioControlsStore' },
    ),
    {
      // Only record history for user-facing config (not play state / internal)
      partialize: audioControlsPartialize,
      equality: (past, current) =>
        JSON.stringify(past.soundVolumes) === JSON.stringify(current.soundVolumes) &&
        JSON.stringify(past.soundTrims) === JSON.stringify(current.soundTrims) &&
        JSON.stringify(past.selectedVariants) === JSON.stringify(current.selectedVariants) &&
        past.mutedSounds.size === current.mutedSounds.size &&
        [...past.mutedSounds].every((id) => current.mutedSounds.has(id)) &&
        past.soloedSound === current.soloedSound &&
        past.timelineDurationMs === current.timelineDurationMs &&
        past.globalBaseDbfs === current.globalBaseDbfs &&
        JSON.stringify(past.soundTimestamps) === JSON.stringify(current.soundTimestamps) &&
        JSON.stringify(past.soundLoopable) === JSON.stringify(current.soundLoopable),
    },
  ),
  {
    name: 'compas-audio-controls',
    storage: createJSONStorage(() => localStorage),
    skipHydration: true,
    partialize: (state: AudioControlsStoreState) => {
      const { individualSoundStates, previewingSoundId, _generatedSounds, _soundConfigs,
        soundBufferDurations, isBakingSchedule, isDeferredCycleBakePending,
        _pendingPlayAllStagger, _generationInProgress, loopAnalysisInProgress, ...persistable } = state;
      return {
        ...persistable,
        mutedSounds: [...(state.mutedSounds || [])],
      } as any;
    },
    merge: (persisted: any, current: AudioControlsStoreState) => ({
      ...current,
      ...persisted,
      mutedSounds: new Set<string>(persisted.mutedSounds || []),
    }),
  },
),
);

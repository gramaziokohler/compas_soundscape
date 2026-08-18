/**
 * Audio Controls Store
 *
 * Replaces useAudioControls hook. Manages all audio playback state globally so
 * SpeckleScene, SoundGenerationSection, WaveSurferTimeline, and EntityInfoPanel
 * can all read from one source of truth without prop drilling through page.tsx.
 *
 * Sync:  page.tsx must call syncGeneratedSounds() whenever soundGen.generatedSounds
 *        changes so that playAll / stopAll / handleVariantChange / handleIntervalChange
 *        have the correct sound list available.
 *
 * zundo partializes on: soundVolumes, soundIntervals, selectedVariants, mutedSounds,
 *                       soloedSound  (the "user-facing" config — excludes play state).
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import type { SoundState, SoundGenerationConfig } from '@/types';
import type { IterationLink } from '@/types/audio';
import { parseSoundCopyIndex } from '@/lib/audio/utils/variant-sound-id';
import { AUDIO_PLAYBACK, AUDIO_TIMELINE, DEFAULT_DBFS, DEFAULT_MAXIMUM_FOLEY_SOUNDS, TTS_DEFAULT_LANGUAGE } from '@/utils/constants';
import { apiService } from '@/services/api';
import { useSoundscapeStore } from './soundscapeStore';


export interface AudioControlsStoreState {
  // ── State ──
  individualSoundStates: Record<string, SoundState>;
  selectedVariants: Record<number, number>;
  soundVolumes: Record<string, number>;
  soundIntervals: Record<string, number>;
  soundTrims: Record<string, { start: number; end: number }>;
  mutedSounds: Set<string>;
  soloedSound: string | null;
  previewingSoundId: string | null;
  /** Absolute jitter applied to each iteration's playback interval (seconds). */
  intervalJitterSeconds: number;
  /** Fixed timeline length in milliseconds — both visual and audio are bounded to this. */
  timelineDurationMs: number;
  /** Internal: synced from useSoundGeneration. Used by playAll / stopAll / handleVariantChange. */
  _generatedSounds: any[];
  /** Internal: synced from soundscapeStore. Used by bakeOrchestrateSchedule. */
  _soundConfigs: SoundGenerationConfig[];
  /** Actual decoded audio buffer durations (seconds), keyed by soundId. Set by SoundSphereManager on load. */
  soundBufferDurations: Record<string, number>;
  /** Per-sound scheduling mode: 'interval' (default) or 'timestamps'. */
  soundSchedulingModes: Record<string, 'interval' | 'timestamps'>;
  /** Per-sound explicit playback timestamps in seconds (used when mode is 'timestamps'). */
  soundTimestamps: Record<string, number[]>;
  /**
   * Per-sound loopable flag, keyed by soundId. When true, DAW interval playback
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
  /** True while bakeOrchestrateSchedule is asynchronously computing; used to show a loading UI. */
  isBakingSchedule: boolean;
  /** True when bake ran before all variant buffers were loaded; DFS is deferred.
   *  Cleared to false once all durations are known and DFS has run successfully. */
  isDeferredCycleBakePending: boolean;
  /** Internal: set to true by playAll() so PlaybackSchedulerService applies stagger.
   *  Consumed and cleared on the first updateSoundPlayback call. */
  _pendingPlayAllStagger: boolean;
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
  handleIntervalChange: (soundId: string, intervalSeconds: number) => void;
  handleSchedulingModeChange: (soundId: string, mode: 'interval' | 'timestamps', soundDurationSeconds?: number) => void;
  handleTimestampsChange: (soundId: string, timestamps: number[]) => void;
  handleRemoveTimestamp: (soundId: string, iterationIndex: number) => void;
  setIterationLink: (soundId: string, iterationIndex: number, link: Partial<IterationLink>) => void;
  clearIterationLink: (soundId: string, iterationIndex: number) => void;
  clearAllIterationLinksForSound: (soundId: string) => void;
  /** Break trigger link for a single iteration (clears iterationLink + orchestrateMeta trigger). */
  breakIterationTriggerLink: (soundId: string, iterationIndex: number, promptIndex: number) => void;
  handleMute: (soundId: string) => void;
  handleSolo: (soundId: string) => void;
  setSoundTrim: (soundId: string, trim: { start: number; end: number }) => void;
  /**
   * Toggle "loopable" for a generated sound. Turning it on runs the client-side
   * loop analysis against `url`, then narrows the sound's trim to the detected
   * periodic loop region (so DAW interval playback loops seamlessly with a seam
   * fade). Turning it off restores nothing else — the trim is left wherever it
   * landed so the user can keep a manual trim if desired.
   */
  toggleSoundLoopable: (soundId: string, url: string) => Promise<void>;
  setIntervalJitter: (seconds: number) => void;
  setTimelineDurationMs: (ms: number) => void;
  resetTimelineDurationMs: () => void;
  /** Global base volume reference level for all generated sounds (dBFS). */
  globalBaseDbfs: number;
  setGlobalBaseDbfs: (dbfs: number) => void;
  resetGlobalBaseDbfs: () => void;
  /** Maximum number of foley sound events generated by the foley artist. */
  maximumFoleySounds: number;
  setMaximumFoleySounds: (n: number) => void;
  /** Language instruction passed to Gemini TTS as part of the prompt. */
  ttsLanguage: string;
  setTtsLanguage: (lang: string) => void;
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
   */
  bakeOrchestrateSchedule: () => void;
  handlePreviewPlayPause: (soundId: string) => void;
  handlePreviewStop: (soundId: string) => void;
  stopSoundcardPreview: () => void;
  playAll: () => void;
  pauseAll: () => void;
  stopAll: () => void;
  isAnyPlaying: () => boolean;
  forceStopAll: () => void;
  restoreVolumeAndIntervals: (
    volumes: Record<string, number>,
    intervals: Record<string, number>,
  ) => void;
  restoreSchedulingModes: (
    modes: Record<string, 'interval' | 'timestamps'>,
    timestamps: Record<string, number[]>,
  ) => void;
  restoreIterationLinks: (links: Record<string, IterationLink>) => void;
  restoreMuteSolo: (mutedSoundIds: string[], soloedSoundId: string | null) => void;
}

// ─── Partialize (exported for snapshot registry) ───────────────────────────

export const audioControlsPartialize = (state: AudioControlsStoreState) => ({
  soundVolumes: { ...state.soundVolumes },
  soundIntervals: { ...state.soundIntervals },
  soundTrims: { ...state.soundTrims },
  selectedVariants: { ...state.selectedVariants },
  mutedSounds: new Set(state.mutedSounds),
  soloedSound: state.soloedSound,
  intervalJitterSeconds: state.intervalJitterSeconds,
  timelineDurationMs: state.timelineDurationMs,
  globalBaseDbfs: state.globalBaseDbfs,
  maximumFoleySounds: state.maximumFoleySounds,
  soundSchedulingModes: { ...state.soundSchedulingModes },
  soundTimestamps: { ...state.soundTimestamps },
  soundLoopable: { ...state.soundLoopable },
});

// Module-level counter used to cancel superseded bake calls (set inside setTimeout).
let _pendingBakeId = 0;

export const useAudioControlsStore = create<AudioControlsStoreState>()(
  persist(
    temporal(
      devtools(
      (set, get) => ({
        // ── Initial state ──
        individualSoundStates: {},
        selectedVariants: {},
        soundVolumes: {},
        soundIntervals: {},
        soundTrims: {},
        mutedSounds: new Set(),
        soloedSound: null,
        previewingSoundId: null,
        intervalJitterSeconds: AUDIO_PLAYBACK.DEFAULT_INTERVAL_JITTER_SECONDS,
        timelineDurationMs: AUDIO_PLAYBACK.TIMELINE_FIXED_DURATION_MS,
        globalBaseDbfs: DEFAULT_DBFS,
        maximumFoleySounds: DEFAULT_MAXIMUM_FOLEY_SOUNDS,
        ttsLanguage: TTS_DEFAULT_LANGUAGE,
        _generatedSounds: [],
        _soundConfigs: [],
        soundBufferDurations: {},
        soundSchedulingModes: {},
        soundTimestamps: {},
        soundLoopable: {},
        loopAnalysisInProgress: {},
        soundIterationDurations: {},
        isBakingSchedule: false,
        isDeferredCycleBakePending: false,
        _pendingPlayAllStagger: false,
        _generationInProgress: false,
        iterationLinks: {},

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

        handleIntervalChange: (soundId, intervalSeconds) => {
          get().stopAll();
          set(
            (state) => ({
              soundIntervals: { ...state.soundIntervals, [soundId]: intervalSeconds },
            }),
            false,
            'audio/handleIntervalChange',
          );
        },

        handleSchedulingModeChange: (soundId, mode, soundDurationSeconds) => {
          get().stopAll();
          set(
            (state) => {
              let newTimestamps = { ...state.soundTimestamps };

              if (mode === 'timestamps') {
                // Auto-generate timestamps packed tightly (gap = 0) from t=0 up to the
                // timeline duration.  Use the actual buffer duration if provided so
                // sounds sit exactly back-to-back; fall back to a single t=0 sentinel
                // so the list is never empty.
                const timelineDurationSec = state.timelineDurationMs / 1000;
                const autoTs: number[] = [];
                if (soundDurationSeconds && soundDurationSeconds > 0) {
                  let t = 0;
                  while (t + soundDurationSeconds <= timelineDurationSec && autoTs.length < 200) {
                    autoTs.push(parseFloat(t.toFixed(3)));
                    t += soundDurationSeconds;
                  }
                }
                // Always seed at least one timestamp
                if (autoTs.length === 0) autoTs.push(0);
                newTimestamps = { ...newTimestamps, [soundId]: autoTs };
              } else {
                // Switching back to interval mode — clear the timestamps
                const { [soundId]: _removed, ...rest } = newTimestamps;
                newTimestamps = rest;
              }

              return {
                soundSchedulingModes: { ...state.soundSchedulingModes, [soundId]: mode },
                soundTimestamps: newTimestamps,
              };
            },
            false,
            'audio/handleSchedulingModeChange',
          );
        },

        handleTimestampsChange: (soundId, timestamps) => {
          get().stopAll();
          set(
            (state) => ({
              soundTimestamps: { ...state.soundTimestamps, [soundId]: timestamps },
            }),
            false,
            'audio/handleTimestampsChange',
          );
        },

        handleRemoveTimestamp: (soundId, iterationIndex) =>
          set(
            (state) => {
              const timestamps = state.soundTimestamps[soundId] ?? [];
              const newTimestamps = timestamps.filter((_, i) => i !== iterationIndex);
              return { soundTimestamps: { ...state.soundTimestamps, [soundId]: newTimestamps } };
            },
            false,
            'audio/handleRemoveTimestamp',
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

        breakIterationTriggerLink: (soundId, iterationIndex, promptIndex) => {
          get().clearIterationLink(soundId, iterationIndex);
          if (promptIndex >= 0) {
            useSoundscapeStore.getState().clearOrchestrateTrigger(promptIndex, iterationIndex);
          }
        },

        handleMute: (soundId) =>
          set(
            (state) => {
              const newMuted = new Set(state.mutedSounds);
              newMuted.has(soundId) ? newMuted.delete(soundId) : newMuted.add(soundId);
              return {
                mutedSounds: newMuted,
                soloedSound: state.soloedSound === soundId ? null : state.soloedSound,
              };
            },
            false,
            'audio/handleMute',
          ),

        handleSolo: (soundId) =>
          set(
            (state) => {
              const newMuted = new Set(state.mutedSounds);
              newMuted.delete(soundId);
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

          try {
            // The heavy period-search runs server-side on the CPU pool (same
            // queue pattern as trim_silence / SED) — the browser only polls.
            const { analysis_id } = await apiService.analyzeLoop(url);

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
            // The loop region IS the trim — DAW blocks, interval playback and the
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

        setIntervalJitter: (seconds) =>
          set({ intervalJitterSeconds: seconds }, false, 'audio/setIntervalJitter'),

        setTimelineDurationMs: (ms) =>
          set({ timelineDurationMs: ms }, false, 'audio/setTimelineDurationMs'),

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

        bakeOrchestrateSchedule: () => {
          // Show loading indicator immediately, then do computation in the next tick
          // so React can render the skeleton before the synchronous work blocks the thread.
          const bakeId = ++_pendingBakeId;
          set({ isBakingSchedule: true }, false, 'audio/bakeOrchestrateSchedule/start');

          setTimeout(() => {
          if (bakeId !== _pendingBakeId) return; // superseded by a newer bake call

          const { _soundConfigs, _generatedSounds, soundTrims, soundTimestamps, soundSchedulingModes, soundBufferDurations, soundIterationDurations } = get();

          if (!_soundConfigs.some(c => c.orchestrateMeta)) {
            if (bakeId === _pendingBakeId) set({ isBakingSchedule: false }, false, 'audio/bakeOrchestrateSchedule/noop');
            return;
          }

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
          };

          const entryMap = new Map<string, EntryInfo>();

          _soundConfigs.forEach((config, configIndex) => {
            const meta = config.orchestrateMeta;
            if (!meta) return;
            // Background sounds stay in interval mode — don't bake them into timestamps.
            // Normalize category to handle variations like "background sound" / "background_sound".
            const normCat = (config.category ?? '').toLowerCase().replace(/[\s_-]+/g, '_');
            if (normCat === 'background' || normCat === 'background_sound') return;

            const soundId = promptPrimary.get(configIndex)?.id ?? null;
            const generatedForConfig = _generatedSounds.filter((s: any) => s.prompt_index === configIndex);
            const numCopies = Math.max(1, config.seed_copies ?? 1);
            const variantDurations: (number | null)[] = new Array(numCopies).fill(null);

            generatedForConfig.forEach((s: any) => {
              // Use actual buffer duration as fallback when the API response omits duration
              const rawDur = s.duration ?? soundBufferDurations[s.id] ?? 0;
              if (rawDur <= 0) return;
              const copyIdx = parseSoundCopyIndex(s.id, s.copy_index);
              // Trim is keyed by the primary timeline sound id (sound card level)
              const trim = soundId ? soundTrims[soundId] : undefined;
              let effectiveDur = rawDur;
              if (trim) {
                const trimEnd = trim.end > 0 ? trim.end : rawDur;
                effectiveDur = Math.max(0, trimEnd - (trim.start ?? 0));
              }
              if (copyIdx >= 0 && copyIdx < variantDurations.length) {
                variantDurations[copyIdx] = effectiveDur;
              }
              if (variantDurations[0] === null) variantDurations[0] = effectiveDur;
            });

            // Theoretical fallback: when no real durations are available yet
            // (pre-generation bake), use the config's duration estimate so
            // parametric after()/alignEnd() links can still resolve.
            if (variantDurations[0] === null) {
              const theoretical = (config as any).duration ?? 5;
              for (let ci = 0; ci < variantDurations.length; ci++) {
                variantDurations[ci] = theoretical;
              }
            }

            const numIterations = meta.trigger.expression.length;
            entryMap.set(meta.entryId, {
              configIndex,
              soundId,
              meta,
              variantDurations,
              timestamps: new Array(numIterations).fill(null),
            });
          });

          // Only check durations for variant copies actually referenced by
          // meta.variants, and only for entries that have generated sounds.
          // Unreferenced copies and configs without sounds don't block the DFS.
          const blockingEntries: string[] = [];
          const allDurationsKnown = !Array.from(entryMap.entries())
            .filter(([, entry]) => entry.soundId !== null)
            .some(([eid, entry]) =>
              entry.meta.variants.some((variantOneBased, vIdx) => {
                const vi = variantOneBased - 1;
                const dur = vi >= 0 && vi < entry.variantDurations.length
                  ? entry.variantDurations[vi]
                  : entry.variantDurations[0];
                const blocked = dur === null;
                if (blocked) blockingEntries.push(`${eid}[iter${vIdx}→variant${variantOneBased}]`);
                return blocked;
              })
            );

          // Iterative resolution until convergence
          let changed = true;
          let passes = 0;
          const MAX_PASSES = 30;

          while (changed && passes++ < MAX_PASSES) {
            changed = false;

            entryMap.forEach((entry) => {
              const { meta, variantDurations, timestamps } = entry;
              const expressions = meta.trigger.expression;
              const delays = meta.trigger.delay ?? [];

              expressions.forEach((expr, i) => {
                if (timestamps[i] !== null) return; // already resolved

                // Absolute timestamp: "MM:SS" format
                const absMatch = expr.match(/^(\d+):(\d+(?:\.\d+)?)$/);
                if (absMatch) {
                  const mm = parseInt(absMatch[1], 10);
                  const ss = parseFloat(absMatch[2]);
                  timestamps[i] = mm * 60 + ss + (delays[i] ?? 0);
                  changed = true;
                  return;
                }

                // Parametric: after(ENTRYID_N) or alignEnd(ENTRYID_N)
                // Match last _N suffix (entry IDs can contain underscores)
                const paramMatch = expr.match(/^(after|alignEnd)\((.+)_(\d+)\)$/);
                if (!paramMatch) return;
                const [, op, refEntryId, iterStr] = paramMatch;
                const refIterIdx = parseInt(iterStr, 10) - 1; // 1-based → 0-based

                const refEntry = entryMap.get(refEntryId);
                if (!refEntry) return;

                const refStart = refEntry.timestamps[refIterIdx];
                if (refStart === null) return; // ref start not yet resolved

                // Determine which variant/copy plays at that ref iteration
                const refVariantIdx = (refEntry.meta.variants[refIterIdx] ?? 1) - 1;
                const refDuration = refEntry.variantDurations[refVariantIdx] ??
                  refEntry.variantDurations[0] ?? null;

                if (op === 'after') {
                  if (refDuration === null) return; // need ref's generated duration
                  timestamps[i] = refStart + refDuration + (delays[i] ?? 0);
                  changed = true;
                } else { // alignEnd: this sound ends when ref starts
                  // Need the effective duration of THIS sound's copy at this iteration
                  const thisVariantIdx = (meta.variants[i] ?? 1) - 1;
                  const thisDuration = entry.variantDurations[thisVariantIdx] ??
                    entry.variantDurations[0] ?? null;
                  if (thisDuration === null) return; // need THIS sound's generated duration
                  timestamps[i] = Math.max(0, refStart - thisDuration + (delays[i] ?? 0));
                  changed = true;
                }
              });
            });
          }

          // ── Cycle-breaking: DFS back-edge detection + theoretical forward-pass ──
          //
          // After MAX_PASSES some timestamps can still be null because their
          // dependency graph contains a cycle (A→B→C→A).  We handle this with:
          //
          //  Step 1 — Build a directed graph of (entryId, iterIdx) nodes.
          //  Step 2 — DFS with a colour-map (white/grey/black).  A grey→grey
          //           edge is a back-edge that closes a cycle.
          //  Step 3 — For each back-edge (u → v) cut the edge by assigning u
          //           a "theoretical anchor": treat v's timestamp as the resolved
          //           frontier (the furthest point any already-resolved,
          //           real-duration sound reaches — not v's stale nominal
          //           MM:SS guess) and propagate forward through the
          //           linearised chain until u gets a concrete time.
          //  Step 4 — Re-run the normal resolution loop with the new anchors.
          //           Only the minimum number of edges are broken; everything
          //           else remains fully parametric.

          type NodeKey = string; // `${entryId}:${iterIdx}`
          const nodeKey = (eid: string, ii: number): NodeKey => `${eid}:${ii}`;

          // Helper: get the outgoing dependency of a given slot (null = none / absolute)
          const getEdge = (eid: string, ii: number): { refEid: string; refIi: number } | null => {
            const e = entryMap.get(eid);
            if (!e) return null;
            const expr = e.meta.trigger.expression[ii];
            if (!expr) return null;
            const m = expr.match(/^(after|alignEnd)\((.+)_(\d+)\)$/);
            if (!m) return null;
            return { refEid: m[2], refIi: parseInt(m[3], 10) - 1 };
          };

          // Resolve a single slot given its ref's already-set timestamp (used in the
          // theoretical forward-pass after cycle-breaking).
          const resolveSlot = (entry: EntryInfo, i: number, refEntry: EntryInfo, refIi: number): number => {
            const expr = entry.meta.trigger.expression[i];
            const delays = entry.meta.trigger.delay ?? [];
            const m = expr.match(/^(after|alignEnd)\((.+)_(\d+)\)$/)!;
            const op = m[1];
            const refStart = refEntry.timestamps[refIi] ?? 0;
            const refVariantIdx = (refEntry.meta.variants[refIi] ?? 1) - 1;
            const refDur = refEntry.variantDurations[refVariantIdx] ??
              refEntry.variantDurations[0] ?? 5;
            if (op === 'after') {
              return Math.max(0, refStart + refDur + (delays[i] ?? 0));
            }
            const thisVariantIdx = (entry.meta.variants[i] ?? 1) - 1;
            const thisDur = entry.variantDurations[thisVariantIdx] ??
              entry.variantDurations[0] ?? 5;
            return Math.max(0, refStart - thisDur + (delays[i] ?? 0));
          };

          const parseMMSS = (s: string | undefined | null): number | null => {
            if (!s) return null;
            const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
            if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2]);
            const n = parseFloat(s);
            return isNaN(n) ? null : n;
          };

          // Gather all still-null slots
          const nullSlots: Array<NodeKey> = [];
          entryMap.forEach((entry, eid) => {
            entry.timestamps.forEach((t, i) => {
              if (t === null) nullSlots.push(nodeKey(eid, i));
            });
          });

          if (nullSlots.length > 0) {
            if (allDurationsKnown) {
            // ── DFS ──────────────────────────────────────────────────────────
            const colour = new Map<NodeKey, 0 | 1 | 2>(); // 0=white 1=grey 2=black
            // Set of back-edges to cut: key = node u that closes a cycle; value = the
            // ref-node v it was pointing to (the anchor for the theoretical pass).
            const backEdgeCuts = new Map<NodeKey, NodeKey>();

            const dfs = (key: NodeKey) => {
              colour.set(key, 1); // grey = in stack
              const [eid, iiStr] = key.split(':');
              const ii = parseInt(iiStr, 10);
              const edge = getEdge(eid, ii);
              if (edge) {
                const refKey = nodeKey(edge.refEid, edge.refIi);
                const c = colour.get(refKey) ?? 0;
                if (c === 1) {
                  // Back-edge found: cut this dependency (u=key depends on v=refKey)
                  backEdgeCuts.set(key, refKey);
                } else if (c === 0) {
                  dfs(refKey);
                }
              }
              colour.set(key, 2); // black = done
            };

            for (const key of nullSlots) {
              if ((colour.get(key) ?? 0) === 0) dfs(key);
            }

            if (backEdgeCuts.size > 0) {
              // Furthest point any already-resolved (real-duration) sound reaches —
              // i.e. the actual "now" of the timeline at this point in baking.
              // Recomputed per-cut since earlier cuts in this same forEach may have
              // pushed the frontier further out.
              const getResolvedFrontier = (): number => {
                let frontier = 0;
                entryMap.forEach((e) => {
                  e.timestamps.forEach((t, idx) => {
                    if (t === null) return;
                    const variantIdx = (e.meta.variants[idx] ?? 1) - 1;
                    const dur = e.variantDurations[variantIdx] ?? e.variantDurations[0] ?? 0;
                    frontier = Math.max(frontier, t + (dur as number));
                  });
                });
                return frontier;
              };

              // ── Theoretical forward-pass ────────────────────────────────────
              // For each cut back-edge (u → v), set v's anchor to where the
              // timeline has actually progressed to (see getResolvedFrontier above),
              // then re-run up to MAX_PASSES so all nodes that were blocked by the
              // cycle can now resolve through the cut anchor.
              backEdgeCuts.forEach((_anchorKey, cutKey) => {
                const [eid, iiStr] = cutKey.split(':');
                const ii = parseInt(iiStr, 10);
                const entry = entryMap.get(eid);
                if (!entry || entry.timestamps[ii] !== null) return;

                // The "theoretical" anchor: walk the chain from the back-edge
                // target (anchorKey / refNode) assuming it starts at the resolved
                // frontier, propagate forward through the now-linear subgraph to
                // produce a concrete starting time for the cut node.
                const [anchorEid, anchorIiStr] = _anchorKey.split(':');
                const anchorIi = parseInt(anchorIiStr, 10);
                const anchorEntry = entryMap.get(anchorEid);

                // Prefer the anchor's own resolved (real-duration) timestamp. If it's
                // also stuck in the cycle (still null), do NOT fall back to the
                // scenario's original nominal MM:SS guess (meta.timestamps) — that
                // value was authored assuming theoretical/placeholder durations and
                // can be far behind (or ahead of) where the timeline has actually
                // progressed once real durations are known, which is exactly what
                // caused dependent sounds/dialogue to bunch up or overlap. Instead,
                // anchor to the resolved frontier — the furthest any real-duration
                // sound has already reached — so the cut node picks up right where
                // the rest of the schedule really is. Only fall back to the nominal
                // hint as an absolute last resort, when nothing has resolved yet.
                const resolvedFrontier = getResolvedFrontier();
                const anchorStart = anchorEntry?.timestamps[anchorIi]
                  ?? (resolvedFrontier > 0
                    ? resolvedFrontier
                    : parseMMSS(anchorEntry?.meta.timestamps?.[anchorIi]))
                  ?? 0;

                // Forward-pass: walk from anchorKey → … → cutKey and accumulate time
                // (BFS along the FORWARD direction of the back-edge's target chain)
                const tempTs = new Map<NodeKey, number>();
                tempTs.set(_anchorKey, anchorStart);

                // Propagate through null-slots until we can compute the cut node
                let propagated = true;
                for (let p = 0; p < 20 && propagated; p++) {
                  propagated = false;
                  nullSlots.forEach((k) => {
                    if (tempTs.has(k)) return; // already set
                    const [kEid, kIiStr] = k.split(':');
                    const kIi = parseInt(kIiStr, 10);
                    const kEntry = entryMap.get(kEid);
                    if (!kEntry) return;
                    const kEdge = getEdge(kEid, kIi);
                    if (!kEdge) return;
                    const kRefKey = nodeKey(kEdge.refEid, kEdge.refIi);
                    // Use tempTs if available, else real resolved timestamp, else skip
                    const refTime = tempTs.get(kRefKey) ??
                      entryMap.get(kEdge.refEid)?.timestamps[kEdge.refIi] ??
                      null;
                    if (refTime === null) return;
                    const refEntryFwd = entryMap.get(kEdge.refEid)!;
                    // Temporarily set refEntry timestamp so resolveSlot can read it
                    const savedRef = refEntryFwd.timestamps[kEdge.refIi];
                    refEntryFwd.timestamps[kEdge.refIi] = refTime;
                    tempTs.set(k, resolveSlot(kEntry, kIi, refEntryFwd, kEdge.refIi));
                    refEntryFwd.timestamps[kEdge.refIi] = savedRef;
                    propagated = true;
                  });
                }

                // Apply the theoretical anchor for the cut node
                const theoretical = tempTs.get(cutKey);
                if (theoretical !== undefined) {
                  entry.timestamps[ii] = theoretical;
                } else {
                  // Absolute last resort: place after last resolved content
                  let maxT = 0;
                  entryMap.forEach(({ timestamps: ts }) => {
                    ts.forEach(t => { if (t !== null) maxT = Math.max(maxT, t); });
                  });
                  entry.timestamps[ii] = maxT + 5;
                }
              });

              // Re-run normal resolution so nodes downstream of the broken cycle
              // can now propagate from the newly-set anchor.
              let postChanged = true;
              let postPass = 0;
              while (postChanged && postPass++ < MAX_PASSES) {
                postChanged = false;
                entryMap.forEach((entry) => {
                  const { meta, variantDurations, timestamps } = entry;
                  meta.trigger.expression.forEach((expr, i) => {
                    if (timestamps[i] !== null) return;
                    const m = expr?.match(/^(after|alignEnd)\((.+)_(\d+)\)$/);
                    if (!m) return;
                    const [, op, refEid, iterStr] = m;
                    const refIi = parseInt(iterStr, 10) - 1;
                    const refEntry = entryMap.get(refEid);
                    if (!refEntry) return;
                    const refStart = refEntry.timestamps[refIi];
                    if (refStart === null) return;
                    const refVariantIdx = (refEntry.meta.variants[refIi] ?? 1) - 1;
                    const refDur = refEntry.variantDurations[refVariantIdx] ??
                      refEntry.variantDurations[0] ?? null;
                    const delays = meta.trigger.delay ?? [];
                    if (op === 'after') {
                      if (refDur === null) return;
                      timestamps[i] = refStart + refDur + (delays[i] ?? 0);
                    } else {
                      const thisVariantIdx = (meta.variants[i] ?? 1) - 1;
                      const thisDur = variantDurations[thisVariantIdx] ??
                        variantDurations[0] ?? null;
                      if (thisDur === null) return;
                      timestamps[i] = Math.max(0, refStart - thisDur + (delays[i] ?? 0));
                    }
                    postChanged = true;
                  });
                });
              }

              // Log which back-edges were cut so prompt engineers can fix the issue
              const cutList = [...backEdgeCuts.entries()].map(
                ([u, v]) => `${u}→${v}`,
              ).join(', ');
              console.warn(
                `[bakeOrchestrateSchedule] Circular dependencies detected and broken via DFS back-edge cut: ${cutList}. ` +
                `Cut nodes were assigned theoretical anchors; all downstream nodes re-resolved normally.`,
              );
            }
            } // allDurationsKnown

            // Safety net: any slot still null after all passes means the parametric
            // trigger approach failed even after cycle-breaking. Fall back, per sound
            // and per variant/track iteration, to the original foley/speech timestamp
            // passed through on the orchestrate entry. Only when that is also missing
            // do we place the slot after the last resolved content.
            let fallbackT = 0;
            entryMap.forEach(({ timestamps: ts }) => {
              ts.forEach(t => { if (t !== null) fallbackT = Math.max(fallbackT, t); });
            });
            nullSlots.forEach((key) => {
              const [eid, iiStr] = key.split(':');
              const ii = parseInt(iiStr, 10);
              const entry = entryMap.get(eid);
              if (!entry || entry.timestamps[ii] !== null) return;
              // Priority 0 — existing manually-dragged timestamp preserved in soundTimestamps
              if (entry.soundId && soundTimestamps[entry.soundId]?.[ii] != null) {
                const existing = soundTimestamps[entry.soundId][ii];
                if (existing < 99999 && existing >= 0) {
                  entry.timestamps[ii] = existing;
                  fallbackT = Math.max(fallbackT, existing);
                  return;
                }
              }
              // Fallback 1 — original timestamp for this iteration (MM:SS → seconds).
              const fromTs = parseMMSS(entry.meta.timestamps?.[ii]);
              if (fromTs !== null) {
                entry.timestamps[ii] = fromTs;
                fallbackT = Math.max(fallbackT, fromTs);
                return;
              }
              // Fallback 2 — place after the last resolved content.
              fallbackT += 5;
              entry.timestamps[ii] = fallbackT;
            });
          }

          // ── Post-bake validation ──────────────────────────────────────────────
          // Verify parametric links are respected, detect broken links (from DFS
          // cycle-breaking or safety-net fallback), and fix overlapping iterations
          // per track by pushing later iterations right recursively.

          const getIterDuration = (entry: EntryInfo, iterIdx: number): number => {
            const variantIdx = (entry.meta.variants[iterIdx] ?? 1) - 1;
            return (entry.variantDurations[variantIdx] ?? entry.variantDurations[0] ?? 0) as number;
          };

          // (a) Check that every param link still produces the expected timestamp.
          // Any significant deviation means DFS or safety-net overrode the formula.
          const brokenLinks: string[] = [];
          entryMap.forEach((entry, eid) => {
            const { meta, timestamps } = entry;
            const delays = meta.trigger.delay ?? [];
            meta.trigger.expression.forEach((expr, i) => {
              if (!expr || timestamps[i] === null) return;
              const paramMatch = expr.match(/^(after|alignEnd)\((.+)_(\d+)\)$/);
              if (!paramMatch) return;
              const [, op, refEntryId, iterStr] = paramMatch;
              const refIterIdx = parseInt(iterStr, 10) - 1;
              const refEntry = entryMap.get(refEntryId);
              if (!refEntry || refEntry.timestamps[refIterIdx] === null) return;

              const refStart = refEntry.timestamps[refIterIdx]!;
              const refDur = getIterDuration(refEntry, refIterIdx);
              const thisDur = getIterDuration(entry, i);
              const delay = delays[i] ?? 0;

              let expected: number;
              if (op === 'after') {
                expected = refStart + refDur + delay;
              } else {
                expected = Math.max(0, refStart - thisDur + delay);
              }

              if (Math.abs(timestamps[i]! - expected) > 0.05) {
                brokenLinks.push(
                  `${op === 'after' ? 'after ' : 'before'} | ${eid}[${i}] actual=${timestamps[i]!.toFixed(1)}s expected=${expected.toFixed(1)}s (ref ${refEntryId}[${refIterIdx}] @ ${refStart.toFixed(1)}s)`,
                );
              }
            });
          });
          if (brokenLinks.length > 0) {
            console.warn(
              `[bakeOrchestrateSchedule] ${brokenLinks.length} broken parametric link(s) — DFS cycle-breaking or safety-net overrode the formula:\n  ` +
              brokenLinks.join('\n  '),
            );
          }

          // (b) Fix overlapping iterations per track (recursively).
          // DFS anchors and safety-net fallback can place iterations too close
          // together. Walk each track's sorted iterations and push later ones
          // right when they start before the previous one ends.
          {
            let overlapPass = 0;
            let overlapsFixed = true;
            while (overlapsFixed && overlapPass++ < 100) {
              overlapsFixed = false;
              entryMap.forEach((entry) => {
                const { timestamps, meta } = entry;
                const items = timestamps
                  .map((t, i) => ({
                    idx: i,
                    start: t,
                    dur: getIterDuration(entry, i),
                  }))
                  .filter(it => it.start !== null && it.dur > 0)
                  .sort((a, b) => a.start! - b.start!);

                for (let i = 1; i < items.length; i++) {
                  const prev = items[i - 1];
                  const curr = items[i];
                  const prevEnd = prev.start! + prev.dur;
                  if (prevEnd > curr.start! + 0.001) {
                    entry.timestamps[curr.idx] = parseFloat(prevEnd.toFixed(3));
                    overlapsFixed = true;
                  }
                }
              });
            }
          }

          // ── Final summary: entryId → resolved timestamps + durations ──────────
          {
            const summary: Record<string, { timestamps: (number | null)[]; variantDurations: (number | null)[] }> = {};
            entryMap.forEach((entry, eid) => {
              summary[eid] = { timestamps: entry.timestamps, variantDurations: entry.variantDurations };
            });
          }

          // Apply resolved timestamps — use actual generated sound ID as key.
          const UNRESOLVED = 999999; // >> any real timeline duration (seconds)
          const newTimestamps = { ...soundTimestamps };
          const newModes = { ...soundSchedulingModes };
          let anyChange = false;
          let maxResolvedSec = 0; // track furthest resolved timestamp for auto-extending

          entryMap.forEach(({ soundId, timestamps, meta, variantDurations }) => {
            if (!soundId) return;

            const isIntervalType = meta.trigger.type === 'interval';
            if (isIntervalType && !timestamps.some(t => t !== null)) return;

            // Build final timestamps: use resolved parametric values for non-empty
            // expressions; for empty expressions (cleared by manual drag), preserve
            // the existing concrete timestamp so dragged positions survive save/load.
            const finalTs = timestamps.map((t, i) => {
              if (t !== null) return parseFloat(t.toFixed(3));
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
            if (newModes[soundId] !== 'timestamps') {
              newModes[soundId] = 'timestamps';
              anyChange = true;
            }
          });

          // Auto-extend timeline so that all resolved content is visible.
          // Round up to the nearest 30s with a 10s margin.
          const currentDurationMs = get().timelineDurationMs;
          const requiredMs = Math.ceil((maxResolvedSec + 10) / 30) * 30 * 1000;
          const newDurationMs = Math.min(
            requiredMs > currentDurationMs ? requiredMs : currentDurationMs,
            AUDIO_TIMELINE.MAX_DURATION_MS,
          );

          // Compute per-iteration durations (ms) so each DAW block shows its
          // actual variant length rather than the primary copy's length.
          const newIterDurations = { ...soundIterationDurations };
          entryMap.forEach(({ soundId, timestamps, meta, variantDurations }) => {
            if (!soundId) return;
            const UNRESOLVED_CHECK = 999999;
            const iterDursMs = timestamps.map((t, i) => {
              if (t === null || t >= UNRESOLVED_CHECK) return 0;
              const variantIdx = (meta.variants[i] ?? 1) - 1;
              const dur = variantDurations[variantIdx] ?? variantDurations[0] ?? 0;
              return (dur as number) * 1000;
            });
            newIterDurations[soundId] = iterDursMs;
          });

          // Check whether iteration durations changed separately from timestamps/modes
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
              soundSchedulingModes: newModes,
              soundIterationDurations: newIterDurations,
              timelineDurationMs: newDurationMs,
              isBakingSchedule: false,
              isDeferredCycleBakePending: !allDurationsKnown,
            }, false, 'audio/bakeOrchestrateSchedule');
          } else {
            // Timestamps / modes unchanged but still clear the loading flag.
            // Always write newIterDurations so UI picks up correct variant widths.
            set({ isBakingSchedule: false, soundIterationDurations: newIterDurations, isDeferredCycleBakePending: !allDurationsKnown }, false, 'audio/bakeOrchestrateSchedule/done');
          }
          }, 0); // end of setTimeout
        },

        handlePreviewPlayPause: (soundId) => {
          const { individualSoundStates } = get();
          if (Object.values(individualSoundStates).some((s) => s === 'playing')) {
            const stopped: Record<string, SoundState> = {};
            Object.keys(individualSoundStates).forEach((id) => { stopped[id] = 'stopped'; });
            set({ individualSoundStates: stopped }, false, 'audio/previewStopTimeline');
          }
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : soundId,
            }),
            false,
            'audio/handlePreviewPlayPause',
          );
        },

        handlePreviewStop: (soundId) =>
          set(
            (state) => ({
              previewingSoundId:
                state.previewingSoundId === soundId ? null : state.previewingSoundId,
            }),
            false,
            'audio/handlePreviewStop',
          ),

        stopSoundcardPreview: () =>
          set({ previewingSoundId: null }, false, 'audio/stopSoundcardPreview'),

        playAll: () => {
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
              return { individualSoundStates: newStates };
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
            { individualSoundStates: {}, soundVolumes: {}, soundIntervals: {} },
            false,
            'audio/forceStopAll',
          ),

        restoreVolumeAndIntervals: (volumes, intervals) =>
          set(
            { soundVolumes: volumes, soundIntervals: intervals },
            false,
            'audio/restoreVolumeAndIntervals',
          ),

        restoreSchedulingModes: (modes, timestamps) =>
          set(
            { soundSchedulingModes: modes, soundTimestamps: timestamps },
            false,
            'audio/restoreSchedulingModes',
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
      }),
      { name: 'AudioControlsStore' },
    ),
    {
      // Only record history for user-facing config (not play state / internal)
      partialize: audioControlsPartialize,
      equality: (past, current) =>
        JSON.stringify(past.soundVolumes) === JSON.stringify(current.soundVolumes) &&
        JSON.stringify(past.soundIntervals) === JSON.stringify(current.soundIntervals) &&
        JSON.stringify(past.soundTrims) === JSON.stringify(current.soundTrims) &&
        JSON.stringify(past.selectedVariants) === JSON.stringify(current.selectedVariants) &&
        past.mutedSounds.size === current.mutedSounds.size &&
        [...past.mutedSounds].every((id) => current.mutedSounds.has(id)) &&
        past.soloedSound === current.soloedSound &&
        past.intervalJitterSeconds === current.intervalJitterSeconds &&
        past.timelineDurationMs === current.timelineDurationMs &&
        past.globalBaseDbfs === current.globalBaseDbfs &&
        JSON.stringify(past.soundSchedulingModes) === JSON.stringify(current.soundSchedulingModes) &&
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

/**
 * Track-level mute/solo resolution — the ONE place that decides what is silent.
 *
 * Storage (audioControlsStore.mutedSounds / soloedSounds) holds the user's
 * intent as sound ids. Everything that shows or plays mute state (DAW, sound
 * cards, sound spheres + lights, audio engine, exporter, simulation source
 * counts) derives its answer from `computeMuteSolo`, so they can never disagree.
 *
 * Rules:
 * - A track is a `prompt_index` group: every variant (and every derived
 *   `_iter_` entity copy) of a card shares its track's state. A track is muted
 *   / soloed when ANY of its sound ids is in the set, so a variant generated
 *   after the click inherits the track's state.
 * - Solo is scoped to the sounds passed in (the active sound scene): a track
 *   soloed in another scene never silences this one.
 * - While any in-scope track is soloed, only soloed tracks are audible;
 *   otherwise muted tracks are silent.
 * - Pending placeholders (not generated yet) are never silenced.
 */

export interface MuteSoloSound {
  id: string;
  prompt_index?: number | null;
  isPending?: boolean;
}

/** Derived mute/solo state for one scope (the active sound scene). */
export interface MuteSoloState {
  /** Track key of every in-scope sound id. */
  trackOf: ReadonlyMap<string, string>;
  mutedTracks: ReadonlySet<string>;
  soloedTracks: ReadonlySet<string>;
  silencedTracks: ReadonlySet<string>;
  /** Every in-scope sound id that must not be heard. */
  silencedIds: ReadonlySet<string>;
  /** Prompt indices whose track is silenced (spheres are keyed by prompt). */
  silencedPrompts: ReadonlySet<number>;
  /** True when at least one in-scope track is soloed. */
  soloActive: boolean;
}

/** Track key of a sound: its prompt_index group, or the sound itself. */
export function trackKeyOf(sound: MuteSoloSound): string {
  return sound.prompt_index != null ? `p:${sound.prompt_index}` : `id:${sound.id}`;
}

export function computeMuteSolo(
  scope: ReadonlyArray<MuteSoloSound>,
  mutedSounds: ReadonlySet<string>,
  soloedSounds: ReadonlySet<string>,
): MuteSoloState {
  const trackOf = new Map<string, string>();
  const mutedTracks = new Set<string>();
  const soloedTracks = new Set<string>();
  const generatedTracks = new Set<string>();

  for (const sound of scope) {
    const key = trackKeyOf(sound);
    trackOf.set(sound.id, key);
    if (sound.isPending) continue;
    generatedTracks.add(key);
    if (mutedSounds.has(sound.id)) mutedTracks.add(key);
    if (soloedSounds.has(sound.id)) soloedTracks.add(key);
  }

  const soloActive = soloedTracks.size > 0;
  const silencedTracks = new Set<string>();
  generatedTracks.forEach((key) => {
    if (soloActive ? !soloedTracks.has(key) : mutedTracks.has(key)) silencedTracks.add(key);
  });

  const silencedIds = new Set<string>();
  const silencedPrompts = new Set<number>();
  for (const sound of scope) {
    if (sound.isPending || !silencedTracks.has(trackOf.get(sound.id) ?? '')) continue;
    silencedIds.add(sound.id);
    if (sound.prompt_index != null) silencedPrompts.add(sound.prompt_index);
  }

  return { trackOf, mutedTracks, soloedTracks, silencedTracks, silencedIds, silencedPrompts, soloActive };
}

/** Whether the track of `soundId` is muted (DAW "M" button state). */
export function isTrackMuted(state: MuteSoloState, soundId: string): boolean {
  const key = state.trackOf.get(soundId);
  return key !== undefined && state.mutedTracks.has(key);
}

/** Whether the track of `soundId` is soloed (DAW "S" button state). */
export function isTrackSoloed(state: MuteSoloState, soundId: string): boolean {
  const key = state.trackOf.get(soundId);
  return key !== undefined && state.soloedTracks.has(key);
}

interface SceneCard {
  parentUsageOriginalIndex?: number | null;
}

/**
 * Whether a sound card belongs to the active sound scene (every card when no
 * scene is active). page.tsx uses the same predicate to build the 3D/audio
 * soundscape data, so the UI and the audio engine share one scope.
 */
export function isCardInActiveScene(
  card: SceneCard | undefined,
  activeSoundParentIndex: number | null | undefined,
): boolean {
  if (activeSoundParentIndex === null || activeSoundParentIndex === undefined) return true;
  return card?.parentUsageOriginalIndex === activeSoundParentIndex;
}

/** Card index of a prompt index (speech-line TTS encodes `cardIndex * 10000 + line`). */
export function cardIndexOfPrompt(promptIndex: number): number {
  return promptIndex >= 10000 ? Math.floor(promptIndex / 10000) : promptIndex;
}

/**
 * Audible sounds of the active sound scene — what a simulation should use as
 * sources (silenced tracks excluded, solo scoped to the scene).
 */
export function audibleSoundsInScene<T extends MuteSoloSound>(
  sounds: ReadonlyArray<T>,
  cards: ReadonlyArray<SceneCard>,
  activeSoundParentIndex: number | null | undefined,
  mutedSounds: ReadonlySet<string>,
  soloedSounds: ReadonlySet<string>,
): T[] {
  const scene = soundsInActiveScene(sounds, cards, activeSoundParentIndex);
  const { silencedIds } = computeMuteSolo(scene, mutedSounds, soloedSounds);
  return scene.filter((s) => !silencedIds.has(s.id));
}

/** Sounds whose card belongs to the active sound scene. */
export function soundsInActiveScene<T extends MuteSoloSound>(
  sounds: ReadonlyArray<T>,
  cards: ReadonlyArray<SceneCard>,
  activeSoundParentIndex: number | null | undefined,
): T[] {
  if (activeSoundParentIndex === null || activeSoundParentIndex === undefined) return [...sounds];
  return sounds.filter(
    (s) => s.prompt_index != null && isCardInActiveScene(cards[cardIndexOfPrompt(s.prompt_index)], activeSoundParentIndex),
  );
}

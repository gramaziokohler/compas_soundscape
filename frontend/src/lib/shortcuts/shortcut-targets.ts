/**
 * Shortcut target registry.
 *
 * The global keyboard handler (hooks/useGlobalShortcuts.ts) cannot reach the
 * transport or the card preview directly — those live inside SpeckleScene and
 * SoundGenerationSection. Owners register small action objects here instead;
 * the handler looks them up at key-press time. Plain module state: registering
 * never triggers a React render.
 */

export interface PlaybackTarget {
  /** True when this target has something to play right now. */
  canToggle: () => boolean;
  toggle: () => void;
  /** Stop + rewind. */
  stop?: () => void;
  /** Seek to the start without changing play state. */
  rewind?: () => void;
}

export interface SoundCardsTarget {
  /** Expand the next (+1) / previous (-1) card. */
  step: (direction: 1 | -1) => void;
  /** Collapse the expanded card. Returns false when nothing was expanded. */
  collapse: () => boolean;
  /** Remove the expanded card. Returns false when nothing was expanded. */
  removeExpanded: () => boolean;
  /** Zoom the camera to the expanded card's sphere. Returns false when nothing was expanded. */
  zoomToExpanded: () => boolean;
}

export interface ViewerTarget {
  frameSelection: () => void;
}

interface TargetMap {
  cardPreview: PlaybackTarget;
  timeline: PlaybackTarget;
  soundCards: SoundCardsTarget;
  viewer: ViewerTarget;
}

export type TargetSlot = keyof TargetMap;

const targets: { [K in TargetSlot]?: TargetMap[K] } = {};

/** Register a target; returns an unregister fn that only clears its own entry. */
export function registerShortcutTarget<K extends TargetSlot>(slot: K, target: TargetMap[K]): () => void {
  targets[slot] = target;
  return () => {
    if (targets[slot] === target) delete targets[slot];
  };
}

export function getShortcutTarget<K extends TargetSlot>(slot: K): TargetMap[K] | undefined {
  return targets[slot];
}

export type PlaybackSlot = 'cardPreview' | 'timeline';

/** The playback surface the user interacted with last (null = no preference). */
let preferredPlayback: PlaybackSlot | null = null;

/** Called on pointer-down inside the sound cards / the DAW timeline. */
export function setPreferredPlaybackTarget(slot: PlaybackSlot): void {
  preferredPlayback = slot;
}

/** Drop the preference only if it still points at `slot` (e.g. the DAW dock closed). */
export function clearPreferredPlaybackTarget(slot: PlaybackSlot): void {
  if (preferredPlayback === slot) preferredPlayback = null;
}

/**
 * Space resolution: the surface clicked last (sound cards or timeline) wins
 * when it can play. Otherwise the expanded card's preview when it has audio,
 * then the DAW timeline. Returns undefined when nothing can play.
 */
export function resolvePlaybackTarget(): PlaybackTarget | undefined {
  const preferred = preferredPlayback ? targets[preferredPlayback] : undefined;
  if (preferred?.canToggle()) return preferred;
  const card = targets.cardPreview;
  if (card?.canToggle()) return card;
  const timeline = targets.timeline;
  if (timeline?.canToggle()) return timeline;
  return undefined;
}

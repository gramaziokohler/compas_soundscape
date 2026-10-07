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

/**
 * Space resolution: the expanded card's preview wins when it has audio,
 * otherwise the DAW timeline. Returns undefined when nothing can play.
 */
export function resolvePlaybackTarget(): PlaybackTarget | undefined {
  const card = targets.cardPreview;
  if (card?.canToggle()) return card;
  const timeline = targets.timeline;
  if (timeline?.canToggle()) return timeline;
  return undefined;
}

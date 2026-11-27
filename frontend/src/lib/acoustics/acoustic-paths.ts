/**
 * Pure helpers of the sound-path view (no three.js, no store): which stored paths belong to one
 * source-listener pair (the hovered / selected IR).
 */

import type { AcousticPathsPayload, DiffractedPath, ReflectionPath } from '@/types/acousticPaths';

export interface PairPaths {
  reflections: ReflectionPath[];
  diffracted: DiffractedPath[];
}

const NO_PATHS: PairPaths = { reflections: [], diffracted: [] };

/** The reflection and diffracted paths of one pair (ids as in the card's IR mapping), arrival order. */
export function pairPaths(payload: AcousticPathsPayload | null, sourceId: string, receiverId: string): PairPaths {
  if (!payload) return NO_PATHS;
  const s = payload.sources.findIndex((x) => x.id === sourceId);
  const r = payload.receivers.findIndex((x) => x.id === receiverId);
  if (s < 0 || r < 0) return NO_PATHS;
  const ofPair = (p: { s: number; r: number }) => p.s === s && p.r === r;
  return {
    reflections: (payload.reflections?.paths ?? []).filter(ofPair),
    diffracted: (payload.diffraction?.paths ?? []).filter(ofPair),
  };
}

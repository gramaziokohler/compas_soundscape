/**
 * Live world position of a sound card's source in the scene.
 *
 * A sound sphere represents the whole card (all variants share one sphere keyed
 * `prompt_<index>`), so its mesh position is the truth: resolved and updated by
 * drags. `getSpherePosition(variantId)` goes stale after a drag when a
 * non-first variant is selected. Large linked objects have no sphere but a
 * surface marker. Falls back to the sound's stored position; `[0,0,0]` means unplaced.
 *
 * Usage:
 * ```ts
 * const pos = getLiveSoundPosition(coordinator.getSoundSphereManager(), index, soundscapeData);
 * if (pos) coordinator.zoomToPosition(pos);
 * ```
 */
import * as THREE from 'three';
import type { SoundSphereManager } from './sound-sphere-manager';
import type { SoundEvent } from '@/types';

const isPlaced = (p: THREE.Vector3): boolean => p.x !== 0 || p.y !== 0 || p.z !== 0;

export function getLiveSoundPosition(
  manager: SoundSphereManager | null | undefined,
  cardIndex: number,
  soundscapeData: SoundEvent[] | null | undefined,
): THREE.Vector3 | null {
  const promptKey = `prompt_${cardIndex}`;
  const object = manager?.findSphereByPromptKey(promptKey)
    ?? manager?.getMarkerObjects().find((m) => m.userData.promptKey === promptKey);
  if (object) {
    const pos = object.getWorldPosition(new THREE.Vector3());
    if (isPlaced(pos)) return pos;
  }
  const sound = soundscapeData?.find((s) => (s.prompt_index ?? 0) === cardIndex);
  const stored = sound?.position;
  if (stored) {
    const pos = new THREE.Vector3(...stored);
    if (isPlaced(pos)) return pos;
  }
  return null;
}

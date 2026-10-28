/**
 * Pure helpers for assigning a source to one or more Resonance (ShoeBox) rooms.
 *
 * Shared by live playback (ResonanceMode) and offline WAV export.
 */

import { RESONANCE_AUDIO } from '@/utils/constants';
import type { ResonanceRoomMaterial } from '@/types/audio';

export interface RoomAssignmentInput {
  id: string;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** Card order — lower wins ties of equal volume. */
  order: number;
}

export interface RoomSend {
  roomId: string;
  sendGain: number;
  directGain: number;
  isPrimary: boolean;
}

export function roomVolume(bounds: { min: [number, number, number]; max: [number, number, number] }): number {
  return Math.max(0,
    (bounds.max[0] - bounds.min[0])
    * (bounds.max[1] - bounds.min[1])
    * (bounds.max[2] - bounds.min[2]),
  );
}

export function pointInAabb(
  position: { x: number; y: number; z: number },
  bounds: { min: [number, number, number]; max: [number, number, number] },
): boolean {
  return position.x >= bounds.min[0] && position.x <= bounds.max[0]
    && position.y >= bounds.min[1] && position.y <= bounds.max[1]
    && position.z >= bounds.min[2] && position.z <= bounds.max[2];
}

/** Euclidean distance from a point to an AABB. Zero when inside. */
export function distanceToAabb(
  position: { x: number; y: number; z: number },
  bounds: { min: [number, number, number]; max: [number, number, number] },
): number {
  const dx = Math.max(0, bounds.min[0] - position.x, position.x - bounds.max[0]);
  const dy = Math.max(0, bounds.min[1] - position.y, position.y - bounds.max[1]);
  const dz = Math.max(0, bounds.min[2] - position.z, position.z - bounds.max[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function aabbsOverlap(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] },
): boolean {
  return a.min[0] <= b.max[0] && a.max[0] >= b.min[0]
    && a.min[1] <= b.max[1] && a.max[1] >= b.min[1]
    && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];
}

export function clampRoomBounds(
  bounds: { min: [number, number, number]; max: [number, number, number] },
): { min: [number, number, number]; max: [number, number, number] } {
  const minExtent = RESONANCE_AUDIO.MIN_ROOM_EXTENT;
  const min: [number, number, number] = [...bounds.min];
  const max: [number, number, number] = [...bounds.max];
  for (let i = 0; i < 3; i++) {
    if (min[i] > max[i]) {
      const t = min[i];
      min[i] = max[i];
      max[i] = t;
    }
    const span = max[i] - min[i];
    if (span < minExtent) {
      const c = (min[i] + max[i]) / 2;
      min[i] = c - minExtent / 2;
      max[i] = c + minExtent / 2;
    }
  }
  return { min, max };
}

function compareRooms(a: RoomAssignmentInput, b: RoomAssignmentInput): number {
  const volDiff = roomVolume(a.bounds) - roomVolume(b.bounds);
  if (volDiff !== 0) return volDiff;
  return a.order - b.order;
}

/**
 * Assign a source (or the listener, for global beds) to Resonance rooms.
 *
 * - Inside one or more boxes: every containing room gets sendGain = 1/sqrt(N).
 *   The smallest (then earliest card) is primary and owns the dry path
 *   (directGain = sqrt(N)); the others get directGain = 0.
 * - Inside none: the nearest box is the only room (N = 1). The library fades
 *   its reflections as the source leaves the box, so the sound tends to dry.
 */
export function assignSourceRooms(
  position: { x: number; y: number; z: number },
  rooms: RoomAssignmentInput[],
): RoomSend[] {
  if (rooms.length === 0) return [];

  const containing = rooms.filter((r) => pointInAabb(position, r.bounds));
  const chosen = containing.length > 0
    ? containing
    : [rooms.reduce((best, r) => {
        const dBest = distanceToAabb(position, best.bounds);
        const dR = distanceToAabb(position, r.bounds);
        if (dR < dBest) return r;
        if (dR > dBest) return best;
        return compareRooms(r, best) < 0 ? r : best;
      })];

  const sorted = [...chosen].sort(compareRooms);
  const n = sorted.length;
  const sendGain = 1 / Math.sqrt(n);
  const primaryDirect = Math.sqrt(n);

  return sorted.map((room, i) => ({
    roomId: room.id,
    sendGain,
    directGain: i === 0 ? primaryDirect : 0,
    isPrimary: i === 0,
  }));
}

/**
 * Re-route a Resonance Source's private encoder through `directGain` so overlapping
 * rooms can share one dry path. Private API of resonance-audio — see sound-rendering.mdc.
 * Returns false if the library shape changed and the re-route could not be applied.
 */
export function isolateResonanceDirectPath(
  source: { _encoder?: { output: AudioNode } },
  listenerInput: AudioNode,
  directGain: GainNode,
): boolean {
  const encoderOut = source._encoder?.output;
  if (!encoderOut) return false;
  try {
    encoderOut.disconnect(listenerInput);
    encoderOut.connect(directGain);
    directGain.connect(listenerInput);
    return true;
  } catch {
    try {
      encoderOut.disconnect();
      encoderOut.connect(directGain);
      directGain.connect(listenerInput);
      return true;
    } catch {
      return false;
    }
  }
}

export function defaultResonanceMaterials(): ResonanceRoomMaterial {
  return { ...RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS };
}

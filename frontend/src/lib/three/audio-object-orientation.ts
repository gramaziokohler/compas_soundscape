/**
 * Audio object orientation adapter
 *
 * Maps a gizmo-selected scene object to the store field holding its orientation,
 * so the gumball rotation arcs can read and write it:
 * - listener (customObjectType 'receiver') → receiversStore yaw / pitch / roll
 * - directional sound (customObjectType 'sound', non-omni directivity) →
 *   soundscapeStore directivity yaw / pitch / roll
 * Omnidirectional sounds have no meaningful orientation → null (no arcs).
 */

import type * as THREE from 'three';
import { useReceiversStore, useSoundscapeStore } from '@/store';
import { isOmniDirectivity } from '@/utils/positionKey';
import type { SoundDirectivity } from '@/types/directivity';
import type { YawPitchRoll } from './orientation';

export interface OrientationTarget {
  get(): YawPitchRoll;
  set(next: YawPitchRoll): void;
}

function receiverTarget(receiverId: string): OrientationTarget | null {
  const exists = useReceiversStore.getState().receivers.some((r) => r.id === receiverId);
  if (!exists) return null;
  return {
    get: () => {
      const r = useReceiversStore.getState().receivers.find((x) => x.id === receiverId);
      return { yaw: r?.yaw ?? 0, pitch: r?.pitch ?? 0, roll: r?.roll ?? 0 };
    },
    set: ({ yaw, pitch, roll }) =>
      useReceiversStore.getState().updateReceiverOrientation(receiverId, yaw, pitch, roll),
  };
}

function findDirectivity(soundId: string): SoundDirectivity | undefined {
  const sounds: Array<{ id: string; directivity?: SoundDirectivity }> =
    useSoundscapeStore.getState().soundscapeData ?? [];
  return sounds.find((s) => s.id === soundId)?.directivity;
}

function soundTarget(soundId: string): OrientationTarget | null {
  const directivity = findDirectivity(soundId);
  if (!directivity || isOmniDirectivity(directivity)) return null;
  return {
    get: () => {
      const d = findDirectivity(soundId);
      return { yaw: d?.yaw ?? 0, pitch: d?.pitch ?? 0, roll: d?.roll ?? 0 };
    },
    set: (next) => {
      const d = findDirectivity(soundId);
      if (!d) return;
      useSoundscapeStore.getState().updateSoundDirectivity(soundId, { ...d, ...next });
    },
  };
}

/** Orientation accessor for a gizmo-selected object, or null when it cannot be rotated. */
export function resolveOrientationTarget(object: THREE.Object3D): OrientationTarget | null {
  const data = object.userData ?? {};
  if (data.customObjectType === 'receiver' && typeof data.receiverId === 'string') {
    return receiverTarget(data.receiverId);
  }
  if (data.customObjectType === 'sound') {
    const soundId: unknown = data.soundEvent?.id ?? data.positionKey;
    return typeof soundId === 'string' ? soundTarget(soundId) : null;
  }
  return null;
}

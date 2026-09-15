/**
 * Audio Output Device Registry
 *
 * Single place that routes every speaker-reaching audio path to the user's
 * chosen output device / sound card:
 *
 * - the primary AudioOrchestrator AudioContext (soundscape playback)
 * - the ModalImpactSynthesizer AudioContext (modal impact playback)
 * - each WaveSurfer preview instance (card previews)
 *
 * Browsers only expose `AudioContext.setSinkId` from Chrome 110 and only a
 * media permission grant reveals device ids, so every call is feature-detected
 * and failures fall back to the system default output.
 */

import { AUDIO_OUTPUT } from '@/utils/constants';

/**
 * Anything exposing the media/Web Audio `setSinkId` API (e.g. a WaveSurfer
 * instance, which delegates to its internal context / media element).
 * Optional because not every browser / library version implements it.
 */
export interface OutputDeviceTarget {
  setSinkId?: (sinkId: string) => Promise<void>;
}

let currentDeviceId: string = AUDIO_OUTPUT.DEFAULT_DEVICE_ID;
const targets = new Set<OutputDeviceTarget>();

function toSinkId(deviceId: string): string {
  // `''` tells the browser to use the system default output.
  return deviceId === AUDIO_OUTPUT.DEFAULT_DEVICE_ID ? '' : deviceId;
}

async function applyToTarget(target: OutputDeviceTarget, deviceId: string): Promise<boolean> {
  if (typeof target.setSinkId !== 'function') return false;

  try {
    await target.setSinkId(toSinkId(deviceId));
    return true;
  } catch (error) {
    // Selected device disappeared / is unavailable — fall back to the default.
    if (deviceId !== AUDIO_OUTPUT.DEFAULT_DEVICE_ID) {
      try {
        await target.setSinkId('');
        console.warn('[output-device] Selected device unavailable, using system default:', error);
        return true;
      } catch {
        // fall through to the generic warning below
      }
    }
    console.warn('[output-device] setSinkId failed:', error);
    return false;
  }
}

/** Current selected device id (AUDIO_OUTPUT.DEFAULT_DEVICE_ID when unset). */
export function getOutputDeviceId(): string {
  return currentDeviceId;
}

/** Route every registered output target to `deviceId` (default when unset). */
export function applyOutputDevice(deviceId: string): void {
  currentDeviceId = deviceId || AUDIO_OUTPUT.DEFAULT_DEVICE_ID;
  targets.forEach((target) => {
    void applyToTarget(target, currentDeviceId);
  });
}

/**
 * Register an output target (AudioContext or WaveSurfer instance). The current
 * device is applied immediately and kept in sync on later changes. Newly created
 * players therefore inherit the selected device automatically even when they
 * appear after the user picked it.
 *
 * @returns an unregister function — call it when the target is disposed.
 */
export function registerOutputDeviceTarget(target: OutputDeviceTarget | AudioContext): () => void {
  // `AudioContext.setSinkId` is absent from the TS DOM lib, so the context does
  // not structurally satisfy OutputDeviceTarget; treat it as one and
  // feature-detect the method at runtime inside applyToTarget.
  const sinkTarget = target as OutputDeviceTarget;
  targets.add(sinkTarget);
  void applyToTarget(sinkTarget, currentDeviceId);
  return () => {
    targets.delete(sinkTarget);
  };
}

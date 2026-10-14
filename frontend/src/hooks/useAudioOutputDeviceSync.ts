/**
 * useAudioOutputDeviceSync
 *
 * Always-on watchdog for the persisted audio output devices — the regular
 * output and the multichannel ambisonic send device. Whenever the set of
 * connected devices changes (unplug, driver reset, permission grant), it checks
 * whether each selected device still exists and, if not, resets it to the
 * system default (and turns the send off, so it never lands on the default
 * stereo output). Mount once at the app root so the fallback does not depend on
 * the Audio settings panel being open.
 *
 * Device ids are only usable once labels are exposed (i.e. after a media
 * permission grant); while they are hidden the check is skipped — the output
 * registry still falls back to the default per audio target on setSinkId failure.
 */

import { useEffect } from "react";
import { useAudioControlsStore } from "@/store";
import { AUDIO_OUTPUT } from "@/utils/constants";

function isMissing(deviceId: string, outputs: MediaDeviceInfo[]): boolean {
  return deviceId !== AUDIO_OUTPUT.DEFAULT_DEVICE_ID && !outputs.some((d) => d.deviceId === deviceId);
}

export function useAudioOutputDeviceSync(): void {
  const outputDeviceId = useAudioControlsStore((s) => s.outputDeviceId);
  const sendDeviceId = useAudioControlsStore((s) => s.ambisonicSendDeviceId);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;

    let cancelled = false;

    const sync = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;

        const outputs = all.filter((d) => d.kind === "audiooutput");
        // Without permission the ids are empty and cannot be compared.
        if (!outputs.some((d) => d.deviceId)) return;

        const store = useAudioControlsStore.getState();
        if (isMissing(store.outputDeviceId, outputs)) {
          store.setOutputDeviceId(AUDIO_OUTPUT.DEFAULT_DEVICE_ID);
        }
        if (isMissing(store.ambisonicSendDeviceId, outputs)) {
          // The bridge transport doesn't use this device — only stop a device send.
          if (store.ambisonicSendTransport === "device") store.setAmbisonicSendEnabled(false);
          store.setAmbisonicSendDeviceId(AUDIO_OUTPUT.DEFAULT_DEVICE_ID);
        }
      } catch {
        // enumerateDevices unavailable / denied — nothing to reconcile.
      }
    };

    void sync();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    mediaDevices.addEventListener("devicechange", sync);
    return () => {
      cancelled = true;
      mediaDevices.removeEventListener("devicechange", sync);
    };
  }, [outputDeviceId, sendDeviceId]);
}

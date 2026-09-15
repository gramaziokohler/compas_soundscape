/**
 * useAudioOutputDeviceSync
 *
 * Always-on watchdog for the persisted audio output device. Whenever the set of
 * connected devices changes (unplug, driver reset, permission grant), it checks
 * whether the selected device still exists and, if not, resets the store to the
 * system default. Mount once at the app root so the fallback does not depend on
 * the Audio settings panel being open.
 *
 * Device ids are only usable once labels are exposed (i.e. after a media
 * permission grant); while they are hidden the check is skipped — the output
 * registry still falls back to the default per audio target on setSinkId failure.
 */

import { useEffect } from "react";
import { useAudioControlsStore } from "@/store";
import { AUDIO_OUTPUT } from "@/utils/constants";

export function useAudioOutputDeviceSync(): void {
  const outputDeviceId = useAudioControlsStore((s) => s.outputDeviceId);

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

        const current = useAudioControlsStore.getState().outputDeviceId;
        if (current === AUDIO_OUTPUT.DEFAULT_DEVICE_ID) return;
        if (!outputs.some((d) => d.deviceId === current)) {
          useAudioControlsStore.getState().setOutputDeviceId(AUDIO_OUTPUT.DEFAULT_DEVICE_ID);
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
  }, [outputDeviceId]);
}

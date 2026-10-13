/**
 * useAudioOutputDevices
 *
 * Enumerates the machine's audio output devices for device pickers (regular
 * output, multichannel ambisonic send). Re-enumerates on `devicechange`.
 *
 * Device labels are only exposed by the browser after a media permission grant;
 * `requestLabels()` requests microphone access once (tracks are stopped
 * immediately) and re-enumerates. On macOS Chrome also needs the OS-level
 * microphone permission (System Settings → Privacy & Security → Microphone).
 *
 * Usage:
 * ```tsx
 * const { devices, supported, labelsHidden, requesting, requestLabels } = useAudioOutputDevices();
 * // Also report each device's channel count (multichannel send picker):
 * const { channelCounts } = useAudioOutputDevices({ probeChannels: true });
 * ```
 */

import { useCallback, useEffect, useState } from "react";
import { isSinkSelectionSupported } from "@/lib/audio/output-device";
import { clearOutputChannelCache, probeOutputChannels } from "@/lib/audio/output/probe-output-channels";
import { AUDIO_OUTPUT } from "@/utils/constants";

export interface OutputDeviceOption {
  deviceId: string;
  label: string;
}

const DEFAULT_OPTION: OutputDeviceOption = {
  deviceId: AUDIO_OUTPUT.DEFAULT_DEVICE_ID,
  label: "System default",
};

export interface UseAudioOutputDevicesResult {
  devices: OutputDeviceOption[];
  /** False when the browser cannot route audio to a chosen device. */
  supported: boolean;
  labelsHidden: boolean;
  requesting: boolean;
  requestLabels: () => Promise<void>;
  /** deviceId → output channels the browser exposes (only with `probeChannels`). */
  channelCounts: Record<string, number>;
}

export interface UseAudioOutputDevicesOptions {
  /** Open a short-lived context per device to read its channel count. */
  probeChannels?: boolean;
}

export function useAudioOutputDevices(
  { probeChannels = false }: UseAudioOutputDevicesOptions = {}
): UseAudioOutputDevicesResult {
  const [devices, setDevices] = useState<OutputDeviceOption[]>([DEFAULT_OPTION]);
  const [supported, setSupported] = useState(true);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({});

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setSupported(false);
      return;
    }

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const outputs = all.filter((d) => d.kind === "audiooutput");
      // Without a permission grant browsers return empty labels AND empty ids.
      setLabelsHidden(outputs.length > 0 && outputs.every((d) => !d.label));

      const options: OutputDeviceOption[] = [DEFAULT_OPTION];
      const seen = new Set<string>([AUDIO_OUTPUT.DEFAULT_DEVICE_ID]);
      outputs.forEach((device, index) => {
        // Devices with an empty id cannot be targeted by setSinkId and may
        // repeat — skip them rather than emit duplicate menu entries.
        if (!device.deviceId || seen.has(device.deviceId)) return;
        seen.add(device.deviceId);
        options.push({
          deviceId: device.deviceId,
          label: device.label || `Output device ${index + 1}`,
        });
      });
      setDevices(options);
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    setSupported(isSinkSelectionSupported());
    void enumerate();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => {
      // A device may have been reconfigured (e.g. Dante Virtual Soundcard channels).
      clearOutputChannelCache();
      void enumerate();
    };
    mediaDevices.addEventListener("devicechange", onChange);
    return () => mediaDevices.removeEventListener("devicechange", onChange);
  }, [enumerate]);

  // Probing needs real device ids, which only exist once labels are exposed.
  useEffect(() => {
    if (!probeChannels || labelsHidden) return;
    let cancelled = false;
    void probeOutputChannels(devices.map((d) => d.deviceId)).then((counts) => {
      if (!cancelled) setChannelCounts(counts);
    });
    return () => {
      cancelled = true;
    };
  }, [probeChannels, labelsHidden, devices]);

  const requestLabels = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await enumerate();
    } catch {
      // Permission denied — labels stay hidden, selection remains possible.
    } finally {
      setRequesting(false);
    }
  }, [enumerate]);

  return { devices, supported, labelsHidden, requesting, requestLabels, channelCounts };
}

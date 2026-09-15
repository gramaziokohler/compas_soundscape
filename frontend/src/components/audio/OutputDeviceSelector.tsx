"use client";

/**
 * OutputDeviceSelector
 *
 * Lists the audio output devices connected to the machine and lets the user
 * route Web Audio playback to a chosen device / sound card. The selected device
 * id is persisted in `audioControlsStore`; `page.tsx` feeds it to
 * `applyOutputDevice()`, which routes the orchestrator, modal-impact, and
 * WaveSurfer preview outputs.
 *
 * Device labels are only exposed by the browser after a media permission grant;
 * when they are hidden a "Show device names" action requests microphone access
 * once (tracks are stopped immediately) and re-enumerates.
 *
 * Usage:
 * ```tsx
 * <OutputDeviceSelector />
 * ```
 */
import { useCallback, useEffect, useState } from "react";
import { CardSelect } from "@/components/ui/CardSelect";
import { Notice } from "@/components/ui/Notice";
import { useAudioControlsStore } from "@/store";
import { AUDIO_OUTPUT } from "@/utils/constants";

/** `AudioContext.setSinkId` is not in the TS DOM lib yet — feature-detect it. */
interface SinkIdCapableAudioContext extends AudioContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

interface OutputDeviceOption {
  deviceId: string;
  label: string;
}

function isOutputSelectionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const proto = window.AudioContext?.prototype as SinkIdCapableAudioContext | undefined;
  return !!proto && typeof proto.setSinkId === "function";
}

export function OutputDeviceSelector() {
  const outputDeviceId = useAudioControlsStore((s) => s.outputDeviceId);
  const setOutputDeviceId = useAudioControlsStore((s) => s.setOutputDeviceId);

  const [devices, setDevices] = useState<OutputDeviceOption[]>([
    { deviceId: AUDIO_OUTPUT.DEFAULT_DEVICE_ID, label: "System default" },
  ]);
  const [supported, setSupported] = useState(true);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [requesting, setRequesting] = useState(false);

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

      const options: OutputDeviceOption[] = [
        { deviceId: AUDIO_OUTPUT.DEFAULT_DEVICE_ID, label: "System default" },
      ];
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
    setSupported(isOutputSelectionSupported());
    void enumerate();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onChange = () => void enumerate();
    mediaDevices.addEventListener("devicechange", onChange);
    return () => mediaDevices.removeEventListener("devicechange", onChange);
  }, [enumerate]);

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

  if (!supported) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-secondary-hover">Output device</span>
        <Notice
          type="info"
          variant="tag"
          message="Output selection is not supported in this browser"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-secondary-hover">Output device</span>
      <CardSelect
        forceMenu
        value={outputDeviceId}
        onChange={setOutputDeviceId}
        options={devices.map((d) => ({ value: d.deviceId, label: d.label }))}
      />
      {labelsHidden && (
        <button
          type="button"
          onClick={requestLabels}
          disabled={requesting}
          className="text-[10px] text-left text-blue-text transition-opacity hover:opacity-60 disabled:opacity-40"
          title="Device names require audio input permission"
        >
          {requesting ? "Requesting…" : "Show device names"}
        </button>
      )}
    </div>
  );
}

export default OutputDeviceSelector;

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
import { CardSelect } from "@/components/ui/CardSelect";
import { Notice } from "@/components/ui/Notice";
import { useAudioOutputDevices } from "@/hooks/useAudioOutputDevices";
import { useAudioControlsStore } from "@/store";

interface ShowDeviceNamesButtonProps {
  requesting: boolean;
  onClick: () => void;
}

/** "Show device names" link — triggers the media permission grant that exposes labels. */
export function ShowDeviceNamesButton({ requesting, onClick }: ShowDeviceNamesButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={requesting}
      className="text-[10px] text-left text-blue-text transition-opacity hover:opacity-60 disabled:opacity-40"
      title="Device names require audio input permission"
    >
      {requesting ? "Requesting…" : "Show device names"}
    </button>
  );
}

export function OutputDeviceSelector() {
  const outputDeviceId = useAudioControlsStore((s) => s.outputDeviceId);
  const setOutputDeviceId = useAudioControlsStore((s) => s.setOutputDeviceId);
  const { devices, supported, labelsHidden, requesting, requestLabels } = useAudioOutputDevices();

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
      {labelsHidden && <ShowDeviceNamesButton requesting={requesting} onClick={requestLabels} />}
    </div>
  );
}

export default OutputDeviceSelector;

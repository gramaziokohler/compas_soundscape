"use client";

/**
 * AmbisonicSendControls
 *
 * Settings for the multichannel ambisonic send: streams the active mode's
 * pre-decoder bus as (order+1)² discrete ACN/SN3D (AmbiX) channels to either
 * - an output device the browser opens (DVS on macOS, BlackHole, a virtual cable), or
 * - the local ASIO bridge (scripts/ambisonic_bridge) — DVS on Windows, whose WDM
 *   side only exposes stereo pairs to browsers.
 * Third order (16 ch) for the dome; first order (4 ch) fits small devices.
 * While on, the in-browser binaural output is replaced by the send; the
 * BottomBar master volume controls its level.
 *
 * State lives in `audioControlsStore`; `useAmbisonicSendSync` (mounted in
 * page.tsx) applies it to the AudioOrchestrator and reports status back.
 *
 * Usage:
 * ```tsx
 * <AmbisonicSendControls />
 * ```
 */
import { CardSelect } from "@/components/ui/CardSelect";
import { Notice } from "@/components/ui/Notice";
import { ToggleField } from "@/components/ui/ToggleField";
import { ShowDeviceNamesButton } from "@/components/audio/OutputDeviceSelector";
import { useAudioOutputDevices } from "@/hooks/useAudioOutputDevices";
import { ambisonicChannelCount } from "@/lib/audio/utils/ambisonic-utils";
import { useAudioControlsStore } from "@/store";
import type { AmbisonicOrder, AmbisonicSendTransport } from "@/types/audio";
import { AMBISONIC_SEND } from "@/utils/constants";

const ORDER_SELECT_OPTIONS = AMBISONIC_SEND.ORDER_OPTIONS.map((o) => ({
  value: String(o.order),
  label: o.label,
}));

/** Transport is picked from the detected OS by `useAmbisonicSendSync`; shown read-only. */
const TRANSPORT_LABELS: Record<AmbisonicSendTransport, string> = {
  device: "Browser output device",
  bridge: "Local ASIO bridge (Windows)",
};

function parseOrder(value: string): AmbisonicOrder {
  const match = AMBISONIC_SEND.ORDER_OPTIONS.find((o) => String(o.order) === value);
  return match ? match.order : AMBISONIC_SEND.DEFAULT_ORDER;
}

export function AmbisonicSendControls() {
  const enabled = useAudioControlsStore((s) => s.ambisonicSendEnabled);
  const setEnabled = useAudioControlsStore((s) => s.setAmbisonicSendEnabled);
  const deviceId = useAudioControlsStore((s) => s.ambisonicSendDeviceId);
  const setDeviceId = useAudioControlsStore((s) => s.setAmbisonicSendDeviceId);
  const order = useAudioControlsStore((s) => s.ambisonicSendOrder);
  const setOrder = useAudioControlsStore((s) => s.setAmbisonicSendOrder);
  const rotateWithListener = useAudioControlsStore((s) => s.ambisonicSendRotateWithListener);
  const setRotateWithListener = useAudioControlsStore((s) => s.setAmbisonicSendRotateWithListener);
  const transport = useAudioControlsStore((s) => s.ambisonicSendTransport);
  const bridgeUrl = useAudioControlsStore((s) => s.ambisonicSendBridgeUrl);
  const status = useAudioControlsStore((s) => s.ambisonicSendStatus);
  const { devices, supported, labelsHidden, requesting, requestLabels, channelCounts } =
    useAudioOutputDevices({ probeChannels: true });

  const required = ambisonicChannelCount(order);
  const frame = rotateWithListener ? "listener-rotated" : "world-fixed";
  const isTooNarrow = (id: string) => channelCounts[id] !== undefined && channelCounts[id] < required;

  const deviceOptions = devices.map((d) => {
    const channels = channelCounts[d.deviceId];
    const tooNarrow = isTooNarrow(d.deviceId);
    return {
      value: d.deviceId,
      label: channels !== undefined ? `${d.label} · ${channels} ch` : d.label,
      // Keep the current selection clickable so it can still be read/changed.
      disabled: tooNarrow && d.deviceId !== deviceId,
      title: tooNarrow ? `${channels} channels — ${required} required` : d.label,
    };
  });

  // DVS on Windows (WDM) shows up as stereo pairs only — explain instead of failing silently.
  const danteDevices = devices.filter((d) => AMBISONIC_SEND.DANTE_LABEL_PATTERN.test(d.label));
  const danteStereoPairsOnly =
    danteDevices.length > 0 && danteDevices.every((d) => isTooNarrow(d.deviceId));

  return (
    <div className="flex flex-col gap-1">
      <ToggleField
        checked={enabled}
        onChange={setEnabled}
        label="Stream ambisonics (Dante / DAW)"
        badge="AmbiX"
      />

      <span className="text-[10px] text-secondary-hover" title="Detected from your operating system">
        {`Output · ${TRANSPORT_LABELS[transport]}`}
      </span>

      <span className="text-[10px] text-secondary-hover">Send order</span>
      <CardSelect
        value={String(order)}
        onChange={(value) => setOrder(parseOrder(value))}
        options={ORDER_SELECT_OPTIONS}
      />

      {transport === "bridge" ? (
        <span className="text-[10px] text-secondary-hover">
          {`Run scripts/ambisonic_bridge/ambisonic_bridge.py · ${bridgeUrl}`}
        </span>
      ) : supported ? (
        <>
          <span className="text-[10px] text-secondary-hover">Send device</span>
          <CardSelect forceMenu value={deviceId} onChange={setDeviceId} options={deviceOptions} />
          {labelsHidden && <ShowDeviceNamesButton requesting={requesting} onClick={requestLabels} />}
          {danteStereoPairsOnly && (
            <Notice
              type="warning"
              variant="tag"
              message="Dante Virtual Soundcard only exposes stereo pairs to the browser on Windows (WDM). Use the local ASIO bridge — see docs/dante-ambisonic-send.md"
            />
          )}
          {!danteStereoPairsOnly && isTooNarrow(deviceId) && (
            <Notice
              type="warning"
              variant="tag"
              message={`Selected device exposes ${channelCounts[deviceId]} channels — ${required} required (lower the send order?)`}
            />
          )}
        </>
      ) : (
        <Notice
          type="info"
          variant="tag"
          message="This browser can't pick a device: set your Dante device as the system output (previews will also play there)"
        />
      )}

      <ToggleField
        checked={rotateWithListener}
        onChange={setRotateWithListener}
        label="Rotate with listener"
      />

      {enabled && status?.enabled && (
        <span className="text-[10px] text-secondary-hover">
          {`Order ${status.order} · ${ambisonicChannelCount(status.order)} ch · ACN/SN3D · ${frame}`}
          {status.transport === "bridge" && status.bridgeConnected && ` · bridge → ${status.bridgeDevice ?? "ASIO"}`}
          {status.deviceChannels !== null && ` · device ${status.deviceChannels} ch`}
        </span>
      )}
      {enabled && status?.enabled && status.sourceOrder !== undefined && status.sourceOrder < status.order && (
        <Notice
          type="info"
          variant="tag"
          message={`Current scene is order ${status.sourceOrder} (e.g. a first-order IR): channels ${ambisonicChannelCount(status.sourceOrder) + 1}–${ambisonicChannelCount(status.order)} are silent`}
        />
      )}

      {status?.error && <Notice type="error" variant="tag" message={status.error} />}
    </div>
  );
}

export default AmbisonicSendControls;

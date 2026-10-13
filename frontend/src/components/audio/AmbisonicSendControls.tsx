"use client";

/**
 * AmbisonicSendControls
 *
 * Settings for the multichannel ambisonic send: streams the active mode's
 * pre-decoder bus as (order+1)² discrete ACN/SN3D (AmbiX) channels to a chosen
 * output device — Dante Virtual Soundcard routed to a Holophonix processor
 * and/or a DAW recorder, or a virtual cable for home tests. Third order (16 ch)
 * for the dome; first order (4 ch) fits devices limited to fewer channels.
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
import type { AmbisonicOrder } from "@/types/audio";
import { AMBISONIC_SEND } from "@/utils/constants";

const ORDER_SELECT_OPTIONS = AMBISONIC_SEND.ORDER_OPTIONS.map((o) => ({
  value: String(o.order),
  label: o.label,
}));

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

      <span className="text-[10px] text-secondary-hover">Send order</span>
      <CardSelect
        value={String(order)}
        onChange={(value) => setOrder(parseOrder(value))}
        options={ORDER_SELECT_OPTIONS}
      />

      {supported ? (
        <>
          <span className="text-[10px] text-secondary-hover">Send device</span>
          <CardSelect forceMenu value={deviceId} onChange={setDeviceId} options={deviceOptions} />
          {labelsHidden && <ShowDeviceNamesButton requesting={requesting} onClick={requestLabels} />}
          {danteStereoPairsOnly && (
            <Notice
              type="warning"
              variant="tag"
              message={`Dante Virtual Soundcard only exposes stereo pairs here (Windows WDM). Use DVS on macOS or a ${required}-channel virtual device — see docs/dante-ambisonic-send.md`}
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
          {status.deviceChannels !== null && ` · device ${status.deviceChannels} ch`}
        </span>
      )}

      {status?.error && <Notice type="error" variant="tag" message={status.error} />}
    </div>
  );
}

export default AmbisonicSendControls;

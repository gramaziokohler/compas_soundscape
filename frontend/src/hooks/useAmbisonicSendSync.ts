/**
 * useAmbisonicSendSync
 *
 * Mirrors the multichannel ambisonic send settings from `audioControlsStore`
 * onto the AudioOrchestrator and writes the orchestrator's status back:
 *
 * - on mount, picks `ambisonicSendTransport` from the detected OS (Windows → bridge)
 * - `ambisonicSendEnabled` + target (`ambisonicSendTransport` → device id or bridge URL)
 *   + `ambisonicSendOrder` → `setAmbisonicSend()`
 * - `ambisonicSendRotateWithListener` → `setAmbisonicSendRotateWithListener()`
 * - status changes (incl. a device losing channels) → `ambisonicSendStatus`;
 *   a failed or dropped send also turns the store toggle back off.
 *
 * Mount once at the app root next to the output-device sync.
 */

import { useEffect } from "react";
import { useAudioControlsStore } from "@/store";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import type { AmbisonicSendStatus, AmbisonicSendTarget } from "@/types/audio";
import { detectWindows } from "@/utils/platform";

function applyStatus(status: AmbisonicSendStatus | null): void {
  if (!status) return;
  const store = useAudioControlsStore.getState();
  store.setAmbisonicSendStatus(status);
  if (!status.enabled && store.ambisonicSendEnabled) {
    store.setAmbisonicSendEnabled(false);
  }
}

export function useAmbisonicSendSync(orchestrator: AudioOrchestrator | null): void {
  const enabled = useAudioControlsStore((s) => s.ambisonicSendEnabled);
  const deviceId = useAudioControlsStore((s) => s.ambisonicSendDeviceId);
  const order = useAudioControlsStore((s) => s.ambisonicSendOrder);
  const transport = useAudioControlsStore((s) => s.ambisonicSendTransport);
  const bridgeUrl = useAudioControlsStore((s) => s.ambisonicSendBridgeUrl);
  const rotateWithListener = useAudioControlsStore((s) => s.ambisonicSendRotateWithListener);

  // DVS on Windows (WDM) only exposes stereo pairs to browsers, so the send goes
  // through the local ASIO bridge there; elsewhere the browser opens the device.
  useEffect(() => {
    useAudioControlsStore.getState().setAmbisonicSendTransport(detectWindows() ? "bridge" : "device");
  }, []);

  useEffect(() => {
    if (!orchestrator) return;
    return orchestrator.onAmbisonicSendStatus(applyStatus);
  }, [orchestrator]);

  useEffect(() => {
    if (!orchestrator) return;
    const target: AmbisonicSendTarget =
      transport === "bridge" ? { kind: "bridge", url: bridgeUrl } : { kind: "device", deviceId };
    void orchestrator.setAmbisonicSend(enabled, target, order).then(applyStatus);
  }, [orchestrator, enabled, transport, deviceId, bridgeUrl, order]);

  useEffect(() => {
    orchestrator?.setAmbisonicSendRotateWithListener(rotateWithListener);
  }, [orchestrator, rotateWithListener]);
}

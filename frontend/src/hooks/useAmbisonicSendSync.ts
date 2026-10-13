/**
 * useAmbisonicSendSync
 *
 * Mirrors the multichannel ambisonic send settings from `audioControlsStore`
 * onto the AudioOrchestrator and writes the orchestrator's status back:
 *
 * - `ambisonicSendEnabled` + `ambisonicSendDeviceId` + `ambisonicSendOrder` → `setAmbisonicSend()`
 * - `ambisonicSendRotateWithListener` → `setAmbisonicSendRotateWithListener()`
 * - status changes (incl. a device losing channels) → `ambisonicSendStatus`;
 *   a failed or dropped send also turns the store toggle back off.
 *
 * Mount once at the app root next to the output-device sync.
 */

import { useEffect } from "react";
import { useAudioControlsStore } from "@/store";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import type { AmbisonicSendStatus } from "@/types/audio";

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
  const rotateWithListener = useAudioControlsStore((s) => s.ambisonicSendRotateWithListener);

  useEffect(() => {
    if (!orchestrator) return;
    return orchestrator.onAmbisonicSendStatus(applyStatus);
  }, [orchestrator]);

  useEffect(() => {
    if (!orchestrator) return;
    void orchestrator.setAmbisonicSend(enabled, deviceId, order).then(applyStatus);
  }, [orchestrator, enabled, deviceId, order]);

  useEffect(() => {
    orchestrator?.setAmbisonicSendRotateWithListener(rotateWithListener);
  }, [orchestrator, rotateWithListener]);
}

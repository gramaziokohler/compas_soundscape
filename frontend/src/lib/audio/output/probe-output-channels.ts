/**
 * Probe how many output channels the browser exposes for each audio device.
 *
 * Browsers only report a device's width through an AudioContext routed to it
 * (`destination.maxChannelCount` after `setSinkId`). Each probe opens a
 * short-lived suspended context, reads the count and closes it. Probes run
 * sequentially and are cached per device id until `clearOutputChannelCache()`
 * (call it on `devicechange` — e.g. after reconfiguring Dante Virtual Soundcard).
 */

import { AUDIO_SAMPLE_RATE } from '@/utils/constants';
import { isSinkSelectionSupported, toSinkId } from '../output-device';

interface SinkSelectableContext extends AudioContext {
  setSinkId: (sinkId: string) => Promise<void>;
}

const cache = new Map<string, number>();

export function clearOutputChannelCache(): void {
  cache.clear();
}

async function probeOne(deviceId: string): Promise<number | null> {
  const context = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE }) as SinkSelectableContext;
  try {
    await context.setSinkId(toSinkId(deviceId));
    return context.destination.maxChannelCount;
  } catch {
    return null;
  } finally {
    void context.close();
  }
}

/**
 * @returns deviceId → maxChannelCount for every device that could be probed
 */
export async function probeOutputChannels(deviceIds: string[]): Promise<Record<string, number>> {
  if (!isSinkSelectionSupported()) return {};

  const result: Record<string, number> = {};
  for (const deviceId of deviceIds) {
    let channels = cache.get(deviceId);
    if (channels === undefined) {
      const probed = await probeOne(deviceId);
      if (probed === null) continue;
      channels = probed;
      cache.set(deviceId, channels);
    }
    result[deviceId] = channels;
  }
  return result;
}

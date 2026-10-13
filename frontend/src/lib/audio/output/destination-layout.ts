/**
 * Destination channel layout for the multichannel ambisonic send.
 *
 * The send writes its (order+1)² discrete channels straight onto the context
 * destination (1:1, no merger). Extra device channels stay silent. Browsers
 * report the device width via `destination.maxChannelCount`, which is only
 * accurate after `setSinkId` has resolved.
 */

/** Thrown when the selected device cannot carry the send's channels. */
export class InsufficientChannelsError extends Error {
  constructor(readonly deviceChannels: number, readonly requiredChannels: number) {
    super(`Device exposes ${deviceChannels} channels — ${requiredChannels} required`);
    this.name = 'InsufficientChannelsError';
  }
}

/**
 * Switch the destination to `channels` discrete channels.
 * @returns the device's maxChannelCount
 * @throws InsufficientChannelsError when the device is too narrow
 */
export function enableMultichannelDestination(context: AudioContext, channels: number): number {
  const destination = context.destination;
  const deviceChannels = destination.maxChannelCount;
  if (deviceChannels < channels) {
    throw new InsufficientChannelsError(deviceChannels, channels);
  }
  destination.channelCount = channels;
  destination.channelCountMode = 'explicit';
  destination.channelInterpretation = 'discrete';
  return deviceChannels;
}

/** Back to the regular stereo (binaural) destination. */
export function restoreStereoDestination(context: AudioContext): void {
  const destination = context.destination;
  destination.channelCount = 2;
  destination.channelCountMode = 'explicit';
  destination.channelInterpretation = 'speakers';
}

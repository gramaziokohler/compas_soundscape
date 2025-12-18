/**
 * Audio Buffer Resampling Utility
 *
 * Resamples AudioBuffers to match the AudioContext sample rate.
 * This is necessary when HRTF/HRIR files have different sample rates
 * than the Web Audio API context (commonly 44100 Hz vs 48000 Hz).
 *
 * Uses OfflineAudioContext for high-quality resampling.
 */

/**
 * Resample an AudioBuffer to match the target sample rate
 *
 * Uses OfflineAudioContext to perform high-quality resampling.
 * If the source buffer already matches the target rate, returns it unchanged.
 *
 * @param sourceBuffer - The AudioBuffer to resample
 * @param targetSampleRate - Target sample rate (typically audioContext.sampleRate)
 * @returns Promise resolving to resampled AudioBuffer
 */
export async function resampleAudioBuffer(
  sourceBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const sourceSampleRate = sourceBuffer.sampleRate;

  // No resampling needed if rates match
  if (sourceSampleRate === targetSampleRate) {
    console.log(`[Resample] Sample rates match (${sourceSampleRate} Hz), no resampling needed`);
    return sourceBuffer;
  }

  console.log(`[Resample] Resampling from ${sourceSampleRate} Hz to ${targetSampleRate} Hz`);

  // Calculate new buffer length based on sample rate ratio
  const ratio = targetSampleRate / sourceSampleRate;
  const newLength = Math.round(sourceBuffer.length * ratio);
  const numChannels = sourceBuffer.numberOfChannels;

  // Create OfflineAudioContext for resampling
  // Duration is calculated from the source buffer duration
  const offlineContext = new OfflineAudioContext(
    numChannels,
    newLength,
    targetSampleRate
  );

  // Create a buffer source with the original buffer
  const bufferSource = offlineContext.createBufferSource();
  bufferSource.buffer = sourceBuffer;
  bufferSource.connect(offlineContext.destination);
  bufferSource.start(0);

  // Render the resampled audio
  const resampledBuffer = await offlineContext.startRendering();

  console.log(
    `[Resample] Resampled: ${sourceBuffer.length} samples @ ${sourceSampleRate} Hz → ` +
    `${resampledBuffer.length} samples @ ${targetSampleRate} Hz ` +
    `(${numChannels} channels)`
  );

  return resampledBuffer;
}

/**
 * Create an AudioBuffer at a specific sample rate and resample if needed
 *
 * Creates an AudioBuffer from Float32Array data, then resamples to match
 * the AudioContext's sample rate if they differ.
 *
 * @param audioContext - Target AudioContext (provides target sample rate)
 * @param channelData - Array of Float32Arrays, one per channel
 * @param sourceSampleRate - Sample rate of the source data
 * @returns Promise resolving to AudioBuffer at context's sample rate
 */
export async function createResampledAudioBuffer(
  audioContext: AudioContext,
  channelData: Float32Array[],
  sourceSampleRate: number
): Promise<AudioBuffer> {
  const numChannels = channelData.length;
  const bufferLength = channelData[0].length;

  // Create a temporary buffer at the source sample rate
  // We need an OfflineAudioContext because regular AudioContext.createBuffer()
  // can only create buffers at specific rates in some browsers
  const tempContext = new OfflineAudioContext(
    numChannels,
    bufferLength,
    sourceSampleRate
  );

  const sourceBuffer = tempContext.createBuffer(
    numChannels,
    bufferLength,
    sourceSampleRate
  );

  // Copy channel data to the source buffer
  for (let channel = 0; channel < numChannels; channel++) {
    sourceBuffer.getChannelData(channel).set(channelData[channel]);
  }

  // Resample to match the audio context's sample rate
  return resampleAudioBuffer(sourceBuffer, audioContext.sampleRate);
}

/**
 * 24-bit PCM WAV encoding (with AES69-2015 ambisonics metadata chunk).
 *
 * Shared by SoundscapeExporter and the Foley FX bounce path so preview and
 * saved files use the same encoder.
 */

const WAV_HEADER_BYTES = 44;
const PCM16_BYTES_PER_SAMPLE = 2;

function setInt24(view: DataView, offset: number, value: number): void {
  const clamped = Math.max(-1, Math.min(1, value));
  const intVal = clamped < 0
    ? Math.round(clamped * 0x800000)
    : Math.round(clamped * 0x7FFFFF);
  view.setUint8(offset,     intVal & 0xFF);
  view.setUint8(offset + 1, (intVal >> 8) & 0xFF);
  view.setUint8(offset + 2, (intVal >> 16) & 0xFF);
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function audioBufferToWavBlob24(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const { sampleRate, length: numSamples } = buffer;
  const bytesPerSample = 3;
  const dataByteLength = numChannels * numSamples * bytesPerSample;

  const isAmbisonic = numChannels === 4 || numChannels === 9 || numChannels === 16;

  let axmlBuf: Uint8Array | null = null;
  let axmlByteLength = 0;
  let axmlPadding = 0;
  if (isAmbisonic) {
    const axmlStr = `<?xml version="1.0" encoding="UTF-8"?>
<ambisonics>
  <version>1.0.0</version>
  <normalization>SN3D</normalization>
  <channelOrdering>ACN</channelOrdering>
</ambisonics>`;
    axmlBuf = new TextEncoder().encode(axmlStr);
    axmlByteLength = axmlBuf.length;
    axmlPadding = axmlByteLength % 2;
  }

  const fmtEnd = 36;
  const axmlChunkSize = isAmbisonic ? 8 + axmlByteLength + axmlPadding : 0;
  const dataOffset = fmtEnd + axmlChunkSize;

  const totalFileSize = dataOffset + 8 + dataByteLength;
  const arrayBuffer = new ArrayBuffer(totalFileSize);
  const view = new DataView(arrayBuffer);

  writeStr(view, 0,  'RIFF');
  view.setUint32(4,  totalFileSize - 8, true);
  writeStr(view, 8,  'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 24, true);

  if (isAmbisonic && axmlBuf) {
    writeStr(view, 36, 'axml');
    view.setUint32(40, axmlByteLength + axmlPadding, true);
    for (let i = 0; i < axmlByteLength; i++) {
      view.setUint8(44 + i, axmlBuf[i]);
    }
  }

  writeStr(view, dataOffset, 'data');
  view.setUint32(dataOffset + 4, dataByteLength, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = dataOffset + 8;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      setInt24(view, offset, sample);
      offset += bytesPerSample;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Wrap raw interleaved 16-bit little-endian PCM (e.g. ElevenLabs `pcm_*`
 * output) in a WAV header — lossless, no decode/re-encode.
 */
export function pcm16ToWavBlob(pcm: Uint8Array, sampleRate: number, numChannels = 1): Blob {
  const header = new ArrayBuffer(WAV_HEADER_BYTES);
  const view = new DataView(header);
  const blockAlign = numChannels * PCM16_BYTES_PER_SAMPLE;

  writeStr(view, 0,  'RIFF');
  view.setUint32(4,  WAV_HEADER_BYTES - 8 + pcm.byteLength, true);
  writeStr(view, 8,  'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1,  true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, PCM16_BYTES_PER_SAMPLE * 8, true);
  writeStr(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
}

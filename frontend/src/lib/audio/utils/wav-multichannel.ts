/**
 * Multichannel WAV decoding that keeps every channel.
 *
 * The browser's `decodeAudioData` keeps at most 8 channels (Chrome silently drops the
 * rest, Firefox rejects the file), so a 16-channel third-order ambisonic IR came out with
 * 8 channels. WAVs with more channels than the browser keeps — or whose native decode lost
 * channels — are parsed here instead: PCM 8/16/24/32-bit and IEEE float 32/64-bit, plain or
 * WAVE_FORMAT_EXTENSIBLE. The buffer keeps the file's sample rate (no resampling).
 */

import { IMPULSE_RESPONSE } from '@/utils/constants';

const FORMAT_PCM = 0x0001;
const FORMAT_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

export interface WavHeader {
  formatTag: number;          // PCM or FLOAT (the sub-format of an extensible file)
  numberOfChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataLength: number;
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
}

/** The `fmt ` and `data` chunks of a RIFF/WAVE file, or null when it is not a readable WAV. */
export function readWavHeader(buffer: ArrayBuffer): WavHeader | null {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  if (fourCC(view, 0) !== 'RIFF' || fourCC(view, 8) !== 'WAVE') return null;

  let fmt: Omit<WavHeader, 'dataOffset' | 'dataLength'> | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      let formatTag = view.getUint16(body, true);
      if (formatTag === FORMAT_EXTENSIBLE && size >= 26) {
        formatTag = view.getUint16(body + 24, true); // first two bytes of the sub-format GUID
      }
      fmt = {
        formatTag,
        numberOfChannels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data' && fmt) {
      const dataLength = Math.min(size, buffer.byteLength - body);
      return { ...fmt, dataOffset: body, dataLength };
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

type SampleReader = (view: DataView, offset: number) => number;

function sampleReader(header: WavHeader): SampleReader | null {
  const { formatTag, bitsPerSample } = header;
  if (formatTag === FORMAT_FLOAT) {
    if (bitsPerSample === 32) return (v, o) => v.getFloat32(o, true);
    if (bitsPerSample === 64) return (v, o) => v.getFloat64(o, true);
    return null;
  }
  if (formatTag !== FORMAT_PCM) return null;
  switch (bitsPerSample) {
    case 8: return (v, o) => (v.getUint8(o) - 128) / 128;
    case 16: return (v, o) => v.getInt16(o, true) / 32768;
    case 24: return (v, o) => {
      const value = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
      return value / 8388608;
    };
    case 32: return (v, o) => v.getInt32(o, true) / 2147483648;
    default: return null;
  }
}

/** Decode a WAV with every channel kept; throws on formats it cannot read. */
export function decodeWavAllChannels(context: BaseAudioContext, buffer: ArrayBuffer, header: WavHeader): AudioBuffer {
  const read = sampleReader(header);
  if (!read) {
    throw new Error(`Unsupported WAV encoding (format 0x${header.formatTag.toString(16)}, ${header.bitsPerSample}-bit)`);
  }
  const { numberOfChannels, blockAlign, dataOffset, dataLength, sampleRate } = header;
  const bytesPerSample = header.bitsPerSample / 8;
  const length = Math.floor(dataLength / blockAlign);
  if (numberOfChannels < 1 || length < 1) throw new Error('WAV file has no audio data');

  const out = context.createBuffer(numberOfChannels, length, sampleRate);
  const view = new DataView(buffer);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = out.getChannelData(ch);
    let offset = dataOffset + ch * bytesPerSample;
    for (let i = 0; i < length; i++, offset += blockAlign) {
      data[i] = read(view, offset);
    }
  }
  return out;
}

/**
 * Decode audio keeping every channel: the browser decoder for ordinary files, the WAV parser
 * when the file has more channels than the browser keeps or the browser returned fewer channels
 * than the WAV header declares. `buffer` is not detached.
 */
export async function decodeAudioAllChannels(context: BaseAudioContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
  const header = readWavHeader(buffer);
  if (header && header.numberOfChannels > IMPULSE_RESPONSE.NATIVE_DECODE_MAX_CHANNELS) {
    return decodeWavAllChannels(context, buffer, header);
  }
  const decoded = await context.decodeAudioData(buffer.slice(0));
  if (header && decoded.numberOfChannels !== header.numberOfChannels) {
    console.warn(
      `[wav-multichannel] Browser decoded ${decoded.numberOfChannels} of ${header.numberOfChannels} channels; parsing the WAV instead`,
    );
    return decodeWavAllChannels(context, buffer, header);
  }
  return decoded;
}

/**
 * ElevenLabs Sound Effects Frontend Service
 *
 * Generates sound effects directly in the browser using the ElevenLabs JS SDK.
 * Returns a blob URL that can be used as an audio source — same pattern as
 * uploaded and library sounds.
 *
 * Duration defaults to unset (the model picks the optimal length from the
 * prompt). The caller decides when to send an explicit length — background beds
 * and short events omit it. Pass `loop: true` for seamless background/ambience
 * beds.
 *
 * Output is requested as raw PCM at AUDIO_SAMPLE_RATE (`pcm_<rate>`) and
 * wrapped in a WAV header, so ElevenLabs sounds match the app's master rate
 * losslessly. If the account's tier rejects PCM output, it falls back to the
 * SDK default (MP3 44.1 kHz), which the AudioContext resamples on decode.
 *
 * Requires: NEXT_PUBLIC_ELEVENLABS_API_KEY set in .env.local
 */

import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { pcm16ToWavBlob } from "@/lib/audio/utils/wav-encode";
import {
  AUDIO_SAMPLE_RATE,
  DEFAULT_PROMPT_INFLUENCE,
  ELEVENLABS_DURATION_MAX,
  ELEVENLABS_DURATION_MIN,
  ELEVENLABS_FORMAT_REJECTED_STATUSES,
} from "@/utils/constants";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ElevenLabsGenerateOptions {
  /** Text description of the desired sound effect. */
  text: string;
  /**
   * Requested duration in seconds (0.5 – 30).
   * Pass undefined to let the model guess the optimal duration from the prompt
   * (ElevenLabs `duration_seconds: null`, the default).
   */
  durationSeconds?: number;
  /**
   * Create a sound effect that loops smoothly (seamless start/end point).
   * Only available for the `eleven_text_to_sound_v2` model.
   */
  loop?: boolean;
  /**
   * How strongly the prompt influences the generated output (0.0 – 1.0).
   * Default: 0.3
   */
  promptInfluence?: number;
}

// ─── Client (lazy-initialised so the module loads even without a key) ─────────

let _client: ElevenLabsClient | null = null;
let _runtimeApiKey: string | null = null;

/** Override API key at runtime (no restart required). */
export function setElevenLabsApiKey(key: string): void {
  _runtimeApiKey = key.trim() || null;
  _client = null; // force re-init on next use
}

/** True if a key is available (env var or runtime override). */
export function isElevenLabsKeySet(): boolean {
  return !!(_runtimeApiKey || process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY);
}

function getClient(): ElevenLabsClient {
  if (!_client) {
    const apiKey = _runtimeApiKey || process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ElevenLabs: API key not set. " +
          "Add it in Advanced Settings → API Tokens, or set NEXT_PUBLIC_ELEVENLABS_API_KEY in frontend/.env.local."
      );
    }
    _client = new ElevenLabsClient({ apiKey });
  }
  return _client;
}

// ─── Core generation ─────────────────────────────────────────────────────────

/** Raw PCM at the master rate — a compile error here means ElevenLabs has no such PCM rate. */
const PCM_OUTPUT_FORMAT = `pcm_${AUDIO_SAMPLE_RATE}` as const;

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Generate a single sound effect via the ElevenLabs API.
 *
 * @returns A blob URL (`blob:…`) pointing to the audio data (WAV at
 *          AUDIO_SAMPLE_RATE, or MP3 when PCM output is rejected).
 *          The caller is responsible for revoking it with `URL.revokeObjectURL`
 *          when the sound is no longer needed.
 */
export async function generateSoundEffect(
  options: ElevenLabsGenerateOptions
): Promise<string> {
  const {
    text,
    durationSeconds,
    loop = false,
    promptInfluence = DEFAULT_PROMPT_INFLUENCE,
  } = options;

  const client = getClient();

  const request = {
    text,
    // Only pass duration_seconds when it is within the accepted range —
    // otherwise omit it so ElevenLabs guesses the optimal duration (None).
    durationSeconds:
      durationSeconds !== undefined &&
      durationSeconds >= ELEVENLABS_DURATION_MIN &&
      durationSeconds <= ELEVENLABS_DURATION_MAX
        ? durationSeconds
        : undefined,
    loop,
    promptInfluence: promptInfluence,
  };

  let blob: Blob;
  try {
    // The SDK returns a Web ReadableStream<Uint8Array>
    const stream = await client.textToSoundEffects.convert({ ...request, outputFormat: PCM_OUTPUT_FORMAT });
    const pcm = await readStreamBytes(stream as ReadableStream<Uint8Array>);
    blob = pcm16ToWavBlob(pcm, AUDIO_SAMPLE_RATE);
  } catch (err) {
    if (!(err instanceof ElevenLabsError && err.statusCode !== undefined && ELEVENLABS_FORMAT_REJECTED_STATUSES.has(err.statusCode))) {
      throw err;
    }
    console.warn(`[ElevenLabs] ${PCM_OUTPUT_FORMAT} rejected (${err.statusCode}); falling back to default MP3`);
    const stream = await client.textToSoundEffects.convert(request);
    const mp3 = await readStreamBytes(stream as ReadableStream<Uint8Array>);
    blob = new Blob([mp3 as BlobPart], { type: "audio/mpeg" });
  }
  return URL.createObjectURL(blob);
}

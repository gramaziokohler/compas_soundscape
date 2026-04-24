/**
 * ElevenLabs Sound Effects Frontend Service
 *
 * Generates sound effects directly in the browser using the ElevenLabs JS SDK.
 * Returns a blob URL that can be used as an audio source — same pattern as
 * uploaded and library sounds.
 *
 * Requires: NEXT_PUBLIC_ELEVENLABS_API_KEY set in .env.local
 */

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ElevenLabsGenerateOptions {
  /** Text description of the desired sound effect. */
  text: string;
  /**
   * Requested duration in seconds (0.5 – 22).
   * Pass undefined to let the model auto-detect the best duration.
   */
  durationSeconds?: number;
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

/**
 * Generate a single sound effect via the ElevenLabs API.
 *
 * @returns A blob URL (`blob:…`) pointing to the MP3 audio data.
 *          The caller is responsible for revoking it with `URL.revokeObjectURL`
 *          when the sound is no longer needed.
 */
export async function generateSoundEffect(
  options: ElevenLabsGenerateOptions
): Promise<string> {
  const { text, durationSeconds, promptInfluence = 0.3 } = options;

  const client = getClient();

  // The SDK returns a Web ReadableStream<Uint8Array>
  const stream = await client.textToSoundEffects.convert({
    text,
    // Only pass duration_seconds when it is within the accepted range
    duration_seconds:
      durationSeconds !== undefined &&
      durationSeconds >= 0.5 &&
      durationSeconds <= 22
        ? durationSeconds
        : undefined,
    prompt_influence: promptInfluence,
  });

  // Collect all chunks from the ReadableStream into a single Blob
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const blob = new Blob(chunks, { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

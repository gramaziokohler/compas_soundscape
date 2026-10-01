/**
 * TTS language / dialect resolution types.
 * Mirror backend/models/schemas.py (TTSDialect, TTSCustomVoice, TTSLanguageMatch)
 * and the TTS_LANGUAGE_MATCH_* constants in backend/config/constants.py.
 */

/**
 * - `custom`  — the user's own prompted dialect voice
 * - `library` — native regional voices exist in the Gemini voice library
 * - `tag`     — a known language/dialect with no native voices (e.g. Swiss German)
 * - `unknown` — not recognised; TTS falls back to auto-detect
 */
export type TtsLanguageMatchKind = 'custom' | 'library' | 'tag' | 'unknown';

export interface TtsDialect {
  accent: string;
  language_code: string;
  region_code: string | null;
  voice_count: number;
}

export interface TtsCustomVoice {
  id: string;
  dialect_name: string;
  language_code: string;
  gender: string;
  gemini_voice_id: string;
  description: string;
  expire_time: string | null;
  created_at: string;
}

export interface TtsDialectsResponse {
  dialects: TtsDialect[];
  custom_voices: TtsCustomVoice[];
}

export interface TtsLanguageMatch {
  kind: TtsLanguageMatchKind;
  query: string;
  label: string;
  language_code: string | null;
  accent: string | null;
  voice_count: number;
  custom_voices: TtsCustomVoice[];
  /** False when characters are re-voiced with regional or custom voices. */
  uses_classic_voices: boolean;
  suggested_language_code: string | null;
  default_description: string | null;
}

export interface TtsCustomVoiceCreateRequest {
  dialect_name: string;
  description?: string;
  /** Base language name or BCP-47 tag; overrides the backend's inference. */
  language_code?: string;
}

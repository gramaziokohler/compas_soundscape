'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '@/services/api';
import type { TtsDialectsResponse, TtsLanguageMatch } from '@/types/ttsLanguage';
import { TTS_LANGUAGE } from '@/utils/constants';

/** Custom-voice creation in progress (backend job, ≈30 s per voice). */
export interface TtsCustomVoiceCreation {
  dialect: string;
  progress: number;
  status: string;
}

export interface UseTtsLanguageResolverReturn {
  /** Last resolution result (null before the first commit). */
  match: TtsLanguageMatch | null;
  resolving: boolean;
  creating: TtsCustomVoiceCreation | null;
  error: string | null;
  /** Voice-library accents + custom voices, for input suggestions. */
  dialects: TtsDialectsResponse | null;
  /** Resolve the committed language text against the backend lists. */
  resolve: (text: string) => Promise<TtsLanguageMatch | null>;
  /** Create a female + male custom voice for `dialect`, then re-resolve. */
  createCustomVoice: (dialect: string, description: string, languageCode?: string) => Promise<void>;
  /** Delete every custom voice of a dialect (both genders). */
  deleteCustomDialect: (dialect: string) => Promise<void>;
  /** Hide the current prompt (user chose to keep the standard voices). */
  dismiss: () => void;
}

// Shared across every input on the page — the dialect list rarely changes.
let dialectsPromise: Promise<TtsDialectsResponse> | null = null;
function loadDialects(force = false): Promise<TtsDialectsResponse> {
  if (!dialectsPromise || force) {
    dialectsPromise = apiService.listTtsDialects().catch((err) => {
      dialectsPromise = null;
      throw err;
    });
  }
  return dialectsPromise;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * useTtsLanguageResolver Hook
 *
 * Checks a free-text TTS language against the backend (voice-library accents,
 * Babel language names, the user's custom voices) when the user commits it,
 * and drives custom dialect-voice creation for languages with no native voices.
 *
 * Usage:
 * ```tsx
 * const resolver = useTtsLanguageResolver();
 * <input onKeyDown={(e) => e.key === 'Enter' && resolver.resolve(value)} />
 * <TtsLanguageStatus resolver={resolver} />
 * ```
 */
export function useTtsLanguageResolver(): UseTtsLanguageResolverReturn {
  const [match, setMatch] = useState<TtsLanguageMatch | null>(null);
  const [resolving, setResolving] = useState(false);
  const [creating, setCreating] = useState<TtsCustomVoiceCreation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialects, setDialects] = useState<TtsDialectsResponse | null>(null);
  const mounted = useRef(true);
  const requestSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    loadDialects()
      .then((d) => mounted.current && setDialects(d))
      .catch(() => { /* suggestions are optional */ });
    return () => {
      mounted.current = false;
    };
  }, []);

  const resolve = useCallback(async (text: string) => {
    const trimmed = text.trim();
    const seq = ++requestSeq.current;
    setError(null);
    if (!trimmed) {
      setMatch(null);
      return null;
    }
    setResolving(true);
    try {
      const result = await apiService.resolveTtsLanguage(trimmed);
      if (mounted.current && seq === requestSeq.current) setMatch(result);
      return result;
    } catch (err) {
      if (mounted.current && seq === requestSeq.current) {
        setError(err instanceof Error ? err.message : 'Could not check this language');
      }
      return null;
    } finally {
      if (mounted.current && seq === requestSeq.current) setResolving(false);
    }
  }, []);

  const createCustomVoice = useCallback(async (dialect: string, description: string, languageCode?: string) => {
    setError(null);
    setCreating({ dialect, progress: 0, status: 'Starting…' });
    try {
      const { job_id } = await apiService.createTtsCustomVoice({
        dialect_name: dialect,
        description: description.trim() || undefined,
        language_code: languageCode?.trim() || undefined,
      });
      const deadline = Date.now() + TTS_LANGUAGE.CUSTOM_VOICE_TIMEOUT_MS;
      let done = false;
      while (!done) {
        if (Date.now() > deadline) throw new Error('Custom voice creation is taking too long — check again later');
        await sleep(TTS_LANGUAGE.CUSTOM_VOICE_POLL_MS);
        const job = await apiService.getTtsCustomVoiceJob(job_id);
        if (job.error) throw new Error(job.error);
        if (job.cancelled) throw new Error('Custom voice creation was cancelled');
        done = job.completed;
        if (!done && mounted.current) setCreating({ dialect, progress: job.progress, status: job.status });
      }
      const fresh = await loadDialects(true);
      if (mounted.current) setDialects(fresh);
      await resolve(dialect);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Custom voice creation failed');
    } finally {
      if (mounted.current) setCreating(null);
    }
  }, [resolve]);

  const deleteCustomDialect = useCallback(async (dialect: string) => {
    setError(null);
    try {
      const current = dialects?.custom_voices ?? [];
      await Promise.all(
        current.filter((v) => v.dialect_name === dialect).map((v) => apiService.deleteTtsCustomVoice(v.id)),
      );
      const fresh = await loadDialects(true);
      if (mounted.current) setDialects(fresh);
      if (match && match.kind === 'custom' && match.label === dialect) await resolve(match.query);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'Could not delete the custom voice');
    }
  }, [dialects, match, resolve]);

  const dismiss = useCallback(() => {
    setMatch(null);
    setError(null);
  }, []);

  return { match, resolving, creating, error, dialects, resolve, createCustomVoice, deleteCustomDialect, dismiss };
}

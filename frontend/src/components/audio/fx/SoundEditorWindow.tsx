'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  notifyError,
  useAudioControlsStore,
  useSoundFxStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import { API_BASE_URL, DEFAULT_DBFS, FLOATING_WINDOW, UI_BORDER_RADIUS, normalizeSoundCategory } from '@/utils/constants';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { ResizeHandles } from '@/components/ui/ResizeHandles';
import { apiService } from '@/services/api';
import { invalidatePeaks } from '@/lib/audio/peaks-cache';
import { decodeAudioFile } from '@/lib/audio/utils/audio-file-decoder';
import { emptyFxChain } from '@/lib/audio/fx/fx-defaults';
import { FxEngine } from '@/lib/audio/fx/fx-engine';
import { renderFxToWav } from '@/lib/audio/fx/fx-render';
import {
  chainHasServerStage,
  registerStableAudioSource,
  renderFxChainToWav,
} from '@/lib/audio/fx/stable-audio-render';
import { isServerRenderedInstance, type FxChain, type FxInstance, type FxParams, type FxRegion, type StableAudioParams } from '@/lib/audio/fx/fx-types';
import type { SoundEvent } from '@/types';
import { SoundEditorCanvas } from './SoundEditorCanvas';
import { FxStack } from './FxStack';
import { Spinner } from '@/components/ui/Spinner';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function resolveFetchUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('http')) return url;
  return `${API_BASE_URL}${url}`;
}

async function decodeUrl(url: string, name: string): Promise<AudioBuffer> {
  const res = await fetch(resolveFetchUrl(url));
  const arr = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await decodeAudioFile(ctx, arr, {
      fileName: name,
      fileSize: arr.byteLength,
      fileSizeMB: arr.byteLength / (1024 * 1024),
      mimeType: 'audio/wav',
    });
  } finally {
    await ctx.close();
  }
}

/**
 * When a chain contains an enabled, already-processed server-rendered stage
 * (Stable Audio or a backend post-effect), the editor previews from that
 * stage's result: the audio the user sees/hears is the server output, and only
 * the effects AFTER it run live. Bypassing the stage (or before processing)
 * falls back to the original clip + full chain.
 */
function lastServerResultUrl(chain: FxChain): string | null {
  for (let i = chain.instances.length - 1; i >= 0; i--) {
    const inst = chain.instances[i];
    if (isServerRenderedInstance(inst) && inst.enabled && inst.params.renderedUrl) {
      return inst.params.renderedUrl;
    }
  }
  return null;
}

function previewChainFor(chain: FxChain): FxChain {
  for (let i = chain.instances.length - 1; i >= 0; i--) {
    const inst = chain.instances[i];
    if (isServerRenderedInstance(inst) && inst.enabled && inst.params.renderedUrl) {
      return { ...chain, instances: chain.instances.slice(i + 1) };
    }
  }
  return chain;
}

/**
 * Foley sound editor window.
 *
 * Usage:
 * ```tsx
 * <SoundEditorWindow />
 * ```
 */
export function SoundEditorWindow() {
  const soundId = useUIStore((s) => s.soundEditorSoundId);
  const setSoundEditorSoundId = useUIStore((s) => s.setSoundEditorSoundId);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds) as SoundEvent[];
  const patchSoundEvent = useSoundscapeStore((s) => s.patchSoundEvent);
  const event = generatedSounds.find((e) => e.id === soundId) ?? null;
  const chain = useSoundFxStore((s) => (soundId ? s.chains[soundId] : undefined)) ?? emptyFxChain();
  const ensureChain = useSoundFxStore((s) => s.ensureChain);
  const setRegions = useSoundFxStore((s) => s.setRegions);
  const patchInstanceParams = useSoundFxStore((s) => s.patchInstanceParams);
  const expandedId = useSoundFxStore((s) => s.expandedId);
  const copyChainTo = useSoundFxStore((s) => s.copyChainTo);
  const globalBaseDbfs = useAudioControlsStore((s) => s.globalBaseDbfs);

  const engineRef = useRef<FxEngine | null>(null);
  /** Which sound the current engine belongs to, so a source swap reuses it. */
  const engineSoundIdRef = useRef<string | null>(null);
  /** Decoded ORIGINAL clip — always the Stable Audio source and the Save base. */
  const sourceBufferRef = useRef<AudioBuffer | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [applyToAll, setApplyToAll] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const chainRef = useRef(chain);
  chainRef.current = chain;
  const { rect, startDrag, startResize } = useFloatingWindow({
    storageKey: FLOATING_WINDOW.SOUND_EDITOR_STORAGE_KEY,
    defaultSize: FLOATING_WINDOW.SOUND_EDITOR_DEFAULT_SIZE,
    active: !!soundId && !!event,
  });

  // The waveform/preview follows the last processed server-rendered stage when
  // enabled and ready; bypassing it reverts to the original sound.
  const serverResultUrl = lastServerResultUrl(chain);
  const displayUrl = serverResultUrl ?? event?.url ?? '';

  const variants = event
    ? generatedSounds
        .filter((e) => e.prompt_index === event.prompt_index)
        .sort((a, b) => ((a as SoundEvent & { copy_index?: number }).copy_index ?? 0) - ((b as SoundEvent & { copy_index?: number }).copy_index ?? 0))
    : [];

  useEffect(() => {
    if (!soundId || !event) return;
    ensureChain(soundId, event.fx ?? null);
  }, [soundId, event, ensureChain]);

  // 1. Decode + register the ORIGINAL clip (Stable Audio source + Save base).
  useEffect(() => {
    if (!soundId || !event?.url) return;
    let cancelled = false;
    void decodeUrl(event.url, event.display_name || soundId)
      .then((decoded) => {
        if (cancelled) return;
        sourceBufferRef.current = decoded;
        registerStableAudioSource(soundId, decoded);
      })
      .catch((err) => console.warn('[SoundEditor] failed to decode source', err));
    return () => { cancelled = true; };
  }, [soundId, event?.url]);

  // Dispose the engine only when the edited SOUND changes — a source swap
  // (original ↔ Stable Audio result) must reuse it so playback is uninterrupted.
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      engineSoundIdRef.current = null;
      setAnalyser(null);
    };
  }, [soundId]);

  // 2. Build/reuse the preview engine. A changed effective source crossfades in
  //    place, keeping the playhead position and play state (no restart, no double).
  useEffect(() => {
    if (!soundId || !event || !displayUrl) return;
    const reqSoundId = soundId;
    const reqUrl = displayUrl;
    let cancelled = false;
    const load = async () => {
      const decoded = await decodeUrl(reqUrl, event.display_name || reqSoundId);
      if (cancelled) return;
      const fullChain =
        useSoundFxStore.getState().chains[reqSoundId] ?? event.fx ?? emptyFxChain();
      const pc = previewChainFor(fullChain);
      if (!engineRef.current || engineSoundIdRef.current !== reqSoundId) {
        engineRef.current?.dispose();
        const engine = new FxEngine(pc);
        await engine.init(decoded);
        engine.subscribe(() => {
          setPlaying(engine.isPlaying);
          setCurrentTime(engine.currentTime);
        });
        engineRef.current = engine;
        engineSoundIdRef.current = reqSoundId;
        setAnalyser(engine.getAnalyser());
      } else {
        await engineRef.current.crossfadeToBuffer(decoded);
        await engineRef.current.setChain(pc);
      }
      if (!cancelled) setBuffer(decoded);
    };
    void load().catch((err) => {
      console.warn('[SoundEditor] failed to load buffer', err);
      if (!cancelled) notifyError('Could not load this sound for editing');
    });
    return () => { cancelled = true; };
  }, [soundId, event?.url, displayUrl]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const eng = engineRef.current;
      if (eng) setCurrentTime(eng.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSoundEditorSoundId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSoundEditorSoundId]);

  const rebuild = useCallback(() => {
    const sid = useUIStore.getState().soundEditorSoundId;
    if (!sid) return;
    const next = useSoundFxStore.getState().chains[sid] ?? emptyFxChain();
    void engineRef.current?.setChain(previewChainFor(next));
  }, []);

  const getLevels = useCallback(
    () => engineRef.current?.getOutputLevels() ?? { left: 0, right: 0 },
    [],
  );

  const handlePlayPause = () => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.isPlaying) eng.pause();
    else void eng.play();
  };

  const handleStop = () => engineRef.current?.stop();

  const handleSave = async (targets: string[]) => {
    if (!sourceBufferRef.current || !soundId) return;
    setSaving(true);
    try {
      const ids = targets.length > 0 ? targets : [soundId];
      if (ids.length > 1) copyChainTo(soundId, ids);
      const current = useSoundFxStore.getState().chains[soundId] ?? chain;
      for (const id of ids) {
        const c: FxChain = useSoundFxStore.getState().chains[id] ?? current;
        const target = generatedSounds.find((e) => e.id === id);
        if (!target?.url) continue;
        const srcBuffer = id === soundId && sourceBufferRef.current
          ? sourceBufferRef.current
          : await decodeUrl(target.url, target.display_name || id);
        // Chains with a server-rendered stage (Stable Audio / noise reduction /
        // trim silence) are rendered around the locally-bounced segments;
        // otherwise use the plain offline bounce.
        const blob = chainHasServerStage(c)
          ? await renderFxChainToWav(srcBuffer, c, decodeUrl)
          : await renderFxToWav(srcBuffer, c);
        const result = await apiService.calibrateAudio(blob, globalBaseDbfs ?? DEFAULT_DBFS, false, false);
        if (target.fx_url) invalidatePeaks(target.fx_url);
        invalidatePeaks(result.url);
        patchSoundEvent(id, { fx: c, fx_url: result.url, fx_enabled: true });
      }
      setSoundEditorSoundId(null);
    } catch (err) {
      console.error('[SoundEditor] save failed', err);
      notifyError('Could not save the edited sound');
    } finally {
      setSaving(false);
    }
  };

  if (!soundId || !event) return null;

  const duration = buffer?.duration ?? 0;

  // When a Stable Audio · Inpaint row is expanded, the waveform edits that
  // effect's replace-regions (red) instead of the chain's keep/crop regions.
  const activeSa3Inpaint = chain.instances.find(
    (i): i is Extract<FxInstance, { type: 'stableAudioInpaint' }> =>
      i.instanceId === expandedId && i.type === 'stableAudioInpaint',
  );
  const canvasRegions: FxRegion[] = activeSa3Inpaint
    ? (activeSa3Inpaint.params.regions ?? [])
    : (chain.regions ?? []);
  const canvasRegionVariant = activeSa3Inpaint ? 'inpaint' : 'keep';
  const canvasRegionKey = activeSa3Inpaint ? `${activeSa3Inpaint.instanceId}:inpaint` : 'crop';
  const handleCanvasRegionsChange = (regions: FxRegion[]) => {
    if (activeSa3Inpaint) {
      patchInstanceParams(soundId, activeSa3Inpaint.instanceId, {
        ...activeSa3Inpaint.params,
        regions,
        renderedUrl: undefined,
        renderedSignature: undefined,
      } as StableAudioParams);
      return;
    }
    setRegions(soundId, regions);
    rebuild();
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Sound editor"
      className="fixed inset-0 z-[60] pointer-events-none"
    >
      <div
        className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg flex flex-col pointer-events-auto absolute"
        style={{
          left: rect?.x ?? 0,
          top: rect?.y ?? 0,
          width: rect?.w ?? FLOATING_WINDOW.SOUND_EDITOR_DEFAULT_SIZE.w,
          height: rect?.h ?? FLOATING_WINDOW.SOUND_EDITOR_DEFAULT_SIZE.h,
          visibility: rect ? 'visible' : 'hidden',
          border: '1px solid var(--color-overlay-border)',
          borderRadius: `${UI_BORDER_RADIUS.LG}px`,
          background: 'var(--color-overlay-bg)',
        }}
      >
        <ResizeHandles onStart={startResize} />
        <div
          className="flex items-center justify-between px-4 py-3 cursor-move select-none touch-none"
          style={{ borderBottom: '1px solid var(--color-border)' }}
          onPointerDown={startDrag}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              {event.display_name || 'Sound'}
            </p>
            <p className="text-[10px] text-secondary-hover">Edit this sample before it enters the room</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {variants.length > 1 && variants.map((v, i) => (
              <button
                key={v.id}
                type="button"
                className="text-[10px] w-5 h-5 rounded"
                style={{
                  background: v.id === soundId ? 'var(--color-primary)' : 'transparent',
                  color: v.id === soundId ? 'var(--color-on-blue)' : 'var(--color-secondary-hover)',
                  border: '1px solid var(--color-border-strong)',
                }}
                onClick={() => setSoundEditorSoundId(v.id)}
              >
                {String.fromCharCode(65 + i)}
              </button>
            ))}
            <button
              type="button"
              className="text-xs text-secondary-hover hover:text-foreground px-1"
              onClick={() => setSoundEditorSoundId(null)}
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 card-stack">
          {event.url ? (
            <SoundEditorCanvas
              audioUrl={resolveFetchUrl(displayUrl)}
              currentTime={currentTime}
              duration={duration}
              isPlaying={playing}
              regions={canvasRegions}
              regionVariant={canvasRegionVariant}
              regionKey={canvasRegionKey}
              getLevels={getLevels}
              onSeek={(t) => engineRef.current?.seek(t)}
              onRegionsChange={handleCanvasRegionsChange}
            />
          ) : (
            <p className="text-xs text-secondary-hover">No audio loaded.</p>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs text-secondary-hover">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePlayPause}
                disabled={!buffer}
                className="w-7 h-7 flex items-center justify-center rounded-full"
                style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', opacity: buffer ? 1 : 0.5, border: 'none' }}
                title={playing ? 'Pause' : 'Play'}
              >
                {playing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={handleStop}
                disabled={!playing}
                className="w-7 h-7 flex items-center justify-center rounded-full"
                style={{
                  background: playing ? 'var(--color-surface)' : 'var(--color-secondary-lighter)',
                  color: playing ? 'var(--color-error)' : 'var(--color-secondary-hover)',
                  border: '1px solid var(--color-border-strong)',
                }}
                title="Stop"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            </div>
          </div>

          <FxStack
            soundId={soundId}
            chain={chain}
            analyser={analyser}
            sampleRate={buffer?.sampleRate ?? 44100}
            onBypass={(id, enabled) => engineRef.current?.setInstanceBypass(id, enabled)}
            onParamsLive={(id: string, params: FxParams) => engineRef.current?.updateInstanceParams(id, params)}
            onStructuralChange={rebuild}
            isSpeech={normalizeSoundCategory(event?.category) === 'speech'}
          />
        </div>

        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div
            className={`flex items-center gap-2 ${saving || variants.length < 2 ? 'opacity-40' : ''}`}
            title={variants.length < 2 ? 'Only one variant' : undefined}
          >
            <span
              className="text-xs transition-colors"
              style={{ color: applyToAll ? 'var(--color-primary)' : 'var(--color-secondary-hover)' }}
            >
              Apply to all variants
            </span>
            <span
              role="switch"
              aria-checked={applyToAll}
              aria-disabled={saving || variants.length < 2}
              className={`toggle-switch ${applyToAll ? 'checked' : ''}`}
              style={saving || variants.length < 2 ? { pointerEvents: 'none' } : undefined}
              onClick={() => setApplyToAll((v) => !v)}
            />
          </div>
          <button
            type="button"
            disabled={saving || !buffer}
            onClick={() => void handleSave(applyToAll ? variants.map((v) => v.id) : [soundId])}
            className="text-xs font-medium px-3 py-1.5 rounded disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)' }}
          >
            {saving ? <span className="inline-flex items-center gap-1"><Spinner /> Saving</span> : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

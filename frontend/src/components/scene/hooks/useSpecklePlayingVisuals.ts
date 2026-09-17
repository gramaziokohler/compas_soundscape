import { useEffect, useRef } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useAudioControlsStore } from '@/store';
import { getPreviewLevel } from '@/lib/audio/previewRegistry';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { SoundEvent } from '@/types';

/** Level sampling cadence (ms) — ~30 Hz is smooth without per-frame audio reads. */
const SAMPLE_INTERVAL_MS = 33;

/**
 * Realtime playing visuals.
 *
 * Publishes the currently-playing prompt set + per-prompt level to the
 * SoundSphereManager every sampled frame. In dark mode the manager also uses
 * this to modulate each sound's point-light intensity and to promote only the
 * playing lights (bounded by the shadow budget), which is what keeps multiple
 * sources from tanking the frame rate. The sphere scale "pulse" itself is
 * applied by the manager's per-frame screen-space update, so it works in every
 * view mode.
 *
 * Sources:
 *  - DAW timeline → AudioOrchestrator voices (exact getPlayingSourceIds).
 *  - Single card preview → WaveSurfer decode-buffer RMS (previewRegistry).
 */
export function useSpecklePlayingVisuals({
  isViewerReady,
  audioOrchestrator,
  showPlayingHighlight,
  isDarkMode,
  soundscapeData,
  previewingSoundId,
}: {
  isViewerReady: boolean;
  audioOrchestrator: AudioOrchestrator | null;
  /** Advanced Settings → Display. When false, highlight only runs in dark mode. */
  showPlayingHighlight: boolean;
  /** Dark mode always runs the light reactivity, regardless of the toggle. */
  isDarkMode: boolean;
  soundscapeData: SoundEvent[] | null;
  previewingSoundId: string | null;
}) {
  const rafRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const hadPlayingRef = useRef(false);

  // Track-level mute/solo. A muted (or non-soloed while solo is active) track
  // must not drive the sphere scale pulse nor its dark-mode point light, even
  // though its source is still technically "playing" in the orchestrator
  // (mute is applied as a zero gain, so getPlayingSourceIds still reports it).
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound = useAudioControlsStore((s) => s.soloedSound);

  useEffect(() => {
    if (!isViewerReady) return;

    const { coordinator, viewer } = useSpeckleEngineStore.getState();
    const soundSphereManager = coordinator?.getSoundSphereManager();
    if (!soundSphereManager || !viewer) return;

    const highlightEnabled = isDarkMode || showPlayingHighlight;

    // sound id → prompt index. Variants collapse to one sphere/prompt.
    const idToPrompt = new Map<string, number>();
    (soundscapeData ?? []).forEach((s) => {
      if ((s as { isPending?: boolean }).isPending) return;
      idToPrompt.set(s.id, (s as { prompt_index?: number }).prompt_index ?? 0);
    });

    // Prompt indices that are actually audible. Under solo, only the soloed
    // track is audible; otherwise any track with a non-muted variant is.
    const audiblePrompt = new Set<number>();
    (soundscapeData ?? []).forEach((s) => {
      if ((s as { isPending?: boolean }).isPending) return;
      const pi = (s as { prompt_index?: number }).prompt_index ?? 0;
      if (soloedSound !== null) {
        if (s.id === soloedSound) audiblePrompt.add(pi);
      } else if (!mutedSounds.has(s.id)) {
        audiblePrompt.add(pi);
      }
    });

    const clearAll = () => {
      soundSphereManager.setIdleLightsOff(false);
      soundSphereManager.setPlayingPrompts([], new Map());
      soundSphereManager.getSoundSphereMeshes().forEach((mesh) => {
        const id = mesh.userData.soundEvent?.id as string | undefined;
        if (id) soundSphereManager.setSoundLightReactive(id, false, 0);
      });
      (soundscapeData ?? []).forEach((s) => {
        if (s.entity_index !== undefined) {
          soundSphereManager.setSoundLightReactive(s.id, false, 0);
        }
      });
      soundSphereManager.setShadowCasters([]);
    };

    // No highlight anywhere → make sure any previously applied state is reset once.
    if (!highlightEnabled) {
      clearAll();
      hadPlayingRef.current = false;
      viewer.requestRender();
      return;
    }

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
      lastSampleRef.current = now;

      const playingIds = new Set<string>();
      if (audioOrchestrator) {
        audioOrchestrator.getPlayingSourceIds().forEach((id) => playingIds.add(id));
      }
      // Card preview is the one currently-previewing sound (WaveSurfer path).
      if (previewingSoundId) playingIds.add(previewingSoundId);

      const promptLevels = new Map<number, number>();
      let audiblePlayingCount = 0;
      playingIds.forEach((id) => {
        const promptIdx = idToPrompt.get(id);
        if (promptIdx === undefined) return;
        // Muted / non-soloed tracks stay silent: no pulse, no light.
        if (!audiblePrompt.has(promptIdx)) return;
        audiblePlayingCount++;

        let level: number;
        if (id === previewingSoundId) {
          level = getPreviewLevel(id);
        } else if (audioOrchestrator?.hasSource(id)) {
          level = audioOrchestrator.getSourceLevel(id);
        } else {
          level = getPreviewLevel(id);
        }

        const prev = promptLevels.get(promptIdx) ?? 0;
        if (level > prev) promptLevels.set(promptIdx, level);
      });

      const playingPrompts = new Set(promptLevels.keys());
      soundSphereManager.setPlayingPrompts(playingPrompts, promptLevels);
      // While anything is sounding, hide every non-playing light so the scene
      // goes dark and only the active source(s) remain lit.
      soundSphereManager.setIdleLightsOff(audiblePlayingCount > 0);

      // Lights: mesh lights are keyed by the visible variant's id; entity/marker
      // lights by the sound id. Promote only playing lights to shadow casters.
      //
      // Re-assert the per-light mute flag here too: dark-mode lights may be
      // created AFTER a track was already muted (enable-dark-mode doesn't replay
      // mute), so the manager's copy would otherwise stay unmuted and the muted
      // sphere's light would leak into the scene.
      const shadowCasters: string[] = [];
      (soundscapeData ?? []).forEach((s) => {
        if ((s as { isPending?: boolean }).isPending) return;
        const idMuted = mutedSounds.has(s.id)
          || (soloedSound !== null && s.id !== soloedSound);
        soundSphereManager.setSourceMuted(s.id, idMuted);
      });
      soundSphereManager.getSoundSphereMeshes().forEach((mesh) => {
        const ev = mesh.userData.soundEvent as SoundEvent | undefined;
        const id = ev?.id;
        if (!id) return;
        const promptIdx = (ev as { prompt_index?: number } | undefined)?.prompt_index ?? 0;
        const playing = playingPrompts.has(promptIdx);
        soundSphereManager.setSoundLightReactive(id, playing, promptLevels.get(promptIdx) ?? 0);
        if (playing) shadowCasters.push(id);
      });
      (soundscapeData ?? []).forEach((s) => {
        if (s.entity_index === undefined) return;
        const promptIdx = (s as { prompt_index?: number }).prompt_index ?? 0;
        const playing = playingPrompts.has(promptIdx);
        soundSphereManager.setSoundLightReactive(s.id, playing, promptLevels.get(promptIdx) ?? 0);
        if (playing) shadowCasters.push(s.id);
      });
      soundSphereManager.setShadowCasters(shadowCasters);

      const anyPlaying = playingPrompts.size > 0;
      if (anyPlaying || hadPlayingRef.current) viewer.requestRender();
      hadPlayingRef.current = anyPlaying;
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      clearAll();
      hadPlayingRef.current = false;
      useSpeckleEngineStore.getState().viewer?.requestRender();
    };
  }, [isViewerReady, audioOrchestrator, showPlayingHighlight, isDarkMode, soundscapeData, previewingSoundId, mutedSounds, soloedSound]);
}

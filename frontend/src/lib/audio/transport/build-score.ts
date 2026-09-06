/**
 * Builds a declarative `TimelineScore` from the current `TimelineSound[]` (already
 * computed by `extractTimelineSoundsFromData`) plus per-iteration overrides pulled
 * live from `audioControlsStore`.
 *
 * This is a pure, synchronous transform — calling it repeatedly (e.g. once per
 * store change) is cheap and always reflects the exact state that produced the
 * currently-drawn DAW blocks, which is what keeps "what you see" and "what you
 * hear" from diverging.
 */

import type { TimelineSound } from '@/types/audio';
import type { TimelineScore, ScoreTrack, ScoreClip } from './score';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { resolveVariantSoundIdByPrompt } from '@/lib/audio/utils/variant-sound-id';
import { AUDIO_PLAYBACK } from '@/utils/constants';

export function buildScoreFromTimelineSounds(
  timelineSounds: TimelineSound[],
  timelineDurationMs: number,
): TimelineScore {
  const { iterationLinks, soundTrims, soundLoopable } = useAudioControlsStore.getState();
  // Full sibling list for prompt_index-based variant resolution — works for every
  // id shape (including duplicated/AI-detected tracks), unlike string parsing.
  const generatedSounds = useSoundscapeStore.getState().generatedSounds;

  const tracks: ScoreTrack[] = timelineSounds.map((ts): ScoreTrack => {
    const trim = soundTrims[ts.id];
    const loopable = !!soundLoopable[ts.id];
    const trimStartFraction = trim?.start ?? 0;

    const clips: ScoreClip[] = ts.scheduledIterations.map((startMs, i): ScoreClip => {
      const originalIdx = ts.scheduledIterationOriginalIndices?.[i] ?? i;
      const link = iterationLinks[`${ts.id}-${originalIdx}`];
      const durationMs = ts.iterationDurationsMs?.[i] ?? ts.soundDurationMs;
      const variantIndex = link?.variantIndex ?? 0;
      const sourceId = resolveVariantSoundIdByPrompt(ts.id, variantIndex, ts.promptIndex, generatedSounds);

      return {
        clipId: `${ts.id}-${originalIdx}`,
        startMs,
        durationMs,
        sourceId,
        trimStartFraction,
        fadeInMs: loopable ? AUDIO_PLAYBACK.LOOPABLE_SEAM_FADE_MS : undefined,
        fadeOutMs: loopable ? AUDIO_PLAYBACK.LOOPABLE_SEAM_FADE_MS : undefined,
        position: link?.entityPosition,
      };
    });

    return { trackId: ts.id, clips };
  });

  return { durationMs: timelineDurationMs, tracks };
}

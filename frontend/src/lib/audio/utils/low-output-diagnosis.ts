/**
 * Low-output diagnosis
 *
 * Pure rules that turn an `OutputDiagnostics` snapshot into the single most
 * useful helper hint for the user. Rules are ordered from "nothing can be heard
 * at all" to "something is attenuating the mix", walking the signal chain:
 * browser → master → mute/solo → track faders → IR / distance → fallback.
 *
 * The caller decides *when* the output is too quiet (sustained low level while
 * playing); this module only decides *why*.
 *
 * Usage:
 * ```ts
 * const hint = diagnoseLowOutput(diag, { normalizeEnabled, timelineOpen });
 * ```
 */

import { LOW_OUTPUT_HINT } from '@/utils/constants';
import type {
  LowOutputHint,
  OutputDiagnostics,
  OutputSourceDiagnostics,
} from '@/types/audio';

export interface LowOutputContext {
  /** IR peak normalization is already on (global audio setting). */
  normalizeEnabled: boolean;
  /** The DAW timeline panel is open (no need to offer opening it). */
  timelineOpen: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function openTimelineAction(ctx: LowOutputContext): LowOutputHint['action'] {
  return ctx.timelineOpen ? null : { kind: 'open-timeline', label: 'Open timeline' };
}

/** Closest source with a known distance, or null. */
function nearest(sources: OutputSourceDiagnostics[]): OutputSourceDiagnostics | null {
  let best: OutputSourceDiagnostics | null = null;
  for (const s of sources) {
    if (s.distance === null) continue;
    if (!best || s.distance < (best.distance as number)) best = s;
  }
  return best;
}

/**
 * Pick the hint that explains a quiet output, or null when there is nothing
 * playing to explain.
 */
export function diagnoseLowOutput(
  diag: OutputDiagnostics,
  ctx: LowOutputContext,
): LowOutputHint | null {
  if (diag.contextState !== 'running') {
    return {
      id: 'context-suspended',
      message: 'The browser has paused audio for this page.',
      action: { kind: 'resume-audio', label: 'Enable audio' },
    };
  }

  if (diag.sources.length === 0) return null;

  if (diag.masterVolume <= LOW_OUTPUT_HINT.MASTER_LOW) {
    return {
      id: 'master-low',
      message: diag.masterVolume === 0
        ? 'Master volume is muted.'
        : `Master volume is at ${Math.round(diag.masterVolume * 100)}%.`,
      action: { kind: 'raise-master', label: 'Turn up' },
    };
  }

  const audible = diag.sources.filter((s) => !s.muted);
  if (audible.length === 0) {
    return {
      id: 'all-muted',
      message: `All ${plural(diag.sources.length, 'playing sound')} are muted or soloed out.`,
      action: { kind: 'unmute-all', label: 'Unmute all' },
    };
  }

  // Post-fader meters are below the mute stage: if they are quiet, the track
  // volumes (or the sounds themselves) are the cause, not the spatial chain.
  const loud = audible.filter((s) => s.level >= LOW_OUTPUT_HINT.SOURCE_QUIET_LEVEL);
  if (loud.length === 0) {
    return {
      id: 'tracks-quiet',
      message: 'The playing tracks are very quiet. Raise their volume in the timeline.',
      action: openTimelineAction(ctx),
    };
  }

  // AMBISONIC_IR: sounds outside every simulated source position play through a zero IR.
  const withIR = loud.filter((s) => s.ir !== null);
  if (withIR.length > 0) {
    const silenced = withIR.filter((s) => s.ir?.state === 'silenced');
    if (silenced.length === withIR.length) {
      return {
        id: 'out-of-simulation',
        message: `${plural(silenced.length, 'playing sound')} ${silenced.length === 1 ? 'is' : 'are'} outside the simulated source positions, so the simulation mutes ${silenced.length === 1 ? 'it' : 'them'}. Move ${silenced.length === 1 ? 'it' : 'them'} onto a simulated source or re-run the simulation.`,
        action: null,
      };
    }

    const convolved = withIR.filter((s) => s.ir?.state === 'convolved');
    if (convolved.length > 0) {
      const loudestIRDb = Math.max(...convolved.map((s) => s.ir?.gainDb ?? -Infinity));
      if (loudestIRDb < LOW_OUTPUT_HINT.LOW_IR_GAIN_DB) {
        return {
          id: 'low-ir',
          message: ctx.normalizeEnabled
            ? `The active simulation's impulse responses are very quiet (${Math.round(loudestIRDb)} dB). Raise the IR gain in the simulation card.`
            : `The active simulation's impulse responses are very quiet (${Math.round(loudestIRDb)} dB).`,
          action: ctx.normalizeEnabled ? null : { kind: 'normalize-irs', label: 'Normalize IRs' },
        };
      }
    }
  }

  // 6DOF modes: amplitude falls with distance from the camera/listener.
  const closest = nearest(loud);
  if (closest && (closest.distance as number) > LOW_OUTPUT_HINT.FAR_DISTANCE_M) {
    return {
      id: 'too-far',
      message: `The camera is ${Math.round(closest.distance as number)} m from the nearest playing sound.`,
      action: { kind: 'move-closer', label: 'Move closer' },
      target: closest.position,
    };
  }

  return {
    id: 'generic',
    message: 'Playback is very quiet. Check the track volumes, or your system volume.',
    action: openTimelineAction(ctx),
  };
}

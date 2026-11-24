/**
 * Short chat labels for applied scene-edit ops ("Background −6 dB", "+ Marc at 0:25").
 */

import type { SceneEditOp } from '@/types/sceneEdit';
import { formatMmSs } from './sceneCards';

const MINUS = '−';

function signedDb(db: number): string {
  const r = Math.round(db * 10) / 10;
  return r < 0 ? `${MINUS}${Math.abs(r)} dB` : `+${r} dB`;
}

function times(ts: number[]): string {
  return ts.map(formatMmSs).join(', ');
}

/** One label per op; `names` maps refs (S1 / N1) to the sound's display name. */
export function sceneEditOpLabel(op: SceneEditOp, names: Record<string, string>): string {
  const who = op.targets.map((t) => names[t] ?? t).join(', ');
  switch (op.op) {
    case 'set_level':
      return op.delta_db !== null ? `${who} ${signedDb(op.delta_db)}` : `${who} at ${op.db} dBFS`;
    case 'mute': return `Muted ${who}`;
    case 'unmute': return `Unmuted ${who}`;
    case 'solo': return `Solo ${who}`;
    case 'unsolo': return `Unsolo ${who}`;
    case 'set_loopable': return `${who} ${op.on === false ? 'no longer loops' : 'loops'}`;
    case 'trim': return `Trimmed ${who}`;
    case 'set_times': return `${who} at ${times(op.times_s)}`;
    case 'shift': return `${who} moved ${(op.delta_s ?? 0) > 0 ? 'later' : 'earlier'} by ${Math.abs(op.delta_s ?? 0)} s`;
    case 'set_density':
      return op.count !== null ? `${who} × ${op.count}` : `${who} every ${op.interval_s} s`;
    case 'remove_occurrences': return `Removed ${who} at ${times(op.times_s)}`;
    case 'set_scene_duration': return `Scene length ${formatMmSs(op.seconds ?? 0)}`;
    case 'move': return `Moved ${who}`;
    case 'set_directivity': return `${who} directivity: ${op.preset}`;
    case 'add_sound':
      return `+ ${op.name}${op.times_s.length ? ` at ${times(op.times_s)}` : ''}${(op.count ?? 1) > 1 ? ` (${op.count} variants)` : ''}`;
    case 'remove': return `Removed ${who}`;
    case 'change_sound': return `New sound for ${who}`;
    case 'regenerate': return `New take of ${who}`;
    case 'set_variants': return `${who}: ${op.count} variants`;
    case 'add_speaker':
      return `+ ${op.character}${op.times_s.length ? ` at ${times(op.times_s)}` : ''}`;
    case 'edit_lines': return `Rewrote ${who}'s lines`;
    case 'change_voice': return `${who} now voiced by ${op.character}`;
    case 'set_style': return op.style ? `${who} speaks: ${op.style}` : `${who} speaks normally`;
    case 'rename_scene': return `Renamed to “${op.title}”`;
    default: return op.op;
  }
}

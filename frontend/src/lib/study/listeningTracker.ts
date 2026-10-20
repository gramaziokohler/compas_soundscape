import { STUDY_LOG } from '@/utils/constants';
import { isStudyFeatureEnabled, isStudyLoggingEnabled, logStudyEvent, newStudyId } from '@/lib/study/studyLogger';
import { captureStudySnapshot } from '@/lib/study/snapshot';
import type { StudyListenerState } from '@/types/study';

/**
 * Listening sessions: what was heard, from where, in which rendering setup.
 *
 *   listen.start {session_id, started_at, scope, sound_id, position_ms,
 *                 playing_source_ids, listener, render_mode, engine_mode,
 *                 active_simulation, selected_ir_id, muted, soloed,
 *                 master_volume, snapshot_hash}
 *   listen.pose  {session_id, position, orientation}   (feature pose_sampling, 1 Hz max)
 *   listen.stop  {session_id, listened_ms, end_position_ms, reason}
 *
 * The context is read synchronously at the click (cheap getters); the
 * snapshot hash resolves on idle, so `listen.start` is logged a moment later
 * with the true click time in `started_at`. `listen.stop` is chained after it,
 * so the two are always in order even for a very short listen.
 */

export type ListeningScope = 'timeline' | 'preview';

/** Everything the tracker reads about the current listening setup. */
export interface StudyListeningContext {
  position_ms: number | null;
  playing_source_ids: string[];
  listener: StudyListenerState;
  render_mode: string | null;
  engine_mode: string | null;
  active_simulation: { index: number; engine: string | null } | null;
  selected_ir_id: string | null;
  muted: string[];
  soloed: string[];
  master_volume: number | null;
}

interface Session {
  id: string;
  scope: ListeningScope;
  soundId: string | null;
  startedAt: number;
  startLogged: Promise<void>;
  poseTimer: ReturnType<typeof setInterval> | null;
  lastPose: StudyListenerState | null;
}

let _provider: (() => StudyListeningContext) | null = null;
let _session: Session | null = null;

/** Registered by useStudyLogging (it can reach the stores / orchestrator). */
export function setStudyListeningContextProvider(provider: (() => StudyListeningContext) | null): void {
  _provider = provider;
}

function readContext(): StudyListeningContext | null {
  try {
    return _provider ? _provider() : null;
  } catch {
    return null;
  }
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function poseMoved(prev: StudyListenerState | null, next: StudyListenerState): boolean {
  if (!prev?.position || !next.position) return prev?.position !== next.position;
  const [ax, ay, az] = prev.position;
  const [bx, by, bz] = next.position;
  if (Math.hypot(ax - bx, ay - by, az - bz) >= STUDY_LOG.POSE_MIN_DELTA_M) return true;
  if (!prev.orientation || !next.orientation) return false;
  return (
    angleDelta(prev.orientation.yaw, next.orientation.yaw) >= STUDY_LOG.POSE_MIN_DELTA_DEG ||
    angleDelta(prev.orientation.pitch, next.orientation.pitch) >= STUDY_LOG.POSE_MIN_DELTA_DEG
  );
}

function samplePose(session: Session): void {
  const ctx = readContext();
  if (!ctx || !poseMoved(session.lastPose, ctx.listener)) return;
  session.lastPose = ctx.listener;
  const sessionId = session.id;
  const listener = ctx.listener;
  void session.startLogged.then(() =>
    logStudyEvent('listen.pose', { session_id: sessionId, listener }),
  );
}

/** Open a listening session (closes any open one first). */
export function startStudyListening(scope: ListeningScope, soundId: string | null = null): void {
  try {
    if (_session) stopStudyListening('replaced');
    const ctx = readContext();
    const startedAt = Date.now();
    const id = newStudyId();
    const startLogged = captureStudySnapshot().then((snapshotHash) => {
      logStudyEvent('listen.start', {
        session_id: id,
        started_at: startedAt,
        scope,
        sound_id: soundId,
        ...(ctx ?? {}),
        snapshot_hash: snapshotHash,
      });
    });
    const session: Session = {
      id,
      scope,
      soundId,
      startedAt,
      startLogged,
      poseTimer: null,
      lastPose: ctx?.listener ?? null,
    };
    if (isStudyFeatureEnabled('pose_sampling')) {
      session.poseTimer = setInterval(() => samplePose(session), STUDY_LOG.POSE_SAMPLE_INTERVAL_MS);
    }
    _session = session;
  } catch {
    _session = null;
  }
}

/** Close the open listening session, if any. */
export function stopStudyListening(reason: string): void {
  const session = _session;
  if (!session) return;
  _session = null;
  try {
    if (session.poseTimer) clearInterval(session.poseTimer);
    const listenedMs = Date.now() - session.startedAt;
    const endPositionMs = readContext()?.position_ms ?? null;
    void session.startLogged.then(() =>
      logStudyEvent('listen.stop', {
        session_id: session.id,
        scope: session.scope,
        sound_id: session.soundId,
        listened_ms: listenedMs,
        end_position_ms: endPositionMs,
        reason,
      }),
    );
  } catch {
    // never surface
  }
}

let _seekFromMs: number | null = null;
let _seekToMs = 0;
let _seekTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Timeline seek. A playhead drag seeks many times, so this logs ONE
 * `listen.seek {from_ms, to_ms}` per scrub, once it has settled.
 */
export function noteStudySeek(fromMs: number | null, toMs: number): void {
  if (!isStudyLoggingEnabled()) return;
  try {
    if (_seekFromMs === null) _seekFromMs = fromMs;
    _seekToMs = toMs;
    if (_seekTimer) clearTimeout(_seekTimer);
    _seekTimer = setTimeout(() => {
      logStudyEvent('listen.seek', {
        session_id: _session?.id ?? null,
        from_ms: _seekFromMs,
        to_ms: Math.round(_seekToMs),
      });
      _seekFromMs = null;
      _seekTimer = null;
    }, STUDY_LOG.SEEK_SETTLE_MS);
  } catch {
    // never surface
  }
}

/** Scope of the open session (null when nothing is being listened to). */
export function currentStudyListeningScope(): { scope: ListeningScope; soundId: string | null } | null {
  return _session ? { scope: _session.scope, soundId: _session.soundId } : null;
}

/** Context at this instant (for moments / intent notes). */
export function readStudyListeningContext(): StudyListeningContext | null {
  return readContext();
}

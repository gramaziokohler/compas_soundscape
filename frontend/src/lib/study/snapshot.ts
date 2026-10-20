import { apiService } from '@/services/api';
import { STUDY_LOG } from '@/utils/constants';
import { isStudyFeatureEnabled, logStudyEvent } from '@/lib/study/studyLogger';
import { scheduleIdle } from '@/lib/study/idle';

/**
 * Content-addressed design-state snapshots (risk gate R2 — feature `snapshots`).
 *
 * A snapshot is the full design state as persisted by autosave (page.tsx
 * `buildSavePayload`, minus credentials). Events reference it by hash, so
 * "what changed between two listening sessions" is a diff of two snapshots.
 *
 * Cost control:
 * - a cheap reference fingerprint (one entry per undoable store + the loaded
 *   version) decides whether anything changed — an unchanged state reuses the
 *   last hash with no build at all;
 * - a needed build runs on idle (never between a key press and audio start),
 *   at most once per SNAPSHOT_MIN_INTERVAL_MS, and concurrent callers share it;
 * - uploads are deduplicated (client set + server INSERT OR IGNORE).
 */

let _builder: (() => unknown) | null = null;
let _fingerprint: (() => unknown[]) | null = null;
let _lastParts: unknown[] | null = null;
let _lastHash: string | null = null;
let _lastBuildAt = 0;
let _pending: Promise<string | null> | null = null;
const _uploaded = new Set<string>();

/** Register the state builder + its change fingerprint (page.tsx / useStudyLogging). */
export function registerStudySnapshotSource(
  builder: (() => unknown) | null,
  fingerprint: (() => unknown[]) | null,
): void {
  _builder = builder;
  _fingerprint = fingerprint;
  _lastParts = null;
  _lastHash = null;
}

/** cyrb53 — fast 53-bit string hash (collision-safe enough for ~10⁴ snapshots). */
function cyrb53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

function sameRefs(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** Never store credentials in the research log. */
function dropSecrets(key: string, value: unknown): unknown {
  return key === 'auth_token' ? undefined : value;
}

function buildNow(): string | null {
  if (!_builder || !_fingerprint) return null;
  const started = performance.now();
  const parts = _fingerprint();
  const json = JSON.stringify(_builder(), dropSecrets);
  if (!json) return null;
  const hash = `${cyrb53(json)}${json.length.toString(16)}`;
  const ms = Math.round(performance.now() - started);
  // [dbg:study] R2 risk test — remove once the gate is decided.
  console.log(`[dbg:study] snapshot built in ${ms} ms, ${json.length} chars`);
  _lastParts = parts;
  _lastHash = hash;
  _lastBuildAt = Date.now();

  if (json.length > STUDY_LOG.SNAPSHOT_MAX_BYTES) {
    logStudyEvent('snapshot.too_large', { hash, chars: json.length, build_ms: ms });
    return hash;
  }
  if (!_uploaded.has(hash)) {
    _uploaded.add(hash);
    apiService.postStudySnapshot({ hash, json }).catch(() => _uploaded.delete(hash));
  }
  return hash;
}

/**
 * Hash of the current design state (building / uploading it if it changed).
 * Resolves null when the feature is off or no source is registered.
 * Never rejects.
 */
export function captureStudySnapshot(): Promise<string | null> {
  if (!isStudyFeatureEnabled('snapshots') || !_builder || !_fingerprint) return Promise.resolve(null);
  try {
    if (_lastHash && _lastParts && sameRefs(_fingerprint(), _lastParts)) {
      // [dbg:study] R2 risk test — remove once the gate is decided.
      console.log('[dbg:study] snapshot unchanged — reused, no build');
      return Promise.resolve(_lastHash);
    }
  } catch {
    return Promise.resolve(null);
  }
  if (_pending) return _pending;

  const wait = Math.max(0, _lastBuildAt + STUDY_LOG.SNAPSHOT_MIN_INTERVAL_MS - Date.now());
  _pending = new Promise<string | null>((resolve) => {
    const run = () =>
      scheduleIdle(() => {
        let hash: string | null = null;
        try {
          hash = buildNow();
        } catch {
          hash = null;
        }
        _pending = null;
        resolve(hash);
      }, STUDY_LOG.SNAPSHOT_IDLE_TIMEOUT_MS);
    if (wait > 0) setTimeout(run, wait);
    else run();
  });
  return _pending;
}

/** Last known hash without building (may be stale; null before the first build). */
export function peekStudySnapshotHash(): string | null {
  return _lastHash;
}

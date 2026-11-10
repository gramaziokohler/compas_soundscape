import { apiService } from '@/services/api';
import { MODEL_VERSION_WATCH } from '@/utils/constants';

/** Speckle bundle references (`bundle.<project>.<model>.<version>`) are not viewer-loadable. */
const BUNDLE_REF_PREFIX = 'bundle.';

/** `.../models/<id>[@<old>]` → `.../models/<id>@<versionId>`. */
export function withModelVersion(modelUrl: string, versionId: string): string {
  return `${modelUrl.replace(/(\/models\/[^/@?#]+)@[^/?#]+/, '$1')}@${versionId}`;
}

/** True when a resolved `{version_id, object_id}` is a version the viewer can load. */
export function isLoadableVersion(version: { version_id?: string | null; object_id?: string | null } | null | undefined): boolean {
  return !!version?.version_id && !!version.object_id && !version.object_id.startsWith(BUNDLE_REF_PREFIX);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait until the model's latest version can be loaded by the viewer:
 *  1. the backend reports it ready (`prepare-latest`, which also materializes a
 *     fresh bundle upload in the background), and
 *  2. the viewer's own resolver returns resource URLs for that exact version.
 *
 * Resolves with the loadable version id; throws after
 * `MODEL_VERSION_WATCH.READY_MAX_ATTEMPTS` probes. `isCancelled` stops early (null).
 */
export async function waitForLoadableLatestVersion(
  modelId: string,
  modelUrl: string,
  authToken?: string,
  isCancelled: () => boolean = () => false,
): Promise<string | null> {
  // Loaded lazily: this module is reachable from page-level code, and the viewer
  // bundle must stay out of server rendering.
  const { UrlHelper } = await import('@speckle/viewer');
  for (let attempt = 0; attempt < MODEL_VERSION_WATCH.READY_MAX_ATTEMPTS; attempt++) {
    if (isCancelled()) return null;
    try {
      const latest = await apiService.prepareModelLatestVersion(modelId);
      if (latest?.status === 'ready' && isLoadableVersion(latest) && latest.version_id) {
        const urls = await UrlHelper.getResourceUrls(withModelVersion(modelUrl, latest.version_id), authToken);
        if (urls.length > 0) return latest.version_id;
      }
    } catch (err) {
      // Transient network / Speckle error — keep probing.
      console.warn('[speckleLatestVersion] readiness probe failed, retrying:', err);
    }
    await sleep(MODEL_VERSION_WATCH.READY_POLL_INTERVAL_MS);
  }
  throw new Error(MODEL_VERSION_WATCH.NOT_READY_ERROR);
}

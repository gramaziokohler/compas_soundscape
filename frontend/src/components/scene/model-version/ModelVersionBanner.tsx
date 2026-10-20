'use client';

import { useModelVersionStore, findModelVersion, versionLabel } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useLiveVersionImpact } from '@/hooks/useVersionImpact';
import { formatRelativeTime } from '@/components/scene/modelBrowserShared';
import { CloseIcon } from '@/components/ui/Card';
import type { SpeckleModelVersion } from '@/types/speckle-models';

function byline(v: SpeckleModelVersion | null): string {
  if (!v) return '';
  const parts = [v.author_name, v.created_at && formatRelativeTime(v.created_at)].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * ModelVersionBanner
 *
 * Non-blocking strip at the top of the viewer:
 *  - "vN was loaded … X acoustic surfaces changed since …" with Review changes
 *    and Go back (after an in-session switch, or on open when the model moved
 *    on since the soundscape was last saved);
 *  - "vN was published …" with Load vN, while a newer version exists.
 */
export function ModelVersionBanner() {
  const banner = useModelVersionStore((s) => s.banner);
  const versions = useModelVersionStore((s) => s.versions);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const loadedFrom = banner?.kind === 'loaded' ? banner.fromVersionId : null;
  const loadedTo = banner?.kind === 'loaded' ? banner.toVersionId : null;
  const impact = useLiveVersionImpact(loadedFrom, loadedTo);

  if (!banner) return null;
  const store = useModelVersionStore.getState();

  if (banner.kind === 'published') {
    const v = findModelVersion(versions, banner.versionId);
    const label = versionLabel(versions, banner.versionId);
    return (
      <div className="mv-banner mv-banner--info pointer-events-auto" role="status">
        <span className="flex-1">
          {label} was published{byline(v)}.
          {v?.message ? <span className="mv-muted"> &ldquo;{v.message}&rdquo;</span> : null}
        </span>
        <button
          type="button"
          className="mv-btn mv-btn--primary"
          onClick={() => store.switchToVersion(banner.versionId, loadedVersionId)}
        >
          Load {label}
        </button>
        <button type="button" className="mv-btn" style={{ padding: 3, border: 'none' }} aria-label="Dismiss" onClick={store.dismissBanner}>
          <CloseIcon />
        </button>
      </div>
    );
  }

  const to = findModelVersion(versions, banner.toVersionId);
  const toLabel = versionLabel(versions, banner.toVersionId);
  const fromLabel = versionLabel(versions, banner.fromVersionId);
  const since = banner.reason === 'session' ? 'since your last session' : `since ${fromLabel}`;
  const report = impact?.status === 'ready' ? impact.report : null;
  const changed = report ? report.region_counts.changed + report.region_counts.added + report.region_counts.removed : 0;
  const issues = report ? report.placements.length : 0;

  let summary: string;
  if (!impact || impact.status === 'loading') summary = `Comparing with ${fromLabel}…`;
  else if (impact.status === 'error') summary = `Couldn't compare with ${fromLabel}.`;
  else if (changed === 0 && issues === 0) summary = `No acoustic changes above tolerance ${since}.`;
  else {
    const parts: string[] = [];
    if (changed > 0) parts.push(`${changed} acoustic surface${changed === 1 ? '' : 's'} changed ${since}`);
    if (issues > 0) parts.push(`${issues} listener or sound placement issue${issues === 1 ? '' : 's'}`);
    summary = `${parts.join(', ')}.`;
  }
  const quiet = impact?.status === 'ready' && changed === 0 && issues === 0;

  return (
    <div className={quiet ? 'mv-banner mv-banner--info pointer-events-auto' : 'mv-banner pointer-events-auto'} role="status">
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="3" />
        <line x1="3" y1="12" x2="9" y2="12" />
        <line x1="15" y1="12" x2="21" y2="12" />
      </svg>
      <span className="flex-1">
        {toLabel} was loaded{byline(to)}. {summary}
      </span>
      <button
        type="button"
        className={quiet ? 'mv-btn' : 'mv-btn mv-btn--on-warning'}
        onClick={() => store.openReview(banner.fromVersionId, banner.toVersionId)}
      >
        Review changes
      </button>
      {findModelVersion(versions, banner.fromVersionId) && (
        <button
          type="button"
          className={quiet ? 'mv-btn' : 'mv-btn mv-btn--on-warning'}
          onClick={() => store.switchToVersion(banner.fromVersionId, loadedVersionId)}
        >
          Go back to {fromLabel}
        </button>
      )}
      <button type="button" className="mv-btn" style={{ padding: 3, border: 'none', color: 'inherit' }} aria-label="Dismiss" onClick={store.dismissBanner}>
        <CloseIcon />
      </button>
    </div>
  );
}

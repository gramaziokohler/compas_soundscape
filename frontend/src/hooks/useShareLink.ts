import { useCallback, useEffect, useState } from 'react';
import { apiService } from '@/services/api';
import { notifyError } from '@/store';
import { SHARE_VIEW } from '@/utils/constants';

export interface UseShareLinkResult {
  shareId: string | null;
  /** Absolute `/share/<id>` URL, or null when the model is not shared. */
  shareUrl: string | null;
  busy: boolean;
  create: () => Promise<void>;
  regenerate: () => Promise<void>;
  revoke: () => Promise<void>;
}

/**
 * Owner-side state of a model's public share link (Settings → Share).
 *
 * Usage:
 * ```tsx
 * const { shareUrl, create, revoke } = useShareLink(modelId);
 * ```
 */
export function useShareLink(modelId: string | null): UseShareLinkResult {
  const [shareId, setShareId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShareId(null);
    if (!modelId) return;
    let cancelled = false;
    apiService
      .getShareLink(modelId)
      .then((info) => {
        if (!cancelled) setShareId(info.share_id);
      })
      .catch((err) => console.warn('[share] failed to load share link:', err));
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  const run = useCallback(
    async (request: (id: string) => Promise<{ share_id: string | null }>) => {
      if (!modelId) return;
      setBusy(true);
      try {
        const info = await request(modelId);
        setShareId(info.share_id);
      } catch (err) {
        notifyError(err instanceof Error ? err.message : 'Share link request failed', 'warning');
      } finally {
        setBusy(false);
      }
    },
    [modelId],
  );

  const create = useCallback(() => run((id) => apiService.createShareLink(id)), [run]);
  const regenerate = useCallback(() => run((id) => apiService.regenerateShareLink(id)), [run]);
  const revoke = useCallback(() => run((id) => apiService.revokeShareLink(id)), [run]);

  const shareUrl =
    shareId && typeof window !== 'undefined'
      ? `${window.location.origin}${SHARE_VIEW.ROUTE_PREFIX}/${encodeURIComponent(shareId)}`
      : null;

  return { shareId, shareUrl, busy, create, regenerate, revoke };
}

/** iframe snippet for embedding a share URL. */
export function shareEmbedCode(shareUrl: string): string {
  return `<iframe src="${shareUrl}" width="${SHARE_VIEW.EMBED_WIDTH}" height="${SHARE_VIEW.EMBED_HEIGHT}" style="border:0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
}

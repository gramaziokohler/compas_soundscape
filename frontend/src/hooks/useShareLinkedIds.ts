'use client';

import { useMemo } from 'react';
import { linkKey, useShareViewStore } from '@/store';
import { useActiveSceneId } from '@/hooks/useActiveSceneId';
import type { ShareItemKind } from '@/types/share';

/**
 * Share view: ids of the `kind` items (simulations or listeners) that share a
 * link group with the powered sound scene. A scene can sit in several groups,
 * so several items can be linked.
 *
 * Returns null (show every shared item) outside the share view, while no scene
 * is on, or when the scene is linked to no item of that kind.
 *
 * Usage:
 * ```tsx
 * const linkedIds = useShareLinkedIds('listener');
 * const shown = items.filter((item) => !linkedIds || linkedIds.has(item.id));
 * ```
 */
export function useShareLinkedIds(kind: Exclude<ShareItemKind, 'scene'>): ReadonlySet<string> | null {
  const isShareView = useShareViewStore((s) => s.isShareView);
  const links = useShareViewStore((s) => s.links);
  const activeSceneId = useActiveSceneId();

  return useMemo(() => {
    if (!isShareView || !activeSceneId) return null;
    const key = linkKey(kind);
    const ids = new Set<string>();
    for (const link of links) {
      const id = link[key];
      if (link.sceneId === activeSceneId && id) ids.add(id);
    }
    return ids.size > 0 ? ids : null;
  }, [isShareView, links, activeSceneId, kind]);
}

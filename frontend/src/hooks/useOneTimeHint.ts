'use client';

import { useCallback } from 'react';
import { useUIStore } from '@/store';

/**
 * One-time UI hint, shown once per user identity.
 *
 * "Seen" ids live in `uiStore.seenHints`, which user-preferences-sync persists
 * to the caller's server-side preferences — so a hint seen once never comes
 * back for that user, on any browser.
 *
 * Usage:
 * ```tsx
 * const { seen, markSeen } = useOneTimeHint('fps');
 * ```
 */
export function useOneTimeHint(id: string): { seen: boolean; markSeen: () => void } {
  const seen = useUIStore((s) => s.seenHints.includes(id));
  const markHintSeen = useUIStore((s) => s.markHintSeen);
  const markSeen = useCallback(() => markHintSeen(id), [id, markHintSeen]);
  return { seen, markSeen };
}

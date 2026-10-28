'use client';

import { useEffect, useRef } from 'react';
import { loadUserPreferences } from '@/lib/user-preferences-sync';
import { isShareViewActive } from '@/store/shareViewStore';

/**
 * Loads the current user's Advanced Settings preferences once on mount and
 * keeps them synced (debounced) back to the server. Call from the top-level
 * page component, outside any `<Suspense>` boundary, so it runs before child
 * mount effects (see persistence.mdc pitfall #7).
 */
export function useUserPreferencesSync(): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Anonymous share viewers have no preferences (and no identity).
    if (isShareViewActive()) return;
    void loadUserPreferences();
  }, []);
}

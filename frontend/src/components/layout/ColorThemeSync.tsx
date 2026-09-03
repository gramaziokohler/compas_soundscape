'use client';

import { useEffect, useState } from 'react';
import { useUIStore } from '@/store';
import {
  applyColorTheme,
  applyResolvedTheme,
  resolveColorTheme,
  subscribeSystemColorScheme,
} from '@/utils/color-theme';

/**
 * Keeps `html[data-theme]` in sync with the persisted preference and with
 * OS `prefers-color-scheme` while the preference is `system`.
 *
 * Waits for Zustand persist hydration so the default `'system'` does not
 * clobber a stored light/dark choice (the blocking layout script already
 * painted the correct theme).
 *
 * Usage:
 * ```tsx
 * <ColorThemeSync />
 * ```
 */
export function ColorThemeSync() {
  const colorTheme = useUIStore((s) => s.colorTheme);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const persistApi = useUIStore.persist;
    if (persistApi.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return persistApi.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyColorTheme(colorTheme);
    if (colorTheme !== 'system') return;
    return subscribeSystemColorScheme(() => {
      applyResolvedTheme(resolveColorTheme('system'));
    });
  }, [colorTheme, hydrated]);

  return null;
}

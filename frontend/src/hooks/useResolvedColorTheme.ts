'use client';

import { useEffect, useState } from 'react';
import {
  getResolvedColorTheme,
  subscribeColorTheme,
  subscribeSystemColorScheme,
  type ResolvedColorTheme,
} from '@/utils/color-theme';

/** Reactive resolved UI color theme (light / dark). */
export function useResolvedColorTheme(): ResolvedColorTheme {
  const [theme, setTheme] = useState<ResolvedColorTheme>(() => getResolvedColorTheme());

  useEffect(() => {
    const update = () => setTheme(getResolvedColorTheme());
    const unsubTheme = subscribeColorTheme(update);
    const unsubSystem = subscribeSystemColorScheme(update);
    return () => {
      unsubTheme();
      unsubSystem();
    };
  }, []);

  return theme;
}

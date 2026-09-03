/**
 * UI color theme (light / dark / system). Independent of Speckle viewmode
 * (`viewMode: 'dark'` = Sounds lighting). The blocking script in layout.tsx
 * reads the same localStorage key so the first paint matches the stored pref.
 */

export type ColorThemePreference = 'system' | 'light' | 'dark';
export type ResolvedColorTheme = 'light' | 'dark';

export const COLOR_THEME_STORAGE_KEY = 'compas-color-theme';

/** Dispatched on window after `applyColorTheme` updates `html[data-theme]`. */
export const COLOR_THEME_EVENT = 'compas-color-theme';

export function isColorThemePreference(value: string | null): value is ColorThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function readStoredColorTheme(): ColorThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    if (isColorThemePreference(stored)) return stored;
  } catch {
    /* private mode / blocked storage */
  }
  return 'system';
}

export function resolveColorTheme(pref: ColorThemePreference): ResolvedColorTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyResolvedTheme(resolved: ResolvedColorTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  window.dispatchEvent(new Event(COLOR_THEME_EVENT));
}

/** Persist preference and apply the resolved `data-theme`. Used by the settings setter. */
export function applyColorTheme(pref: ColorThemePreference): ResolvedColorTheme {
  const resolved = resolveColorTheme(pref);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(COLOR_THEME_STORAGE_KEY, pref);
    } catch {
      /* ignore */
    }
  }
  applyResolvedTheme(resolved);
  return resolved;
}

export function subscribeSystemColorScheme(onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => onChange();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export function subscribeColorTheme(onChange: () => void): () => void {
  window.addEventListener(COLOR_THEME_EVENT, onChange);
  return () => window.removeEventListener(COLOR_THEME_EVENT, onChange);
}

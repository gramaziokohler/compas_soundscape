/**
 * Platform detection + keyboard-shortcut formatting.
 *
 * On macOS the app accepts Cmd (metaKey) wherever Ctrl is used, so shortcut
 * displays should swap the modifier glyphs to the native symbols.
 */
import { SHORTCUT_KEY_SEPARATOR } from './constants';

export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Replace modifier names with macOS symbols. Non-modifier text
 * (mouse buttons, "Arrow keys", "wheel", …) is returned unchanged.
 */
export function formatShortcutKeys(keys: string, isMac: boolean): string {
  if (!isMac) return keys;
  return keys
    .replace(/\bCtrl\b/g, '⌘')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bAlt\b/g, '⌥');
}

/** Split a "Ctrl + Shift + Z" combo into display chips (platform-formatted). */
export function shortcutKeyChips(keys: string, isMac: boolean): string[] {
  return keys.split(SHORTCUT_KEY_SEPARATOR).map((k) => formatShortcutKeys(k, isMac));
}

const ARIA_KEY_NAMES: Record<string, string> = {
  Ctrl: 'Control',
  Esc: 'Escape',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
};

/** "Ctrl + Enter" → "Control+Enter" for the aria-keyshortcuts attribute. */
export function toAriaKeyShortcuts(keys: string): string {
  return keys.split(SHORTCUT_KEY_SEPARATOR).map((k) => ARIA_KEY_NAMES[k] ?? k).join('+');
}

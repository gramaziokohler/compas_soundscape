/**
 * Platform detection + keyboard-shortcut formatting.
 *
 * On macOS the app accepts Cmd (metaKey) wherever Ctrl is used, so shortcut
 * displays should swap the modifier glyphs to the native symbols.
 */
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

'use client';

import { useIsMac } from '@/hooks/useIsMac';
import { shortcutKeyChips } from '@/utils/platform';

interface ShortcutKeysProps {
  /** Key combo, e.g. "Ctrl + Enter" ("Ctrl" renders as ⌘ on macOS). */
  keys: string;
  /** Optional alternative combo rendered after an "or". */
  altKeys?: string;
}

/**
 * Renders a key combo as keycap chips (`.kbd`). Shared by the shortcuts
 * popover and ShortcutTooltip.
 */
export function ShortcutKeys({ keys, altKeys }: ShortcutKeysProps) {
  const isMac = useIsMac();
  const renderCombo = (combo: string) =>
    shortcutKeyChips(combo, isMac).map((chip, i) => (
      <kbd key={`${chip}-${i}`} className="kbd">{chip}</kbd>
    ));
  return (
    <span className="kbd-group">
      {renderCombo(keys)}
      {altKeys && (
        <>
          <span className="kbd-group__or">or</span>
          {renderCombo(altKeys)}
        </>
      )}
    </span>
  );
}

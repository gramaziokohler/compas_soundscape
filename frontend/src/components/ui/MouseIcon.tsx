'use client';

import { Icon } from '@/components/ui/Icon';
import type { MouseControl } from '@/utils/constants';

interface MouseIconProps {
  /** Mouse part to highlight (filled). */
  control: MouseControl;
  /** CSS size, e.g. "14px". */
  size?: string;
}

/**
 * Small mouse glyph with the used part filled — left button, right button or
 * wheel. Shown beside key chips in control lists (e.g. FpsHelpPopup).
 *
 * Usage:
 * ```tsx
 * <MouseIcon control="left" size="14px" />
 * ```
 */
export function MouseIcon({ control, size = '14px' }: MouseIconProps) {
  return (
    <Icon size={size}>
      {control === 'left' && <path d="M12 3a6 6 0 0 0-6 6v1h6z" fill="currentColor" stroke="none" />}
      {control === 'right' && <path d="M12 3a6 6 0 0 1 6 6v1h-6z" fill="currentColor" stroke="none" />}
      <rect x="6" y="3" width="12" height="18" rx="6" />
      <line x1="12" y1="3" x2="12" y2="10" />
      <line x1="6" y1="10" x2="18" y2="10" />
      {control === 'wheel' && <rect x="10.5" y="5" width="3" height="4" rx="1.5" fill="currentColor" />}
    </Icon>
  );
}

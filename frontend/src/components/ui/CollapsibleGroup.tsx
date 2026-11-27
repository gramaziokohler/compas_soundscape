'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ModifiedMark } from '@/components/ui/ModifiedMark';

export interface CollapsibleGroupProps {
  /** Header text, e.g. "Additional settings". */
  label: string;
  children: ReactNode;
  /**
   * `link`: a small chevron + text row (the cards' default "Additional settings").
   * `section`: a section header like the card's own ("Simulation settings"): label, hairline, chevron.
   */
  variant?: 'link' | 'section';
  /** Flags the header with "*" when a field inside changed since the card was generated. */
  modified?: boolean;
  defaultOpen?: boolean;
  /** Extra classes on the body (default `card-stack`). */
  bodyClassName?: string;
}

/**
 * CollapsibleGroup — a header that shows or hides a group of card controls.
 *
 * Usage:
 * ```tsx
 * <CollapsibleGroup label="Additional settings" variant="section" modified={changed}>
 *   <ToggleField ... />
 * </CollapsibleGroup>
 * ```
 */
export function CollapsibleGroup({
  label,
  children,
  variant = 'link',
  modified = false,
  defaultOpen = false,
  bodyClassName = 'card-stack',
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div>
      {variant === 'section' ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full cursor-pointer items-center gap-1.5 text-left text-xxs text-secondary-hover transition-colors hover:text-foreground"
        >
          <span className="whitespace-nowrap">{label}{modified && <ModifiedMark />}</span>
          <span className="h-px flex-1" style={{ backgroundColor: 'var(--color-secondary-light)' }} />
          <Chevron size={11} className="shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 text-left text-xs text-secondary-hover transition-colors hover:text-foreground"
        >
          <Chevron size={11} className="shrink-0" />
          <span>{label}{modified && <ModifiedMark />}</span>
        </button>
      )}
      {open && <div className={`card-collapse-body ${bodyClassName}`}>{children}</div>}
    </div>
  );
}

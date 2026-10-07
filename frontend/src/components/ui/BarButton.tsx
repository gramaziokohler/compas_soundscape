"use client";

import type { MouseEvent, ReactNode } from "react";
import { NOTIFICATIONS, type ShortcutId } from "@/utils/constants";
import { OptionalShortcutTooltip, ariaKeyShortcuts } from "@/components/ui/ShortcutTooltip";

export interface BarButtonProps {
  icon: ReactNode;
  /** Tooltip + accessible name. */
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Optional visible text next to the icon (for the actions that need a word). */
  label?: string;
  /** Toggled-on state (panel open, mode on) — primary tint. */
  active?: boolean;
  /** Solid primary (blue) fill — the bar's main call to action. */
  primary?: boolean;
  /** Warning tint (e.g. muted, update available). */
  warning?: boolean;
  disabled?: boolean;
  /** Count badge (hidden when 0 / undefined). */
  badge?: number;
  /** Small warning dot (e.g. "new version available"). */
  dot?: boolean;
  id?: string;
  /** Keyboard shortcut — replaces the native title with a ShortcutTooltip (title becomes its label). */
  shortcut?: ShortcutId;
}

/**
 * BarButton Component
 *
 * Flat 28px button for the scene bottom bar: transparent at rest, soft fill on
 * hover, primary tint when active. Optional text label, count badge, or dot.
 *
 * Usage:
 * ```tsx
 * <BarButton icon={<SettingsIcon />} title="Settings" active={open} onClick={toggle} />
 * <BarButton icon={<TimelineIcon />} label="Timeline" title="Show timeline" onClick={toggleTimeline} />
 * ```
 */
export function BarButton({
  icon,
  title,
  onClick,
  label,
  active = false,
  primary = false,
  warning = false,
  disabled = false,
  badge,
  dot = false,
  id,
  shortcut,
}: BarButtonProps) {
  const classes = ["bar-btn", active && "bar-btn--active", primary && "bar-btn--primary", warning && "bar-btn--warning"].filter(Boolean).join(" ");
  const button = (
    <button
      id={id}
      type="button"
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? undefined : title}
      aria-label={title}
      aria-keyshortcuts={ariaKeyShortcuts(shortcut)}
      aria-pressed={active}
    >
      {icon}
      {label && <span>{label}</span>}
      {badge != null && badge > 0 && (
        <span className="bar-btn__badge">{badge > NOTIFICATIONS.BADGE_MAX ? `${NOTIFICATIONS.BADGE_MAX}+` : badge}</span>
      )}
      {dot && <span className="bar-btn__dot" aria-hidden="true" />}
    </button>
  );
  return <OptionalShortcutTooltip shortcut={shortcut} label={title}>{button}</OptionalShortcutTooltip>;
}

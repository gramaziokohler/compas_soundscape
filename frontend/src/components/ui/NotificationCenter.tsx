"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useErrorsStore } from "@/store";
import type { ErrorNotification } from "@/store";
import { SceneControlButton } from "./SceneControlButton";
import {
  NOTIFICATIONS,
  UI_BORDER_RADIUS,
  UI_FONT_SIZE,
  UI_RIGHT_SIDEBAR,
  UI_SHADOWS,
  UI_SPACING,
} from "@/utils/constants";

interface NotificationCenterProps {
  /** Mirrors the scene toolbar offset so the dropdown aligns under the button. */
  isRightSidebarExpanded: boolean;
  rightSidebarWidth?: number;
}

const TYPE_GLYPH: Record<ErrorNotification["type"], string> = {
  error: "⚠️",
  warning: "⚡",
  info: "ℹ️",
};

const TYPE_COLOR: Record<ErrorNotification["type"], string> = {
  error: "var(--color-error)",
  warning: "var(--color-warning)",
  info: "var(--color-info)",
};

/**
 * NotificationCenter Component
 *
 * Scene-toolbar notification button + dropdown. The button is only rendered
 * while there are notifications; clicking it opens a persistent list of every
 * message recorded by `errorsStore` (transient toasts auto-dismiss, these do
 * not). Notifications are de-duplicated in the store by type + message.
 *
 * Usage:
 * ```tsx
 * <NotificationCenter
 *   isRightSidebarExpanded={isRightSidebarExpanded}
 *   rightSidebarWidth={rightSidebarWidth}
 * />
 * ```
 */
export function NotificationCenter({
  isRightSidebarExpanded,
  rightSidebarWidth,
}: NotificationCenterProps) {
  const notifications = useErrorsStore((s) => s.notifications);
  const removeNotification = useErrorsStore((s) => s.removeNotification);
  const clearNotifications = useErrorsStore((s) => s.clearNotifications);
  const [isOpen, setIsOpen] = useState(false);

  // Once the list is empty there is nothing left to display: collapse the
  // dropdown (the trigger button is hidden too, since we early-return above).
  useEffect(() => {
    if (notifications.length === 0) setIsOpen(false);
  }, [notifications.length]);

  if (notifications.length === 0) return null;

  const right = isRightSidebarExpanded
    ? `${(rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH) + 10}px`
    : '10px';

  return (
    <>
      <SceneControlButton
        buttonId="notification-center-button"
        onClick={() => setIsOpen((open) => !open)}
        isActive={isOpen}
        badge={notifications.length}
        title={isOpen ? 'Close notifications' : 'Notifications'}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      />

      {isOpen && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed flex flex-col"
          style={{
            top: '48px',
            right,
            width: NOTIFICATIONS.PANEL_WIDTH,
            maxHeight: NOTIFICATIONS.PANEL_MAX_HEIGHT,
            zIndex: 9999,
            backgroundColor: 'var(--background)',
            border: `${UI_BORDER_RADIUS.SM}px solid var(--color-primary)`,
            borderRadius: UI_BORDER_RADIUS.MD,
            boxShadow: UI_SHADOWS.LG,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between flex-shrink-0"
            style={{
              height: '40px',
              padding: `0 ${UI_SPACING.MD}px`,
              borderBottom: '1px solid var(--color-secondary-light)',
            }}
          >
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            <div className="flex items-center" style={{ gap: UI_SPACING.XS }}>
              <button
                onClick={clearNotifications}
                className="text-xs rounded cursor-pointer transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-secondary-hover)', padding: '2px 4px', fontSize: UI_FONT_SIZE.SM }}
              >
                Clear all
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-center rounded transition-colors"
                style={{ width: '24px', height: '24px', color: 'var(--color-secondary-hover)', backgroundColor: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary-light)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                title="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className="flex items-start"
                style={{
                  gap: UI_SPACING.SM,
                  padding: UI_SPACING.MD,
                  borderBottom: '1px solid var(--color-secondary-light)',
                }}
              >
                <span style={{ color: TYPE_COLOR[notification.type], fontSize: UI_FONT_SIZE.LG, lineHeight: 1, marginTop: '2px' }}>
                  {TYPE_GLYPH[notification.type]}
                </span>

                <div className="flex-1 text-sm text-foreground">
                  {notification.message}

                  {notification.action && (
                    <button
                      onClick={() => {
                        notification.action?.onClick();
                        removeNotification(notification.id);
                      }}
                      className="mt-2 block text-xs font-medium rounded px-2 py-1 cursor-pointer transition-opacity hover:opacity-80"
                      style={{
                        border: '1px solid currentColor',
                        color: 'inherit',
                        background: 'color-mix(in srgb, currentColor 10%, transparent)',
                      }}
                    >
                      {notification.action.label}
                    </button>
                  )}
                </div>

                <button
                  onClick={() => removeNotification(notification.id)}
                  className="flex items-center justify-center rounded transition-colors flex-shrink-0"
                  style={{ width: '20px', height: '20px', color: 'var(--color-secondary-hover)', backgroundColor: 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary-light)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  title="Dismiss notification"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

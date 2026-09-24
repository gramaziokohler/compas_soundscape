/**
 * Errors Store
 *
 * Manages global error/warning/info notifications.
 *
 * Two views of the same event are kept in sync:
 *  - `errors`        — transient toasts, auto-removed after a few seconds.
 *  - `notifications` — persistent entries surfaced by the scene `NotificationCenter`
 *                      panel; they stay until the user dismisses them.
 *
 * Notifications are de-duplicated by `type + message`: the same message is only
 * ever recorded (and toasted) once, so a repeated failure such as
 * "Insufficient permission for this workspace" cannot stack up.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { isAuthError } from '@/utils/authErrors';
import { NOTIFICATIONS } from '@/utils/constants';

export interface ErrorNotificationAction {
  label: string;
  onClick: () => void;
}

export interface ErrorNotification {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  action?: ErrorNotificationAction;
  timestamp: number;
}

export interface ErrorsStoreState {
  /** Transient toasts (auto-dismissed). */
  errors: ErrorNotification[];
  /** Persistent notifications shown in the scene NotificationCenter. */
  notifications: ErrorNotification[];
  addError: (
    message: string,
    type?: 'error' | 'warning' | 'info',
    action?: ErrorNotificationAction,
  ) => void;
  removeError: (id: string) => void;
  removeNotification: (id: string) => void;
  clearErrors: () => void;
  clearNotifications: () => void;
}

/** Identity of a notification for de-duplication purposes. */
function notificationKey(type: ErrorNotification['type'], message: string): string {
  return `${type}::${message}`;
}

/**
 * Standalone helper for store files that cannot use hooks.
 * Usage: `notifyError('Something went wrong')` or `notifyError('Quota exceeded', 'warning')`
 */
export function notifyError(
  message: string,
  type: ErrorNotification['type'] = 'error',
  action?: ErrorNotificationAction,
): void {
  useErrorsStore.getState().addError(message, type, action);
}

/**
 * Auth-error variant of `notifyError` — adds a "Configure API token" action
 * that opens the Advanced Settings token section.
 */
export function notifyAuthError(
  message: string,
  type: ErrorNotification['type'] = 'error',
): void {
  useErrorsStore.getState().addError(message, type, {
    label: 'Configure API token in Advanced Settings →',
    onClick: () => {
      // Lazy reference — avoids a module-load cycle with textGenerationStore.
      // textGenerationStore is always loaded by the store barrel before any
      // user interaction can trigger this action.
      void import('./textGenerationStore').then(({ useTextGenerationStore }) => {
        useTextGenerationStore.getState().triggerOpenTokenSettings();
      });
    },
  });
}

/**
 * Notify with an error toast, upgrading to an auth-action toast when the
 * message indicates a missing/invalid API token.
 */
export function notifySectionError(
  message: string,
  type: ErrorNotification['type'] = 'error',
): void {
  if (isAuthError(message)) notifyAuthError(message, type);
  else notifyError(message, type);
}

export const useErrorsStore = create<ErrorsStoreState>()(
  devtools(
    (set, get) => ({
      errors: [],
      notifications: [],

      addError: (message, type = 'error', action) => {
        const key = notificationKey(type, message);

        // De-duplicate: the same type+message is only ever recorded once. The
        // persistent entry lives in `notifications`; if any occurrence is still
        // known, skip the toast as well so it never stacks up.
        const alreadyKnown = get().notifications.some(
          (n) => notificationKey(n.type, n.message) === key,
        );
        if (alreadyKnown) return;

        const id = `${Date.now()}-${Math.random()}`;
        const notification: ErrorNotification = {
          id,
          message,
          type,
          action,
          timestamp: Date.now(),
        };

        set(
          (s) => ({
            errors: [...s.errors, notification],
            notifications: [...s.notifications, notification],
          }),
          false,
          'errors/addError',
        );

        // Auto-remove the transient toast after the timeout; the persistent
        // `notifications` entry remains available in the NotificationCenter.
        setTimeout(() => {
          set(
            (s) => ({ errors: s.errors.filter((e) => e.id !== id) }),
            false,
            'errors/autoRemove',
          );
        }, NOTIFICATIONS.TOAST_DURATION_MS);
      },

      removeError: (id) =>
        set(
          (s) => ({ errors: s.errors.filter((e) => e.id !== id) }),
          false,
          'errors/removeError',
        ),

      removeNotification: (id) =>
        set(
          (s) => ({
            errors: s.errors.filter((e) => e.id !== id),
            notifications: s.notifications.filter((n) => n.id !== id),
          }),
          false,
          'errors/removeNotification',
        ),

      clearErrors: () => set({ errors: [] }, false, 'errors/clearErrors'),

      clearNotifications: () =>
        set({ errors: [], notifications: [] }, false, 'errors/clearNotifications'),
    }),
    { name: 'errorsStore' },
  ),
);

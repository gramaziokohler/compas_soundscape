/**
 * Errors Store
 *
 * Replaces ErrorContext. Manages global error/warning/info notifications
 * with auto-removal after 5 seconds — identical behaviour to the old context.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { isAuthError } from '@/utils/authErrors';

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
  errors: ErrorNotification[];
  addError: (
    message: string,
    type?: 'error' | 'warning' | 'info',
    action?: ErrorNotificationAction,
  ) => void;
  removeError: (id: string) => void;
  clearErrors: () => void;
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
    (set) => ({
      errors: [],

      addError: (message, type = 'error', action) => {
        const id = `${Date.now()}-${Math.random()}`;
        const notification: ErrorNotification = {
          id,
          message,
          type,
          action,
          timestamp: Date.now(),
        };

        set(
          (s) => ({ errors: [...s.errors, notification] }),
          false,
          'errors/addError',
        );

        // Auto-remove after 5 seconds (matches original context behaviour)
        setTimeout(() => {
          set(
            (s) => ({ errors: s.errors.filter((e) => e.id !== id) }),
            false,
            'errors/autoRemove',
          );
        }, 5000);
      },

      removeError: (id) =>
        set(
          (s) => ({ errors: s.errors.filter((e) => e.id !== id) }),
          false,
          'errors/removeError',
        ),

      clearErrors: () => set({ errors: [] }, false, 'errors/clearErrors'),
    }),
    { name: 'errorsStore' },
  ),
);

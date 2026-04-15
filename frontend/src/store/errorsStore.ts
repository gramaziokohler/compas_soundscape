/**
 * Errors Store
 *
 * Replaces ErrorContext. Manages global error/warning/info notifications
 * with auto-removal after 5 seconds — identical behaviour to the old context.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface ErrorNotification {
  id: string;
  message: string;
  type: 'error' | 'warning' | 'info';
  timestamp: number;
}

export interface ErrorsStoreState {
  errors: ErrorNotification[];
  addError: (message: string, type?: 'error' | 'warning' | 'info') => void;
  removeError: (id: string) => void;
  clearErrors: () => void;
}

export const useErrorsStore = create<ErrorsStoreState>()(
  devtools(
    (set) => ({
      errors: [],

      addError: (message, type = 'error') => {
        const id = `${Date.now()}-${Math.random()}`;
        const notification: ErrorNotification = {
          id,
          message,
          type,
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

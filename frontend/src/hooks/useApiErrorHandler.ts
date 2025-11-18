import { useCallback } from 'react';
import { useErrorNotification } from '@/contexts/ErrorContext';

/**
 * Hook for handling API errors with toast notifications
 *
 * Usage:
 * ```ts
 * const handleError = useApiErrorHandler();
 *
 * try {
 *   await apiService.uploadFile(file);
 * } catch (error) {
 *   handleError(error, 'File upload failed');
 * }
 * ```
 */
export function useApiErrorHandler() {
  const { addError } = useErrorNotification();

  const handleError = useCallback((error: unknown, fallbackMessage?: string) => {
    let message = fallbackMessage || 'An error occurred';

    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    }

    addError(message, 'error');
  }, [addError]);

  return handleError;
}

/**
 * Hook for wrapping async API calls with automatic error handling
 *
 * Usage:
 * ```ts
 * const withErrorHandling = useApiWithErrorHandling();
 *
 * const handleUpload = async () => {
 *   const result = await withErrorHandling(
 *     () => apiService.uploadFile(file),
 *     'File upload failed'
 *   );
 *   if (result) {
 *     // success
 *   }
 * };
 * ```
 */
export function useApiWithErrorHandling() {
  const handleError = useApiErrorHandler();

  const withErrorHandling = useCallback(
    async <T>(
      apiCall: () => Promise<T>,
      errorMessage?: string
    ): Promise<T | null> => {
      try {
        return await apiCall();
      } catch (error) {
        handleError(error, errorMessage);
        return null;
      }
    },
    [handleError]
  );

  return withErrorHandling;
}

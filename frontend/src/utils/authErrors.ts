/**
 * Detect whether an error message indicates a missing or invalid API token.
 * Used to show "Configure in Settings" buttons next to auth-related errors.
 */
export function isAuthError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes('403') ||
    m.includes('forbidden') ||
    m.includes('permission_denied') ||
    m.includes('permission denied') ||
    m.includes('api_key') ||
    m.includes('api key') ||
    m.includes('auth_token') ||
    m.includes('authentication') ||
    m.includes('not configured') ||
    m.includes('not set') ||
    m.includes('could not resolve authentication') ||
    m.includes('connection error') ||
    m.includes('unregistered callers') ||
    m.includes('invalid token') ||
    m.includes('expired token') ||
    (m.includes('token') && (m.includes('invalid') || m.includes('missing') || m.includes('expired')))
  );
}

/**
 * Shared constants + helpers for the Load-model list cards
 * (SpeckleModelBrowser, HomeProjectCard).
 */

export const MODEL_BROWSER_STYLES = {
  MAX_HEIGHT: 220,
  CARD_GAP: 8,
  CARD_PADDING: 10,
  CARD_BORDER_RADIUS: 8,
  /** Right padding on a card so its body never sits under the kebab trigger. */
  CARD_PADDING_RIGHT: 32,
  PREVIEW_SIZE: 48,
  DESCRIPTION_MAX_LENGTH: 60,
} as const;

/** Classes shared by every clickable card body in the list. */
export const MODEL_CARD_CLASS =
  'w-full text-left transition-colors flex items-center cursor-pointer border border-secondary-light bg-background hover:border-primary hover:bg-primary-lighter dark:hover:border-primary dark:hover:bg-primary-light';

/** Format an ISO date string as a relative time label (e.g. "2d ago"). */
export function formatRelativeTime(isoString?: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHrs / 24);

  if (diffDays > 30) return date.toLocaleDateString();
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHrs > 0) return `${diffHrs}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}

/**
 * Shared constants + helpers for the Load-model list cards
 * (SpeckleModelBrowser, HomeProjectCard) and the Send-scenes target list.
 */

import type { SpeckleModelDetail } from '@/types/speckle-models';

/** Speckle web app host used to build model URLs. */
export const SPECKLE_SERVER_HOST = 'app.speckle.systems';

/** SpeckleData shape expected by SpeckleScene / page.tsx `handleSpeckleModelSelect`. */
export interface SpeckleSelectData {
  model_id: string;
  version_id: string;
  file_id: string;
  url: string;
  object_id: string;
  auth_token?: string;
  display_name?: string;
}

/** Build the select payload for a Speckle model's latest version (null when it has none). */
export function buildSpeckleSelectPayload(
  model: SpeckleModelDetail,
  projectId: string,
  authToken?: string,
): SpeckleSelectData | null {
  const latestVersion = model.latest_version;
  if (!latestVersion) return null;
  return {
    model_id: model.id,
    version_id: latestVersion.id,
    file_id: '',
    url: `https://${SPECKLE_SERVER_HOST}/projects/${projectId}/models/${model.id}`,
    object_id: latestVersion.referenced_object ?? latestVersion.id,
    auth_token: authToken,
    display_name: model.display_name,
  };
}

/** Modified date of a Speckle model: this workspace's last save, else Speckle's update. */
export function speckleModifiedTime(model: SpeckleModelDetail): number {
  return new Date(model.last_saved_at ?? model.updated_at ?? 0).getTime();
}

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

/**
 * Public read-only share (`/share/<share_id>`).
 *
 * The designer picks which scenes / simulations / listeners an anonymous viewer
 * sees, and groups them into links: activating one item of a link activates the
 * others. Persisted in `soundscape.json` → `share_config` (backend schemas.py
 * `SoundscapeData.share_config`, filtered by `services/share_service.py`).
 */

import type { SoundscapeData } from './soundscape';

/** Kinds of item a share can include. */
export type ShareItemKind = 'scene' | 'simulation' | 'listener';

/** One link group: at most one item of each kind, activated together. */
export interface ShareLink {
  id: string;
  sceneId?: string;
  simulationId?: string;
  /** Single listener id or grid listener id. */
  listenerId?: string;
}

export interface ShareConfig {
  sceneIds: string[];
  simulationIds: string[];
  /** Single listener ids and grid listener ids. */
  listenerIds: string[];
  links: ShareLink[];
}

/** GET /api/public/share/{share_id} — the filtered soundscape for anonymous viewers. */
export interface PublicShareResponse {
  soundscape_data: SoundscapeData;
  /** Relative, share-scoped media routes (never `/soundscapes/<ws>/...`). */
  audio_base_url: string;
  ir_base_url: string;
  share_config: ShareConfig;
}

/** Owner view of the model's share link (GET/POST /api/speckle/soundscape/{model}/share). */
export interface ShareLinkInfo {
  share_id: string | null;
  created_at: string | null;
}

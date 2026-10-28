/**
 * Share selection (domain state) — which scenes / simulations / listeners a
 * public `/share/<id>` link exposes, and their link groups.
 *
 * Saved through soundscape.json autosave (`share_config`), never localStorage.
 * Not undoable: share settings are configuration, not scene edits.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ShareConfig, ShareItemKind, ShareLink } from '@/types/share';
import { newConfigId } from '@/utils/config-id';

export const EMPTY_SHARE_CONFIG: ShareConfig = { sceneIds: [], simulationIds: [], listenerIds: [], links: [] };

const ID_LIST_KEY: Record<ShareItemKind, 'sceneIds' | 'simulationIds' | 'listenerIds'> = {
  scene: 'sceneIds',
  simulation: 'simulationIds',
  listener: 'listenerIds',
};

const LINK_KEY: Record<ShareItemKind, 'sceneId' | 'simulationId' | 'listenerId'> = {
  scene: 'sceneId',
  simulation: 'simulationId',
  listener: 'listenerId',
};

export interface ShareConfigStoreState extends ShareConfig {
  toggleItem: (kind: ShareItemKind, id: string, shared: boolean) => void;
  /** Group items (one per kind) into a new link; returns its id. */
  createLink: (members: Partial<Record<ShareItemKind, string>>) => string;
  /** Set / clear one member of a link. A link left with < 2 members is removed. */
  updateLink: (linkId: string, kind: ShareItemKind, itemId: string | undefined) => void;
  removeLink: (linkId: string) => void;
  /** Replace from a loaded soundscape (or reset with `null`). */
  restore: (config: Partial<ShareConfig> | null | undefined) => void;
}

/** The persisted subset (for buildSavePayload). */
export function selectShareConfig(state: ShareConfigStoreState): ShareConfig {
  return {
    sceneIds: state.sceneIds,
    simulationIds: state.simulationIds,
    listenerIds: state.listenerIds,
    links: state.links,
  };
}

/**
 * Drop ids that no longer exist (deleted scenes / simulations / listeners) from
 * the selection and its links. Pure — applied when saving, so delete handlers
 * never need to know about sharing.
 */
export function pruneShareConfig(config: ShareConfig, existing: Record<ShareItemKind, Set<string>>): ShareConfig {
  const keep = (kind: ShareItemKind) => config[ID_LIST_KEY[kind]].filter((id) => existing[kind].has(id));
  const shared: Record<ShareItemKind, Set<string>> = {
    scene: new Set(keep('scene')),
    simulation: new Set(keep('simulation')),
    listener: new Set(keep('listener')),
  };
  const links = config.links.map((l) => {
    const next = { ...l };
    (Object.keys(LINK_KEY) as ShareItemKind[]).forEach((kind) => {
      const id = next[LINK_KEY[kind]];
      if (id && !shared[kind].has(id)) next[LINK_KEY[kind]] = undefined;
    });
    return next;
  });
  return {
    sceneIds: [...shared.scene],
    simulationIds: [...shared.simulation],
    listenerIds: [...shared.listener],
    links,
  };
}

/** Number of items a link groups (a usable link groups at least two). */
export function linkMemberCount(link: ShareLink): number {
  return (Object.values(LINK_KEY) as Array<keyof ShareLink>).filter((field) => !!link[field]).length;
}

/** Drop links that no longer group at least two items. */
function withoutDegenerateLinks(links: ShareLink[]): ShareLink[] {
  return links.filter((l) => linkMemberCount(l) >= 2);
}

/** An item belongs to at most one link: free `itemId` from every link but `keepLinkId`. */
function releaseItem(links: ShareLink[], kind: ShareItemKind, itemId: string, keepLinkId?: string): ShareLink[] {
  const field = LINK_KEY[kind];
  return links.map((l) => (l.id !== keepLinkId && l[field] === itemId ? { ...l, [field]: undefined } : l));
}

export function linkKey(kind: ShareItemKind): 'sceneId' | 'simulationId' | 'listenerId' {
  return LINK_KEY[kind];
}

export const useShareConfigStore = create<ShareConfigStoreState>()(
  devtools(
    (set, get) => ({
      ...EMPTY_SHARE_CONFIG,

      toggleItem: (kind, id, shared) => {
        const key = ID_LIST_KEY[kind];
        const current = get()[key];
        if (shared === current.includes(id)) return;
        const next = shared ? [...current, id] : current.filter((x) => x !== id);
        // Un-sharing an item also removes it from every link.
        const links = shared ? get().links : withoutDegenerateLinks(releaseItem(get().links, kind, id));
        set({ [key]: next, links } as Partial<ShareConfigStoreState>, false, 'share/toggleItem');
      },

      createLink: (members) => {
        const link: ShareLink = { id: newConfigId() };
        let links = get().links;
        (Object.keys(members) as ShareItemKind[]).forEach((kind) => {
          const itemId = members[kind];
          if (!itemId) return;
          links = releaseItem(links, kind, itemId);
          link[LINK_KEY[kind]] = itemId;
        });
        set({ links: withoutDegenerateLinks([...links, link]) }, false, 'share/createLink');
        return link.id;
      },

      updateLink: (linkId, kind, itemId) => {
        const field = LINK_KEY[kind];
        const released = itemId ? releaseItem(get().links, kind, itemId, linkId) : get().links;
        const links = released.map((l): ShareLink => (l.id === linkId ? { ...l, [field]: itemId } : l));
        set({ links: withoutDegenerateLinks(links) }, false, 'share/updateLink');
      },

      removeLink: (linkId) => set({ links: get().links.filter((l) => l.id !== linkId) }, false, 'share/removeLink'),

      restore: (config) =>
        set(
          {
            sceneIds: config?.sceneIds ?? [],
            simulationIds: config?.simulationIds ?? [],
            listenerIds: config?.listenerIds ?? [],
            links: config?.links ?? [],
          },
          false,
          'share/restore',
        ),

    }),
    { name: 'shareConfigStore' },
  ),
);

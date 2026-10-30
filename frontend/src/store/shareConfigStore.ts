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

/** One item of a link: its kind (board column) and id. */
export interface ShareLinkEnd {
  kind: ShareItemKind;
  id: string;
}

export interface ShareConfigStoreState extends ShareConfig {
  toggleItem: (kind: ShareItemKind, id: string, shared: boolean) => void;
  /**
   * Connect two items of different kinds, or disconnect them when a link already
   * groups both (`b` leaves that link). A connection joins a link of `a` (then of
   * `b`) that has no item of the other kind yet, else starts a new link — so an
   * item can belong to several links (one scene, several listeners).
   */
  toggleConnection: (a: ShareLinkEnd, b: ShareLinkEnd) => void;
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

/** Free `itemId` from every link (it is no longer shared). */
function releaseItem(links: ShareLink[], kind: ShareItemKind, itemId: string): ShareLink[] {
  const field = LINK_KEY[kind];
  return links.map((l) => (l[field] === itemId ? { ...l, [field]: undefined } : l));
}

/** Same members (ignoring the id) — a connection never duplicates a link. */
function sameMembers(a: ShareLink, b: ShareLink): boolean {
  return (Object.values(LINK_KEY) as Array<keyof ShareLink>).every((field) => (a[field] ?? null) === (b[field] ?? null));
}

/** Links after connecting / disconnecting `a` and `b` (see `toggleConnection`). */
function toggleConnectionIn(links: ShareLink[], a: ShareLinkEnd, b: ShareLinkEnd): ShareLink[] {
  if (a.kind === b.kind) return links;
  const fieldA = LINK_KEY[a.kind];
  const fieldB = LINK_KEY[b.kind];

  const shared = links.find((l) => l[fieldA] === a.id && l[fieldB] === b.id);
  if (shared) {
    const next = withoutDegenerateLinks(links.map((l) => (l.id === shared.id ? { ...l, [fieldB]: undefined } : l)));
    // The shrunk link may now equal another one: keep the first.
    return next.filter((l, i) => next.findIndex((o) => sameMembers(o, l)) === i);
  }

  // Join a link of `a` with a free `b` slot, else a link of `b` with a free `a` slot.
  const host =
    links.find((l) => l[fieldA] === a.id && !l[fieldB]) ??
    links.find((l) => l[fieldB] === b.id && !l[fieldA]);
  if (host) {
    const joined: ShareLink = { ...host, [fieldA]: a.id, [fieldB]: b.id };
    if (links.some((l) => l.id !== host.id && sameMembers(l, joined))) return links;
    return links.map((l) => (l.id === host.id ? joined : l));
  }
  return [...links, { id: newConfigId(), [fieldA]: a.id, [fieldB]: b.id }];
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

      toggleConnection: (a, b) =>
        set({ links: toggleConnectionIn(get().links, a, b) }, false, 'share/toggleConnection'),

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

/**
 * Public share *view* state — set once by the `/share/[shareId]` route before
 * the app mounts. When `isShareView` is true the app is a read-only player:
 * every editing control is hidden (see `hooks/useCanEdit.ts`), nothing is saved
 * and only `/api/public/*` + Speckle are called.
 *
 * Not persisted: a share page always starts fresh from the server.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ShareLink } from '@/types/share';

export interface ShareViewStoreState {
  isShareView: boolean;
  shareId: string | null;
  /** Link groups served by the public endpoint (already filtered). */
  links: ShareLink[];
  enterShareView: (shareId: string) => void;
  setLinks: (links: ShareLink[]) => void;
}

export const selectIsShareView = (state: ShareViewStoreState): boolean => state.isShareView;

export const useShareViewStore = create<ShareViewStoreState>()(
  devtools(
    (set) => ({
      isShareView: false,
      shareId: null,
      links: [],
      enterShareView: (shareId) => set({ isShareView: true, shareId }, false, 'shareView/enter'),
      setLinks: (links) => set({ links }, false, 'shareView/setLinks'),
    }),
    { name: 'shareViewStore' },
  ),
);

/** Non-hook read for event handlers / module code. */
export function isShareViewActive(): boolean {
  return useShareViewStore.getState().isShareView;
}

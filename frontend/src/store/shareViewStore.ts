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
  /** The coach-mark tour is on screen (the bottom bar's Tour button shows active). */
  tutorialActive: boolean;
  /** Bumped by the Tour button; useShareTutorial hides / shows the tour on each change. */
  tutorialToggleNonce: number;
  /** px taken by the bottom-left scene info (ShareSceneInfo); the left bubble column stops above it. */
  bottomInfoHeight: number;
  enterShareView: (shareId: string) => void;
  setLinks: (links: ShareLink[]) => void;
  setTutorialActive: (active: boolean) => void;
  requestTutorialToggle: () => void;
  setBottomInfoHeight: (px: number) => void;
}

export const selectIsShareView = (state: ShareViewStoreState): boolean => state.isShareView;

export const useShareViewStore = create<ShareViewStoreState>()(
  devtools(
    (set) => ({
      isShareView: false,
      shareId: null,
      links: [],
      tutorialActive: false,
      tutorialToggleNonce: 0,
      bottomInfoHeight: 0,
      enterShareView: (shareId) => set({ isShareView: true, shareId }, false, 'shareView/enter'),
      setLinks: (links) => set({ links }, false, 'shareView/setLinks'),
      setTutorialActive: (tutorialActive) => set({ tutorialActive }, false, 'shareView/setTutorialActive'),
      requestTutorialToggle: () =>
        set((s) => ({ tutorialToggleNonce: s.tutorialToggleNonce + 1 }), false, 'shareView/requestTutorialToggle'),
      setBottomInfoHeight: (bottomInfoHeight) => set({ bottomInfoHeight }, false, 'shareView/setBottomInfoHeight'),
    }),
    { name: 'shareViewStore' },
  ),
);

/** Non-hook read for event handlers / module code. */
export function isShareViewActive(): boolean {
  return useShareViewStore.getState().isShareView;
}

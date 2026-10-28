'use client';

import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import type { ContextMenuItem } from '@/components/ui/ContextMenu';
import { useAnalysisStore } from '@/store';
import type { SceneProgress, SoundScene } from '@/types/sceneWorkflow';
import { duplicateSoundScene } from '@/utils/duplicateSoundScene';
import { SIMPLE_MODE } from '@/utils/constants';
import { buildSavedVisibilityRows } from '@/utils/savedObjectVisibility';

interface SceneMenuState {
  scene: SoundScene;
  progress: SceneProgress;
  x: number;
  y: number;
}

/** BubblePanel props that make a scene's title renameable. */
export interface SceneRenameProps {
  onRename: (name: string) => void;
  renameRequested: boolean;
  onRenameRequestHandled: () => void;
}

export interface UseSceneBubbleMenuOptions {
  /** Open a scene's panel (Rename edits its title; Duplicate shows the copy). */
  openPanel: (kind: 'scene' | 'workflow', usageIndex: number) => void;
  /** Which panel a scene opens into (workflow while its pipeline still runs). */
  panelKindFor: (scene: SoundScene, progress: SceneProgress) => 'scene' | 'workflow';
}

export interface UseSceneBubbleMenuResult {
  /** Open menu position, or null. */
  menu: { x: number; y: number } | null;
  openMenu: (scene: SoundScene, progress: SceneProgress, e: MouseEvent<HTMLElement>) => void;
  closeMenu: () => void;
  /** Rows for the open scene (Duplicate is hidden while its pipeline runs). */
  items: ContextMenuItem[];
  /** Props for the scene panel of `usageIndex` (inline title rename). */
  renamePropsFor: (usageIndex: number) => SceneRenameProps;
}

/**
 * useSceneBubbleMenu Hook
 *
 * Right-click menu of a Simple-mode scene bubble:
 * - Rename — opens the scene's panel with its title in edit mode
 *   (saved as the usage card's `display_name`).
 * - Duplicate — full scene copy (`utils/duplicateSoundScene.ts`), then opens it.
 *
 * Usage:
 * ```tsx
 * const sceneMenu = useSceneBubbleMenu({ openPanel, panelKindFor });
 * <SceneBubble onContextMenu={sceneMenu.openMenu} … />
 * <BubblePanel {...sceneMenu.renamePropsFor(scene.usageIndex)} … />
 * {sceneMenu.menu && (
 *   <ContextMenu {...sceneMenu.menu} items={sceneMenu.items} onClose={sceneMenu.closeMenu} />
 * )}
 * ```
 */
export function useSceneBubbleMenu({ openPanel, panelKindFor }: UseSceneBubbleMenuOptions): UseSceneBubbleMenuResult {
  const [state, setState] = useState<SceneMenuState | null>(null);
  const [renameUsageIndex, setRenameUsageIndex] = useState<number | null>(null);

  const openMenu = useCallback((scene: SoundScene, progress: SceneProgress, e: MouseEvent<HTMLElement>) => {
    setState({ scene, progress, x: e.clientX, y: e.clientY });
  }, []);
  const closeMenu = useCallback(() => setState(null), []);
  const clearRenameRequest = useCallback(() => setRenameUsageIndex(null), []);

  const items = useMemo<ContextMenuItem[]>(() => {
    if (!state) return [];
    const { scene, progress } = state;
    const rows: ContextMenuItem[] = [
      {
        key: 'rename',
        label: SIMPLE_MODE.SCENE_MENU_RENAME,
        onClick: () => {
          openPanel(panelKindFor(scene, progress), scene.usageIndex);
          setRenameUsageIndex(scene.usageIndex);
        },
      },
    ];
    if (progress.status !== 'running') {
      rows.push({
        key: 'duplicate',
        label: SIMPLE_MODE.SCENE_MENU_DUPLICATE,
        onClick: () => {
          void duplicateSoundScene(scene.usageIndex).then((copyIndex) => {
            if (copyIndex !== null) openPanel('scene', copyIndex);
          });
        },
      });
    }
    // Read the live scene config: `state.scene` is a snapshot from the right-click.
    const saved = useAnalysisStore.getState().analysisConfigs[scene.usageIndex]?.savedObjectVisibility;
    rows.push(
      ...buildSavedVisibilityRows({
        saved,
        onSave: (snapshot) =>
          useAnalysisStore.getState().handleUpdateConfig(scene.usageIndex, { savedObjectVisibility: snapshot }),
        onClear: () =>
          useAnalysisStore.getState().handleUpdateConfig(scene.usageIndex, { savedObjectVisibility: undefined }),
      }),
    );
    return rows;
  }, [state, openPanel, panelKindFor]);

  const renamePropsFor = useCallback((usageIndex: number): SceneRenameProps => ({
    onRename: (name) => useAnalysisStore.getState().handleUpdateConfig(usageIndex, { display_name: name }),
    renameRequested: renameUsageIndex === usageIndex,
    onRenameRequestHandled: clearRenameRequest,
  }), [renameUsageIndex, clearRenameRequest]);

  const menu = useMemo(() => (state ? { x: state.x, y: state.y } : null), [state]);
  return { menu, openMenu, closeMenu, items, renamePropsFor };
}

import { useEffect, useRef } from 'react';
import { useSoundscapeStore, useUIStore } from '@/store';
import type { SoundScene } from '@/types/sceneWorkflow';

/** The Simple-mode scene panel kinds a sound focus can move. */
type ScenePanel = { kind: 'composer' } | { kind: 'scene' | 'workflow' | 'chat'; usageIndex: number } | null;

/**
 * Simple mode (and share view): follows the shared sound focus (`uiStore.soundFocus`)
 * with the scene panel.
 * - A plain focus (sphere / linked object / DAW track click) only moves a scene panel
 *   that is already open to the sound's scene. A closed panel or the composer stays as
 *   it is. The focus persists, so opening that scene later expands the focused card
 *   (`useSoundCardFocus`).
 * - An explicit reveal (`soundFocus.reveal`, e.g. the scene right-click menu) powers the
 *   sound's scene and opens its panel.
 * The card itself is expanded and scrolled to by SoundGenerationSection.
 *
 * Usage:
 * ```tsx
 * useSoundFocusReveal(panel, scenes, openSceneCards, selectScene);
 * ```
 */
export function useSoundFocusReveal(
  panel: ScenePanel,
  scenes: SoundScene[],
  openScene: (usageIndex: number) => void,
  selectScene: (scene: SoundScene) => void,
): void {
  const soundFocus = useUIStore((s) => s.soundFocus);

  // Read at focus time so only a new focus (not a panel / scene change) moves the panel.
  const latest = useRef({ panel, scenes, openScene, selectScene });
  latest.current = { panel, scenes, openScene, selectScene };

  useEffect(() => {
    if (!soundFocus) return;
    const { panel: current, scenes: currentScenes, openScene: open, selectScene: select } = latest.current;
    const parent = useSoundscapeStore.getState().soundConfigs[soundFocus.index]?.parentUsageOriginalIndex;
    const scene = currentScenes.find((s) => s.usageIndex === parent);
    if (!scene) return;
    if (soundFocus.reveal) {
      select(scene);
      open(scene.usageIndex);
      return;
    }
    if (!current || current.kind === 'composer') return;
    // The scene's edit chat stays open while the user points at its sounds.
    if (current.kind === 'chat' && current.usageIndex === scene.usageIndex) return;
    if (current.kind !== 'scene' || current.usageIndex !== scene.usageIndex) open(scene.usageIndex);
  }, [soundFocus?.version]); // eslint-disable-line react-hooks/exhaustive-deps
}

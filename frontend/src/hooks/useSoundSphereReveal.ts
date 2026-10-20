import { useEffect, useRef, useState } from 'react';
import { useSoundscapeStore, useUIStore } from '@/store';
import type { SoundScene } from '@/types/sceneWorkflow';

/** Card to expand in the scene panel; a new `version` re-expands the same card. */
export type RevealCardRequest = { index: number; version: number } | null;

/** The Simple-mode scene panel kinds that a sphere click can reveal into. */
type ScenePanel = { kind: 'composer' } | { kind: 'scene' | 'workflow'; usageIndex: number } | null;

/**
 * Simple mode: a sound sphere clicked in 3D (`uiStore.soundSphereRevealRequest`)
 * while a scene panel is open shows that sphere's scene cards and expands its
 * card. A reduced panel or the composer stays as it is. The returned request is
 * fed to SoundGenerationSection's `revealCardRequest`, and is dropped as soon
 * as the panel leaves the scene view, so it never replays on reopen.
 *
 * Usage:
 * ```tsx
 * const revealCardRequest = useSoundSphereReveal(panel, scenes, (usageIndex) => setPanel({ kind: 'scene', usageIndex }));
 * ```
 */
export function useSoundSphereReveal(
  panel: ScenePanel,
  scenes: SoundScene[],
  openScene: (usageIndex: number) => void,
): RevealCardRequest {
  const sphereRequest = useUIStore((s) => s.soundSphereRevealRequest);
  const [request, setRequest] = useState<RevealCardRequest>(null);

  // Read at request time so only a new click (not a panel / scene change) reveals.
  const latest = useRef({ panel, scenes, openScene });
  latest.current = { panel, scenes, openScene };

  useEffect(() => {
    const { panel: current, scenes: currentScenes, openScene: open } = latest.current;
    if (!sphereRequest || !current || current.kind === 'composer') return;
    const parent = useSoundscapeStore.getState().soundConfigs[sphereRequest.index]?.parentUsageOriginalIndex;
    if (parent === undefined || !currentScenes.some((s) => s.usageIndex === parent)) return;
    open(parent);
    setRequest(sphereRequest);
  }, [sphereRequest]);

  const inSceneView = panel?.kind === 'scene';
  useEffect(() => {
    if (!inSceneView) setRequest(null);
  }, [inSceneView]);

  return request;
}

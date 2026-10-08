'use client';

import { useCallback, useEffect, useRef } from 'react';
import { BubblePanel } from '@/components/ui/BubblePanel';
import { HomeUploadPrompt } from '@/components/scene/HomeUploadPrompt';
import { ScenePromptComposer } from './ScenePromptComposer';
import { useSceneWorkflowStore, useUIStore } from '@/store';
import { useHomeComposerStore } from '@/store/homeComposerStore';
import type { SceneWorkflowOptions } from '@/types/sceneWorkflow';
import { HOME_STAGE, SCENE_BOTTOM_BAR, SIMPLE_MODE } from '@/utils/constants';
import { isFreshHomeUrl } from '@/utils/homeStage';

/** DOM id of the Simple-mode "+" button the panel shrinks into when reduced. */
export const NEW_SCENE_ADD_BUTTON_ID = 'new-scene-add-button';

/**
 * The centred Home new-scene panel opens by itself once per page load of a fresh
 * Home stage (no `?model_id=` / `?home=` project). Module-level so a Simple ↔
 * Expert round trip doesn't re-open it.
 */
let homeComposerOffered = false;

/**
 * HomeSceneComposer Component
 *
 * New-scene prompt centred at the bottom of the empty Home stage, under the
 * "Upload a 3D model" line. Simple mode only: it is hidden in Detailed mode and
 * comes back on return to Simple. "+", reduce, sending, or loading a model
 * dismisses it. Reduce shrinks it into the "+" button of Soundscapes.
 *
 * Usage:
 * ```tsx
 * <HomeSceneComposer />
 * ```
 */
export function HomeSceneComposer() {
  const isOpen = useHomeComposerStore((s) => s.isOpen);
  const onHomeStage = useUIStore((s) => !s.globalSpeckleData && !s.homeProject);
  const uiMode = useUIStore((s) => s.uiMode);
  const busy = useSceneWorkflowStore((s) => s.activeUsageIndex !== null || s.queue.length > 0);
  const startScene = useSceneWorkflowStore((s) => s.startScene);
  const boxRef = useRef<HTMLDivElement>(null);
  const reducingRef = useRef(false);

  useEffect(() => {
    if (homeComposerOffered || !isFreshHomeUrl()) return;
    homeComposerOffered = true;
    useHomeComposerStore.getState().open();
  }, []);

  useEffect(() => {
    if (isOpen && !onHomeStage) useHomeComposerStore.getState().dismiss();
  }, [isOpen, onHomeStage]);

  const handleSubmit = useCallback((prompt: string, options: SceneWorkflowOptions) => {
    const usageIndex = startScene(prompt, options);
    const home = useHomeComposerStore.getState();
    home.setSubmitted(usageIndex);
    home.dismiss();
  }, [startScene]);

  const handleReduce = useCallback(() => {
    const box = boxRef.current;
    const dismiss = () => useHomeComposerStore.getState().dismiss();
    if (!box || reducingRef.current) return;
    const target = document.getElementById(NEW_SCENE_ADD_BUTTON_ID);
    reducingRef.current = true;
    const from = box.getBoundingClientRect();
    const to = target?.getBoundingClientRect();
    // Expert mode has no "+": fall back to a plain shrink-and-fade in place.
    const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
    const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : 0;
    const animation = box.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.05)`, opacity: 0 },
      ],
      { duration: HOME_STAGE.REDUCE_ANIMATION_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
    );
    animation.onfinish = () => {
      reducingRef.current = false;
      dismiss();
    };
  }, []);

  // Hidden (not dismissed) in Detailed mode; it returns when coming back to Simple.
  if (!isOpen || uiMode !== 'simple') return null;

  return (
    <div
      className="fixed left-0 right-0 flex justify-center pointer-events-none"
      style={{ bottom: SCENE_BOTTOM_BAR.HEIGHT + HOME_STAGE.PROMPT_BOTTOM_GAP, zIndex: SIMPLE_MODE.Z_INDEX }}
    >
      <div ref={boxRef} className="flex flex-col items-center gap-3 pointer-events-auto">
        <HomeUploadPrompt />
        <BubblePanel
          ariaLabel="New sound scene"
          title="New sound scene"
          onReduce={handleReduce}
          width={SIMPLE_MODE.COMPOSER_WIDTH}
          style={{ position: 'relative' }}
        >
          <ScenePromptComposer willQueue={busy} onSubmit={handleSubmit} onClose={handleReduce} />
        </BubblePanel>
      </div>
    </div>
  );
}

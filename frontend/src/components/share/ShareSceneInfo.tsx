'use client';

import { useLayoutEffect, useRef } from 'react';
import { MouseIcon } from '@/components/ui/MouseIcon';
import { FootnoteText } from '@/components/simple/SceneFootnote';
import { useAnalysisStore, useShareViewStore, useUIStore } from '@/store';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { SCENE_BOTTOM_BAR, SHARE_SCENE_INFO, SIMPLE_MODE } from '@/utils/constants';

export interface ShareSceneInfoProps {
  /** The camera is locked in a listener's first-person view: show the FPS controls. */
  isFirstPersonMode: boolean;
}

/**
 * ShareSceneInfo Component
 *
 * Share view: small fixed text at the bottom-left, in the column-heading style
 * ("Soundscapes", "Acoustics", …) but lighter — the active scene's name and
 * footnote (with its links) while a scene is on, then a one-line navigation
 * help (orbit / pan / zoom, or the first-person controls while in a listener).
 * Its height is published to `shareViewStore.bottomInfoHeight` so the scenes
 * column stops above it.
 *
 * Usage (SpeckleScene):
 * ```tsx
 * {!canEdit && <ShareSceneInfo isFirstPersonMode={isFirstPersonMode} />}
 * ```
 */
export function ShareSceneInfo({ isFirstPersonMode }: ShareSceneInfoProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);
  const activeIndex = useUIStore((s) => (s.isInSoundsStep ? s.activeSoundParentIndex : null));
  const scenes = useSoundScenes();
  const scene = activeIndex !== null ? scenes.find((s) => s.usageIndex === activeIndex) : undefined;
  const footnote = useAnalysisStore((s) => (activeIndex !== null ? s.analysisConfigs[activeIndex]?.footnote : undefined));
  const setBottomInfoHeight = useShareViewStore((s) => s.setBottomInfoHeight);

  // Publish the height (wrapping footnote, FPS line) for the left column's budget.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBottomInfoHeight(el.offsetHeight));
    observer.observe(el);
    setBottomInfoHeight(el.offsetHeight);
    return () => {
      observer.disconnect();
      setBottomInfoHeight(0);
    };
  }, [setBottomInfoHeight]);

  const controls = isFirstPersonMode ? SHARE_SCENE_INFO.FPS_CONTROLS : SHARE_SCENE_INFO.NAV_CONTROLS;

  return (
    <div
      ref={rootRef}
      className="share-scene-info"
      style={{
        left: SIMPLE_MODE.EDGE_MARGIN,
        bottom: SCENE_BOTTOM_BAR.HEIGHT + SIMPLE_MODE.LISTENERS_BOTTOM_GAP + dockLift,
        maxWidth: SHARE_SCENE_INFO.MAX_WIDTH,
        zIndex: SIMPLE_MODE.Z_INDEX,
      }}
    >
      {scene && (
        <>
          <p className="share-scene-info__title">{scene.title}</p>
          {footnote && (
            <p className="share-scene-info__note">
              <FootnoteText text={footnote} />
            </p>
          )}
        </>
      )}
      <p className="share-scene-info__nav" aria-label="Navigation">
        {controls.map(({ label, mouse, action }) => (
          <span key={label} className="share-scene-info__control">
            {label} <MouseIcon control={mouse} size={SHARE_SCENE_INFO.MOUSE_ICON_SIZE} /> {action}
          </span>
        ))}
        {isFirstPersonMode && (
          <span className="share-scene-info__control">
            Leave <kbd className="share-scene-info__kbd">{SHARE_SCENE_INFO.FPS_LEAVE_KEY}</kbd>
          </span>
        )}
      </p>
    </div>
  );
}

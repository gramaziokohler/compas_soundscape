'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioControlsStore, useShareViewStore, useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { useOneTimeHint } from '@/hooks/useOneTimeHint';
import { useAnchorRect, type AnchorRect } from '@/hooks/useAnchorRect';
import { SCENE_BOTTOM_BAR, SHARE_TUTORIAL, SIMPLE_MODE } from '@/utils/constants';

export type ShareTutorialStepId = keyof typeof SHARE_TUTORIAL.STEPS;
/** Side of the anchor the tip sits on. */
export type ShareTutorialPlacement = 'right' | 'left' | 'above';

export interface ShareTutorialStep {
  id: ShareTutorialStepId;
  placement: ShareTutorialPlacement;
  resolveAnchor: () => Element | null;
}

export interface ShareTutorialState {
  /** The tip to show, or null (not started, finished, or its anchor is missing). */
  step: ShareTutorialStep | null;
  /** 1-based number shown in the tip's badge. */
  number: number;
  anchorRect: AnchorRect | null;
  next: () => void;
  skip: () => void;
}

/** Real bubbles of a column (not its scroll pills); `ready` keeps only generated / simulated ones. */
function columnBubble(columnId: string, ready: boolean): Element | null {
  const column = document.getElementById(columnId);
  if (!column) return null;
  return column.querySelector(ready ? 'button.bubble.bubble--ready' : 'button.bubble:not(.bubble--scroll)');
}

// Module-level resolvers: stable identities for useAnchorRect.
const STEP_DEFS: Record<ShareTutorialStepId, ShareTutorialStep> = {
  scene: {
    id: 'scene',
    placement: 'right',
    resolveAnchor: () => columnBubble(SIMPLE_MODE.SOUNDSCAPES_COLUMN_ID, true),
  },
  play: {
    id: 'play',
    placement: 'above',
    resolveAnchor: () => document.getElementById(SCENE_BOTTOM_BAR.PLAY_BUTTON_ID),
  },
  acoustics: {
    id: 'acoustics',
    placement: 'left',
    resolveAnchor: () =>
      columnBubble(SIMPLE_MODE.ACOUSTICS_COLUMN_ID, true) ? document.getElementById(SIMPLE_MODE.ACOUSTICS_COLUMN_ID) : null,
  },
  listeners: {
    id: 'listeners',
    placement: 'left',
    resolveAnchor: () =>
      columnBubble(SIMPLE_MODE.LISTENERS_COLUMN_ID, false) ? document.getElementById(SIMPLE_MODE.LISTENERS_COLUMN_ID) : null,
  },
};

function isScenePowered(): boolean {
  const ui = useUIStore.getState();
  return ui.isInSoundsStep && ui.activeSoundParentIndex !== null;
}

function isAnyPlaying(): boolean {
  return useAudioControlsStore.getState().isAnyPlaying();
}

/**
 * Steps of the tour, decided once when it starts: steps already done are left
 * out (a scene already on, already playing) and so are columns with nothing to
 * switch, so the badge numbers stay consecutive.
 */
function buildSteps(): ShareTutorialStep[] {
  const steps: ShareTutorialStep[] = [];
  if (!isScenePowered()) steps.push(STEP_DEFS.scene);
  if (!isAnyPlaying()) steps.push(STEP_DEFS.play);
  if (STEP_DEFS.acoustics.resolveAnchor()) steps.push(STEP_DEFS.acoustics);
  if (STEP_DEFS.listeners.resolveAnchor()) steps.push(STEP_DEFS.listeners);
  return steps;
}

/**
 * Share view: first-load numbered coach-mark tour (turn a scene on → press
 * play → switch acoustic simulations → switch listeners).
 *
 * Starts once the model is loaded and a playable scene exists, shows one tip
 * at a time, and moves on when the visitor does the step (scene powered,
 * playback started), clicks the tip, or after `STEP_DURATION_MS`. A step whose
 * anchor never appears (Play is only shown once a scene is on) is skipped after
 * `ANCHOR_WAIT_MS`. Shown once per browser (useOneTimeHint).
 *
 * Usage:
 * ```tsx
 * const { step, number, anchorRect, next, skip } = useShareTutorial();
 * ```
 */
export function useShareTutorial(): ShareTutorialState {
  const isShareView = useShareViewStore((s) => s.isShareView);
  const { seen, markSeen } = useOneTimeHint(SHARE_TUTORIAL.HINT_ID);
  const isViewerReady = useSpeckleEngineStore((s) => s.coordinator !== null);
  const scenes = useSoundScenes();
  const hasPlayableScene = scenes.some((s) => s.generatedCount > 0);
  const scenePowered = useUIStore((s) => s.isInSoundsStep && s.activeSoundParentIndex !== null);
  const isPlaying = useAudioControlsStore((s) => Object.values(s.individualSoundStates).some((v) => v === 'playing'));

  const [steps, setSteps] = useState<ShareTutorialStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const startedRef = useRef(false);

  // Start on the first model load with something to play.
  useEffect(() => {
    if (!isShareView || seen || startedRef.current || !isViewerReady || !hasPlayableScene) return;
    const timer = window.setTimeout(() => {
      startedRef.current = true;
      setSteps(buildSteps());
      setIndex(0);
    }, SHARE_TUTORIAL.START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isShareView, seen, isViewerReady, hasPlayableScene]);

  const current = steps?.[index] ?? null;
  const anchorRect = useAnchorRect(current ? current.resolveAnchor : null, SHARE_TUTORIAL.ANCHOR_POLL_MS);
  const hasAnchor = anchorRect !== null;

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const skip = useCallback(() => {
    setSteps(null);
    markSeen();
  }, [markSeen]);

  // Past the last step: the tour is done for good.
  useEffect(() => {
    if (steps && index >= steps.length) skip();
  }, [steps, index, skip]);

  // The visitor did what the tip asks.
  useEffect(() => {
    if ((current?.id === 'scene' && scenePowered) || (current?.id === 'play' && isPlaying)) next();
  }, [current, scenePowered, isPlaying, next]);

  // Hide after a while — the clock restarts when a late anchor appears.
  useEffect(() => {
    if (!current) return;
    const delay = hasAnchor ? SHARE_TUTORIAL.STEP_DURATION_MS : SHARE_TUTORIAL.ANCHOR_WAIT_MS;
    const timer = window.setTimeout(next, delay);
    return () => window.clearTimeout(timer);
  }, [current, hasAnchor, next]);

  return {
    step: current && hasAnchor ? current : null,
    number: index + 1,
    anchorRect,
    next,
    skip,
  };
}

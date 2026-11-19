'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioControlsStore, useShareViewStore, useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { useOneTimeHint } from '@/hooks/useOneTimeHint';
import { useAnchorRect, type AnchorRect } from '@/hooks/useAnchorRect';
import { SCENE_BOTTOM_BAR, SHARE_TUTORIAL, SIMPLE_MODE, VIEW_MODE_TOOLBAR_ID } from '@/utils/constants';

export type ShareTutorialStepId = keyof typeof SHARE_TUTORIAL.STEPS;
/** Side of the anchor the tip sits on. */
export type ShareTutorialPlacement = 'right' | 'left' | 'above' | 'below';

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
  /** An earlier step can be shown (the "previous" arrow). */
  hasPrev: boolean;
  /** No later step can be shown: "next" ends the tour. */
  isLast: boolean;
  next: () => void;
  prev: () => void;
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
  viewModes: {
    id: 'viewModes',
    placement: 'below',
    resolveAnchor: () => document.getElementById(VIEW_MODE_TOOLBAR_ID),
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
  steps.push(STEP_DEFS.viewModes);
  return steps;
}

/**
 * Share view: first-load numbered coach-mark tour (turn a scene on → press
 * play → switch acoustic simulations → switch listeners → change the view mode).
 *
 * Starts once the model is loaded, a playable scene exists and the visitor
 * first acted on the page (pointer, key, wheel, touch), shows one tip
 * at a time and keeps it open (no timers) until the visitor clicks it or the
 * "next" arrow, goes back with the "previous" arrow, closes it, or does what it
 * asks (turns a scene on, starts playback). Arrows skip steps whose anchor is
 * not on screen (Play is only shown once a scene is on). Shown once per
 * browser (useOneTimeHint); the bottom bar's
 * "Tour" button replays it (`shareViewStore.requestTutorialReplay`).
 *
 * Usage:
 * ```tsx
 * const { step, number, anchorRect, hasPrev, isLast, next, prev, skip } = useShareTutorial();
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

  const replayNonce = useShareViewStore((s) => s.tutorialReplayNonce);
  const setTutorialActive = useShareViewStore((s) => s.setTutorialActive);

  const [steps, setSteps] = useState<ShareTutorialStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const startedRef = useRef(false);

  const start = useCallback(() => {
    startedRef.current = true;
    setSteps(buildSteps());
    setIndex(0);
  }, []);

  // An idle tab never starts the tour: wait for the visitor's first action.
  useEffect(() => {
    if (!isShareView || seen || hasInteracted) return;
    const onAction = () => setHasInteracted(true);
    const options: AddEventListenerOptions = { capture: true, passive: true };
    SHARE_TUTORIAL.INTERACTION_EVENTS.forEach((type) => window.addEventListener(type, onAction, options));
    return () => SHARE_TUTORIAL.INTERACTION_EVENTS.forEach((type) => window.removeEventListener(type, onAction, options));
  }, [isShareView, seen, hasInteracted]);

  // Start on the first model load with something to play, once the visitor acted.
  useEffect(() => {
    if (!isShareView || seen || startedRef.current || !isViewerReady || !hasPlayableScene || !hasInteracted) return;
    const timer = window.setTimeout(start, SHARE_TUTORIAL.START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isShareView, seen, isViewerReady, hasPlayableScene, hasInteracted, start]);

  // Replay requested from the bottom bar.
  useEffect(() => {
    if (replayNonce > 0) start();
  }, [replayNonce, start]);

  // The bottom bar hides its replay button while the tour is on screen.
  useEffect(() => {
    setTutorialActive(steps !== null);
  }, [steps, setTutorialActive]);

  const current = steps?.[index] ?? null;
  const anchorRect = useAnchorRect(current ? current.resolveAnchor : null, SHARE_TUTORIAL.ANCHOR_POLL_MS);
  const hasAnchor = anchorRect !== null;

  /** Nearest step from `from` in `direction` whose anchor is on screen now, or -1. */
  const findShown = useCallback((from: number, direction: 1 | -1): number => {
    if (!steps) return -1;
    for (let i = from + direction; i >= 0 && i < steps.length; i += direction) {
      if (steps[i].resolveAnchor()) return i;
    }
    return -1;
  }, [steps]);

  const skip = useCallback(() => {
    setSteps(null);
    markSeen();
  }, [markSeen]);

  // Arrows / tip click: past the last shown step the tour is done for good.
  const next = useCallback(() => {
    const target = findShown(index, 1);
    if (target < 0) skip();
    else setIndex(target);
  }, [findShown, index, skip]);

  const prev = useCallback(() => {
    const target = findShown(index, -1);
    if (target >= 0) setIndex(target);
  }, [findShown, index]);

  // The visitor did what the tip asks: move on to the very next step (its anchor,
  // e.g. Play once a scene is on, may appear a moment later). Only the transition
  // counts, so going back to a done step keeps it open.
  const prevActionsRef = useRef({ scenePowered, isPlaying });
  useEffect(() => {
    const before = prevActionsRef.current;
    prevActionsRef.current = { scenePowered, isPlaying };
    const done = (current?.id === 'scene' && scenePowered && !before.scenePowered)
      || (current?.id === 'play' && isPlaying && !before.isPlaying);
    if (!done || !steps) return;
    if (index + 1 >= steps.length) skip();
    else setIndex(index + 1);
  }, [current, scenePowered, isPlaying, steps, index, skip]);

  return {
    step: current && hasAnchor ? current : null,
    number: index + 1,
    anchorRect,
    hasPrev: findShown(index, -1) >= 0,
    isLast: findShown(index, 1) < 0,
    next,
    prev,
    skip,
  };
}

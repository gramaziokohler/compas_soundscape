'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAcousticsSimulationStore, useAudioControlsStore, useShareViewStore, useSpeckleStore, useUIStore } from '@/store';
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
  /** The tip to show, or null (hidden, finished, or its anchor is missing). */
  step: ShareTutorialStep | null;
  /** 1-based number shown in the tip's badge. */
  number: number;
  anchorRect: AnchorRect | null;
  /** Not the first step (the "previous" arrow is enabled). */
  hasPrev: boolean;
  /** The last step: "next" finishes the tour. */
  isLast: boolean;
  next: () => void;
  prev: () => void;
  skip: () => void;
  /** Incremented each time the tour is hidden (× / Tour button / finished) — drives the close animation. */
  closeNonce: number;
}

export interface UseShareTutorialArgs {
  /** Powered listener (single or grid listener id), or null. */
  activeListenerId: string | null;
}

/** Real bubbles of a column (not its scroll pills); `ready` keeps only generated / simulated ones. */
function columnBubble(columnId: string, ready: boolean): Element | null {
  const column = document.getElementById(columnId);
  if (!column) return null;
  return column.querySelector(ready ? 'button.bubble.bubble--ready' : 'button.bubble:not(.bubble--scroll)');
}

// Module-level resolvers: stable identities for useAnchorRect. Each falls back
// to a broader anchor so a step never vanishes (Play only exists once a scene
// is on: until then the tip points at the bottom bar's centre).
const STEP_DEFS: Record<ShareTutorialStepId, ShareTutorialStep> = {
  scene: {
    id: 'scene',
    placement: 'right',
    resolveAnchor: () =>
      columnBubble(SIMPLE_MODE.SOUNDSCAPES_COLUMN_ID, true) ?? document.getElementById(SIMPLE_MODE.SOUNDSCAPES_COLUMN_ID),
  },
  play: {
    id: 'play',
    placement: 'above',
    resolveAnchor: () =>
      document.getElementById(SCENE_BOTTOM_BAR.PLAY_BUTTON_ID) ?? document.querySelector('.scene-bottom-bar'),
  },
  acoustics: {
    id: 'acoustics',
    placement: 'left',
    resolveAnchor: () => document.getElementById(SIMPLE_MODE.ACOUSTICS_COLUMN_ID),
  },
  listeners: {
    id: 'listeners',
    placement: 'left',
    resolveAnchor: () => document.getElementById(SIMPLE_MODE.LISTENERS_COLUMN_ID),
  },
  viewModes: {
    id: 'viewModes',
    placement: 'below',
    resolveAnchor: () => document.getElementById(VIEW_MODE_TOOLBAR_ID),
  },
};

/**
 * Steps of the tour, decided once (the first time it opens) and then kept, so
 * the badge numbers never change. Every phase is kept — even one already done
 * (a scene on, playback running); only a column with nothing shared is left out.
 */
function buildSteps(): ShareTutorialStep[] {
  const steps: ShareTutorialStep[] = [STEP_DEFS.scene, STEP_DEFS.play];
  if (columnBubble(SIMPLE_MODE.ACOUSTICS_COLUMN_ID, false)) steps.push(STEP_DEFS.acoustics);
  if (columnBubble(SIMPLE_MODE.LISTENERS_COLUMN_ID, false)) steps.push(STEP_DEFS.listeners);
  steps.push(STEP_DEFS.viewModes);
  return steps;
}

/**
 * Share view: numbered coach-mark tour (turn a scene on → press play → switch
 * acoustic simulations → switch listeners → change the view mode).
 *
 * Opens by itself once — when the model is loaded, a playable scene exists and
 * the visitor first acted on the page (pointer, key, wheel, touch). One tip at
 * a time, open until the visitor acts (no timers): a click on the tip or the ›
 * arrow moves on, ‹ goes back, × or the bottom bar's "Tour" button hides the
 * tour at its current step, and "Tour" shows it again there
 * (`shareViewStore.requestTutorialToggle`). Doing what a tip asks (turning a
 * scene on, starting playback, switching a simulation or a listener, changing
 * the view mode) also moves on. Past the last step the tour is
 * finished and the next "Tour" starts over. Opening by itself happens once per
 * browser (useOneTimeHint).
 *
 * Usage:
 * ```tsx
 * const { step, number, anchorRect, hasPrev, isLast, next, prev, skip, closeNonce } =
 *   useShareTutorial({ activeListenerId });
 * ```
 */
export function useShareTutorial({ activeListenerId }: UseShareTutorialArgs): ShareTutorialState {
  const isShareView = useShareViewStore((s) => s.isShareView);
  const { seen, markSeen } = useOneTimeHint(SHARE_TUTORIAL.HINT_ID);
  const isViewerReady = useSpeckleEngineStore((s) => s.coordinator !== null);
  const scenes = useSoundScenes();
  const hasPlayableScene = scenes.some((s) => s.generatedCount > 0);
  // What each step asks the visitor to do, as a value: the step moves on when its
  // value changes to a non-null one (turning on / switching to another item).
  const activeScene = useUIStore((s) => (s.isInSoundsStep && s.activeSoundParentIndex !== null ? `scene-${s.activeSoundParentIndex}` : null));
  const isPlaying = useAudioControlsStore((s) => Object.values(s.individualSoundStates).some((v) => v === 'playing'));
  const activeSimulation = useAcousticsSimulationStore((s) =>
    s.activeSimulationIndex !== null
      ? s.simulationConfigs[s.activeSimulationIndex]?.id ?? null
      : s.activeResonanceIds[s.activeResonanceIds.length - 1] ?? null);
  const viewMode = useSpeckleStore((s) => s.viewMode);

  const toggleNonce = useShareViewStore((s) => s.tutorialToggleNonce);
  const setTutorialActive = useShareViewStore((s) => s.setTutorialActive);

  const [steps, setSteps] = useState<ShareTutorialStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [closeNonce, setCloseNonce] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const startedRef = useRef(false);

  const open = useCallback(() => {
    startedRef.current = true;
    setSteps((prev) => prev ?? buildSteps());
    setIsOpen(true);
  }, []);

  /** Hide at the current step (shown again there by "Tour"). */
  const skip = useCallback(() => {
    setIsOpen(false);
    setCloseNonce((n) => n + 1);
    markSeen();
  }, [markSeen]);

  /** Past the last step: hide, and the next "Tour" starts over. */
  const finish = useCallback(() => {
    setIsOpen(false);
    setCloseNonce((n) => n + 1);
    setIndex(0);
    markSeen();
  }, [markSeen]);

  // An idle tab never opens the tour: wait for the visitor's first action.
  useEffect(() => {
    if (!isShareView || seen || hasInteracted) return;
    const onAction = () => setHasInteracted(true);
    const options: AddEventListenerOptions = { capture: true, passive: true };
    SHARE_TUTORIAL.INTERACTION_EVENTS.forEach((type) => window.addEventListener(type, onAction, options));
    return () => SHARE_TUTORIAL.INTERACTION_EVENTS.forEach((type) => window.removeEventListener(type, onAction, options));
  }, [isShareView, seen, hasInteracted]);

  // Open by itself on the first model load with something to play, once the visitor acted.
  useEffect(() => {
    if (!isShareView || seen || startedRef.current || !isViewerReady || !hasPlayableScene || !hasInteracted) return;
    const timer = window.setTimeout(open, SHARE_TUTORIAL.START_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isShareView, seen, isViewerReady, hasPlayableScene, hasInteracted, open]);

  // "Tour" button: hide / show again at the saved step. The open state is read
  // at click time — this effect must not re-run when the tour closes itself.
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  useEffect(() => {
    if (toggleNonce === 0) return;
    if (isOpenRef.current) skip();
    else open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleNonce]);

  // The bottom bar's "Tour" button is active while the tour is on screen.
  useEffect(() => {
    setTutorialActive(isOpen);
  }, [isOpen, setTutorialActive]);

  const current = isOpen ? steps?.[index] ?? null : null;
  const anchorRect = useAnchorRect(current ? current.resolveAnchor : null, SHARE_TUTORIAL.ANCHOR_POLL_MS);
  const isLast = !!steps && index >= steps.length - 1;

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }, [isLast, finish]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // The visitor did what the tip asks: move on. Only a change counts, so going
  // back to a done step keeps it open until the visitor acts again.
  const actions: Record<ShareTutorialStepId, string | null> = {
    scene: activeScene,
    play: isPlaying ? 'playing' : null,
    acoustics: activeSimulation,
    listeners: activeListenerId,
    viewModes: viewMode,
  };
  const prevActionsRef = useRef(actions);
  useEffect(() => {
    const before = prevActionsRef.current;
    prevActionsRef.current = actions;
    const id = current?.id;
    if (id && actions[id] !== null && actions[id] !== before[id]) next();
    // `actions` is rebuilt every render from the values listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, activeScene, isPlaying, activeSimulation, activeListenerId, viewMode, next]);

  return {
    step: current && anchorRect ? current : null,
    number: index + 1,
    anchorRect,
    hasPrev: index > 0,
    isLast,
    next,
    prev,
    skip,
    closeNonce,
  };
}

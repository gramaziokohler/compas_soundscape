'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bubble, BubbleAddButton, BubbleHeading } from '@/components/ui/Bubble';
import { WaveformRing } from '@/components/ui/BubbleIcons';
import { BubblePanel } from '@/components/ui/BubblePanel';
import { BubbleScrollColumn } from '@/components/ui/BubbleScrollColumn';
import { SoundGenerationSection } from '@/components/layout/sidebar/SoundGenerationSection';
import { buildSoundGenerationSectionProps } from '@/components/layout/sidebar/soundSectionProps';
import { ScenePromptComposer } from './ScenePromptComposer';
import { SceneSettingsSummary } from './SceneSettingsSummary';
import { SceneWorkflowDetail } from './SceneWorkflowDetail';
import { NEW_SCENE_ADD_BUTTON_ID } from './HomeSceneComposer';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { useSceneProgress } from '@/hooks/useSceneProgress';
import { useSceneWaveform } from '@/hooks/useSceneWaveform';
import { useDismissOnSceneClick } from '@/hooks/useDismissOnSceneClick';
import { useBubbleColumnSpace } from '@/hooks/useBubbleColumnSpace';
import {
  useAnalysisStore,
  useAudioControlsStore,
  useCardFlowStore,
  useSceneWorkflowStore,
  useUIStore,
} from '@/store';
import type { SidebarProps } from '@/types/components';
import type { SceneProgress, SoundScene } from '@/types/sceneWorkflow';
import { useHomeComposerStore } from '@/store/homeComposerStore';
import { SIMPLE_MODE } from '@/utils/constants';

type LeftPanel =
  | { kind: 'composer' }
  | { kind: 'scene'; usageIndex: number }
  | { kind: 'workflow'; usageIndex: number }
  | null;

const COLUMN_TOP = SIMPLE_MODE.TOP_OFFSET + SIMPLE_MODE.HEADING_HEIGHT;
const PANEL_LEFT = SIMPLE_MODE.EDGE_MARGIN + SIMPLE_MODE.BUBBLE_SIZE + SIMPLE_MODE.PANEL_GAP;

const REMOVE_SCENE_MESSAGE = 'Remove this scene and its sounds?';

/** Scenes that still need the pipeline open the workflow view instead of the sound cards. */
function showsWorkflow(scene: SoundScene, progress: SceneProgress): boolean {
  return scene.isScenario && progress.status !== 'done';
}

/** A scene can be powered (shown in 3D + DAW) once it has at least one generated sound. */
function isPlayable(scene: SoundScene): boolean {
  return scene.generatedCount > 0;
}

function powerTitle(on: boolean): string {
  return on ? 'Hide this scene' : 'Show and play this scene';
}

// ─── One scene bubble (owns its progress + waveform subscriptions) ───────────

interface SceneBubbleProps {
  scene: SoundScene;
  /** Powered: the scene shown in 3D + DAW. */
  selected: boolean;
  /** Its panel is open. */
  open: boolean;
  onClick: (scene: SoundScene, progress: SceneProgress) => void;
  onTogglePower: (scene: SoundScene) => void;
}

function SceneBubble({ scene, selected, open, onClick, onTogglePower }: SceneBubbleProps) {
  const progress = useSceneProgress(scene);
  const envelope = useSceneWaveform(scene);
  const status =
    progress.status === 'running' ? 'running'
      : progress.status === 'queued' ? 'queued'
        : progress.status === 'error' ? 'error'
          : 'idle';
  const ready = progress.status === 'done';
  const detail = `${progress.statusText} · click to ${open ? 'reduce' : 'open'}`;
  return (
    <Bubble
      label={scene.fullTitle}
      detail={detail}
      icon={<WaveformRing values={envelope} size={SIMPLE_MODE.BUBBLE_SIZE} />}
      ready={ready}
      selected={selected}
      status={status}
      progress={progress.fraction}
      onClick={() => onClick(scene, progress)}
      onTogglePower={isPlayable(scene) ? () => onTogglePower(scene) : undefined}
      powerTitle={powerTitle(selected)}
    />
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function WorkflowPanel({ scene, powered, onTogglePower, onReduce, onShowSounds, onRemove, removeDisabledReason }: {
  scene: SoundScene;
  powered: boolean;
  onTogglePower: () => void;
  onReduce: () => void;
  onShowSounds: () => void;
  onRemove: () => void;
  removeDisabledReason?: string;
}) {
  const progress = useSceneProgress(scene);
  const switchUIMode = useSceneWorkflowStore((s) => s.switchUIMode);
  return (
    <BubblePanel
      ariaLabel={`${scene.title} progress`}
      title={scene.title}
      titleTooltip={scene.fullTitle}
      subtitle={progress.statusText}
      onReduce={onReduce}
      onRemove={onRemove}
      removeTitle="Remove scene"
      removeConfirmMessage={REMOVE_SCENE_MESSAGE}
      removeDisabledReason={removeDisabledReason}
      onTogglePower={isPlayable(scene) ? onTogglePower : undefined}
      powered={powered}
      powerTitle={powerTitle(powered)}
      style={{ position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
    >
      <SceneWorkflowDetail
        scene={scene}
        progress={progress}
        onOpenExpert={() => switchUIMode('expert', scene.usageIndex)}
        onShowSounds={onShowSounds}
      />
    </BubblePanel>
  );
}

// ─── Column ──────────────────────────────────────────────────────────────────

export interface SimpleSoundscapesProps {
  /** The same props the expert Sidebar receives — used to render the scene's sound cards. */
  sidebarProps: SidebarProps;
}

/**
 * SimpleSoundscapes Component
 *
 * Simple-mode replacement for the left sidebar: a floating column of scene
 * bubbles (waveform-ring icons), a "+" that opens the prompt composer, and one
 * floating panel at a time (composer, live workflow detail, or the scene's
 * sound cards).
 *
 * A click on a bubble only opens / reduces its panel (sound cards, or the
 * workflow view while the scene's pipeline runs). The power button — in the
 * bubble's hover flyout and the panel header — shows the scene (DAW + 3D); at
 * most one scene is powered, and none is a valid state (nothing shown). A
 * plain click on the 3D scene reduces the panel.
 *
 * Usage:
 * ```tsx
 * {uiMode === 'simple' && <SimpleSoundscapes sidebarProps={sidebarProps} />}
 * ```
 */
export function SimpleSoundscapes({ sidebarProps }: SimpleSoundscapesProps) {
  const scenes = useSoundScenes();
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);
  const activeUsageIndex = useSceneWorkflowStore((s) => s.activeUsageIndex);
  const queueLength = useSceneWorkflowStore((s) => s.queue.length);
  const startScene = useSceneWorkflowStore((s) => s.startScene);

  const columnSpace = useBubbleColumnSpace();

  const [panel, setPanel] = useState<LeftPanel>(null);
  // The composer stays mounted once opened so a stray click doesn't lose a draft.
  const [composerMounted, setComposerMounted] = useState(false);
  // A scene sent from the centred Home panel (HomeSceneComposer) opens its workflow view.
  const submittedUsageIndex = useHomeComposerStore((s) => s.submittedUsageIndex);
  useEffect(() => {
    if (submittedUsageIndex === null) return;
    setPanel({ kind: 'workflow', usageIndex: submittedUsageIndex });
    useHomeComposerStore.getState().setSubmitted(null);
  }, [submittedUsageIndex]);

  // Mirror the open scene panel so a switch to Detailed mode opens the same scene.
  useEffect(() => {
    useSceneWorkflowStore.getState().setOpenSimplePanel(
      panel && panel.kind !== 'composer' ? { kind: panel.kind, usageIndex: panel.usageIndex } : null,
    );
  }, [panel]);

  const busy = activeUsageIndex !== null || queueLength > 0;
  const removeDisabledReason = busy ? 'Wait until the running scene finishes' : undefined;

  const closePanel = useCallback(() => setPanel(null), []);

  useDismissOnSceneClick(closePanel, panel !== null, () => !!sidebarProps.isLinkingEntity);

  const selectScene = useCallback((scene: SoundScene) => {
    useAudioControlsStore.getState().stopSoundcardPreview();
    useUIStore.getState().setActiveSoundParentIndex(scene.usageIndex);
    const flow = useCardFlowStore.getState();
    flow.setActiveUsageOriginalIndex(scene.usageIndex);
    flow.setActiveContextOriginalIndex(scene.contextIndex);
  }, []);

  const deselectScene = useCallback(() => {
    const audio = useAudioControlsStore.getState();
    audio.stopSoundcardPreview();
    audio.stopAll();
    const ui = useUIStore.getState();
    ui.setActiveSoundParentIndex(null);
    // Out of the Sounds step the 3D scene and the DAW show no sounds at all
    // (a null parent *inside* the step would show every scene's sounds).
    ui.setIsInSoundsStep(false);
  }, []);

  const toggleScenePower = useCallback((scene: SoundScene) => {
    const ui = useUIStore.getState();
    if (ui.isInSoundsStep && ui.activeSoundParentIndex === scene.usageIndex) deselectScene();
    else selectScene(scene);
  }, [selectScene, deselectScene]);

  // The expert Sidebar is unmounted here, so Simple mode owns the "which scene
  // is shown" state: repair a stale selection (after a mode switch, a restore,
  // or a removal). "No scene powered" (null parent, out of the Sounds step) is
  // a deliberate user choice and is kept. Never overrides a valid user choice.
  useEffect(() => {
    if (activeSoundParentIndex === null && !isInSoundsStep) return;
    const valid = scenes.some((s) => s.usageIndex === activeSoundParentIndex);
    if (valid) {
      if (!isInSoundsStep) useUIStore.getState().setIsInSoundsStep(true);
      return;
    }
    const playable = scenes.filter((s) => s.generatedCount > 0);
    if (playable.length === 0) return;
    const preferred = useCardFlowStore.getState().activeUsageOriginalIndex;
    selectScene(playable.find((s) => s.usageIndex === preferred) ?? playable[playable.length - 1]);
  }, [scenes, activeSoundParentIndex, isInSoundsStep, selectScene]);

  // Coming back from Expert mode: open the scene the expert sidebar was showing.
  const focusConsumedRef = useRef(false);
  useEffect(() => {
    if (focusConsumedRef.current || scenes.length === 0) return;
    focusConsumedRef.current = true;
    const focus = useSceneWorkflowStore.getState().consumeSimpleFocus();
    const scene = focus !== null ? scenes.find((s) => s.usageIndex === focus) : undefined;
    if (!scene) return;
    if (scene.generatedCount > 0) selectScene(scene);
    const done = scene.soundCount > 0 && scene.generatedCount === scene.soundCount;
    setPanel(scene.isScenario && !done ? { kind: 'workflow', usageIndex: scene.usageIndex } : { kind: 'scene', usageIndex: scene.usageIndex });
  }, [scenes, selectScene]);

  // A sound sphere clicked in 3D opens its scene's cards (the card itself
  // expands through SoundGenerationSection's `selectedCardIndex`).
  const lastSelectedCardRef = useRef(sidebarProps.selectedCardIndex ?? null);
  useEffect(() => {
    const index = sidebarProps.selectedCardIndex ?? null;
    if (index === lastSelectedCardRef.current) return;
    lastSelectedCardRef.current = index;
    if (index === null) return;
    const parent = sidebarProps.soundConfigs[index]?.parentUsageOriginalIndex;
    const scene = scenes.find((s) => s.usageIndex === parent);
    if (!scene) return;
    selectScene(scene);
    setPanel({ kind: 'scene', usageIndex: scene.usageIndex });
  }, [sidebarProps.selectedCardIndex, sidebarProps.soundConfigs, scenes, selectScene]);

  // Drop a panel whose scene disappeared (removed / undone).
  useEffect(() => {
    if (panel && panel.kind !== 'composer' && !scenes.some((s) => s.usageIndex === panel.usageIndex)) {
      setPanel(null);
    }
  }, [scenes, panel]);

  // Expand / reduce only — powering a scene is the flyout / header button's job.
  const handleSceneClick = useCallback((scene: SoundScene, progress: SceneProgress) => {
    const kind = showsWorkflow(scene, progress) ? 'workflow' : 'scene';
    setPanel((p) =>
      p && p.kind !== 'composer' && p.usageIndex === scene.usageIndex ? null : { kind, usageIndex: scene.usageIndex },
    );
  }, []);

  const handleSubmit = useCallback((prompt: string, options: Parameters<typeof startScene>[1]) => {
    const usageIndex = startScene(prompt, options);
    setComposerMounted(false);
    setPanel({ kind: 'workflow', usageIndex });
  }, [startScene]);

  const removeScene = useCallback((usageIndex: number) => {
    // Removal re-keys every usage-index link (scene runs, active sound parent) —
    // the removed scene's run and selection are dropped there, later ones shift.
    useAnalysisStore.getState().handleRemoveConfig(usageIndex);
    closePanel();
  }, [closePanel]);

  const panelScene =
    panel && panel.kind !== 'composer' ? scenes.find((s) => s.usageIndex === panel.usageIndex) : undefined;

  // Scroll the open panel's scene into view, else the selected (playing) one.
  const focusUsageIndex =
    panel && panel.kind !== 'composer' ? panel.usageIndex : isInSoundsStep ? activeSoundParentIndex : null;
  const focusIndex = scenes.findIndex((s) => s.usageIndex === focusUsageIndex);

  const isPowered = (usageIndex: number) => isInSoundsStep && activeSoundParentIndex === usageIndex;

  return (
    <>
      <BubbleHeading style={{ left: SIMPLE_MODE.EDGE_MARGIN, top: SIMPLE_MODE.TOP_OFFSET }}>Soundscapes</BubbleHeading>
      <BubbleScrollColumn
        id={SIMPLE_MODE.SOUNDSCAPES_COLUMN_ID}
        availablePx={columnSpace.soundscapes}
        focusIndex={focusIndex}
        style={{ left: SIMPLE_MODE.EDGE_MARGIN, top: COLUMN_TOP, zIndex: SIMPLE_MODE.Z_INDEX }}
        items={scenes.map((scene) => (
          <SceneBubble
            key={scene.usageIndex}
            scene={scene}
            selected={isPowered(scene.usageIndex)}
            open={panel !== null && panel.kind !== 'composer' && panel.usageIndex === scene.usageIndex}
            onClick={handleSceneClick}
            onTogglePower={toggleScenePower}
          />
        ))}
        addButton={
          <BubbleAddButton
            label={scenes.length === 0 ? 'Describe a scene to begin' : 'New sound scene'}
            id={NEW_SCENE_ADD_BUTTON_ID}
            active={panel?.kind === 'composer'}
            onClick={() => {
              // "+" starts a new scene card: it replaces the centred Home panel.
              useHomeComposerStore.getState().dismiss();
              setComposerMounted(true);
              setPanel((p) => (p?.kind === 'composer' ? null : { kind: 'composer' }));
            }}
          />
        }
      />

      {composerMounted && (
        <div style={{ display: panel?.kind === 'composer' ? undefined : 'none' }}>
          <BubblePanel
            ariaLabel="New sound scene"
            title="New sound scene"
            onReduce={closePanel}
            width={SIMPLE_MODE.COMPOSER_WIDTH}
            style={{ position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
          >
            <ScenePromptComposer willQueue={busy} onSubmit={handleSubmit} onClose={closePanel} />
          </BubblePanel>
        </div>
      )}

      {panel?.kind === 'workflow' && panelScene && (
        <WorkflowPanel
          scene={panelScene}
          powered={isPowered(panelScene.usageIndex)}
          onTogglePower={() => toggleScenePower(panelScene)}
          onReduce={closePanel}
          onShowSounds={() => setPanel({ kind: 'scene', usageIndex: panelScene.usageIndex })}
          onRemove={() => removeScene(panelScene.usageIndex)}
          removeDisabledReason={removeDisabledReason}
        />
      )}

      {panel?.kind === 'scene' && panelScene && (
        <BubblePanel
          ariaLabel={`${panelScene.title} sounds`}
          title={panelScene.title}
          titleTooltip={panelScene.fullTitle}
          onReduce={closePanel}
          onRemove={() => removeScene(panelScene.usageIndex)}
          removeTitle="Remove scene"
          removeConfirmMessage={REMOVE_SCENE_MESSAGE}
          removeDisabledReason={removeDisabledReason}
          onTogglePower={isPlayable(panelScene) ? () => toggleScenePower(panelScene) : undefined}
          powered={isPowered(panelScene.usageIndex)}
          powerTitle={powerTitle(isPowered(panelScene.usageIndex))}
          style={{ position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
        >
          <div className="mb-2">
            <SceneSettingsSummary usageIndex={panelScene.usageIndex} />
          </div>
          <SoundGenerationSection {...buildSoundGenerationSectionProps(sidebarProps, panelScene.usageIndex)} />
        </BubblePanel>
      )}
    </>
  );
}

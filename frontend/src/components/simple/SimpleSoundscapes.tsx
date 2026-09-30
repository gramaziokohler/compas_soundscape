'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bubble, BubbleAddButton, BubbleHeading } from '@/components/ui/Bubble';
import { WaveformRing } from '@/components/ui/BubbleIcons';
import { BubblePanel } from '@/components/ui/BubblePanel';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SoundGenerationSection } from '@/components/layout/sidebar/SoundGenerationSection';
import { buildSoundGenerationSectionProps } from '@/components/layout/sidebar/soundSectionProps';
import { ScenePromptComposer } from './ScenePromptComposer';
import { SceneWorkflowDetail } from './SceneWorkflowDetail';
import { HomeUploadPrompt } from '@/components/scene/HomeUploadPrompt';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { useSceneProgress } from '@/hooks/useSceneProgress';
import { useSceneWaveform } from '@/hooks/useSceneWaveform';
import { useDismissOnSceneClick } from '@/hooks/useDismissOnSceneClick';
import {
  useAnalysisStore,
  useAudioControlsStore,
  useCardFlowStore,
  useSceneWorkflowStore,
  useUIStore,
} from '@/store';
import type { SidebarProps } from '@/types/components';
import type { SceneProgress, SoundScene } from '@/types/sceneWorkflow';
import { HOME_STAGE, SCENE_BOTTOM_BAR, SIMPLE_MODE } from '@/utils/constants';

type LeftPanel =
  | { kind: 'composer' }
  | { kind: 'scene'; usageIndex: number }
  | { kind: 'workflow'; usageIndex: number }
  | null;

const LABEL_HEIGHT = 24; // px — heading row above the first bubble
const COLUMN_TOP = SIMPLE_MODE.TOP_OFFSET + LABEL_HEIGHT;
const PANEL_LEFT = SIMPLE_MODE.EDGE_MARGIN + SIMPLE_MODE.BUBBLE_SIZE + SIMPLE_MODE.PANEL_GAP;

/**
 * The centred Home new-scene panel opens by itself once per page load of a fresh
 * Home stage (no `?model_id=` / `?home=` project). Module-level so a Simple ↔
 * Expert round trip doesn't re-open it.
 */
let homeComposerOffered = false;

function isFreshHomeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return !params.get('model_id') && !params.get('home');
}

/** Scenes that still need the pipeline open the workflow view instead of the sound cards. */
function showsWorkflow(scene: SoundScene, progress: SceneProgress): boolean {
  return scene.isScenario && progress.status !== 'done';
}

// ─── One scene bubble (owns its progress + waveform subscriptions) ───────────

interface SceneBubbleProps {
  scene: SoundScene;
  selected: boolean;
  onClick: (scene: SoundScene, progress: SceneProgress) => void;
}

function SceneBubble({ scene, selected, onClick }: SceneBubbleProps) {
  const progress = useSceneProgress(scene);
  const envelope = useSceneWaveform(scene);
  const status =
    progress.status === 'running' ? 'running'
      : progress.status === 'queued' ? 'queued'
        : progress.status === 'error' ? 'error'
          : 'idle';
  const ready = progress.status === 'done';
  const detail = ready
    ? selected ? `${progress.statusText} · click to open` : `${progress.statusText} · click to play`
    : progress.statusText;
  return (
    <Bubble
      label={scene.title}
      detail={detail}
      icon={<WaveformRing values={envelope} size={SIMPLE_MODE.BUBBLE_SIZE} />}
      ready={ready}
      selected={selected}
      status={status}
      progress={progress.fraction}
      onClick={() => onClick(scene, progress)}
    />
  );
}

// ─── Panels ──────────────────────────────────────────────────────────────────

function WorkflowPanel({ scene, onReduce, onShowSounds, onRemove, removeDisabledReason, children }: {
  scene: SoundScene;
  onReduce: () => void;
  onShowSounds: () => void;
  onRemove: () => void;
  removeDisabledReason?: string;
  /** Rendered above the step list (e.g. the remove confirmation). */
  children?: ReactNode;
}) {
  const progress = useSceneProgress(scene);
  const switchUIMode = useSceneWorkflowStore((s) => s.switchUIMode);
  return (
    <BubblePanel
      ariaLabel={`${scene.title} progress`}
      title={scene.title}
      subtitle={progress.statusText}
      onReduce={onReduce}
      onRemove={onRemove}
      removeTitle="Remove scene"
      removeDisabledReason={removeDisabledReason}
      style={{ position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
    >
      {children}
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
 * Clicks: a generated scene that isn't playing → select it (DAW + 3D); the
 * selected scene → open / reduce its sound cards; an unfinished scene → open /
 * reduce its workflow view. A plain click on the 3D scene reduces the panel.
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

  const [panel, setPanel] = useState<LeftPanel>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  // The composer stays mounted once opened so a stray click doesn't lose a draft.
  const [composerMounted, setComposerMounted] = useState(false);
  // Home stage: the composer opens centred at the bottom under the upload prompt.
  const [homePlacement, setHomePlacement] = useState(false);
  const onHomeStage = useUIStore((s) => !s.globalSpeckleData && !s.homeProject);

  useEffect(() => {
    if (homeComposerOffered || !isFreshHomeUrl()) return;
    homeComposerOffered = true;
    setComposerMounted(true);
    setHomePlacement(true);
    setPanel({ kind: 'composer' });
  }, []);

  // The centred placement is only for that first opening: once the composer
  // closes (sent, reduced, clicked away) or a model loads, "+" opens it beside
  // the column as usual.
  useEffect(() => {
    if (!homePlacement) return;
    if (panel?.kind !== 'composer') setHomePlacement(false);
    else if (!onHomeStage) {
      setHomePlacement(false);
      setPanel(null);
    }
  }, [homePlacement, panel, onHomeStage]);

  const busy = activeUsageIndex !== null || queueLength > 0;
  const removeDisabledReason = busy ? 'Wait until the running scene finishes' : undefined;

  const closePanel = useCallback(() => {
    setPanel(null);
    setConfirmRemove(null);
  }, []);

  useDismissOnSceneClick(closePanel, panel !== null, () => !!sidebarProps.isLinkingEntity);

  const selectScene = useCallback((scene: SoundScene) => {
    useAudioControlsStore.getState().stopSoundcardPreview();
    useUIStore.getState().setActiveSoundParentIndex(scene.usageIndex);
    const flow = useCardFlowStore.getState();
    flow.setActiveUsageOriginalIndex(scene.usageIndex);
    flow.setActiveContextOriginalIndex(scene.contextIndex);
  }, []);

  // The expert Sidebar is unmounted here, so Simple mode owns the "which scene
  // is shown" state: keep a valid, generated scene selected (after a mode
  // switch, a restore, or a removal). Never overrides a valid user choice.
  useEffect(() => {
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

  const handleSceneClick = useCallback((scene: SoundScene, progress: SceneProgress) => {
    setConfirmRemove(null);
    if (showsWorkflow(scene, progress)) {
      setPanel((p) =>
        p?.kind === 'workflow' && p.usageIndex === scene.usageIndex ? null : { kind: 'workflow', usageIndex: scene.usageIndex },
      );
      return;
    }
    const isSelected = activeSoundParentIndex === scene.usageIndex && isInSoundsStep;
    if (!isSelected) {
      // Activate only — a second click opens the cards.
      selectScene(scene);
      setPanel((p) => (p?.kind === 'composer' ? p : null));
      return;
    }
    setPanel((p) =>
      p?.kind === 'scene' && p.usageIndex === scene.usageIndex ? null : { kind: 'scene', usageIndex: scene.usageIndex },
    );
  }, [activeSoundParentIndex, isInSoundsStep, selectScene]);

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

  const confirm = confirmRemove !== null && (
    <ConfirmDialog
      message="Remove this scene and its sounds?"
      variant="danger"
      confirmLabel="Remove"
      onConfirm={() => removeScene(confirmRemove)}
      onCancel={() => setConfirmRemove(null)}
    />
  );

  return (
    <>
      <BubbleHeading style={{ left: SIMPLE_MODE.EDGE_MARGIN, top: SIMPLE_MODE.TOP_OFFSET }}>Soundscapes</BubbleHeading>
      <div
        className="bubble-column"
        style={{
          left: SIMPLE_MODE.EDGE_MARGIN,
          top: COLUMN_TOP,
          gap: SIMPLE_MODE.BUBBLE_GAP,
          alignItems: 'flex-start',
          zIndex: SIMPLE_MODE.Z_INDEX,
        }}
      >
        {scenes.map((scene) => (
          <SceneBubble
            key={scene.usageIndex}
            scene={scene}
            selected={isInSoundsStep && activeSoundParentIndex === scene.usageIndex}
            onClick={handleSceneClick}
          />
        ))}
        <BubbleAddButton
          label={scenes.length === 0 ? 'Describe a scene to begin' : 'New sound scene'}
          active={panel?.kind === 'composer'}
          onClick={() => {
            setConfirmRemove(null);
            setComposerMounted(true);
            setPanel((p) => (p?.kind === 'composer' ? null : { kind: 'composer' }));
          }}
        />
      </div>

      {composerMounted && (
        // Same element tree in both placements so switching never loses the draft.
        <div
          className={homePlacement ? 'fixed flex flex-col items-center gap-3' : undefined}
          style={
            homePlacement
              ? {
                  left: '50%',
                  transform: 'translateX(-50%)',
                  bottom: SCENE_BOTTOM_BAR.HEIGHT + HOME_STAGE.PROMPT_BOTTOM_GAP,
                  zIndex: SIMPLE_MODE.Z_INDEX,
                }
              : { display: panel?.kind === 'composer' ? undefined : 'none' }
          }
        >
          {homePlacement && <HomeUploadPrompt />}
          <BubblePanel
            ariaLabel="New sound scene"
            title="New sound scene"
            onReduce={closePanel}
            width={SIMPLE_MODE.COMPOSER_WIDTH}
            style={homePlacement ? { position: 'relative' } : { position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
          >
            <ScenePromptComposer willQueue={busy} onSubmit={handleSubmit} onClose={closePanel} />
          </BubblePanel>
        </div>
      )}

      {panel?.kind === 'workflow' && panelScene && (
        <WorkflowPanel
          scene={panelScene}
          onReduce={closePanel}
          onShowSounds={() => {
            selectScene(panelScene);
            setPanel({ kind: 'scene', usageIndex: panelScene.usageIndex });
          }}
          onRemove={() => setConfirmRemove(panelScene.usageIndex)}
          removeDisabledReason={removeDisabledReason}
        >
          {confirm}
        </WorkflowPanel>
      )}

      {panel?.kind === 'scene' && panelScene && (
        <BubblePanel
          ariaLabel={`${panelScene.title} sounds`}
          title={panelScene.title}
          subtitle={`${panelScene.generatedCount}/${panelScene.soundCount} sounds`}
          onReduce={closePanel}
          onRemove={() => setConfirmRemove(panelScene.usageIndex)}
          removeTitle="Remove scene"
          removeDisabledReason={removeDisabledReason}
          style={{ position: 'fixed', left: PANEL_LEFT, top: COLUMN_TOP }}
        >
          {confirm}
          <SoundGenerationSection {...buildSoundGenerationSectionProps(sidebarProps, panelScene.usageIndex)} />
        </BubblePanel>
      )}
    </>
  );
}

'use client';

import { useCanEdit } from '@/hooks/useCanEdit';
import { Fragment, useLayoutEffect, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { DAWRuler, computeTickStep } from './DAWRuler';
import { DAWTrackHead, type DAWHintAnchor, type DAWTrackMenuRequest } from './DAWTrackHead';
import { DAWLane, type DAWLaneClip } from './DAWLane';
import { DAWBarControls } from './DAWBarControls';
import { DAWClipVariationSection } from './DAWClipVariationSection';
import { buildClipMenuItems, buildTrackMenuBody, buildTrackMenuItems, type DawMenuEntity, type TrackMenuActions, type TrackMenuModel } from './daw-menus';
import { NestedMenu, type NestedMenuItem } from '@/components/ui/NestedMenu';
import { Icon } from '@/components/ui/Icon';
import { DAWPlayheadCursor } from './DAWPlayheadCursor';
import { useTransportTimeStore } from '@/store';
import { IntervalSettingsPanel } from './IntervalSettingsPanel';
import { useDawView } from './useDawView';
import { useClipSelection } from './useClipSelection';
import { useClipGesture, ensureTrackMaterialized, readClipTrimCopy, type ClipDescriptor, type TriggerDep } from './useClipGesture';
import { useClipTrimGesture } from './useClipTrimGesture';
import { useDawTrackFocus } from './useDawTrackFocus';
import { computeTimelineOverrun } from './daw-overrun';
import type { ClipTrimCopy } from '@/store/audioControlsStore';
import { parseTriggerExpression } from '@/lib/audio/utils/trigger-ref';
import { trackVariants } from '@/lib/audio/utils/variant-sound-id';
import { clipVariation, formatClipVariation, isVariedCategory } from '@/lib/audio/utils/clip-variation';
import { recurrenceGaps, recurrenceIntervalSeed, withRecurrenceGaps } from '@/lib/audio/utils/recurrence-interval';
import { useMuteSolo } from '@/hooks/useMuteSolo';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useSpeckleStore } from '@/store/speckleStore';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';
import { useSceneWorkflowStore } from '@/store/sceneWorkflowStore';
import { clearPreferredPlaybackTarget, setPreferredPlaybackTarget } from '@/lib/shortcuts/shortcut-targets';
import { DAW, DAW_FPS_ZOOM_HINT, DEFAULT_DBFS, SCENE_BOTTOM_BAR, UI_SIDEBAR_RESIZE, UI_SIDEBAR_TOGGLE } from '@/utils/constants';
import type { TimelineSound, IterationLink } from '@/types/audio';
import type { SoundGenerationConfig } from '@/types';
import type { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';

const GROUP_ORDER = ['background', 'sound_event', 'speech'];

/** The one open right-click menu: a track's (kebab / head / empty lane) or a clip's. */
type DawMenuState =
  | ({ kind: 'track'; soundId: string } & DAWTrackMenuRequest)
  | { kind: 'clip'; soundId: string; iterationIndex: number; x: number; y: number };
const GROUP_LABELS: Record<string, string> = {
  background: 'Background', sound_event: 'Sound Events', speech: 'Speech', sounds: 'Sounds',
};

/* Compact "Interval settings" popover width — 40% narrower than the previous
   300px inline panel it replaced. */
const INTERVAL_PANEL_WIDTH = 180;

/* Top-edge notch — carves the dock's frosted glass exactly like the sidebar
   edge notch: a smooth concave dip centred where the reduce handle floats.
   The cubic control points are the sidebar's (`buildSidebarEdgeNotchClipPath`)
   rotated 90°, so entry/exit tangents run along the top edge and the apex has
   a smooth horizontal tangent — no inverted curvature. No border is drawn;
   like the sidebars, the dip simply lets the scene show through. */
function buildTopNotchClipPath(width: number, height: number): string {
  const h = UI_SIDEBAR_TOGGLE.NOTCH_HEIGHT / 2;
  const d = UI_SIDEBAR_TOGGLE.NOTCH_DEPTH;
  const cx = width / 2;
  const x0 = cx - h;
  const x1 = cx + h;
  return (
    `path('M 0 0 L ${x0} 0 ` +
    `C ${cx - h * 0.55} 0, ${cx - h * 0.55} ${d}, ${cx} ${d} ` +
    `C ${cx + h * 0.55} ${d}, ${cx + h * 0.55} 0, ${x1} 0 ` +
    `L ${width} 0 L ${width} ${height} L 0 ${height} Z')`
  );
}

export interface DAWDockProps {
  sounds: TimelineSound[];
  isPlaying: boolean;
  isAnyPlaying?: boolean;
  onSeek: (timeMs: number) => void;
  onDownload?: (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => Promise<void>;
  onClose: () => void;
  originalIRChannelCount?: number;
  leftOffset: number;
  rightOffset: number;
  /** Distance from the screen bottom (px) — the dock sits on top of the scene bottom bar. */
  bottomOffset?: number;
  playbackSchedulerRef?: React.RefObject<PlaybackSchedulerService | null>;
  /** Reveal a sound card: activate its sound scene, open it in the sidebar, expand the card. */
  onRevealSoundCard?: (configIndex: number) => void;
}

export function DAWDock({
  sounds,
  isPlaying,
  onSeek,
  onDownload,
  onClose,
  originalIRChannelCount,
  leftOffset,
  rightOffset,
  bottomOffset = 0,
  onRevealSoundCard,
}: DAWDockProps) {
  // Share view: playback only — no clip drag / trim / delete / menus / edit keys.
  const canEdit = useCanEdit();
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  // Track mute/solo, scoped to the active sound scene (same as the audio engine).
  const muteSolo = useMuteSolo();
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const iterationLinks = useAudioControlsStore((s) => s.iterationLinks);
  const iterationTrims = useAudioControlsStore((s) => s.iterationTrims);
  const isBakingSchedule = useAudioControlsStore((s) => s.isBakingSchedule);
  const storedSoundTimestamps = useAudioControlsStore((s) => s.soundTimestamps);
  const soundBufferDurations = useAudioControlsStore((s) => s.soundBufferDurations);
  const soundIterationDurations = useAudioControlsStore((s) => s.soundIterationDurations);
  const excludedIterations = useAudioControlsStore((s) => s.excludedIterations);
  const reanchorReasons = useAudioControlsStore((s) => s.reanchorReasons);
  const iterationVariations = useAudioControlsStore((s) => s.iterationVariations);
  const soundVariationModes = useAudioControlsStore((s) => s.soundVariationModes);
  const setIterationVariation = useAudioControlsStore((s) => s.setIterationVariation);
  const handleTimestampsChange = useAudioControlsStore((s) => s.handleTimestampsChange);
  const handleRemoveTimestamp = useAudioControlsStore((s) => s.handleRemoveTimestamp);
  const handleMute = useAudioControlsStore((s) => s.handleMute);
  const handleSolo = useAudioControlsStore((s) => s.handleSolo);
  const handleVolumeChange = useAudioControlsStore((s) => s.handleVolumeChange);
  const setIterationLink = useAudioControlsStore((s) => s.setIterationLink);
  const setIterationLinkForAllIterations = useAudioControlsStore((s) => s.setIterationLinkForAllIterations);
  const clearIterationLink = useAudioControlsStore((s) => s.clearIterationLink);
  const clearAllIterationLinksForSound = useAudioControlsStore((s) => s.clearAllIterationLinksForSound);
  const bakeOrchestrateSchedule = useAudioControlsStore((s) => s.bakeOrchestrateSchedule);
  const setTimelineDurationMs = useAudioControlsStore((s) => s.setTimelineDurationMs);

  const triggerZoomToSoundCard = useUIStore((s) => s.triggerZoomToSoundCard);
  const setHoveredSoundCardIndex = useUIStore((s) => s.setHoveredSoundCardIndex);
  const generatedSounds = useSoundscapeStore((s) => s.generatedSounds);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const objectSoundLinks = useSpeckleStore((s) => s.objectSoundLinks);
  // The 3D camera is locked to a listener while in first-person view — zooming
  // to an entity has no effect, so a hint explains it instead (requestZoomToEntity).
  const isFirstPersonMode = useSpeckleEngineStore((s) => s.isFirstPersonMode);

  const {
    pxPerSecond, setPxPerSecond, snapMode, setSnapMode, dockHeight, setDockHeight, dockAutoFit, setDockAutoFit,
    maxDockHeight, autoFitMaxDockHeight, trackHeight, setTrackHeight,
  } = useDawView({
    durationMs: timelineDurationMs, leftOffset, rightOffset,
  });
  const selection = useClipSelection();

  // Track's default interval (from its generated SoundEvent) — seeds the
  // "Interval settings" distribute panel. Absent → 30s (mirrors the auto-loop default).
  const intervalBySoundId = useMemo(() => {
    const map: Record<string, number> = {};
    generatedSounds.forEach((s: any) => {
      if (s?.id) map[s.id] = s.current_interval_seconds ?? s.interval_seconds ?? 30;
    });
    return map;
  }, [generatedSounds]);

  const dockRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Shared sound focus: highlight + scroll to the focused track; a track click focuses its sound.
  const { focusedIndex, registerRow, focusTrack } = useDawTrackFocus();

  /* ---- Sorted, flat track list (no groups) ---- */
  const sortedSounds = useMemo(() => {
    return [...sounds].sort((a, b) => {
      const ga = a.soundGroup ?? 'sounds';
      const gb = b.soundGroup ?? 'sounds';
      const gia = GROUP_ORDER.indexOf(ga);
      const gib = GROUP_ORDER.indexOf(gb);
      const oa = gia === -1 ? 99 : gia;
      const ob = gib === -1 ? 99 : gib;
      if (oa !== ob) return oa - ob;
      const ca = a.cardIndex ?? a.promptIndex ?? 0;
      const cb = b.cardIndex ?? b.promptIndex ?? 0;
      return ca - cb;
    });
  }, [sounds]);

  /* ---- Scheduled content past the timeline end (see daw-overrun.ts) ---- */
  const timelineOverrun = useMemo(() => computeTimelineOverrun(
    sounds.map((sound) => ({
      startsSec: storedSoundTimestamps[sound.id],
      iterationDurationsMs: soundIterationDurations[sound.id],
      fallbackDurationMs: soundBufferDurations[sound.id] != null
        ? soundBufferDurations[sound.id] * 1000
        : sound.soundDurationMs,
      excludedIndices: excludedIterations[sound.id],
      isBackground: sound.soundGroup === 'background',
    })),
    timelineDurationMs,
  ), [sounds, storedSoundTimestamps, soundIterationDurations, soundBufferDurations, excludedIterations, timelineDurationMs]);

  const handleExtendTimelineToFit = useCallback(() => {
    if (!timelineOverrun) return;
    setTimelineDurationMs(timelineOverrun.proposedDurationMs);
  }, [timelineOverrun, setTimelineDurationMs]);

  /* ---- Trigger dependency graph (BFS propagation + connection lines) ---- */
  const triggerGraph = useMemo(() => {
    const forward = new Map<string, TriggerDep[]>();
    const reverse = new Map<string, TriggerDep[]>();
    if (!soundConfigs.length || !sounds.length) return { forward, reverse };

    const entryIdMap = new Map<string, { soundId: string; configIndex: number }>();
    soundConfigs.forEach((config, ci) => {
      const meta = config.orchestrateMeta;
      if (!meta) return;
      const timelineSound = sounds.find((s) => (s.cardIndex ?? s.promptIndex) === ci);
      if (!timelineSound) return;
      entryIdMap.set(meta.entryId, { soundId: timelineSound.id, configIndex: ci });
    });
    const knownEntryIds = new Set(entryIdMap.keys());

    soundConfigs.forEach((config, ci) => {
      const meta = config.orchestrateMeta;
      if (!meta || !meta.trigger?.expression?.length) return;
      const timelineSound = sounds.find((s) => (s.cardIndex ?? s.promptIndex) === ci);
      if (!timelineSound) return;
      const thisSoundId = timelineSound.id;
      meta.trigger.expression.forEach((expr, i) => {
        if (!expr) return;
        const parsed = parseTriggerExpression(expr, knownEntryIds);
        if (!parsed) return;
        const fromKey = `${thisSoundId}-${i}`;
        for (const ref of parsed.refs) {
          const target = entryIdMap.get(ref.entryId);
          if (!target) continue;
          const refIterIdx = ref.iterIdx;
          if (!forward.has(fromKey)) forward.set(fromKey, []);
          forward.get(fromKey)!.push({ soundId: target.soundId, iterationIndex: refIterIdx });
          const toKey = `${target.soundId}-${refIterIdx}`;
          if (!reverse.has(toKey)) reverse.set(toKey, []);
          reverse.get(toKey)!.push({ soundId: thisSoundId, iterationIndex: i });
        }
      });
    });
    return { forward, reverse };
  }, [soundConfigs, sounds]);

  /* ---- Per-track rows + flat clip registry ---- */
  const { rows, registry } = useMemo(() => {
    const registry = new Map<string, ClipDescriptor>();
    const rows = sortedSounds.map((sound) => {
      const configIdx = sound.cardIndex ?? sound.promptIndex;
      const cardTitle = configIdx !== undefined ? soundConfigs[configIdx]?.display_name : undefined;
      const displayName = cardTitle && cardTitle !== sound.displayName ? cardTitle : sound.displayName;

      const scheduledClips: DAWLaneClip[] = sound.scheduledIterations.map((startMs, i) => {
        const originalIdx = sound.scheduledIterationOriginalIndices?.[i] ?? i;
        const durationMs = sound.iterationDurationsMs?.[i] ?? sound.soundDurationMs;
        const audioUrl = sound.iterationAudioUrls?.[i] ?? sound.audioUrl;
        const clipKey = `${sound.id}-${originalIdx}`;
        registry.set(clipKey, { clipKey, soundId: sound.id, iterationIndex: originalIdx, startMs, durationMs });
        const trim = sound.iterationTrims?.[i];
        const sourceDurationMs = sound.iterationSourceDurationsMs?.[i];
        const variation = clipVariation(
          sound.id, originalIdx, sound.soundGroup, soundVariationModes[sound.id], iterationVariations[clipKey],
        );
        return {
          clipKey, iterationIndex: originalIdx, startMs, durationMs, audioUrl, trim, sourceDurationMs,
          label: displayName, iterationLink: iterationLinks[clipKey], reanchorReason: reanchorReasons[clipKey],
          variationLabel: formatClipVariation(variation),
        };
      });

      // Excluded iterations: display-only ghost clips (never draggable/played).
      const ghostClips: DAWLaneClip[] = (sound.excludedClips ?? []).map((ex) => ({
        clipKey: `${sound.id}-${ex.originalIndex}-excluded`,
        iterationIndex: ex.originalIndex,
        startMs: ex.startMs,
        durationMs: ex.durationMs,
        label: displayName,
        excluded: true,
        reason: ex.reason,
      }));

      const clips: DAWLaneClip[] = [...scheduledClips, ...ghostClips];

      return { sound, displayName, configIdx, clips };
    });
    return { rows, registry };
  }, [sortedSounds, soundConfigs, iterationLinks, reanchorReasons, iterationVariations, soundVariationModes]);

  /* ---- Refs mirrored each render for the gesture hook (avoids stale closures mid-drag) ---- */
  const soundsRef = useRef(sounds); soundsRef.current = sounds;
  const pxPerSecondRef = useRef(pxPerSecond); pxPerSecondRef.current = pxPerSecond;
  const snapModeRef = useRef(snapMode); snapModeRef.current = snapMode;
  const tickStepSec = computeTickStep(pxPerSecond);
  const gridStepSecRef = useRef(tickStepSec); gridStepSecRef.current = tickStepSec;
  // Live playhead for the gesture hooks — mirrored from the transport store
  // (not a prop: playback no longer re-renders the dock every frame).
  const playheadMsRef = useRef(useTransportTimeStore.getState().currentTimeMs);
  useEffect(() => useTransportTimeStore.subscribe((s) => { playheadMsRef.current = s.currentTimeMs; }), []);
  // A closed dock no longer claims Space.
  useEffect(() => () => clearPreferredPlaybackTarget('timeline'), []);
  const timelineDurationMsRef = useRef(timelineDurationMs); timelineDurationMsRef.current = timelineDurationMs;
  const triggerReverseRef = useRef(triggerGraph.reverse); triggerReverseRef.current = triggerGraph.reverse;
  const selectedClipKeysRef = useRef(selection.selectedClipKeys); selectedClipKeysRef.current = selection.selectedClipKeys;
  const registryRef = useRef(registry); registryRef.current = registry;

  // A clip click focuses its sound; when the sound has several linked entities and
  // this occurrence is linked to one of them, that entity is zoomed to and singled
  // out in the 3D view (only it gets the focus tint).
  const focusClip = useCallback((soundId: string, iterationIndex: number, configIdx: number) => {
    const entityCount = soundConfigs[configIdx]?.entities?.length ?? 0;
    const entityNodeId = entityCount > 1 ? iterationLinks[`${soundId}-${iterationIndex}`]?.entityNodeId : undefined;
    focusTrack(configIdx, entityNodeId);
    if (entityNodeId) useSpeckleStore.getState().zoomToObjectById(entityNodeId);
  }, [soundConfigs, iterationLinks, focusTrack]);
  const focusClipRef = useRef(focusClip); focusClipRef.current = focusClip;

  const gesture = useClipGesture({
    soundsRef,
    pxPerSecondRef,
    snapModeRef,
    gridStepSecRef,
    playheadMsRef,
    timelineDurationMsRef,
    triggerReverseRef,
    selectedClipKeysRef,
    clipRegistryRef: registryRef,
    onClickResolved: (clipKey, e) => {
      selection.onClipClicked(clipKey, e);
      // A plain click (no modifier) also focuses the track's sound, matching
      // the track-head name click.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      const d = registryRef.current.get(clipKey);
      const sound = d && soundsRef.current.find((s) => s.id === d.soundId);
      const configIdx = sound?.cardIndex ?? sound?.promptIndex;
      if (sound && d && configIdx !== undefined) focusClipRef.current(sound.id, d.iterationIndex, configIdx);
    },
  });

  const trimGesture = useClipTrimGesture({
    soundsRef,
    pxPerSecondRef,
    snapModeRef,
    gridStepSecRef,
    playheadMsRef,
    clipRegistryRef: registryRef,
  });

  /* ---- Hover -> 3D viewer highlight (linked entity + sound sphere) ---- */
  const [hoveredIteration, setHoveredIteration] = useState<{ soundId: string; iterationIndex: number } | null>(null);
  const handleIterationHover = useCallback((soundId: string, iterationIndex: number, configIdx?: number) => {
    setHoveredIteration({ soundId, iterationIndex });
    const link = iterationLinks[`${soundId}-${iterationIndex}`];
    if (link?.entityNodeId) useSpeckleStore.getState().highlightObjectForHover(link.entityNodeId);
    if (configIdx !== undefined) setHoveredSoundCardIndex(configIdx);
  }, [iterationLinks, setHoveredSoundCardIndex]);
  const handleIterationHoverEnd = useCallback(() => {
    setHoveredIteration(null);
    useSpeckleStore.getState().clearHoverHighlight();
    setHoveredSoundCardIndex(null);
  }, [setHoveredSoundCardIndex]);

  const scheduleBakeOrchestrate = useCallback(() => bakeOrchestrateSchedule(), [bakeOrchestrateSchedule]);

  const handleZoomToLinkedEntity = useCallback((configIdx: number) => {
    const entities = soundConfigs[configIdx]?.entities;
    if (!entities || entities.length === 0) return;
    const nodeIds = entities.map((e) => e.nodeId || e.id).filter((id): id is string => !!id);
    if (nodeIds.length === 0) return;
    useSpeckleStore.getState().zoomToObjectById(nodeIds);
  }, [soundConfigs]);

  // Opens the sound card and zooms the 3D view to its linked entity — the
  // track head's name double-click, its "Zoom to entity" menu item and a
  // clip's double-click all trigger exactly this.
  const handleZoomToEntity = useCallback((configIdx: number) => {
    triggerZoomToSoundCard(configIdx);
    handleZoomToLinkedEntity(configIdx);
  }, [triggerZoomToSoundCard, handleZoomToLinkedEntity]);

  // "Can't zoom" hint — shown instead of zooming while the camera is locked to a
  // listener's first-person view (zoomToObjectById would have no effect).
  const [fpsHintAnchor, setFpsHintAnchor] = useState<DAWHintAnchor | null>(null);
  useEffect(() => {
    if (!fpsHintAnchor) return;
    const close = () => setFpsHintAnchor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [fpsHintAnchor]);
  // Leaving first-person view makes the hint moot.
  useEffect(() => {
    if (!isFirstPersonMode) setFpsHintAnchor(null);
  }, [isFirstPersonMode]);

  /** Track-name double-click and the menus' "Zoom to entity". */
  const requestZoomToEntity = useCallback((configIdx: number, hintAnchor: DAWHintAnchor) => {
    if (isFirstPersonMode) { setFpsHintAnchor(hintAnchor); return; }
    handleZoomToEntity(configIdx);
  }, [isFirstPersonMode, handleZoomToEntity]);

  /* ---- Track-head kebab actions ---- */
  // Which track has its transient "Interval settings" popover open, anchored at
  // the kebab's top-right (panel bottom-left touches it). Snapshot the schedule
  // so Cancel can restore it.
  const [distributeFor, setDistributeFor] = useState<{
    soundId: string;
    seedIntervalSeconds: number;
    initialSchedule: number[] | undefined;
    durationSecPerIteration: number[];
    fallbackDurationSec: number;
    anchor: { x: number; y: number };
    /** Recurring activity: the panel edits its trigger-chain gaps (snapshot for Cancel). */
    recurring?: {
      cardIndex: number;
      seedJitterSeconds: number;
      initial: Pick<SoundGenerationConfig, 'orchestrateMeta' | 'scenarioSource'>;
    };
  } | null>(null);

  const recurringPanel = distributeFor?.recurring;

  /** Write a recurring card's chain fields, re-sync the audio store and re-bake. */
  const writeRecurringFields = useCallback((
    cardIndex: number,
    fields: Pick<SoundGenerationConfig, 'orchestrateMeta' | 'scenarioSource'>,
  ) => {
    const soundStore = useSoundscapeStore.getState();
    soundStore.handleUpdateConfig(cardIndex, 'orchestrateMeta', fields.orchestrateMeta);
    soundStore.handleUpdateConfig(cardIndex, 'scenarioSource', fields.scenarioSource);
    useAudioControlsStore.getState().syncSoundConfigs(useSoundscapeStore.getState().soundConfigs);
    scheduleBakeOrchestrate();
  }, [scheduleBakeOrchestrate]);

  const applyRecurringInterval = useCallback((soundId: string, cardIndex: number, intervalSec: number, jitterSec: number) => {
    const config = useSoundscapeStore.getState().soundConfigs[cardIndex];
    if (!config?.orchestrateMeta) return;
    const gaps = recurrenceGaps(soundId, config.orchestrateMeta.trigger.expression.length, intervalSec, jitterSec);
    const fields = withRecurrenceGaps(config, gaps);
    if (fields) writeRecurringFields(cardIndex, fields);
  }, [writeRecurringFields]);

  const distributePanelRef = useRef<HTMLDivElement>(null);

  const openDistributeFor = useCallback((sound: TimelineSound, anchor: { x: number; y: number }) => {
    const store = useAudioControlsStore.getState();
    // Recurring activity: edit its chain gaps, opening on the LLM's own rhythm.
    const cardIndex = sound.cardIndex ?? sound.promptIndex;
    const recurringConfig = cardIndex !== undefined ? soundConfigs[cardIndex] : undefined;
    const recurrence = recurringConfig?.orchestrateMeta ? recurringConfig.scenarioSource?.recurrence : undefined;
    if (cardIndex !== undefined && recurringConfig && recurrence) {
      const seed = recurrenceIntervalSeed(recurrence);
      setDistributeFor({
        soundId: sound.id,
        seedIntervalSeconds: seed.intervalSec,
        initialSchedule: store.soundTimestamps[sound.id],
        durationSecPerIteration: (sound.iterationDurationsMs ?? []).map((ms) => ms / 1000),
        fallbackDurationSec: sound.soundDurationMs / 1000,
        anchor,
        recurring: {
          cardIndex,
          seedJitterSeconds: seed.jitterSec,
          initial: { orchestrateMeta: recurringConfig.orchestrateMeta, scenarioSource: recurringConfig.scenarioSource },
        },
      });
      return;
    }
    const initialSchedule = store.soundTimestamps[sound.id];
    // If the track is still "auto" (no stored schedule), freeze its currently
    // displayed positions so the panel edits a concrete schedule from the start.
    if (initialSchedule === undefined && sound.scheduledIterations?.length) {
      store.handleTimestampsChange(
        sound.id,
        sound.scheduledIterations.map((ms) => parseFloat((ms / 1000).toFixed(3))),
      );
    }
    setDistributeFor({
      soundId: sound.id,
      seedIntervalSeconds: intervalBySoundId[sound.id] ?? 30,
      initialSchedule,
      durationSecPerIteration: (sound.iterationDurationsMs ?? []).map((ms) => ms / 1000),
      fallbackDurationSec: sound.soundDurationMs / 1000,
      anchor,
    });
  }, [intervalBySoundId, soundConfigs]);

  const closeDistribute = useCallback(() => setDistributeFor(null), []);

  // Clicking anywhere outside the popover behaves like its Cancel button:
  // restore the schedule the track had before the panel was opened.
  useEffect(() => {
    if (!distributeFor) return;
    const onPointerDown = (e: PointerEvent) => {
      if (distributePanelRef.current?.contains(e.target as Node)) return;
      if (distributeFor.recurring) {
        writeRecurringFields(distributeFor.recurring.cardIndex, distributeFor.recurring.initial);
        setDistributeFor(null);
        return;
      }
      const store = useAudioControlsStore.getState();
      if (distributeFor.initialSchedule !== undefined) {
        store.handleTimestampsChange(distributeFor.soundId, distributeFor.initialSchedule);
      } else {
        store.clearSoundTimestampsEntry(distributeFor.soundId);
      }
      setDistributeFor(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [distributeFor, writeRecurringFields]);

  const handleClearClips = useCallback((sound: TimelineSound) => {
    handleTimestampsChange(sound.id, []);
    clearAllIterationLinksForSound(sound.id);
  }, [handleTimestampsChange, clearAllIterationLinksForSound]);

  /**
   * Reset a track. For an orchestrator-derived track, restores the timestamps +
   * iteration links saved from the orchestrator result (so a dragged iteration
   * returns to its original slot, NOT time 0). For a plain track, drops the stored
   * schedule so the timeline derives the auto default loop again.
   */
  const handleResetTrack = useCallback((sound: TimelineSound) => {
    useAudioControlsStore.getState().resetTrack(sound.id);
  }, []);

  /* ---- Right-click menus (track + clip) — structure in daw-menus.ts ---- */
  const [menu, setMenu] = useState<DawMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  /* ---- Marquee (box) selection across tracks ---- */
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const handleTracksPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-clip-key]')) return;
    const containerEl = scrollContainerRef.current;
    if (!containerEl) return;
    const containerRect = containerEl.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const baseSelection = additive ? new Set(selection.selectedClipKeys) : new Set<string>();
    if (!additive) selection.clear();

    const handleMove = (ev: PointerEvent) => {
      const x = Math.min(startX, ev.clientX);
      const y = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      setMarqueeRect({ x: x - containerRect.left + containerEl.scrollLeft, y: y - containerRect.top + containerEl.scrollTop, w, h });

      const found = new Set(baseSelection);
      containerEl.querySelectorAll<HTMLElement>('[data-clip-key]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < x + w && r.right > x && r.top < y + h && r.bottom > y) {
          found.add(el.dataset.clipKey!);
        }
      });
      selection.setMarquee([...found]);
    };
    const handleUp = () => {
      setMarqueeRect(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [selection]);

  /* ---- Loop region ---- */
  // Lives in uiStore so it survives collapsing the dock; playback looping is enforced by
  // SceneTimeline (always mounted), so it keeps looping while the dock is collapsed.
  const loopRegion = useUIStore((s) => s.timelineLoop);
  const setLoopRegion = useUIStore((s) => s.setTimelineLoop);

  /* ---- Duration edit (ruler pencil) ---- */
  const [isEditingDuration, setIsEditingDuration] = useState(false);

  /* ---- Bottom-bar slot (right of "Timeline") that receives the snap / zoom /
       export controls while the dock is expanded. Looked up after mount: the
       bar renders after the dock in SpeckleScene. ---- */
  const [barControlsSlot, setBarControlsSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setBarControlsSlot(document.getElementById(SCENE_BOTTOM_BAR.DAW_CONTROLS_SLOT_ID));
  }, []);

  /* ---- Top-edge resize hover state (sidebar-style blue grip) ---- */
  const [isResizeHovered, setIsResizeHovered] = useState(false);
  const [isResizeActive, setIsResizeActive] = useState(false);

  /* ---- Measured dock width — carves the frosted glass top-edge notch so it
       is always centred exactly on the reduce handle ---- */
  const [dockWidth, setDockWidth] = useState(0);
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const update = () => setDockWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- Keyboard shortcuts (dock-scoped, not window) ---- */
  const snapStepSec = snapMode === 'off' ? 0.1 : tickStepSec;

  const commitDelta = useCallback((keys: string[], deltaMs: number) => {
    if (keys.length === 0 || deltaMs === 0) return;
    const descriptors = keys.map((k) => registryRef.current.get(k)).filter((d): d is ClipDescriptor => !!d);
    const soundIds = new Set(descriptors.map((d) => d.soundId));
    soundIds.forEach((id) => ensureTrackMaterialized(soundsRef, id));
    const fresh = useAudioControlsStore.getState().soundTimestamps;
    const batch: Record<string, number[]> = {};
    descriptors.forEach((d) => {
      const base = batch[d.soundId] ?? fresh[d.soundId] ?? [];
      const arr = [...base];
      arr[d.iterationIndex] = parseFloat((Math.max(0, (d.startMs + deltaMs)) / 1000).toFixed(3));
      batch[d.soundId] = arr;
    });
    useAudioControlsStore.getState().handleTimestampsChangeBatch(batch);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const byTrack = new Map<string, number[]>();
    selection.selectedClipKeys.forEach((key) => {
      const d = registryRef.current.get(key);
      if (!d) return;
      if (!byTrack.has(d.soundId)) byTrack.set(d.soundId, []);
      byTrack.get(d.soundId)!.push(d.iterationIndex);
    });
    byTrack.forEach((indices, soundId) => {
      ensureTrackMaterialized(soundsRef, soundId);
      indices.sort((a, b) => b - a).forEach((idx) => handleRemoveTimestamp(soundId, idx));
    });
    selection.clear();
  }, [selection, handleRemoveTimestamp]);

  const handleDuplicateSelected = useCallback(() => {
    // Snapshot trims before inserting — each insert shifts later indices on the track.
    const sources = [...selection.selectedClipKeys]
      .map((key) => registryRef.current.get(key))
      .filter((d): d is ClipDescriptor => !!d)
      .map((d) => ({ d, trimCopy: readClipTrimCopy(d.soundId, d.iterationIndex) }));
    sources.forEach(({ d, trimCopy }) => {
      ensureTrackMaterialized(soundsRef, d.soundId);
      const store = useAudioControlsStore.getState();
      const current = store.soundTimestamps[d.soundId] ?? [];
      const newStartSec = parseFloat((d.startMs / 1000).toFixed(3));
      let insertAt = current.length;
      for (let i = 0; i < current.length; i++) {
        if (newStartSec < current[i]) { insertAt = i; break; }
      }
      const newTs = [...current];
      newTs.splice(insertAt, 0, newStartSec);
      store.remapIterationLinksForInsert(d.soundId, insertAt, trimCopy);
      store.handleTimestampsChange(d.soundId, newTs);
    });
  }, [selection]);

  const clipboardRef = useRef<Array<{ soundId: string; offsetMs: number; durationMs: number; trimCopy?: ClipTrimCopy }>>([]);
  const handleCopySelected = useCallback(() => {
    const descriptors = [...selection.selectedClipKeys].map((k) => registryRef.current.get(k)).filter((d): d is ClipDescriptor => !!d);
    if (descriptors.length === 0) return;
    const minStart = Math.min(...descriptors.map((d) => d.startMs));
    clipboardRef.current = descriptors.map((d) => ({
      soundId: d.soundId,
      offsetMs: d.startMs - minStart,
      durationMs: d.durationMs,
      trimCopy: readClipTrimCopy(d.soundId, d.iterationIndex),
    }));
  }, [selection]);
  const handlePasteAtPlayhead = useCallback(() => {
    clipboardRef.current.forEach(({ soundId, offsetMs, trimCopy }) => {
      ensureTrackMaterialized(soundsRef, soundId);
      const store = useAudioControlsStore.getState();
      const current = store.soundTimestamps[soundId] ?? [];
      const playheadMs = useTransportTimeStore.getState().currentTimeMs;
      const newStartSec = parseFloat(((playheadMs + offsetMs) / 1000).toFixed(3));
      let insertAt = current.length;
      for (let i = 0; i < current.length; i++) {
        if (newStartSec < current[i]) { insertAt = i; break; }
      }
      const newTs = [...current];
      newTs.splice(insertAt, 0, newStartSec);
      store.remapIterationLinksForInsert(soundId, insertAt, trimCopy);
      store.handleTimestampsChange(soundId, newTs);
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Never hijack keys meant for a focused text field (duration editor, etc.).
    const targetTag = (e.target as HTMLElement).tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

    const mod = e.ctrlKey || e.metaKey;
    // preventDefault: Esc in the dock is consumed here (global Esc cascade stands down).
    if (e.key === 'Escape') { e.preventDefault(); selection.clear(); return; }
    // Share view: every other dock key edits clips.
    if (!canEdit) return;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selection.selectAll([...registryRef.current.keys()]); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); handleDuplicateSelected(); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); handleCopySelected(); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); handlePasteAtPlayhead(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); handleDeleteSelected(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * snapStepSec * 1000;
      commitDelta([...selection.selectedClipKeys], e.key === 'ArrowLeft' ? -step : step);
      return;
    }
  }, [canEdit, selection, snapStepSec, commitDelta, handleDeleteSelected, handleDuplicateSelected, handleCopySelected, handlePasteAtPlayhead]);

  /* ---- Top-edge dock resize (hover-blue grip, mirrors sidebar resize handle).
       Starting a drag also switches the dock out of auto-fit mode: the height
       then stays exactly where the user left it (persisted). ---- */
  const handleResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDockAutoFit(false);
    setIsResizeActive(true);
    const startY = e.clientY;
    const startHeight = dockHeight;
    const move = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      setDockHeight(Math.max(DAW.MIN_DOCK_HEIGHT, Math.min(maxDockHeight, startHeight + delta)));
    };
    const up = () => {
      setIsResizeActive(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [dockHeight, maxDockHeight, setDockHeight, setDockAutoFit]);

  /* ---- Auto-fit: while the user hasn't manually resized the dock, its height
       hugs the content — ruler + one row per track — up to 1/3 of the window;
       overflowing tracks scroll. Only a manual drag takes it further (to 1/2). ---- */
  useEffect(() => {
    if (!dockAutoFit) return;
    const needed = DAW.RULER_HEIGHT + rows.length * trackHeight;
    const target = Math.round(Math.max(DAW.MIN_DOCK_HEIGHT, Math.min(autoFitMaxDockHeight, needed)));
    if (dockHeight !== target) setDockHeight(target);
  }, [dockAutoFit, dockHeight, autoFitMaxDockHeight, rows.length, trackHeight, setDockHeight]);

  // A persisted manual height may exceed the cap after the window shrinks.
  const renderedDockHeight = Math.min(dockHeight, maxDockHeight);

  /* ---- Wheel zoom while over the dock: Ctrl/Meta+wheel = vertical track-height
       zoom, Alt+wheel = horizontal timeline zoom (px/sec). ---- */
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const dock = dockRef.current;
      if (!dock || !dock.contains(e.target as Node)) return;
      const factor = e.deltaY < 0 ? DAW.WHEEL_ZOOM_IN : DAW.WHEEL_ZOOM_OUT;
      if (e.altKey) {
        e.preventDefault();
        setPxPerSecond((prev) => prev * factor);
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setTrackHeight((prev) => prev * factor);
    };
    document.addEventListener('wheel', handleWheel, { passive: false });
    return () => document.removeEventListener('wheel', handleWheel);
  }, [setTrackHeight, setPxPerSecond]);

  const totalDurationSec = timelineDurationMs / 1000;
  const contentWidth = totalDurationSec * pxPerSecond;
  const tickStepPx = tickStepSec * pxPerSecond;


  /* ---- Connection-line overlay data ---- */
  const iterationPixelPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; w: number }>();
    rows.forEach((row, rowIdx) => {
      const centerY = rowIdx * trackHeight + trackHeight / 2;
      row.clips.forEach((clip) => {
        const x = DAW.HEAD_WIDTH + (clip.startMs / 1000) * pxPerSecond;
        const w = Math.max((clip.durationMs / 1000) * pxPerSecond, 4);
        positions.set(clip.clipKey, { x: x + w / 2, y: centerY, w });
      });
    });
    return positions;
  }, [rows, pxPerSecond, trackHeight]);

  const connectedPairs = useMemo(() => {
    if (!hoveredIteration) return [];
    const key = `${hoveredIteration.soundId}-${hoveredIteration.iterationIndex}`;
    const pairs: Array<{ source: TriggerDep; dependent: TriggerDep }> = [];
    triggerGraph.forward.get(key)?.forEach((d) => pairs.push({ source: d, dependent: hoveredIteration }));
    triggerGraph.reverse.get(key)?.forEach((d) => pairs.push({ source: hoveredIteration, dependent: d }));
    return pairs;
  }, [hoveredIteration, triggerGraph]);

  /* ---- Right-click menu items (built only while a menu is open) ---- */
  const buildMenuItems = (state: DawMenuState): NestedMenuItem[] | null => {
    const row = rows.find((r) => r.sound.id === state.soundId);
    if (!row) return null;
    const { sound, displayName, configIdx, clips } = row;
    const cardIndex = sound.cardIndex ?? sound.promptIndex;
    const liveClips = clips.filter((c) => !c.excluded);

    // Exactly the list playback resolves `variantIndex` against.
    const variants = trackVariants(sound.promptIndex, generatedSounds)
      .map((v, vi) => ({ id: v.id, label: String.fromCharCode(65 + vi) }));

    const configEntities = cardIndex !== undefined ? soundConfigs[cardIndex]?.entities ?? [] : [];
    const entityIdxMap = new Map<string, number>();
    configEntities.forEach((e: any, ei: number) => { const eid = e.nodeId || e.id; if (eid) entityIdxMap.set(eid, ei); });
    const linkedEntities: DawMenuEntity[] = cardIndex !== undefined
      ? [...objectSoundLinks.entries()].filter(([, pi]) => pi === cardIndex).map(([objectId]) => ({
          id: objectId,
          displayNumber: (entityIdxMap.get(objectId) ?? 0) + 1,
        }))
      : [];
    const entityLink = (entityId: string): Partial<IterationLink> => {
      const entity = configEntities.find((e: any) => (e.nodeId || e.id) === entityId);
      const entityPosition = entity?.bounds?.center
        ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]] as [number, number, number]
        : entity?.position && entity.position.length >= 3
          ? [entity.position[0], entity.position[1], entity.position[2]] as [number, number, number]
          : undefined;
      const displayNumber = linkedEntities.find((e) => e.id === entityId)?.displayNumber;
      return { entityNodeId: entityId, entityPosition, entityIndex: displayNumber !== undefined ? displayNumber - 1 : undefined };
    };

    // Original indices of every clip rendered on this track — the target set of
    // the "all clips" actions.
    const iterationIndices = sound.scheduledIterationOriginalIndices ?? sound.scheduledIterations.map((_, i) => i);
    const applyToAll = (partial: Partial<IterationLink>) => {
      if (iterationIndices.length === 0) return;
      setIterationLinkForAllIterations(sound.id, iterationIndices, partial);
      scheduleBakeOrchestrate();
    };

    const links = iterationIndices.map((i) => iterationLinks[`${sound.id}-${i}`] ?? {});
    const variantIdxs = links.map((l) => l.variantIndex ?? 0);
    const entityIds = links.map((l) => l.entityNodeId);
    const trackModel: TrackMenuModel = {
      title: displayName,
      isRecurring: !!(cardIndex !== undefined && soundConfigs[cardIndex]?.orchestrateMeta
        && soundConfigs[cardIndex]?.scenarioSource?.recurrence),
      clipCount: liveClips.length,
      variants,
      uniformVariantIndex: variantIdxs.every((v) => v === variantIdxs[0]) ? (variantIdxs[0] ?? 0) : null,
      linkedEntities,
      uniformEntityId: entityIds.every((e) => e === entityIds[0]) ? entityIds[0] : null,
      hasEntityLinks: entityIds.some(Boolean),
    };
    // The clip menu has no kebab: its panel / hint point at the click.
    const panelAnchor = state.kind === 'track' ? state.panelAnchor : { x: state.x, y: state.y };
    const hintAnchor = state.kind === 'track' ? state.hintAnchor : { left: state.x, centerY: state.y };
    const trackActions: TrackMenuActions = {
      onDistribute: () => openDistributeFor(sound, panelAnchor),
      onSelectAllClips: () => selection.replace(liveClips.map((c) => c.clipKey)),
      onPickVariantForAll: (variantIndex) => applyToAll({ variantIndex }),
      onPickEntityForAll: (entityId) => applyToAll(entityLink(entityId)),
      onOpenSoundCard: configIdx !== undefined && onRevealSoundCard ? () => onRevealSoundCard(configIdx) : undefined,
      onZoomToEntity: configIdx !== undefined ? () => requestZoomToEntity(configIdx, hintAnchor) : undefined,
      onClearEntityLinks: () => clearAllIterationLinksForSound(sound.id),
      onClearClips: () => handleClearClips(sound),
      onResetTrack: () => handleResetTrack(sound),
    };
    if (state.kind === 'track') return buildTrackMenuItems(trackModel, trackActions);

    const { iterationIndex } = state;
    const linkKey = `${sound.id}-${iterationIndex}`;
    const currentLink = iterationLinks[linkKey] ?? {};
    const ordered = [...liveClips].sort((a, b) => a.startMs - b.startMs);
    const orchestrateMeta = cardIndex !== undefined ? soundConfigs[cardIndex]?.orchestrateMeta : undefined;
    const triggerExpression = orchestrateMeta
      ? `${orchestrateMeta.trigger?.expression?.[iterationIndex] ?? '-'}${orchestrateMeta.trigger?.delay?.[iterationIndex] ? ` +${orchestrateMeta.trigger.delay[iterationIndex]}s` : ''}`
      : null;
    // Per-occurrence pitch / level (sound events only — speech and beds never vary).
    const variationOverride = iterationVariations[linkKey];
    const variation = isVariedCategory(sound.soundGroup)
      ? clipVariation(sound.id, iterationIndex, sound.soundGroup, soundVariationModes[sound.id], variationOverride)
      : null;
    const inMultiSelection = selection.selectedClipKeys.has(linkKey) && selection.selectedClipKeys.size > 1;

    return buildClipMenuItems({
      clipNumber: ordered.findIndex((c) => c.iterationIndex === iterationIndex) + 1,
      clipCount: ordered.length,
      triggerExpression,
      variants,
      currentVariantIndex: currentLink.variantIndex ?? 0,
      linkedEntities,
      currentEntityId: currentLink.entityNodeId,
      hasTrim: !!iterationTrims[linkKey],
      deleteCount: inMultiSelection ? selection.selectedClipKeys.size : 1,
      variationContent: variation && (
        // Remount on a new value (re-roll / reset) so the sliders show it.
        <DAWClipVariationSection
          key={`${variation.detuneCents}:${variation.gainDb}`}
          variation={variation}
          isOverridden={!!variationOverride}
          onSet={(detuneCents, gainDb) => setIterationVariation(sound.id, iterationIndex, { detuneCents, gainDb })}
          onReroll={() => setIterationVariation(sound.id, iterationIndex, { seed: (variationOverride?.seed ?? 0) + 1 })}
          onReset={() => setIterationVariation(sound.id, iterationIndex, null)}
        />
      ),
      trackTitle: displayName,
    }, {
      onPickVariant: (variantIndex) => {
        setIterationLink(sound.id, iterationIndex, { variantIndex });
        scheduleBakeOrchestrate();
      },
      onPickEntity: (entityId) => {
        // Picking the linked entity again unlinks it.
        if (currentLink.entityNodeId === entityId) clearIterationLink(sound.id, iterationIndex);
        else setIterationLink(sound.id, iterationIndex, entityLink(entityId));
      },
      onApplyVariantToAll: () => applyToAll({ variantIndex: currentLink.variantIndex ?? 0 }),
      onApplyEntityToAll: () => applyToAll({
        entityNodeId: currentLink.entityNodeId,
        entityPosition: currentLink.entityPosition,
        entityIndex: currentLink.entityIndex,
      }),
      onResetTrim: () => trimGesture.resetTrim(sound.id, iterationIndex),
      onDelete: () => {
        if (inMultiSelection) { handleDeleteSelected(); return; }
        ensureTrackMaterialized(soundsRef, sound.id);
        handleRemoveTimestamp(sound.id, iterationIndex);
      },
    }, buildTrackMenuBody(trackModel, trackActions));
  };
  const menuItems = menu ? buildMenuItems(menu) : null;

  return (
    <div
      ref={dockRef}
      tabIndex={0}
      onPointerDown={(e) => { if (dockRef.current) dockRef.current.focus(); void e; }}
      // Capture: track heads stop pointerdown propagation. Brings the DAW back
      // in front of an overlapping Simple-mode scene panel.
      // Also makes Space drive the timeline instead of an expanded sound card.
      onPointerDownCapture={() => {
        useSceneWorkflowStore.getState().setSimpleFrontLayer('daw');
        setPreferredPlaybackTarget('timeline');
      }}
      onKeyDown={handleKeyDown}
      className="transition-all duration-300 ease-in-out"
      style={{
        position: 'fixed', bottom: `${bottomOffset}px`, left: `${leftOffset}px`, right: `${rightOffset}px`, height: `${renderedDockHeight}px`,
        display: 'flex', flexDirection: 'column',
        zIndex: 200, overflow: 'visible', userSelect: 'none', outline: 'none',
      }}
    >
      {/* Frosted glass background — same treatment as the left/right sidebars,
          with the top edge carved into the same concave notch as the sidebars
          (reveals the scene behind, no border line). */}
      <div
        className="sidebar-glass backdrop-blur-lg backdrop-saturate-150"
        style={dockWidth > 0 ? { clipPath: buildTopNotchClipPath(dockWidth, renderedDockHeight) } : undefined}
        aria-hidden="true"
      />

      <div className="relative z-[1] flex flex-col flex-1 min-h-0">
        {/* Ruler and tracks only — snap / zoom / export live in the scene bottom
            bar (portal below). The floating reduce knob and the sidebar-style
            resize grip are overlays, so they reserve no space. */}
        {barControlsSlot && createPortal(
          <DAWBarControls
            pxPerSecond={pxPerSecond}
            onZoomChange={setPxPerSecond}
            snapMode={snapMode}
            onSnapModeChange={setSnapMode}
            onDownload={onDownload}
            originalIRChannelCount={originalIRChannelCount}
          />,
          barControlsSlot,
        )}
        <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <div
            onPointerDown={canEdit ? handleTracksPointerDown : undefined}
            style={{ minWidth: DAW.HEAD_WIDTH + contentWidth, position: 'relative' }}
          >
            <DAWRuler
              totalDurationSec={totalDurationSec}
              pxPerSecond={pxPerSecond}
              onSeek={onSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
              isEditingDuration={isEditingDuration}
              onStartEditDuration={() => setIsEditingDuration(true)}
              onStopEditDuration={() => setIsEditingDuration(false)}
              onDurationChange={setTimelineDurationMs}
              overrun={timelineOverrun}
              onExtendTimeline={handleExtendTimelineToFit}
              isBakingSchedule={isBakingSchedule}
            />

            {rows.map(({ sound, displayName, configIdx, clips }) => (
              <Fragment key={sound.id}>
              <div ref={registerRow(configIdx)} style={{ display: 'flex' }}>
                <DAWTrackHead
                  sound={sound}
                  displayName={displayName}
                  groupLabel={GROUP_LABELS[sound.soundGroup ?? 'sounds'] ?? 'Sounds'}
                  clipCount={clips.filter((c) => !c.excluded).length}
                  excludedCount={sound.excludedIterations?.length ?? 0}
                  trackHeight={trackHeight}
                  isMuted={muteSolo.isMuted(sound.id)}
                  isSoloed={muteSolo.isSoloed(sound.id)}
                  volumeDbfs={soundVolumes[sound.id] ?? soundConfigs[configIdx ?? -1]?.dbfs ?? DEFAULT_DBFS}
                  onMute={() => handleMute(sound.id)}
                  onSolo={() => handleSolo(sound.id)}
                  onVolumeChange={(db) => handleVolumeChange(sound.id, db)}
                  onSelectSoundCard={configIdx !== undefined ? () => focusTrack(configIdx) : undefined}
                  isFocused={configIdx !== undefined && configIdx === focusedIndex}
                  onOpenMenu={canEdit ? (request) => setMenu({ kind: 'track', soundId: sound.id, ...request }) : undefined}
                  onZoomToEntity={configIdx !== undefined ? (anchor) => requestZoomToEntity(configIdx, anchor) : undefined}
                  onHoverTrack={() => configIdx !== undefined && setHoveredSoundCardIndex(configIdx)}
                  onHoverTrackEnd={() => setHoveredSoundCardIndex(null)}
                />
                <DAWLane
                  soundId={sound.id}
                  color={sound.color}
                  clips={clips}
                  pxPerSecond={pxPerSecond}
                  trackHeight={trackHeight}
                  timelineDurationMs={timelineDurationMs}
                  isSilenced={muteSolo.isSilenced(sound.id)}
                  isDraggable={canEdit}
                  selectedClipKeys={selection.selectedClipKeys}
                  dragPreview={gesture.dragPreview}
                  isDragging={gesture.isDragging}
                  isDuplicating={gesture.isDuplicating}
                  tickStepPx={tickStepPx}
                  onClipPointerDown={(e, clip) => {
                    // Share view: no drag/selection — a clip press only focuses its sound.
                    if (!canEdit) { if (configIdx !== undefined) focusClip(sound.id, clip.iterationIndex, configIdx); return; }
                    selection.onClipPressed(clip.clipKey, e, clips.map((c) => c.clipKey));
                    gesture.beginDrag(e, { clipKey: clip.clipKey, soundId: sound.id, iterationIndex: clip.iterationIndex, startMs: clip.startMs, durationMs: clip.durationMs });
                  }}
                  trimPreview={trimGesture.trimPreview}
                  onClipTrimPointerDown={(e, clip, edge) => {
                    if (!canEdit || !clip.sourceDurationMs) return;
                    trimGesture.beginTrim(e, {
                      clipKey: clip.clipKey,
                      soundId: sound.id,
                      iterationIndex: clip.iterationIndex,
                      startMs: clip.startMs,
                      durationMs: clip.durationMs,
                      trim: clip.trim ?? { start: 0, end: 1 },
                      sourceDurationMs: clip.sourceDurationMs,
                    }, edge);
                  }}
                  onDeleteClip={(iterationIndex) => { if (!canEdit) return; ensureTrackMaterialized(soundsRef, sound.id); handleRemoveTimestamp(sound.id, iterationIndex); }}
                  onClipContextMenu={(iterationIndex, x, y) => { if (canEdit) setMenu({ kind: 'clip', soundId: sound.id, iterationIndex, x, y }); }}
                  onLaneContextMenu={canEdit ? (x, y) => setMenu({
                    kind: 'track', soundId: sound.id, x, y, panelAnchor: { x, y }, hintAnchor: { left: x, centerY: y },
                  }) : undefined}
                  onClipDoubleClick={configIdx !== undefined ? () => handleZoomToEntity(configIdx) : undefined}
                  onClipHover={(iterationIndex) => handleIterationHover(sound.id, iterationIndex, configIdx)}
                  onClipHoverEnd={handleIterationHoverEnd}
                />
              </div>
              </Fragment>
            ))}

            {/* Connection lines between trigger-linked clips */}
            {hoveredIteration && connectedPairs.length > 0 && (() => {
              const segments: Array<{ points: string }> = [];
              connectedPairs.forEach(({ source, dependent }) => {
                const srcKey = `${source.soundId}-${source.iterationIndex}`;
                const depKey = `${dependent.soundId}-${dependent.iterationIndex}`;
                const srcPos = iterationPixelPositions.get(srcKey);
                const depPos = iterationPixelPositions.get(depKey);
                if (!srcPos || !depPos) return;
                const srcY = srcPos.y + DAW.RULER_HEIGHT;
                const depY = depPos.y + DAW.RULER_HEIGHT;
                if (source.soundId === dependent.soundId) {
                  const [leftPos, rightPos] = srcPos.x <= depPos.x ? [srcPos, depPos] : [depPos, srcPos];
                  segments.push({ points: `${leftPos.x + leftPos.w / 2},${srcY} ${rightPos.x - rightPos.w / 2},${srcY}` });
                } else {
                  segments.push({ points: `${srcPos.x},${srcY} ${srcPos.x},${depY} ${depPos.x},${depY}` });
                }
              });
              if (segments.length === 0) return null;
              return (
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 15, overflow: 'visible' }}>
                  <defs>
                    <marker id="arrow-orange-daw" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#f97316" />
                    </marker>
                  </defs>
                  {segments.map((seg, i) => (
                    <polyline key={i} points={seg.points} fill="none" stroke="#f97316" strokeWidth="1.5" strokeDasharray="4 3" opacity={0.7} markerEnd="url(#arrow-orange-daw)" />
                  ))}
                </svg>
              );
            })()}

            {/* Marquee rectangle */}
            {marqueeRect && (
              <div
                style={{
                  position: 'absolute', left: `${marqueeRect.x}px`, top: `${marqueeRect.y}px`,
                  width: `${marqueeRect.w}px`, height: `${marqueeRect.h}px`,
                  border: '1px dashed var(--color-primary)', backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)',
                  zIndex: 40, pointerEvents: 'none',
                }}
              />
            )}

            {/* Playback cursor — offset by HEAD_WIDTH like the ruler, so it never renders under the sticky head column */}
            <DAWPlayheadCursor pxPerSecond={pxPerSecond} />
          </div>
        </div>

      </div>

      {/* Reduce (collapse) handle — mirrors the sidebar collapse toggles: a
          soft frosted circular knob floating just past the dock's top edge with
          the same offset the sidebars use (no carved border behind it), centred
          horizontally. Clicking it collapses the timeline back to the mini
          transport. */}
      <button
        onClick={onClose}
        aria-label="Reduce timeline"
        title="Reduce timeline"
        style={{
          position: 'absolute',
          left: '50%',
          top: `${-(UI_SIDEBAR_TOGGLE.DIAMETER / 2 - UI_SIDEBAR_TOGGLE.MARGIN / 2)}px`,
          transform: 'translate(-50%, -50%)',
          width: `${UI_SIDEBAR_TOGGLE.DIAMETER}px`,
          height: `${UI_SIDEBAR_TOGGLE.DIAMETER}px`,
          zIndex: 40,
        }}
        className="sidebar-toggle-handle sidebar-toggle-handle--expanded backdrop-blur-lg backdrop-saturate-150"
      >
        <svg width="12" height="7" viewBox="0 0 12 7" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Top-edge resize grip — same hover-blue mechanism as the sidebars:
          an invisible full-width hit strip whose inner line highlights with
          the primary color while hovering / dragging. Reserves no space. */}
      <div
        onPointerDown={handleResizePointerDown}
        onPointerEnter={() => setIsResizeHovered(true)}
        onPointerLeave={() => setIsResizeHovered(false)}
        title="Drag to resize"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          height: `${UI_SIDEBAR_RESIZE.HANDLE_HIT_AREA}px`,
          cursor: 'ns-resize', zIndex: 36,
        }}
      >
        <div
          style={{
            position: 'absolute', top: 1, left: 0, right: 0,
            height: `${UI_SIDEBAR_RESIZE.HANDLE_WIDTH}px`,
            backgroundColor: (isResizeHovered || isResizeActive) ? 'var(--color-primary)' : 'transparent',
            transition: 'background-color 150ms ease',
          }}
        />
      </div>

      {/* Interval settings popover — bottom-left corner touches the opening
          track's kebab top-right corner; fixed (like the clip menu) so it floats
          above scrolling content. Compact width, compact layout. */}
      {distributeFor && (
        <div
          ref={distributePanelRef}
          style={{
            position: 'fixed',
            left: distributeFor.anchor.x,
            top: distributeFor.anchor.y,
            transform: 'translateY(-100%)',
            width: `${INTERVAL_PANEL_WIDTH}px`,
            zIndex: 9998,
          }}
        >
          <IntervalSettingsPanel
            soundId={distributeFor.soundId}
            durationSecPerIteration={distributeFor.durationSecPerIteration}
            fallbackDurationSec={distributeFor.fallbackDurationSec}
            seedIntervalSeconds={distributeFor.seedIntervalSeconds}
            initialSchedule={distributeFor.initialSchedule}
            seedJitterSeconds={distributeFor.recurring?.seedJitterSeconds}
            onApply={recurringPanel
              ? (interval, jitter) => applyRecurringInterval(distributeFor.soundId, recurringPanel.cardIndex, interval, jitter)
              : undefined}
            onCancel={recurringPanel
              ? () => writeRecurringFields(recurringPanel.cardIndex, recurringPanel.initial)
              : undefined}
            timelineDurationMs={timelineDurationMs}
            onClose={closeDistribute}
          />
        </div>
      )}

      {menu && menuItems && (
        <NestedMenu
          x={menu.x}
          y={menu.y}
          flipBottomY={menu.kind === 'track' ? menu.flipBottomY : undefined}
          items={menuItems}
          onClose={closeMenu}
        />
      )}

      {fpsHintAnchor && (
        <div
          className="bar-hint fps-hint"
          role="status"
          aria-live="polite"
          style={{
            left: fpsHintAnchor.left + DAW_FPS_ZOOM_HINT.GAP,
            top: fpsHintAnchor.centerY,
            width: DAW_FPS_ZOOM_HINT.WIDTH,
            zIndex: DAW_FPS_ZOOM_HINT.Z_INDEX,
          }}
        >
          <div className="bar-hint__body">
            <p className="bar-hint__title">{DAW_FPS_ZOOM_HINT.TITLE}</p>
            <p className="bar-hint__message">{DAW_FPS_ZOOM_HINT.MESSAGE}</p>
          </div>
          <button
            type="button"
            className="bar-hint__close"
            onClick={() => setFpsHintAnchor(null)}
            title={DAW_FPS_ZOOM_HINT.CLOSE_LABEL}
            aria-label={DAW_FPS_ZOOM_HINT.CLOSE_LABEL}
          >
            <Icon size="12px">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </Icon>
          </button>
        </div>
      )}
    </div>
  );
}

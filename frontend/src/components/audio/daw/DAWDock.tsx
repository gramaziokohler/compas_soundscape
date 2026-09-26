'use client';

import { Fragment, useLayoutEffect, useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { DAWRuler, computeTickStep, type LoopRegion } from './DAWRuler';
import { DAWTrackHead } from './DAWTrackHead';
import { DAWLane, type DAWLaneClip } from './DAWLane';
import { DAWStatusBar } from './DAWStatusBar';
import { DAWClipMenu } from './DAWClipMenu';
import { IntervalSettingsPanel } from './IntervalSettingsPanel';
import { useDawView } from './useDawView';
import { useClipSelection } from './useClipSelection';
import { useClipGesture, ensureTrackMaterialized, type ClipDescriptor, type TriggerDep } from './useClipGesture';
import { parseTriggerExpression } from '@/lib/audio/utils/trigger-ref';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useSpeckleStore } from '@/store/speckleStore';
import { useUIStore } from '@/store/uiStore';
import { DAW, DEFAULT_DBFS, UI_SIDEBAR_RESIZE, UI_SIDEBAR_TOGGLE } from '@/utils/constants';
import type { TimelineSound, IterationLink } from '@/types/audio';
import type { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';

const GROUP_ORDER = ['background', 'sound_event', 'speech'];
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
  currentTime: number;
  isPlaying: boolean;
  isAnyPlaying?: boolean;
  onSeek: (timeMs: number) => void;
  onDownload?: (format: import('@/lib/audio/SoundscapeExporter').ExportFormat) => Promise<void>;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onClose: () => void;
  onSelectSoundCard?: (promptIndex: number) => void;
  originalIRChannelCount?: number;
  leftOffset: number;
  rightOffset: number;
  sampleRate?: number;
  playbackSchedulerRef?: React.RefObject<PlaybackSchedulerService | null>;
}

export function DAWDock({
  sounds,
  currentTime,
  isPlaying,
  onSeek,
  onDownload,
  onPlay,
  onPause,
  onStop,
  onClose,
  onSelectSoundCard,
  originalIRChannelCount,
  leftOffset,
  rightOffset,
  sampleRate,
}: DAWDockProps) {
  const timelineDurationMs = useAudioControlsStore((s) => s.timelineDurationMs);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const soloedSound = useAudioControlsStore((s) => s.soloedSound);
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const iterationLinks = useAudioControlsStore((s) => s.iterationLinks);
  const isBakingSchedule = useAudioControlsStore((s) => s.isBakingSchedule);
  const storedSoundTimestamps = useAudioControlsStore((s) => s.soundTimestamps);
  const soundBufferDurations = useAudioControlsStore((s) => s.soundBufferDurations);
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

  const { pxPerSecond, setPxPerSecond, snapMode, setSnapMode, dockHeight, setDockHeight, dockAutoFit, setDockAutoFit, trackHeight, setTrackHeight } = useDawView();
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

  /* ---- Clips beyond the timeline (orchestrator-baked timestamps) ----
     extractTimelineSounds silently drops any iteration that starts at/after the
     timeline length, so a sound scene baked longer than the (per-scenario) timeline
     hides those clips. Detect that situation over the current scene's tracks and
     propose a duration that covers every stored timestamp + clip length. */
  const timelineOverrun = useMemo(() => {
    const limitMs = timelineDurationMs;
    let outside = 0;
    let maxEndMs = 0;
    for (const sound of sounds) {
      const tsSec = storedSoundTimestamps[sound.id];
      if (!tsSec || tsSec.length === 0) continue;
      const primaryDurMs =
        soundBufferDurations[sound.id] != null
          ? soundBufferDurations[sound.id] * 1000
          : sound.soundDurationMs;
      for (const sec of tsSec) {
        const startMs = sec * 1000;
        if (startMs < limitMs) continue; // still inside the timeline
        outside += 1;
        maxEndMs = Math.max(maxEndMs, startMs + primaryDurMs);
      }
    }
    if (outside === 0) return null;
    return {
      iterationCount: outside,
      proposedDurationMs: Math.max(limitMs, Math.ceil(maxEndMs / 1000) * 1000),
    };
  }, [sounds, storedSoundTimestamps, soundBufferDurations, timelineDurationMs]);

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
        return { clipKey, iterationIndex: originalIdx, startMs, durationMs, audioUrl, label: displayName, iterationLink: iterationLinks[clipKey] };
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
  }, [sortedSounds, soundConfigs, iterationLinks]);

  /* ---- Refs mirrored each render for the gesture hook (avoids stale closures mid-drag) ---- */
  const soundsRef = useRef(sounds); soundsRef.current = sounds;
  const pxPerSecondRef = useRef(pxPerSecond); pxPerSecondRef.current = pxPerSecond;
  const snapModeRef = useRef(snapMode); snapModeRef.current = snapMode;
  const tickStepSec = computeTickStep(pxPerSecond);
  const gridStepSecRef = useRef(tickStepSec); gridStepSecRef.current = tickStepSec;
  const playheadMsRef = useRef(currentTime); playheadMsRef.current = currentTime;
  const timelineDurationMsRef = useRef(timelineDurationMs); timelineDurationMsRef.current = timelineDurationMs;
  const triggerReverseRef = useRef(triggerGraph.reverse); triggerReverseRef.current = triggerGraph.reverse;
  const selectedClipKeysRef = useRef(selection.selectedClipKeys); selectedClipKeysRef.current = selection.selectedClipKeys;
  const registryRef = useRef(registry); registryRef.current = registry;

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
      // A plain click (no modifier) also expands the corresponding sound card,
      // matching the track-head name click.
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      const d = registryRef.current.get(clipKey);
      const sound = d && soundsRef.current.find((s) => s.id === d.soundId);
      const configIdx = sound?.cardIndex ?? sound?.promptIndex;
      if (configIdx !== undefined) onSelectSoundCard?.(configIdx);
    },
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
  } | null>(null);

  const distributePanelRef = useRef<HTMLDivElement>(null);

  const openDistributeFor = useCallback((sound: TimelineSound, anchor: { x: number; y: number }) => {
    const store = useAudioControlsStore.getState();
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
  }, [intervalBySoundId]);

  const closeDistribute = useCallback(() => setDistributeFor(null), []);

  // Clicking anywhere outside the popover behaves like its Cancel button:
  // restore the schedule the track had before the panel was opened.
  useEffect(() => {
    if (!distributeFor) return;
    const onPointerDown = (e: PointerEvent) => {
      if (distributePanelRef.current?.contains(e.target as Node)) return;
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
  }, [distributeFor]);

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

  /* ---- Context menu (variant / entity override) ---- */
  const [contextMenu, setContextMenu] = useState<{ soundId: string; iterationIndex: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [contextMenu]);

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
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);
  useEffect(() => {
    if (!loopRegion || !isPlaying) return;
    if (currentTime >= loopRegion.endMs) onSeek(loopRegion.startMs);
  }, [currentTime, isPlaying, loopRegion, onSeek]);

  /* ---- Duration edit (ruler icon + footer share this state) ---- */
  const [isEditingDuration, setIsEditingDuration] = useState(false);

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
    selection.selectedClipKeys.forEach((key) => {
      const d = registryRef.current.get(key);
      if (!d) return;
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
      store.remapIterationLinksForInsert(d.soundId, insertAt);
      store.handleTimestampsChange(d.soundId, newTs);
    });
  }, [selection]);

  const clipboardRef = useRef<Array<{ soundId: string; offsetMs: number; durationMs: number }>>([]);
  const handleCopySelected = useCallback(() => {
    const descriptors = [...selection.selectedClipKeys].map((k) => registryRef.current.get(k)).filter((d): d is ClipDescriptor => !!d);
    if (descriptors.length === 0) return;
    const minStart = Math.min(...descriptors.map((d) => d.startMs));
    clipboardRef.current = descriptors.map((d) => ({ soundId: d.soundId, offsetMs: d.startMs - minStart, durationMs: d.durationMs }));
  }, [selection]);
  const handlePasteAtPlayhead = useCallback(() => {
    clipboardRef.current.forEach(({ soundId, offsetMs }) => {
      ensureTrackMaterialized(soundsRef, soundId);
      const store = useAudioControlsStore.getState();
      const current = store.soundTimestamps[soundId] ?? [];
      const newStartSec = parseFloat(((currentTime + offsetMs) / 1000).toFixed(3));
      let insertAt = current.length;
      for (let i = 0; i < current.length; i++) {
        if (newStartSec < current[i]) { insertAt = i; break; }
      }
      const newTs = [...current];
      newTs.splice(insertAt, 0, newStartSec);
      store.remapIterationLinksForInsert(soundId, insertAt);
      store.handleTimestampsChange(soundId, newTs);
    });
  }, [currentTime]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Never hijack keys meant for a focused text field (duration editor, etc.).
    const targetTag = (e.target as HTMLElement).tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { selection.clear(); return; }
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
  }, [selection, snapStepSec, commitDelta, handleDeleteSelected, handleDuplicateSelected, handleCopySelected, handlePasteAtPlayhead]);

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
      const maxH = window.innerHeight - DAW.MAX_DOCK_HEIGHT_MARGIN;
      setDockHeight(Math.max(DAW.MIN_DOCK_HEIGHT, Math.min(maxH, startHeight + delta)));
    };
    const up = () => {
      setIsResizeActive(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [dockHeight, setDockHeight, setDockAutoFit]);

  /* ---- Auto-fit: while the user hasn't manually resized the dock, its height
       hugs the content — ruler + one row per track + the status footer. It grows
       when tracks are added and shrinks when they're removed. ---- */
  useEffect(() => {
    if (!dockAutoFit) return;
    const maxH = window.innerHeight - DAW.MAX_DOCK_HEIGHT_MARGIN;
    const needed = DAW.RULER_HEIGHT + rows.length * trackHeight + DAW.STATUS_HEIGHT;
    const target = Math.max(DAW.MIN_DOCK_HEIGHT, Math.min(maxH, needed));
    if (dockHeight !== target) setDockHeight(target);
  }, [dockAutoFit, dockHeight, rows.length, trackHeight, setDockHeight]);

  /* ---- Wheel zoom while over the dock: Ctrl/Meta+wheel = vertical track-height
       zoom, Alt+wheel = horizontal timeline zoom (px/sec). ---- */
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const dock = dockRef.current;
      if (!dock || !dock.contains(e.target as Node)) return;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
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
  const cursorLeft = DAW.HEAD_WIDTH + (currentTime / 1000) * pxPerSecond;
  const tickStepPx = tickStepSec * pxPerSecond;

  const totalClipCount = useMemo(() => rows.reduce((n, r) => n + r.clips.length, 0), [rows]);

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

  /* ---- Context menu derived data ---- */
  const contextMenuData = useMemo(() => {
    if (!contextMenu) return null;
    const { soundId, iterationIndex } = contextMenu;
    const linkKey = `${soundId}-${iterationIndex}`;
    const currentLink = iterationLinks[linkKey] ?? {};
    const timelineSound = sounds.find((s) => s.id === soundId);
    const cardIndex = timelineSound?.cardIndex ?? timelineSound?.promptIndex;

    const variants = cardIndex !== undefined
      ? generatedSounds.filter((s: any) => {
          if (s.prompt_index === cardIndex) return true;
          if (s.prompt_index != null && s.prompt_index >= 10000 && Math.floor(s.prompt_index / 10000) === cardIndex) return true;
          return false;
        }).map((v: any, vi: number) => ({ id: v.id, label: String.fromCharCode(65 + vi) }))
      : [];

    const configEntities = cardIndex !== undefined ? soundConfigs[cardIndex]?.entities ?? [] : [];
    const entityIdxMap = new Map<string, number>();
    configEntities.forEach((e: any, ei: number) => { const eid = e.nodeId || e.id; if (eid) entityIdxMap.set(eid, ei); });

    const linkedEntities = cardIndex !== undefined
      ? [...objectSoundLinks.entries()].filter(([, pi]) => pi === cardIndex).map(([objectId]) => ({
          id: objectId,
          displayNumber: (entityIdxMap.get(objectId) ?? 0) + 1,
        }))
      : [];

    const orchestrateMeta = cardIndex !== undefined ? soundConfigs[cardIndex]?.orchestrateMeta : undefined;
    const triggerExpression = orchestrateMeta
      ? `${orchestrateMeta.trigger?.expression?.[iterationIndex] ?? '-'}${orchestrateMeta.trigger?.delay?.[iterationIndex] ? ` +${orchestrateMeta.trigger.delay[iterationIndex]}s` : ''}`
      : null;

    // Original indices of every clip rendered on this track — the target set for
    // the menu's "apply to all iterations" bulk actions.
    const iterationIndices = timelineSound
      ? (timelineSound.scheduledIterationOriginalIndices ?? timelineSound.scheduledIterations.map((_, i) => i))
      : [];

    return { soundId, iterationIndex, cardIndex, currentLink, variants, linkedEntities, triggerExpression, configEntities, iterationIndices };
  }, [contextMenu, iterationLinks, sounds, generatedSounds, soundConfigs, objectSoundLinks]);

  // Bulk-fill every iteration of the right-clicked track with one override
  // (variant or linked entity) in a single store commit.
  const applyLinkToAllIterations = useCallback((partial: Partial<IterationLink>) => {
    if (!contextMenuData || contextMenuData.iterationIndices.length === 0) return;
    setIterationLinkForAllIterations(contextMenuData.soundId, contextMenuData.iterationIndices, partial);
    scheduleBakeOrchestrate();
  }, [contextMenuData, setIterationLinkForAllIterations, scheduleBakeOrchestrate]);

  return (
    <div
      ref={dockRef}
      tabIndex={0}
      onPointerDown={(e) => { if (dockRef.current) dockRef.current.focus(); void e; }}
      onKeyDown={handleKeyDown}
      className="transition-all duration-300 ease-in-out"
      style={{
        position: 'fixed', bottom: 0, left: `${leftOffset}px`, right: `${rightOffset}px`, height: `${dockHeight}px`,
        display: 'flex', flexDirection: 'column',
        zIndex: 200, overflow: 'visible', userSelect: 'none', outline: 'none',
      }}
    >
      {/* Frosted glass background — same treatment as the left/right sidebars,
          with the top edge carved into the same concave notch as the sidebars
          (reveals the scene behind, no border line). */}
      <div
        className="sidebar-glass backdrop-blur-lg backdrop-saturate-150"
        style={dockWidth > 0 ? { clipPath: buildTopNotchClipPath(dockWidth, dockHeight) } : undefined}
        aria-hidden="true"
      />

      <div className="relative z-[1] flex flex-col flex-1 min-h-0">
        {/* Ruler sits flush against the dock's top edge — no empty strip and no
            top border. The floating reduce knob and the sidebar-style resize
            grip are overlays (see below), so they reserve no vertical space. */}
        <div ref={scrollContainerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <div
            onPointerDown={handleTracksPointerDown}
            style={{ minWidth: DAW.HEAD_WIDTH + contentWidth, position: 'relative' }}
          >
            <DAWRuler
              totalDurationSec={totalDurationSec}
              pxPerSecond={pxPerSecond}
              onSeek={onSeek}
              loopRegion={loopRegion}
              onLoopRegionChange={setLoopRegion}
              onEditDuration={() => setIsEditingDuration(true)}
              hasOverrun={!!timelineOverrun && timelineOverrun.iterationCount > 0}
            />

            {rows.map(({ sound, displayName, configIdx, clips }) => (
              <Fragment key={sound.id}>
              <div style={{ display: 'flex' }}>
                <DAWTrackHead
                  sound={sound}
                  displayName={displayName}
                  groupLabel={GROUP_LABELS[sound.soundGroup ?? 'sounds'] ?? 'Sounds'}
                  clipCount={clips.filter((c) => !c.excluded).length}
                  excludedCount={sound.excludedIterations?.length ?? 0}
                  trackHeight={trackHeight}
                  isMuted={mutedSounds.has(sound.id)}
                  isSoloed={soloedSound === sound.id}
                  volumeDbfs={soundVolumes[sound.id] ?? soundConfigs[configIdx ?? -1]?.dbfs ?? DEFAULT_DBFS}
                  onMute={() => handleMute(sound.id)}
                  onSolo={() => handleSolo(sound.id)}
                  onVolumeChange={(db) => handleVolumeChange(sound.id, db)}
                  onSelectSoundCard={onSelectSoundCard && configIdx !== undefined ? () => onSelectSoundCard(configIdx) : undefined}
                  onDoubleClickSoundCard={configIdx !== undefined ? () => { triggerZoomToSoundCard(configIdx); handleZoomToLinkedEntity(configIdx); } : undefined}
                  onRequestDistribute={(anchor) => openDistributeFor(sound, anchor)}
                  onSelectAllClips={() => selection.replace(clips.map((c) => c.clipKey))}
                  onClearClips={() => handleClearClips(sound)}
                  onResetTrack={() => handleResetTrack(sound)}
                  onZoomToLinkedEntity={() => configIdx !== undefined && handleZoomToLinkedEntity(configIdx)}
                  onClearEntityLinks={() => clearAllIterationLinksForSound(sound.id)}
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
                  isMuted={mutedSounds.has(sound.id)}
                  isDraggable
                  selectedClipKeys={selection.selectedClipKeys}
                  dragPreview={gesture.dragPreview}
                  isDragging={gesture.isDragging}
                  isDuplicating={gesture.isDuplicating}
                  tickStepPx={tickStepPx}
                  onClipPointerDown={(e, clip) => {
                    selection.onClipPressed(clip.clipKey, e, clips.map((c) => c.clipKey));
                    gesture.beginDrag(e, { clipKey: clip.clipKey, soundId: sound.id, iterationIndex: clip.iterationIndex, startMs: clip.startMs, durationMs: clip.durationMs });
                  }}
                  onDeleteClip={(iterationIndex) => { ensureTrackMaterialized(soundsRef, sound.id); handleRemoveTimestamp(sound.id, iterationIndex); }}
                  onClipContextMenu={(iterationIndex, x, y) => setContextMenu({ soundId: sound.id, iterationIndex, x, y })}
                  onClipDoubleClick={configIdx !== undefined ? () => { triggerZoomToSoundCard(configIdx); handleZoomToLinkedEntity(configIdx); } : undefined}
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
            <div
              style={{
                position: 'absolute', top: 0, left: `${cursorLeft}px`, width: '2px', bottom: 0,
                backgroundColor: 'var(--color-primary)', opacity: 0.85, zIndex: 50, pointerEvents: 'none',
                boxShadow: '0 0 4px var(--color-primary)',
              }}
            />
          </div>
        </div>

        <DAWStatusBar
          isPlaying={isPlaying}
          onPlay={onPlay}
          onPause={onPause}
          onStop={onStop}
          currentTimeMs={currentTime}
          durationMs={timelineDurationMs}
          onDurationChange={setTimelineDurationMs}
          isEditingDuration={isEditingDuration}
          onStartEditDuration={() => setIsEditingDuration(true)}
          onStopEditDuration={() => setIsEditingDuration(false)}
          timelineOverrun={timelineOverrun}
          onExtendTimeline={handleExtendTimelineToFit}
          trackCount={rows.length}
          clipCount={totalClipCount}
          selectionCount={selection.selectedClipKeys.size}
          pxPerSecond={pxPerSecond}
          onZoomChange={setPxPerSecond}
          snapMode={snapMode}
          onSnapModeChange={setSnapMode}
          onDownload={onDownload}
          originalIRChannelCount={originalIRChannelCount}
          isBakingSchedule={isBakingSchedule}
          sampleRate={sampleRate}
        />
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
            timelineDurationMs={timelineDurationMs}
            onClose={closeDistribute}
          />
        </div>
      )}

      {contextMenu && contextMenuData && (
        <DAWClipMenu
          x={contextMenu.x}
          y={contextMenu.y}
          variants={contextMenuData.variants}
          currentVariantIndex={contextMenuData.currentLink.variantIndex}
          linkedEntities={contextMenuData.linkedEntities}
          currentEntityNodeId={contextMenuData.currentLink.entityNodeId}
          triggerExpression={contextMenuData.triggerExpression}
          onPickVariant={(variantIndex) => {
            setIterationLink(contextMenuData.soundId, contextMenuData.iterationIndex, { variantIndex });
            scheduleBakeOrchestrate();
          }}
          onPickEntity={(entityId, entityIndex) => {
            if (contextMenuData.currentLink.entityNodeId === entityId) {
              clearIterationLink(contextMenuData.soundId, contextMenuData.iterationIndex);
              return;
            }
            const entity = contextMenuData.configEntities.find((e: any) => (e.nodeId || e.id) === entityId);
            const entityPosition = entity?.bounds?.center
              ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]] as [number, number, number]
              : entity?.position && entity.position.length >= 3
                ? [entity.position[0], entity.position[1], entity.position[2]] as [number, number, number]
                : undefined;
            setIterationLink(contextMenuData.soundId, contextMenuData.iterationIndex, { entityNodeId: entityId, entityPosition, entityIndex });
          }}
          onApplyVariantToAll={() =>
            applyLinkToAllIterations({ variantIndex: contextMenuData.currentLink.variantIndex ?? 0 })
          }
          onApplyEntityToAll={() =>
            applyLinkToAllIterations({
              entityNodeId: contextMenuData.currentLink.entityNodeId,
              entityPosition: contextMenuData.currentLink.entityPosition,
              entityIndex: contextMenuData.currentLink.entityIndex,
            })
          }
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

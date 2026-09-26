'use client';

import { useCallback, useRef, useState } from 'react';
import { useAudioControlsStore } from '@/store/audioControlsStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import type { TimelineSound } from '@/types/audio';
import { resolveSnap, type SnapMode } from './daw-snap';

export interface ClipDescriptor {
  clipKey: string;
  soundId: string;
  iterationIndex: number;
  startMs: number;
  durationMs: number;
}

export interface TriggerDep {
  soundId: string;
  iterationIndex: number;
}

interface UseClipGestureArgs {
  soundsRef: React.RefObject<TimelineSound[]>;
  pxPerSecondRef: React.RefObject<number>;
  snapModeRef: React.RefObject<SnapMode>;
  gridStepSecRef: React.RefObject<number>;
  playheadMsRef: React.RefObject<number>;
  timelineDurationMsRef: React.RefObject<number>;
  /** Reverse trigger-dependency graph: key `${soundId}-${iterationIndex}` -> dependents that must move with it. */
  triggerReverseRef: React.RefObject<Map<string, TriggerDep[]>>;
  /** Currently selected clip keys — a plain press on a selected clip drags the whole group. */
  selectedClipKeysRef: React.RefObject<Set<string>>;
  /** Lookup every clip currently rendered, keyed by clipKey (for resolving a group drag). */
  clipRegistryRef: React.RefObject<Map<string, ClipDescriptor>>;
  onClickResolved: (clipKey: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
}

const CLICK_THRESHOLD_PX = 3;
const SNAP_MAGNET_PX = 6;

/**
 * Freeze an "auto" track (no `soundTimestamps` entry yet — its clips are derived
 * from the interval default) into an explicit schedule before mutating it, so DAW
 * edits apply to concrete positions. Tracks that already have a stored schedule
 * (including a cleared `[]`) are left untouched.
 */
export function ensureTrackMaterialized(soundsRef: React.RefObject<TimelineSound[]>, soundId: string) {
  const state = useAudioControlsStore.getState();
  if (state.soundTimestamps[soundId] !== undefined) return;
  const sound = soundsRef.current?.find((s) => s.id === soundId);
  if (!sound) return;
  const explicitTsSec = sound.scheduledIterations?.length
    ? sound.scheduledIterations.map((ms) => parseFloat((ms / 1000).toFixed(3)))
    : undefined;
  if (!explicitTsSec) return;
  state.handleTimestampsChange(soundId, explicitTsSec);
}

/** Drag / group-drag / duplicate for DAW clips. One instance lives in DAWDock. */
export function useClipGesture({
  soundsRef,
  pxPerSecondRef,
  snapModeRef,
  gridStepSecRef,
  playheadMsRef,
  timelineDurationMsRef,
  triggerReverseRef,
  selectedClipKeysRef,
  clipRegistryRef,
  onClickResolved,
}: UseClipGestureArgs) {
  const [dragPreview, setDragPreview] = useState<Record<string, number> | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const stateRef = useRef<{
    anchor: ClipDescriptor;
    dragged: ClipDescriptor[];
    startClientX: number;
    duplicate: boolean;
  } | null>(null);

  const beginDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, clip: ClipDescriptor) => {
      if (e.button === 2) return;
      e.preventDefault();
      e.stopPropagation();

      const duplicate = e.ctrlKey || e.metaKey;
      const selected = selectedClipKeysRef.current ?? new Set<string>();
      const registry = clipRegistryRef.current ?? new Map<string, ClipDescriptor>();
      const dragged: ClipDescriptor[] = selected.has(clip.clipKey) && selected.size > 1
        ? [...selected].map((k) => registry.get(k)).filter((d): d is ClipDescriptor => !!d)
        : [clip];

      stateRef.current = { anchor: clip, dragged, startClientX: e.clientX, duplicate };
      setIsDragging(true);
      setIsDuplicating(duplicate);

      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const computeFor = (gesture: NonNullable<typeof stateRef.current>, clientX: number) => {
        const pxPerSecond = pxPerSecondRef.current ?? 10;
        const deltaSec = (clientX - gesture.startClientX) / pxPerSecond;
        const rawStartSec = gesture.anchor.startMs / 1000 + deltaSec;

        const durationMs = timelineDurationMsRef.current ?? 0;
        const siblingsEdges: number[] = [];
        const draggedKeys = new Set(gesture.dragged.map((d) => d.clipKey));
        // Neighbor edges come from every other rendered clip on the anchor's track.
        registry.forEach((desc, key) => {
          if (desc.soundId === gesture.anchor.soundId && !draggedKeys.has(key)) {
            siblingsEdges.push(desc.startMs / 1000, (desc.startMs + desc.durationMs) / 1000);
          }
        });

        const snappedStartSec = resolveSnap(rawStartSec, {
          mode: snapModeRef.current ?? 'on',
          pxPerSecond,
          gridStepSec: gridStepSecRef.current ?? 1,
          magnetPx: SNAP_MAGNET_PX,
          playheadSec: (playheadMsRef.current ?? 0) / 1000,
          neighborEdgesSec: siblingsEdges,
          bypass: false,
        });
        const actualDeltaMs = snappedStartSec * 1000 - gesture.anchor.startMs;

        const preview: Record<string, number> = {};
        gesture.dragged.forEach((d) => {
          const newStart = Math.max(0, d.startMs + actualDeltaMs);
          preview[d.clipKey] = Math.min(newStart, Math.max(0, durationMs - d.durationMs)) - d.startMs;
        });
        return { preview, actualDeltaMs };
      };

      const computePreview = (clientX: number) => {
        const gesture = stateRef.current;
        if (!gesture) return null;
        return computeFor(gesture, clientX);
      };

      const handleMove = (ev: PointerEvent) => {
        const result = computePreview(ev.clientX);
        if (result) setDragPreview(result.preview);
      };

      const endDrag = (ev: PointerEvent) => {
        const gesture = stateRef.current;
        stateRef.current = null;
        try { target.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
        target.removeEventListener('pointermove', handleMove);
        target.removeEventListener('pointerup', endDrag);
        target.removeEventListener('pointercancel', endDrag);
        setIsDragging(false);
        setIsDuplicating(false);
        setDragPreview(null);
        if (!gesture) return;

        const movedPx = Math.abs(ev.clientX - gesture.startClientX);
        if (movedPx <= CLICK_THRESHOLD_PX) {
          onClickResolved(gesture.anchor.clipKey, { ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, shiftKey: ev.shiftKey });
          return;
        }

        // Recompute from the captured `gesture` directly — stateRef.current was
        // already nulled above, so computePreview() (which reads the ref) would
        // return null here and silently drop the commit.
        const result = computeFor(gesture, ev.clientX);
        if (!result) return;
        const { actualDeltaMs } = result;
        const store = useAudioControlsStore.getState();
        const { clearOrchestrateTrigger } = useSoundscapeStore.getState();

        if (gesture.duplicate) {
          gesture.dragged.forEach((d) => {
            ensureTrackMaterialized(soundsRef, d.soundId);
            const current = useAudioControlsStore.getState().soundTimestamps[d.soundId] ?? [];
            const newStartSec = parseFloat(((Math.max(0, d.startMs + actualDeltaMs)) / 1000).toFixed(3));
            let insertAt = current.length;
            for (let i = 0; i < current.length; i++) {
              if (newStartSec < current[i]) { insertAt = i; break; }
            }
            const newTs = [...current];
            newTs.splice(insertAt, 0, newStartSec);
            store.remapIterationLinksForInsert(d.soundId, insertAt);
            store.handleTimestampsChange(d.soundId, newTs);
          });
          return;
        }

        // Plain move: convert any interval-mode track among the dragged clips first.
        const soundIds = new Set(gesture.dragged.map((d) => d.soundId));
        soundIds.forEach((soundId) => ensureTrackMaterialized(soundsRef, soundId));

        // Break trigger links for directly-dragged clips that had one.
        const sounds = soundsRef.current ?? [];
        gesture.dragged.forEach((d) => {
          const sound = sounds.find((s) => s.id === d.soundId);
          if (sound?.promptIndex !== undefined) {
            clearOrchestrateTrigger(sound.cardIndex ?? sound.promptIndex, d.iterationIndex);
          }
        });

        // Transitive dependents (trigger-linked) move by the same delta.
        const visited = new Set<string>(gesture.dragged.map((d) => `${d.soundId}-${d.iterationIndex}`));
        const dependents: TriggerDep[] = [];
        const queue: TriggerDep[] = gesture.dragged.map((d) => ({ soundId: d.soundId, iterationIndex: d.iterationIndex }));
        const reverse = triggerReverseRef.current ?? new Map();
        while (queue.length > 0) {
          const current = queue.shift()!;
          const key = `${current.soundId}-${current.iterationIndex}`;
          const deps = reverse.get(key);
          if (!deps) continue;
          deps.forEach((dep) => {
            const depKey = `${dep.soundId}-${dep.iterationIndex}`;
            if (!visited.has(depKey)) {
              visited.add(depKey);
              dependents.push(dep);
              queue.push(dep);
            }
          });
        }
        dependents.forEach((dep) => ensureTrackMaterialized(soundsRef, dep.soundId));

        const fresh = useAudioControlsStore.getState().soundTimestamps;
        const batch: Record<string, number[]> = {};
        const writeAt = (soundId: string, iterationIndex: number, newStartMs: number) => {
          const base = batch[soundId] ?? fresh[soundId] ?? [];
          const arr = [...base];
          arr[iterationIndex] = parseFloat((Math.max(0, newStartMs) / 1000).toFixed(3));
          batch[soundId] = arr;
        };

        gesture.dragged.forEach((d) => writeAt(d.soundId, d.iterationIndex, d.startMs + actualDeltaMs));
        dependents.forEach((dep) => {
          const base = batch[dep.soundId] ?? fresh[dep.soundId] ?? [];
          const oldMs = (base[dep.iterationIndex] ?? 0) * 1000;
          writeAt(dep.soundId, dep.iterationIndex, oldMs + actualDeltaMs);
        });

        // Materialize any excluded iteration the user just dragged over: clear its
        // ghost, blank its broken trigger, and pin it to its authored slot so the
        // solver keeps it (a covered ghost is otherwise hidden at render time only).
        gesture.dragged.forEach((d) => {
          const sound = sounds.find((s) => s.id === d.soundId);
          const ghosts = sound?.excludedClips ?? [];
          if (ghosts.length === 0) return;
          const newStartMs = Math.max(0, d.startMs + actualDeltaMs);
          const cardIdx = sound?.cardIndex ?? sound?.promptIndex;
          ghosts.forEach((g) => {
            const overlaps = newStartMs < g.startMs + g.durationMs && g.startMs < newStartMs + d.durationMs;
            if (!overlaps) return;
            if (cardIdx !== undefined) clearOrchestrateTrigger(cardIdx, g.originalIndex);
            store.clearIterationExclusion(d.soundId, g.originalIndex);
            writeAt(d.soundId, g.originalIndex, g.startMs);
          });
        });

        store.handleTimestampsChangeBatch(batch);
      };

      target.addEventListener('pointermove', handleMove);
      target.addEventListener('pointerup', endDrag);
      target.addEventListener('pointercancel', endDrag);
    },
    [soundsRef, pxPerSecondRef, snapModeRef, gridStepSecRef, playheadMsRef, timelineDurationMsRef,
      triggerReverseRef, selectedClipKeysRef, clipRegistryRef, onClickResolved],
  );

  return { dragPreview, isDragging, isDuplicating, beginDrag };
}

/**
 * usePffdtdFreeMovement — free positioning of the active wave-based card.
 *
 * When the active card's completed run has free positioning (results JSON
 * `free` block), a moved free object — a receiver ('listener' mode) or a sound
 * position ('source' mode) — gets the nearest grid point's IRs once it has
 * stopped moving for PFFDTD.FREE_DEBOUNCE_MS (store writes happen on drag end;
 * undo/redo and typed positions go the same way). The previous request for the
 * same object is aborted (the backend also drops it: latest wins). The IRs are
 * written into the card's `sourceReceiverIRMapping` / `simulationPositions`;
 * page.tsx then hot-swaps them through AudioOrchestrator. Mount once (page.tsx).
 */

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { apiService } from '@/services/api';
import {
  useAcousticsSimulationStore,
  usePffdtdFreeStore,
  useReceiversStore,
  useSoundscapeStore,
} from '@/store';
import { PFFDTD } from '@/utils/constants';
import {
  applyFreeIRs,
  dropReplacedIRIds,
  movedFreeObjects,
  positionSignature,
  pruneDerivedSourceKeys,
  type FreeSimPositions,
  type MovedFreeObject,
} from '@/lib/acoustics/pffdtd-free';
import type { PffdtdFreeMode } from '@/types/pffdtd';

interface PendingMove {
  signature: string;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
}

type Vec3 = [number, number, number];

export function usePffdtdFreeMovement(): void {
  const active = useAcousticsSimulationStore((s) => {
    const cfg = s.activeSimulationIndex === null ? undefined : s.simulationConfigs[s.activeSimulationIndex];
    return cfg?.type === 'pffdtd' ? cfg : undefined;
  });
  const simulationId = active?.state === 'completed' ? active.currentSimulationId ?? null : null;
  const grid = usePffdtdFreeStore((s) => (simulationId ? s.grids[simulationId] : undefined));
  const loadGrid = usePffdtdFreeStore((s) => s.loadGrid);
  const setObjectStatus = usePffdtdFreeStore((s) => s.setObjectStatus);
  const receivers = useReceiversStore((s) => s.receivers);
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);

  const pending = useRef(new Map<string, PendingMove>());
  const derivedKeys = useRef(new Set<string>());

  useEffect(() => {
    if (simulationId) void loadGrid(simulationId);
  }, [simulationId, loadGrid]);

  // A different run (or none): drop everything in flight for the previous one.
  useEffect(() => {
    const moves = pending.current;
    const keys = derivedKeys.current;
    return () => {
      for (const p of moves.values()) {
        if (p.timer) clearTimeout(p.timer);
        p.controller?.abort();
      }
      moves.clear();
      keys.clear();
    };
  }, [simulationId]);

  const sounds = useMemo(
    () =>
      (soundscapeData ?? []).map((s: { id: string; display_name?: string; position: Vec3 }) => ({
        id: s.id,
        display_name: s.display_name,
        position: s.position,
      })),
    [soundscapeData],
  );

  const configId = active?.id ?? null;
  const positions = active?.simulationPositions as FreeSimPositions | undefined;
  const mode: Exclude<PffdtdFreeMode, 'off'> | null = grid?.status === 'ready' && grid.block ? grid.block.mode : null;

  useEffect(() => {
    if (!simulationId || !configId || !mode || !positions) return;
    const moved = movedFreeObjects(mode, positions, receivers, sounds);
    const movedIds = new Set(moved.map((m) => m.objectId));

    // Back where its IR was made for: nothing to do any more.
    for (const [objectId, p] of pending.current) {
      if (movedIds.has(objectId)) continue;
      if (p.timer) clearTimeout(p.timer);
      p.controller?.abort();
      pending.current.delete(objectId);
      setObjectStatus(simulationId, objectId, null);
    }

    for (const m of moved) {
      const signature = positionSignature(m.position);
      const prev = pending.current.get(m.objectId);
      if (prev?.signature === signature) continue; // already requested (or failed) for this spot
      if (prev?.timer) clearTimeout(prev.timer);
      prev?.controller?.abort();
      const entry: PendingMove = { signature, timer: null, controller: null };
      entry.timer = setTimeout(() => {
        entry.timer = null;
        const ctx = { pending: pending.current, derivedKeys: derivedKeys.current, setObjectStatus };
        void requestFreeIR(ctx, simulationId, configId, mode, m, entry);
      }, PFFDTD.FREE_DEBOUNCE_MS);
      pending.current.set(m.objectId, entry);
      setObjectStatus(simulationId, m.objectId, { state: 'pending', label: m.label });
    }
  }, [simulationId, configId, mode, positions, receivers, sounds, setObjectStatus]);
}

/** What a request needs from the hook (refs and the status setter). */
interface RequestContext {
  pending: Map<string, PendingMove>;
  derivedKeys: Set<string>;
  setObjectStatus: ReturnType<typeof usePffdtdFreeStore.getState>['setObjectStatus'];
}

async function requestFreeIR(
  ctx: RequestContext,
  simId: string,
  cfgId: string,
  freeMode: Exclude<PffdtdFreeMode, 'off'>,
  moved: MovedFreeObject,
  entry: PendingMove,
): Promise<void> {
  const controller = new AbortController();
  entry.controller = controller;
  let res: Awaited<ReturnType<typeof apiService.getPffdtdFreeIR>>;
  try {
    res = await apiService.getPffdtdFreeIR(simId, moved.objectId, moved.position, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) return;
    res = { ok: false, failure: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (controller.signal.aborted || ctx.pending.get(moved.objectId) !== entry) return;
  entry.controller = null;
  if (!res.ok) {
    if (res.failure !== 'superseded') {
      ctx.setObjectStatus(simId, moved.objectId, { state: res.failure, label: moved.label, message: res.message });
    }
    return;
  }

  const store = useAcousticsSimulationStore.getState();
  const index = store.simulationConfigs.findIndex((c) => c.id === cfgId);
  const cfg = store.simulationConfigs[index];
  if (!cfg || cfg.type !== 'pffdtd' || cfg.currentSimulationId !== simId || !cfg.simulationPositions) return;
  const prevMapping = cfg.sourceReceiverIRMapping ?? {};
  let next = applyFreeIRs(freeMode, moved, res.data, prevMapping, cfg.simulationPositions as FreeSimPositions);
  if (next.newSourceKey) ctx.derivedKeys.add(next.newSourceKey);
  // The position the sounds left no longer needs its IR row, unless another sound still uses it.
  if (freeMode === 'source') ctx.derivedKeys.add(moved.objectId);
  const pruned = pruneDerivedSourceKeys(ctx.derivedKeys, next.mapping, next.positions);
  next = { ...next, ...pruned };
  // The moved object is now at its recorded position, so it leaves the pending set.
  ctx.pending.delete(moved.objectId);
  ctx.setObjectStatus(simId, moved.objectId, null);
  const key = freeMode === 'listener' ? moved.objectId : next.newSourceKey ?? moved.objectId;
  ctx.setObjectStatus(simId, key, {
    state: 'ready',
    label: moved.label,
    snappedPosition: res.data.snapped_position,
    distanceM: res.data.distance_m,
  });
  store.handleUpdateConfig(index, {
    sourceReceiverIRMapping: next.mapping,
    importedIRIds: dropReplacedIRIds((cfg as { importedIRIds?: string[] }).importedIRIds, prevMapping, next.mapping),
    simulationPositions: { ...cfg.simulationPositions, ...next.positions },
  });
}

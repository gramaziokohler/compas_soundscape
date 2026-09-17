/**
 * Acoustic Layer Isolation Hook
 *
 * Computes the acoustic region's geometry ids (union across all selected nodes —
 * whole layers and/or individual child objects) and publishes them to the unified
 * visibility model, then triggers applyVisibility(). All actual hide/isolate is
 * delegated to speckleStore's applyVisibility(), which derives a single
 * FilteringExtension target from the view mode + acoustic layer + user intent
 * (no per-frame re-apply loop).
 *
 * Responsibilities:
 *   - Auto-detect / verify the acoustic layer from the world tree.
 *   - Open ObjectExplorer in selection mode when entering acoustic mode with no
 *     region defined.
 *   - Publish the resolved acoustic geometry id union (reactive store field +
 *     module ref) and re-derive visibility.
 *
 * Runs inside SpeckleScene.
 */

import { useEffect, useRef } from 'react';
import type React from 'react';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { getRootNodesForModel, getGeometryLeafIdsFromNode, countTopLevelLayers, findSingleTopLevelLayer } from '@/hooks/useSpeckleTree';
import { setAcousticLayerAllIds, setAllModelGeometryIds } from '@/store/speckleStore';
import { computeGeometryFaceCounts } from '@/utils/face-count';

/** Find a tree node whose own id matches (supports leaf + nested-node picks). */
function findNodeById(nodes: any[], id: string): any | null {
  for (const node of nodes) {
    const nodeId = node.raw?.id || node.model?.raw?.id || node.model?.id || node.id;
    if (nodeId === id) return node;
    const children = node.model?.children || node.children;
    if (children && children.length > 0) {
      const found = findNodeById(children as any[], id);
      if (found) return found;
    }
  }
  return null;
}

function findNodeByName(nodes: any[], name: string): any | null {
  for (const node of nodes) {
    const nodeName = node.raw?.name || node.model?.raw?.name || node.model?.name;
    if (nodeName === name) return node;
    const children = node.model?.children || node.children;
    if (children && children.length > 0) {
      const found = findNodeByName(children as any[], name);
      if (found) return found;
    }
  }
  return null;
}

/** Total mesh faces of the given geometry ids in a face-count map. */
function sumFaceCounts(map: Record<string, number>, geometryIds: string[]): number {
  return geometryIds.reduce((sum, id) => sum + (map[id] ?? 0), 0);
}

export function useAcousticLayerIsolation(
  viewerRef: React.RefObject<any>,
  worldTree: any,
  viewMode: string,
) {
  const isAcousticMode = viewMode === 'acoustic';
  const acousticLayerIds = useAcousticLayerStore((s) => s.selectedAcousticLayerIds);
  const acousticLayerNames = useAcousticLayerStore((s) => s.selectedAcousticLayerNames);
  const acousticLayerId = useAcousticLayerStore((s) => s.selectedAcousticLayerId);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const modelFaceCounts = useAcousticLayerStore((s) => s.modelFaceCounts);

  const hasDetectedRef = useRef(false);

  // ── Compute per-geometry mesh-face counts from the viewer BVH (raw Speckle
  // `faces` arrays are emptied during the viewer's tree build). Retry until the
  // renderer has built the batch BVHs for the loaded geometry. ──
  useEffect(() => {
    if (!worldTree) return;

    let cancelled = false;
    let attempts = 0;

    const compute = (): boolean => {
      if (cancelled) return true;
      const viewer = viewerRef.current;
      if (!viewer) return false;
      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = getRootNodesForModel(worldTree, modelFileName);
      if (!rootNodes || rootNodes.length === 0) return false;

      const ids = new Set<string>();
      for (const root of rootNodes) {
        for (const id of getGeometryLeafIdsFromNode(root)) ids.add(id);
      }
      if (ids.size === 0) return false;

      const counts = computeGeometryFaceCounts(viewer, Array.from(ids));
      const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
      if (total === 0 && attempts < 30) return false; // BVHs not built yet — retry
      console.log('[dbg:faces] computed face counts', { ids: counts.size, total, attempts });
      useAcousticLayerStore.getState().setModelFaceCounts(Object.fromEntries(counts));
      return true;
    };

    if (compute()) return;

    const timer = setInterval(() => {
      attempts += 1;
      if (compute() || attempts > 30) clearInterval(timer);
    }, 500);
    return () => { cancelled = true; clearInterval(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, viewerRef]);

  // ── Publish resolved acoustic geometry ids + re-derive visibility ──
  useEffect(() => {
    if (!worldTree) return;

    let unionIds: string[] = [];
    const allModelIds = new Set<string>();

    const modelFileName = useSpeckleStore.getState().modelFileName;
    const rootNodes = getRootNodesForModel(worldTree, modelFileName);
    if (rootNodes && rootNodes.length > 0) {
      // Collect the full model's geometry leaf ids (for hide-based isolation).
      for (const root of rootNodes) {
        for (const id of getGeometryLeafIdsFromNode(root)) allModelIds.add(id);
      }

      if (!isWholeModel && acousticLayerIds.length > 0) {
        const seen = new Set<string>();
        for (let i = 0; i < acousticLayerIds.length; i++) {
          const id = acousticLayerIds[i];
          const name = acousticLayerNames[i] || '';
          // Resolve by id first (covers leaf/child picks and nested nodes), then
          // fall back to name (legacy persisted selections / auto-detect).
          const node = findNodeById(rootNodes, id) ?? (name ? findNodeByName(rootNodes, name) : null);
          if (node) {
            for (const gid of getGeometryLeafIdsFromNode(node)) seen.add(gid);
          } else if (allModelIds.has(id)) {
            // The selected id is itself a geometry leaf not present as a tree row.
            seen.add(id);
          }
        }
        // Safety net: if the stored node ids could not be resolved against the
        // current tree (e.g. a fresh bundle re-materialized with new ids), trust
        // the geometry ids committed alongside them.
        if (seen.size === 0) {
          const committed = useAcousticLayerStore.getState().selectedAcousticGeometryIds;
          for (const id of committed) seen.add(id);
        }
        unionIds = Array.from(seen);
      }
    }

    setAllModelGeometryIds(Array.from(allModelIds));
    setAcousticLayerAllIds(unionIds);
    // Whole model: no geometry-id target (visibility shows everything), but still
    // report the model's total mesh-face complexity.
    const faceCount = isWholeModel
      ? Object.values(modelFaceCounts).reduce((sum, n) => sum + n, 0)
      : unionIds.length > 0
        ? sumFaceCounts(modelFaceCounts, unionIds)
        : 0;
    // Publish the resolved union reactively so ObjectExplorer filtering and the
    // "is a region defined?" checks work for leaf/custom selections.
    useAcousticLayerStore.getState().setResolvedAcousticGeometryIds(unionIds, faceCount);
    useSpeckleStore.getState().applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, acousticLayerIds, acousticLayerNames, isWholeModel, isAcousticMode, modelFaceCounts]);

  // ── Auto-detect / verify persisted selection ──
  useEffect(() => {
    if (!worldTree || !viewerRef.current) return;
    const modelFileName = useSpeckleStore.getState().modelFileName;
    const rootNodes = getRootNodesForModel(worldTree, modelFileName);
    if (!rootNodes || rootNodes.length === 0) return;

    if (acousticLayerIds.length > 0) {
      if (hasDetectedRef.current) return;
      // Verify each persisted node still exists; drop those that don't.
      const validIds: string[] = [];
      const validNames: string[] = [];
      for (let i = 0; i < acousticLayerIds.length; i++) {
        const name = acousticLayerNames[i] || '';
        const node = findNodeById(rootNodes, acousticLayerIds[i]) ?? (name ? findNodeByName(rootNodes, name) : null);
        if (node) {
          validIds.push(acousticLayerIds[i]);
          validNames.push(name);
        }
      }
      if (validIds.length === 0) {
        // Node ids didn't resolve (atomic display-mesh ids are not tree nodes).
        // Keep the persisted selection if its geometry ids still exist in this
        // model; only clear when the model genuinely no longer contains them.
        const modelIds = new Set<string>();
        for (const root of rootNodes) {
          for (const id of getGeometryLeafIdsFromNode(root)) modelIds.add(id);
        }
        const stillValid = useAcousticLayerStore
          .getState()
          .selectedAcousticGeometryIds.some((id) => modelIds.has(id));
        if (!stillValid) {
          console.log('[useAcousticLayerIsolation] Persisted selection no longer exists, clearing');
          useAcousticLayerStore.getState().clearAcousticLayer();
        }
      } else if (validIds.length !== acousticLayerIds.length) {
        useAcousticLayerStore.getState().setAcousticLayers(validIds, validNames, isWholeModel);
      }
      hasDetectedRef.current = true;
      return;
    }

    if (hasDetectedRef.current) return;

    const acousticsNode = findNodeByName(rootNodes, 'Acoustics');
    if (acousticsNode) {
      const geometryIds = getGeometryLeafIdsFromNode(acousticsNode);
      if (geometryIds.length > 0) {
        const name = acousticsNode.raw?.name || 'Acoustics';
        const layerId = acousticsNode.raw?.id || geometryIds[0];
        const onlyLayer = countTopLevelLayers(worldTree) <= 1;
        console.log(
          '[useAcousticLayerIsolation] Auto-detected Acoustics layer:',
          layerId,
          name,
          onlyLayer ? '(only layer — whole model)' : '',
        );
        useAcousticLayerStore.getState().setAcousticSelection({
          nodeIds: [layerId],
          nodeNames: [name],
          geometryIds,
          isWholeModel: onlyLayer,
          autoDetected: true,
        });
      }
    } else {
      // No layer named "Acoustics" — if the model has exactly one top-level layer
      // it IS the whole acoustic model. Auto-define it so acoustic mode does not
      // prompt the user to pick a region.
      const singleLayer = findSingleTopLevelLayer(worldTree);
      if (singleLayer) {
        const name = singleLayer.raw?.name || singleLayer.model?.name;
        const layerId = singleLayer.raw?.id || singleLayer.model?.id;
        const geometryIds = getGeometryLeafIdsFromNode(singleLayer);
        if (name && layerId && geometryIds.length > 0) {
          console.log('[useAcousticLayerIsolation] Single-layer model — auto-defined acoustic region as whole model:', name);
          useAcousticLayerStore.getState().setAcousticSelection({
            nodeIds: [layerId],
            nodeNames: [name],
            geometryIds,
            isWholeModel: true,
            autoDetected: true,
          });
        }
      }
    }
    hasDetectedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, acousticLayerIds]);

  useEffect(() => {
    hasDetectedRef.current = false;
  }, [worldTree]);

  // ── When no acoustic region + entering acoustic mode → open explorer ──
  useEffect(() => {
    if (!isAcousticMode) {
      useUIStore.getState().setAcousticLayerSelectionMode(false);
      return;
    }
    if (acousticLayerId) {
      // A region is defined (possibly restored from persistence just AFTER this
      // hook already opened the selection phase). Exit the phase so the tree
      // shows the region instead of the "Define the acoustic region" prompt.
      if (useUIStore.getState().acousticLayerSelectionMode) {
        useUIStore.getState().setAcousticLayerSelectionMode(false);
      }
      return;
    }

    const checkTree = (): boolean => {
      const v = viewerRef.current;
      if (!v) return false;
      const liveTree = v.getWorldTree();
      if (!liveTree) return false;
      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = getRootNodesForModel(liveTree, modelFileName);
      if (!rootNodes || rootNodes.length === 0) return false;
      if (useAcousticLayerStore.getState().selectedAcousticLayerId) return false;

      // Whole-model (single-layer): auto-define the region instead of prompting.
      const singleLayer = findSingleTopLevelLayer(liveTree);
      if (singleLayer) {
        const name = singleLayer.raw?.name || singleLayer.model?.name;
        const layerId = singleLayer.raw?.id || singleLayer.model?.id;
        const geometryIds = getGeometryLeafIdsFromNode(singleLayer);
        if (name && layerId && geometryIds.length > 0) {
          console.log('[useAcousticLayerIsolation] Acoustic mode + single-layer model — auto-defined whole model:', name);
          useAcousticLayerStore.getState().setAcousticSelection({
            nodeIds: [layerId],
            nodeNames: [name],
            geometryIds,
            isWholeModel: true,
            autoDetected: true,
          });
          return true;
        }
      }

      console.log('[useAcousticLayerIsolation] No acoustic region — entering selection mode');
      useUIStore.getState().setAcousticLayerSelectionMode(true);
      useUIStore.getState().setShowObjectExplorer(true);
      return true;
    };

    if (checkTree()) return;

    const timer = setInterval(() => {
      if (checkTree() || useAcousticLayerStore.getState().selectedAcousticLayerId) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isAcousticMode, acousticLayerId]);
}

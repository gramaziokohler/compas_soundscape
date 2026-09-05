/**
 * Acoustic Layer Isolation Hook
 *
 * Computes the acoustic layer's geometry ids (union across all selected layers)
 * and publishes them to the unified visibility model, then triggers
 * applyVisibility(). All actual hide/isolate is delegated to speckleStore's
 * applyVisibility(), which derives a single FilteringExtension target from the
 * view mode + acoustic layer + user intent (no per-frame re-apply loop).
 *
 * Responsibilities:
 *   - Auto-detect / verify the acoustic layer from the world tree.
 *   - Open ObjectExplorer in selection mode when entering acoustic mode with no
 *     layer defined.
 *   - Publish the acoustic layer geometry id union and re-derive visibility.
 *
 * Runs inside SpeckleScene.
 */

import { useEffect, useRef } from 'react';
import type React from 'react';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { getRootNodesForModel, getGeometryLeafIdsFromNode, countTopLevelLayers, findSingleTopLevelLayer } from '@/hooks/useSpeckleTree';
import { setAcousticLayerAllIds, setAllModelGeometryIds } from '@/store/speckleStore';

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

export function useAcousticLayerIsolation(
  viewerRef: React.RefObject<any>,
  worldTree: any,
  viewMode: string,
) {
  const isAcousticMode = viewMode === 'acoustic';
  const acousticLayerIds = useAcousticLayerStore((s) => s.selectedAcousticLayerIds);
  const acousticLayerNames = useAcousticLayerStore((s) => s.selectedAcousticLayerNames);
  const acousticLayerId = useAcousticLayerStore((s) => s.selectedAcousticLayerId);
  const acousticLayerName = useAcousticLayerStore((s) => s.selectedAcousticLayerName);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);

  const hasDetectedRef = useRef(false);

  // ── Publish acoustic layer geometry ids + re-derive visibility ──
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

      if (!isWholeModel && acousticLayerNames.length > 0) {
        const seen = new Set<string>();
        for (const name of acousticLayerNames) {
          const node = findNodeByName(rootNodes, name);
          if (!node) continue;
          const ids = getGeometryLeafIdsFromNode(node);
          for (const id of ids) seen.add(id);
        }
        // Fall back to raw layer ids when no geometry leaves were resolved.
        if (seen.size === 0 && acousticLayerIds.length > 0) {
          for (const id of acousticLayerIds) seen.add(id);
        }
        unionIds = Array.from(seen);
      }
    }

    setAllModelGeometryIds(Array.from(allModelIds));
    setAcousticLayerAllIds(unionIds);
    useSpeckleStore.getState().applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, acousticLayerIds, acousticLayerNames, isWholeModel, isAcousticMode]);

  // ── Auto-detect / verify persisted layer ──
  useEffect(() => {
    if (!worldTree || !viewerRef.current) return;
    const modelFileName = useSpeckleStore.getState().modelFileName;
    const rootNodes = getRootNodesForModel(worldTree, modelFileName);
    if (!rootNodes || rootNodes.length === 0) return;

    if (acousticLayerIds.length > 0) {
      if (hasDetectedRef.current) return;
      // Verify each persisted layer still exists; drop those that don't.
      const validIds: string[] = [];
      const validNames: string[] = [];
      for (let i = 0; i < acousticLayerIds.length; i++) {
        const name = acousticLayerNames[i] || '';
        const node = name ? findNodeByName(rootNodes, name) : null;
        if (node) {
          validIds.push(acousticLayerIds[i]);
          validNames.push(name);
        }
      }
      if (validIds.length === 0) {
        console.log('[useAcousticLayerIsolation] Persisted layer(s) no longer exist, clearing');
        useAcousticLayerStore.getState().clearAcousticLayer();
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
        useAcousticLayerStore.getState().setAcousticLayer(layerId, name, onlyLayer);
      }
    } else {
      // No layer named "Acoustics" — if the model has exactly one top-level layer
      // it IS the whole acoustic model. Auto-define it so acoustic mode does not
      // prompt the user to pick a layer.
      const singleLayer = findSingleTopLevelLayer(worldTree);
      if (singleLayer) {
        const name = singleLayer.raw?.name || singleLayer.model?.name;
        const layerId = singleLayer.raw?.id || singleLayer.model?.id;
        const geometryIds = getGeometryLeafIdsFromNode(singleLayer);
        if (name && layerId && geometryIds.length > 0) {
          console.log('[useAcousticLayerIsolation] Single-layer model — auto-defined acoustic layer as whole model:', name);
          useAcousticLayerStore.getState().setAcousticLayer(layerId, name, true);
        }
      }
    }
    hasDetectedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldTree, acousticLayerIds]);

  useEffect(() => {
    hasDetectedRef.current = false;
  }, [worldTree]);

  // ── When no acoustic layer + entering acoustic mode → open explorer ──
  useEffect(() => {
    if (!isAcousticMode) {
      useUIStore.getState().setAcousticLayerSelectionMode(false);
      return;
    }
    if (acousticLayerId) return;

    const checkTree = (): boolean => {
      const v = viewerRef.current;
      if (!v) return false;
      const liveTree = v.getWorldTree();
      if (!liveTree) return false;
      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = getRootNodesForModel(liveTree, modelFileName);
      if (!rootNodes || rootNodes.length === 0) return false;
      if (useAcousticLayerStore.getState().selectedAcousticLayerId) return false;

      // Whole-model (single-layer): auto-define the layer instead of prompting.
      const singleLayer = findSingleTopLevelLayer(liveTree);
      if (singleLayer) {
        const name = singleLayer.raw?.name || singleLayer.model?.name;
        const layerId = singleLayer.raw?.id || singleLayer.model?.id;
        const geometryIds = getGeometryLeafIdsFromNode(singleLayer);
        if (name && layerId && geometryIds.length > 0) {
          console.log('[useAcousticLayerIsolation] Acoustic mode + single-layer model — auto-defined whole model:', name);
          useAcousticLayerStore.getState().setAcousticLayer(layerId, name, true);
          return true;
        }
      }

      console.log('[useAcousticLayerIsolation] No acoustic layer — entering selection mode');
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

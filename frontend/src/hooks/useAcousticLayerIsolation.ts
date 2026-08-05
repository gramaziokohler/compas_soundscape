/**
 * Acoustic Layer Isolation Hook
 *
 * Manages the top-level acoustic layer isolation in the Speckle viewer.
 *
 * When viewMode is 'acoustic':
 *   - Shows then isolates the acoustic layer (stateKey='acoustic-materials')
 *   - If whole model: skips isolation (no difference between modes)
 *   - If no layer: opens ObjectExplorer in selection mode
 *
 * When viewMode is NOT 'acoustic':
 *   - Un-isolates then hides acoustic layer objects (hide AFTER un-isolate)
 *
 * Section 5 maintains both isolation (acoustic) and hide (default) state
 * against external filter resets (ObjectExplorer reset button, etc.).
 *
 * Runs inside SpeckleScene.
 */

import { useEffect, useRef, useCallback } from 'react';
import { FilteringExtension } from '@speckle/viewer';
import type React from 'react';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { getRootNodesForModel, getGeometryLeafIdsFromNode, countTopLevelLayers, findSingleTopLevelLayer } from '@/hooks/useSpeckleTree';
import { setPostIsolateHideIds, setAcousticLayerAllIds, getAcousticExplorerHiddenIds, clearAcousticExplorerHiddenIds } from '@/store/speckleStore';

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
  const acousticLayerId = useAcousticLayerStore((s) => s.selectedAcousticLayerId);
  const acousticLayerName = useAcousticLayerStore((s) => s.selectedAcousticLayerName);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);

  const ourIsolatedIdsRef = useRef<string[]>([]);
  const hiddenGeometryIdsRef = useRef<string[]>([]);
  const hasDetectedRef = useRef(false);

  const getFilteringExt = useCallback((): FilteringExtension | null => {
    const v = viewerRef.current;
    if (!v) return null;
    try { return v.getExtension(FilteringExtension); } catch { return null; }
  }, [viewerRef]);

  // ── 1. Show acoustic layer objects when entering acoustic mode ──
  useEffect(() => {
    if (!worldTree) return;
    if (!isAcousticMode) return;

    const ext = getFilteringExt();
    if (!ext) {
      const timer = setTimeout(() => {
        const ext2 = getFilteringExt();
        if (ext2) showLayer(ext2);
      }, 500);
      return () => clearTimeout(timer);
    }

    showLayer(ext);

    function showLayer(ext: FilteringExtension) {
      const layerName = acousticLayerName || useAcousticLayerStore.getState().selectedAcousticLayerName;
      if (!layerName) return;
      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = getRootNodesForModel(worldTree, modelFileName);
      if (!rootNodes || rootNodes.length === 0) return;
      const node = findNodeByName(rootNodes, layerName);
      if (!node) return;
      const geometryIds = getGeometryLeafIdsFromNode(node);
      if (geometryIds.length === 0) return;

      console.log('[useAcousticLayerIsolation] Showing acoustic layer objects before isolation, count=', geometryIds.length);
      ext.showObjects(geometryIds, 'acoustic-materials', true);
      viewerRef.current?.requestRender();
      useSpeckleStore.getState().trackExplorerShow(geometryIds, 'acoustic-materials');
    }
  }, [isAcousticMode, worldTree, acousticLayerName, getFilteringExt]);

  // ── 1b. Hide acoustic layer objects on initial load in default mode ──
  useEffect(() => {
    if (!worldTree) return;
    if (isAcousticMode) return;
    if (isWholeModel) return;
    if (!acousticLayerName) return;
    // Only apply the initial hide once (hiddenGeometryIdsRef is empty until
    // removeIsolation or this effect sets it).
    if (hiddenGeometryIdsRef.current.length > 0) return;

    const ext = getFilteringExt();
    if (!ext) {
      const timer = setTimeout(() => {
        const ext2 = getFilteringExt();
        if (ext2) hideLayer(ext2);
      }, 500);
      return () => clearTimeout(timer);
    }

    hideLayer(ext);

    function hideLayer(ext: FilteringExtension) {
      const layerName = acousticLayerName || useAcousticLayerStore.getState().selectedAcousticLayerName;
      if (!layerName) return;
      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = getRootNodesForModel(worldTree, modelFileName);
      if (!rootNodes || rootNodes.length === 0) return;
      const node = findNodeByName(rootNodes, layerName);
      if (!node) return;
      const geometryIds = getGeometryLeafIdsFromNode(node);
      if (geometryIds.length === 0) return;

      console.log('[useAcousticLayerIsolation] Initial hide in default mode, count=', geometryIds.length);
      ext.hideObjects(geometryIds, 'acoustic-materials', true, false);
      viewerRef.current?.requestRender();
      useSpeckleStore.getState().trackExplorerHide(geometryIds, 'acoustic-materials');
      hiddenGeometryIdsRef.current = geometryIds;
      setPostIsolateHideIds(geometryIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAcousticMode, worldTree, acousticLayerName, isWholeModel]);

  // ── 2. Auto-detect / verify persisted layer ──
  useEffect(() => {
    if (!worldTree || !viewerRef.current) return;
    const modelFileName = useSpeckleStore.getState().modelFileName;
    const rootNodes = getRootNodesForModel(worldTree, modelFileName);
    if (!rootNodes || rootNodes.length === 0) return;

    if (acousticLayerId) {
      if (hasDetectedRef.current) return;
      const layerName = acousticLayerName || useAcousticLayerStore.getState().selectedAcousticLayerName;
      const node = layerName ? findNodeByName(rootNodes, layerName) : null;
      if (node) {
        hasDetectedRef.current = true;
        return;
      }
      console.log('[useAcousticLayerIsolation] Persisted layer no longer exists, clearing');
      useAcousticLayerStore.getState().clearAcousticLayer();
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
  }, [worldTree, acousticLayerId]);

  useEffect(() => {
    hasDetectedRef.current = false;
  }, [worldTree]);

  // ── 3. Main isolation / un-isolation + hide ──
  useEffect(() => {
    const ext = getFilteringExt();
    if (!ext) {
      const timer = setTimeout(() => {
        const ext2 = getFilteringExt();
        if (ext2 && isAcousticMode) {
          if (acousticLayerId) {
            applyIsolation(ext2);
          } else if (ourIsolatedIdsRef.current.length > 0) {
            removeIsolation(ext2);
          }
        }
      }, 500);
      return () => clearTimeout(timer);
    }

    if (isAcousticMode && acousticLayerId) {
      applyIsolation(ext);
    } else if ((!isAcousticMode || !acousticLayerId) && ourIsolatedIdsRef.current.length > 0) {
      // Either left acoustic mode, or layer was cleared (Re-assign button) — remove old isolation.
      removeIsolation(ext);
    }

    function applyIsolation(ext: FilteringExtension) {
      if (isWholeModel) {
        console.log('[useAcousticLayerIsolation] Whole model — skipping isolation');
        if (ourIsolatedIdsRef.current.length > 0) {
          ext.unIsolateObjects(ourIsolatedIdsRef.current, 'acoustic-materials', true, false);
          useSpeckleStore.getState().clearExplorerIsolation('acoustic-materials');
          ourIsolatedIdsRef.current = [];
        }
        hiddenGeometryIdsRef.current = [];
        setPostIsolateHideIds(null);
        useUIStore.getState().setAcousticLayerSelectionMode(false);
        return;
      }

      const modelFileName = useSpeckleStore.getState().modelFileName;
      const rootNodes = worldTree ? getRootNodesForModel(worldTree, modelFileName) : [];
      const layerName = acousticLayerName || useAcousticLayerStore.getState().selectedAcousticLayerName;
      const node = rootNodes.length > 0 && layerName ? findNodeByName(rootNodes, layerName) : null;
      const layerId: string = acousticLayerId!;
      const geometryIds = node ? getGeometryLeafIdsFromNode(node) : [layerId];
      const allIds: string[] = [...new Set(geometryIds)];
      if (allIds.length === 0) return;

      // Store full set for the ObjectExplorer to reference when toggling hides
      setAcousticLayerAllIds(allIds);

      // Clear any previously explorer-hidden IDs when the layer changes
      if (ourIsolatedIdsRef.current.length > 0 &&
          !ourIsolatedIdsRef.current.every((id) => allIds.includes(id))) {
        clearAcousticExplorerHiddenIds();
        useSpeckleStore.getState().clearAcousticExplorerHiddenIds();
      }

      // Filter out IDs the user has hidden via the ObjectExplorer's hide button
      const hiddenSet = getAcousticExplorerHiddenIds();
      const filteredIds = allIds.filter((id) => !hiddenSet.has(id));

      console.log('[useAcousticLayerIsolation] Isolating acoustic layer:', allIds.length, 'objects, filtered to', filteredIds.length, 'after explorer hides');
      ext.isolateObjects(filteredIds, 'acoustic-materials', true, true);
      viewerRef.current?.requestRender();
      ourIsolatedIdsRef.current = allIds;
      hiddenGeometryIdsRef.current = [];
      setPostIsolateHideIds(null);

      useSpeckleStore.getState().trackExplorerIsolate(allIds, 'acoustic-materials');
      useUIStore.getState().setAcousticLayerSelectionMode(false);
    }

    function removeIsolation(ext: FilteringExtension) {
      const stateKey = 'acoustic-materials';
      console.log('[useAcousticLayerIsolation] Removing isolation, count=', ourIsolatedIdsRef.current.length);

      ext.unIsolateObjects(ourIsolatedIdsRef.current, stateKey, true, false);
      viewerRef.current?.requestRender();
      useSpeckleStore.getState().clearExplorerIsolation(stateKey);

      const layerName = useAcousticLayerStore.getState().selectedAcousticLayerName;
      if (layerName && worldTree) {
        const modelFileName = useSpeckleStore.getState().modelFileName;
        const rootNodes = getRootNodesForModel(worldTree, modelFileName);
        if (rootNodes && rootNodes.length > 0) {
          const node = findNodeByName(rootNodes, layerName);
          if (node) {
            const geometryIds = getGeometryLeafIdsFromNode(node);
            if (geometryIds.length > 0) {
              console.log('[useAcousticLayerIsolation] Hiding after un-isolate, count=', geometryIds.length);
              ext.hideObjects(geometryIds, stateKey, true, false);
              viewerRef.current?.requestRender();
              useSpeckleStore.getState().trackExplorerHide(geometryIds, stateKey);
              hiddenGeometryIdsRef.current = geometryIds;
              setPostIsolateHideIds(geometryIds);
            }
          }
        }
      }

      ourIsolatedIdsRef.current = [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAcousticMode, acousticLayerId, worldTree, isWholeModel]);

  // ── 4. When no acoustic layer + entering acoustic mode → open explorer ──
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

  // ── 5. Re-apply isolation + hide state after external filter resets ──
  // Uses requestAnimationFrame so corrections land before the next paint,
  // avoiding the visible 1s flash that setInterval would cause.
  useEffect(() => {
    let rafId: number;
    const reapply = () => {
      const ext = getFilteringExt();
      if (!ext) {
        rafId = requestAnimationFrame(reapply);
        return;
      }

      if (isAcousticMode && ourIsolatedIdsRef.current.length > 0) {
        // Acoustic mode: maintain isolation
        const currentIsolated = ext.filteringState?.isolatedObjects ?? [];
        const tracked = useSpeckleStore.getState().getExplorerIsolatedIds('acoustic-materials');
        const shouldBeIsolated = tracked && tracked.length > 0 ? tracked : ourIsolatedIdsRef.current;

        // Filter out IDs hidden via the ObjectExplorer's hide button in acoustic mode
        const hiddenSet = getAcousticExplorerHiddenIds();
        const filteredShouldBeIsolated = shouldBeIsolated.filter((id: string) => !hiddenSet.has(id));

        if (
          filteredShouldBeIsolated.length > 0 &&
          !filteredShouldBeIsolated.every((id: string) => currentIsolated.includes(id))
        ) {
          ext.isolateObjects(filteredShouldBeIsolated, 'acoustic-materials', true, true);
          viewerRef.current?.requestRender();
          ourIsolatedIdsRef.current = shouldBeIsolated; // keep full set for reference
        }
      } else if (!isAcousticMode && hiddenGeometryIdsRef.current.length > 0) {
        // Default mode: maintain acoustic layer hide state.
        // When the ObjectExplorer has active isolation (explorer-default key),
        // skip re-hiding because ext.hideObjects clears the isolate state.
        // The acoustic objects appear ghosted alongside other non-isolated
        // objects — correct behavior when isolation is active. When the
        // user un-isolates, the next rAF cycle will re-hide them.
        const explorerIsolated = useSpeckleStore.getState().getExplorerIsolatedIds('explorer-default');
        if (explorerIsolated && explorerIsolated.length > 0) return;
        
        const currentHidden = ext.filteringState?.hiddenObjects ?? [];
        const currentIsolated = ext.filteringState?.isolatedObjects ?? [];
        const shouldBeHidden = hiddenGeometryIdsRef.current.filter(
          (id: string) => !currentIsolated.includes(id),
        );
        if (shouldBeHidden.length === 0) return;
        const allStillHidden = shouldBeHidden.every((id: string) => currentHidden.includes(id));
        if (!allStillHidden) {
          console.log('[useAcousticLayerIsolation] Hide lost in default mode, re-hiding (', shouldBeHidden.length, 'objs)');
          ext.hideObjects(shouldBeHidden, 'acoustic-materials', true, false);
          viewerRef.current?.requestRender();
          useSpeckleStore.getState().trackExplorerHide(shouldBeHidden, 'acoustic-materials');
        }
      }

      rafId = requestAnimationFrame(reapply);
    };

    rafId = requestAnimationFrame(reapply);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isAcousticMode, getFilteringExt]);
}

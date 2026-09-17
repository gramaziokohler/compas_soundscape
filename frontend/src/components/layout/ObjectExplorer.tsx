'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { VirtualTreeItem } from '@/components/scene/VirtualTreeItem';
import { useSpeckleTree, getRootNodesForModel, getGeometryLeafIdsFromNode, getHeaderAndSubheader, countTopLevelLayers } from '@/hooks/useSpeckleTree';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleInteractions } from '@/hooks/useSpeckleInteractions';
import { useObjectSelectionPhase } from '@/hooks/useObjectSelectionPhase';
import { useSpeckleStore, useAcousticLayerStore, useUIStore, useAcousticMaterialStore } from '@/store';
import { setSelectionPreviewIds } from '@/store/speckleStore';
import type { VirtualTreeItem as TreeItem } from '@/hooks/useSpeckleTree';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import type { MaterialOption } from '@/components/ui/MaterialSelect';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';
import { EmptyState } from '@/components/ui/EmptyState';
import { HelperHint } from '@/components/ui/HelperHint';

/**
 * ObjectExplorer Component
 *
 * Displays a hierarchical tree view of objects from the Speckle viewer.
 * Supports selection, visibility control, isolation, and filtering.
 *
 * When the acoustic-region selection phase is active, every row (layer AND
 * child object) renders a tri-state checkbox. Clicks in the tree or the 3D
 * viewer (single click, shift-click, box-drag) additively build the region;
 * the union of the picked geometry surfaces is previewed live in the viewer.
 */

interface ObjectExplorerProps {
  resetAllRef?: React.MutableRefObject<(() => void) | null>;
  maxTreeHeight?: number;
}

export function ObjectExplorer({ resetAllRef, maxTreeHeight }: ObjectExplorerProps = {}) {
  const { modelFileName, worldTreeVersion, getViewerRef, setSelectedEntity, setSelectedObjectIds: storeSetSelectedObjectIds } = useSpeckleStore();
  const storeSelectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);
  const viewMode = useSpeckleStore((s) => s.viewMode);
  const selectedAcousticLayerNames = useAcousticLayerStore((s) => s.selectedAcousticLayerNames);
  const selectedAcousticLayerIds = useAcousticLayerStore((s) => s.selectedAcousticLayerIds);
  const selectedAcousticGeometryIds = useAcousticLayerStore((s) => s.selectedAcousticGeometryIds);
  const modelFaceCounts = useAcousticLayerStore((s) => s.modelFaceCounts);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const setAcousticSelection = useAcousticLayerStore((s) => s.setAcousticSelection);
  const acousticLayerSelectionMode = useUIStore((s) => s.acousticLayerSelectionMode);
  const acousticExplorerHiddenIds = useSpeckleStore((s) => s.acousticExplorerHiddenIds);
  const isAcousticMode = viewMode === 'acoustic';
  const hasDefinedLayer = selectedAcousticLayerIds.length > 0;
  const phase = isAcousticMode && acousticLayerSelectionMode;
  // Stable RefObject-like shim so hooks that expect RefObject<Viewer> keep working
  const viewerRef = useMemo<React.RefObject<any>>(() => ({
    get current() { return getViewerRef(); }
  }), [getViewerRef]);
  
  // World tree state
  const [worldTree, setWorldTree] = useState<any>(null);
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(0);
  const worldTreeRef = useRef<any>(null);
  const hasLoadedTreeRef = useRef<boolean>(false);
  
  // Scroll synchronization state
  const [disableScrollOnNextSelection, setDisableScrollOnNextSelection] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const pendingScrollIdRef = useRef<string | null>(null);
  const virtualItemsRef = useRef<typeof virtualItems>([]);

  // ── Acoustic-region draft (selection phase) ──────────────────────────────
  // Canonical draft = the set of geometry leaf ids picked so far. Viewer
  // selection feeds it; tree checkboxes toggle it. `draftVersion` forces the
  // checkbox/preview re-render (the ref itself is non-reactive for perf).
  const draftLeafIdsRef = useRef<Set<string>>(new Set());
  const [draftVersion, setDraftVersion] = useState(0);
  const lastDraftSyncRef = useRef<string>('[]');
  
  // Initialize tree management hooks
  const {
    rootNodes = [],
    virtualItems = [],
    expandedNodes,
    selectedObjectIds,
    toggleNodeExpansion,
    setSelection,
    clearSelection,
    collapseToRoot,
    expandToShowObject
  } = useSpeckleTree(worldTree, treeUpdateTrigger, modelFileName) || {
    rootNodes: [],
    virtualItems: [],
    expandedNodes: new Set(),
    selectedObjectIds: [],
    toggleNodeExpansion: () => {},
    setSelection: () => {},
    clearSelection: () => {},
    collapseToRoot: () => {},
    expandToShowObject: () => {}
  };
  
  // Initialize filtering hooks
  const {
    hiddenObjects,
    isolatedObjects,
    hideObjects,
    showObjects,
    isolateObjects,
    unIsolateObjects,
    areObjectsHidden,
    areObjectsIsolated,
    clearFilters
  } = useSpeckleFiltering(viewerRef);
  
  // Initialize interaction hooks
  const {
    highlightObjects,
    unhighlightObjects,
    zoomToObjects,
    selectObjects,
    clearSelection: clearViewerSelection
  } = useSpeckleInteractions(viewerRef);

  const hasIsolatedObjectsInGeneral = isolatedObjects.size > 0;

  // All model geometry leaf ids (denominator for "N of M surfaces" + whole-model check)
  // and per-object mesh-face counts (from the viewer BVH, published by
  // useAcousticLayerIsolation since raw Speckle `faces` are emptied on load).
  const allModelGeometryIds = useMemo(() => {
    const s = new Set<string>();
    for (const node of rootNodes) {
      for (const id of getGeometryLeafIdsFromNode(node)) s.add(id);
    }
    return s;
  }, [rootNodes]);

  // Number of top-level selectable layers — multi-layer models start collapsed
  // after an acoustic region is assigned (see effect below).
  const topLevelLayerCount = useMemo(() => countTopLevelLayers(worldTree), [worldTree]);

  const totalFaceCount = useMemo(
    () => Object.values(modelFaceCounts).reduce((sum, n) => sum + n, 0),
    [modelFaceCounts],
  );

  const selectedFaceCount = useMemo(() => {
    let sum = 0;
    draftLeafIdsRef.current.forEach((id) => { sum += modelFaceCounts[id] ?? 0; });
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftVersion, modelFaceCounts]);

  // Reactive checkbox state (leaf id → selected).
  const selectedLeafSet = useMemo(
    () => new Set(draftLeafIdsRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftVersion],
  );

  // Sync the draft into the canonical store selection + 3D highlight.
  const syncDraftToViewer = useCallback(() => {
    const next = Array.from(draftLeafIdsRef.current);
    lastDraftSyncRef.current = JSON.stringify([...next].sort());
    setDraftVersion((v) => v + 1);
    setDisableScrollOnNextSelection(true);
    storeSetSelectedObjectIds(next);
    if (next.length === 0) {
      clearViewerSelection();
    } else {
      selectObjects(next);
    }
  }, [storeSetSelectedObjectIds, clearViewerSelection, selectObjects]);

  // Wrapper that also clears draft tracking + selection mode
  const clearAll = useCallback(() => {
    clearFilters();
    clearSelection();
    draftLeafIdsRef.current = new Set();
    setDraftVersion((v) => v + 1);
    setSelectionPreviewIds(null);
    useUIStore.getState().setAcousticLayerSelectionMode(false);
  }, [clearFilters, clearSelection]);

  // ── Selection phase lifecycle ────────────────────────────────────────────
  // Start-of-phase: reset the draft (a fresh pick, including "Re-assign").
  useEffect(() => {
    if (!phase) return;
    draftLeafIdsRef.current = new Set();
    lastDraftSyncRef.current = JSON.stringify([]);
    setDraftVersion((v) => v + 1);
    setSelectionPreviewIds(null);
    useSpeckleStore.getState().applyVisibility();
    useSpeckleStore.getState().clearViewerSelection();
    clearSelection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Viewer → draft (additive): every geometry id the viewer selects is added.
  useEffect(() => {
    if (!phase) return;
    const incoming = storeSelectedObjectIds;
    const key = JSON.stringify([...incoming].sort());
    if (key === lastDraftSyncRef.current) return;
    let changed = false;
    for (const id of incoming) {
      if (!draftLeafIdsRef.current.has(id)) {
        draftLeafIdsRef.current.add(id);
        changed = true;
      }
    }
    if (changed) setDraftVersion((v) => v + 1);
  }, [storeSelectedObjectIds, phase]);

  // Draft → live preview (hide everything outside the picked union).
  useEffect(() => {
    if (!phase) return;
    const union = Array.from(draftLeafIdsRef.current);
    setSelectionPreviewIds(union.length > 0 ? union : null);
    useSpeckleStore.getState().applyVisibility();
  }, [draftVersion, phase]);

  // ── Filtering (view-mode dependent) ──────────────────────────────────────
  // Exclude the "Soundscape" layer. With a defined region: in acoustic mode show
  // only rows whose geometry intersects the region; elsewhere hide those rows.
  // During the selection phase (or no region / whole model) show everything.
  const filteredVirtualItems = useMemo(() => {
    let soundscapeSkipIndent: number | null = null;
    const acousticSet = new Set(isWholeModel ? [] : selectedAcousticGeometryIds);

    return virtualItems.filter(item => {
      // ── Always filter out Soundscape ──
      if (soundscapeSkipIndent !== null) {
        if (item.indent > soundscapeSkipIndent) return false;
        soundscapeSkipIndent = null;
      }
      if (item.data.raw?.name === 'Soundscape') {
        soundscapeSkipIndent = item.indent;
        return false;
      }

      // ── ViewMode-dependent acoustic filtering ──
      if (phase || isWholeModel || acousticSet.size === 0) return true;

      const leaves = getGeometryLeafIdsFromNode(item.data);
      const intersects = leaves.some((id) => acousticSet.has(id));
      return isAcousticMode ? intersects : !intersects;
    });
  }, [virtualItems, isAcousticMode, selectedAcousticGeometryIds, isWholeModel, phase]);

  // Expose reset-all function to parent panel
  useEffect(() => {
    if (resetAllRef) {
      resetAllRef.current = clearAll;
    }
    return () => {
      if (resetAllRef) resetAllRef.current = null;
    };
  }, [resetAllRef, clearAll]);

  // Trigger tree fetch when viewer/world tree becomes available
  useEffect(() => {
    if (!viewerRef?.current) return;

    hasLoadedTreeRef.current = false;

    const attemptTreeLoad = () => {
      if (!viewerRef.current) return false;

      const tree = viewerRef.current.getWorldTree();
      if (tree) {
        const rootNodes = getRootNodesForModel(tree, modelFileName);

        if (rootNodes && rootNodes.length > 0) {
          hasLoadedTreeRef.current = true;
          worldTreeRef.current = tree;
          setWorldTree(tree);
          setTreeUpdateTrigger(prev => prev + 1);
          return true;
        }
      }
      return false;
    };

    if (attemptTreeLoad()) return;

    const timeouts: NodeJS.Timeout[] = [];
    const delays = [500, 1000, 1500, 2000, 2500, 3000];

    delays.forEach(delay => {
      const timeout = setTimeout(() => {
        if (!hasLoadedTreeRef.current) {
          attemptTreeLoad();
        }
      }, delay);
      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [viewerRef, worldTreeVersion, modelFileName]);
  
  // Poll for world tree updates from viewer
  useEffect(() => {
    if (!viewerRef?.current) return;

    const interval = setInterval(() => {
      try {
        if (!viewerRef.current) return;

        const tree = viewerRef.current.getWorldTree();
        if (!tree) return;

        const rootNodes = getRootNodesForModel(tree, modelFileName);
        const hasValidTree = rootNodes && rootNodes.length > 0;

        if (!hasValidTree) return;

        if (!hasLoadedTreeRef.current) {
          hasLoadedTreeRef.current = true;
        }

        const treeChanged = tree !== worldTreeRef.current;

        if (treeChanged) {
          worldTreeRef.current = tree;
          setWorldTree(tree);
          setTreeUpdateTrigger(prev => prev + 1);
        }
      } catch (error) {
        console.error('[ObjectExplorer] Error polling tree:', error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [viewerRef]);
  
  // Manual refresh function
  const refreshTree = useCallback(() => {
    if (!viewerRef?.current) return;

    try {
      const tree = viewerRef.current.getWorldTree();
      if (!tree) return;

      const rootNodes = getRootNodesForModel(tree, modelFileName);

      if (rootNodes && rootNodes.length > 0) {
        hasLoadedTreeRef.current = true;
        worldTreeRef.current = tree;
        setWorldTree({ ...tree });
        setTreeUpdateTrigger(prev => prev + 1);
      }
    } catch (error) {
      console.error('[ObjectExplorer] Error refreshing tree:', error);
    }
  }, [viewerRef, modelFileName]);
  
  // Keep virtualItemsRef in sync so scroll helpers always read the latest list
  useEffect(() => { virtualItemsRef.current = virtualItems; }, [virtualItems]);

  // Core scroll helper — reads fresh data via refs, returns true on success
  const doScrollToItem = useCallback((objectId: string): boolean => {
    const container = treeContainerRef.current;
    if (!container || container.clientHeight === 0) return false;

    const itemIndex = virtualItemsRef.current.findIndex(
      (item) => item.data.raw?.id === objectId
    );
    if (itemIndex === -1) return false; // not in view yet (expansion pending)

    const itemHeight = UI_RIGHT_SIDEBAR.TREE_ITEM_HEIGHT;
    const containerHeight = container.clientHeight;
    const totalOffset = itemIndex * itemHeight;
    const centerOffset = containerHeight / 2 - itemHeight / 2;

    container.scrollTo({
      top: Math.max(0, totalOffset - centerOffset),
      behavior: 'smooth'
    });
    return true;
  }, []);

  // Public entry point — sets pending then tries immediately via rAF
  const scrollToSelectedItem = useCallback((objectId: string) => {
    pendingScrollIdRef.current = objectId;

    requestAnimationFrame(() => {
      if (!pendingScrollIdRef.current) return;
      const success = doScrollToItem(objectId);
      if (success) pendingScrollIdRef.current = null;
      // else: pending stays — virtualItems effect or ResizeObserver will retry
    });
  }, [doScrollToItem]);

  // Retry when virtualItems updates (covers expansion-before-scroll race)
  useEffect(() => {
    if (!pendingScrollIdRef.current) return;
    const success = doScrollToItem(pendingScrollIdRef.current);
    if (success) pendingScrollIdRef.current = null;
  }, [virtualItems, doScrollToItem]);

  // Retry when the tree container gains height (sidebar expands from collapsed state)
  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (!pendingScrollIdRef.current || container.clientHeight === 0) return;
      const success = doScrollToItem(pendingScrollIdRef.current);
      if (success) pendingScrollIdRef.current = null;
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [filteredVirtualItems.length, doScrollToItem]);
  
  // ===== Viewer → Explorer selection sync =====
  const resolveSelectionRowIds = useCallback((ids: string[]): string[] => {
    const items = virtualItemsRef.current;
    const resolved = new Set<string>();

    for (const id of ids) {
      let bestNodeId: string | null = null;
      let bestIndent = -1;
      let bestOrder = -1;
      for (let order = 0; order < items.length; order++) {
        const item = items[order];
        const nodeId = item.data.raw?.id || item.data.model?.id || item.data.id;
        const indent = item.indent ?? 0;
        const exact = nodeId === id;
        const contains = !exact && getGeometryLeafIdsFromNode(item.data).includes(id);
        if (!exact && !contains) continue;
        if (bestNodeId === null || indent > bestIndent || (indent === bestIndent && order > bestOrder)) {
          bestNodeId = nodeId;
          bestIndent = indent;
          bestOrder = order;
        }
      }
      if (bestNodeId) resolved.add(bestNodeId);
    }
    return Array.from(resolved);
  }, []);

  const prevStoreSelectionRef = useRef<string[]>([]);
  const pendingRevealRef = useRef<string[] | null>(null);

  useEffect(() => {
    const storeIds = storeSelectedObjectIds;
    const prev = prevStoreSelectionRef.current;
    prevStoreSelectionRef.current = storeIds;

    // The viewer → explorer mirror (reveal / expand / scroll / highlight) runs in
    // Default mode and in Acoustic mode whenever the region-selection phase is NOT
    // active (during that phase the viewer feeds the draft via the effect above and
    // the tree rows use checkboxes instead of a highlight).
    const mirrorEnabled = viewMode === 'default'
      || (viewMode === 'acoustic' && !acousticLayerSelectionMode);
    if (!mirrorEnabled) {
      pendingRevealRef.current = null;
      setDisableScrollOnNextSelection(false);
      return;
    }

    if (disableScrollOnNextSelection) {
      pendingRevealRef.current = null;
      setDisableScrollOnNextSelection(false);
      return;
    }

    if (storeIds.length === 0) {
      pendingRevealRef.current = null;
      if (prev.length > 0) clearSelection();
      return;
    }

    pendingRevealRef.current = storeIds;
    for (const id of storeIds) {
      expandToShowObject(id);
    }
  }, [viewMode, acousticLayerSelectionMode, storeSelectedObjectIds, disableScrollOnNextSelection, expandToShowObject, clearSelection]);

  useEffect(() => {
    const ids = pendingRevealRef.current;
    if (!ids) return;

    const mirrorEnabled = viewMode === 'default'
      || (viewMode === 'acoustic' && !acousticLayerSelectionMode);
    if (!mirrorEnabled) {
      pendingRevealRef.current = null;
      return;
    }

    const targetIds = resolveSelectionRowIds(ids);
    if (targetIds.length === 0) {
      pendingRevealRef.current = null;
      clearSelection();
      return;
    }
    pendingRevealRef.current = null;
    setSelection(targetIds);
    scrollToSelectedItem(targetIds[targetIds.length - 1]);
  }, [viewMode, acousticLayerSelectionMode, virtualItems, resolveSelectionRowIds, setSelection, scrollToSelectedItem, clearSelection]);
  
  // ===== Auto-expand/scroll to acoustic material layer =====
  const expandToLayerId = useAcousticMaterialStore((s) => s.expandToLayerId);
  const isAcousticMaterialActive = useAcousticMaterialStore((s) => s.isActive);
  const acousticCardType = useAcousticMaterialStore((s) => s.cardType);
  const acousticMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const lastProcessedLayerIdRef = useRef<string | null>(null);

  const sortedMaterials = useMemo<MaterialOption[]>(() => {
    if (!isAcousticMaterialActive) return [];
    return [...acousticMaterials]
      .filter((m: any) => typeof m.absorption === 'number' && !isNaN(m.absorption))
      .sort((a: any, b: any) => a.absorption - b.absorption);
  }, [isAcousticMaterialActive, acousticMaterials]);

  const materialColors = useMemo(() => {
    const colors = new Map<string, string>();
    if (isAcousticMaterialActive) {
      acousticMaterials.forEach((m: any) => colors.set(m.id, getMaterialColorByAbsorption(m.absorption)));
    }
    return colors;
  }, [isAcousticMaterialActive, acousticMaterials]);

  useEffect(() => {
    if (!expandToLayerId || !isAcousticMaterialActive) {
      lastProcessedLayerIdRef.current = null;
      return;
    }

    if (lastProcessedLayerIdRef.current === expandToLayerId) return;
    lastProcessedLayerIdRef.current = expandToLayerId;

    expandToShowObject(expandToLayerId);

    setTimeout(() => {
      toggleNodeExpansion(expandToLayerId);
      scrollToSelectedItem(expandToLayerId);
    }, 150);
  }, [expandToLayerId, isAcousticMaterialActive, expandToShowObject, toggleNodeExpansion, scrollToSelectedItem]);

  // After an acoustic region is assigned, keep multi-layer models collapsed so
  // the layer list stays compact (the user expands a layer to assign materials).
  // Single-layer models still expand straight to the region node.
  const acousticLayerExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAcousticMode || selectedAcousticLayerIds.length === 0) return;
    const expandKey = selectedAcousticLayerIds.join('|');
    if (acousticLayerExpandedRef.current === expandKey) return;

    // Multi-layer model: collapse everything once the region is assigned (the
    // tree may still be loading, so only mark handled after acting).
    if (topLevelLayerCount > 1) {
      acousticLayerExpandedRef.current = expandKey;
      collapseToRoot();
      return;
    }

    const acousticItem = filteredVirtualItems.find(
      (item) => selectedAcousticLayerIds.includes(item.data.raw?.id)
        || selectedAcousticLayerNames.includes(item.data.raw?.name),
    );
    if (!acousticItem || acousticItem.isExpanded) return;

    const layerId = acousticItem.data.raw?.id;
    if (!layerId) return;

    acousticLayerExpandedRef.current = expandKey;
    expandToShowObject(layerId);
    setTimeout(() => {
      toggleNodeExpansion(layerId);
      scrollToSelectedItem(layerId);
    }, 200);
  }, [isAcousticMode, selectedAcousticLayerIds, selectedAcousticLayerNames, filteredVirtualItems, expandToShowObject, toggleNodeExpansion, scrollToSelectedItem, topLevelLayerCount, collapseToRoot]);

  // ── Acoustic-region selection handlers ───────────────────────────────────
  const toggleSelectionForItem = useCallback((item: TreeItem) => {
    const leaves = getGeometryLeafIdsFromNode(item.data);
    if (leaves.length === 0) return;
    const draft = draftLeafIdsRef.current;
    const allIn = leaves.every((id) => draft.has(id));
    if (allIn) {
      leaves.forEach((id) => draft.delete(id));
    } else {
      leaves.forEach((id) => draft.add(id));
    }
    syncDraftToViewer();
  }, [syncDraftToViewer]);

  const handleSelectAll = useCallback(() => {
    draftLeafIdsRef.current = new Set(allModelGeometryIds);
    syncDraftToViewer();
  }, [allModelGeometryIds, syncDraftToViewer]);

  const handleCancelSelection = useCallback(() => {
    draftLeafIdsRef.current = new Set();
    lastDraftSyncRef.current = JSON.stringify([]);
    setDraftVersion((v) => v + 1);
    setSelectionPreviewIds(null);
    useSpeckleStore.getState().applyVisibility();
    useSpeckleStore.getState().clearViewerSelection();
    clearSelection();
  }, [clearSelection]);

  const handleConfirmSelection = useCallback(() => {
    const draft = draftLeafIdsRef.current;
    if (draft.size === 0) return;

    const wholeModel = allModelGeometryIds.size > 0
      && draft.size === allModelGeometryIds.size
      && Array.from(draft).every((id) => allModelGeometryIds.has(id));

    // Collapse the draft into the top-most fully-selected rows, so the stored
    // selection stays compact (a whole layer instead of its every surface).
    const picked: { id: string; name: string }[] = [];
    let ancestorIndent: number | null = null;
    for (const item of virtualItemsRef.current) {
      const indent = item.indent ?? 0;
      if (ancestorIndent !== null) {
        if (indent > ancestorIndent) continue;
        ancestorIndent = null;
      }
      const leaves = getGeometryLeafIdsFromNode(item.data);
      if (leaves.length === 0) continue;
      if (!leaves.every((id) => draft.has(id))) continue;
      const nodeId = item.data.raw?.id || item.data.model?.id || item.id;
      if (!nodeId) continue;
      const { header } = getHeaderAndSubheader(item.data.raw, modelFileName, indent === 0);
      picked.push({ id: nodeId, name: header });
      ancestorIndent = indent;
    }

    const nodeIds = picked.length > 0 ? picked.map((p) => p.id) : Array.from(draft);
    const nodeNames = picked.length > 0 ? picked.map((p) => p.name) : ['Custom selection'];

    setAcousticSelection({
      nodeIds,
      nodeNames,
      geometryIds: Array.from(draft),
      faceCount: selectedFaceCount,
      isWholeModel: wholeModel,
      autoDetected: false,
    });
    setSelectionPreviewIds(null);
    useSpeckleStore.getState().applyVisibility();
    useSpeckleStore.getState().clearViewerSelection();
    useUIStore.getState().setAcousticLayerSelectionMode(false);
    draftLeafIdsRef.current = new Set();
    setDraftVersion((v) => v + 1);
    clearSelection();
  }, [allModelGeometryIds, modelFileName, setAcousticSelection, selectedFaceCount, clearSelection]);

  // Keyboard: Enter confirms, Escape clears the draft.
  useObjectSelectionPhase({
    active: phase,
    hasConfirmedSelection: false,
    onCommit: () => {
      handleConfirmSelection();
      return true;
    },
    onEscape: handleCancelSelection,
    ignoreTyping: true,
  });

  // Tree item callbacks
  const handleItemClick = useCallback((item: TreeItem, event: React.MouseEvent) => {
    const objectId = item.data.raw?.id;
    if (!objectId) return;

    // Selection phase: clicking a row toggles its checkbox (tri-state).
    if (phase) {
      toggleSelectionForItem(item);
      return;
    }

    const isCurrentlySelected = selectedObjectIds.includes(objectId);

    let next: string[];
    if (event.shiftKey) {
      next = isCurrentlySelected
        ? selectedObjectIds.filter((id) => id !== objectId)
        : [...selectedObjectIds, objectId];
    } else {
      next = [objectId];
    }

    setDisableScrollOnNextSelection(true);

    setSelection(next);
    if (next.length === 0) {
      clearViewerSelection();
    } else {
      selectObjects(next);
    }
    storeSetSelectedObjectIds(next);

    if (!event.shiftKey && !isCurrentlySelected) {
      const { header, subheader } = getHeaderAndSubheader(item.data.raw, modelFileName);
      const displayType = item.hasChildren ? 'Layer' : (subheader || 'Speckle Object');
      setSelectedEntity({
        objectId,
        objectName: header,
        objectType: displayType,
      });
    }

    if (next.length > 0 && item.hasChildren && !item.isExpanded) {
      toggleNodeExpansion(item.id);
    }
  }, [phase, toggleSelectionForItem, selectedObjectIds, setSelection, selectObjects, clearViewerSelection, storeSetSelectedObjectIds, toggleNodeExpansion, setSelectedEntity, modelFileName]);

  const handleItemDoubleClick = useCallback((objectId: string) => {
    zoomToObjects([objectId]);
  }, [zoomToObjects]);

  const handleToggleVisibility = useCallback((objectIds: string[]) => {
    if (isAcousticMode && hasDefinedLayer) {
      const hiddenSet = useSpeckleStore.getState().acousticExplorerHiddenIds;
      const allHidden = objectIds.every((id) => hiddenSet.includes(id));

      objectIds.forEach((id) => {
        if (allHidden) {
          useSpeckleStore.getState().removeAcousticExplorerHiddenId(id);
        } else {
          useSpeckleStore.getState().addAcousticExplorerHiddenId(id);
        }
      });
    } else {
      const isCurrentlyHidden = areObjectsHidden(objectIds);
      if (isCurrentlyHidden) {
        showObjects(objectIds);
      } else {
        hideObjects(objectIds);
      }
    }
  }, [isAcousticMode, hasDefinedLayer, areObjectsHidden, showObjects, hideObjects]);

  const handleToggleIsolation = useCallback((objectIds: string[]) => {
    const isCurrentlyIsolated = areObjectsIsolated(objectIds);
    if (isCurrentlyIsolated) {
      unIsolateObjects(objectIds);
    } else {
      isolateObjects(objectIds);
    }
  }, [areObjectsIsolated, unIsolateObjects, isolateObjects, isolatedObjects.size]);

  const handleMouseEnter = useCallback((objectIds: string[]) => {
    highlightObjects(objectIds);
  }, [highlightObjects]);

  const handleMouseLeave = useCallback((objectIds: string[]) => {
    unhighlightObjects(objectIds);
  }, [unhighlightObjects]);

  const selectedCount = draftLeafIdsRef.current.size;
  const totalCount = allModelGeometryIds.size;

  // Don't render anything if no viewer
  if (!viewerRef?.current) {
    return <EmptyState message="No viewer available" />;
  }
  
  return (
    <div className="flex flex-col min-h-0 space-y-2">
      {/* Guided setup card — acoustic-region selection phase */}
      {phase && (
        <div
          className="text-xs rounded border p-2"
          style={{
            backgroundColor: 'var(--color-primary-lighter)',
            borderColor: 'var(--color-primary)',
            color: 'var(--foreground)',
          }}
        >
          <div className="font-semibold mb-1">Define the acoustic region</div>
          <div className="leading-snug mb-1" style={{ color: 'var(--color-secondary-hover)' }}>
            Select the surfaces that bound your room — they define the geometry used for acoustic simulation.
          </div>
          <div className="leading-snug mb-2" style={{ color: 'var(--color-secondary-hover)' }}>
            Press Enter to confirm, Esc to clear.
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="px-2 py-0.5 rounded border transition-colors"
                style={{ borderColor: 'var(--color-border-strong)', color: 'var(--foreground)' }}
                onClick={handleSelectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded border transition-colors disabled:opacity-50"
                style={{ borderColor: 'var(--color-border-strong)', color: 'var(--foreground)' }}
                onClick={handleCancelSelection}
                disabled={selectedCount === 0}
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-right leading-tight" style={{ color: 'var(--color-secondary-hover)' }}>
                {selectedCount} / {totalCount} surfaces
                <br />
                {selectedFaceCount.toLocaleString()} / {totalFaceCount.toLocaleString()} faces
              </span>
              <button
                type="button"
                disabled={selectedCount === 0}
                className="px-2 py-0.5 rounded font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-on-blue)',
                }}
                onClick={handleConfirmSelection}
              >
                Confirm
              </button>
            </div>
          </div>
            <div className="leading-snug text-xxs" style={{ color: 'var(--color-success)' }}>
            Tip: Name a layer "Acoustics" in your 3D model to be auto-assigned as the acoustic region.
            </div>
        </div>
      )}

      <HelperHint
        text={phase ? 'Pick surfaces in the tree or drag a box in the 3D view. Enter to confirm, Esc to clear.' : null}
      />

      {filteredVirtualItems.length > 0 ? (
        <>
          {/* Scrolling Tree List */}
          <div
            ref={treeContainerRef}
            className="border rounded flex-1 min-h-0"
            style={{
              borderColor: 'var(--color-secondary-light)',
              backgroundColor: 'var(--background)',
              maxHeight: maxTreeHeight ?? undefined,
              overflowY: 'auto'
            }}
          >
            {filteredVirtualItems.map((item, index) => {
              try {
                if (!item || !item.data) {
                  return (
                    <div key={`loading-${index}`} style={{ padding: '8px', color: 'var(--color-secondary-hover)' }}>
                      Loading...
                    </div>
                  );
                }

                const objectIds = getGeometryLeafIdsFromNode(item.data);
                const isHidden = areObjectsHidden(objectIds) ||
                  (isAcousticMode && hasDefinedLayer && objectIds.length > 0 &&
                   objectIds.every((id) => acousticExplorerHiddenIds.includes(id)));
                const isIsolated = areObjectsIsolated(objectIds);
                const itemName = item.data.raw?.name || '';

                const selectedInRow = phase
                  ? objectIds.filter((id) => selectedLeafSet.has(id)).length
                  : 0;
                const selectionChecked = phase && objectIds.length > 0 && selectedInRow === objectIds.length;
                const selectionIndeterminate = phase && selectedInRow > 0 && selectedInRow < objectIds.length;

                return (
                  <VirtualTreeItem
                    key={`${item.id}-${index}`}
                    item={item}
                    style={{ height: `${UI_RIGHT_SIDEBAR.TREE_ITEM_HEIGHT}px` }}
                    isHidden={isHidden}
                    isIsolated={isIsolated}
                    hasIsolatedObjectsInGeneral={hasIsolatedObjectsInGeneral}
                    onToggleExpansion={toggleNodeExpansion}
                    onItemClick={handleItemClick}
                    onItemDoubleClick={handleItemDoubleClick}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    onToggleVisibility={handleToggleVisibility}
                    onToggleIsolation={handleToggleIsolation}
                    acousticActive={isAcousticMaterialActive && hasDefinedLayer}
                    showScattering={acousticCardType === 'pyroomacoustics'}
                    sortedMaterials={sortedMaterials}
                    materialColors={materialColors}
                    selectionPhase={phase}
                    selectionChecked={selectionChecked}
                    selectionIndeterminate={selectionIndeterminate}
                    onToggleSelection={toggleSelectionForItem}
                    hideIsolateButton={phase || (isAcousticMode && hasDefinedLayer)}
                    isAcousticLayerRow={hasDefinedLayer && (selectedAcousticLayerIds.includes(item.data.raw?.id) || selectedAcousticLayerNames.includes(itemName))}
                  />
                );
              } catch (error) {
                console.error('[VirtualTreeItem] Error rendering item:', index, error);
                return (
                  <div key={`error-${index}`} style={{ padding: '8px', color: 'var(--color-error)' }}>
                    Error rendering item
                  </div>
                );
              }
            })}
          </div>

          {/* Filter controls */}
          {!phase && ((isAcousticMode ? acousticExplorerHiddenIds.length : hiddenObjects.size) > 0 ||
            (!isAcousticMode && isolatedObjects.size > 0)) && (
            <div className="flex gap-2 text-xs">
              {(isAcousticMode ? acousticExplorerHiddenIds.length : hiddenObjects.size) > 0 && (
                <div
                  className="px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--color-warning-light)',
                    color: 'var(--color-warning)'
                  }}
                >
                  {isAcousticMode ? acousticExplorerHiddenIds.length : hiddenObjects.size} hidden
                </div>
              )}
              {!isAcousticMode && isolatedObjects.size > 0 && (
                <div
                  className="px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--color-info-light)',
                    color: 'var(--color-info)'
                  }}
                >
                  {isolatedObjects.size} isolated
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* Loading/Empty state */
        <div
          className="border rounded p-4 text-center text-xs flex-1"
          style={{
            borderColor: 'var(--color-secondary-light)',
            backgroundColor: 'var(--background)',
            color: 'var(--color-secondary-hover)',
            minHeight: '150px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <div style={{ fontSize: '24px' }}>📦</div>
          <div>Loading object tree from Speckle...</div>
          <div style={{ fontSize: '10px', color: 'var(--color-secondary-hover)', fontFamily: 'monospace' }}>
            Viewer ref: {viewerRef?.current ? '✓' : '✗'}<br/>
            World tree: {worldTree ? '✓' : '✗'}<br/>
            Tree loaded: {hasLoadedTreeRef.current ? '✓' : '✗'}<br/>
            Root nodes: {rootNodes.length}<br/>
            Virtual items: {filteredVirtualItems.length}
          </div>
          <button
            onClick={refreshTree}
            className="text-xs px-2 py-1 rounded mt-2"
            style={{
              backgroundColor: 'var(--color-success)',
              color: 'white',
              cursor: 'pointer'
            }}
          >
          </button>
        </div>
      )}
    </div>
  );
}

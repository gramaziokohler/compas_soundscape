'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { VirtualTreeItem } from '@/components/scene/VirtualTreeItem';
import { useSpeckleTree, getRootNodesForModel, getGeometryLeafIdsFromNode } from '@/hooks/useSpeckleTree';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleInteractions } from '@/hooks/useSpeckleInteractions';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { setSelectionPreviewIds } from '@/store/speckleStore';
import type { VirtualTreeItem as TreeItem } from '@/hooks/useSpeckleTree';
import { useAcousticMaterialStore } from '@/store';
import { getHeaderAndSubheader } from '@/hooks/useSpeckleTree';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import type { MaterialOption } from '@/components/ui/MaterialSelect';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * ObjectExplorer Component
 * 
 * Displays a hierarchical tree view of objects from the Speckle viewer.
 * Supports selection, visibility control, isolation, and filtering.
 * Extracted from Model3DContextContent to live in the right sidebar.
 */

interface ObjectExplorerProps {
  resetAllRef?: React.MutableRefObject<(() => void) | null>;
  maxTreeHeight?: number;
}

export function ObjectExplorer({ resetAllRef, maxTreeHeight }: ObjectExplorerProps = {}) {
  const { modelFileName, worldTreeVersion, getViewerRef, setSelectedEntity, setSelectedObjectIds: storeSetSelectedObjectIds } = useSpeckleStore();
  const storeSelectedObjectIds = useSpeckleStore((s) => s.selectedObjectIds);
  const viewMode = useSpeckleStore((s) => s.viewMode);
  const selectedAcousticLayerName = useAcousticLayerStore((s) => s.selectedAcousticLayerName);
  const selectedAcousticLayerNames = useAcousticLayerStore((s) => s.selectedAcousticLayerNames);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const setAcousticLayers = useAcousticLayerStore((s) => s.setAcousticLayers);
  const clearAcousticLayer = useAcousticLayerStore((s) => s.clearAcousticLayer);
  const acousticLayerSelectionMode = useUIStore((s) => s.acousticLayerSelectionMode);
  const acousticExplorerHiddenIds = useSpeckleStore((s) => s.acousticExplorerHiddenIds);
  const isAcousticMode = viewMode === 'acoustic';
  const hasDefinedLayer = !!selectedAcousticLayerName;
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
  // Track which layer IDs have been clicked in selection mode (multi-select toggles).
  // Maps layerId -> { name, leafIds } so we can preview + commit the union.
  const clickedLayerIdsRef = useRef<Map<string, { name: string; leafIds: string[]; isRoot: boolean }>>(new Map());
  
  // Initialize tree management hooks
  const {
    rootNodes = [],
    virtualItems = [],
    expandedNodes,
    selectedObjectIds,
    toggleNodeExpansion,
    setSelection,
    clearSelection,
    expandToShowObject
  } = useSpeckleTree(worldTree, treeUpdateTrigger, modelFileName) || {
    rootNodes: [],
    virtualItems: [],
    expandedNodes: new Set(),
    selectedObjectIds: [],
    toggleNodeExpansion: () => {},
    setSelection: () => {},
    clearSelection: () => {},
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

  // Wrapper that also clears clicked-layer tracking + selection mode
  const clearAll = useCallback(() => {
    clearFilters();
    clearSelection();
    clickedLayerIdsRef.current.clear();
    setSelectionPreviewIds(null);
    useUIStore.getState().setAcousticLayerSelectionMode(false);
  }, [clearFilters, clearSelection]);

  // Exclude the "Soundscape" layer (and all its descendants).
  // In acoustic mode: show ONLY the selected acoustic layer subtrees.
  // In default/dark mode: hide the selected acoustic layer subtrees.
  const filteredVirtualItems = useMemo(() => {
    let soundscapeSkipIndent: number | null = null;
    const selectedLayerNameSet = new Set<string>(isWholeModel ? [] : selectedAcousticLayerNames);
    let acousticSubtreeIndent = -1;

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

      // ── ViewMode-dependent acoustic layer filtering ──
      // Whole model: skip filtering entirely (everything IS the acoustic layer).
      if (isWholeModel) return true;

      // No layers selected (selection mode / none defined) — show everything.
      if (selectedLayerNameSet.size === 0) return true;

      const name = item.data.raw?.name ?? '';

      // Inside a selected layer's subtree: show in acoustic mode, hide otherwise.
      if (acousticSubtreeIndent !== -1) {
        if (item.indent > acousticSubtreeIndent) {
          return isAcousticMode;
        }
        acousticSubtreeIndent = -1;
      }

      // This item is itself a selected layer.
      if (selectedLayerNameSet.has(name)) {
        acousticSubtreeIndent = item.indent;
        return isAcousticMode;
      }

      // Outside any selected layer: hide in acoustic mode, show otherwise.
      return !isAcousticMode;
    });
  }, [virtualItems, isAcousticMode, selectedAcousticLayerNames, isWholeModel]);

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
  // worldTreeVersion is a proper reactive dependency that changes when the tree loads
  useEffect(() => {
    if (!viewerRef?.current) return;

    // Reset per-load flags so tree loading runs fresh on each viewer init
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

    // Try immediately (worldTreeVersion change means tree should be ready)
    if (attemptTreeLoad()) return;

    // Fallback: retry with delays if immediate load fails
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
  // The viewer writes its selection (single click, shift+click, box-select) to
  // the canonical `speckleStore.selectedObjectIds`. We mirror it into the tree:
  // reveal + highlight every matching row and scroll to the most recent one.
  // Explorer-initiated updates set `disableScrollOnNextSelection` first so their
  // own echo through the store does not re-reveal/re-scroll.
  const resolveSelectionRowIds = useCallback((ids: string[]): string[] => {
    const items = virtualItemsRef.current;
    const resolved = new Set<string>();

    for (const id of ids) {
      // Prefer the DEEPEST row that owns the id so a click highlights the actual
      // child object, not its top-most ancestor. Exact node match first; then any
      // row whose geometry leaves contain the id (Brep/display-mesh case).
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

  // Stage 1: when the viewer selection changes, open every collapsed ancestor
  // layer that contains a selected object so the actual leaf row exists in the
  // flattened list (children of a collapsed layer are not rendered).
  // expandToShowObject walks the FULL tree, so it works even when the target
  // row is not currently visible.
  useEffect(() => {
    const storeIds = storeSelectedObjectIds;
    const prev = prevStoreSelectionRef.current;
    prevStoreSelectionRef.current = storeIds;

    // Explorer-initiated updates are already reflected in the tree — consume the
    // flag, drop any stale reveal, and skip re-reveal/re-scroll of our own echo.
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
  }, [storeSelectedObjectIds, disableScrollOnNextSelection, expandToShowObject, clearSelection]);

  // Stage 2: once the expansion above has committed and the flattened list
  // includes the newly-revealed rows, highlight the deepest matching rows and
  // scroll to the most recent selection.
  useEffect(() => {
    const ids = pendingRevealRef.current;
    if (!ids) return;

    const targetIds = resolveSelectionRowIds(ids);
    if (targetIds.length === 0) {
      // Expansion committed but no row owns the selection — nothing to reveal.
      pendingRevealRef.current = null;
      clearSelection();
      return;
    }
    pendingRevealRef.current = null;
    setSelection(targetIds);
    scrollToSelectedItem(targetIds[targetIds.length - 1]);
  }, [virtualItems, resolveSelectionRowIds, setSelection, scrollToSelectedItem, clearSelection]);
  
  // ===== Selected entity sync =====
  // setSelectedEntity is already destructured from the store above

  // ===== Auto-expand/scroll to acoustic layer =====
  const expandToLayerId = useAcousticMaterialStore((s) => s.expandToLayerId);
  const isAcousticMaterialActive = useAcousticMaterialStore((s) => s.isActive);
  const acousticCardType = useAcousticMaterialStore((s) => s.cardType);
  const acousticMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const lastProcessedLayerIdRef = useRef<string | null>(null);

  // Material options + color map for the acoustic dropdown columns (memoized once)
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

    // Skip if already processed this layer
    if (lastProcessedLayerIdRef.current === expandToLayerId) return;
    lastProcessedLayerIdRef.current = expandToLayerId;

    // Expand ancestors to reveal the layer node
    expandToShowObject(expandToLayerId);

    // After a short delay, expand the layer node itself and scroll to it
    setTimeout(() => {
      toggleNodeExpansion(expandToLayerId);
      scrollToSelectedItem(expandToLayerId);
    }, 150);
  }, [expandToLayerId, isAcousticMaterialActive, expandToShowObject, toggleNodeExpansion, scrollToSelectedItem]);

  // Auto-expand the acoustic layer node in the tree when in acoustic mode
  const acousticLayerExpandedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isAcousticMode || !selectedAcousticLayerName) return;
    if (acousticLayerExpandedRef.current === selectedAcousticLayerName) return;

    const acousticItem = filteredVirtualItems.find(
      (item) => item.data.raw?.name === selectedAcousticLayerName,
    );
    if (!acousticItem || acousticItem.isExpanded) return;

    // Expand ancestors to reveal the layer node, then expand the layer itself
    const layerId = acousticItem.data.raw?.id;
    if (!layerId) return;

    acousticLayerExpandedRef.current = selectedAcousticLayerName;
    expandToShowObject(layerId);
    setTimeout(() => {
      toggleNodeExpansion(layerId);
      scrollToSelectedItem(layerId);
    }, 200);
  }, [isAcousticMode, selectedAcousticLayerName, filteredVirtualItems, expandToShowObject, toggleNodeExpansion, scrollToSelectedItem]);

  // Tree item callbacks
  const handleItemClick = useCallback((item: TreeItem, event: React.MouseEvent) => {
    const objectId = item.data.raw?.id;
    if (!objectId) return;

    const isCurrentlySelected = selectedObjectIds.includes(objectId);

    // In selection mode: clicking a layer toggles it (multi-select) and previews
    // the union isolation. Commit happens via the "Select" button / banner.
    if (acousticLayerSelectionMode && item.hasChildren) {
      const leafIds = getGeometryLeafIdsFromNode(item.data);
      const itemName = item.data.raw?.name || '';
      const map = clickedLayerIdsRef.current;

      if (map.has(objectId)) {
        map.delete(objectId);
      } else {
        map.set(objectId, { name: itemName, leafIds, isRoot: item.indent === 0 });
      }

      // Preview: isolate the union of all toggled layers.
      const union = new Set<string>();
      map.forEach((v) => v.leafIds.forEach((id) => union.add(id)));
      setSelectionPreviewIds(union.size > 0 ? Array.from(union) : null);
      useSpeckleStore.getState().applyVisibility();
      setTreeUpdateTrigger((prev) => prev + 1);
      return;
    }

    // Compute the target selection: shift toggles membership (off if already
    // selected, on otherwise); no shift replaces the whole selection.
    let next: string[];
    if (event.shiftKey) {
      next = isCurrentlySelected
        ? selectedObjectIds.filter((id) => id !== objectId)
        : [...selectedObjectIds, objectId];
    } else {
      next = [objectId];
    }

    // Mark this update as explorer-initiated so the store-driven mirror effect
    // (which also fires from our own store write below) does not re-reveal/scroll.
    setDisableScrollOnNextSelection(true);

    // Reflect the exact selection into the tree, the viewer SelectionExtension,
    // and the canonical store so both directions stay consistent — including
    // multi-selection toggled via shift.
    setSelection(next);
    if (next.length === 0) {
      clearViewerSelection();
    } else {
      selectObjects(next);
    }
    storeSetSelectedObjectIds(next);

    // A plain single-select of a not-yet-selected row updates the
    // EntityInfoPanel immediately (no need to wait for a canvas interaction).
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
  }, [selectedObjectIds, setSelection, selectObjects, clearViewerSelection, storeSetSelectedObjectIds, toggleNodeExpansion, setSelectedEntity, modelFileName, acousticLayerSelectionMode]);

  const handleItemDoubleClick = useCallback((objectId: string) => {
    zoomToObjects([objectId]);
  }, [zoomToObjects]);

  const handleToggleVisibility = useCallback((objectIds: string[]) => {
    if (isAcousticMode && hasDefinedLayer) {
      const hiddenSet = useSpeckleStore.getState().acousticExplorerHiddenIds;
      // Check if ALL the object IDs are in the hidden set
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

  const handleConfirmSelection = useCallback(() => {
    const map = clickedLayerIdsRef.current;
    if (map.size === 0) return;
    const ids = Array.from(map.keys());
    const names = ids.map((id) => map.get(id)!.name);
    const wholeModel = ids.length === 1 && map.get(ids[0])!.isRoot;
    setAcousticLayers(ids, names, wholeModel);
    setSelectionPreviewIds(null);
    clickedLayerIdsRef.current.clear();
    useUIStore.getState().setAcousticLayerSelectionMode(false);
  }, [setAcousticLayers]);

  const handleMouseEnter = useCallback((objectIds: string[]) => {
    highlightObjects(objectIds);
  }, [highlightObjects]);

  const handleMouseLeave = useCallback((objectIds: string[]) => {
    unhighlightObjects(objectIds);
  }, [unhighlightObjects]);
  
  // Don't render anything if no viewer
  if (!viewerRef?.current) {
    return <EmptyState message="No viewer available" />;
  }
  
  return (
    <div className="flex flex-col min-h-0 space-y-2">
      {/* Layer selection mode banner */}
      {isAcousticMode && acousticLayerSelectionMode && (
        <div
          className="text-xs p-2 rounded border"
          style={{
            backgroundColor: 'var(--color-primary-light)',
            borderColor: 'var(--color-primary)',
            color: 'var(--foreground)',
          }}
        >
          Select one or more layers as the acoustic layer
          {clickedLayerIdsRef.current.size > 0 && (
            <button
              className="ml-2 px-2 py-0.5 text-xs font-medium rounded transition-colors"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-on-blue)',
              }}
              onClick={handleConfirmSelection}
            >
              Confirm {clickedLayerIdsRef.current.size} layer{clickedLayerIdsRef.current.size > 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

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
                const itemId = item.data.raw?.id || '';

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
                    isLayerSelectionMode={isAcousticMode && acousticLayerSelectionMode && item.hasChildren && clickedLayerIdsRef.current.has(itemId)}
                    onSelectAsAcousticLayer={isAcousticMode && acousticLayerSelectionMode && item.hasChildren && clickedLayerIdsRef.current.has(itemId)
                      ? handleConfirmSelection
                      : undefined}
                    hideIsolateButton={isAcousticMode && hasDefinedLayer}
                    isAcousticLayerRow={selectedAcousticLayerNames.includes(itemName)}
                    onResetAcousticLayer={selectedAcousticLayerNames.includes(itemName)
                      ? () => {
                          clearAcousticLayer();
                          useAcousticMaterialStore.getState().deactivateViewer();
                          if (isAcousticMode) {
                            useUIStore.getState().setAcousticLayerSelectionMode(true);
                            useUIStore.getState().setShowObjectExplorer(true);
                          }
                        } : undefined}
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
          {((isAcousticMode ? acousticExplorerHiddenIds.length : hiddenObjects.size) > 0 ||
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

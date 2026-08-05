'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { VirtualTreeItem } from '@/components/scene/VirtualTreeItem';
import { useSpeckleTree, getRootNodesForModel, getGeometryLeafIdsFromNode } from '@/hooks/useSpeckleTree';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleInteractions } from '@/hooks/useSpeckleInteractions';
import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { SelectionExtension } from '@speckle/viewer';
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
  onItemCountChange?: (count: number) => void;
  maxTreeHeight?: number;
}

export function ObjectExplorer({ resetAllRef, onItemCountChange, maxTreeHeight }: ObjectExplorerProps = {}) {
  const { modelFileName, worldTreeVersion, getViewerRef, setSelectedEntity } = useSpeckleStore();
  const viewMode = useSpeckleStore((s) => s.viewMode);
  const selectedAcousticLayerName = useAcousticLayerStore((s) => s.selectedAcousticLayerName);
  const isWholeModel = useAcousticLayerStore((s) => s.isWholeModel);
  const setAcousticLayer = useAcousticLayerStore((s) => s.setAcousticLayer);
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
  const previousSelectionRef = useRef<string[]>([]);
  const pendingScrollIdRef = useRef<string | null>(null);
  const virtualItemsRef = useRef<typeof virtualItems>([]);
  // Track which layer IDs have been clicked (for "Select" button reveal in selection mode)
  const clickedLayerIdsRef = useRef<Set<string>>(new Set());
  // Track the previous selection's object IDs for un-isolating when switching layers
  const previousSelectionIdsRef = useRef<string[]>([]);
  
  // Initialize tree management hooks
  const {
    rootNodes = [],
    virtualItems = [],
    expandedNodes,
    selectedObjectIds,
    toggleNodeExpansion,
    selectObject,
    addToSelection,
    clearSelection,
    removeFromSelection,
    expandToShowObject
  } = useSpeckleTree(worldTree, treeUpdateTrigger, modelFileName) || {
    rootNodes: [],
    virtualItems: [],
    expandedNodes: new Set(),
    selectedObjectIds: [],
    toggleNodeExpansion: () => {},
    selectObject: () => {},
    addToSelection: () => {},
    clearSelection: () => {},
    removeFromSelection: () => {},
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
    selectObjects
  } = useSpeckleInteractions(viewerRef);
  
  const hasIsolatedObjectsInGeneral = isolatedObjects.size > 0;

  // Wrapper that also clears clicked-layer tracking + selection mode
  const clearAll = useCallback(() => {
    clearFilters();
    clearSelection();
    clickedLayerIdsRef.current.clear();
    useUIStore.getState().setAcousticLayerSelectionMode(false);
  }, [clearFilters, clearSelection]);

  // Exclude the "Soundscape" layer (and all its descendants).
  // In acoustic mode: show ONLY the acoustic layer subtree.
  // In default/dark mode: hide the acoustic layer from display.
  const filteredVirtualItems = useMemo(() => {
    let soundscapeSkipIndent: number | null = null;
    let acousticLayerFound = false;
    let acousticLayerIndent = -1;

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

      if (isAcousticMode) {
        if (selectedAcousticLayerName) {
          // Show ONLY the acoustic layer and its subtree
          if (!acousticLayerFound) {
            if (item.data.raw?.name === selectedAcousticLayerName) {
              acousticLayerFound = true;
              acousticLayerIndent = item.indent;
              return true;
            }
            return false; // skip everything before the acoustic layer
          }
          // Inside the acoustic layer subtree
          if (item.indent > acousticLayerIndent) {
            return true; // descendant
          }
          // Indent returned to parent level or above — subtree ended
          acousticLayerIndent = Infinity; // prevent re-entering
          return false;
        }
        // No layer selected yet — show everything so user can pick
        return true;
      }

      // ── Default/dark mode: hide the acoustic layer from display ──
      if (selectedAcousticLayerName && !isWholeModel) {
        if (item.data.raw?.name === selectedAcousticLayerName) {
          soundscapeSkipIndent = item.indent;
          return false;
        }
      }
      return true;
    });
  }, [virtualItems, isAcousticMode, selectedAcousticLayerName, isWholeModel]);

  // Report item count to parent panel
  useEffect(() => {
    onItemCountChange?.(filteredVirtualItems.length);
  }, [filteredVirtualItems.length, onItemCountChange]);

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
  
  // Poll for selection changes from 3D viewer
  useEffect(() => {
    if (!viewerRef?.current) return;

    const interval = setInterval(() => {
      try {
        if (!viewerRef.current) return;

        const selectionExtension = viewerRef.current.getExtension(SelectionExtension);
        if (!selectionExtension) return;

        const selectedObjs = selectionExtension.getSelectedObjects() || [];
        const selectedIds = selectedObjs.map((obj: any) => {
          if (typeof obj === 'string') return obj;
          return obj?.id || String(obj);
        });

        const prevSelection = previousSelectionRef.current;
        const hasChanged =
          selectedIds.length !== prevSelection.length ||
          !selectedIds.every((id: string, index: number) => id === prevSelection[index]);

        if (!hasChanged) return;

        previousSelectionRef.current = selectedIds;

        if (disableScrollOnNextSelection) {
          setDisableScrollOnNextSelection(false);
          return;
        }

        if (selectedIds.length === 0) {
          clearSelection();
          return;
        }

        const firstSelected = selectedIds[0];
        const firstSelectedId = String(firstSelected);

        expandToShowObject(firstSelectedId);
        selectObject(firstSelectedId);
        scrollToSelectedItem(firstSelectedId);
      } catch (error) {
        console.error('[ObjectExplorer] Error polling selection:', error);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [viewerRef, disableScrollOnNextSelection, expandToShowObject, selectObject, clearSelection, scrollToSelectedItem]);
  
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

    // In selection mode: clicking a layer isolates it (without expanding) and
    // reveals the "Select" button. Clicking another layer de-isolates the previous.
    if (acousticLayerSelectionMode && item.hasChildren) {
      const ids = getGeometryLeafIdsFromNode(item.data);

      // Un-isolate the previously selected layer
      if (previousSelectionIdsRef.current.length > 0) {
        unIsolateObjects(previousSelectionIdsRef.current);
      }

      if (clickedLayerIdsRef.current.has(objectId)) {
        // Toggle off — clear selection
        clickedLayerIdsRef.current.delete(objectId);
        previousSelectionIdsRef.current = [];
      } else {
        // Select this layer
        clickedLayerIdsRef.current.clear();
        clickedLayerIdsRef.current.add(objectId);
        isolateObjects(ids);
        previousSelectionIdsRef.current = ids;
      }
      setTreeUpdateTrigger((prev) => prev + 1);
      return;
    }

    if (isCurrentlySelected && !event.shiftKey) {
      if (item.hasChildren && !item.isExpanded) {
        toggleNodeExpansion(item.id);
      }
      return;
    }

    if (isCurrentlySelected && event.shiftKey) {
      setDisableScrollOnNextSelection(true);
      removeFromSelection(objectId);
      return;
    }

    setDisableScrollOnNextSelection(true);

    if (event.shiftKey) {
      addToSelection(objectId);
    } else {
      clearSelection();
      selectObject(objectId);
      selectObjects([objectId]);

      // Immediately update selectedEntity so the EntityInfoPanel reacts without
      // requiring a canvas interaction to trigger SpeckleEventBridge.checkSpeckleSelection()
      const { header, subheader } = getHeaderAndSubheader(item.data.raw, modelFileName);
      const displayType = item.hasChildren ? 'Layer' : (subheader || 'Speckle Object');
      setSelectedEntity({
        objectId,
        objectName: header,
        objectType: displayType,
      });

      if (item.hasChildren && !item.isExpanded) {
        toggleNodeExpansion(item.id);
      }
    }
  }, [selectedObjectIds, removeFromSelection, addToSelection, clearSelection, selectObject, selectObjects, toggleNodeExpansion, setSelectedEntity, modelFileName, acousticLayerSelectionMode]);

  const handleItemDoubleClick = useCallback((objectId: string) => {
    zoomToObjects([objectId]);
  }, [zoomToObjects]);

  const handleToggleVisibility = useCallback((objectIds: string[]) => {
    if (isAcousticMode) {
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
      useSpeckleStore.getState().applyAcousticExplorerHiddenIsolation();
    } else {
      const isCurrentlyHidden = areObjectsHidden(objectIds);
      if (isCurrentlyHidden) {
        showObjects(objectIds);
      } else {
        hideObjects(objectIds);
      }
    }
  }, [isAcousticMode, areObjectsHidden, showObjects, hideObjects]);

  const handleToggleIsolation = useCallback((objectIds: string[]) => {
    const isCurrentlyIsolated = areObjectsIsolated(objectIds);
    if (isCurrentlyIsolated) {
      unIsolateObjects(objectIds);
    } else {
      isolateObjects(objectIds);
    }
  }, [areObjectsIsolated, unIsolateObjects, isolateObjects, isolatedObjects.size]);

  const handleSelectAsAcousticLayer = useCallback((objectId: string, name: string, isWholeModel: boolean) => {
    setAcousticLayer(objectId, name, isWholeModel);
    useUIStore.getState().setAcousticLayerSelectionMode(false);
  }, [setAcousticLayer]);

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
            color: 'var(--color-secondary)',
          }}
        >
          Define the acoustic layer to isolate for acoustic simulation
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
                const isRootNode = item.indent === 0;

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
                      ? () => {
                          clickedLayerIdsRef.current.clear();
                          handleSelectAsAcousticLayer(itemId, itemName, isRootNode);
                        } : undefined}
                    hideIsolateButton={isAcousticMode && hasDefinedLayer}
                    isAcousticLayerRow={!!selectedAcousticLayerName && itemName === selectedAcousticLayerName}
                    onResetAcousticLayer={!!selectedAcousticLayerName && itemName === selectedAcousticLayerName
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
          {(hiddenObjects.size > 0 || isolatedObjects.size > 0) && (
            <div className="flex gap-2 text-xs">
              {hiddenObjects.size > 0 && (
                <div
                  className="px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--color-warning-light)',
                    color: 'var(--color-warning)'
                  }}
                >
                  {hiddenObjects.size} hidden
                </div>
              )}
              {isolatedObjects.size > 0 && (
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

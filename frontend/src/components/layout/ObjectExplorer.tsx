'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { VirtualTreeItem } from '@/components/scene/VirtualTreeItem';
import { useSpeckleTree, getTargetObjectIds, getRootNodesForModel } from '@/hooks/useSpeckleTree';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleInteractions } from '@/hooks/useSpeckleInteractions';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';
import { SelectionExtension } from '@speckle/viewer';
import type { VirtualTreeItem as TreeItem } from '@/hooks/useSpeckleTree';
import { useAcousticMaterial } from '@/contexts/AcousticMaterialContext';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { getHeaderAndSubheader } from '@/hooks/useSpeckleTree';
import { UI_COLORS, UI_RIGHT_SIDEBAR } from '@/utils/constants';

/**
 * ObjectExplorer Component
 * 
 * Displays a hierarchical tree view of objects from the Speckle viewer.
 * Supports selection, visibility control, isolation, and filtering.
 * Extracted from Model3DContextContent to live in the right sidebar.
 */

export function ObjectExplorer() {
  const { viewerRef, modelFileName, worldTreeVersion } = useSpeckleViewerContext();
  
  // World tree state
  const [worldTree, setWorldTree] = useState<any>(null);
  const [treeUpdateTrigger, setTreeUpdateTrigger] = useState(0);
  const worldTreeRef = useRef<any>(null);
  const hasLoadedTreeRef = useRef<boolean>(false);
  
  // Scroll synchronization state
  const [disableScrollOnNextSelection, setDisableScrollOnNextSelection] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const previousSelectionRef = useRef<string[]>([]);
  const hasHiddenAcousticsLayerRef = useRef<boolean>(false);
  
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

  /**
   * Find a node by name in the tree (searches recursively)
   */
  const findNodeByName = useCallback((nodes: typeof rootNodes, name: string): typeof rootNodes[0] | null => {
    for (const node of nodes) {
      const nodeName = node.raw?.name || node.model?.raw?.name || node.model?.name;
      if (nodeName === name) {
        return node;
      }
      // Search children
      const children = node.model?.children || node.children;
      if (children && children.length > 0) {
        const found = findNodeByName(children as typeof rootNodes, name);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Auto-hide 'Acoustics' layer on initial load
  useEffect(() => {
    // Only run once when rootNodes become available
    if (hasHiddenAcousticsLayerRef.current || rootNodes.length === 0) return;

    const acousticsNode = findNodeByName(rootNodes, 'Acoustics');
    if (acousticsNode) {
      const objectIds = getTargetObjectIds(acousticsNode.raw || {});
      if (objectIds.length > 0) {
        console.log('[ObjectExplorer] Auto-hiding Acoustics layer on load:', objectIds.length, 'objects');
        // Small delay to ensure FilteringExtension is ready
        setTimeout(() => {
          hideObjects(objectIds);
        }, 100);
        hasHiddenAcousticsLayerRef.current = true;
      }
    }
  }, [rootNodes, findNodeByName, hideObjects]);
  
  // Trigger tree fetch when viewer/world tree becomes available
  // worldTreeVersion is a proper reactive dependency that changes when the tree loads
  useEffect(() => {
    if (!viewerRef?.current) return;

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
  
  // Scroll to selected item in tree
  const scrollToSelectedItem = useCallback((objectId: string) => {
    requestAnimationFrame(() => {
      if (!treeContainerRef.current) return;

      const itemIndex = virtualItems.findIndex(
        (item) => item.data.raw?.id === objectId
      );

      if (itemIndex !== -1) {
        const container = treeContainerRef.current;
        const containerHeight = container.clientHeight;
        const itemHeight = UI_RIGHT_SIDEBAR.TREE_ITEM_HEIGHT;
        const totalOffset = itemIndex * itemHeight;
        const centerOffset = containerHeight / 2 - itemHeight / 2;
        const scrollPosition = Math.max(0, totalOffset - centerOffset);

        container.scrollTo({
          top: scrollPosition,
          behavior: 'smooth'
        });
      }
    });
  }, [virtualItems]);
  
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
          !selectedIds.every((id, index) => id === prevSelection[index]);

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
  const { setSelectedEntity } = useSpeckleSelectionMode();

  // ===== Auto-expand/scroll to acoustic layer =====
  const { expandToLayerId, isActive: isAcousticMaterialActive } = useAcousticMaterial();
  const lastProcessedLayerIdRef = useRef<string | null>(null);

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

  // Tree item callbacks
  const handleItemClick = useCallback((item: TreeItem, event: React.MouseEvent) => {
    const objectId = item.data.raw?.id;
    if (!objectId) return;

    const isCurrentlySelected = selectedObjectIds.includes(objectId);

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
      setSelectedEntity({
        objectId,
        objectName: header,
        objectType: subheader || 'Speckle Object',
      });

      if (item.hasChildren && !item.isExpanded) {
        toggleNodeExpansion(item.id);
      }
    }
  }, [selectedObjectIds, removeFromSelection, addToSelection, clearSelection, selectObject, selectObjects, toggleNodeExpansion, setSelectedEntity, modelFileName]);

  const handleItemDoubleClick = useCallback((objectId: string) => {
    zoomToObjects([objectId]);
  }, [zoomToObjects]);

  const handleToggleVisibility = useCallback((objectIds: string[]) => {
    const isCurrentlyHidden = areObjectsHidden(objectIds);

    if (isCurrentlyHidden) {
      showObjects(objectIds);
    } else {
      hideObjects(objectIds);
    }
  }, [areObjectsHidden, showObjects, hideObjects]);

  const handleToggleIsolation = useCallback((objectIds: string[]) => {
    const isCurrentlyIsolated = areObjectsIsolated(objectIds);

    if (isCurrentlyIsolated) {
      unIsolateObjects(objectIds);
    } else {
      isolateObjects(objectIds);
    }
  }, [areObjectsIsolated, unIsolateObjects, isolateObjects]);

  const handleMouseEnter = useCallback((objectIds: string[]) => {
    highlightObjects(objectIds);
  }, [highlightObjects]);

  const handleMouseLeave = useCallback((objectIds: string[]) => {
    unhighlightObjects(objectIds);
  }, [unhighlightObjects]);
  
  // Don't render anything if no viewer
  if (!viewerRef?.current) {
    return (
      <div className="text-center text-xs p-4" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        No viewer available
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
          {virtualItems.length > 0 && `${virtualItems.length} items`}
        </label>
        {(hiddenObjects.size > 0 || isolatedObjects.size > 0 || selectedObjectIds.length > 0) && (
          <button
            onClick={() => {
              clearFilters();
              clearSelection();
            }}
            className="text-xs px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            style={{ color: UI_COLORS.PRIMARY }}
            title="Clear all filters and selection"
          >
            🔄 Reset All
          </button>
        )}
      </div>

      {virtualItems.length > 0 ? (
        <>
          {/* Scrolling Tree List */}
          <div
            ref={treeContainerRef}
            className="border rounded"
            style={{
              borderColor: UI_COLORS.NEUTRAL_200,
              backgroundColor: 'white',
              maxHeight: `${UI_RIGHT_SIDEBAR.TREE_MAX_HEIGHT}px`,
              overflowY: 'auto'
            }}
          >
            {virtualItems.map((item, index) => {
              try {
                if (!item || !item.data) {
                  return (
                    <div key={`loading-${index}`} style={{ padding: '8px', color: UI_COLORS.NEUTRAL_400 }}>
                      Loading...
                    </div>
                  );
                }

                const objectIds = getTargetObjectIds(item.data?.raw || {});
                const isHidden = areObjectsHidden(objectIds);
                const isIsolated = areObjectsIsolated(objectIds);

                return (
                  <VirtualTreeItem
                    key={item.id}
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
                  />
                );
              } catch (error) {
                console.error('[VirtualTreeItem] Error rendering item:', index, error);
                return (
                  <div key={`error-${index}`} style={{ padding: '8px', color: UI_COLORS.ERROR }}>
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
                    backgroundColor: UI_COLORS.WARNING_LIGHT,
                    color: UI_COLORS.WARNING
                  }}
                >
                  {hiddenObjects.size} hidden
                </div>
              )}
              {isolatedObjects.size > 0 && (
                <div
                  className="px-2 py-1 rounded"
                  style={{
                    backgroundColor: UI_COLORS.INFO_LIGHT,
                    color: UI_COLORS.INFO
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
          className="border rounded p-4 text-center text-xs"
          style={{
            borderColor: UI_COLORS.NEUTRAL_200,
            backgroundColor: 'white',
            color: UI_COLORS.NEUTRAL_500,
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
          <div style={{ fontSize: '10px', color: UI_COLORS.NEUTRAL_400, fontFamily: 'monospace' }}>
            Viewer ref: {viewerRef?.current ? '✓' : '✗'}<br/>
            World tree: {worldTree ? '✓' : '✗'}<br/>
            Tree loaded: {hasLoadedTreeRef.current ? '✓' : '✗'}<br/>
            Root nodes: {rootNodes.length}<br/>
            Virtual items: {virtualItems.length}
          </div>
          <button
            onClick={refreshTree}
            className="text-xs px-2 py-1 rounded mt-2"
            style={{
              backgroundColor: UI_COLORS.SUCCESS,
              color: 'white',
              cursor: 'pointer'
            }}
          >
            🔄 Refresh Tree
          </button>
        </div>
      )}
    </div>
  );
}

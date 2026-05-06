import { useEffect, useRef } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

export function useSpeckleSelection({
  worldTree,
  selectedSpeckleObjectIds,
  setSelectedSpeckleObjectIds,
  setSelectedEntity,
  setSelectedObjectIds,
  getObjectLinkState,
  isViewerReady,
  selectedEntity,
  skipDeselectionRef,
}: {
  worldTree: any;
  selectedSpeckleObjectIds: string[];
  setSelectedSpeckleObjectIds: (ids: string[]) => void;
  setSelectedEntity: (data: any) => void;
  setSelectedObjectIds: (ids: string[]) => void;
  getObjectLinkState: (id: string) => any;
  isViewerReady: boolean;
  selectedEntity: any;
  skipDeselectionRef: React.MutableRefObject<boolean>;
}) {
  const prevSpeckleObjectIdsRef = useRef<string[]>([]);

  // ============================================================================
  // Effect - Update Selected Entity in Store (for RightSidebar display)
  // ============================================================================
  useEffect(() => {
    const prevIds = prevSpeckleObjectIdsRef.current;
    prevSpeckleObjectIdsRef.current = selectedSpeckleObjectIds || [];

    if (!selectedSpeckleObjectIds || selectedSpeckleObjectIds.length === 0) {
      // A custom object click in the same cycle cleared Speckle selection via
      // clearAllSelections — don't interfere with the entity it already set
      if (skipDeselectionRef.current) {
        skipDeselectionRef.current = false;
        return;
      }

      const wasSpeckleSelected = prevIds.length > 0;
      if (wasSpeckleSelected) {
        setSelectedEntity(null);
        setSelectedObjectIds([]);
      } else {
        // Prev was already empty — custom object (receiver/sound sphere) whose
        // selection is managed by its own click callbacks
        if (!selectedEntity?.receiverData && !selectedEntity?.soundData) {
          setSelectedEntity(null);
        }
        setSelectedObjectIds([]);
      }
      return;
    }

    const selectedId = selectedSpeckleObjectIds[0];

    // If this object is linked to a sound, skip — the click callback already set
    // selectedEntity with objectType 'Sound' via onSelectSoundCard
    const linkState = getObjectLinkState(selectedId);
    if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
      return;
    }

    const findObjectInTree = (tree: any, id: string): any => {
      if (!tree) return null;

      const checkNode = (node: any): any => {
        const nodeId = node?.raw?.id || node?.model?.id || node?.id;
        if (nodeId === id) return node;

        const children = node?.model?.children || node?.children;
        if (children) {
          for (const child of children) {
            const found = checkNode(child);
            if (found) return found;
          }
        }
        return null;
      };

      const rootChildren =
        tree.tree?._root?.children ||
        tree._root?.children ||
        tree.root?.children ||
        tree.children;
      if (rootChildren) {
        for (const child of rootChildren) {
          const found = checkNode(child);
          if (found) return found;
        }
      }
      return null;
    };

    const findParentName = (tree: any, childId: string): string | undefined => {
      if (!tree) return undefined;

      const checkNode = (node: any, parentNode: any): string | undefined => {
        const nodeId = node?.raw?.id || node?.model?.id || node?.id;
        if (nodeId === childId && parentNode) {
          return parentNode?.model?.name || parentNode?.raw?.name || undefined;
        }
        const children = node?.model?.children || node?.children;
        if (children) {
          for (const child of children) {
            const result = checkNode(child, node);
            if (result) return result;
          }
        }
        return undefined;
      };

      const rootChildren =
        tree.tree?._root?.children ||
        tree._root?.children ||
        tree.root?.children ||
        tree.children;
      if (rootChildren) {
        for (const child of rootChildren) {
          const result = checkNode(child, null);
          if (result) return result;
        }
      }
      return undefined;
    };

    const selectedObject = findObjectInTree(worldTree, selectedId);

    if (!selectedObject) {
      setSelectedEntity(null);
      setSelectedObjectIds([]);
      return;
    }

    const objectName = selectedObject.model?.name || selectedObject.raw?.name || 'Unnamed';
    const objectType = selectedObject.raw?.speckle_type || 'Speckle Object';
    const parentName = findParentName(worldTree, selectedId);

    setSelectedEntity({
      objectId: selectedId,
      objectName,
      objectType,
      parentName,
    });
    setSelectedObjectIds(selectedSpeckleObjectIds);
  }, [
    selectedSpeckleObjectIds,
    worldTree,
    setSelectedEntity,
    setSelectedObjectIds,
    selectedEntity?.receiverData,
    getObjectLinkState,
  ]);
}

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';

interface ObjectOverlayProps {
  isViewerReady: boolean;
  selectedSpeckleObjectIds: string[];
  worldTree: any;
}

export interface SelectedObjectOverlay {
  x: number;
  y: number;
  visible: boolean;
  objectData: any;
}

function findObjectInTree(tree: any, id: string): any {
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
}

export function useSpeckleObjectOverlay({
  isViewerReady,
  selectedSpeckleObjectIds,
  worldTree,
}: ObjectOverlayProps) {
  const [selectedObjectOverlay, setSelectedObjectOverlay] = useState<SelectedObjectOverlay | null>(null);
  const prevOverlayRef = useRef<{ x: number; y: number; visible: boolean } | null>(null);

  useEffect(() => {
    const { viewer } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !viewer || !selectedSpeckleObjectIds || selectedSpeckleObjectIds.length === 0) {
      if (prevOverlayRef.current !== null) {
        prevOverlayRef.current = null;
        setSelectedObjectOverlay(null);
      }
      return;
    }

    const selectedId = selectedSpeckleObjectIds[0];
    const selectedObject = findObjectInTree(worldTree, selectedId);

    if (!selectedObject) {
      if (prevOverlayRef.current !== null) {
        prevOverlayRef.current = null;
        setSelectedObjectOverlay(null);
      }
      return;
    }

    const updateOverlayPosition = () => {
      const { viewer: currentViewer } = useSpeckleEngineStore.getState();
      if (!currentViewer || !selectedObject) return;

      const renderView = currentViewer.getRenderer().renderingCamera;
      if (!renderView) return;

      let bounds = selectedObject.raw?.bounds || selectedObject.model?.bounds;
      if (!bounds) {
        try {
          const wt = currentViewer.getWorldTree();
          const node = wt.findId(selectedId) as any;
          if (node && node.raw) {
            bounds = node.raw.bounds || node.raw.bbox;
          }
        } catch {
          // Ignore errors
        }
      }

      let newX: number;
      let newY: number;
      let newVisible: boolean;

      if (!bounds || !bounds.min || !bounds.max) {
        const canvas = currentViewer.getRenderer().renderer.domElement;
        newX = canvas.clientWidth / 2;
        newY = canvas.clientHeight / 2;
        newVisible = true;
      } else {
        const center = new THREE.Vector3(
          (bounds.min.x + bounds.max.x) / 2,
          (bounds.min.y + bounds.max.y) / 2,
          (bounds.min.z + bounds.max.z) / 2
        );
        const camera = renderView as THREE.Camera;
        const tempVector = center.clone();
        tempVector.project(camera);

        const canvas = currentViewer.getRenderer().renderer.domElement;
        newX = (tempVector.x * 0.5 + 0.5) * canvas.clientWidth;
        newY = (-(tempVector.y * 0.5) + 0.5) * canvas.clientHeight;
        newVisible = tempVector.z <= 1;
      }

      const prev = prevOverlayRef.current;
      const xChanged = !prev || Math.abs(prev.x - newX) > 0.5;
      const yChanged = !prev || Math.abs(prev.y - newY) > 0.5;
      const visChanged = !prev || prev.visible !== newVisible;

      if (xChanged || yChanged || visChanged) {
        prevOverlayRef.current = { x: newX, y: newY, visible: newVisible };
        setSelectedObjectOverlay({ x: newX, y: newY, visible: newVisible, objectData: selectedObject });
      }
    };

    const intervalId = setInterval(updateOverlayPosition, 16); // ~60fps
    updateOverlayPosition();

    return () => clearInterval(intervalId);
  }, [isViewerReady, selectedSpeckleObjectIds, worldTree]);

  return { selectedObjectOverlay };
}

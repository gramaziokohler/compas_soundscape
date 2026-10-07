/**
 * Speckle selection actions
 *
 * Hide / isolate / frame / inspect the CURRENT Speckle viewer selection
 * (`speckleStore.selectedObjectIds`). Plain functions over store state so the
 * viewer context menu and the global Shift+H shortcut share one implementation
 * (same visibility rules as the ObjectExplorer eye / isolate buttons).
 */

import { useSpeckleStore, useAcousticLayerStore, useUIStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { getRootNodesForModel, getGeometryLeafIdsFromNode, getExplorerNodeId } from '@/hooks/useSpeckleTree';

type TreeNode = {
  model?: { children?: TreeNode[]; raw?: { applicationId?: string } };
  children?: TreeNode[];
  raw?: { applicationId?: string };
};

function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (getExplorerNodeId(node) === id) return node;
    const children = node.model?.children || node.children;
    if (children) {
      const found = findTreeNode(children, id);
      if (found) return found;
    }
  }
  return null;
}

function getRootNodes(): TreeNode[] {
  const { getViewerRef, modelFileName } = useSpeckleStore.getState();
  const worldTree = getViewerRef()?.getWorldTree?.();
  return worldTree ? (getRootNodesForModel(worldTree, modelFileName) as TreeNode[]) : [];
}

/** Selected ids → geometry leaf ids (a selected layer expands to every mesh under it). */
export function getSelectionLeafIds(ids: string[] = useSpeckleStore.getState().selectedObjectIds): string[] {
  if (ids.length === 0) return [];
  const roots = getRootNodes();
  const leaves = new Set<string>();
  for (const id of ids) {
    const node = findTreeNode(roots, id);
    const nodeLeaves = node ? getGeometryLeafIdsFromNode(node) : [];
    (nodeLeaves.length > 0 ? nodeLeaves : [id]).forEach((leaf) => leaves.add(leaf));
  }
  return Array.from(leaves);
}

/** In Acoustic mode with a defined layer, hiding goes through the acoustic explorer set. */
function usesAcousticHiddenSet(): boolean {
  return useSpeckleStore.getState().viewMode === 'acoustic'
    && useAcousticLayerStore.getState().selectedAcousticLayerIds.length > 0;
}

/** Isolate is unavailable while the acoustic layer drives isolation. */
export function canIsolateSelection(): boolean {
  if (useSpeckleStore.getState().viewMode !== 'acoustic') return true;
  return useAcousticLayerStore.getState().selectedAcousticLayerIds.length === 0
    && !useUIStore.getState().acousticLayerSelectionMode;
}

/** Hide every selected object and drop the selection. Returns false when nothing is selected. */
export function hideSelection(): boolean {
  const leafIds = getSelectionLeafIds();
  if (leafIds.length === 0) return false;
  const speckle = useSpeckleStore.getState();
  if (usesAcousticHiddenSet()) {
    leafIds.forEach((id) => speckle.addAcousticExplorerHiddenId(id));
  } else {
    speckle.hideUserObjects(leafIds);
  }
  speckle.clearViewerSelection();
  return true;
}

export function isSelectionIsolated(leafIds: string[]): boolean {
  if (leafIds.length === 0) return false;
  const isolated = new Set(useSpeckleStore.getState().appliedIsolatedIds);
  return leafIds.every((id) => isolated.has(id));
}

/** Isolate the selection, or un-isolate it when it already is. */
export function toggleIsolateSelection(): void {
  const leafIds = getSelectionLeafIds();
  if (leafIds.length === 0) return;
  const speckle = useSpeckleStore.getState();
  if (isSelectionIsolated(leafIds)) {
    speckle.unIsolateUserObjects(leafIds);
  } else {
    speckle.isolateUserObjects(leafIds);
  }
}

/** Frame the camera on the selected objects. */
export function fitSelectionToView(): void {
  const ids = useSpeckleStore.getState().selectedObjectIds;
  const camera = useSpeckleEngineStore.getState().cameraController;
  if (ids.length > 0 && camera) camera.setCameraView(ids, true);
}

/** Application id (e.g. Rhino GUID) of the first selected object that has one. */
export function getSelectionApplicationId(): string | null {
  const roots = getRootNodes();
  for (const id of useSpeckleStore.getState().selectedObjectIds) {
    const node = findTreeNode(roots, id);
    const appId = node?.raw?.applicationId ?? node?.model?.raw?.applicationId;
    if (appId) return appId;
  }
  return null;
}

import { useEffect } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';
import type { SoundEvent, ReceiverData } from '@/types';

interface CoordinatorCallbacksProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  onSelectSoundCard?: (promptIndex: number) => void;
  isLinkingEntity: boolean;
  onEntityLinked?: (entity: any) => void;
  worldTree: any;
  getObjectLinkState: (id: string) => { isLinked: boolean; linkedSoundIndex?: number };
  onUpdateReceiverPosition?: (id: string, pos: [number, number, number]) => void;
  onUpdateSoundPosition?: (id: string, pos: [number, number, number]) => void;
  applyFilterColors: () => void;
  receivers: ReceiverData[];
  setSelectedEntity: (entity: any) => void;
  selectedDiverseEntities: any[];
  setSelectedSpeckleObjectIds: (ids: string[]) => void;
  skipDeselectionRef: React.MutableRefObject<boolean>;
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

function collectDescendantAabbs(node: any): THREE.Box3[] {
  const boxes: THREE.Box3[] = [];
  const rv = node?.model?.renderView || node?.renderView;
  if (rv?.aabb) boxes.push(rv.aabb as THREE.Box3);
  const children: any[] = node?.model?.children || node?.children || [];
  for (const child of children) {
    boxes.push(...collectDescendantAabbs(child));
  }
  return boxes;
}

export function useSpeckleCoordinatorCallbacks({
  isViewerReady,
  soundscapeData,
  onSelectSoundCard,
  isLinkingEntity,
  onEntityLinked,
  worldTree,
  getObjectLinkState,
  onUpdateReceiverPosition,
  onUpdateSoundPosition,
  applyFilterColors,
  receivers,
  setSelectedEntity,
  selectedDiverseEntities,
  setSelectedSpeckleObjectIds,
  skipDeselectionRef,
}: CoordinatorCallbacksProps) {
  const setExpandedSoundCardIdx = useUIStore(s => s.setExpandedSoundCardIndex);

  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator || !isViewerReady) return;

    // ── Speckle object selection ──────────────────────────────────────────────
    coordinator.setOnSpeckleObjectSelected((objectIds: string[]) => {
      setSelectedSpeckleObjectIds(objectIds);

      // ENTITY LINKING MODE
      if (isLinkingEntity && onEntityLinked) {
        if (objectIds.length === 0) {
          console.log('[SpeckleScene] Empty space clicked in linking mode - unlinking');
          onEntityLinked(null);
          return;
        }

        const selectedId = objectIds[0];
        const objectData = findObjectInTree(worldTree, selectedId);

        const objectName = objectData?.model?.name || objectData?.raw?.name || 'Unnamed Object';
        const objectType = objectData?.raw?.speckle_type || 'Speckle Object';

        let position: [number, number, number] = [0, 0, 0];
        let entityBounds:
          | { min: [number, number, number]; max: [number, number, number]; center: [number, number, number] }
          | undefined;

        try {
          const renderView = objectData?.model?.renderView || objectData?.renderView;
          if (renderView?.aabb) {
            const aabb = renderView.aabb as THREE.Box3;
            const center = new THREE.Vector3();
            aabb.getCenter(center);
            position = [center.x, center.y, center.z];
            entityBounds = {
              min: [aabb.min.x, aabb.min.y, aabb.min.z],
              max: [aabb.max.x, aabb.max.y, aabb.max.z],
              center: position,
            };
            console.log('[SpeckleScene] Got bounds from renderView.aabb:', {
              objectId: selectedId,
              center: position,
              min: entityBounds.min,
              max: entityBounds.max,
            });
          }
        } catch (boundsError) {
          console.warn('[SpeckleScene] Could not get render bounds, falling back to raw data:', boundsError);
        }

        // Fallback: raw bounds
        if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
          const rawBounds = objectData?.raw?.bounds || objectData?.model?.bounds;
          if (rawBounds && rawBounds.min && rawBounds.max) {
            position = [
              (rawBounds.min.x + rawBounds.max.x) / 2,
              (rawBounds.min.y + rawBounds.max.y) / 2,
              (rawBounds.min.z + rawBounds.max.z) / 2,
            ];
            entityBounds = {
              min: [rawBounds.min.x, rawBounds.min.y, rawBounds.min.z],
              max: [rawBounds.max.x, rawBounds.max.y, rawBounds.max.z],
              center: position,
            };
          }
        }

        // Fallback: union descendant aabbs (parent layer nodes)
        if (position[0] === 0 && position[1] === 0 && position[2] === 0) {
          const allBoxes = collectDescendantAabbs(objectData);
          if (allBoxes.length > 0) {
            const unionBox = new THREE.Box3();
            for (const box of allBoxes) unionBox.union(box);
            const center = new THREE.Vector3();
            unionBox.getCenter(center);
            position = [center.x, center.y, center.z];
            entityBounds = {
              min: [unionBox.min.x, unionBox.min.y, unionBox.min.z],
              max: [unionBox.max.x, unionBox.max.y, unionBox.max.z],
              center: position,
            };
            console.log('[SpeckleScene] Got bounds by unioning', allBoxes.length, 'descendant aabbs for layer:', {
              objectId: selectedId,
              center: position,
            });
          }
        }

        const existingIndices = selectedDiverseEntities.map(e => e.index).filter(i => i !== undefined);
        const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;

        const entity = {
          index: nextIndex,
          type: objectType,
          name: objectName,
          position,
          bounds: entityBounds,
          nodeId: selectedId,
          id: selectedId,
          applicationId: objectData?.raw?.applicationId || undefined,
          speckle_type: objectType,
          raw: objectData?.raw,
        };

        console.log('[SpeckleScene] Entity linked in linking mode:', {
          objectId: selectedId,
          entityIndex: entity.index,
          name: entity.name,
          position,
        });

        onEntityLinked(entity);
        return;
      }

      // NORMAL SELECTION: expand linked sound card
      if (objectIds.length > 0 && onSelectSoundCard) {
        const selectedId = objectIds[0];
        const linkState = getObjectLinkState(selectedId);
        if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
          console.log('[SpeckleScene] Speckle object clicked with linked sound, selecting card:', linkState.linkedSoundIndex);
          onSelectSoundCard(linkState.linkedSoundIndex);
        }
      }

      // Re-apply filter colors on deselection (clicking empty space)
      if (objectIds.length === 0) {
        setTimeout(() => applyFilterColors(), 50);
      }
    });

    // ── Sound sphere click ────────────────────────────────────────────────────
    coordinator.setOnSoundSphereClicked((promptKey: string) => {
      if (!onSelectSoundCard) return;
      const promptIndex = parseInt(promptKey.split('_')[1]);
      if (!isNaN(promptIndex)) {
        console.log('[SpeckleScene] Sound sphere clicked, selecting card:', promptIndex);
        setExpandedSoundCardIdx(null);
        skipDeselectionRef.current = true;
        onSelectSoundCard(promptIndex);
      }
    });

    // ── Receiver single-click ─────────────────────────────────────────────────
    coordinator.setOnReceiverSingleClicked((receiverId: string) => {
      const receiver = receivers.find(r => r.id === receiverId);
      if (receiver) {
        skipDeselectionRef.current = true;
        setSelectedEntity({
          objectId: receiver.id,
          objectName: receiver.name,
          objectType: 'Receiver',
          receiverData: { position: receiver.position },
        });
      }
    });

    // ── Custom object deselection ─────────────────────────────────────────────
    coordinator.setOnCustomObjectDeselected(() => setSelectedEntity(null));

    // ── Position update callbacks ─────────────────────────────────────────────
    if (onUpdateReceiverPosition) {
      coordinator.setOnReceiverPositionUpdated(onUpdateReceiverPosition);
    }
    if (onUpdateSoundPosition) {
      coordinator.setOnSoundPositionUpdated(onUpdateSoundPosition);
    }
  }, [
    isViewerReady,
    soundscapeData,
    onSelectSoundCard,
    isLinkingEntity,
    onEntityLinked,
    worldTree,
    getObjectLinkState,
    onUpdateReceiverPosition,
    onUpdateSoundPosition,
    applyFilterColors,
    receivers,
    setSelectedEntity,
  ]);
}

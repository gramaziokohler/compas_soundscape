import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';
import type { SoundEvent, ReceiverData } from '@/types';

interface CoordinatorCallbacksProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  isLinkingEntity: boolean;
  getObjectLinkState: (id: string) => { isLinked: boolean; linkedSoundIndex?: number };
  onUpdateReceiverPosition?: (id: string, pos: [number, number, number]) => void;
  onUpdateSoundPosition?: (id: string, pos: [number, number, number]) => void;
  applyFilterColors: () => void;
  receivers: ReceiverData[];
  setSelectedEntity: (entity: any) => void;
  setSelectedSpeckleObjectIds: (ids: string[]) => void;
  skipDeselectionRef: React.MutableRefObject<boolean>;
  /** Listener mesh or grid listener point single-clicked (receiver id or grid point id). */
  onListenerClicked?: (listenerOrPointId: string) => void;
}

/**
 * A click on a sound sphere or a sound-linked object focuses that sound
 * (`uiStore.soundFocus`): the sphere highlights and an open scene panel / sidebar
 * and the DAW follow. It never opens a panel itself — same in edit and share mode.
 */
const focusSoundFromScene = (index: number) => useUIStore.getState().focusSound(index, 'scene');

export function useSpeckleCoordinatorCallbacks({
  isViewerReady,
  soundscapeData,
  isLinkingEntity,
  getObjectLinkState,
  onUpdateReceiverPosition,
  onUpdateSoundPosition,
  applyFilterColors,
  receivers,
  setSelectedEntity,
  setSelectedSpeckleObjectIds,
  skipDeselectionRef,
  onListenerClicked,
}: CoordinatorCallbacksProps) {

  useEffect(() => {
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator || !isViewerReady) return;

    // ── Speckle object selection ──────────────────────────────────────────────
    coordinator.setOnSpeckleObjectSelected((objectIds: string[]) => {
      setSelectedSpeckleObjectIds(objectIds);

      // ENTITY LINKING MODE — pass-through.
      // The native SelectionExtension accumulates a shift-click multi-selection
      // into selectedObjectIds; the sound card's "Done" action (page.tsx) commits
      // them. No per-click linking, no linked-card expansion, no empty-click unlink.
      if (isLinkingEntity) {
        return;
      }

      // NORMAL SELECTION: a sound-linked object focuses its sound
      if (objectIds.length > 0) {
        const linkState = getObjectLinkState(objectIds[0]);
        if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
          focusSoundFromScene(linkState.linkedSoundIndex);
        }
      }

      // Re-apply filter colors on deselection (clicking empty space)
      if (objectIds.length === 0) {
        setTimeout(() => applyFilterColors(), 50);
      }
    });

    // ── Sound sphere click ────────────────────────────────────────────────────
    // Share view with model picking blocked (Object Explorer closed): the object
    // is not selected, but a sound-linked one still focuses its sound.
    coordinator.setOnBlockedModelClicked((objectId: string) => {
      if (isLinkingEntity) return;
      const linkState = getObjectLinkState(objectId);
      if (linkState.isLinked && linkState.linkedSoundIndex !== undefined) {
        focusSoundFromScene(linkState.linkedSoundIndex);
      }
    });

    coordinator.setOnSoundSphereClicked((promptKey: string) => {
      const promptIndex = parseInt(promptKey.split('_')[1]);
      if (!isNaN(promptIndex)) {
        // A custom object takes over the selection — clear the Speckle object
        // selection (store + explorer) so only one object type is highlighted.
        skipDeselectionRef.current = true;
        setSelectedSpeckleObjectIds([]);
        focusSoundFromScene(promptIndex);
      }
    });

    // ── Receiver single-click ─────────────────────────────────────────────────
    coordinator.setOnReceiverSingleClicked((receiverId: string) => {
      const receiver = receivers.find(r => r.id === receiverId);
      if (receiver) {
        skipDeselectionRef.current = true;
        setSelectedSpeckleObjectIds([]);
        setSelectedEntity({
          objectId: receiver.id,
          objectName: receiver.name,
          objectType: 'Receiver',
          receiverData: { position: receiver.position },
        });
        useUIStore.getState().focusListener(receiverId);
        onListenerClicked?.(receiverId);
      }
    });

    // ── Grid listener point single-click ──────────────────────────────────────
    coordinator.setOnGridListenerClicked((pointId: string) => {
      useUIStore.getState().focusListener(pointId);
      onListenerClicked?.(pointId);
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
    isLinkingEntity,
    getObjectLinkState,
    onUpdateReceiverPosition,
    onUpdateSoundPosition,
    applyFilterColors,
    receivers,
    setSelectedEntity,
    onListenerClicked,
    setSelectedSpeckleObjectIds,
  ]);
}
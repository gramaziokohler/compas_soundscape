import { useEffect } from 'react';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { useUIStore } from '@/store/uiStore';
import type { SoundEvent, ReceiverData } from '@/types';

interface CoordinatorCallbacksProps {
  isViewerReady: boolean;
  soundscapeData: SoundEvent[] | null;
  onSelectSoundCard?: (promptIndex: number) => void;
  isLinkingEntity: boolean;
  getObjectLinkState: (id: string) => { isLinked: boolean; linkedSoundIndex?: number };
  onUpdateReceiverPosition?: (id: string, pos: [number, number, number]) => void;
  onUpdateSoundPosition?: (id: string, pos: [number, number, number]) => void;
  applyFilterColors: () => void;
  receivers: ReceiverData[];
  setSelectedEntity: (entity: any) => void;
  setSelectedSpeckleObjectIds: (ids: string[]) => void;
  skipDeselectionRef: React.MutableRefObject<boolean>;
}

export function useSpeckleCoordinatorCallbacks({
  isViewerReady,
  soundscapeData,
  onSelectSoundCard,
  isLinkingEntity,
  getObjectLinkState,
  onUpdateReceiverPosition,
  onUpdateSoundPosition,
  applyFilterColors,
  receivers,
  setSelectedEntity,
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

      // ENTITY LINKING MODE — pass-through.
      // The native SelectionExtension accumulates a shift-click multi-selection
      // into selectedObjectIds; the sound card's "Done" action (page.tsx) commits
      // them. No per-click linking, no linked-card expansion, no empty-click unlink.
      if (isLinkingEntity) {
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
        // A custom object takes over the selection — clear the Speckle object
        // selection (store + explorer) so only one object type is highlighted.
        skipDeselectionRef.current = true;
        setSelectedSpeckleObjectIds([]);
        console.log('[SpeckleScene] Sound sphere clicked, selecting card:', promptIndex);
        setExpandedSoundCardIdx(null);
        onSelectSoundCard(promptIndex);
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
    getObjectLinkState,
    onUpdateReceiverPosition,
    onUpdateSoundPosition,
    applyFilterColors,
    receivers,
    setSelectedEntity,
    setSelectedSpeckleObjectIds,
  ]);
}
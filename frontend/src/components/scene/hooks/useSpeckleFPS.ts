'use client';

import { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import type { ReceiverData, SoundEvent } from '@/types';

interface FPSProps {
  isViewerReady: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  exitFPSTrigger?: number;
  goToReceiverId?: string | null;
  goToPosition?: [number, number, number] | null;
  goToPositionReceiverId?: string | null;
  listenerOrientation: { x: number; y: number; z: number };
  receivers: ReceiverData[];
  soundscapeData: SoundEvent[] | null;
  selectedReceiverId: string | null;
  onReceiverModeChange?: (isActive: boolean, receiverId: string | null) => void;
  onFPSExited?: () => void;
  onReceiverDoubleClicked?: (receiverId: string) => void;
}

interface FPSResult {
  isFirstPersonMode: boolean;
  setIsFirstPersonMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSpeckleFPS({
  isViewerReady,
  containerRef,
  exitFPSTrigger,
  goToReceiverId,
  goToPosition,
  goToPositionReceiverId,
  listenerOrientation,
  receivers,
  soundscapeData,
  selectedReceiverId,
  onReceiverModeChange,
  onFPSExited,
  onReceiverDoubleClicked,
}: FPSProps): FPSResult {
  const [isFirstPersonMode, setIsFirstPersonMode] = useState(false);
  const isFirstPersonModeRef = useRef(false);
  const prevReceiverModeRef = useRef<{ isActive: boolean; receiverId: string | null }>({
    isActive: false,
    receiverId: null,
  });

  // Keep ref in sync
  useEffect(() => {
    isFirstPersonModeRef.current = isFirstPersonMode;
  }, [isFirstPersonMode]);

  // Stable refs so the keyboard handler (empty deps) always calls the latest callbacks
  const onFPSExitedRef = useRef(onFPSExited);
  useEffect(() => { onFPSExitedRef.current = onFPSExited; });

  // ============================================================================
  // Effect - Keyboard Controls (arrow keys for look, Escape to exit)
  // Mirrors the backup's [] deps pattern: registered once, reads coordinator from
  // store at event time via getState() (same as coordinatorRef.current in backup).
  // isFirstPersonModeRef.current acts as the source-of-truth guard so that even if
  // the coordinator's internal flag diverges from React state, Escape still works.
  // ============================================================================
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Use React state ref as primary guard — reliable even if coordinator flag diverges
      if (!isFirstPersonModeRef.current) return;

      const { coordinator } = useSpeckleEngineStore.getState();
      if (!coordinator) return;

      const rotationSpeed = 0.05;

      switch (event.key) {
        case 'ArrowRight':
          coordinator.rotateFirstPersonView(rotationSpeed, 0);
          event.preventDefault();
          break;
        case 'ArrowLeft':
          coordinator.rotateFirstPersonView(-rotationSpeed, 0);
          event.preventDefault();
          break;
        case 'ArrowDown':
          coordinator.rotateFirstPersonView(0, -rotationSpeed);
          event.preventDefault();
          break;
        case 'ArrowUp':
          coordinator.rotateFirstPersonView(0, rotationSpeed);
          event.preventDefault();
          break;
        case 'Escape':
          coordinator.disableFirstPersonMode();
          setIsFirstPersonMode(false);
          onFPSExitedRef.current?.();
          event.preventDefault();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ============================================================================
  // Effect - Programmatic FPS exit (via exitFPSTrigger prop increment)
  // ============================================================================
  useEffect(() => {
    if (exitFPSTrigger == null || exitFPSTrigger === 0) return;
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator) return;
    coordinator.disableFirstPersonMode();
    setIsFirstPersonMode(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitFPSTrigger]);

  // ============================================================================
  // Effect - Capture-phase dblclick listener: exit FPS on double-click
  // ============================================================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDblClickCapture = (e: MouseEvent) => {
      if (!isFirstPersonMode) return;
      const { coordinator } = useSpeckleEngineStore.getState();
      if (coordinator?.hasCustomObjectAt(e.clientX, e.clientY)) return;
      coordinator?.disableFirstPersonMode();
      setIsFirstPersonMode(false);
      onFPSExited?.();
      e.stopPropagation();
    };

    container.addEventListener('dblclick', handleDblClickCapture, true);
    return () => container.removeEventListener('dblclick', handleDblClickCapture, true);
  }, [isFirstPersonMode, onFPSExited, containerRef]);

  // ============================================================================
  // Effect - Register receiver double-click callback (once coordinator is ready)
  // ============================================================================
  useEffect(() => {
    if (!isViewerReady) return;
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator) return;

    if (onReceiverDoubleClicked) {
      coordinator.setOnReceiverDoubleClicked(onReceiverDoubleClicked);
      coordinator.setOnGridListenerDoubleClicked((pointId: string) => {
        setIsFirstPersonMode(true);
        onReceiverDoubleClicked(pointId);
      });
    }
  }, [isViewerReady, onReceiverDoubleClicked]);

  // ============================================================================
  // Effect - Go To Receiver (First-Person Mode)
  // ============================================================================
  useEffect(() => {
    if (!goToReceiverId) return;
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator) return;

    const receiverManager = coordinator.getReceiverManager();
    if (!receiverManager) {
      console.warn('[useSpeckleFPS] Go to receiver: ReceiverManager not initialized');
      return;
    }

    const receiverMeshes = receiverManager.getReceiverMeshes();
    const receiverMesh = receiverMeshes.find(mesh => mesh.userData.receiverId === goToReceiverId);

    if (!receiverMesh) {
      console.warn('[useSpeckleFPS] Go to receiver: Receiver mesh not found:', goToReceiverId);
      return;
    }

    const receiverPosition = receiverMesh.position.clone();

    const initialTarget = new THREE.Vector3(
      receiverPosition.x + listenerOrientation.x,
      receiverPosition.y + listenerOrientation.y,
      receiverPosition.z + listenerOrientation.z
    );

    coordinator.enableFirstPersonMode(receiverPosition, initialTarget);
    setIsFirstPersonMode(true);
    coordinator.updateActiveReceiver(goToReceiverId);

    console.log('[useSpeckleFPS] Activated first-person mode for receiver:', {
      receiverId: goToReceiverId,
      position: receiverPosition.toArray(),
      target: initialTarget.toArray(),
    });
  }, [goToReceiverId, receivers, soundscapeData, listenerOrientation]);

  // ============================================================================
  // Effect - Go To Position (grid listener points with no individual mesh)
  // ============================================================================
  useEffect(() => {
    if (!goToPosition) return;
    const { coordinator } = useSpeckleEngineStore.getState();
    if (!coordinator) return;

    const receiverPosition = new THREE.Vector3(...goToPosition);
    const initialTarget = new THREE.Vector3(
      receiverPosition.x + listenerOrientation.x,
      receiverPosition.y + listenerOrientation.y,
      receiverPosition.z + listenerOrientation.z
    );

    coordinator.enableFirstPersonMode(receiverPosition, initialTarget);
    setIsFirstPersonMode(true);

    if (goToPositionReceiverId) {
      coordinator.updateActiveReceiver(goToPositionReceiverId);
    }
  }, [goToPosition, goToPositionReceiverId, listenerOrientation]);

  // ============================================================================
  // Effect - Notify Parent of Receiver Mode Changes (Change Detection)
  // ============================================================================
  useEffect(() => {
    if (!onReceiverModeChange) return;

    const receiverId = isFirstPersonMode
      ? (selectedReceiverId || (receivers.length > 0 ? receivers[0].id : null))
      : null;

    const prev = prevReceiverModeRef.current;
    if (prev.isActive !== isFirstPersonMode || prev.receiverId !== receiverId) {
      console.log('[useSpeckleFPS] Receiver mode changed:', { isFirstPersonMode, receiverId });
      onReceiverModeChange(isFirstPersonMode, receiverId);
      prevReceiverModeRef.current = { isActive: isFirstPersonMode, receiverId };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirstPersonMode, selectedReceiverId, receivers[0]?.id]);

  return { isFirstPersonMode, setIsFirstPersonMode };
}

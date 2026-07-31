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

  // Mouse joystick drag state (rate-based rotation)
  const leftDragRef = useRef(false);
  const rightDragRef = useRef(false);
  const leftOriginRef = useRef({ x: 0, y: 0 });
  const rightOriginXRef = useRef(0);
  const leftVecRef = useRef({ x: 0, y: 0 });
  const rollValRef = useRef(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);

  // Roll return-to-initial (roll-only debouncer): after releasing the right
  // button the roll eases back to the value captured when the drag started.
  const rollInitialRef = useRef(0);
  const rollReturningRef = useRef(false);

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
  // Effect - Mouse Joystick (left-drag yaw/pitch, right-drag roll)
  // Rate-based joystick: deflection from the press origin (clamped to MAX_THROW
  // px) drives a constant angular speed, scaled by frame delta. A RAF loop runs
  // while FPS mode is active and is cancelled on exit. Right-drag suppresses the
  // context menu. Registered only while isFirstPersonMode so the orbit camera is
  // unaffected.
  //
  // Uses Pointer Events (not Mouse Events): the Speckle viewer calls
  // preventDefault() on pointerdown, which suppresses the compatibility
  // mousedown/mouseup events entirely — a mouse-event joystick would never fire.
  // ============================================================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only run the joystick while first-person mode is active. Without this gate
    // the RAF loop and pointer handlers stay registered outside FPS mode, and a
    // normal orbit drag would call rotateFirstPersonView (warning + no-op).
    if (!isFirstPersonMode) return;

    const MAX_THROW = 70;        // px deflection for full turn rate
    const MAX_ANG_SPEED = 0.9;   // rad/s at full throw (yaw/pitch)
    const ROLL_MAX_ANG_SPEED = 0.3; // rad/s at full throw (roll) — slower, tilt is visually aggressive
    const ROLL_RETURN_RATE = 10;     // exponential easing rate (1/s) for roll return
    const ROLL_RETURN_SNAP_RAD = 0.01; // snap roll once within ~0.6° of the initial value
    const MAX_FRAME_DT = 0.1;    // cap dt to avoid rotation jumps after frame hitches

    // Reset any stale drag state from a previous FPS session
    leftDragRef.current = false;
    rightDragRef.current = false;
    rollReturningRef.current = false;
    leftVecRef.current = { x: 0, y: 0 };
    rollValRef.current = 0;
    lastTimeRef.current = 0;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button === 0) {
        leftDragRef.current = true;
        leftOriginRef.current = { x: event.clientX, y: event.clientY };
        leftVecRef.current = { x: 0, y: 0 };
      } else if (event.button === 2) {
        // Cancel any in-progress roll return and capture the roll to return to.
        rollReturningRef.current = false;
        rightDragRef.current = true;
        rightOriginXRef.current = event.clientX;
        rollValRef.current = 0;
        const { coordinator } = useSpeckleEngineStore.getState();
        const cam = coordinator?.getCameraController();
        rollInitialRef.current = cam?.isFirstPersonMode() ? cam.getListenerOrientation().roll : 0;
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (leftDragRef.current) {
        leftVecRef.current = {
          x: THREE.MathUtils.clamp(event.clientX - leftOriginRef.current.x, -MAX_THROW, MAX_THROW),
          y: THREE.MathUtils.clamp(event.clientY - leftOriginRef.current.y, -MAX_THROW, MAX_THROW),
        };
      }
      if (rightDragRef.current) {
        rollValRef.current = THREE.MathUtils.clamp(
          event.clientX - rightOriginXRef.current,
          -MAX_THROW,
          MAX_THROW
        );
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button === 0) {
        leftDragRef.current = false;
        leftVecRef.current = { x: 0, y: 0 };
      } else if (event.button === 2) {
        rightDragRef.current = false;
        rollValRef.current = 0;
        // Ease the roll back to where it was when this drag started.
        rollReturningRef.current = true;
      }
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const tick = (time: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = time;
      }
      const dt = Math.min((time - lastTimeRef.current) / 1000, MAX_FRAME_DT);
      lastTimeRef.current = time;

      if (dt > 0) {
        const { coordinator } = useSpeckleEngineStore.getState();
        if (coordinator) {
          // Yaw/pitch — left-drag joystick (rate-based).
          if (leftDragRef.current) {
            // Drag right → look right (+yaw, matches ArrowRight); drag down →
            // look down (-pitch, matches ArrowDown).
            const yaw = (leftVecRef.current.x / MAX_THROW) * MAX_ANG_SPEED * dt;
            const pitch = -(leftVecRef.current.y / MAX_THROW) * MAX_ANG_SPEED * dt;
            coordinator.rotateFirstPersonView(yaw, pitch, 0);
          }
          // Roll — right-drag joystick, or eased return to the initial roll.
          if (rightDragRef.current) {
            const roll = -(rollValRef.current / MAX_THROW) * ROLL_MAX_ANG_SPEED * dt;
            coordinator.rotateFirstPersonView(0, 0, roll);
          } else if (rollReturningRef.current) {
            const cam = coordinator.getCameraController();
            if (cam?.isFirstPersonMode()) {
              const currentRoll = cam.getListenerOrientation().roll;
              const diff = rollInitialRef.current - currentRoll;
              const step = diff * (1 - Math.exp(-ROLL_RETURN_RATE * dt));
              coordinator.rotateFirstPersonView(0, 0, step);
              if (Math.abs(diff) < ROLL_RETURN_SNAP_RAD) {
                coordinator.rotateFirstPersonView(0, 0, diff);
                rollReturningRef.current = false;
              }
            } else {
              rollReturningRef.current = false;
            }
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    };

    container.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('contextmenu', handleContextMenu);
    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      container.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('contextmenu', handleContextMenu);
      rollReturningRef.current = false;
      lastTimeRef.current = 0;
    };
  }, [isFirstPersonMode, containerRef]);

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

    // Check for per-receiver saved orientation
    const receiverData = receivers.find(r => r.id === goToReceiverId);
    const savedYaw = receiverData?.yaw ?? 0;
    const savedPitch = receiverData?.pitch ?? 0;
    const hasSavedOrientation = savedYaw !== 0 || savedPitch !== 0;

    let initialTarget: THREE.Vector3;
    if (hasSavedOrientation) {
      const dx = -Math.sin(savedYaw) * Math.cos(savedPitch);
      const dy = -Math.cos(savedYaw) * Math.cos(savedPitch);
      const dz = Math.sin(savedPitch);
      initialTarget = new THREE.Vector3(
        receiverPosition.x + dx,
        receiverPosition.y + dy,
        receiverPosition.z + dz
      );
    } else {
      initialTarget = new THREE.Vector3(
        receiverPosition.x + listenerOrientation.x,
        receiverPosition.y + listenerOrientation.y,
        receiverPosition.z + listenerOrientation.z
      );
    }

    coordinator.enableFirstPersonMode(receiverPosition, initialTarget, goToReceiverId);
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

    coordinator.enableFirstPersonMode(receiverPosition, initialTarget, goToPositionReceiverId);
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

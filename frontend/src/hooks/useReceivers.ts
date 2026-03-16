/**
 * useReceivers Hook
 *
 * Custom React hook for managing acoustic receiver spheres.
 *
 * Features:
 * - Create new receivers at default/specified positions (no click-to-place required)
 * - Delete receivers by ID
 * - Update receiver positions
 * - Update receiver names
 * - Receiver selection for simulation-based audio
 * - Unique ID generation using timestamp + random
 *
 * Architecture:
 * - Follows Single Responsibility Principle
 * - State management isolated in this hook
 * - Position updates use immutable patterns
 * - Receiver selection triggers audio updates
 * - Direct receiver creation (like sound spheres) - no placing mode
 */

import { useState, useCallback } from 'react';
import type { ReceiverData } from '@/types';
import { RECEIVER } from '@/utils/constants';

export interface UseReceiversProps {
  onReceiverSelected?: (receiverId: string) => void; // Callback when receiver is selected
  // boundingBox removed — placement is now camera-based (see handleAddReceiver in page.tsx)
}

export function useReceivers(props?: UseReceiversProps) {
  const { onReceiverSelected } = props || {};

  const [receivers, setReceivers] = useState<ReceiverData[]>([]);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null);

  /**
   * Fallback default position when no camera position is available.
   * Receivers are normally placed 2 m in front of the camera (see handleAddReceiver
   * in page.tsx). This fallback is only used when the viewer camera is not ready.
   */
  const calculateDefaultPosition = useCallback((index: number): [number, number, number] => {
    // ── Bounding-box / spiral strategy removed ────────────────────────────────
    // Receivers are now placed by the caller using the camera look direction.
    // if (boundingBox) {
    //   const { min, max } = boundingBox;
    //   const centerX = (min[0] + max[0]) / 2;
    //   const centerY = (min[1] + max[1]) / 2;
    //   const centerZ = (min[2] + max[2]) / 2;
    //   const offsetRadius = Math.min((max[0] - min[0]) / 4, (max[2] - min[2]) / 4);
    //   const angle = (index * Math.PI * 2) / 3;
    //   return [centerX + Math.cos(angle) * offsetRadius, centerY, centerZ + Math.sin(angle) * offsetRadius];
    // }
    // ─────────────────────────────────────────────────────────────────────────

    // Simple grid fallback at ear height
    const offsetX = (index % 3) * 2;
    const offsetZ = Math.floor(index / 3) * 2;
    return [
      RECEIVER.DEFAULT_POSITION[0] + offsetX,
      RECEIVER.DEFAULT_POSITION[1],
      RECEIVER.DEFAULT_POSITION[2] + offsetZ,
    ];
  }, []);

  // const calculateGrid = useCallback((index: number): [number, number, number][] => {
  //   // Use default position from constants (ear height)
  //   // Offset each receiver to avoid exact overlap
  //   const offsetX = (index % 3) * 2; // Simple grid offset
  //   const offsetZ = Math.floor(index / 3) * 2;

  //   return [
  //     [
  //       RECEIVER.DEFAULT_POSITION[0] + offsetX,
  //       RECEIVER.DEFAULT_POSITION[1],
  //       RECEIVER.DEFAULT_POSITION[2] + offsetZ
  //     ],
  //     [
  //       RECEIVER.DEFAULT_POSITION[0] + offsetX * 2,
  //       RECEIVER.DEFAULT_POSITION[1],
  //       RECEIVER.DEFAULT_POSITION[2] + offsetZ
  //     ]
  //   ];
  // }, []);

  /**
   * Add a new receiver at default or specified position
   * Works like sound sphere creation - no user click required
   *
   * Note: This function is called from onClick handlers, so we need to filter out React events
   */
  const addReceiver = useCallback((type: string = 'single', position?: [number, number, number]) => {
    setReceivers(prev => {
      // Use provided position or calculate default
      const newPosition: [number, number, number] = position ?? calculateDefaultPosition(prev.length);

      const newReceiver: ReceiverData = {
        id: `receiver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `Receiver ${prev.length + 1}`,
        position: newPosition,
        type: type,
      };
      return [...prev, newReceiver];
    });
  }, [calculateDefaultPosition]);

  /**
   * Add multiple receivers at once (grid pattern)
   * @param type - receiver type ('multiple')
   * @param n - number of receivers to add
   */
  const addGridReceiver = useCallback((type: string = 'multiple', n: number = 9) => {
    setReceivers(prev => {
      // Create an array of n new receivers
      const newReceivers: ReceiverData[] = [];

      for (let i = 0; i < n; i++) {
        const newReceiver: ReceiverData = {
          id: `receiver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${i}`,
          name: `Receiver ${prev.length + i + 1}`,
          position: calculateDefaultPosition(prev.length + i),  // Each gets unique position
          type: type,
        };
        newReceivers.push(newReceiver);
      }

      return [...prev, ...newReceivers];  // Add all new receivers to existing
    });
  }, [calculateDefaultPosition]);

  /**
   * Delete a receiver by ID
   */
  const deleteReceiver = useCallback((id: string) => {
    setReceivers(prev => prev.filter(r => r.id !== id));
  }, []);

  /**
   * Update receiver position
   * Used when dragging the sphere in 3D scene
   */
  const updateReceiverPosition = useCallback((id: string, position: [number, number, number]) => {
    setReceivers(prev =>
      prev.map(r =>
        r.id === id ? { ...r, position } : r
      )
    );
  }, []);

  /**
   * Update receiver name
   * Used when editing name in the UI
   */
  const updateReceiverName = useCallback((id: string, name: string) => {
    setReceivers(prev =>
      prev.map(r =>
        r.id === id ? { ...r, name } : r
      )
    );
  }, []);

  /**
   * Clear all receivers
   */
  const clearReceivers = useCallback(() => {
    setReceivers([]);
    setSelectedReceiverId(null);
  }, []);

  /**
   * Restore receivers from saved state (soundscape load)
   * Replaces current receivers and selection with saved data.
   */
  const restoreReceivers = useCallback((savedReceivers: ReceiverData[], savedSelectedId?: string | null) => {
    setReceivers(savedReceivers);
    if (savedSelectedId) {
      setSelectedReceiverId(savedSelectedId);
    }
  }, []);

  /**
   * Select a receiver (for simulation-based audio)
   * Triggers audio update via callback
   */
  const selectReceiver = useCallback((id: string) => {
    setSelectedReceiverId(id);

    // Notify parent component (e.g., ThreeScene) to update audio
    if (onReceiverSelected) {
      onReceiverSelected(id);
    }

    console.log('[useReceivers] Receiver selected:', id);
  }, [onReceiverSelected]);

  /**
   * Deselect current receiver
   */
  const deselectReceiver = useCallback(() => {
    setSelectedReceiverId(null);
    console.log('[useReceivers] Receiver deselected');
  }, []);

  return {
    receivers,
    selectedReceiverId,
    addReceiver,
    addGridReceiver,
    deleteReceiver,
    updateReceiverPosition,
    updateReceiverName,
    clearReceivers,
    selectReceiver,
    deselectReceiver,
    restoreReceivers,
  };
}

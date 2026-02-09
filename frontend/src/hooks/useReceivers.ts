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
  boundingBox?: { min: [number, number, number]; max: [number, number, number] }; // Optional bounding box for default positions
}

export function useReceivers(props?: UseReceiversProps) {
  const { onReceiverSelected, boundingBox } = props || {};

  const [receivers, setReceivers] = useState<ReceiverData[]>([]);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null);

  /**
   * Calculate a default position for a new receiver
   * - If bounding box is provided, place inside it
   * - Otherwise use default ear height position
   */
  const calculateDefaultPosition = useCallback((index: number): [number, number, number] => {
    if (boundingBox) {
      // Place receivers in a grid inside the bounding box
      const { min, max } = boundingBox;
      const centerX = (min[0] + max[0]) / 2;
      const centerY = (min[1] + max[1]) / 2;
      const centerZ = (min[2] + max[2]) / 2;

      // Offset each receiver slightly to avoid overlap
      const offsetRadius = Math.min(
        (max[0] - min[0]) / 4,
        (max[2] - min[2]) / 4
      );
      const angle = (index * Math.PI * 2) / 3; // Distribute in a circle

      return [
        centerX + Math.cos(angle) * offsetRadius,
        centerY, // Keep at center height
        centerZ + Math.sin(angle) * offsetRadius
      ];
    } else {
      // Use default position from constants (ear height)
      // Offset each receiver to avoid exact overlap
      const offsetX = (index % 3) * 2; // Simple grid offset
      const offsetZ = Math.floor(index / 3) * 2;

      return [
        RECEIVER.DEFAULT_POSITION[0] + offsetX,
        RECEIVER.DEFAULT_POSITION[1],
        RECEIVER.DEFAULT_POSITION[2] + offsetZ
      ];
    }
  }, [boundingBox]);

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
    deselectReceiver
  };
}

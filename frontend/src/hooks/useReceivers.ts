/**
 * useReceivers Hook
 *
 * Custom React hook for managing acoustic receiver spheres.
 *
 * Features:
 * - Create new receivers at default position
 * - Delete receivers by ID
 * - Update receiver positions
 * - Update receiver names
 * - Unique ID generation using timestamp + random
 *
 * Architecture:
 * - Follows Single Responsibility Principle
 * - State management isolated in this hook
 * - Position updates use immutable patterns
 */

import { useState, useCallback } from 'react';
import type { ReceiverData } from '@/types';

export function useReceivers() {
  const [receivers, setReceivers] = useState<ReceiverData[]>([]);
  const [isPlacingReceiver, setIsPlacingReceiver] = useState(false);

  /**
   * Start placing mode - user will click to place receiver
   */
  const startPlacingReceiver = useCallback(() => {
    setIsPlacingReceiver(true);
  }, []);

  /**
   * Cancel placing mode
   */
  const cancelPlacingReceiver = useCallback(() => {
    setIsPlacingReceiver(false);
  }, []);

  /**
   * Place a new receiver at the given position
   * Called when user clicks in 3D scene during placing mode
   */
  const placeReceiver = useCallback((position: [number, number, number]) => {
    const newReceiver: ReceiverData = {
      id: `receiver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `Receiver ${receivers.length + 1}`,
      position,
    };

    setReceivers(prev => [...prev, newReceiver]);
    setIsPlacingReceiver(false);
  }, [receivers.length]);

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
  }, []);

  return {
    receivers,
    isPlacingReceiver,
    startPlacingReceiver,
    placeReceiver,
    cancelPlacingReceiver,
    deleteReceiver,
    updateReceiverPosition,
    updateReceiverName,
    clearReceivers
  };
}

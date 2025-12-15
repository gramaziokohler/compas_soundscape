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
 * - Receiver selection for simulation-based audio
 * - Unique ID generation using timestamp + random
 *
 * Architecture:
 * - Follows Single Responsibility Principle
 * - State management isolated in this hook
 * - Position updates use immutable patterns
 * - Receiver selection triggers audio updates
 */

import { useState, useCallback } from 'react';
import type { ReceiverData } from '@/types';

export interface UseReceiversProps {
  onReceiverSelected?: (receiverId: string) => void; // Callback when receiver is selected
}

export function useReceivers(props?: UseReceiversProps) {
  const { onReceiverSelected } = props || {};

  const [receivers, setReceivers] = useState<ReceiverData[]>([]);
  const [isPlacingReceiver, setIsPlacingReceiver] = useState(false);
  const [selectedReceiverId, setSelectedReceiverId] = useState<string | null>(null);

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
    setReceivers(prev => {
      const newReceiver: ReceiverData = {
        id: `receiver-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: `Receiver ${prev.length + 1}`,
        position,
      };
      return [...prev, newReceiver];
    });
    setIsPlacingReceiver(false);
  }, []);

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
    isPlacingReceiver,
    selectedReceiverId,
    startPlacingReceiver,
    placeReceiver,
    cancelPlacingReceiver,
    deleteReceiver,
    updateReceiverPosition,
    updateReceiverName,
    clearReceivers,
    selectReceiver,
    deselectReceiver
  };
}

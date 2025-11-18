import { useState, useCallback, useEffect } from 'react';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { ResonanceRoomMaterial, ResonanceRoomDimensions } from '@/types/audio';
import { RESONANCE_AUDIO } from '@/lib/constants';

/**
 * Room Materials Hook
 *
 * Manages room acoustics properties for ShoeBox Acoustics mode.
 * Following the modular architecture pattern:
 * - Single Responsibility: Only manages room materials and dimensions
 * - Small and focused: ~80 lines
 * - Integrates with AudioOrchestrator's ResonanceMode
 *
 * Room materials affect acoustic absorption and reverb characteristics
 * in the synthetic room model used by ShoeBox Acoustics.
 *
 * @param audioOrchestrator - The audio orchestrator instance
 * @returns Room materials state and control functions
 */
export function useRoomMaterials(audioOrchestrator: AudioOrchestrator | null) {
  const [roomMaterials, setRoomMaterials] = useState<ResonanceRoomMaterial>(
    RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS
  );
  const [roomDimensions, setRoomDimensions] = useState<ResonanceRoomDimensions>(
    RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS
  );

  /**
   * Update room materials
   */
  const updateRoomMaterials = useCallback((materials: ResonanceRoomMaterial) => {
    console.log('[useRoomMaterials] updateRoomMaterials called:', materials);
    setRoomMaterials(materials);
  }, []);

  /**
   * Update room dimensions
   */
  const updateRoomDimensions = useCallback((dimensions: ResonanceRoomDimensions) => {
    console.log('[useRoomMaterials] updateRoomDimensions called:', dimensions);
    setRoomDimensions(dimensions);
  }, []);

  /**
   * Apply a room preset (predefined material configurations)
   */
  const applyRoomPreset = useCallback((presetName: string) => {
    const preset = (RESONANCE_AUDIO.ROOM_PRESETS as any)[presetName];
    if (!preset) {
      console.warn('[useRoomMaterials] Unknown preset:', presetName);
      return;
    }

    console.log('[useRoomMaterials] applyRoomPreset called:', presetName);
    setRoomMaterials(preset);
  }, []);

  /**
   * Sync room materials with AudioOrchestrator's ResonanceMode
   * This updates the ResonanceAudio room configuration when in ShoeBox Acoustics mode
   */
  useEffect(() => {
    if (!audioOrchestrator) return;

    console.log('[useRoomMaterials] Updating orchestrator room materials:', roomMaterials);
    audioOrchestrator.updateResonanceRoomMaterials(roomMaterials);
  }, [audioOrchestrator, roomMaterials]);

  /**
   * Sync room dimensions with AudioOrchestrator's ResonanceMode
   */
  useEffect(() => {
    if (!audioOrchestrator) return;

    console.log('[useRoomMaterials] Updating orchestrator room dimensions:', roomDimensions);
    audioOrchestrator.updateResonanceRoomDimensions(roomDimensions);
  }, [audioOrchestrator, roomDimensions]);

  /**
   * Reset to default state
   */
  const reset = useCallback(() => {
    setRoomMaterials(RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS);
    setRoomDimensions(RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS);
  }, []);

  return {
    roomMaterials,
    roomDimensions,
    updateRoomMaterials,
    updateRoomDimensions,
    applyRoomPreset,
    reset,
  };
}

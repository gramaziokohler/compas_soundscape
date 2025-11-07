import { useState, useCallback } from 'react';
import type { ResonanceAudioConfig, ResonanceRoomMaterial, ResonanceRoomDimensions } from '@/types/audio';
import { RESONANCE_AUDIO } from '@/lib/constants';

/**
 * Resonance Audio Hook
 * 
 * Manages Resonance Audio configuration state.
 * 
 * Features:
 * - Enable/disable toggle
 * - Room dimensions management
 * - Room materials management
 * - Room preset application
 * 
 * Following modular architecture:
 * - Single Responsibility: Only manages Resonance Audio state
 * - Separation of Concerns: UI logic separated from audio processing
 * - Reusable: Can be composed in any component
 * 
 * @returns Resonance Audio state and control functions
 */
export function useResonanceAudio() {
  const [config, setConfig] = useState<ResonanceAudioConfig>({
    enabled: false,
    ambisonicOrder: RESONANCE_AUDIO.DEFAULT_AMBISONIC_ORDER,
    roomDimensions: RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS,
    roomMaterials: RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS
  });

  /**
   * Enable/disable Resonance Audio
   */
  const toggleResonanceAudio = useCallback((enabled: boolean) => {
    console.log('[useResonanceAudio] toggleResonanceAudio called:', enabled);
    setConfig(prev => ({ ...prev, enabled }));
  }, []);

  /**
   * Update room dimensions
   */
  const updateRoomDimensions = useCallback((dimensions: ResonanceRoomDimensions) => {
    console.log('[useResonanceAudio] updateRoomDimensions called:', dimensions);
    setConfig(prev => ({ ...prev, roomDimensions: dimensions }));
  }, []);

  /**
   * Update room materials
   */
  const updateRoomMaterials = useCallback((materials: ResonanceRoomMaterial) => {
    console.log('[useResonanceAudio] updateRoomMaterials called:', materials);
    setConfig(prev => ({ ...prev, roomMaterials: materials }));
  }, []);

  /**
   * Apply a room preset
   */
  const applyRoomPreset = useCallback((presetName: string) => {
    const preset = (RESONANCE_AUDIO.ROOM_PRESETS as any)[presetName];
    if (!preset) {
      console.warn('[useResonanceAudio] Unknown preset:', presetName);
      return;
    }

    console.log('[useResonanceAudio] applyRoomPreset called:', presetName);
    setConfig(prev => ({ 
      ...prev, 
      roomMaterials: preset 
    }));
  }, []);

  /**
   * Reset to default configuration
   */
  const reset = useCallback(() => {
    setConfig({
      enabled: false,
      ambisonicOrder: RESONANCE_AUDIO.DEFAULT_AMBISONIC_ORDER,
      roomDimensions: RESONANCE_AUDIO.DEFAULT_ROOM_DIMENSIONS,
      roomMaterials: RESONANCE_AUDIO.DEFAULT_ROOM_MATERIALS
    });
  }, []);

  return {
    config,
    toggleResonanceAudio,
    updateRoomDimensions,
    updateRoomMaterials,
    applyRoomPreset,
    reset
  };
}

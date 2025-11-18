/**
 * useAudioOrchestrator Hook
 *
 * React hook for managing the AudioOrchestrator lifecycle and state.
 * Provides a clean API for components to interact with the new audio system.
 *
 * Features:
 * - Automatic initialization and cleanup
 * - Mode switching with smooth transitions  
 * - IR loading and management
 * - Real-time status updates
 * - Error handling with recovery
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';
import type { 
  AudioMode, 
  AudioModeConfig, 
  OrchestratorStatus, 
  AmbisonicOrder 
} from '@/types/audio';

export function useAudioOrchestrator() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const orchestratorRef = useRef<AudioOrchestrator | null>(null);

  const [isInitialized, setIsInitialized] = useState(false);
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize orchestrator
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initAudio = async () => {
      try {
        console.log('[useAudioOrchestrator] Initializing...');
        
        // Create audio context
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) {
          throw new Error('Web Audio API not supported');
        }
        
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;

        // Create and initialize orchestrator
        const orchestrator = new AudioOrchestrator();
        await orchestrator.initialize(audioContext);
        
        orchestratorRef.current = orchestrator;
        setIsInitialized(true);
        
        // Get initial status
        const initialStatus = orchestrator.getStatus();
        setStatus(initialStatus);

        console.log('[useAudioOrchestrator] Initialized successfully');
        console.log('  - Initial mode:', initialStatus.currentMode);
      } catch (err) {
        console.error('[useAudioOrchestrator] Initialization failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize audio');
        setIsInitialized(false);
      }
    };

    initAudio();

    // Cleanup on unmount
    return () => {
      console.log('[useAudioOrchestrator] Cleaning up...');
      
      if (orchestratorRef.current) {
        orchestratorRef.current.dispose();
      }
      
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(err => {
          console.warn('[useAudioOrchestrator] AudioContext close error:', err);
        });
      }
    };
  }, []);

  // Update status periodically
  useEffect(() => {
    if (!orchestratorRef.current || !isInitialized) return;
    
    const updateStatus = () => {
      const currentStatus = orchestratorRef.current!.getStatus();
      setStatus(currentStatus);
    };
    
    const intervalId = setInterval(updateStatus, 100);
    
    return () => clearInterval(intervalId);
  }, [isInitialized]);

  // Set audio mode
  const setMode = useCallback(async (config: AudioModeConfig) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Setting mode:', config.mode);
      await orchestratorRef.current.setMode(config);
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] Mode set successfully');
    } catch (err) {
      console.error('[useAudioOrchestrator] Mode change failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to change mode');
      throw err;
    }
  }, []);

  // Load impulse response
  const loadImpulseResponse = useCallback(async (file: File) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Loading IR:', file.name);
      await orchestratorRef.current.loadImpulseResponse(file);
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] IR loaded successfully');
    } catch (err) {
      console.error('[useAudioOrchestrator] IR load failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to load IR');
      throw err;
    }
  }, []);

  // Select (activate) IR
  const selectImpulseResponse = useCallback(async () => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Selecting IR...');
      await orchestratorRef.current.selectImpulseResponse();
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] IR selected');
    } catch (err) {
      console.error('[useAudioOrchestrator] IR selection failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to select IR');
      throw err;
    }
  }, []);

  // Deselect IR
  const deselectImpulseResponse = useCallback(async () => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Deselecting IR...');
      await orchestratorRef.current.deselectImpulseResponse();
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] IR deselected');
    } catch (err) {
      console.error('[useAudioOrchestrator] IR deselection failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to deselect IR');
      throw err;
    }
  }, []);

  // Clear IR
  const clearImpulseResponse = useCallback(async () => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Clearing IR...');
      await orchestratorRef.current.clearImpulseResponse();
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] IR cleared');
    } catch (err) {
      console.error('[useAudioOrchestrator] IR clear failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to clear IR');
      throw err;
    }
  }, []);

  // Set ambisonic order
  const setAmbisonicOrder = useCallback(async (order: AmbisonicOrder) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      console.log('[useAudioOrchestrator] Setting ambisonic order:', order);
      await orchestratorRef.current.setAmbisonicOrder(order);
      
      const newStatus = orchestratorRef.current.getStatus();
      setStatus(newStatus);
      
      console.log('[useAudioOrchestrator] Ambisonic order set');
    } catch (err) {
      console.error('[useAudioOrchestrator] Ambisonic order change failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to change ambisonic order');
      throw err;
    }
  }, []);

  // Set no-IR preference
  const setNoIRPreference = useCallback((mode: 'basic_mixer' | 'resonance' | 'anechoic') => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    orchestratorRef.current.setNoIRPreference(mode);
    
    const newStatus = orchestratorRef.current.getStatus();
    setStatus(newStatus);
  }, []);

  // Set stereo IR interpretation
  const setStereoIRInterpretation = useCallback((mode: 'binaural' | 'speaker') => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    orchestratorRef.current.setStereoIRInterpretation(mode);
  }, []);

  // Get IR state
  const getIRState = useCallback(() => {
    if (!orchestratorRef.current) {
      return { isImported: false, isSelected: false };
    }
    return orchestratorRef.current.getIRState();
  }, []);

  // Get supported orders
  const getSupportedOrders = useCallback(() => {
    if (!orchestratorRef.current) {
      return { foa: false, soa: false, toa: false };
    }
    return orchestratorRef.current.getSupportedOrders();
  }, []);

  // Get warnings
  const getWarnings = useCallback(() => {
    if (!orchestratorRef.current) {
      return [];
    }
    return orchestratorRef.current.getWarnings();
  }, []);

  // Clear warnings
  const clearWarnings = useCallback(() => {
    if (!orchestratorRef.current) return;
    orchestratorRef.current.clearWarnings();
  }, []);

  // Set normalization (for IR modes)
  const setNormalize = useCallback((normalize: boolean) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }
    orchestratorRef.current.setNormalize(normalize);
  }, []);

  // Update Resonance room materials
  const updateResonanceRoomMaterials = useCallback((materials: any) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }
    orchestratorRef.current.updateResonanceRoomMaterials(materials);
  }, []);

  // Update Resonance room dimensions
  const updateResonanceRoomDimensions = useCallback((dimensions: any) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }
    orchestratorRef.current.updateResonanceRoomDimensions(dimensions);
  }, []);

  // Set receiver mode
  const setReceiverMode = useCallback((isActive: boolean, receiverId?: string, hasReceivers?: boolean) => {
    if (!orchestratorRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    console.log('[useAudioOrchestrator] Setting receiver mode:', { isActive, receiverId, hasReceivers });
    orchestratorRef.current.setReceiverMode(isActive, receiverId, hasReceivers);

    // Clear warnings when receiver mode is activated
    if (isActive) {
      orchestratorRef.current.clearWarnings();
    }

    const newStatus = orchestratorRef.current.getStatus();
    setStatus(newStatus);
  }, []);

  return {
    orchestrator: orchestratorRef.current,
    audioContext: audioContextRef.current,
    isInitialized,
    status,
    error,
    setMode,
    loadImpulseResponse,
    selectImpulseResponse,
    deselectImpulseResponse,
    clearImpulseResponse,
    setAmbisonicOrder,
    setNoIRPreference,
    setStereoIRInterpretation,
    getIRState,
    getSupportedOrders,
    getWarnings,
    clearWarnings,
    setNormalize,
    updateResonanceRoomMaterials,
    updateResonanceRoomDimensions,
    setReceiverMode
  };
}

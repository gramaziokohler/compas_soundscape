/**
 * useAudioOrchestrator Hook
 *
 * React hook for managing the AudioOrchestrator.
 * Provides access to audio rendering modes, IR handling, and status.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { AudioOrchestrator } from '@/services/audio/AudioOrchestrator';
import { ImpulseResponseHandler } from '@/services/audio/ImpulseResponseHandler';
import {
  AudioRenderMode,
  OutputDecoderType
} from '@/services/audio/types';
import type {
  RenderingModeConfig,
  OrchestratorStatus,
  IRMetadata
} from '@/services/audio/types';

export function useAudioOrchestrator() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const orchestratorRef = useRef<AudioOrchestrator | null>(null);
  const irHandlerRef = useRef<ImpulseResponseHandler | null>(null);

  const [isInitialized, setIsInitialized] = useState(false);
  const [currentMode, setCurrentMode] = useState<AudioRenderMode>(AudioRenderMode.NO_IR_THREEJS);
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [outputDecoder, setOutputDecoderType] = useState<OutputDecoderType>(
    'binaural_hrtf' as OutputDecoderType
  );
  const [preferredNoIRMode, setPreferredNoIRMode] = useState<'threejs' | 'resonance'>('threejs');

  // Initialize orchestrator
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Create audio context
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;

    // Create orchestrator and IR handler
    const orchestrator = new AudioOrchestrator();
    const irHandler = new ImpulseResponseHandler();

    orchestrator.initialize(audioContext);
    orchestratorRef.current = orchestrator;
    irHandlerRef.current = irHandler;

    setIsInitialized(true);
    setCurrentMode(orchestrator.getCurrentMode());
    setStatus(orchestrator.getStatus());

    console.log('[useAudioOrchestrator] Initialized');

    return () => {
      orchestrator.dispose();
      audioContext.close();
    };
  }, []);

  // Update status when mode changes
  useEffect(() => {
    if (orchestratorRef.current) {
      setStatus(orchestratorRef.current.getStatus());
    }
  }, [currentMode]);

  const setRenderingMode = useCallback((config: RenderingModeConfig) => {
    if (!orchestratorRef.current) return;

    orchestratorRef.current.setRenderingMode(config);
    setCurrentMode(orchestratorRef.current.getCurrentMode());
    setStatus(orchestratorRef.current.getStatus());
  }, []);

  const setOutputDecoder = useCallback((type: OutputDecoderType) => {
    if (!orchestratorRef.current) return;

    orchestratorRef.current.setOutputDecoder(type);
    setOutputDecoderType(type);
    setStatus(orchestratorRef.current.getStatus());
  }, []);

  const updateReceiverMode = useCallback((isActive: boolean, receiverId: string | null) => {
    if (!orchestratorRef.current) return;

    orchestratorRef.current.setReceiverMode(isActive, receiverId);

    // Get new status and only update if it changed
    const newStatus = orchestratorRef.current.getStatus();
    setStatus(prevStatus => {
      // Compare relevant fields to prevent unnecessary re-renders
      if (!prevStatus ||
          prevStatus.isReceiverModeActive !== newStatus.isReceiverModeActive ||
          prevStatus.isIRActive !== newStatus.isIRActive ||
          prevStatus.uiNotice !== newStatus.uiNotice) {
        return newStatus;
      }
      return prevStatus;
    });
  }, []);

  const loadImpulseResponse = useCallback(async (file: File): Promise<IRMetadata | null> => {
    if (!irHandlerRef.current || !audioContextRef.current) {
      throw new Error('Orchestrator not initialized');
    }

    try {
      const metadata = await irHandlerRef.current.loadIR(file, audioContextRef.current);

      // Update rendering mode with new IR
      setRenderingMode({
        irMetadata: metadata,
        preferredNoIRMode
      });

      return metadata;
    } catch (error) {
      console.error('[useAudioOrchestrator] Error loading IR:', error);
      throw error;
    }
  }, [preferredNoIRMode, setRenderingMode]);

  const clearImpulseResponse = useCallback(() => {
    if (!irHandlerRef.current) return;

    irHandlerRef.current.clearIR();

    // Revert to No IR mode
    setRenderingMode({
      irMetadata: null,
      preferredNoIRMode
    });
  }, [preferredNoIRMode, setRenderingMode]);

  const updateNoIRMode = useCallback((mode: 'threejs' | 'resonance') => {
    setPreferredNoIRMode(mode);

    // If currently in No IR mode, update immediately
    if (!irHandlerRef.current?.getIRMetadata()) {
      setRenderingMode({
        irMetadata: null,
        preferredNoIRMode: mode
      });
    }
  }, [setRenderingMode]);

  return {
    orchestrator: orchestratorRef.current,
    audioContext: audioContextRef.current,
    isInitialized,
    currentMode,
    status,
    outputDecoder,
    preferredNoIRMode,
    setRenderingMode,
    setOutputDecoder,
    updateReceiverMode,
    updateNoIRMode,
    loadImpulseResponse,
    clearImpulseResponse
  };
}

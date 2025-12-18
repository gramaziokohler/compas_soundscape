import { useState, useCallback, useRef } from 'react';
import type { AnalysisConfig, AnalysisResult, AnalysisType, TextPromptResult, ModelAnalysisConfig, AudioAnalysisConfig, TextAnalysisConfig } from '@/types/analysis';
import { API_BASE_URL, DEFAULT_NUM_SOUNDS, DEFAULT_SPL_DB, LLM_SUGGESTED_INTERVAL_SECONDS } from '@/lib/constants';
import { loadAudioFileWithBuffer } from '@/lib/audio/audio-info';
import { apiService } from '@/services/api';
import { useErrorNotification } from '@/contexts/ErrorContext';

/**
 * useAnalysis Hook
 * 
 * Manages state for the Analysis section (3D Model, Audio, Text contexts)
 * Handles analysis execution and result management
 * Integrates with existing backend services
 */
export function useAnalysis() {
  const { addError } = useErrorNotification();
  const [analysisConfigs, setAnalysisConfigs] = useState<AnalysisConfig[]>([
    // Default: One 3D model context tab
    {
      type: '3d-model',
      numSounds: 5,
      modelFile: null,
      modelEntities: [],
      selectedDiverseEntities: [],
      useModelAsContext: true
    }
  ]);
  
  const [activeAnalysisTab, setActiveAnalysisTab] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);

  // Add a new analysis config
  const handleAddConfig = useCallback((type: AnalysisType) => {
    const newConfig: AnalysisConfig = type === '3d-model'
      ? {
          type: '3d-model',
          numSounds: 5,
          modelFile: null,
          modelEntities: [],
          selectedDiverseEntities: [],
          useModelAsContext: true
        }
      : type === 'audio'
      ? {
          type: 'audio',
          numSounds: 5,
          audioFile: null,
          audioInfo: null,
          audioBuffer: null,
          analysisOptions: { analyze_amplitudes: true, analyze_durations: true, analyze_frequencies: false }
        }
      : {
          type: 'text',
          numSounds: 5,
          textInput: '',
          useModelAsContext: false
        };

    setAnalysisConfigs(prev => [...prev, newConfig]);
    setActiveAnalysisTab(analysisConfigs.length);
  }, [analysisConfigs.length]);

  // Remove an analysis config
  const handleRemoveConfig = useCallback((index: number) => {
    setAnalysisConfigs(prev => prev.filter((_, i) => i !== index));
    setAnalysisResults(prev => prev.filter(r => r.configIndex !== index));
    
    // Adjust active tab if needed
    if (activeAnalysisTab >= analysisConfigs.length - 1) {
      setActiveAnalysisTab(Math.max(0, analysisConfigs.length - 2));
    }
  }, [activeAnalysisTab, analysisConfigs.length]);

  // Update an analysis config
  const handleUpdateConfig = useCallback((index: number, updates: Partial<AnalysisConfig>) => {
    setAnalysisConfigs(prev => prev.map((config, i) => 
      i === index ? { ...config, ...updates } as AnalysisConfig : config
    ));
  }, []);

  // Handle file upload for 3D model
  const handleModelFileUpload = useCallback(async (index: number, file: File) => {
    const config = analysisConfigs[index] as ModelAnalysisConfig;
    if (config.type !== '3d-model') return;

    try {
      // Upload file using existing API service to get geometry data
      const geometryData = await apiService.uploadFile(file);
      
      // Analyze file to get proper entities with position and bounds
      const fileName = file.name.toLowerCase();
      let entities: any[] = [];
      
      if (fileName.endsWith('.3dm')) {
        const analyzed = await apiService.analyze3dm(file);
        entities = analyzed.entities;
      } else if (fileName.endsWith('.ifc')) {
        const analyzed = await apiService.analyzeIfc();
        entities = analyzed.entities;
      } else if (fileName.endsWith('.obj')) {
        const analyzed = await apiService.analyzeObj(file);
        entities = analyzed.entities;
      } else {
        // Fallback to face_entity_map extraction (less complete)
        entities = geometryData.face_entity_map
          ? Array.from(new Set(geometryData.face_entity_map)).map((entityIdx) => ({
              index: entityIdx,
              type: 'Unknown',
              name: `Entity ${entityIdx}`,
              position: [0, 0, 0],
              bounds: { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0] }
            }))
          : [];
      }

      // Update config with loaded data including geometryData
      handleUpdateConfig(index, {
        modelFile: file,
        modelEntities: entities,
        geometryData: geometryData,
      } as Partial<ModelAnalysisConfig>);

    } catch (error) {
      console.error('[useAnalysis] Model upload failed:', error);
      setAnalysisError(error instanceof Error ? error.message : 'Failed to upload model');
    }
  }, [analysisConfigs, handleUpdateConfig]);

  // Handle file upload for audio
  const handleAudioFileUpload = useCallback(async (index: number, file: File) => {
    const config = analysisConfigs[index] as AudioAnalysisConfig;
    if (config.type !== 'audio') return;

    try {
      // Load audio info and buffer for visualization
      const result = await loadAudioFileWithBuffer(file);
      if (result) {
        handleUpdateConfig(index, {
          audioFile: file,
          audioInfo: result.audioInfo,
          audioBuffer: result.audioBuffer,
        } as Partial<AudioAnalysisConfig>);
      } else {
        throw new Error('Failed to load audio file');
      }
    } catch (error) {
      console.error('[useAnalysis] Audio load failed:', error);
      setAnalysisError(error instanceof Error ? error.message : 'Failed to load audio');
    }
  }, [analysisConfigs, handleUpdateConfig]);

  // Execute analysis for a specific config
  const handleAnalyze = useCallback(async (index: number) => {
    const config = analysisConfigs[index];
    if (!config) return;

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      let prompts: TextPromptResult[] = [];

      if (config.type === '3d-model') {
        const modelConfig = config as ModelAnalysisConfig;
        
        if (modelConfig.modelEntities.length === 0) {
          throw new Error('No 3D model loaded');
        }

        // Check if we should do entity selection or prompt generation
        if (modelConfig.selectedDiverseEntities.length === 0) {
          // Step 1: Only select diverse entities (no prompt generation yet)
          const selectionResponse = await fetch(`${API_BASE_URL}/api/select-entities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entities: modelConfig.modelEntities,
              max_sounds: config.numSounds
            })
          });

          if (!selectionResponse.ok) {
            throw new Error('Failed to select diverse entities');
          }

          const selectionResult = await selectionResponse.json();
          const selectedEntities = selectionResult.selected_entities;

          // Update config with selected entities
          handleUpdateConfig(index, {
            selectedDiverseEntities: selectedEntities
          } as Partial<ModelAnalysisConfig>);

          setIsAnalyzing(false);
          setAnalysisError(null);
          // Return early - don't generate prompts yet
          return;
        } else {
          // Step 2: Generate sound prompts from already-selected entities
          const textResponse = await fetch(`${API_BASE_URL}/api/generate-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: '',
              num_sounds: config.numSounds,
              entities: modelConfig.selectedDiverseEntities
            })
          });

          if (!textResponse.ok) {
            throw new Error('Failed to generate sound prompts');
          }

          const textResult = await textResponse.json();
          
          // Format prompts with entity associations
          prompts = textResult.prompts.map((p: any, i: number) => ({
            id: `${index}-${i}`,
            text: p.prompt,
            selected: true,
            entity: p.entity || null, // Preserve entity association from backend
            metadata: {
              spl_db: p.spl_db || DEFAULT_SPL_DB,
              interval_seconds: p.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
              duration_seconds: p.duration_seconds || 10
            }
          }));
        }

      } else if (config.type === 'audio') {
        const audioConfig = config as AudioAnalysisConfig;
        
        if (!audioConfig.audioFile) {
          throw new Error('No audio file uploaded');
        }

        // Analyze sound events using SED
        const formData = new FormData();
        formData.append('file', audioConfig.audioFile);
        formData.append('num_sounds', config.numSounds.toString());
        formData.append('analyze_amplitudes', audioConfig.analysisOptions.analyze_amplitudes.toString());
        formData.append('analyze_durations', audioConfig.analysisOptions.analyze_durations.toString());
        formData.append('top_n_classes', '100');

        const response = await fetch(`${API_BASE_URL}/api/analyze-sound-events`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          throw new Error('Failed to analyze sound events');
        }

        const result = await response.json();
        
        // Format prompts from detected sounds
        prompts = result.detected_sounds
          .filter((s: any) => s.confidence > 0)
          .slice(0, config.numSounds)
          .map((sound: any, i: number) => {
            // Map max_amplitude_db (dBFS) to SPL
            let volumeSPL = DEFAULT_SPL_DB;
            if (audioConfig.analysisOptions.analyze_amplitudes && sound.max_amplitude_db !== null && isFinite(sound.max_amplitude_db)) {
              const dbFS = Math.max(-60, Math.min(-3, sound.max_amplitude_db));
              volumeSPL = 30 + ((dbFS + 60) / 57) * 55;
              volumeSPL = Math.round(volumeSPL * 10) / 10;
            }
            
            // Map max_silence_duration_sec to interval
            let playbackInterval = LLM_SUGGESTED_INTERVAL_SECONDS;
            if (audioConfig.analysisOptions.analyze_durations && sound.max_silence_duration_sec !== null && sound.max_silence_duration_sec !== undefined) {
              playbackInterval = Math.max(5, Math.min(120, sound.max_silence_duration_sec));
              playbackInterval = Math.round(playbackInterval * 10) / 10;
            }
            
            // Estimate duration from audio event duration if available
            let estimatedDuration = 10; // Default
            if (sound.avg_event_duration_sec && sound.avg_event_duration_sec > 0) {
              estimatedDuration = Math.max(3, Math.min(30, sound.avg_event_duration_sec));
              estimatedDuration = Math.round(estimatedDuration * 10) / 10;
            }
            
            return {
              id: `${index}-${i}`,
              text: sound.name,
              selected: true,
              metadata: {
                confidence: sound.confidence,
                spl_db: volumeSPL,
                interval_seconds: playbackInterval,
                duration_seconds: estimatedDuration
              }
            };
          });

      } else if (config.type === 'text') {
        const textConfig = config as TextAnalysisConfig;
        
        if (!textConfig.textInput.trim()) {
          throw new Error('Please enter a text description');
        }

        // Get model entities if "use model as context" is checked
        let entitiesToUse: any[] = [];
        if (textConfig.useModelAsContext) {
          // Find the latest 3D model config with entities
          const modelConfigs = analysisConfigs.filter(c => c.type === '3d-model') as ModelAnalysisConfig[];
          if (modelConfigs.length > 0) {
            const latestModelConfig = modelConfigs[modelConfigs.length - 1];
            // Use selectedDiverseEntities if available, otherwise all entities
            entitiesToUse = latestModelConfig.selectedDiverseEntities.length > 0 
              ? latestModelConfig.selectedDiverseEntities 
              : latestModelConfig.modelEntities;
          }
        }

        // Generate sound prompts from text using LLM
        const requestBody: any = {
          prompt: textConfig.textInput,
          num_sounds: config.numSounds
        };
        
        // Add entities if using model as context
        if (entitiesToUse.length > 0) {
          requestBody.entities = entitiesToUse;
        }

        const response = await fetch(`${API_BASE_URL}/api/generate-text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ detail: 'Failed to generate sound prompts' }));
          const errorMessage = err.detail || 'Failed to generate sound prompts';
          
          // Format quota errors nicely
          if (response.status === 429) {
            if (errorMessage.includes('quota')) {
              throw new Error(`⚠️ ${errorMessage}`);
            } else {
              throw new Error('⚠️ API quota exhausted. Please try again later.');
            }
          }
          
          throw new Error(errorMessage);
        }

        const result = await response.json();
        
        // Format prompts with entity associations (if entities were used)
        prompts = result.prompts.map((p: any, i: number) => ({
          id: `${index}-${i}`,
          text: p.prompt,
          selected: true,
          entity: p.entity || null, // Preserve entity association if using model as context
          metadata: {
            spl_db: p.spl_db || DEFAULT_SPL_DB,
            interval_seconds: p.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS,
            duration_seconds: p.duration_seconds || 10
          }
        }));
      }

      // Store results
      const result: AnalysisResult = {
        configIndex: index,
        prompts,
        generatedAt: new Date()
      };

      setAnalysisResults(prev => {
        const existing = prev.findIndex(r => r.configIndex === index);
        if (existing >= 0) {
          return prev.map((r, i) => i === existing ? result : r);
        }
        return [...prev, result];
      });

    } catch (error) {
      console.error('[useAnalysis] Analysis failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Analysis failed';
      const isQuotaError = errorMsg.includes('quota') || errorMsg.includes('429');
      
      setAnalysisError(errorMsg);
      addError(errorMsg, isQuotaError ? 'warning' : 'error');
    } finally {
      setIsAnalyzing(false);
    }
  }, [analysisConfigs, handleUpdateConfig, addError]);

  // Stop ongoing analysis
  const handleStopAnalysis = useCallback(() => {
    setIsAnalyzing(false);
    // TODO: Cancel backend request
  }, []);

  // Toggle prompt selection
  const handleTogglePromptSelection = useCallback((configIndex: number, promptId: string) => {
    setAnalysisResults(prev => prev.map(result => {
      if (result.configIndex !== configIndex) return result;
      
      return {
        ...result,
        prompts: result.prompts.map(p => 
          p.id === promptId ? { ...p, selected: !p.selected } : p
        )
      };
    }));
  }, []);

  // Send selected prompts to sound generation
  const handleSendToSoundGeneration = useCallback((onSuccess?: (prompts: TextPromptResult[]) => void) => {
    const allSelectedPrompts = analysisResults.flatMap(result => 
      result.prompts.filter(p => p.selected)
    );
    
    console.log('[useAnalysis] Sending prompts to generation:', allSelectedPrompts);
    
    // Call success callback if provided
    if (onSuccess) {
      onSuccess(allSelectedPrompts);
    }
    
    return allSelectedPrompts;
  }, [analysisResults]);

  // Reset an analysis (remove result, keep config)
  const handleReset = useCallback((index: number) => {
    setAnalysisResults(prev => prev.filter(r => r.configIndex !== index));
  }, []);

  return {
    analysisConfigs,
    activeAnalysisTab,
    isAnalyzing,
    analysisError,
    analysisResults,
    setActiveAnalysisTab,
    handleAddConfig,
    handleRemoveConfig,
    handleUpdateConfig,
    handleAnalyze,
    handleStopAnalysis,
    handleTogglePromptSelection,
    handleSendToSoundGeneration,
    handleReset,
    handleModelFileUpload,
    handleAudioFileUpload
  };
}

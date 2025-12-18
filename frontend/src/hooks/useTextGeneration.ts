import { useState, useCallback, useRef } from "react";
import {
  API_BASE_URL,
  DEFAULT_NUM_SOUNDS,
  UI_TIMING,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_SEED_COPIES,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_SPL_DB,
  LLM_SUGGESTED_INTERVAL_SECONDS,
  LLM_RETRY
} from "@/lib/constants";
import { ActiveTab } from "@/types";
import { useErrorNotification } from "@/contexts/ErrorContext";

export function useTextGeneration(modelEntities: any[], useModelAsContext: boolean) {
  const { addError } = useErrorNotification();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [numSounds, setNumSounds] = useState(DEFAULT_NUM_SOUNDS);
  const [llmProgress, setLlmProgress] = useState("");
  const [showConfirmLoadSounds, setShowConfirmLoadSounds] = useState(false);
  const [pendingSoundConfigs, setPendingSoundConfigs] = useState<any[]>([]);
  const [activeAiTab, setActiveAiTab] = useState<ActiveTab>('text');
  const [selectedDiverseEntities, setSelectedDiverseEntities] = useState<any[]>([]);
  const [isAnalyzingEntities, setIsAnalyzingEntities] = useState(false);

  // AbortController for cancelling ongoing requests
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Analyze 3D model and select diverse entities (LLM Step 1)
   * This is separate from sound generation to give users control
   */
  const handleAnalyzeModel = useCallback(async () => {
    if (modelEntities.length === 0) {
      setAiError("No 3D model loaded.");
      return;
    }

    // Store previous selection in case of error
    const previousSelection = [...selectedDiverseEntities];

    setAiError(null);
    setIsAnalyzingEntities(true);
    setLlmProgress('');

    // Create a new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      if (modelEntities.length > numSounds) {
        setLlmProgress(`Selecting ${numSounds} most diverse objects from ${modelEntities.length} total... (Auto-retry enabled)`);
      } else {
        setLlmProgress(`Analyzing ${modelEntities.length} objects from 3D model... (Auto-retry enabled)`);
      }

      // Call backend to select diverse entities
      const selectionResponse = await fetch(`${API_BASE_URL}/api/select-entities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entities: modelEntities,
          max_sounds: numSounds
        }),
        signal: abortControllerRef.current.signal
      });

      if (!selectionResponse.ok) {
        const errorData = await selectionResponse.json().catch(() => ({}));
        const errorMessage = errorData.detail || 'Failed to select diverse entities';
        throw new Error(errorMessage);
      }

      const selectionResult = await selectionResponse.json();
      const selectedEntities = selectionResult.selected_entities;

      // Show selected entities with highlighting
      setSelectedDiverseEntities(selectedEntities);
      setLlmProgress(`Analysis complete! Selected ${selectedEntities.length} diverse objects.`);

      // Clear progress after a delay
      setTimeout(() => setLlmProgress(''), 2000);

    } catch (err: any) {
      // Restore previous selection on error
      if (previousSelection.length > 0) {
        setSelectedDiverseEntities(previousSelection);
      }

      // Don't show error if request was aborted intentionally
      if (err.name === 'AbortError') {
        setAiError('Analysis stopped by user.');
      } else {
        // Show graceful error message
        const isOverloaded = err.message.includes('overloaded') || err.message.includes('503') || err.message.includes('UNAVAILABLE');
        if (isOverloaded) {
          setAiError(
            `⏳ LLM service is overloaded even after ${LLM_RETRY.MAX_ATTEMPTS} retry attempts. ` +
            `Please try again in a moment. ` +
            (previousSelection.length > 0 ? 'Previous selection kept.' : '')
          );
        } else {
          setAiError(err.message);
        }
      }
      setLlmProgress('');
    } finally {
      setIsAnalyzingEntities(false);
      abortControllerRef.current = null;
    }
  }, [modelEntities, numSounds, selectedDiverseEntities]);

  const handleGenerateText = useCallback(async () => {
    // Only use entities if checkbox is checked
    const shouldUseEntities = modelEntities.length > 0 && useModelAsContext;

    if (!shouldUseEntities && !aiPrompt.trim()) {
      setAiError("Please enter a space description.");
      return;
    }
    setAiError(null);
    setAiResponse(null);
    setIsGenerating(true);
    setShowConfirmLoadSounds(false);
    setLlmProgress('');

    // Create a new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      const requestBody: any = {
        prompt: aiPrompt || undefined,
        num_sounds: numSounds
      };

      // Step 1: Use pre-analyzed entities or select new ones
      let selectedEntities = null;
      if (shouldUseEntities) {
        // Check if entities were already analyzed
        if (selectedDiverseEntities.length > 0) {
          // Use pre-analyzed entities (from handleAnalyzeModel)
          selectedEntities = selectedDiverseEntities;
          const entityCount = selectedEntities.length;
          if (numSounds > entityCount) {
            setLlmProgress(`Generating ${numSounds} sound prompts (${entityCount} entity-linked + ${numSounds - entityCount} context sounds)...`);
          } else if (numSounds < entityCount) {
            setLlmProgress(`Generating ${numSounds} sound prompts from ${entityCount} selected objects...`);
          } else {
            setLlmProgress(`Generating ${numSounds} sound prompts for selected objects...`);
          }
        } else {
          // No pre-analysis, select entities now
          if (modelEntities.length > numSounds) {
            setLlmProgress(`Selecting ${numSounds} most diverse objects from ${modelEntities.length} total... (Auto-retry enabled)`);
          } else {
            setLlmProgress(`Analyzing ${modelEntities.length} objects from 3D model... (Auto-retry enabled)`);
          }

          // Call backend to select diverse entities
          const selectionResponse = await fetch(`${API_BASE_URL}/api/select-entities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entities: modelEntities,
              max_sounds: numSounds
            }),
            signal: abortControllerRef.current.signal
          });

          if (selectionResponse.ok) {
            const selectionResult = await selectionResponse.json();
            selectedEntities = selectionResult.selected_entities;

            // Show selected entities with highlighting
            setSelectedDiverseEntities(selectedEntities);
            setLlmProgress(`Selected ${selectedEntities.length} objects. Generating sound prompts...`);

            // Give time for highlighting to be visible
            await new Promise(resolve => setTimeout(resolve, UI_TIMING.ENTITY_HIGHLIGHT_DELAY_MS));
          } else {
            // Fallback: use all entities
            requestBody.entities = modelEntities;
          }
        }

        if (selectedEntities) {
          // Use selected entities for prompt generation
          requestBody.entities = selectedEntities;
          // Keep user-specified num_sounds (allows mixed generation: entity-linked + context sounds)
          // e.g., 5 entities + 7 sounds = 5 entity-linked + 2 context sounds
          requestBody.num_sounds = numSounds;
        }
      }

      // Step 3: Generate prompts
      const response = await fetch(`${API_BASE_URL}/api/generate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail);
      }

      const result = await response.json();
      setLlmProgress('');

      // Handle both text-only and entity-based responses
      if (result.prompts && result.prompts.length > 0) {
        // Check if entity-based or text-based by checking for entity field
        const hasEntities = result.prompts.some((item: any) => item.entity);

        if (hasEntities) {
          // Entity-based prompts (from loaded model)
          const newSoundConfigsWithEntities = result.prompts.map((item: any) => ({
            prompt: item.prompt,
            duration: item.duration_seconds || 5, // Use LLM-estimated duration
            guidance_scale: 4.5,
            negative_prompt: "",
            seed_copies: 1,
            steps: 25,
            entity: item.entity, // Store entity for position info
            display_name: item.display_name, // Store LLM-generated display name
            spl_db: item.spl_db || 70.0, // Store LLM-estimated SPL level
            interval_seconds: item.interval_seconds || 30.0 // Store LLM-estimated interval
          }));
          setPendingSoundConfigs(newSoundConfigsWithEntities);
          setShowConfirmLoadSounds(true);

          // Update highlighted entities to match what the backend actually used
          // This ensures consistency between highlighting and sound positioning
          if (result.selected_entities) {
            // Verify backend used the same entities we selected
            const backendIndices = result.selected_entities.map((e: any) => e.index).sort().join(',');
            const currentIndices = (selectedEntities || []).map((e: any) => e.index).sort().join(',');
            if (backendIndices !== currentIndices) {
              // Backend selected different entities, update to match
              setSelectedDiverseEntities(result.selected_entities);
            }
          } else if (!selectedEntities) {
            // Fallback: extract entities from prompts if no selected_entities returned
            const entitiesFromPrompts = result.prompts.map((item: any) => item.entity).filter(Boolean);
            if (entitiesFromPrompts.length > 0) {
              setSelectedDiverseEntities(entitiesFromPrompts);
            }
          }

          // Backend now properly parses prompts - just display them directly
          const displayText = result.prompts.map((item: any, idx: number) =>
            `${idx + 1}. ${item.prompt}`
          ).join('\n');
          setAiResponse(displayText);
        } else {
          // Text-only prompts (no model loaded)
          const newSoundConfigs = result.prompts.map((item: any) => ({
            prompt: item.prompt,
            duration: item.duration_seconds || DEFAULT_DURATION_SECONDS, // Use LLM-estimated duration
            guidance_scale: DEFAULT_GUIDANCE_SCALE,
            negative_prompt: "",
            seed_copies: DEFAULT_SEED_COPIES,
            steps: DEFAULT_DIFFUSION_STEPS,
            display_name: item.display_name, // Store LLM-generated display name
            spl_db: item.spl_db || DEFAULT_SPL_DB, // Store LLM-estimated SPL level
            interval_seconds: item.interval_seconds || LLM_SUGGESTED_INTERVAL_SECONDS // Store LLM-estimated interval
          }));
          setPendingSoundConfigs(newSoundConfigs);
          setShowConfirmLoadSounds(true);

          // Backend now properly parses prompts - just display them directly
          setAiResponse(result.prompts.map((item: any, idx: number) =>
            `${idx + 1}. ${item.prompt}`
          ).join('\n'));
        }
      } else if (result.sounds && result.sounds.length > 0) {
        // Legacy format - Text-only prompts (no model loaded)
        const newSoundConfigs = result.sounds.map((soundDesc: string) => ({
          prompt: soundDesc,
          duration: DEFAULT_DURATION_SECONDS,
          guidance_scale: DEFAULT_GUIDANCE_SCALE,
          negative_prompt: "",
          seed_copies: DEFAULT_SEED_COPIES,
          steps: DEFAULT_DIFFUSION_STEPS
        }));
        setPendingSoundConfigs(newSoundConfigs);
        setShowConfirmLoadSounds(true);
        setAiResponse(result.text);
      } else if (result.text) {
        // Fallback: just text response
        setAiResponse(result.text);
        setShowConfirmLoadSounds(false);
      }
    } catch (err: any) {
      // Don't show error if request was aborted intentionally
      if (err.name === 'AbortError') {
        const errorMsg = 'Generation stopped by user.';
        setAiError(errorMsg);
        addError(errorMsg, 'info');
      } else {
        // Show graceful error message for API overload
        const isOverloaded = err.message.includes('overloaded') || err.message.includes('503') || err.message.includes('UNAVAILABLE');
        const isQuotaError = err.message.includes('quota') || err.message.includes('429');
        
        let errorMsg: string;
        let errorType: 'error' | 'warning' = 'error';
        
        if (isQuotaError) {
          errorMsg = err.message;
          errorType = 'warning';
        } else if (isOverloaded) {
          errorMsg = `⏳ LLM service is overloaded even after ${LLM_RETRY.MAX_ATTEMPTS} retry attempts. ` +
            `The system automatically retried with exponential backoff. Please try again in a moment.`;
          errorType = 'warning';
        } else {
          errorMsg = err.message;
        }
        
        setAiError(errorMsg);
        addError(errorMsg, errorType);
      }
      setLlmProgress('');
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [aiPrompt, numSounds, modelEntities, useModelAsContext, selectedDiverseEntities]);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      setIsAnalyzingEntities(false);
      setLlmProgress('');
      setAiError('Generation stopped by user.');
    }
  }, []);

  /**
   * Clear analyzed entities (call when model changes or is unloaded)
   */
  const handleClearAnalysis = useCallback(() => {
    setSelectedDiverseEntities([]);
    setAiError(null);
    setLlmProgress('');
  }, []);

  return {
    aiPrompt,
    aiResponse,
    aiError,
    isGenerating,
    isAnalyzingEntities,
    numSounds,
    llmProgress,
    showConfirmLoadSounds,
    pendingSoundConfigs,
    activeAiTab,
    selectedDiverseEntities,
    setAiPrompt,
    setNumSounds,
    setActiveAiTab,
    handleGenerateText,
    handleAnalyzeModel,
    handleStopGeneration,
    handleClearAnalysis,
    setPendingSoundConfigs,
    setSelectedDiverseEntities
  };
}

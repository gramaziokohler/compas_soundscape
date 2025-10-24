import { useState, useCallback } from "react";
import {
  API_BASE_URL,
  DEFAULT_NUM_SOUNDS,
  ENTITY_HIGHLIGHT_DELAY_MS,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_SEED_COPIES,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_SPL_DB,
  LLM_SUGGESTED_INTERVAL_SECONDS
} from "@/lib/constants";
import { ActiveTab } from "@/types";

export function useTextGeneration(modelEntities: any[], useModelAsContext: boolean) {
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

    try {
      const requestBody: any = {
        prompt: aiPrompt || undefined,
        num_sounds: numSounds
      };

      // Step 1: Select diverse entities first (if using model)
      let selectedEntities = null;
      if (shouldUseEntities) {
        if (modelEntities.length > numSounds) {
          setLlmProgress(`Selecting ${numSounds} most diverse objects from ${modelEntities.length} total...`);
        } else {
          setLlmProgress(`Analyzing ${modelEntities.length} objects from 3D model...`);
        }

        // Call backend to select diverse entities first
        const selectionResponse = await fetch(`${API_BASE_URL}/api/select-entities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entities: modelEntities,
            max_sounds: numSounds
          }),
        });

        if (selectionResponse.ok) {
          const selectionResult = await selectionResponse.json();
          selectedEntities = selectionResult.selected_entities;

          // Step 2: Show selected entities with highlighting
          setSelectedDiverseEntities(selectedEntities);
          setLlmProgress(`Selected ${selectedEntities.length} objects. Generating sound prompts...`);

          // Give time for highlighting to be visible
          await new Promise(resolve => setTimeout(resolve, ENTITY_HIGHLIGHT_DELAY_MS));

          // Use selected entities for prompt generation
          requestBody.entities = selectedEntities;
        } else {
          // Fallback: use all entities
          requestBody.entities = modelEntities;
        }
      }

      // Step 3: Generate prompts
      const response = await fetch(`${API_BASE_URL}/api/generate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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

          // Keep the already-selected entities for highlighting (don't override)
          // If we didn't pre-select, use the entities from the response
          if (!selectedEntities && result.selected_entities) {
            setSelectedDiverseEntities(result.selected_entities);
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
      setAiError(err.message);
      setLlmProgress('');
    } finally {
      setIsGenerating(false);
    }
  }, [aiPrompt, numSounds, modelEntities, useModelAsContext]);

  return {
    aiPrompt,
    aiResponse,
    aiError,
    isGenerating,
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
    setPendingSoundConfigs,
    setSelectedDiverseEntities
  };
}

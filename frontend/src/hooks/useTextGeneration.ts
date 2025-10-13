import { useState, useCallback } from "react";
import { API_BASE_URL } from "@/lib/constants";
import { ActiveTab } from "@/types";

export function useTextGeneration(modelEntities: any[], useModelAsContext: boolean) {
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [numSounds, setNumSounds] = useState(5);
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

      // Only send entities if checkbox is checked
      if (shouldUseEntities) {
        requestBody.entities = modelEntities;
        if (modelEntities.length > numSounds) {
          setLlmProgress(`Selecting ${numSounds} most diverse objects from ${modelEntities.length} total...`);
        }
      }

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
            duration: 5,
            guidance_scale: 4.5,
            negative_prompt: "",
            seed_copies: 1,
            entity: item.entity, // Store entity for position info
            display_name: item.display_name // Store LLM-generated display name
          }));
          setPendingSoundConfigs(newSoundConfigsWithEntities);
          setShowConfirmLoadSounds(true);

          // Store the selected diverse entities for highlighting
          const entities = result.prompts.map((item: any) => item.entity);
          setSelectedDiverseEntities(entities);

          // Backend now properly parses prompts - just display them directly
          const displayText = result.prompts.map((item: any, idx: number) =>
            `${idx + 1}. ${item.prompt}`
          ).join('\n');
          setAiResponse(displayText);
        } else {
          // Text-only prompts (no model loaded)
          const newSoundConfigs = result.prompts.map((item: any) => ({
            prompt: item.prompt,
            duration: 5,
            guidance_scale: 4.5,
            negative_prompt: "",
            seed_copies: 1,
            display_name: item.display_name // Store LLM-generated display name
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
          duration: 5,
          guidance_scale: 4.5,
          negative_prompt: "",
          seed_copies: 1
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

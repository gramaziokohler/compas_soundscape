import { useState, useCallback } from "react";
import { API_BASE_URL } from "@/lib/constants";
import { ActiveTab } from "@/types";

export function useTextGeneration(modelEntities: any[]) {
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [numSounds, setNumSounds] = useState(5);
  const [llmProgress, setLlmProgress] = useState("");
  const [showConfirmLoadSounds, setShowConfirmLoadSounds] = useState(false);
  const [pendingSoundConfigs, setPendingSoundConfigs] = useState<any[]>([]);
  const [activeAiTab, setActiveAiTab] = useState<ActiveTab>('text');

  const handleGenerateText = useCallback(async () => {
    if (modelEntities.length === 0 && !aiPrompt.trim()) {
      setAiError("Please load a model or enter a space description.");
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

      if (modelEntities.length > 0) {
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
        // Entity-based prompts (from loaded model)
        const newSoundConfigsWithEntities = result.prompts.map((item: any) => ({
          prompt: item.prompt,
          duration: 5,
          guidance_scale: 4.5,
          negative_prompt: "",
          seed_copies: 1,
          entity: item.entity // Store entity for position info
        }));
        setPendingSoundConfigs(newSoundConfigsWithEntities);
        setShowConfirmLoadSounds(true);

        // Create display text from prompts
        const displayText = result.prompts.map((item: any, idx: number) =>
          `${idx + 1}. ${item.prompt}`
        ).join('\n');
        setAiResponse(displayText);
      } else if (result.sounds && result.sounds.length > 0) {
        // Text-only prompts (no model loaded)
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
  }, [aiPrompt, numSounds, modelEntities]);

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
    setAiPrompt,
    setNumSounds,
    setActiveAiTab,
    handleGenerateText,
    setPendingSoundConfigs
  };
}

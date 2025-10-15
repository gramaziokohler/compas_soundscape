import { useState, useCallback } from "react";
import { SoundGenerationConfig } from "@/types";
import { API_BASE_URL } from "@/lib/constants";

export function useSoundGeneration(geometryBounds: {min: number[], max: number[]} | null) {
  const [soundConfigs, setSoundConfigs] = useState<SoundGenerationConfig[]>([
    { prompt: "", duration: 5, guidance_scale: 4.5, negative_prompt: "", seed_copies: 1, steps: 25 }
  ]);
  const [activeSoundConfigTab, setActiveSoundConfigTab] = useState<number>(0);
  const [isSoundGenerating, setIsSoundGenerating] = useState<boolean>(false);
  const [soundGenError, setSoundGenError] = useState<string | null>(null);
  const [generatedSounds, setGeneratedSounds] = useState<any[]>([]);
  const [soundscapeData, setSoundscapeData] = useState<any[] | null>(null);
  const [globalDuration, setGlobalDuration] = useState<number>(5);
  const [globalSteps, setGlobalSteps] = useState<number>(25);
  const [globalNegativePrompt, setGlobalNegativePrompt] = useState<string>("distorted, reverb, echo, background noise, hall, spaciousness");
  const [applyDenoising, setApplyDenoising] = useState<boolean>(false);

  const handleAddConfig = useCallback(() => {
    setSoundConfigs([...soundConfigs, { prompt: "", duration: globalDuration, guidance_scale: 4.5, negative_prompt: "", seed_copies: 1, steps: globalSteps }]);
    setActiveSoundConfigTab(soundConfigs.length);
  }, [soundConfigs, globalDuration, globalSteps]);

  const handleRemoveConfig = useCallback((index: number) => {
    setSoundConfigs(soundConfigs.filter((_, i) => i !== index));
    if (activeSoundConfigTab >= soundConfigs.length - 1) {
      setActiveSoundConfigTab(Math.max(0, soundConfigs.length - 2));
    }
  }, [soundConfigs, activeSoundConfigTab]);

  const handleUpdateConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: string | number) => {
    const updated = [...soundConfigs];
    updated[index] = { ...updated[index], [field]: value };
    setSoundConfigs(updated);
  }, [soundConfigs]);

  const handleGlobalDurationChange = useCallback((duration: number) => {
    setGlobalDuration(duration);
    // Update all existing sound configs with the new duration
    const updated = soundConfigs.map(config => ({
      ...config,
      duration
    }));
    setSoundConfigs(updated);
  }, [soundConfigs]);

  const handleGlobalStepsChange = useCallback((steps: number) => {
    setGlobalSteps(steps);
    // Update all existing sound configs with the new steps
    const updated = soundConfigs.map(config => ({
      ...config,
      steps
    }));
    setSoundConfigs(updated);
  }, [soundConfigs]);

  const handleGenerate = useCallback(async () => {
    const validConfigs = soundConfigs.filter(config => config.prompt.trim() !== "");
    if (validConfigs.length === 0) {
      setSoundGenError("Please enter at least one sound prompt.");
      return;
    }
    setSoundGenError(null);
    setIsSoundGenerating(true);
    try {
      // Check if configs have entity data (from loaded model)
      const hasEntities = validConfigs.some((config: any) => config.entity);

      // Apply global negative prompt to all configs
      const configsWithNegativePrompt = validConfigs.map(config => ({
        ...config,
        negative_prompt: globalNegativePrompt
      }));

      const response = await fetch(`${API_BASE_URL}/api/generate-sounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sounds: configsWithNegativePrompt,
          // Only use bounding_box for random positioning when no entity data exists
          bounding_box: hasEntities ? null : geometryBounds,
          apply_denoising: applyDenoising
        }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail);
      }
      const result = await response.json();

      const soundEvents = result.sounds.map((sound: any) => {
        // The backend already handles positioning correctly
        // For entity-based sounds, it uses the entity position
        // For random sounds, it uses the bounding box
        return {
          ...sound,
          position: sound.position,
          geometry: sound.geometry || {
            vertices: [],
            faces: []
          }
        };
      });

      setGeneratedSounds(soundEvents);

      if (soundEvents.length > 0) {
        setSoundscapeData(soundEvents);
      }
    } catch (err: any) {
      setSoundGenError(err.message);
    } finally {
      setIsSoundGenerating(false);
    }
  }, [soundConfigs, geometryBounds, globalNegativePrompt, applyDenoising]);

  const setSoundConfigsFromPrompts = useCallback((prompts: any[]) => {
    setSoundConfigs(prompts);
  }, []);

  return {
    soundConfigs,
    activeSoundConfigTab,
    isSoundGenerating,
    soundGenError,
    generatedSounds,
    soundscapeData,
    globalDuration,
    globalSteps,
    globalNegativePrompt,
    applyDenoising,
    handleAddConfig,
    handleRemoveConfig,
    handleUpdateConfig,
    handleGenerate,
    handleGlobalDurationChange,
    handleGlobalStepsChange,
    setActiveSoundConfigTab,
    setSoundConfigsFromPrompts,
    setSoundscapeData,
    setGlobalNegativePrompt,
    setApplyDenoising
  };
}

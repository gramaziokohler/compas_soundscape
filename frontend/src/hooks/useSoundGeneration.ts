import { useState, useCallback } from "react";
import { SoundGenerationConfig, SoundGenerationMode, LibrarySearchResult, LibrarySearchState } from "@/types";
import { API_BASE_URL } from "@/lib/constants";
import { loadAudioFile, revokeAudioUrl } from "@/lib/audio/audio-upload";

export function useSoundGeneration(geometryBounds: {min: number[], max: number[]} | null) {
  const [soundConfigs, setSoundConfigs] = useState<SoundGenerationConfig[]>([
    { prompt: "", duration: 5, guidance_scale: 4.5, negative_prompt: "", seed_copies: 1, steps: 25, mode: 'text-to-audio' }
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
    setSoundConfigs([...soundConfigs, { prompt: "", duration: globalDuration, guidance_scale: 4.5, negative_prompt: "", seed_copies: 1, steps: globalSteps, mode: 'text-to-audio' }]);
    setActiveSoundConfigTab(soundConfigs.length);
  }, [soundConfigs, globalDuration, globalSteps]);

  const handleRemoveConfig = useCallback((index: number) => {
    setSoundConfigs(soundConfigs.filter((_, i) => i !== index));
    if (activeSoundConfigTab >= soundConfigs.length - 1) {
      setActiveSoundConfigTab(Math.max(0, soundConfigs.length - 2));
    }
  }, [soundConfigs, activeSoundConfigTab]);

  const handleUpdateConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: string | number | SoundGenerationMode) => {
    const updated = [...soundConfigs];
    updated[index] = { ...updated[index], [field]: value };
    setSoundConfigs(updated);
  }, [soundConfigs]);

  const handleModeChange = useCallback((index: number, mode: SoundGenerationMode) => {
    const updated = [...soundConfigs];
    const config = updated[index];

    // Clear uploaded audio data when switching away from upload mode
    // This prevents confusion and ensures clean state transitions
    if (config.mode === 'upload' && mode !== 'upload' && config.uploadedAudioUrl) {
      revokeAudioUrl(config.uploadedAudioUrl);
      updated[index] = {
        ...config,
        mode,
        uploadedAudioBuffer: undefined,
        uploadedAudioInfo: undefined,
        uploadedAudioUrl: undefined
      };
    } else {
      updated[index] = { ...config, mode };
    }

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
    // Separate configs by mode and track their original indices
    const uploadedConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) => config.mode === 'upload' && config.uploadedAudioUrl);

    const libraryConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) => config.mode === 'library' && config.selectedLibrarySound);

    const generationConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) =>
        (config.mode === 'text-to-audio' || !config.mode) &&
        !config.uploadedAudioUrl &&
        config.prompt.trim() !== ""
      );

    if (generationConfigsWithIndices.length === 0 && uploadedConfigsWithIndices.length === 0 && libraryConfigsWithIndices.length === 0) {
      setSoundGenError("Please enter at least one sound prompt or upload an audio file.");
      return;
    }

    setSoundGenError(null);
    setIsSoundGenerating(true);

    try {
      let generatedEvents: any[] = [];
      let uploadedEvents: any[] = [];
      let libraryEvents: any[] = [];

      // Generate sounds for text-to-audio mode
      if (generationConfigsWithIndices.length > 0) {
        // Check if configs have entity data (from loaded model)
        const hasEntities = generationConfigsWithIndices.some(({ config }) => config.entity);

        // Apply global negative prompt to all configs
        const configsWithNegativePrompt = generationConfigsWithIndices.map(({ config }) => ({
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

        // Map backend response to correct original indices
        generatedEvents = result.sounds.map((sound: any) => {
          // Backend returns prompt_index based on the array we sent (0-indexed)
          // We need to map it back to the original soundConfigs index
          const backendIndex = sound.prompt_index;
          const actualOriginalIndex = generationConfigsWithIndices[backendIndex]?.originalIndex ?? backendIndex;

          return {
            ...sound,
            prompt_index: actualOriginalIndex, // Use the ACTUAL original index
            position: sound.position,
            geometry: sound.geometry || {
              vertices: [],
              faces: []
            }
          };
        });
      }

      // Create sound events for uploaded audio configs
      if (uploadedConfigsWithIndices.length > 0) {
        uploadedEvents = uploadedConfigsWithIndices.map(({ config, originalIndex }) => {
          // Use entity position if available, otherwise use bounding box center
          let position: [number, number, number];
          if (config.entity?.position) {
            position = config.entity.position;
          } else if (geometryBounds) {
            const center = [
              (geometryBounds.min[0] + geometryBounds.max[0]) / 2,
              (geometryBounds.min[1] + geometryBounds.max[1]) / 2,
              (geometryBounds.min[2] + geometryBounds.max[2]) / 2
            ];
            position = center as [number, number, number];
          } else {
            position = [0, 0, 0];
          }

          return {
            id: `uploaded-${originalIndex}-0`,
            url: config.uploadedAudioUrl!,
            position: position,
            geometry: config.entity?.geometry || {
              vertices: [],
              faces: []
            },
            display_name: config.display_name || config.uploadedAudioInfo?.filename || `Uploaded ${originalIndex + 1}`,
            prompt: config.prompt || 'Uploaded audio',
            prompt_index: originalIndex, // Use the ACTUAL original index
            total_copies: 1,
            // Default to 70 dB (same as generated sounds) for proper volume
            volume_db: config.spl_db ?? 70,
            // Default to 30 seconds interval (same as TTA sounds)
            interval_seconds: config.interval_seconds ?? 30,
            // Mark as uploaded so ThreeScene knows to handle it differently
            isUploaded: true
          };
        });
      }

      // Handle library search mode - download and use selected sounds
      if (libraryConfigsWithIndices.length > 0) {
        for (const { config, originalIndex } of libraryConfigsWithIndices) {
          if (!config.selectedLibrarySound) {
            console.log(`[Sound Generation] No sound selected for library config ${originalIndex}`);
            continue;
          }

          try {
            console.log(`[Sound Generation] Downloading library sound: ${config.selectedLibrarySound.description}`);

            // Download the sound from BBC library
            const downloadResponse = await fetch(`${API_BASE_URL}/api/library/download`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                location: config.selectedLibrarySound.location,
                description: config.selectedLibrarySound.description
              })
            });

            if (!downloadResponse.ok) {
              throw new Error('Failed to download sound');
            }

            // Get the audio file as blob
            const audioBlob = await downloadResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // Position calculation (same as uploaded sounds)
            let position: [number, number, number];
            if (config.entity?.position) {
              position = config.entity.position;
            } else if (geometryBounds) {
              const center = [
                (geometryBounds.min[0] + geometryBounds.max[0]) / 2,
                (geometryBounds.min[1] + geometryBounds.max[1]) / 2,
                (geometryBounds.min[2] + geometryBounds.max[2]) / 2
              ];
              position = center as [number, number, number];
            } else {
              position = [0, 0, 0];
            }

            // Create sound event (same structure as uploaded sounds)
            libraryEvents.push({
              id: `library-${originalIndex}-0`,
              url: audioUrl,
              position: position,
              geometry: config.entity?.geometry || {
                vertices: [],
                faces: []
              },
              display_name: config.display_name || config.selectedLibrarySound.description,
              prompt: config.prompt || config.selectedLibrarySound.description,
              prompt_index: originalIndex,
              total_copies: 1,
              volume_db: config.spl_db ?? 70,
              interval_seconds: config.interval_seconds ?? 30,
              isUploaded: true // Treat library sounds same as uploaded
            });

            console.log(`[Sound Generation] Library sound added: ${config.selectedLibrarySound.description}`);
          } catch (error) {
            console.error(`[Sound Generation] Failed to download library sound:`, error);
          }
        }
      }

      // Combine generated, uploaded, and library sounds
      const allSoundEvents = [...generatedEvents, ...uploadedEvents, ...libraryEvents];

      setGeneratedSounds(allSoundEvents);

      if (allSoundEvents.length > 0) {
        setSoundscapeData(allSoundEvents);
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

  /**
   * Upload audio file for a specific sound config
   * This loads the audio, decodes it, and stores the buffer/info
   * When uploaded, the sound will use this audio instead of generating
   */
  const handleUploadAudio = useCallback(async (index: number, file: File) => {
    try {
      console.log(`[Sound Generation] Uploading audio for sound ${index + 1}:`, file.name);

      // Load audio file and get buffer + metadata
      const result = await loadAudioFile(file);

      // Update the config with uploaded audio data
      const updated = [...soundConfigs];
      updated[index] = {
        ...updated[index],
        uploadedAudioBuffer: result.audioBuffer,
        uploadedAudioInfo: result.audioInfo,
        uploadedAudioUrl: result.audioUrl,
        // Optionally update display name from filename if not set
        display_name: updated[index].display_name || result.audioInfo.filename.replace(/\.[^/.]+$/, "")
      };
      setSoundConfigs(updated);

      console.log(`[Sound Generation] Audio uploaded successfully for sound ${index + 1}`);
    } catch (error) {
      console.error(`[Sound Generation] Failed to upload audio for sound ${index + 1}:`, error);
      setSoundGenError(error instanceof Error ? error.message : 'Failed to upload audio file');
    }
  }, [soundConfigs]);

  /**
   * Clear uploaded audio from a specific sound config
   * Revokes the object URL and removes audio data from config
   */
  const handleClearUploadedAudio = useCallback((index: number) => {
    const config = soundConfigs[index];

    // Revoke object URL if it exists to free memory
    if (config?.uploadedAudioUrl) {
      revokeAudioUrl(config.uploadedAudioUrl);
    }

    // Remove uploaded audio data from config
    const updated = [...soundConfigs];
    updated[index] = {
      ...updated[index],
      uploadedAudioBuffer: undefined,
      uploadedAudioInfo: undefined,
      uploadedAudioUrl: undefined
    };
    setSoundConfigs(updated);

    console.log(`[Sound Generation] Cleared uploaded audio for sound ${index + 1}`);
  }, [soundConfigs]);

  /**
   * Search BBC Sound Library for a specific sound config
   */
  const handleLibrarySearch = useCallback(async (index: number) => {
    const config = soundConfigs[index];
    const prompt = config.prompt.trim();

    if (!prompt) {
      return;
    }

    // Initialize search state
    const updated = [...soundConfigs];
    updated[index] = {
      ...updated[index],
      librarySearchState: {
        isSearching: true,
        results: [],
        selectedSound: null,
        error: null
      }
    };
    setSoundConfigs(updated);

    try {
      console.log(`[Library Search] Searching for: ${prompt}`);

      const response = await fetch(`${API_BASE_URL}/api/library/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, max_results: 5 })
      });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();

      const updatedAfterSearch = [...soundConfigs];
      updatedAfterSearch[index] = {
        ...updatedAfterSearch[index],
        librarySearchState: {
          isSearching: false,
          results: data.results || [],
          selectedSound: null,
          error: null
        }
      };
      setSoundConfigs(updatedAfterSearch);

      console.log(`[Library Search] Found ${data.results?.length || 0} results`);
    } catch (error) {
      console.error(`[Library Search] Error:`, error);

      const updatedAfterError = [...soundConfigs];
      updatedAfterError[index] = {
        ...updatedAfterError[index],
        librarySearchState: {
          isSearching: false,
          results: [],
          selectedSound: null,
          error: 'Search failed. Please try again.'
        }
      };
      setSoundConfigs(updatedAfterError);
    }
  }, [soundConfigs]);

  /**
   * Select a sound from library search results
   */
  const handleLibrarySoundSelect = useCallback((index: number, sound: LibrarySearchResult) => {
    const updated = [...soundConfigs];
    updated[index] = {
      ...updated[index],
      selectedLibrarySound: sound,
      display_name: updated[index].display_name || sound.description,
      librarySearchState: updated[index].librarySearchState ? {
        ...updated[index].librarySearchState!,
        selectedSound: sound
      } : undefined
    };
    setSoundConfigs(updated);

    console.log(`[Library Search] Selected sound: ${sound.description}`);
  }, [soundConfigs]);

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
    handleModeChange,
    handleGenerate,
    handleGlobalDurationChange,
    handleGlobalStepsChange,
    setActiveSoundConfigTab,
    setSoundConfigsFromPrompts,
    setSoundscapeData,
    setGlobalNegativePrompt,
    setApplyDenoising,
    handleUploadAudio,
    handleClearUploadedAudio,
    handleLibrarySearch,
    handleLibrarySoundSelect
  };
}

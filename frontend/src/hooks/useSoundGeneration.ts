import { useState, useCallback, useRef, useEffect } from "react";
import { SoundGenerationConfig, CardType, LibrarySearchResult, LibrarySearchState } from "@/types";
import {
  API_BASE_URL,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_DIFFUSION_STEPS,
  DEFAULT_SEED_COPIES,
  DEFAULT_AUDIO_MODEL
} from "@/lib/constants";
import { loadAudioFile, revokeAudioUrl } from "@/lib/audio/audio-upload";
import { calculateSoundPosition, type GeometryBounds } from "@/lib/sound/positioning";
import { createSoundEventFromUpload } from "@/lib/sound/event-factory";
import { trimDisplayName } from "@/lib/utils";
import { useErrorNotification } from "@/contexts/ErrorContext";

export function useSoundGeneration(geometryBounds: {min: number[], max: number[]} | null) {
  const { addError } = useErrorNotification();
  const [soundConfigs, setSoundConfigs] = useState<SoundGenerationConfig[]>([]);
  const [activeSoundConfigTab, setActiveSoundConfigTab] = useState<number>(0);
  const [isSoundGenerating, setIsSoundGenerating] = useState<boolean>(false);
  const [soundGenError, setSoundGenError] = useState<string | null>(null);
  const [generatedSounds, setGeneratedSounds] = useState<any[]>([]);
  const [soundscapeData, setSoundscapeData] = useState<any[] | null>(null);
  const [globalDuration, setGlobalDuration] = useState<number>(DEFAULT_DURATION_SECONDS);
  const [globalSteps, setGlobalSteps] = useState<number>(DEFAULT_DIFFUSION_STEPS);
  const [globalNegativePrompt, setGlobalNegativePrompt] = useState<string>("distorted, reverb, echo, background noise, hall, spaciousness");
  const [applyDenoising, setApplyDenoising] = useState<boolean>(false);
  const [audioModel, setAudioModel] = useState<string>(DEFAULT_AUDIO_MODEL);

  // AbortController for cancelling ongoing sound generation requests
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleAddConfig = useCallback((type: CardType = 'text-to-audio') => {
    setSoundConfigs(prev => {
      // Create a completely fresh config with default values
      const newConfig: SoundGenerationConfig = {
        prompt: "",
        duration: globalDuration,
        guidance_scale: DEFAULT_GUIDANCE_SCALE,
        negative_prompt: "",
        seed_copies: DEFAULT_SEED_COPIES,
        steps: globalSteps,
        type,
        // Ensure no leftover data
        uploadedAudioBuffer: undefined,
        uploadedAudioInfo: undefined,
        uploadedAudioUrl: undefined,
        selectedLibrarySound: undefined,
        librarySearchState: undefined,
        display_name: undefined,
        entity: undefined
      };
      const updated = [...prev, newConfig];
      setActiveSoundConfigTab(updated.length - 1);
      return updated;
    });
  }, [globalDuration, globalSteps]);

  const handleRemoveConfig = useCallback((index: number) => {
    // Remove the config and any generated sounds atomically
    setSoundConfigs(prev => prev.filter((_, i) => i !== index));
    setSoundscapeData(prev => {
      if (!prev) return prev;
      return prev.filter((sound: any) => sound.prompt_index !== index);
    });
    
    // Update active tab if needed
    if (activeSoundConfigTab >= soundConfigs.length - 1) {
      setActiveSoundConfigTab(Math.max(0, soundConfigs.length - 2));
    }
  }, [soundConfigs, activeSoundConfigTab]);

  const handleUpdateConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: string | number | CardType) => {
    const updated = [...soundConfigs];
    updated[index] = { ...updated[index], [field]: value };
    setSoundConfigs(updated);
  }, [soundConfigs]);

  const handleTypeChange = useCallback(async (index: number, type: CardType) => {
    const updated = [...soundConfigs];
    const config = updated[index];

    // Clear uploaded audio data when switching away from upload or sample-audio type
    // This prevents confusion and ensures clean state transitions
    if ((config.type === 'upload' || config.type === 'sample-audio') && type !== 'upload' && type !== 'sample-audio' && config.uploadedAudioUrl) {
      revokeAudioUrl(config.uploadedAudioUrl);
      updated[index] = {
        ...config,
        type,
        uploadedAudioBuffer: undefined,
        uploadedAudioInfo: undefined,
        uploadedAudioUrl: undefined,
        display_name: undefined // Clear display_name when switching away from upload/sample
      };
    } else if (type === 'upload' || type === 'sample-audio') {
      // When switching TO upload or sample-audio type, clear display_name
      // This ensures the actual audio filename/source will be used, not the old prompt text
      updated[index] = {
        ...config,
        type,
        display_name: undefined
      };
    } else {
      updated[index] = { ...config, type };
    }

    setSoundConfigs(updated);

    // If switching to sample-audio type, automatically load the sample audio
    if (type === 'sample-audio') {
      try {
        console.log(`[Sound Generation] Auto-loading sample audio for sound ${index + 1}`);

        // Fetch the sample audio from backend
        const response = await fetch(`${API_BASE_URL}/api/sample-audio`);
        if (!response.ok) {
          throw new Error('Failed to load sample audio');
        }

        // Convert response to blob, then to File
        const blob = await response.blob();
        const file = new File([blob], "Le Corbeau et le Renard (french).wav", { type: "audio/wav" });

        // Load audio file using the same mechanism as upload
        const result = await loadAudioFile(file);

        // Update the config with loaded audio data
        setSoundConfigs(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            uploadedAudioBuffer: result.audioBuffer,
            uploadedAudioInfo: result.audioInfo,
            uploadedAudioUrl: result.audioUrl
            // Don't set display_name here - let createSoundEventFromUpload determine it from filename
          };
          return updated;
        });

        console.log(`[Sound Generation] Sample audio loaded successfully for sound ${index + 1}`);
      } catch (error) {
        console.error(`[Sound Generation] Failed to load sample audio for sound ${index + 1}:`, error);
        setSoundGenError(error instanceof Error ? error.message : 'Failed to load sample audio');
      }
    }
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
    // Separate configs by type and track their original indices
    const uploadedConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) => (config.type === 'upload' || config.type === 'sample-audio') && config.uploadedAudioUrl);

    const libraryConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) => config.type === 'library' && config.selectedLibrarySound);

    const generationConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) =>
        (config.type === 'text-to-audio' || !config.type) &&
        !config.uploadedAudioUrl &&
        config.prompt.trim() !== ""
      );

    if (generationConfigsWithIndices.length === 0 && uploadedConfigsWithIndices.length === 0 && libraryConfigsWithIndices.length === 0) {
      setSoundGenError("Please enter at least one sound prompt or upload an audio file.");
      return;
    }

    // Calculate total number of sounds across all modes for proper spacing
    const totalSoundsCount = generationConfigsWithIndices.length + uploadedConfigsWithIndices.length + libraryConfigsWithIndices.length;

    setSoundGenError(null);
    setIsSoundGenerating(true);

    // Create a new AbortController for this generation request
    abortControllerRef.current = new AbortController();

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
            apply_denoising: applyDenoising,
            audio_model: audioModel
          }),
          signal: abortControllerRef.current?.signal
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.detail);
        }

        const result = await response.json();

        // Map backend response to correct original indices and enrich with entity data
        generatedEvents = result.sounds.map((sound: any) => {
          // Backend returns prompt_index based on the array we sent (0-indexed)
          // We need to map it back to the original soundConfigs index
          const backendIndex = sound.prompt_index;
          const actualOriginalIndex = generationConfigsWithIndices[backendIndex]?.originalIndex ?? backendIndex;

          // Get the original config to check for entity data
          const originalConfig = generationConfigsWithIndices[backendIndex]?.config;
          const hasEntityInConfig = originalConfig?.entity !== undefined;

          // Determine entity_index: from backend (if present) or from config's entity
          let entityIndex = sound.entity_index;
          if (entityIndex === undefined && hasEntityInConfig && originalConfig.entity?.index !== undefined) {
            entityIndex = originalConfig.entity.index;
          }

          // Determine position: use entity's center if entity-linked, otherwise backend position
          let position = sound.position;
          if (hasEntityInConfig && originalConfig.entity?.bounds?.center) {
            // Use entity's bounding box center as the sound source position
            position = originalConfig.entity.bounds.center;
          } else if (hasEntityInConfig && originalConfig.entity?.position) {
            // Fallback to entity's position if no bounds
            position = originalConfig.entity.position;
          }

          return {
            ...sound,
            prompt_index: actualOriginalIndex, // Use the ACTUAL original index
            position: position,
            geometry: sound.geometry || {
              vertices: [],
              faces: []
            },
            // Set entity_index from config if entity-linked (tells sound-sphere-manager to NOT create a sphere)
            ...(entityIndex !== undefined && { entity_index: entityIndex })
          };
        });
      }

      // Create sound events for uploaded audio configs
      if (uploadedConfigsWithIndices.length > 0) {
        uploadedEvents = uploadedConfigsWithIndices.map(({ config, originalIndex }) => {
          return createSoundEventFromUpload(
            config,
            config.uploadedAudioUrl!,
            originalIndex,
            totalSoundsCount,
            geometryBounds as GeometryBounds | undefined,
            'uploaded'
          );
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
              }),
              signal: abortControllerRef.current?.signal
            });

            if (!downloadResponse.ok) {
              throw new Error('Failed to download sound');
            }

            // Get the audio file as blob
            const audioBlob = await downloadResponse.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // Create sound event using factory function
            const soundEvent = createSoundEventFromUpload(
              config,
              audioUrl,
              originalIndex,
              totalSoundsCount,
              geometryBounds as GeometryBounds | undefined,
              'library'
            );

            libraryEvents.push(soundEvent);

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
      // Don't show error if request was aborted intentionally
      if (err.name === 'AbortError') {
        const errorMsg = 'Sound generation stopped by user.';
        setSoundGenError(errorMsg);
        addError(errorMsg, 'info');
      } else {
        const isQuotaError = err.message.includes('quota') || err.message.includes('429');
        const errorType: 'error' | 'warning' = isQuotaError ? 'warning' : 'error';
        setSoundGenError(err.message);
        addError(err.message, errorType);
      }
    } finally {
      setIsSoundGenerating(false);
      abortControllerRef.current = null;
    }
  }, [soundConfigs, geometryBounds, globalNegativePrompt, applyDenoising, addError]);

  const setSoundConfigsFromPrompts = useCallback((prompts: any[]) => {
    setSoundConfigs(prev => {
      // If there's only one empty config, replace it instead of appending
      if (prev.length === 1 && !prev[0].prompt && !prev[0].uploadedAudioUrl && !prev[0].selectedLibrarySound) {
        return prompts;
      }
      
      // Filter out duplicates by comparing key fields
      // A duplicate is defined as having the same prompt AND entity (if present)
      const newPrompts = prompts.filter(newConfig => {
        const isDuplicate = prev.some(existingConfig => {
          // Compare prompt (case-insensitive, trimmed)
          const samePrompt = existingConfig.prompt.trim().toLowerCase() === newConfig.prompt.trim().toLowerCase();
          
          // Compare entity if both have entities (by entity index)
          const sameEntity = (!existingConfig.entity && !newConfig.entity) || 
                           (existingConfig.entity?.index !== undefined && 
                            newConfig.entity?.index !== undefined && 
                            existingConfig.entity.index === newConfig.entity.index);
          
          return samePrompt && sameEntity;
        });
        
        return !isDuplicate;
      });
      
      // If all new prompts are duplicates, just return previous state
      if (newPrompts.length === 0) {
        console.log('[Sound Generation] All sounds already exist, skipping duplicates');
        return prev;
      }
      
      // Otherwise, append the non-duplicate prompts to existing configs
      console.log(`[Sound Generation] Adding ${newPrompts.length} new sounds (filtered ${prompts.length - newPrompts.length} duplicates)`);
      return [...prev, ...newPrompts];
    });
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

      // Update the config with uploaded audio data using functional setState
      setSoundConfigs(prev => {
        // Check if index exists
        if (index >= prev.length) {
          console.error(`[Sound Generation] Index ${index} out of bounds, soundConfigs length: ${prev.length}`);
          return prev;
        }

        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          type: 'upload' as CardType, // Set type to upload when audio is uploaded
          uploadedAudioBuffer: result.audioBuffer,
          uploadedAudioInfo: result.audioInfo,
          uploadedAudioUrl: result.audioUrl
          // Don't set display_name here - let createSoundEventFromUpload determine it from filename
        };
        return updated;
      });

      console.log(`[Sound Generation] Audio uploaded successfully for sound ${index + 1}`);
    } catch (error) {
      console.error(`[Sound Generation] Failed to upload audio for sound ${index + 1}:`, error);
      setSoundGenError(error instanceof Error ? error.message : 'Failed to upload audio file');
    }
  }, []);

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
      display_name: updated[index].display_name || trimDisplayName(sound.description),
      librarySearchState: updated[index].librarySearchState ? {
        ...updated[index].librarySearchState!,
        selectedSound: sound
      } : undefined
    };
    setSoundConfigs(updated);

    console.log(`[Library Search] Selected sound: ${sound.description}`);
  }, [soundConfigs]);

  /**
   * Reprocess existing generated sounds to add or remove denoising
   */
  const handleReprocessSounds = useCallback(async (applyDenoising: boolean) => {
    if (!soundscapeData || soundscapeData.length === 0) {
      console.log('[Sound Reprocess] No sounds to reprocess');
      return;
    }

    try {
      console.log(`[Sound Reprocess] Reprocessing ${soundscapeData.length} sounds with denoising=${applyDenoising}`);

      // Extract sound URLs from soundscapeData
      const soundUrls = soundscapeData.map((sound: any) => sound.url);

      const response = await fetch(`${API_BASE_URL}/api/reprocess-sounds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sound_urls: soundUrls,
          apply_denoising: applyDenoising
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Failed to reprocess sounds');
      }

      const result = await response.json();
      console.log(`[Sound Reprocess] Successfully reprocessed ${result.reprocessed_count} sounds`);

      // Force reload of the sounds by updating the soundscape data with cache-busting URLs
      // This will trigger a re-render and force the browser to reload the audio files
      const timestamp = Date.now();
      const updatedSounds = soundscapeData.map((sound: any) => ({
        ...sound,
        url: sound.url.includes('?')
          ? `${sound.url}&t=${timestamp}`
          : `${sound.url}?t=${timestamp}`
      }));
      setSoundscapeData(updatedSounds);

    } catch (error) {
      console.error('[Sound Reprocess] Error:', error);
      setSoundGenError(error instanceof Error ? error.message : 'Failed to reprocess sounds');
    }
  }, [soundscapeData]);

  /**
   * Stop ongoing sound generation
   * Aborts all pending fetch requests and resets state
   */
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsSoundGenerating(false);
      setSoundGenError('Sound generation stopped by user.');
    }
  }, []);

  /**
   * Batch add multiple configs at once (for multi-file upload)
   * Returns the starting index of the new configs
   */
  const handleBatchAddConfigs = useCallback((count: number): number => {
    let startIndex = 0;
    setSoundConfigs(prev => {
      startIndex = prev.length;
      const newConfigs = Array.from({ length: count }, () => ({
        prompt: "",
        duration: globalDuration,
        guidance_scale: DEFAULT_GUIDANCE_SCALE,
        negative_prompt: "",
        seed_copies: DEFAULT_SEED_COPIES,
        steps: globalSteps,
        type: 'text-to-audio' as CardType
      }));
      return [...prev, ...newConfigs];
    });
    return startIndex;
  }, [globalDuration, globalSteps]);

  // Reset all advanced settings to defaults
  const handleResetToDefaults = useCallback(() => {
    setGlobalDuration(DEFAULT_DURATION_SECONDS);
    setGlobalSteps(DEFAULT_DIFFUSION_STEPS);
    setGlobalNegativePrompt("distorted, reverb, echo, background noise, hall, spaciousness");
    setApplyDenoising(false);
    setAudioModel(DEFAULT_AUDIO_MODEL);
  }, []);

  /**
   * Reset a sound config to pre-generation state
   * Clears all generated-state fields while preserving core config (prompt, entity, mode, etc.)
   * This is called when the reset button is clicked on a generated sound
   */
  const handleResetSoundConfig = useCallback((configIndex: number) => {

    setSoundConfigs(prev => {

      const updated = [...prev];
      const config = updated[configIndex];

      if (!config) {
        console.error('[handleResetSoundConfig] No config found at index:', configIndex);
        return prev;
      }

      // Revoke uploaded audio URL if it exists to free memory
      if (config?.uploadedAudioUrl) {
        URL.revokeObjectURL(config.uploadedAudioUrl);
      }

      // Reset config atomically - clear all generated-state fields
      updated[configIndex] = {
        ...config,
        display_name: undefined,
        uploadedAudioBuffer: undefined,
        uploadedAudioInfo: undefined,
        uploadedAudioUrl: undefined,
        selectedLibrarySound: undefined,
        librarySearchState: undefined
      };

      return updated;
    });
  }, []);

  /**
   * Detach sound from entity - removes entity from config and updates soundscape data
   * This ensures both the config and the actual sound events are updated
   */
  const handleDetachSoundFromEntity = useCallback((configIndex: number) => {
    // Update the config to remove entity
    const updated = [...soundConfigs];
    updated[configIndex] = { ...updated[configIndex], entity: undefined };
    setSoundConfigs(updated);

    // Update soundscapeData to remove entity_index from sounds with this prompt_index
    if (soundscapeData) {
      const updatedSoundscape = soundscapeData.map(sound => {
        if (sound.prompt_index === configIndex) {
          // Remove entity_index from this sound
          const { entity_index, ...soundWithoutEntity } = sound;
          return soundWithoutEntity;
        }
        return sound;
      });
      setSoundscapeData(updatedSoundscape);
    }

    // Also update generatedSounds
    if (generatedSounds.length > 0) {
      const updatedGenerated = generatedSounds.map(sound => {
        if (sound.prompt_index === configIndex) {
          const { entity_index, ...soundWithoutEntity } = sound;
          return soundWithoutEntity;
        }
        return sound;
      });
      setGeneratedSounds(updatedGenerated);
    }
  }, [soundConfigs, soundscapeData, generatedSounds]);

  /**
   * Attach sound to entity - adds entity to config and updates soundscape data
   * This ensures both the config and the actual sound events are updated
   * Destroys sound sphere and moves overlay to entity
   */
  const handleAttachSoundToEntity = useCallback((configIndex: number, entity: any) => {
    // Update the config to add entity
    const updated = [...soundConfigs];
    updated[configIndex] = { ...updated[configIndex], entity };
    setSoundConfigs(updated);

    // Calculate entity position (use bounds.center if available, otherwise entity.position)
    const entityPosition: [number, number, number] = entity.bounds?.center
      ? [entity.bounds.center[0], entity.bounds.center[1], entity.bounds.center[2]]
      : entity.position?.length >= 3
        ? [entity.position[0], entity.position[1], entity.position[2]]
        : [0, 0, 0];

    // Update soundscapeData to add entity_index and update position
    if (soundscapeData) {
      const updatedSoundscape = soundscapeData.map(sound => {
        if (sound.prompt_index === configIndex) {
          // Add entity_index and update position to entity's position
          return {
            ...sound,
            entity_index: entity.index,
            position: entityPosition
          };
        }
        return sound;
      });
      setSoundscapeData(updatedSoundscape);
    }

    // Also update generatedSounds
    if (generatedSounds.length > 0) {
      const updatedGenerated = generatedSounds.map(sound => {
        if (sound.prompt_index === configIndex) {
          return {
            ...sound,
            entity_index: entity.index,
            position: entityPosition
          };
        }
        return sound;
      });
      setGeneratedSounds(updatedGenerated);
    }
  }, [soundConfigs, soundscapeData, generatedSounds]);

  // Sync generatedSounds with soundscapeData when it changes externally (e.g., reset)
  useEffect(() => {
    // Handle both cases: soundscapeData becomes null OR its length changes
    if (soundscapeData === null) {
      setGeneratedSounds([]);
    } else if (soundscapeData && soundscapeData.length !== generatedSounds.length) {
      setGeneratedSounds(soundscapeData);
    }
  }, [soundscapeData, generatedSounds.length]);

  /**
   * Update sound position when dragged in 3D scene
   * @param soundId - The ID of the sound to update
   * @param position - The new position as [x, y, z]
   */
  const updateSoundPosition = useCallback((soundId: string, position: [number, number, number]) => {
    console.log(`[useSoundGeneration] Updating sound position:`, { soundId, position });

    // Update soundscapeData
    setSoundscapeData(prev => {
      if (!prev) return prev;
      return prev.map(sound =>
        sound.id === soundId ? { ...sound, position } : sound
      );
    });

    // Update generatedSounds
    setGeneratedSounds(prev =>
      prev.map(sound =>
        sound.id === soundId ? { ...sound, position } : sound
      )
    );
  }, []);

  /**
   * Update soundscapeData when display_name changes in soundConfigs
   * This ensures timeline receives updated names
   */
  useEffect(() => {
    if (!soundscapeData || soundscapeData.length === 0) return;

    // Check if any display_name changed and update soundscapeData
    let hasChanges = false;
    const updatedSoundscape = soundscapeData.map(sound => {
      const configIndex = sound.prompt_index;
      if (configIndex !== undefined && soundConfigs[configIndex]) {
        const config = soundConfigs[configIndex];
        const newDisplayName = config.display_name;

        // Update display_name if it differs
        if (newDisplayName && sound.display_name !== newDisplayName) {
          hasChanges = true;
          return { ...sound, display_name: newDisplayName };
        }
      }
      return sound;
    });

    if (hasChanges) {
      setSoundscapeData(updatedSoundscape);
      setGeneratedSounds(updatedSoundscape);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundConfigs.map(c => c.display_name).join(',')]); // Watch display_name changes

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
    audioModel,
    handleAddConfig,
    handleBatchAddConfigs,
    handleRemoveConfig,
    handleUpdateConfig,
    handleTypeChange,
    handleGenerate,
    handleStopGeneration,
    handleGlobalDurationChange,
    handleGlobalStepsChange,
    handleReprocessSounds,
    setActiveSoundConfigTab,
    setSoundConfigsFromPrompts,
    setSoundscapeData,
    setGlobalNegativePrompt,
    setApplyDenoising,
    setAudioModel,
    handleUploadAudio,
    handleClearUploadedAudio,
    handleLibrarySearch,
    handleLibrarySoundSelect,
    handleResetToDefaults,
    handleResetSoundConfig,
    handleDetachSoundFromEntity,
    handleAttachSoundToEntity,
    updateSoundPosition
  };
}

import { useState, useCallback, useRef } from "react";
import { SoundGenerationConfig, SoundGenerationMode, LibrarySearchResult, LibrarySearchState } from "@/types";
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

export function useSoundGeneration(geometryBounds: {min: number[], max: number[]} | null) {
  const [soundConfigs, setSoundConfigs] = useState<SoundGenerationConfig[]>([
    { prompt: "", duration: DEFAULT_DURATION_SECONDS, guidance_scale: DEFAULT_GUIDANCE_SCALE, negative_prompt: "", seed_copies: DEFAULT_SEED_COPIES, steps: DEFAULT_DIFFUSION_STEPS, mode: 'text-to-audio' }
  ]);
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

  const handleAddConfig = useCallback(() => {
    setSoundConfigs(prev => {
      const newConfig = { prompt: "", duration: globalDuration, guidance_scale: DEFAULT_GUIDANCE_SCALE, negative_prompt: "", seed_copies: DEFAULT_SEED_COPIES, steps: globalSteps, mode: 'text-to-audio' };
      const updated = [...prev, newConfig];
      setActiveSoundConfigTab(updated.length - 1);
      return updated;
    });
  }, [globalDuration, globalSteps]);

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

  const handleModeChange = useCallback(async (index: number, mode: SoundGenerationMode) => {
    const updated = [...soundConfigs];
    const config = updated[index];

    // Clear uploaded audio data when switching away from upload or sample-audio mode
    // This prevents confusion and ensures clean state transitions
    if ((config.mode === 'upload' || config.mode === 'sample-audio') && mode !== 'upload' && mode !== 'sample-audio' && config.uploadedAudioUrl) {
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

    // If switching to sample-audio mode, automatically load the sample audio
    if (mode === 'sample-audio') {
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
            uploadedAudioUrl: result.audioUrl,
            display_name: updated[index].display_name || "Le Corbeau et le Renard"
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
    // Separate configs by mode and track their original indices
    const uploadedConfigsWithIndices = soundConfigs
      .map((config, idx) => ({ config, originalIndex: idx }))
      .filter(({ config }) => (config.mode === 'upload' || config.mode === 'sample-audio') && config.uploadedAudioUrl);

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
            },
            // Preserve entity_index if present
            ...(sound.entity_index !== undefined && { entity_index: sound.entity_index })
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
        setSoundGenError('Sound generation stopped by user.');
      } else {
        setSoundGenError(err.message);
      }
    } finally {
      setIsSoundGenerating(false);
      abortControllerRef.current = null;
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
          mode: 'upload' as SoundGenerationMode, // Set mode to upload when audio is uploaded
          uploadedAudioBuffer: result.audioBuffer,
          uploadedAudioInfo: result.audioInfo,
          uploadedAudioUrl: result.audioUrl,
          // Optionally update display name from filename if not set
          display_name: updated[index].display_name || result.audioInfo.filename.replace(/\.[^/.]+$/, "")
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
        mode: 'text-to-audio' as SoundGenerationMode
      }));
      return [...prev, ...newConfigs];
    });
    return startIndex;
  }, [globalDuration, globalSteps]);

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
    handleModeChange,
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
    handleLibrarySoundSelect
  };
}

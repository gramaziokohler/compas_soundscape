import { API_BASE_URL } from '@/utils/constants';
import type { CompasGeometry, SoundEvent, SoundGenerationConfig, FileUploadResponse } from '@/types';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { ModalAnalysisRequest, ModalAnalysisResult } from '@/types/modal';
import type { SpeckleProjectModelsResponse } from '@/types/speckle-models';
import type { SoundscapeSavePayload, SoundscapeSaveResponse, SoundscapeLoadResponse } from '@/types/soundscape';

/**
 * Enhanced error handling for API calls
 * Converts network errors and HTTP errors into user-friendly messages
 */
function handleApiError(error: unknown, context: string): never {
  // Network errors (no connection, CORS, etc.)
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    throw new Error(`Unable to connect to the server. Please check if the backend is running at ${API_BASE_URL}`);
  }

  // Generic network/fetch errors
  if (error instanceof TypeError) {
    throw new Error(`Network error: ${error.message}`);
  }

  // API errors with custom messages
  if (error instanceof Error) {
    throw error;
  }

  // Unknown errors
  throw new Error(`${context}: An unexpected error occurred`);
}

/**
 * Wrapper for fetch calls with consistent error handling
 */
async function fetchWithErrorHandling(
  url: string,
  options?: RequestInit,
  context: string = 'API request'
): Promise<Response> {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    handleApiError(error, context);
  }
}

export interface ServiceVersionInfo {
  name: string;
  version: string;
  device?: string;
}

export interface LLMProviderInfo {
  name: string;
  version: string | null;
  installed: boolean;
}

export interface LLMProviders {
  google: LLMProviderInfo;
  openai: LLMProviderInfo;
  anthropic: LLMProviderInfo;
}

export interface ServiceVersions {
  pyroomacoustics: ServiceVersionInfo;
  tangoflux: ServiceVersionInfo;
  audioldm2: ServiceVersionInfo;
  bbc: ServiceVersionInfo;
  llm_providers: LLMProviders;
  yamnet: ServiceVersionInfo;
  acousticDE: ServiceVersionInfo;
  edg_acoustics: ServiceVersionInfo;
}

export interface TokenStatus {
  speckle_token_set: boolean;
  speckle_project_name: string;
  google_api_key_set: boolean;
  openai_api_key_set: boolean;
  anthropic_api_key_set: boolean;
}

export interface TokenUpdate {
  speckle_token?: string;
  speckle_project_name?: string;
  google_api_key?: string;
  openai_api_key?: string;
  anthropic_api_key?: string;
}

// API Service Layer
export const apiService = {
  // File Upload
  async uploadFile(file: File): Promise<FileUploadResponse | CompasGeometry> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/upload`,
        {
          method: 'POST',
          body: formData
        },
        'File upload'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'File upload failed' }));
        throw new Error(err.detail || 'File upload failed');
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'File upload');
    }
  },

  // Load Sample Audio
  async loadSampleAudio(): Promise<File> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/sample-audio`,
        undefined,
        'Load sample audio'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to load sample audio' }));
        throw new Error(err.detail || 'Failed to load sample audio');
      }

      // Get the blob from the response
      const blob = await response.blob();

      // Extract filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('content-disposition');
      let filename = 'sample-audio.wav';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create a File object from the blob
      return new File([blob], filename, { type: blob.type });
    } catch (error) {
      handleApiError(error, 'Load sample audio');
    }
  },

  // Generate Text/Prompts
  async generateText(data: {
    prompt?: string;
    num_sounds: number;
    entities?: any[];
    llm_model?: string;
  }): Promise<{ generation_id: string }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/generate-text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Generate text'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to generate text' }));
        const errorMessage = err.detail || 'Failed to generate text';
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Generate text');
    }
  },

  // Poll text generation status
  async getTextGenerationStatus(generationId: string): Promise<{
    generation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: { text: string; sounds: string[]; prompts: any[]; selected_entities: any[] | null } | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/text-generation-status/${generationId}`,
        undefined,
        'Text generation status'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to get status' }));
        throw new Error(err.detail || 'Failed to get text generation status');
      }
      return await response.json();
    } catch (error) {
      handleApiError(error, 'Text generation status');
    }
  },

  // Cancel text generation
  async cancelTextGeneration(generationId: string): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/cancel-text-generation/${generationId}`,
        { method: 'POST' },
        'Cancel text generation'
      );
    } catch {
      // Silently fail — cancel is best-effort
    }
  },

  // Generate Sounds (async — returns generation_id for polling)
  async generateSounds(data: {
    sounds: SoundGenerationConfig[];
    bounding_box: { min: number[]; max: number[] } | null;
    apply_denoising?: boolean;
    audio_model?: string;
    base_spl_db?: number;
  }): Promise<{ generation_id: string }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/generate-sounds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Generate sounds'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to generate sounds' }));
        throw new Error(err.detail || 'Failed to generate sounds');
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Generate sounds');
    }
  },

  // Poll sound generation status
  async getSoundGenerationStatus(generationId: string): Promise<{
    generation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: any[] | null;
    partial_sounds?: any[] | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/sound-generation-status/${generationId}`,
        undefined,
        'Sound generation status'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to get status' }));
        throw new Error(err.detail || 'Failed to get sound generation status');
      }
      return await response.json();
    } catch (error) {
      handleApiError(error, 'Sound generation status');
    }
  },

  // Cancel sound generation
  async cancelSoundGeneration(generationId: string): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/cancel-sound-generation/${generationId}`,
        { method: 'POST' },
        'Cancel sound generation'
      );
    } catch {
      // Silently fail — cancel is best-effort
    }
  },

  // Calibrate Audio (normalize RMS + SPL calibration for non-ML audio modes)
  async calibrateAudio(
    audioBlob: Blob,
    splDb: number,
    applyDenoising: boolean = false
  ): Promise<{ url: string }> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');
      formData.append('spl_db', splDb.toString());
      formData.append('apply_denoising', applyDenoising.toString());

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/calibrate-audio`,
        { method: 'POST', body: formData },
        'Audio calibration'
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Calibration failed' }));
        throw new Error(err.detail || 'Calibration failed');
      }

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Audio calibration');
    }
  },

  // Cleanup Generated Sounds
  async cleanupGeneratedSounds(): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/api/cleanup-generated-sounds`,
        { method: 'POST' },
        'Cleanup generated sounds'
      );
    } catch (error) {
      // Silently fail - cleanup is not critical
      console.warn('Failed to cleanup generated sounds:', error);
    }
  },

  // Impulse Response Management

  /**
   * Upload an impulse response file
   */
  async uploadImpulseResponse(file: File, name: string): Promise<ImpulseResponseMetadata> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', name);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses/upload`,
        {
          method: 'POST',
          body: formData
        },
        'Upload impulse response'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to upload impulse response' }));
        throw new Error(error.detail || 'Failed to upload impulse response');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Upload impulse response');
    }
  },

  /**
   * List all impulse responses
   */
  async listImpulseResponses(): Promise<ImpulseResponseMetadata[]> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses`,
        undefined,
        'List impulse responses'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch impulse responses');
      }

      const data = await response.json();
      return data.impulse_responses;
    } catch (error) {
      handleApiError(error, 'List impulse responses');
    }
  },

  /**
   * Delete an impulse response
   */
  async deleteImpulseResponse(irId: string): Promise<void> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/impulse-responses/${irId}`,
        { method: 'DELETE' },
        'Delete impulse response'
      );

      if (!response.ok) {
        throw new Error('Failed to delete impulse response');
      }
    } catch (error) {
      handleApiError(error, 'Delete impulse response');
    }
  },

  // Modal Analysis

  /**
   * Perform modal analysis on a mesh to find resonant frequencies
   */
  async analyzeModal(request: ModalAnalysisRequest): Promise<ModalAnalysisResult> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/modal-analysis/analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        },
        'Modal analysis'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Modal analysis failed' }));
        throw new Error(error.detail || 'Modal analysis failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Modal analysis');
    }
  },

  /**
   * Get available material presets for modal analysis
   */
  async getModalMaterials(): Promise<{
    materials: Record<string, { young_modulus: number; poisson_ratio: number; density: number }>;
    description: Record<string, string>;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/modal-analysis/materials`,
        undefined,
        'Get modal materials'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch modal materials');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get modal materials');
    }
  },

  // Choras Acoustic Simulation

  // Pyroomacoustics Acoustic Simulation

  /**
   * Get available materials from Pyroomacoustics library
   */
  async getPyroomacousticsMaterials(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    category?: string;
    absorption: number;
    coeffs?: number[];
    center_freqs?: number[];
  }>> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/pyroomacoustics/materials`,
        undefined,
        'Get Pyroomacoustics materials'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch Pyroomacoustics materials');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Pyroomacoustics materials');
    }
  },

  /**
   * Run Pyroomacoustics simulation
   * 
   * @param file - 3D model file (3dm, obj, or ifc)
   * @param simulationName - Name for the simulation
   * @param settings - Simulation settings (max_order, ray_tracing, air_absorption)
   * @param sourceReceiverPairs - Array of source-receiver position pairs
   * @param faceMaterialAssignments - Map of face index to material ID
   */
  async runPyroomacousticsSimulation(
    file: File,
    simulationName: string,
    settings: {
      max_order: number;
      ray_tracing: boolean;
      air_absorption: boolean;
      n_rays: number;
      scattering: number;
      simulation_mode: string;
      enable_grid?: boolean;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    faceMaterialAssignments: Record<number, string>,
    excludedLayers?: string[]
  ): Promise<{
    simulation_id: string;
    message: string;
    ir_files: string[];
    results_file: string;
    grid_plot_file?: string;
  }> {
    try {
      const formData = new FormData();
      formData.append('model_file', file);
      formData.append('simulation_name', simulationName);
      formData.append('max_order', settings.max_order.toString());
      formData.append('ray_tracing', settings.ray_tracing.toString());
      formData.append('air_absorption', settings.air_absorption.toString());
      formData.append('n_rays', settings.n_rays.toString());
      formData.append('scattering', settings.scattering.toString());

      formData.append('simulation_mode', settings.simulation_mode);
      formData.append('enable_grid', (settings.enable_grid ?? false).toString());

      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));
      formData.append('face_materials', JSON.stringify(faceMaterialAssignments));

      if (excludedLayers && excludedLayers.length > 0) {
        formData.append('excludedLayers', JSON.stringify(excludedLayers));
      }

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/pyroomacoustics/run-simulation`,
        {
          method: 'POST',
          body: formData
        },
        'Run Pyroomacoustics simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Simulation failed' }));
        throw new Error(error.detail || 'Simulation failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Run Pyroomacoustics simulation');
    }
  },

  /**
   * Run Pyroomacoustics simulation with Speckle geometry
   *
   * @param speckleProjectId - Speckle project ID
   * @param speckleVersionId - Speckle version/commit ID
   * @param objectMaterials - Map of Speckle object ID to material ID
   * @param layerName - Name of the layer to extract geometry from (e.g., "Acoustics")
   * @param simulationName - Name for the simulation
   * @param settings - Simulation settings
   * @param sourceReceiverPairs - Array of source-receiver position pairs
   */
  async runPyroomacousticsSimulationSpeckle(
    speckleProjectId: string,
    speckleVersionId: string,
    objectMaterials: Record<string, string>,
    layerName: string,
    simulationName: string,
    settings: {
      max_order: number;
      ray_tracing: boolean;
      air_absorption: boolean;
      n_rays: number;
      simulation_mode: string;
      enable_grid?: boolean;
      sound_speed?: number;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    geometryObjectIds?: string[],
    objectScattering?: Record<string, number>
  ): Promise<{ simulation_id: string }> {
    try {
      const formData = new FormData();
      formData.append('simulation_name', simulationName);
      formData.append('speckle_project_id', speckleProjectId);
      formData.append('speckle_version_id', speckleVersionId);
      formData.append('object_materials', JSON.stringify(objectMaterials));
      formData.append('layer_name', layerName);
      formData.append('max_order', settings.max_order.toString());
      formData.append('ray_tracing', settings.ray_tracing.toString());
      formData.append('air_absorption', settings.air_absorption.toString());
      formData.append('n_rays', settings.n_rays.toString());
      formData.append('object_scattering', JSON.stringify(objectScattering || {}));

      formData.append('simulation_mode', settings.simulation_mode);
      formData.append('enable_grid', (settings.enable_grid ?? false).toString());
      if (settings.sound_speed !== undefined) {
        formData.append('sound_speed', settings.sound_speed.toString());
      }

      // Send explicit geometry object IDs from the frontend to bypass layer-name filtering
      if (geometryObjectIds && geometryObjectIds.length > 0) {
        formData.append('geometry_object_ids', JSON.stringify(geometryObjectIds));
      }

      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/pyroomacoustics/run-simulation-speckle`,
        {
          method: 'POST',
          body: formData
        },
        'Run Pyroomacoustics Speckle simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Speckle simulation failed' }));
        throw new Error(error.detail || 'Speckle simulation failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Run Pyroomacoustics Speckle simulation');
    }
  },

  /**
   * Poll the status of a queued or running Pyroomacoustics simulation.
   * Call every ~1 second while isRunning=true.
   */
  async getPyroomacousticsSimulationStatus(simulationId: string): Promise<{
    simulation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: {
      simulation_id: string;
      message: string;
      ir_files: string[];
      results_file: string;
    } | null;
    queue_position?: number | null;
    queue_total?: number | null;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/pyroomacoustics/simulation-status/${simulationId}`,
        undefined,
        'Get Pyroomacoustics simulation status'
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Status check failed' }));
        throw new Error(error.detail || 'Status check failed');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Pyroomacoustics simulation status');
    }
  },

  /**
   * Signal the backend to cancel a running or queued Pyroomacoustics simulation.
   */
  async cancelPyroomacousticsSimulation(simulationId: string): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/pyroomacoustics/cancel-simulation/${simulationId}`,
        { method: 'POST' },
        'Cancel Pyroomacoustics simulation'
      );
    } catch (error) {
      // Non-fatal: log but don't rethrow
      console.warn('cancelPyroomacousticsSimulation:', error);
    }
  },

  /**
   * Get a specific IR file from a Pyroomacoustics simulation
   *
   * @param simulationId - The simulation ID
   * @param irFilename - The specific IR filename to retrieve
   * @returns Blob containing the WAV file
   */
  async getPyroomacousticsIRFile(
    simulationId: string,
    irFilename: string
  ): Promise<Blob> {
    try {
      const url = new URL(`${API_BASE_URL}/pyroomacoustics/get-result-file/${simulationId}/wav`);
      url.searchParams.append('ir_filename', irFilename);

      const response = await fetchWithErrorHandling(
        url.toString(),
        undefined,
        'Get Pyroomacoustics IR file'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to retrieve IR file' }));
        throw new Error(error.detail || 'Failed to retrieve IR file');
      }

      return response.blob();
    } catch (error) {
      handleApiError(error, 'Get Pyroomacoustics IR file');
    }
  },

  // ─── Choras (DE/DG) API Methods ─────────────────────────────────────────

  /**
   * Get available absorption materials for Choras (DE/DG) simulations.
   */
  async getChorasMaterials(): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    coeffs: number[];
    center_freqs: number[];
    absorption: number;
  }>> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/materials`,
        undefined,
        'Get Choras materials'
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Choras materials' }));
        throw new Error(error.detail || 'Failed to get Choras materials');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Choras materials');
    }
  },

  /**
   * Start a Choras (DE or DG) acoustic simulation from a Speckle model.
   * Returns immediately with a simulation_id — poll getChorasSimulationStatus()
   * for live progress updates.
   */
  async runChorasSimulationSpeckle(
    speckleProjectId: string,
    speckleVersionId: string,
    objectMaterials: Record<string, string>,
    layerName: string,
    simulationName: string,
    settings: {
      simulation_method: 'DE' | 'DG';
      de_c0?: number;
      de_lc?: number;
      dg_freq_upper_limit?: number;
      dg_c0?: number;
      dg_rho0?: number;
      dg_poly_order?: number;
      dg_ppw?: number;
      dg_cfl?: number;
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    geometryObjectIds?: string[],
  ): Promise<{
    simulation_id: string;
    total_steps: number;
    method: string;
  }> {
    try {
      const formData = new FormData();
      formData.append('simulation_name', simulationName);
      formData.append('speckle_project_id', speckleProjectId);
      formData.append('speckle_version_id', speckleVersionId);
      formData.append('object_materials', JSON.stringify(objectMaterials));
      formData.append('layer_name', layerName);
      formData.append('simulation_method', settings.simulation_method);

      if (settings.de_c0 !== undefined) formData.append('de_c0', String(settings.de_c0));
      if (settings.de_lc !== undefined) formData.append('de_lc', String(settings.de_lc));
      if (settings.dg_freq_upper_limit !== undefined) formData.append('dg_freq_upper_limit', String(settings.dg_freq_upper_limit));
      if (settings.dg_c0 !== undefined) formData.append('dg_c0', String(settings.dg_c0));
      if (settings.dg_rho0 !== undefined) formData.append('dg_rho0', String(settings.dg_rho0));
      if (settings.dg_poly_order !== undefined) formData.append('dg_poly_order', String(settings.dg_poly_order));
      if (settings.dg_ppw !== undefined) formData.append('dg_ppw', String(settings.dg_ppw));
      if (settings.dg_cfl !== undefined) formData.append('dg_cfl', String(settings.dg_cfl));

      if (geometryObjectIds?.length) {
        formData.append('geometry_object_ids', JSON.stringify(geometryObjectIds));
      }
      formData.append('source_receiver_pairs', JSON.stringify(sourceReceiverPairs));

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/run-simulation-speckle`,
        { method: 'POST', body: formData },
        'Start Choras Speckle simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Choras simulation failed' }));
        throw new Error(error.detail || 'Choras simulation failed');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Start Choras Speckle simulation');
    }
  },

  /**
   * Poll the status of a running (or recently completed) Choras simulation.
   * Call every ~1 second while isRunning=true.
   */
  async getChorasSimulationStatus(simulationId: string): Promise<{
    simulation_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error: string | null;
    result?: {
      simulation_id: string;
      message: string;
      ir_files: string[];
      results_file: string;
      method: string;
    } | null;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/simulation-status/${simulationId}`,
        undefined,
        'Get Choras simulation status'
      );
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Status check failed' }));
        throw new Error(error.detail || 'Status check failed');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Choras simulation status');
    }
  },

  /**
   * Signal the backend to cancel a running Choras simulation.
   * The worker thread stops after the current pair/source step completes.
   */
  async cancelChorasSimulation(simulationId: string): Promise<void> {
    try {
      await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/cancel-simulation/${simulationId}`,
        { method: 'POST' },
        'Cancel Choras simulation'
      );
    } catch (error) {
      // Non-fatal: log but don't rethrow — UI already shows cancelled state
      console.warn('cancelChorasSimulation:', error);
    }
  },

  /**
   * Retrieve a Choras simulation WAV file by filename.
   */
  async getChorasIRFile(simulationId: string, irFilename: string): Promise<Blob> {
    try {
      const url = new URL(`${API_BASE_URL}/choras/get-result-file/${simulationId}/wav`);
      url.searchParams.append('ir_filename', irFilename);

      const response = await fetchWithErrorHandling(
        url.toString(),
        undefined,
        'Get Choras IR file'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Choras IR file' }));
        throw new Error(error.detail || 'Failed to get Choras IR file');
      }
      return response.blob();
    } catch (error) {
      handleApiError(error, 'Get Choras IR file');
    }
  },

  // Speckle API Methods

  /**
   * Get all Speckle models with detailed metadata.
   * Returns the full response envelope including project_id, models, and auth_token.
   */
  async getSpeckleModels(): Promise<SpeckleProjectModelsResponse> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/models`,
        undefined,
        'Get Speckle models'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to get Speckle models' }));
        throw new Error(error.detail || 'Failed to get Speckle models');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Speckle models');
    }
  },

  /**
   * Load a specific Speckle model by object ID
   * @param objectId - The Speckle object ID to load
   * @returns Speckle model data
   */
  async loadSpeckleModel(objectId: string): Promise<any> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/models/${objectId}`,
        undefined,
        'Load Speckle model'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to load Speckle model' }));
        throw new Error(error.detail || 'Failed to load Speckle model');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Load Speckle model');
    }
  },

  // Soundscape Data Persistence

  /**
   * Save soundscape data (configs, events, audio files) to Speckle + local storage.
   * @param payload - Soundscape save payload with data and audio URLs
   */
  async saveSoundscapeToSpeckle(payload: SoundscapeSavePayload): Promise<SoundscapeSaveResponse> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/save`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        'Save soundscape to Speckle'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to save soundscape' }));
        throw new Error(error.detail || 'Failed to save soundscape');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Save soundscape to Speckle');
    }
  },

  /**
   * Load soundscape data for a Speckle model (local-first, Speckle fallback).
   * @param modelId - Speckle model ID
   */
  async loadSoundscapeFromSpeckle(modelId: string): Promise<SoundscapeLoadResponse> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}`,
        undefined,
        'Load soundscape from Speckle'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to load soundscape' }));
        throw new Error(error.detail || 'Failed to load soundscape');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Load soundscape from Speckle');
    }
  },

  /**
   * Upload a blob audio file to the soundscape folder on the server.
   * Used for library/uploaded sounds that only have browser blob URLs.
   *
   * @param modelId - Speckle model ID (used as folder name)
   * @param soundId - Sound event ID (used to derive filename)
   * @param audioBlob - The audio data as a Blob
   * @returns Object with the saved filename and sound_id
   */
  async uploadSoundscapeAudio(
    modelId: string,
    soundId: string,
    audioBlob: Blob,
  ): Promise<{ filename: string; sound_id: string }> {
    try {
      const formData = new FormData();
      formData.append('sound_id', soundId);
      formData.append('audio', audioBlob, `${soundId}.wav`);

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/speckle/soundscape/${encodeURIComponent(modelId)}/upload-audio`,
        {
          method: 'POST',
          body: formData,
        },
        'Upload soundscape audio'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to upload audio' }));
        throw new Error(error.detail || 'Failed to upload audio');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Upload soundscape audio');
    }
  },

  async getServiceVersions(llm_model?: string): Promise<ServiceVersions> {
    try {
      const url = llm_model ? `${API_BASE_URL}/api/versions?llm_model=${llm_model}` : `${API_BASE_URL}/api/versions`;
      const response = await fetchWithErrorHandling(
        url,
        {},
        'Service versions'
      );
      if (!response.ok) throw new Error('Failed to fetch service versions');
      return await response.json();
    } catch (error) {
      handleApiError(error, 'Service versions');
    }
  },

  // ── Token management ──────────────────────────────────────────────────────

  async getTokenStatus(): Promise<TokenStatus> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/tokens`,
        undefined,
        'Get token status'
      );
      if (!response.ok) throw new Error('Failed to get token status');
      return response.json();
    } catch (error) {
      handleApiError(error, 'Get token status');
    }
  },

  async updateTokens(tokens: TokenUpdate): Promise<TokenStatus> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/api/tokens`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokens),
        },
        'Update tokens'
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Failed to update tokens' }));
        throw new Error(err.detail || 'Failed to update tokens');
      }
      return response.json();
    } catch (error) {
      handleApiError(error, 'Update tokens');
    }
  },

  // ── SED analysis (queued) ─────────────────────────────────────────────────

  async startSEDAnalysis(formData: FormData): Promise<{ task_id: string }> {
    const response = await fetch(`${API_BASE_URL}/api/analyze-sound-events`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Failed to start SED analysis' }));
      throw new Error(err.detail || 'Failed to start SED analysis');
    }
    return response.json();
  },

  async getSEDAnalysisStatus(taskId: string): Promise<{
    task_id: string;
    progress: number;
    status: string;
    completed: boolean;
    cancelled: boolean;
    error?: string;
    result?: { audio_info: any; detected_sounds: any[]; total_classes_analyzed: number };
    queue_position?: number;
    queue_total?: number;
  }> {
    const response = await fetch(`${API_BASE_URL}/api/sed-analysis-status/${taskId}`);
    if (!response.ok) throw new Error('Failed to get SED analysis status');
    return response.json();
  },

  async cancelSEDAnalysis(taskId: string): Promise<void> {
    await fetch(`${API_BASE_URL}/api/cancel-sed-analysis/${taskId}`, { method: 'POST' });
  },
};

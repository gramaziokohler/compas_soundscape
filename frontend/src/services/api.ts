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
  }): Promise<{ text: string; sounds: string[]; prompts: any[] }> {
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

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Generate text');
    }
  },

  // Generate Sounds
  async generateSounds(data: {
    sounds: SoundGenerationConfig[];
    bounding_box: { min: number[]; max: number[] } | null;
  }): Promise<{ sounds: SoundEvent[] }> {
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
        const errorMessage = err.detail || 'Failed to generate sounds';
        
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

      return await response.json();
    } catch (error) {
      handleApiError(error, 'Generate sounds');
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

  /**
   * Get available materials from Choras library
   */
  async getChorasMaterials(): Promise<Array<{ id: number; name: string; description?: string; category?: string }>> {
    try {
      // Import CHORAS_API_BASE from constants
      const { CHORAS_API_BASE } = await import('@/utils/constants');
      const response = await fetchWithErrorHandling(
        `${CHORAS_API_BASE}/materials`,
        undefined,
        'Get Choras materials'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch Choras materials');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Get Choras materials');
    }
  },

  /**
   * Run full Choras simulation workflow
   * @param file - Geometry file (.obj)
   * @param materialId - Material ID from Choras library
   * @param simulationName - Name for the simulation
   * @param simulationSettings - Simulation parameters
   * @returns Simulation result data
   */
  async runChorasSimulation(
    file: File,
    materialId: number,
    simulationName: string,
    simulationSettings?: {
      de_c0?: number;
      de_ir_length?: number;
      de_lc?: number;
      edt?: number;
      sim_len_type?: 'ir_length' | 'edt';
    },
    excludedLayers?: string[]
  ): Promise<{
    simulationId: number;
    simulationRunId: number;
    modelId: number;
    percentage: number;
    status: string;
  }> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('materialId', materialId.toString());
      formData.append('simulationName', simulationName);
      
      if (simulationSettings) {
        formData.append('simulationSettings', JSON.stringify(simulationSettings));
      }

      if (excludedLayers && excludedLayers.length > 0) {
        formData.append('excludedLayers', JSON.stringify(excludedLayers));
      }

      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/run-simulation`,
        {
          method: 'POST',
          body: formData
        },
        'Run Choras simulation'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Simulation failed' }));
        throw new Error(error.detail || 'Simulation failed');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Run Choras simulation');
    }
  },

  /**
   * Get Choras simulation status and progress
   */
  async getChorasSimulationStatus(simulationRunId: number): Promise<{
    id: number;
    status: string;
    percentage: number;
    completedAt: string | null;
  }> {
    try {
      const { CHORAS_API_BASE } = await import('@/utils/constants');
      const response = await fetchWithErrorHandling(
        `${CHORAS_API_BASE}/simulations/run`,
        undefined,
        'Get Choras simulation status'
      );

      if (!response.ok) {
        throw new Error('Failed to fetch simulation status');
      }

      const allRuns = await response.json();
      const runInfo = allRuns.find((run: any) => run.id === simulationRunId);

      if (!runInfo) {
        throw new Error('Simulation run not found');
      }

      return runInfo;
    } catch (error) {
      handleApiError(error, 'Get Choras simulation status');
    }
  },

  /**
   * Cancel a running Choras simulation
   */
  async cancelChorasSimulation(simulationId: number): Promise<void> {
    try {
      const { CHORAS_API_BASE } = await import('@/utils/constants');
      const response = await fetchWithErrorHandling(
        `${CHORAS_API_BASE}/simulations/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simulationId })
        },
        'Cancel Choras simulation'
      );

      if (!response.ok) {
        throw new Error('Failed to cancel simulation');
      }
    } catch (error) {
      handleApiError(error, 'Cancel Choras simulation');
    }
  },

  /**
   * Save Choras simulation results to backend
   */
  async saveChorasResults(simulationId: number): Promise<{
    wav_path: string;
    json_path: string;
    message: string;
  }> {
    try {
      const response = await fetchWithErrorHandling(
        `${API_BASE_URL}/choras/save-results`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ simulationId })
        },
        'Save Choras results'
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to save results' }));
        throw new Error(error.detail || 'Failed to save results');
      }

      return response.json();
    } catch (error) {
      handleApiError(error, 'Save Choras results');
    }
  },

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

      // Determine the actual backend simulation mode:
      // - FOA + ray_tracing=true → 'foa_raytracing' (uses A-format tetrahedral array)
      // - FOA + ray_tracing=false → 'foa' (uses directivity patterns, ISM only)
      // - Mono → 'mono' (works with both ISM and ray tracing)
      let backendSimulationMode = settings.simulation_mode;
      if (settings.simulation_mode === 'foa' && settings.ray_tracing) {
        backendSimulationMode = 'foa_raytracing';
      }
      formData.append('simulation_mode', backendSimulationMode);
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
    },
    sourceReceiverPairs: Array<{
      source_position: number[];
      receiver_position: number[];
      source_id: string;
      receiver_id: string;
    }>,
    geometryObjectIds?: string[],
    objectScattering?: Record<string, number>
  ): Promise<{
    simulation_id: string;
    message: string;
    ir_files: string[];
    results_file: string;
    grid_plot_file?: string;
  }> {
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

      // Determine backend simulation mode (same logic as file-based version)
      let backendSimulationMode = settings.simulation_mode;
      if (settings.simulation_mode === 'foa' && settings.ray_tracing) {
        backendSimulationMode = 'foa_raytracing';
      }
      formData.append('simulation_mode', backendSimulationMode);
      formData.append('enable_grid', (settings.enable_grid ?? false).toString());

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
  }
};

import { API_BASE_URL } from '@/lib/constants';
import type { CompasGeometry, SoundEvent, SoundGenerationConfig } from '@/types';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { ModalAnalysisRequest, ModalAnalysisResult } from '@/types/modal';

// API Service Layer
export const apiService = {
  // File Upload
  async uploadFile(file: File): Promise<CompasGeometry> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail);
    }

    return await response.json();
  },

  // Load Sample IFC
  async loadSampleIfc(): Promise<CompasGeometry> {
    const response = await fetch(`${API_BASE_URL}/api/load-sample-ifc`);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail);
    }

    return await response.json();
  },

  // Analyze 3DM File
  async analyze3dm(file: File): Promise<{ entities: any[] }> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE_URL}/api/analyze-3dm`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Failed to analyze 3DM file');
    }

    return await response.json();
  },

  // Analyze IFC File
  async analyzeIfc(): Promise<{ entities: any[] }> {
    const response = await fetch(`${API_BASE_URL}/api/analyze-ifc`);

    if (!response.ok) {
      throw new Error('Failed to analyze IFC file');
    }

    return await response.json();
  },

  // Generate Text/Prompts
  async generateText(data: {
    prompt?: string;
    num_sounds: number;
    entities?: any[];
  }): Promise<{ text: string; sounds: string[]; prompts: any[] }> {
    const response = await fetch(`${API_BASE_URL}/api/generate-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail);
    }

    return await response.json();
  },

  // Generate Sounds
  async generateSounds(data: {
    sounds: SoundGenerationConfig[];
    bounding_box: { min: number[]; max: number[] } | null;
  }): Promise<{ sounds: SoundEvent[] }> {
    const response = await fetch(`${API_BASE_URL}/api/generate-sounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail);
    }

    return await response.json();
  },

  // Cleanup Generated Sounds
  async cleanupGeneratedSounds(): Promise<void> {
    await fetch(`${API_BASE_URL}/api/cleanup-generated-sounds`, {
      method: 'POST'
    });
  },

  // Impulse Response Management

  /**
   * Upload an impulse response file
   */
  async uploadImpulseResponse(file: File, name: string): Promise<ImpulseResponseMetadata> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', name);
    
    const response = await fetch(`${API_BASE_URL}/api/impulse-responses/upload`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to upload impulse response');
    }
    
    return response.json();
  },
  
  /**
   * List all impulse responses
   */
  async listImpulseResponses(): Promise<ImpulseResponseMetadata[]> {
    const response = await fetch(`${API_BASE_URL}/api/impulse-responses`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch impulse responses');
    }
    
    const data = await response.json();
    return data.impulse_responses;
  },
  
  /**
   * Delete an impulse response
   */
  async deleteImpulseResponse(irId: string): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/impulse-responses/${irId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to delete impulse response');
    }
  },

  // Modal Analysis

  /**
   * Perform modal analysis on a mesh to find resonant frequencies
   */
  async analyzeModal(request: ModalAnalysisRequest): Promise<ModalAnalysisResult> {
    const response = await fetch(`${API_BASE_URL}/api/modal-analysis/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Modal analysis failed');
    }

    return response.json();
  },

  /**
   * Get available material presets for modal analysis
   */
  async getModalMaterials(): Promise<{
    materials: Record<string, { young_modulus: number; poisson_ratio: number; density: number }>;
    description: Record<string, string>;
  }> {
    const response = await fetch(`${API_BASE_URL}/api/modal-analysis/materials`);

    if (!response.ok) {
      throw new Error('Failed to fetch modal materials');
    }

    return response.json();
  }
};

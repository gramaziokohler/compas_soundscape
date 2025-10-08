import { API_BASE_URL } from '@/lib/constants';
import type { CompasGeometry, SoundEvent, SoundGenerationConfig } from '@/types';

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
};

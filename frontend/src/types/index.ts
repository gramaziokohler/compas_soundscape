// Type Definitions
export interface CompasGeometry {
  vertices: number[][];
  faces: number[][];
}

export interface SoundEvent {
  id: string;
  url: string;
  position: [number, number, number];
  geometry: CompasGeometry;
  display_name?: string;
  prompt?: string;
  prompt_index?: number;
  total_copies?: number;
}

export interface UIOverlay {
  promptKey: string;
  promptIdx: number;
  x: number;
  y: number;
  visible: boolean;
  soundId: string;
  displayName: string;
  variants: SoundEvent[];
  selectedVariantIdx: number;
}

export interface SoundGenerationConfig {
  prompt: string;
  duration: number;
  guidance_scale: number;
  negative_prompt: string;
  seed_copies: number;
  entity?: any;
}

export type SoundState = 'playing' | 'paused' | 'stopped';

export type ActiveTab = 'text' | 'sound';
export type LoadTab = 'sample' | 'upload';

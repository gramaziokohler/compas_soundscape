// Type Definitions
export interface CompasGeometry {
  vertices: number[][];
  faces: number[][];
  face_entity_map?: number[];  // Maps face index to entity index
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

export interface EntityData {
  index: number;
  type: string;
  name?: string;
  layer?: string;
  material?: string;
  position: number[];
  bounds: {
    min: number[];
    max: number[];
    center?: number[];
  };
}

export interface EntityOverlay {
  x: number;
  y: number;
  visible: boolean;
  entity: EntityData;
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

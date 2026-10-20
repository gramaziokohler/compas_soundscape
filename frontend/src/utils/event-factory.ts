/**
 * Sound Event Factory
 *
 * Factory functions for creating SoundEvent objects.
 * Extracted from useSoundGeneration.ts to centralize sound event creation logic.
 */

import type { SoundEvent, SoundGenerationConfig, CompasGeometry } from "@/types";
// import { calculateSoundPositionWithSpacing, type GeometryBounds } from "@/utils/positioning"; // Bounding-box positioning removed — camera-front placement used instead
import { DEFAULT_SOUND_CONFIG } from "@/utils/constants";
import { cardEventId } from "@/utils/config-id";

/**
 * Create a SoundEvent from a configuration and audio URL.
 *
 * Used for uploaded and library sounds.
 *
 * @param config - Sound generation configuration
 * @param url - Audio file URL (blob or HTTP)
 * @param originalIndex - Original index in the config array
 * @param totalSounds - Total number of sounds being generated (all modes combined)
 * @param geometryBounds - Optional geometry bounds for positioning
 * @param idPrefix - ID prefix ('uploaded' or 'library')
 * @returns Complete SoundEvent object
 */
export function createSoundEventFromUpload(
  config: SoundGenerationConfig,
  url: string,
  originalIndex: number,
  totalSounds: number,
  geometryBounds?: any, // Kept for API compatibility; no longer used for positioning
  idPrefix: string = 'uploaded'
): SoundEvent {
  // Position priority:
  // 1. Entity bounding-box center  2. Entity position  3. Explicit config.position
  // 4. [0,0,0] (SoundSphereManager handles camera-front spiral placement)
  let position: [number, number, number];
  if (config.entities?.[0]?.bounds?.center) {
    position = config.entities[0].bounds.center as [number, number, number];
  } else if (config.entities?.[0]?.position) {
    position = config.entities[0].position as [number, number, number];
  } else if (config.position) {
    position = config.position as [number, number, number];
  } else {
    position = [0, 0, 0];
  }

  // Determine display name
  // IMPORTANT: Prioritize actual audio source over config.display_name
  // This ensures that when a sound card was created from a prompt but then
  // the user uploads their own audio or uses sample audio, the display name
  // reflects the actual audio being used, not the original prompt
  let displayName: string;
  if (idPrefix === 'uploaded' && config.uploadedAudioInfo?.filename) {
    // For uploaded audio, use the filename (without extension)
    displayName = config.uploadedAudioInfo.filename.replace(/\.[^/.]+$/, '');
  } else if (idPrefix === 'library' && config.selectedLibrarySound?.description) {
    // For library sounds, use the description
    displayName = config.selectedLibrarySound.description;
  } else if (config.display_name) {
    // Fallback to config display_name if no source-specific name available
    displayName = config.display_name;
  } else if (config.prompt) {
    // For text-to-audio modes (e.g. ElevenLabs), use the full prompt as display name
    displayName = config.prompt;
  } else {
    // Final fallback
    displayName = `${idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1)} ${originalIndex + 1}`;
  }

  // Determine prompt
  let prompt = config.prompt;
  if (!prompt) {
    if (idPrefix === 'library' && config.selectedLibrarySound?.description) {
      prompt = config.selectedLibrarySound.description;
    } else {
      prompt = `${idPrefix.charAt(0).toUpperCase() + idPrefix.slice(1)} audio`;
    }
  }

  return {
    // Keyed on the card identity, never its index (indices are recycled).
    id: cardEventId(idPrefix, config.config_id, 0),
    url,
    position,
    geometry: config.entities?.[0]?.geometry || createEmptyGeometry(),
    display_name: displayName,
    prompt,
    prompt_index: originalIndex,
    config_id: config.config_id,
    total_copies: 1,
    volume_dbfs: config.dbfs ?? DEFAULT_SOUND_CONFIG.dbfs, // Default to -18 dBFS
    interval_seconds: config.interval_seconds ?? DEFAULT_SOUND_CONFIG.interval_seconds, // 0 = back-to-back auto loop
    isUploaded: true, // Mark as uploaded/library sound
    // Include entity_index (primary) and entity_indices (all) if entities are present.
    // For entities with a Speckle ID but no numeric index, use originalIndex as a sentinel
    // so SoundSphereManager treats the sound as entity-linked (no floating sphere).
    ...(config.entities?.[0]?.index !== undefined
      ? { entity_index: config.entities[0].index, entity_indices: config.entities.map((e: any) => e.index).filter((i: any) => i !== undefined) }
      : (config.entities?.[0]?.nodeId || config.entities?.[0]?.id)
        ? { entity_index: originalIndex, entity_indices: [originalIndex] }
        : {}),
    // Carry foley timestamps through to the SoundEvent — except backgrounds,
    // which auto-pack via interval_seconds (0 = back-to-back) instead.
    ...((() => {
      const normalized = (config.category || '').toLowerCase().replace(/[\s-]+/g, '_');
      const isBackground = normalized === 'background' || normalized === 'background_sound';
      return !isBackground && config.timestamps?.length ? { timestamps: config.timestamps } : {};
    })()),
    // Carry foley category through for DAW grouping
    ...(config.category ? { category: config.category } : {}),
  };
}

/**
 * Create an empty geometry object.
 *
 * @returns Empty CompasGeometry with no vertices or faces
 */
function createEmptyGeometry(): CompasGeometry {
  return {
    vertices: [],
    faces: [],
  };
}

/**
 * Extract filename without extension.
 *
 * @param filename - Full filename with extension
 * @returns Filename without extension
 */
export function removeFileExtension(filename: string): string {
  return filename.replace(/\.[^/.]+$/, "");
}

/**
 * Card-derived fields of a backend-generated sound: entity link, position,
 * foley timestamps and category. Shared by the live generation path and job
 * recovery (another tab's / member's job), so a recovered sound lands exactly
 * like one this tab generated.
 *
 * @param sound - Raw backend sound (may carry its own `entity_index` / `position`)
 * @param config - The card the sound belongs to (undefined when unknown)
 * @param cardIndex - The card's current index (entity-link sentinel)
 */
export function generatedEventFieldsFromConfig(
  sound: { entity_index?: number; position?: number[] },
  config: SoundGenerationConfig | undefined,
  cardIndex: number,
): {
  position: number[];
  entity_index?: number;
  entity_indices?: number[];
  timestamps?: string[];
  category?: string;
} {
  const firstEntity = config?.entities?.[0];
  let entityIndex = sound.entity_index;
  if (entityIndex === undefined) {
    if (firstEntity?.index !== undefined) {
      entityIndex = firstEntity.index;
    } else if (firstEntity?.nodeId || firstEntity?.id) {
      // Entity has a Speckle ID but no numeric index — use the card index as a
      // sentinel so SoundSphereManager treats this as entity-linked (no sphere).
      entityIndex = cardIndex;
    }
  }
  // Card-level link: every variant carries the full entity index list.
  const entityIndices = config?.entities?.length
    ? config.entities.map((e) => e.index).filter((i): i is number => i !== undefined)
    : undefined;

  let position: number[] = sound.position ?? [0, 0, 0];
  if (firstEntity?.bounds?.center) {
    position = firstEntity.bounds.center as number[];
  } else if (firstEntity?.position) {
    position = firstEntity.position as number[];
  } else if (config?.position) {
    position = config.position as number[];
  }

  // Foley timestamps carry over — except backgrounds, which auto-pack via
  // interval_seconds (0 = back-to-back).
  const normalizedCategory = (config?.category || '').toLowerCase().replace(/[\s-]+/g, '_');
  const isBg = normalizedCategory === 'background' || normalizedCategory === 'background_sound';
  const timestamps = config?.timestamps;

  return {
    position,
    ...(entityIndex !== undefined ? { entity_index: entityIndex } : {}),
    ...(entityIndices?.length ? { entity_indices: entityIndices } : {}),
    ...(!isBg && timestamps?.length ? { timestamps } : {}),
    // Foley category for DAW grouping
    ...(config?.category ? { category: config.category } : {}),
  };
}

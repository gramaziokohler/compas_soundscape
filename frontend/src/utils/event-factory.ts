/**
 * Sound Event Factory
 *
 * Factory functions for creating SoundEvent objects.
 * Extracted from useSoundGeneration.ts to centralize sound event creation logic.
 */

import type { SoundEvent, SoundGenerationConfig, CompasGeometry } from "@/types";
// import { calculateSoundPositionWithSpacing, type GeometryBounds } from "@/utils/positioning"; // Bounding-box positioning removed — camera-front placement used instead
import { DEFAULT_SOUND_CONFIG } from "@/utils/constants";

/**
 * Generate unique sound ID.
 *
 * @param prefix - ID prefix (e.g., 'sound', 'uploaded', 'library')
 * @param index - Sound index
 * @param variant - Variant number (default: 0)
 * @returns Unique sound ID string
 */
export function generateSoundId(prefix: string, index: number, variant: number = 0): string {
  return `${prefix}-${index}-${variant}`;
}

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
  // Determine position: entity-linked sounds use the entity's center.
  // Non-entity sounds use [0,0,0] — SoundSphereManager places them in front of the camera.
  let position: [number, number, number];
  if (config.entity?.bounds?.center) {
    position = config.entity.bounds.center as [number, number, number];
  } else if (config.entity?.position) {
    position = config.entity.position as [number, number, number];
  } else {
    // No entity: camera-front placement (handled by SoundSphereManager)
    // position = calculateSoundPositionWithSpacing(...); // Bounding-box positioning removed
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
    id: generateSoundId(idPrefix, originalIndex, 0),
    url,
    position,
    geometry: config.entity?.geometry || createEmptyGeometry(),
    display_name: displayName,
    prompt,
    prompt_index: originalIndex,
    total_copies: 1,
    volume_db: config.spl_db ?? DEFAULT_SOUND_CONFIG.spl_db, // Default to 70 dB
    interval_seconds: config.interval_seconds ?? DEFAULT_SOUND_CONFIG.interval_seconds, // Default to 5 seconds
    isUploaded: true, // Mark as uploaded/library sound
    // Include entity_index if entity is present
    ...(config.entity?.index !== undefined && { entity_index: config.entity.index })
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

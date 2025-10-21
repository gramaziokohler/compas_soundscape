/**
 * ThreeScene Component Types
 *
 * Type definitions for the main 3D scene component.
 * Extracted from ThreeScene.tsx to improve modularity and reusability.
 */

import type { CompasGeometry, SoundEvent, SoundState, EntityData, ReceiverData } from "./index";
import type { AuralizationConfig } from "./auralization";

/**
 * ThreeScene Component Props
 *
 * Props for the main 3D visualization component that handles:
 * - 3D geometry rendering
 * - Spatial audio playback with interval scheduling
 * - Entity highlighting and selection
 * - Receiver placement and management
 * - Auralization with impulse responses
 */
export interface ThreeSceneProps {
  /** The 3D geometry data to visualize (COMPAS format) */
  geometryData: CompasGeometry | null;

  /** Array of sound events in the soundscape */
  soundscapeData: SoundEvent[] | null;

  /** Playback states for individual sounds (keyed by sound ID) */
  individualSoundStates: { [key: string]: SoundState };

  /** Selected variant indices for each prompt group (keyed by prompt index) */
  selectedVariants: { [key: number]: number };

  /** Volume levels in dB for each sound (keyed by sound ID) */
  soundVolumes: { [key: string]: number };

  /** Playback intervals in seconds for each sound (keyed by sound ID) */
  soundIntervals: { [key: string]: number };

  /** Callback when a sound's play/pause state is toggled */
  onToggleSound: (soundId: string) => void;

  /** Callback when a variant is selected for a prompt group */
  onVariantChange: (promptIdx: number, variantIdx: number) => void;

  /** Callback when a sound's volume is changed */
  onVolumeChange: (soundId: string, volumeDb: number) => void;

  /** Callback when a sound's interval is changed */
  onIntervalChange: (soundId: string, intervalSeconds: number) => void;

  /** Callback when a sound is deleted */
  onDeleteSound: (soundId: string, promptIdx: number) => void;

  /** Callback to start playing all sounds */
  onPlayAll: () => void;

  /** Callback to pause all sounds */
  onPauseAll: () => void;

  /** Callback to stop all sounds */
  onStopAll: () => void;

  /** Whether any sound is currently playing */
  isAnyPlaying: boolean;

  /** Scale factor for sound sphere visualization */
  scaleForSounds: number;

  /** All entities extracted from the model */
  modelEntities?: EntityData[];

  /** Diverse entities selected for prompts */
  selectedDiverseEntities?: EntityData[];

  /** Auralization configuration (impulse response settings) */
  auralizationConfig: AuralizationConfig;

  /** Array of receiver positions for binaural audio */
  receivers?: ReceiverData[];

  /** Callback when a receiver position is updated */
  onUpdateReceiverPosition?: (id: string, position: [number, number, number]) => void;

  /** Callback when a new receiver is placed in the scene */
  onPlaceReceiver?: (position: [number, number, number]) => void;

  /** Whether the user is currently in receiver placement mode */
  isPlacingReceiver?: boolean;

  /** Callback to cancel receiver placement mode */
  onCancelPlacingReceiver?: () => void;

  /** Optional CSS class name for the container */
  className?: string;
}

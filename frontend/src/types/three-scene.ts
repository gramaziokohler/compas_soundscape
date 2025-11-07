/**
 * ThreeScene Component Types
 *
 * Type definitions for the main 3D scene component.
 * Extracted from ThreeScene.tsx to improve modularity and reusability.
 */

import type { CompasGeometry, SoundEvent, SoundState, EntityData, ReceiverData } from "./index";
import type { AuralizationConfig } from "./auralization";
import type { ResonanceAudioConfig } from "./audio";
import type { ModeVisualizationState } from "./modal";

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

  /** Set of muted sound IDs */
  mutedSounds: Set<string>;

  /** ID of the soloed sound (only this sound plays, null if none) */
  soloedSound: string | null;

  /** Callback when a sound's play/pause state is toggled */
  onToggleSound: (soundId: string) => void;

  /** Callback when a variant is selected for a prompt group */
  onVariantChange: (promptIdx: number, variantIdx: number) => void;

  /** Callback when a sound's volume is changed */
  onVolumeChange: (soundId: string, volumeDb: number) => void;

  /** Callback when a sound's interval is changed */
  onIntervalChange: (soundId: string, intervalSeconds: number) => void;

  /** Callback when a sound is muted/unmuted */
  onMute: (soundId: string) => void;

  /** Callback when a sound is soloed/unsoloed */
  onSolo: (soundId: string) => void;

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

  /** Resonance Audio configuration (real-time spatial audio) */
  resonanceAudioConfig?: ResonanceAudioConfig;

  /** Geometry bounding box (for room dimensions) */
  geometryBounds?: { min: [number, number, number]; max: [number, number, number] } | null;

  /** Whether to show the bounding box wireframe visualization */
  showBoundingBox?: boolean;

  /** Trigger to refresh bounding box calculation (increment to refresh) */
  refreshBoundingBoxTrigger?: number;

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

  /** Whether the user is currently in entity linking mode for sounds */
  isLinkingEntity?: boolean;

  /** Callback when an entity is selected for linking to a sound (or null to unlink/exit) */
  onEntityLinked?: (entity: EntityData | null) => void;

  /** Mode visualization state (for modal analysis nodal line visualization) */
  modeVisualizationState?: ModeVisualizationState;

  /** Callback when mode visualization is toggled */
  onSetModeVisualization?: (active: boolean) => void;

  /** Callback when a specific mode is selected for visualization */
  onSelectMode?: (modeIndex: number | null) => void;

  /** Optional CSS class name for the container */
  className?: string;
}

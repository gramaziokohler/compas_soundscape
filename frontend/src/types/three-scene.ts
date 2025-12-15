/**
 * ThreeScene Component Types
 *
 * Type definitions for the main 3D scene component.
 * Extracted from ThreeScene.tsx to improve modularity and reusability.
 */

import type { CompasGeometry, SoundEvent, SoundState, EntityData, ReceiverData } from "./index";
import type { AuralizationConfig, ResonanceAudioConfig } from "./audio";
import type { ModeVisualizationState } from "./modal";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";
import type { AudioOrchestrator } from "@/lib/audio/AudioOrchestrator";
import type { SelectedGeometry } from "./materials";

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

  /** Callback when a sound card should be selected/expanded in sidebar */
  onSelectSoundCard?: (promptIndex: number) => void;

  /** Currently selected sound card index (for highlighting in scene) */
  selectedCardIndex?: number | null;

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

  /** ShoeBox Acoustics configuration (real-time spatial audio) */
  resonanceAudioConfig?: ResonanceAudioConfig;

  /** Geometry bounding box (for room dimensions) */
  geometryBounds?: { min: [number, number, number]; max: [number, number, number] } | null;

  /** Whether to show the bounding box wireframe visualization */
  showBoundingBox?: boolean;

  /** Trigger to refresh bounding box calculation (increment to refresh) */
  refreshBoundingBoxTrigger?: number;

  /** Array of receiver positions for binaural audio */
  receivers?: ReceiverData[];

  /** Currently selected receiver ID (for audio routing) */
  selectedReceiverId?: string | null;

  /** Callback when a receiver position is updated */
  onUpdateReceiverPosition?: (id: string, position: [number, number, number]) => void;

  /** Callback when a receiver is selected (double-click) for audio */
  onReceiverSelected?: (id: string) => void;

  /** Callback when a sound source position is updated (dragged in scene) */
  onUpdateSoundPosition?: (soundId: string, position: [number, number, number]) => void;

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

  /** Callback to toggle entity in diverse selection (for LLM prompts) */
  onToggleDiverseSelection?: (entity: EntityData) => void;

  /** Callback to detach linked sound from entity and create sound sphere */
  onDetachSound?: (entity: EntityData) => void;

  /** Mode visualization state (for modal analysis nodal line visualization) */
  modeVisualizationState?: ModeVisualizationState;

  /** Callback when mode visualization is toggled */
  onSetModeVisualization?: (active: boolean) => void;

  /** Callback when a specific mode is selected for visualization */
  onSelectMode?: (modeIndex: number | null) => void;

  /** Callback when receiver mode (first-person view) changes */
  onReceiverModeChange?: (isActive: boolean, receiverId: string | null) => void;

  /** Receiver ID to programmatically activate first-person view (set to trigger camera movement) */
  goToReceiverId?: string | null;

  /** Current audio rendering mode (Flat Anechoic, ShoeBox Acoustics, Spatial Anechoic) */
  audioRenderingMode?: AudioRenderingMode;

  /** Audio orchestrator instance for managing all audio modes */
  audioOrchestrator?: AudioOrchestrator | null;

  /** Web Audio API context */
  audioContext?: AudioContext | null;

  /** Currently selected IR ID (triggers re-registration when changed) */
  selectedIRId?: string | null;

  /** Optional CSS class name for the container */
  className?: string;

  // Sound generation advanced settings
  /** Global duration for all sound tabs (in seconds) */
  globalDuration?: number;

  /** Global diffusion steps for text-to-audio generation */
  globalSteps?: number;

  /** Global negative prompt for text-to-audio generation */
  globalNegativePrompt?: string;

  /** Whether to apply denoising to generated sounds */
  applyDenoising?: boolean;

  /** Whether to normalize impulse responses globally */
  normalizeImpulseResponses?: boolean;

  /** Selected audio generation model (TangoFlux or AudioLDM2) */
  audioModel?: string;

  /** Callback when global duration changes */
  onGlobalDurationChange?: (value: number) => void;

  /** Callback when global steps changes */
  onGlobalStepsChange?: (value: number) => void;

  /** Callback when global negative prompt changes */
  onGlobalNegativePromptChange?: (value: string) => void;

  /** Callback when denoising setting changes */
  onApplyDenoisingChange?: (value: boolean) => void;

  /** Callback when IR normalization changes */
  onNormalizeImpulseResponsesChange?: (value: boolean) => void;

  /** Callback when audio model changes */
  onAudioModelChange?: (value: string) => void;

  /** Callback to reset all advanced settings to defaults */
  onResetAdvancedSettings?: () => void;

  // Material assignment (NEW - for precise acoustics mode)
  /** Selected geometry for material assignment */
  selectedGeometry?: SelectedGeometry | null;

  /** Callback when face is selected in 3D scene */
  onFaceSelected?: (faceIndex: number, entityIndex: number) => void;

  /** Material assignments for geometry (stored in page.tsx) */
  materialAssignments?: Map<string, { selection: SelectedGeometry, material: import('./materials').AcousticMaterial | null }>;

  /** Active simulation index (null if no simulation is active) */
  activeSimulationIndex?: number | null;

  /** Active simulation configuration (contains faceToMaterialMap for dynamic coloring) */
  activeSimulationConfig?: import('./acoustics').SimulationConfig | null;

  /** Active sidebar tab (for determining input mode) */
  activeAiTab?: 'text' | 'sound' | 'acoustics';
}

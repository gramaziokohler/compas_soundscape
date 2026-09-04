/**
 * Card UI Component Types
 *
 * Generic types for the unified Card component that handles
 * both Analysis and Sound generation tabs.
 */

import type { ReactNode } from 'react';
import type React from 'react';
import type { VariantsBarProps } from '@/components/ui/VariantsBar';

// ============================================================================
// Card Type Identifiers
// ============================================================================

/**
 * Available theme colors for Card and CardSection components.
 *
 * Maps to CSS custom properties defined in globals.css:
 * - `--color-{name}` (base), `--color-{name}-hover`, `--color-{name}-light`
 *
 * Used to theme all interactive "infills": sliders, dropdowns, borders,
 * action buttons, the '+' add button, progress bars, checkboxes, etc.
 *
 * The Card/CardSection wrapper sets scoped CSS custom properties:
 * - `--card-color`, `--card-color-hover`, `--card-color-light`
 * so any child component can reference `var(--card-color)` to match the theme.
 */
export type CardColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'error'
  | 'warning'
  | 'info';

/**
 * Card types - identifies the category of card (single source of truth)
 *
 * Analysis types: '3d-model', 'audio', 'text'
 * Sound types: 'text-to-audio', 'upload', 'library', 'sample-audio'
 * Acoustics types: 'resonance', 'choras', 'pyroomacoustics', 'import-irs'
 */
export type CardType =
  | '3d-model'
  | 'audio'
  | 'text'
  | 'text-to-audio'
  | 'text-to-speech'
  | 'upload'
  | 'library'
  | 'catalog'
  | 'sample-audio'
  | 'resonance'
  | 'choras'
  | 'pyroomacoustics'
  | 'import-irs'
  | 'listener'
  | 'grid-listener'
  | 'model-analysis'
  | 'scenario'
  | 'freeform';

/**
 * Default display names for each card type
 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  '3d-model': 'Select sonic objects',
  'audio': 'Audio context',
  'text': 'object-based',
  'text-to-audio': 'Text-to-Audio',
  'text-to-speech': 'Text-to-Speech',
  'upload': 'Upload custom audio',
  'library': 'Library Sound',
  'catalog': 'Catalog Sound',
  'sample-audio': 'Sample Audio',
  'resonance': 'Shoebox simulation',
  'choras': 'Wave-based simulation',
  'pyroomacoustics': 'Ray-tracing simulation',
  'import-irs': 'Import IRs',
  'listener': 'Listener',
  'grid-listener': 'Grid Listener',
  'model-analysis': 'Spatial context',
  'scenario': 'scenario-based',
  'freeform': 'Untitled',
};

/**
 * Short technical descriptions for each card type, shown in the card info
 * popover ("i" icon, bottom-right of every card). Single source of truth —
 * Card falls back to these unless a per-card `description` prop is passed.
 */
export const CARD_TYPE_DESCRIPTIONS: Record<CardType, string> = {
  '3d-model':
    'Select 3D objects from the loaded Speckle model that act as sound sources. Each selected object becomes a scene node; sounds placed on it inherit its world position and bounding-box anchor.',
  'audio':
    "Captures the acoustic character of the space via AI audio analysis. Can extract audio features/spectrograms and send them to the Sounds step ('Extract & go to Sounds').",
  'text':
    'Free-text card. Type a description of the intended soundscape and the LLM converts it into sound-generation prompts.',
  'text-to-audio':
    'Generate an original clip from a text prompt with AI (TangoFlux / AudioLDM2). Tune duration, guidance scale, denoising and inference steps; each run can produce multiple seed variants (A/B/C).',
  'text-to-speech':
    'Convert typed text into spoken audio via a TTS model. Each line becomes a speech segment managed by the variants bar.',
  'upload':
    'Use a local WAV/AIFF file as the source. Supports automatic segment extraction so one file can yield multiple clips.',
  'library':
    'Search the Freesound / BBC Sound Effects API and use a pre-recorded clip as the source.',
  'catalog':
    'Pick from a curated built-in catalog of sounds — no network or LLM required; fast placeholder sources.',
  'sample-audio': 'Use a short bundled sample clip as the source.',
  'resonance':
    'Resonance Audio synthetic room: parametric shoebox with early reflections + late reverb rendered by the Web Audio engine. No external solver; instant real-time 6DOF auralization.',
  'choras':
    'Choras wave-based solver (Diffusion Equation / Discontinuous Galerkin) on a gmsh-meshed room. Full impulse responses, highest fidelity, slowest.',
  'pyroomacoustics':
    'ISM + ray tracing on the Speckle mesh. Computes RT60 / EDT / C80 and per-source-per-receiver IR WAVs (mono or FOA B-format).',
  'import-irs':
    'Upload pre-recorded impulse-response WAVs (mono/stereo/FOA/SOA/TOA) and use them directly for spatial convolution — no simulation needed.',
  'listener':
    'Add a single listener (receiver) at a point in the scene; the audio pipeline renders the soundscape binaurally from that position.',
  'grid-listener':
    'Place a grid of listeners over an area to evaluate the soundscape at multiple positions at once (e.g. across a room).',
  'model-analysis':
    "Runs LLM analysis on the loaded Speckle model to describe the space's geometry, materials and acoustics — the basis of the Context step.",
  'scenario':
    'Generate scenario-based sound prompts from a description of how the space will be used (LLM-driven pipeline).',
  'freeform':
    'Blank bypass card — skips the current wizard step and jumps to the next one.',
};

// ============================================================================
// Card State Types
// ============================================================================

/**
 * Card visual states
 */
export type CardState = 'pending' | 'running' | 'completed' | 'error';

/**
 * Standard execution state for any card that runs a process.
 * Use this mixin to ensure consistency for simulation/generation cards.
 */
export interface CardExecutionState {
  /** Whether the process is currently active */
  isRunning: boolean;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current status message */
  status: string;
  /** Error message if failed */
  error: string | null;
}

/**
 * Base configuration shared by all cards
 */
export interface CardBaseConfig {
  /** Card type identifier */
  type: CardType;
  /** Custom display name (optional) */
  display_name?: string;
  /** Number of sounds/prompts to generate */
  numSounds?: number;
}

// ============================================================================
// Custom Menu Item Type
// ============================================================================

/**
 * A structured menu item for the Card's kebab (⋮) action menu.
 */
export interface CustomMenuItem {
  /** Unique key for React rendering */
  key: string;
  /** Icon element shown in the menu row */
  icon: ReactNode;
  /** Text label shown next to the icon */
  label: string;
  /** Click handler — called on item click (omit when using subItems only) */
  onClick?: (e: React.MouseEvent) => void;
  /** Disables the item (grayed out, not clickable) */
  disabled?: boolean;
  /** When true, renders with card-color accent styling */
  isActive?: boolean;
  /** Nested items rendered as an accordion below this item when clicked */
  subItems?: Array<{
    key: string;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    disabled?: boolean;
    isActive?: boolean;
  }>;
}

// ============================================================================
// Card Props Interface
// ============================================================================

/**
 * Main Card component props
 */
export interface CardProps<TConfig extends CardBaseConfig = CardBaseConfig, TResult = unknown> extends Partial<CardExecutionState> {
  /** Card configuration data */
  config: TConfig;
  /** Index in the parent list */
  index: number;
  /** Whether the card is expanded */
  isExpanded: boolean;
  /** Whether the card has completed generation */
  hasResult: boolean;

  /**
   * Theme color for all interactive elements inside this card.
   *
   * Applies to: action button, progress bar, borders, input focus ring,
   * and sets `accent-color` for native inputs (sliders, checkboxes).
   * Also sets `--card-color` CSS custom property for child components.
   *
   * @default 'primary'
   */
  color?: CardColor;

  // ============================================================================
  // Simulation Action Button Props (for acoustics cards)
  // ============================================================================
  /**
   * Called when the action button (e.g., "Start Simulation") is clicked.
   * When provided, displays an action button in expanded mode (not running).
   */
  onRun?: () => Promise<void>;
  /**
   * Called when the stop button is clicked during running state.
   * When provided along with isRunning=true, displays stop button.
   */
  onCancel?: () => void;
  /**
   * Button label for the action button (default: "Start Simulation")
   */
  actionButtonLabel?: string;

  actionButtonColor?: string;
  /**
   * Whether the action button should be disabled
   */
  actionButtonDisabled?: boolean;
  /**
   * Tooltip text when action button is disabled
   */
  actionButtonDisabledReason?: string;
  /**
   * Label for the done-state continue action (e.g. "Next: Usage", "Send to sounds").
   * Shown in the bottom bar once the card has a result. When omitted, the bottom
   * bar hides entirely after generation (nothing left to generate).
   */
  doneActionLabel?: string;
  /**
   * Click handler for the done-state continue action. Only rendered when
   * doneActionLabel is also provided.
   */
  onDoneAction?: () => void;
  /** Result data (when hasResult is true) */
  result?: TResult;

  // Header Configuration
  /** Default name to show when display_name is not set */
  defaultName?: string;
  /** Info text shown in collapsed state (e.g., "3 selected prompts") */
  collapsedInfo?: string;
  /** When true (and collapsed), shows a small italic "playing" label in the header. */
  isPlayingCollapsedInfo?: boolean;
  /** Whether to show the index number prefix */
  showIndex?: boolean;

  /**
   * Per-card description shown in the info ("i") popover, bottom-right of the
   * card. Falls back to `CARD_TYPE_DESCRIPTIONS[config.type]` when omitted.
   */
  description?: string;

  // Button Configuration
  /** Whether the card can be removed (shows close button) */
  canRemove?: boolean;
  /** Custom title for the close button */
  closeButtonTitle?: string;
  /** Custom title for the reset button */
  resetButtonTitle?: string;
  /** Menu items shown in the kebab (⋮) dropdown — replaces the old ReactNode[] pattern */
  customButtons?: CustomMenuItem[];

  // Callbacks
  /** Called when card expand/collapse is toggled */
  onToggleExpand: (index: number) => void;
  /** Called when config is updated (e.g., name change) */
  onUpdateConfig: (index: number, updates: Partial<TConfig>) => void;
  /** Called when card is removed */
  onRemove: (index: number) => void;
  /** Called when card is reset (result cleared) */
  onReset: (index: number) => void;
  /** Called when the inline error is dismissed (clears the error state in the parent) */
  onDismissError?: (index: number) => void;
  /** Called when the card header is double-clicked (e.g. zoom to associated 3D object) */
  onDoubleClickCard?: (index: number) => void;

  /** Library/service version string(s) shown under the title in after-generation state. Pass an array for multiple lines. */
  version?: string | string[];

  // Content Slots
  /** Content to show when card has no result (before generation) */
  beforeContent?: ReactNode;
  /** Content to show when card has result (after generation) */
  afterContent?: ReactNode;
  /** Content to show while generation is running (optional loading state) */
  loadingContent?: ReactNode;
  /**
   * When true, keeps `afterContent` mounted (visually hidden) while the card is
   * collapsed instead of unmounting it. Needed for content that owns a live
   * resource (e.g. a playing WaveSurfer/audio instance) that must survive
   * collapse/expand cycles without being destroyed and recreated.
   */
  keepContentMountedWhenCollapsed?: boolean;
  /** When true, dims the card title and body (but not the action buttons / kebab menu) */
  dimmed?: boolean;
  /** Optional element rendered to the left of the card title in the header (e.g., entity link button) */
  headerPrefix?: ReactNode;
  /** Optional element rendered to the left of the bottom-bar action (e.g. simulation count dots). Hidden while generating. */
  footerPrefix?: ReactNode;

  // Variants Bar (letter-square selector for sound cards)
  /**
   * Data + callbacks for the letter-square variants bar. Rendered below the
   * before/after content when the matching show-variants flag is true.
   */
  variants?: VariantsBarProps | null;
  /** Show the variants bar when the card is in pre-generation state (!hasResult). */
  showVariantsPreGen?: boolean;
  /** Show the variants bar when the card is in post-generation state (hasResult). */
  showVariantsPostGen?: boolean;

  /**
   * Show a collapsible, read-only recap of the card's pre-generation settings
   * below the post-generation content.
   * @default true
   */
  showSettingsSummary?: boolean;
}


// ============================================================================
// Card Header Props (for sub-component)
// ============================================================================

/**
 * Props for the CardHeader sub-component
 */
export interface CardHeaderProps {
  /** Display name (with index if showIndex is true) */
  displayName: string;
  /** Whether the name is currently being edited */
  isEditingName: boolean;
  /** Current editing value */
  editingValue: string;
  /** Collapsed info text */
  collapsedInfo?: string;
  /** Whether card is expanded */
  isExpanded: boolean;
  /** Whether card has result */
  hasResult: boolean;

  // Callbacks
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (value: string) => void;
  onToggleExpand: () => void;
}

// ============================================================================
// Card Button Bar Props (for sub-component)
// ============================================================================

/**
 * Props for the CardButtonBar sub-component
 */
export interface CardButtonBarProps {
  /** Whether to show reset button */
  showReset: boolean;
  /** Whether to show close button */
  showClose: boolean;
  /** Menu items shown in the kebab dropdown */
  customButtons?: CustomMenuItem[];

  // Callbacks
  onReset: () => void;
  onClose: () => void;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract the result type from a CardProps type
 */
export type CardResultType<T extends CardProps> = T extends CardProps<infer C, infer R> ? R : never;

/**
 * Extract the config type from a CardProps type
 */
export type CardConfigType<T extends CardProps> = T extends CardProps<infer C, infer R> ? C : never;

/**
 * Card UI Component Types
 *
 * Generic types for the unified Card component that handles
 * both Analysis and Sound generation tabs.
 */

import type { ReactNode } from 'react';
import type React from 'react';
import type { VariantsBarProps } from '@/components/ui/VariantsBar';
import type { ShortcutId } from '@/utils/constants';

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
 * Analysis types: 'audio', 'text'
 * Sound types: 'text-to-audio', 'upload', 'library', 'sample-audio'
 * Acoustics types: 'resonance', 'pyroomacoustics', 'pffdtd', 'hybrid', 'hybrid2', 'import-irs'
 */
export type CardType =
  | 'audio'
  | 'text'
  | 'text-to-audio'
  | 'text-to-speech'
  | 'upload'
  | 'library'
  | 'catalog'
  | 'sample-audio'
  | 'resonance'
  | 'pyroomacoustics'
  | 'pffdtd'
  | 'hybrid'
  | 'hybrid2'
  | 'import-irs'
  | 'listener'
  | 'grid-listener'
  | 'heatmap-listener'
  | 'model-analysis'
  | 'scenario'
  | 'freeform';

/**
 * Default display names for each card type
 */
export const CARD_TYPE_LABELS: Record<CardType, string> = {
  'audio': 'Audio context',
  'text': 'text-based',
  'text-to-audio': 'Text-to-Audio',
  'text-to-speech': 'Text-to-Speech',
  'upload': 'Upload custom audio',
  'library': 'Library Sound',
  'catalog': 'Catalog Sound',
  'sample-audio': 'Sample Audio',
  'resonance': 'Shoebox simulation',
  'pyroomacoustics': 'Ray-tracing simulation',
  'pffdtd': 'Wave-based simulation',
  'hybrid': 'Hybrid simulation',
  'hybrid2': 'Hybrid simulation 2',
  'import-irs': 'Import IRs',
  'listener': 'Listener',
  'grid-listener': 'Grid Listener',
  'heatmap-listener': 'Heatmap',
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
  'audio':
    "Sound events detection in a sound recording using an SED model trained over 400 classes. Can extract audio samples and send them to the Sounds section.",
  'text':
    'Describe the intended soundscape and the LLM converts it into sound-generation prompts. Optionally draw an area to place sounds inside.',
  'text-to-audio':
    'Generate an original clip from a text prompt with a latent diffusion model (LDM). Duration: length of the generated clip (seconds), Guidance scale: how much should the result follow your prompt (1 to 10), inference steps: the more the better quality is the sound; Variants: Different seed generation of the same prompt.',
  'text-to-speech':
    'Convert typed text into spoken audio via a TTS model. Each line becomes a speech segment managed by the variants bar. Choose the spoken language in Advanced settings.',
  'upload':
    'Import a .wav, .mp3 audio file. The first',
  'library':
    'Search the Freesound / BBC Sound Effects API and use a pre-recorded clip as the source.',
  'catalog':
    'Pick from a curated built-in catalog of sounds — no network or LLM required.',
  'sample-audio': 'A dry-recorded sound sample.',
  'resonance':
    'Resonance Audio synthetic room: parametric shoebox with early reflections + late reverb rendered by the Web Audio engine. No external solver; instant real-time 6DOF auralization.',
  'pffdtd':
    'GPU finite-difference (FDTD) wave solver on a Cartesian voxel grid. Captures diffraction and room modes exactly up to the max frequency; the IR has no content above it. Axis-aligned walls are exact, oblique walls are staircased. Also records a strength-G SPL map and an optional pressure-wave animation on a horizontal plane.',
  'hybrid':
    'Wave solver below a crossover frequency, rays above it, joined into one full-band IR. The crossover defaults to the room\'s Schroeder frequency, 2000·√(T60 / V): below it the room has separate modes that only a wave solver models; above it image sources, ray tracing and edge diffraction are valid and much cheaper. Joined with a 4th-order Linkwitz-Riley crossover; mono or FOA.',
  'hybrid2':
    'Hybrid simulation with a crossover band: drag the split between the wave solver (low frequencies) and the rays (high frequencies), click a part to edit its settings, or switch a part off to run the other alone. The geometry check is its own step before the run.',
  'pyroomacoustics':
    'ISM + ray tracing on mesh faces. Multi-band absorption coefficients, single scattering coefficient per face. Computes RT60 / EDT / C80 and per-source-per-receiver IR WAVs (mono or FOA B-format).',
  'import-irs':
    'Upload pre-recorded impulse-response WAVs (mono/stereo/FOA/SOA/TOA) and use them directly for spatial convolution — no simulation needed.',
  'listener':
    'Add a single listener (receiver) at a point in the scene; the audio pipeline renders the soundscape binaurally from that position.',
  'grid-listener':
    'Place a grid of listeners over an area to evaluate the acoustics at multiple positions at once.',
  'heatmap-listener':
    'Map the sound level over a surface (compas_acoustics energy map) with the active simulation card; follows the volume, mute and solo of every sound live.',
  'model-analysis':
    "Runs LLM segmentation on the loaded 3D model to describe the space's geometry, typology and materials. Add an optional screenshot if you want to focus on a specific part.",
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
  /** One row per parallel part of the run, shown under the progress bar's expand toggle */
  progressLanes?: ProgressLane[] | null;
}

/** Progress of one parallel part of a run (e.g. a compas_acoustics rendering process). */
export interface ProgressLane {
  /** What the part covers, e.g. "S1–2 → R1–3" */
  label: string;
  /** Its current step with counts, e.g. "Late reverberation (FDN) · 2/3 pairs" */
  text: string;
  /** 0-1 */
  fraction: number;
  state: 'queued' | 'running' | 'done';
  /** Seconds since the part started (null while queued) */
  elapsedS: number | null;
}

/**
 * Object Explorer hide / isolate / exclude state saved on a scene or simulation
 * card. Restored when the card is powered on. Ids are geometry-leaf hashes of the
 * model version it was saved on (ids missing from another version are ignored).
 */
export interface SavedObjectVisibility {
  hiddenIds: string[];
  isolatedIds: string[];
  /** Objects excluded from the acoustic layer (`acousticExplorerHiddenIds`). */
  excludedIds: string[];
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
  /**
   * Snapshot of the generation inputs captured when the result was produced
   * (see `utils/generationSignature.ts`). Transient — never sent to the backend;
   * re-captured on project restore. Drives the "Regenerate" button.
   */
  generatedSignature?: string;
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
  /** Nested items opened in a flyout submenu (hover or click) */
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
  /**
   * Not editable or deletable: no remove, rename, run, regenerate or settings.
   * Expand, power and custom buttons stay. Defaults to the share view state.
   */
  readOnly?: boolean;
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
  /**
   * The card shows its run's progress in its own body (Hybrid simulation 2's Run step): while it is
   * expanded and running, the footer progress / stop bar is hidden. Collapsed, the footer still shows it.
   */
  runProgressInBody?: boolean;

  actionButtonColor?: string;
  /**
   * Marks the action button as AI-driven — renders the sparkle "magic AI" icon
   * instead of the Play triangle (e.g. LLM analysis, TangoFlux generation).
   */
  actionIsAi?: boolean;
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
  /** Confirmation question for the floating-card trash button (defaults to "<closeButtonTitle>?"). */
  removeConfirmMessage?: string;
  /** Keyboard shortcut shown on the close button's tooltip (only while expanded). */
  closeButtonShortcut?: ShortcutId;
  /** Menu items shown in the kebab (⋮) dropdown — replaces the old ReactNode[] pattern */
  customButtons?: CustomMenuItem[];

  // Callbacks
  /** Called when card expand/collapse is toggled */
  onToggleExpand: (index: number) => void;
  /** Called when config is updated (e.g., name change) */
  onUpdateConfig: (index: number, updates: Partial<TConfig>) => void;
  /** Called when card is removed */
  onRemove: (index: number) => void;
  /** Called when the inline error is dismissed (clears the error state in the parent) */
  onDismissError?: (index: number) => void;
  /** Called when the card header is double-clicked (e.g. zoom to associated 3D object) */
  onDoubleClickCard?: (index: number) => void;
  /** When set, a "−" header button folds the card back (Simple-mode floating cards). */
  onReduce?: () => void;
  /** When set, a power header button toggles the card on/off (e.g. a simulation's auralization). */
  onTogglePower?: () => void;
  /** Current power state shown by the power button (on = primary-colored). */
  isPoweredOn?: boolean;
  /** Power button tooltips — `on` is shown while powered (the action turns it off). Defaults to simulation wording. */
  powerTitles?: { on: string; off: string };

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
  /** Optional element rendered right of the title while the card is expanded (e.g. an "outdated" badge). */
  headerBadge?: ReactNode;
  /** Optional element rendered to the left of the bottom-bar action (e.g. simulation count dots). Hidden while generating. */
  footerPrefix?: ReactNode;
  /** Optional element rendered to the right of the bottom-bar action (e.g. a small refresh button). Hidden while generating. */
  footerSuffix?: ReactNode;
  /** Small muted line at the bottom of an expanded generated card (e.g. "Solved in 2min 14s"). */
  footerNote?: ReactNode;

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
   * Show a collapsible settings section below the post-generation content —
   * either `settingsContent` (editable) or a read-only recap of the card's
   * pre-generation settings.
   * @default true
   */
  showSettingsSummary?: boolean;
  /**
   * Editable settings UI (usually the same editors as `beforeContent`) shown
   * inside the settings section once the card has a result. Omit for cards
   * where regenerating makes no sense — they keep the read-only recap.
   */
  settingsContent?: ReactNode;
  /** True when the settings changed since the result was generated (see `utils/generationSignature.ts`). */
  settingsDirty?: boolean;
  /**
   * Re-runs generation with the edited settings. While `settingsDirty`, the
   * settings box shows a "Regenerate" button wired to this handler.
   */
  onRegenerate?: () => Promise<void> | void;
  /** Restores the settings used for the last generation ("Revert" beside Regenerate). */
  onRevertSettings?: () => void;
  /** Settings field keys edited since generation — their labels get a "*" (see ModifiedMark). */
  modifiedSettings?: ReadonlySet<string>;
  /**
   * Fires when the settings section of a generated, expanded card opens/closes
   * ("edit mode"), and with `false` on collapse and unmount.
   */
  onSettingsExpandedChange?: (expanded: boolean) => void;
  /** Optional content pinned above the settings summary (e.g. scenario parcours toggle). */
  beforeSettingsSummary?: ReactNode;
  /** Bump to open the title editor (a bubble's "Rename" opens the card first). */
  renameRequest?: number;
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

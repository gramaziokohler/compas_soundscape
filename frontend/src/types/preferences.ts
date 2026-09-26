/**
 * Per-user preferences (Advanced Settings panel).
 *
 * Mirrored on the backend by `UserPreferences` in `models/schemas.py`. The API
 * speaks snake_case; this domain type is camelCase and `services/api.ts` maps
 * between the two. Every field is optional so a patch may be partial.
 */

export interface ListenerOrientation {
  x: number;
  y: number;
  z: number;
}

export interface UserPreferences {
  // Display
  colorTheme?: string;
  showAxesHelper?: boolean;
  showLabelSprites?: boolean;
  showHoveringHighlight?: boolean;
  showSoundSpheres?: boolean;
  showPlayingHighlight?: boolean;
  showSceneListeners?: boolean;
  showGroundGrid?: boolean;
  showGroundGridLabels?: boolean;
  groundGridSpacing?: number;
  groundGridColor?: string;
  // Acoustic
  globalSoundSpeed?: number;
  globalMeshLc?: number;
  // Models
  llmModel?: string;
  ttsModel?: string;
  ttsLanguage?: string;
  audioModel?: string;
  diffusionSteps?: number;
  negativePrompt?: string;
  applyDenoising?: boolean;
  trimSilence?: boolean;
  applyNoiseReduction?: boolean;
  // Audio rendering
  normalizeImpulseResponses?: boolean;
  listenerOrientation?: ListenerOrientation;
  outputDeviceId?: string;
  globalBaseDbfs?: number;
  maximumFoleySounds?: number;
  showSpectrograms?: boolean;
  // History
  enableAutoSave?: boolean;
}

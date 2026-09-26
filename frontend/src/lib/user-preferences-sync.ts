/**
 * Per-user preferences sync (Advanced Settings).
 *
 * The existing stores remain the runtime source of truth for their fields;
 * this module is a durable, per-user sync layer on top of them:
 *
 *   load:    GET /api/me/preferences  → applyPreferences() fans values into
 *            uiStore / audioControlsStore / soundscapeStore.
 *   change:  subscribing to those stores → debounced PUT of the aggregate.
 *
 * Hydration is gated: the subscription is installed before the first apply, but
 * `_hydrated` stays false until the initial GET has been applied, so hydrating
 * never triggers a save (see global.mdc § Debugging Discipline #5).
 *
 * API tokens are intentionally NOT part of this layer.
 */

import type { UserPreferences } from '@/types';
import type { ColorThemePreference } from '@/utils/color-theme';
import { apiService } from '@/services/api';
import { useUIStore, useAudioControlsStore, useSoundscapeStore } from '@/store';
import { USER_PREFERENCES_SAVE_DEBOUNCE_MS } from '@/utils/constants';

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
let _subscribed = false;
let _hydrated = false;
/** True while applying server values — suppresses the resulting store events. */
let _applying = false;
let _lastSignature = '';
/** Last preferences received from the server, kept so we can re-apply them
 *  after a soundscape load overwrites the generation settings (user prefs win). */
let _lastLoaded: UserPreferences = {};

/** Read the current preference-relevant values from every owning store. */
function collectPreferences(): UserPreferences {
  const ui = useUIStore.getState();
  const audio = useAudioControlsStore.getState();
  const sc = useSoundscapeStore.getState();
  return {
    colorTheme: ui.colorTheme,
    showAxesHelper: ui.showAxesHelper,
    showLabelSprites: ui.showLabelSprites,
    showHoveringHighlight: ui.showHoveringHighlight,
    showSoundSpheres: ui.showSoundSpheres,
    showPlayingHighlight: ui.showPlayingHighlight,
    showSceneListeners: ui.showSceneListeners,
    showGroundGrid: ui.showGroundGrid,
    showGroundGridLabels: ui.showGroundGridLabels,
    groundGridSpacing: ui.groundGridSpacing,
    groundGridColor: ui.groundGridColor,
    globalSoundSpeed: ui.globalSoundSpeed,
    globalMeshLc: ui.globalMeshLc,
    listenerOrientation: { ...ui.listenerOrientation },
    showSpectrograms: ui.showSpectrograms,
    enableAutoSave: ui.enableAutoSave,
    normalizeImpulseResponses: audio.normalizeImpulseResponses,
    outputDeviceId: audio.outputDeviceId,
    globalBaseDbfs: audio.globalBaseDbfs,
    maximumFoleySounds: audio.maximumFoleySounds,
    ttsLanguage: audio.ttsLanguage,
    diffusionSteps: sc.globalSteps,
    negativePrompt: sc.globalNegativePrompt,
    applyDenoising: sc.applyDenoising,
    trimSilence: sc.trimSilence,
    applyNoiseReduction: sc.applyNoiseReduction,
    audioModel: sc.audioModel,
    llmModel: sc.llmModel,
    ttsModel: sc.ttsModel,
  };
}

/** Fan a (possibly partial) preferences object into the owning stores. */
export function applyPreferences(prefs: UserPreferences): void {
  const ui = useUIStore.getState();
  const audio = useAudioControlsStore.getState();
  const sc = useSoundscapeStore.getState();

  if (prefs.colorTheme !== undefined) ui.setColorTheme(prefs.colorTheme as ColorThemePreference);
  if (prefs.showAxesHelper !== undefined) ui.setShowAxesHelper(prefs.showAxesHelper);
  if (prefs.showLabelSprites !== undefined) ui.setShowLabelSprites(prefs.showLabelSprites);
  if (prefs.showHoveringHighlight !== undefined) ui.setShowHoveringHighlight(prefs.showHoveringHighlight);
  if (prefs.showSoundSpheres !== undefined) ui.setShowSoundSpheres(prefs.showSoundSpheres);
  if (prefs.showPlayingHighlight !== undefined) ui.setShowPlayingHighlight(prefs.showPlayingHighlight);
  if (prefs.showSceneListeners !== undefined) ui.setShowSceneListeners(prefs.showSceneListeners);
  if (prefs.showGroundGrid !== undefined) ui.setShowGroundGrid(prefs.showGroundGrid);
  if (prefs.showGroundGridLabels !== undefined) ui.setShowGroundGridLabels(prefs.showGroundGridLabels);
  if (prefs.groundGridSpacing !== undefined) ui.setGroundGridSpacing(prefs.groundGridSpacing);
  if (prefs.groundGridColor !== undefined) ui.setGroundGridColor(prefs.groundGridColor);
  if (prefs.globalSoundSpeed !== undefined) ui.setGlobalSoundSpeed(prefs.globalSoundSpeed);
  if (prefs.globalMeshLc !== undefined) ui.setGlobalMeshLc(prefs.globalMeshLc);
  if (prefs.listenerOrientation !== undefined) ui.setListenerOrientation(prefs.listenerOrientation);
  if (prefs.showSpectrograms !== undefined) ui.setShowSpectrograms(prefs.showSpectrograms);
  if (prefs.enableAutoSave !== undefined) ui.setEnableAutoSave(prefs.enableAutoSave);

  if (prefs.normalizeImpulseResponses !== undefined) {
    audio.setNormalizeImpulseResponses(prefs.normalizeImpulseResponses);
  }
  if (prefs.outputDeviceId !== undefined) audio.setOutputDeviceId(prefs.outputDeviceId);
  if (prefs.globalBaseDbfs !== undefined) audio.setGlobalBaseDbfs(prefs.globalBaseDbfs);
  if (prefs.maximumFoleySounds !== undefined) audio.setMaximumFoleySounds(prefs.maximumFoleySounds);
  if (prefs.ttsLanguage !== undefined) audio.setTtsLanguage(prefs.ttsLanguage);

  if (prefs.diffusionSteps !== undefined) sc.handleGlobalStepsChange(prefs.diffusionSteps);
  if (prefs.negativePrompt !== undefined) sc.setGlobalNegativePrompt(prefs.negativePrompt);
  if (prefs.applyDenoising !== undefined) sc.setApplyDenoising(prefs.applyDenoising);
  if (prefs.trimSilence !== undefined) sc.setTrimSilence(prefs.trimSilence);
  if (prefs.applyNoiseReduction !== undefined) sc.setApplyNoiseReduction(prefs.applyNoiseReduction);
  if (prefs.audioModel !== undefined) sc.setAudioModel(prefs.audioModel);
  if (prefs.llmModel !== undefined) sc.setLlmModel(prefs.llmModel);
  if (prefs.ttsModel !== undefined) sc.setTtsModel(prefs.ttsModel);
}

/** Apply prefs without emitting save events, then resync the signature. */
function applyWithoutSaving(prefs: UserPreferences): void {
  _applying = true;
  try {
    applyPreferences(prefs);
  } finally {
    _applying = false;
    _lastSignature = JSON.stringify(collectPreferences());
  }
}

function scheduleSave(): void {
  if (!_hydrated || _applying) return;
  const snapshot = collectPreferences();
  // Track the latest desired values so a later soundscape load re-applies the
  // user's current edits (not just the first server load).
  _lastLoaded = snapshot;
  const signature = JSON.stringify(snapshot);
  if (signature === _lastSignature) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    const toSave = collectPreferences();
    _lastSignature = JSON.stringify(toSave);
    _lastLoaded = toSave;
    apiService.updateUserPreferences(toSave).catch((err) => {
      console.warn('[prefs] save failed:', err);
    });
  }, USER_PREFERENCES_SAVE_DEBOUNCE_MS);
}

function ensureSubscribed(): void {
  if (_subscribed) return;
  _subscribed = true;
  useUIStore.subscribe(scheduleSave);
  useAudioControlsStore.subscribe(scheduleSave);
  useSoundscapeStore.subscribe(scheduleSave);
}

/** Re-apply the last server-loaded preferences (after a soundscape load wins
 *  over the same generation fields). No-op before the first load. */
export function reapplyUserPreferences(): void {
  if (!_hydrated) return;
  applyWithoutSaving(_lastLoaded);
}

/** Fetch and apply the current user's preferences. Idempotent per session. */
export async function loadUserPreferences(): Promise<void> {
  ensureSubscribed();
  try {
    const prefs = await apiService.getUserPreferences();
    _lastLoaded = prefs;
    applyWithoutSaving(prefs);
  } catch (err) {
    console.warn('[prefs] load failed:', err);
  } finally {
    _lastSignature = JSON.stringify(collectPreferences());
    _hydrated = true;
  }
}

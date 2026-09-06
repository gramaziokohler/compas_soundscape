/**
 * UI Store
 *
 * Holds page-level UI state from page.tsx that doesn't belong to any domain
 * store: active load tab, IR selection, bounding box toggles, room scale,
 * audio rendering mode, Speckle viewer flags, global model identity, and
 * sidebar expand states.
 *
 * No undo/redo needed — these are transient navigation/display choices.
 *
 * Added persist middleware (localStorage) so panel tabs, view toggles,
 * and display preferences survive a page refresh. skipHydration + manual
 * rehydrate() prevent Next.js SSR mismatches.
 */

import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import type { LoadTab } from '@/types';
import type { AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import {
  DEFAULT_SPEED_OF_SOUND,
  CHORAS_DE_DEFAULT_LC,
} from '@/utils/constants';
import { applyColorTheme, type ColorThemePreference } from '@/utils/color-theme';

export interface UIStoreState {
  // ── Load tab ──────────────────────────────────────────────────────────────
  activeLoadTab: LoadTab;
  setActiveLoadTab: (tab: LoadTab) => void;

  // ── IR library ────────────────────────────────────────────────────────────
  selectedIRId: string | null;
  selectedIRMetadata: any | null;
  irRefreshTrigger: number;
  setSelectedIRId: (id: string | null) => void;
  setSelectedIRMetadata: (meta: any | null) => void;
  triggerIRRefresh: () => void;

  // ── Bounding box ──────────────────────────────────────────────────────────
  showBoundingBox: boolean;
  refreshBoundingBoxTrigger: number;
  setShowBoundingBox: (show: boolean) => void;
  triggerBoundingBoxRefresh: () => void;

  // ── Room scale ────────────────────────────────────────────────────────────
  roomScale: { x: number; y: number; z: number };
  setRoomScale: (scale: { x: number; y: number; z: number }) => void;

  // ── Audio rendering mode ──────────────────────────────────────────────────
  audioRenderingMode: AudioRenderingMode;
  setAudioRenderingMode: (mode: AudioRenderingMode) => void;

  // ── Speckle viewer ────────────────────────────────────────────────────────
  useSpeckleViewer: boolean;
  speckleModelUrl: string | undefined;
  setUseSpeckleViewer: (use: boolean) => void;
  setSpeckleModelUrl: (url: string | undefined) => void;

  // ── Global model ──────────────────────────────────────────────────────────
  globalModelFile: File | null;
  globalSpeckleData: any | null;
  isUploadingGlobalModel: boolean;
  setGlobalModelFile: (file: File | null) => void;
  setGlobalSpeckleData: (data: any | null) => void;
  setIsUploadingGlobalModel: (uploading: boolean) => void;

  // ── Soundscape persistence ────────────────────────────────────────────────
  isSavingSoundscape: boolean;
  setIsSavingSoundscape: (saving: boolean) => void;

  // ── Sidebar ───────────────────────────────────────────────────────────────
  isLeftSidebarExpanded: boolean;
  setIsLeftSidebarExpanded: (expanded: boolean) => void;

  // ── Speckle bounds (updated by SpeckleScene callback) ─────────────────────
  speckleBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  setSpeckleBounds: (bounds: { min: [number, number, number]; max: [number, number, number] } | null) => void;

  // ── IR hover (source-receiver pair hovered in IR library) ─────────────────
  hoveredIRSourceReceiver: { sourceId: string; receiverId: string } | null;
  setHoveredIRSourceReceiver: (pair: { sourceId: string; receiverId: string } | null) => void;

  // ── Gradient map (acoustic metric overlay on grid listener surface) ────────
  activeGradientMap: GradientMapState | null;
  setActiveGradientMap: (state: GradientMapState | null) => void;

  // ── Scene helpers ─────────────────────────────────────────────────────────
  showAxesHelper: boolean;
  setShowAxesHelper: (show: boolean) => void;

  // ── Ground grid ───────────────────────────────────────────────────────────
  showGroundGrid: boolean;
  setShowGroundGrid: (v: boolean) => void;
  groundGridSpacing: number;
  setGroundGridSpacing: (v: number) => void;
  groundGridColor: string;
  setGroundGridColor: (v: string) => void;

  // ── Viewer display toggles ────────────────────────────────────────────────
  showLabelSprites: boolean;
  setShowLabelSprites: (v: boolean) => void;
  showHoveringHighlight: boolean;
  setShowHoveringHighlight: (v: boolean) => void;
  showSoundSpheres: boolean;
  setShowSoundSpheres: (v: boolean) => void;
  showSceneListeners: boolean;
  setShowSceneListeners: (v: boolean) => void;
  /** Draw the dashed-arrow scenario parcours in the 3D viewer (scenario card footer toggle) */
  showScenarioParcours: boolean;
  setShowScenarioParcours: (v: boolean) => void;

  // ── Panel toggles ──────────────────────────────────────────────────────────
  showAdvancedSettings: boolean;
  setShowAdvancedSettings: (v: boolean) => void;

  // ── Timeline disabled flag (user closed the DAW panel) ─────────────────────
  isTimelineDisabled: boolean;
  setIsTimelineDisabled: (v: boolean) => void;

  // ── Spectrogram display (replaces amplitude waveform in WaveSurfer components)
  showSpectrograms: boolean;
  setShowSpectrograms: (v: boolean) => void;

  // ── Waveform height (px) for WaveSurfer players — resizable by user
  waveformHeight: number;
  setWaveformHeight: (v: number) => void;

  // ── Global acoustic simulation ────────────────────────────────────────────
  globalSoundSpeed: number;
  setGlobalSoundSpeed: (v: number) => void;
  globalMeshLc: number;
  setGlobalMeshLc: (v: number) => void;

  // ── Sound card interactions (sidebar → scene) ─────────────────────────────
  /** Index of the currently expanded sound card (set by SoundGenerationSection). */
  expandedSoundCardIndex: number | null;
  setExpandedSoundCardIndex: (index: number | null) => void;
  /** Incremented each time the user double-clicks a sound card to zoom to its sphere. */
  zoomToSoundCardTrigger: { index: number; version: number } | null;
  triggerZoomToSoundCard: (index: number) => void;
  /** Active parent (usage or context) index filtering the Sounds section. Null = no filter. */
  activeSoundParentIndex: number | null;
  setActiveSoundParentIndex: (index: number | null) => void;
  /** True while the Sounds step is active — allows showing unparented sounds when no parent was set. */
  isInSoundsStep: boolean;
  setIsInSoundsStep: (v: boolean) => void;

  // ── Autosave ────────────────────────────────────────────────────────────
  enableAutoSave: boolean;
  setEnableAutoSave: (v: boolean) => void;

  // ── Camera POV (survives refresh) ──────────────────────────────────────────
  cameraPosition: [number, number, number] | null;
  cameraTarget: [number, number, number] | null;
  setCameraState: (pos: [number, number, number] | null, target: [number, number, number] | null) => void;

  // ── Sidebar wizard step (survives refresh) ─────────────────────────────────
  sidebarWizardStep: 0 | 1 | 2;
  setSidebarWizardStep: (step: 0 | 1 | 2) => void;

  // ── Programmatic sounds-step navigation (from sim cards, NOT persisted) ──────
  /** Incremented to tell the left sidebar to expand and navigate to the Sounds step. */
  soundsNavTrigger: number;
  triggerSoundsNav: () => void;

  // ── Panel visibility toggles (survive refresh) ──────────────────────────────
  showTimeline: boolean;
  setShowTimeline: (v: boolean) => void;
  showObjectExplorer: boolean;
  setShowObjectExplorer: (v: boolean) => void;

  // ── View mode (survives refresh) ────────────────────────────────────────────
  viewMode: 'default' | 'acoustic' | 'dark';
  setViewMode: (mode: 'default' | 'acoustic' | 'dark') => void;

  // ── UI color theme (independent of Speckle Sounds/Default/Acoustics viewmode)
  colorTheme: ColorThemePreference;
  setColorTheme: (theme: ColorThemePreference) => void;

  // ── Floating panel positions & sizes (survive refresh) ──────────────────────
  objectExplorerPanel: { x: number; y: number; width: number; height: number } | null;
  setObjectExplorerPanel: (state: { x: number; y: number; width: number; height: number } | null) => void;
  timelinePanel: { x: number; y: number; width: number; height: number } | null;
  setTimelinePanel: (state: { x: number; y: number; width: number; height: number } | null) => void;

  // ── Simulation cards expanded tab (survives refresh) ────────────────────────
  expandedSimulationTabIndex: number | null;
  setExpandedSimulationTabIndex: (index: number | null) => void;

  // ── Acoustic layer selection mode (NOT persisted — model-bound) ──────────────
  acousticLayerSelectionMode: boolean;
  setAcousticLayerSelectionMode: (v: boolean) => void;
}

export type GradientMetric = 'rt60' | 'edt' | 'd50' | 'c50' | 'spl';

export interface GradientMapState {
  metric: GradientMetric;
  /** Grid point positions with their scalar metric value */
  pointValues: Array<{ position: [number, number, number]; value: number }>;
  /** Bounding box of the grid listener surface */
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  /** Optional user-defined color range — overrides auto min/max from pointValues */
  range?: { min: number; max: number };
}

export const useUIStore = create<UIStoreState>()(
  persist(
    devtools(
      (set) => ({
      // ── Load tab ────────────────────────────────────────────────────────
      activeLoadTab: 'upload',
      setActiveLoadTab: (tab) => set({ activeLoadTab: tab }, false, 'ui/setActiveLoadTab'),

      // ── IR library ──────────────────────────────────────────────────────
      selectedIRId: null,
      selectedIRMetadata: null,
      irRefreshTrigger: 0,
      setSelectedIRId: (id) => set({ selectedIRId: id }, false, 'ui/setSelectedIRId'),
      setSelectedIRMetadata: (meta) => set({ selectedIRMetadata: meta }, false, 'ui/setSelectedIRMetadata'),
      triggerIRRefresh: () =>
        set((s) => ({ irRefreshTrigger: s.irRefreshTrigger + 1 }), false, 'ui/triggerIRRefresh'),

      // ── Bounding box ────────────────────────────────────────────────────
      showBoundingBox: false,
      refreshBoundingBoxTrigger: 0,
      setShowBoundingBox: (show) => set({ showBoundingBox: show }, false, 'ui/setShowBoundingBox'),
      triggerBoundingBoxRefresh: () =>
        set(
          (s) => ({ refreshBoundingBoxTrigger: s.refreshBoundingBoxTrigger + 1 }),
          false,
          'ui/triggerBoundingBoxRefresh',
        ),

      // ── Room scale ──────────────────────────────────────────────────────
      roomScale: { x: 1, y: 1, z: 1 },
      setRoomScale: (scale) => set({ roomScale: scale }, false, 'ui/setRoomScale'),

      // ── Audio rendering mode ────────────────────────────────────────────
      audioRenderingMode: 'anechoic',
      setAudioRenderingMode: (mode) =>
        set({ audioRenderingMode: mode }, false, 'ui/setAudioRenderingMode'),

      // ── Speckle viewer ──────────────────────────────────────────────────
      useSpeckleViewer: true,
      speckleModelUrl: undefined,
      setUseSpeckleViewer: (use) => set({ useSpeckleViewer: use }, false, 'ui/setUseSpeckleViewer'),
      setSpeckleModelUrl: (url) => set({ speckleModelUrl: url }, false, 'ui/setSpeckleModelUrl'),

      // ── Global model ────────────────────────────────────────────────────
      globalModelFile: null,
      globalSpeckleData: null,
      isUploadingGlobalModel: false,
      setGlobalModelFile: (file) => set({ globalModelFile: file }, false, 'ui/setGlobalModelFile'),
      setGlobalSpeckleData: (data) =>
        set({ globalSpeckleData: data }, false, 'ui/setGlobalSpeckleData'),
      setIsUploadingGlobalModel: (uploading) =>
        set({ isUploadingGlobalModel: uploading }, false, 'ui/setIsUploadingGlobalModel'),

      // ── Soundscape persistence ───────────────────────────────────────────
      isSavingSoundscape: false,
      setIsSavingSoundscape: (saving) =>
        set({ isSavingSoundscape: saving }, false, 'ui/setIsSavingSoundscape'),

      // ── Sidebar ─────────────────────────────────────────────────────────
      isLeftSidebarExpanded: true,
      setIsLeftSidebarExpanded: (expanded) =>
        set({ isLeftSidebarExpanded: expanded }, false, 'ui/setIsLeftSidebarExpanded'),

      // ── Speckle bounds ───────────────────────────────────────────────────
      speckleBounds: null,
      setSpeckleBounds: (bounds) => set({ speckleBounds: bounds }, false, 'ui/setSpeckleBounds'),

      // ── IR hover ─────────────────────────────────────────────────────────
      hoveredIRSourceReceiver: null,
      setHoveredIRSourceReceiver: (pair) =>
        set({ hoveredIRSourceReceiver: pair }, false, 'ui/setHoveredIRSourceReceiver'),

      // ── Gradient map ─────────────────────────────────────────────────────
      activeGradientMap: null,
      setActiveGradientMap: (state) =>
        set({ activeGradientMap: state }, false, 'ui/setActiveGradientMap'),

      // ── Scene helpers ────────────────────────────────────────────────────
      showAxesHelper: false,
      setShowAxesHelper: (show) => set({ showAxesHelper: show }, false, 'ui/setShowAxesHelper'),

      // ── Ground grid ──────────────────────────────────────────────────────
      showGroundGrid: false,
      setShowGroundGrid: (v) => set({ showGroundGrid: v }, false, 'ui/setShowGroundGrid'),
      groundGridSpacing: 2,
      setGroundGridSpacing: (v) => set({ groundGridSpacing: v }, false, 'ui/setGroundGridSpacing'),
      groundGridColor: '#888888',
      setGroundGridColor: (v) => set({ groundGridColor: v }, false, 'ui/setGroundGridColor'),

      // ── Viewer display toggles ───────────────────────────────────────────
      showLabelSprites: true,
      setShowLabelSprites: (v) => set({ showLabelSprites: v }, false, 'ui/setShowLabelSprites'),
      showHoveringHighlight: true,
      setShowHoveringHighlight: (v) => set({ showHoveringHighlight: v }, false, 'ui/setShowHoveringHighlight'),
      showSoundSpheres: true,
      setShowSoundSpheres: (v) => set({ showSoundSpheres: v }, false, 'ui/setShowSoundSpheres'),
      showSceneListeners: true,
      setShowSceneListeners: (v) => set({ showSceneListeners: v }, false, 'ui/setShowSceneListeners'),
      showScenarioParcours: false,
      setShowScenarioParcours: (v) => set({ showScenarioParcours: v }, false, 'ui/setShowScenarioParcours'),

      // ── Panel toggles ────────────────────────────────────────────────────
      showAdvancedSettings: false,
      setShowAdvancedSettings: (v) => set({ showAdvancedSettings: v }, false, 'ui/setShowAdvancedSettings'),

      isTimelineDisabled: false,
      setIsTimelineDisabled: (v) => set({ isTimelineDisabled: v }, false, 'ui/setIsTimelineDisabled'),

      showSpectrograms: false,
      setShowSpectrograms: (v) => set({ showSpectrograms: v }, false, 'ui/setShowSpectrograms'),

      waveformHeight: 50,
      setWaveformHeight: (v) => set({ waveformHeight: v }, false, 'ui/setWaveformHeight'),

      // ── Global acoustic simulation ───────────────────────────────────────
      globalSoundSpeed: DEFAULT_SPEED_OF_SOUND,
      setGlobalSoundSpeed: (v) => set({ globalSoundSpeed: v }, false, 'ui/setGlobalSoundSpeed'),
      globalMeshLc: CHORAS_DE_DEFAULT_LC,
      setGlobalMeshLc: (v) => set({ globalMeshLc: v }, false, 'ui/setGlobalMeshLc'),

      // ── Sound card interactions ──────────────────────────────────────────────
      expandedSoundCardIndex: null,
      setExpandedSoundCardIndex: (index) =>
        set({ expandedSoundCardIndex: index }, false, 'ui/setExpandedSoundCardIndex'),
      zoomToSoundCardTrigger: null,
      triggerZoomToSoundCard: (index) =>
        set(
          (s) => ({ zoomToSoundCardTrigger: { index, version: (s.zoomToSoundCardTrigger?.version ?? 0) + 1 } }),
          false,
          'ui/triggerZoomToSoundCard',
        ),
      activeSoundParentIndex: null,
      setActiveSoundParentIndex: (index) =>
        set(
          { activeSoundParentIndex: index, ...(index !== null ? { isInSoundsStep: true } : {}) },
          false,
          'ui/setActiveSoundParentIndex',
        ),
      isInSoundsStep: false,
      setIsInSoundsStep: (v) => set({ isInSoundsStep: v }, false, 'ui/setIsInSoundsStep'),

      // ── Autosave ───────────────────────────────────────────────────────────
      enableAutoSave: true,
      setEnableAutoSave: (v) => set({ enableAutoSave: v }, false, 'ui/setEnableAutoSave'),

      // ── Camera POV ─────────────────────────────────────────────────────────
      cameraPosition: null,
      cameraTarget: null,
      setCameraState: (pos, target) => set({ cameraPosition: pos, cameraTarget: target }, false, 'ui/setCameraState'),

      // ── Sidebar wizard step ─────────────────────────────────────────────────
      sidebarWizardStep: 0 as 0 | 1 | 2,
      setSidebarWizardStep: (step) => set({ sidebarWizardStep: step }, false, 'ui/setSidebarWizardStep'),

      // ── Programmatic sounds-step navigation ─────────────────────────────────
      soundsNavTrigger: 0,
      triggerSoundsNav: () =>
        set((s) => ({ soundsNavTrigger: s.soundsNavTrigger + 1 }), false, 'ui/triggerSoundsNav'),

      // ── Panel visibility toggles ────────────────────────────────────────────
      showTimeline: true,
      setShowTimeline: (v) => set({ showTimeline: v }, false, 'ui/setShowTimeline'),
      showObjectExplorer: false,
      setShowObjectExplorer: (v) => set({ showObjectExplorer: v }, false, 'ui/setShowObjectExplorer'),

      // ── View mode ──────────────────────────────────────────────────────────
      viewMode: 'default' as 'default' | 'acoustic' | 'dark',
      setViewMode: (mode) => set({ viewMode: mode }, false, 'ui/setViewMode'),

      // ── UI color theme ─────────────────────────────────────────────────────
      colorTheme: 'system' as ColorThemePreference,
      setColorTheme: (theme) => {
        applyColorTheme(theme);
        set({ colorTheme: theme }, false, 'ui/setColorTheme');
      },

      // ── Floating panel positions & sizes ───────────────────────────────────
      objectExplorerPanel: null,
      setObjectExplorerPanel: (s) => set({ objectExplorerPanel: s }, false, 'ui/setObjectExplorerPanel'),
      timelinePanel: null,
      setTimelinePanel: (s) => set({ timelinePanel: s }, false, 'ui/setTimelinePanel'),

      // ── Simulation cards expanded tab ──────────────────────────────────────
      expandedSimulationTabIndex: null,
      setExpandedSimulationTabIndex: (idx) => set({ expandedSimulationTabIndex: idx }, false, 'ui/setExpandedSimulationTabIndex'),

      // ── Acoustic layer selection mode ─────────────────────────────────────
      acousticLayerSelectionMode: false,
      setAcousticLayerSelectionMode: (v) => set({ acousticLayerSelectionMode: v }, false, 'ui/setAcousticLayerSelectionMode'),
    }),
    { name: 'uiStore' },
  ),
  {
    name: 'compas-ui-state',
    storage: createJSONStorage(() => localStorage),
    skipHydration: true,
    partialize: (state: UIStoreState) => {
      const { globalModelFile, globalSpeckleData, speckleModelUrl, speckleBounds,
        hoveredIRSourceReceiver, activeGradientMap, selectedIRId, selectedIRMetadata,
        irRefreshTrigger, refreshBoundingBoxTrigger, roomScale, isUploadingGlobalModel,
        isSavingSoundscape, zoomToSoundCardTrigger,
        activeSoundParentIndex, isInSoundsStep, showBoundingBox,
        cameraPosition, cameraTarget, acousticLayerSelectionMode, soundsNavTrigger, ...persistable } = state;
      return persistable;
    },
  }),
);

/**
 * UI Store
 *
 * Holds page-level UI state from page.tsx that doesn't belong to any domain
 * store: active load tab, IR selection, bounding box toggles, room scale,
 * audio rendering mode, Speckle viewer flags, global model identity, and
 * sidebar expand states.
 *
 * No undo/redo needed — these are transient navigation/display choices.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { LoadTab } from '@/types';
import type { AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import {
  DEFAULT_SPEED_OF_SOUND,
  CHORAS_DE_DEFAULT_LC,
} from '@/utils/constants';

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

  // ── Viewer display toggles ────────────────────────────────────────────────
  showLabelSprites: boolean;
  setShowLabelSprites: (v: boolean) => void;
  showHoveringHighlight: boolean;
  setShowHoveringHighlight: (v: boolean) => void;
  showSoundSpheres: boolean;
  setShowSoundSpheres: (v: boolean) => void;
  showSceneListeners: boolean;
  setShowSceneListeners: (v: boolean) => void;

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

      // ── Viewer display toggles ───────────────────────────────────────────
      showLabelSprites: true,
      setShowLabelSprites: (v) => set({ showLabelSprites: v }, false, 'ui/setShowLabelSprites'),
      showHoveringHighlight: true,
      setShowHoveringHighlight: (v) => set({ showHoveringHighlight: v }, false, 'ui/setShowHoveringHighlight'),
      showSoundSpheres: true,
      setShowSoundSpheres: (v) => set({ showSoundSpheres: v }, false, 'ui/setShowSoundSpheres'),
      showSceneListeners: true,
      setShowSceneListeners: (v) => set({ showSceneListeners: v }, false, 'ui/setShowSceneListeners'),

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
    }),
    { name: 'uiStore' },
  ),
);

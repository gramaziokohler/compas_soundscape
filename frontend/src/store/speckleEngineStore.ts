import { create } from 'zustand';
import { Viewer, CameraController, SelectionExtension, FilteringExtension } from '@speckle/viewer';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { GradientMapManager } from '@/lib/three/gradient-map-manager';
import { AreaDrawingManager } from '@/lib/three/area-drawing-manager';
import * as THREE from 'three';

interface SpeckleEngineState {
  // Heavy Object Instances
  viewer: Viewer | null;
  coordinator: SpeckleAudioCoordinator | null;
  playbackScheduler: PlaybackSchedulerService | null;
  selectionExtension: SelectionExtension | null;
  filteringExtension: FilteringExtension | null;
  boundingBoxManager: BoundingBoxManager | null;
  cameraController: CameraController | null;
  areaDrawingManager: AreaDrawingManager | null;
  gradientMapManager: GradientMapManager | null;
  irHoverLine: THREE.Line | null;

  // React-Busting Flags (mutatable via fast events)
  isFirstPersonMode: boolean;
  isAcousticMode: boolean;
  showHoveringHighlight: boolean;

  // Actions
  setViewer: (viewer: Viewer | null) => void;
  setCoordinator: (coordinator: SpeckleAudioCoordinator | null) => void;
  setPlaybackScheduler: (scheduler: PlaybackSchedulerService | null) => void;
  setSelectionExtension: (ext: SelectionExtension | null) => void;
  setFilteringExtension: (ext: FilteringExtension | null) => void;
  setBoundingBoxManager: (manager: BoundingBoxManager | null) => void;
  setCameraController: (controller: CameraController | null) => void;
  setAreaDrawingManager: (manager: AreaDrawingManager | null) => void;
  setGradientMapManager: (manager: GradientMapManager | null) => void;
  setIrHoverLine: (line: THREE.Line | null) => void;

  setIsFirstPersonMode: (isFirstPersonMode: boolean) => void;
  setIsAcousticMode: (isAcousticMode: boolean) => void;
  setShowHoveringHighlight: (showHoveringHighlight: boolean) => void;
}

export const useSpeckleEngineStore = create<SpeckleEngineState>((set) => ({
  viewer: null,
  coordinator: null,
  playbackScheduler: null,
  selectionExtension: null,
  filteringExtension: null,
  boundingBoxManager: null,
  cameraController: null,
  areaDrawingManager: null,
  gradientMapManager: null,
  irHoverLine: null,

  isFirstPersonMode: false,
  isAcousticMode: false,
  showHoveringHighlight: true,

  setViewer: (viewer) => set({ viewer }),
  setCoordinator: (coordinator) => set({ coordinator }),
  setPlaybackScheduler: (playbackScheduler) => set({ playbackScheduler }),
  setSelectionExtension: (selectionExtension) => set({ selectionExtension }),
  setFilteringExtension: (filteringExtension) => set({ filteringExtension }),
  setBoundingBoxManager: (boundingBoxManager) => set({ boundingBoxManager }),
  setCameraController: (cameraController) => set({ cameraController }),
  setAreaDrawingManager: (areaDrawingManager) => set({ areaDrawingManager }),
  setGradientMapManager: (gradientMapManager) => set({ gradientMapManager }),
  setIrHoverLine: (irHoverLine) => set({ irHoverLine }),

  setIsFirstPersonMode: (isFirstPersonMode) => set({ isFirstPersonMode }),
  setIsAcousticMode: (isAcousticMode) => set({ isAcousticMode }),
  setShowHoveringHighlight: (showHoveringHighlight) => set({ showHoveringHighlight }),
}));

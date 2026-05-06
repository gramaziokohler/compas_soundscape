'use client';

import { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import {
  Viewer,
  DefaultViewerParams,
  SpeckleLoader,
  UrlHelper,
  CameraController,
  NearPlaneCalculation,
  SelectionExtension,
  FilteringExtension,
  StencilOutlineType,
} from '@speckle/viewer';
import { SpeckleAudioCoordinator } from '@/lib/three/speckle-audio-coordinator';
import { BoundingBoxManager } from '@/lib/three/BoundingBoxManager';
import { AreaDrawingManager } from '@/lib/three/area-drawing-manager';
import { PlaybackSchedulerService } from '@/lib/audio/playback-scheduler-service';
import { useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { SPECKLE_VIEWER_RETRY } from '@/utils/constants';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

interface ViewerInitProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  modelUrl: string | undefined;
  speckleData?: { auth_token?: string; [key: string]: any };
  audioOrchestrator: AudioOrchestrator | null;
  audioContext: AudioContext | null;
  scaleForSounds: number;
  onViewerLoaded?: (viewer: Viewer) => void;
  refreshKey: number;
  /** Ref managed by SpeckleScene, updated by useSpeckleDarkMode. Read by hover patch. */
  isDarkModeRef: React.MutableRefObject<boolean>;
  /** Ref managed by SpeckleScene, synced from viewMode. Read by hover patch. */
  isAcousticModeRef: React.MutableRefObject<boolean>;
  /** Ref managed by SpeckleScene, synced from showHoveringHighlight. Read by hover patch. */
  showHoveringHighlightRef: React.MutableRefObject<boolean>;
}

interface ViewerInitResult {
  isViewerReady: boolean;
  isLoading: boolean;
  error: string | null;
  worldTree: any;
}

export function useSpeckleViewerInit({
  containerRef,
  modelUrl,
  speckleData,
  audioOrchestrator,
  audioContext,
  scaleForSounds,
  onViewerLoaded,
  refreshKey,
  isDarkModeRef,
  isAcousticModeRef,
  showHoveringHighlightRef,
}: ViewerInitProps): ViewerInitResult {
  const { setViewer: setStoreViewer, setViewMode, incrementWorldTreeVersion } = useSpeckleStore();
  const {
    setViewer,
    setCoordinator,
    setSelectionExtension,
    setFilteringExtension,
    setBoundingBoxManager,
    setCameraController,
    setAreaDrawingManager,
    setPlaybackScheduler,
  } = useSpeckleEngineStore();

  const [isViewerReady, setIsViewerReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worldTree, setWorldTree] = useState<any>(null);

  // ============================================================================
  // Effect - Initialize Speckle Viewer
  // ============================================================================
  useEffect(() => {
    if (!modelUrl || !containerRef.current) return;

    const initViewer = async () => {
      setIsLoading(true);
      setError(null);
      setIsViewerReady(false);

      // Dispose existing viewer if URL changed
      const existingViewer = useSpeckleEngineStore.getState().viewer;
      if (existingViewer) {
        existingViewer.dispose();
        setViewer(null);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Dispose existing coordinator
      const existingCoordinator = useSpeckleEngineStore.getState().coordinator;
      if (existingCoordinator) {
        existingCoordinator.dispose();
        setCoordinator(null);
      }

      // Dispose existing area drawing manager
      const existingADM = useSpeckleEngineStore.getState().areaDrawingManager;
      if (existingADM) {
        existingADM.dispose();
        setAreaDrawingManager(null);
      }

      // Clear container
      while (containerRef.current!.firstChild) {
        containerRef.current!.removeChild(containerRef.current!.firstChild);
      }

      try {
        // Configure viewer params
        const params = DefaultViewerParams;
        params.showStats = false;
        params.verbose = false;

        // Create and initialize viewer
        const viewer = new Viewer(containerRef.current!, params);
        setViewer(viewer);
        console.log('[useSpeckleViewerInit] Viewer created');
        await viewer.init();

        // Add extensions
        const cameraController = viewer.createExtension(CameraController);
        cameraController.options = { nearPlaneCalculation: NearPlaneCalculation.EMPIRIC };
        const selectionExtension = viewer.createExtension(SelectionExtension);
        const filteringExtension = viewer.createExtension(FilteringExtension);

        // Configure selection extension with hover effect
        selectionExtension.options = {
          selectionMaterialData: {
            id: THREE.MathUtils.generateUUID(),
            color: 0x047efb,
            emissive: 0x000000,
            opacity: 1,
            roughness: 1,
            metalness: 0,
            vertexColors: false,
            lineWeight: 1,
            stencilOutlines: StencilOutlineType.OVERLAY,
            pointSize: 4,
          },
          hoverMaterialData: {
            id: THREE.MathUtils.generateUUID(),
            color: 0xffffff,
            emissive: 0x000000,
            opacity: 1,
            roughness: 1,
            metalness: 0,
            vertexColors: false,
            lineWeight: 2,
            stencilOutlines: StencilOutlineType.OVERLAY,
            pointSize: 4,
          },
        };

        // Patch applyHover to skip hover on hidden/non-isolated objects
        let lastIntersections: any[] = [];
        const rendererIntersections = viewer.getRenderer().intersections;
        const origIntersect = rendererIntersections.intersect.bind(rendererIntersections);
        rendererIntersections.intersect = function (
          scene: any, camera: any, point: any, layers?: any, firstOnly?: boolean, clippingVolume?: any
        ) {
          const results = origIntersect(scene, camera, point, layers, firstOnly, clippingVolume);
          lastIntersections = results || [];
          return results;
        };

        const isFilteredOut = (rvId: string) => {
          const state = filteringExtension.filteringState;
          if (!rvId) return false;
          const isHidden = state?.hiddenObjects?.includes(rvId);
          const isExcludedByIsolation = (state?.isolatedObjects?.length ?? 0) > 0
            && !state?.isolatedObjects?.includes(rvId);
          return isHidden || isExcludedByIsolation;
        };

        const origApplyHover = (selectionExtension as any).applyHover.bind(selectionExtension);

        const applyOutlineHover = (rv: any) => {
          if (!rv) { origApplyHover(null); return; }
          origApplyHover(rv);
          const savedOrig: any = (selectionExtension as any).hoverMaterial;
          if (!savedOrig) return;
          const clone = savedOrig.clone();
          clone.stencilWrite = true;
          clone.stencilWriteMask = 255;
          clone.stencilRef = 0;
          clone.stencilFunc = THREE.AlwaysStencilFunc;
          clone.stencilZPass = THREE.ReplaceStencilOp;
          clone.stencilFail = THREE.ReplaceStencilOp;
          clone.stencilZFail = THREE.ReplaceStencilOp;
          clone.needsUpdate = true;
          viewer.getRenderer().setMaterial([rv], clone);
        };

        (selectionExtension as any).applyHover = function (renderView: any) {
          // Disable hover in dark mode, acoustic mode, or when toggled off
          if (isDarkModeRef.current || isAcousticModeRef.current || !showHoveringHighlightRef.current) {
            origApplyHover(null);
            return;
          }
          if (renderView && isFilteredOut(renderView.renderData?.id)) {
            const renderer = viewer.getRenderer();
            let fallback: any = null;
            for (let i = 0; i < lastIntersections.length; i++) {
              const pair = renderer.renderViewFromIntersection(lastIntersections[i]);
              if (!pair) continue;
              const rv = pair[0];
              if (rv && !isFilteredOut(rv.renderData?.id)) {
                fallback = rv;
                break;
              }
            }
            applyOutlineHover(fallback);
            return;
          }
          applyOutlineHover(renderView);
        };

        // Store extensions
        setCameraController(cameraController);
        setSelectionExtension(selectionExtension);
        setFilteringExtension(filteringExtension);

        // Set object pick filter
        const speckleRenderer = viewer.getRenderer();
        const defaultPickFilter = (speckleRenderer as any).objectPickConfiguration?.pickedObjectsFilter;
        (speckleRenderer as any).objectPickConfiguration = {
          pickedObjectsFilter: ([renderView, material]: [any, any]) => {
            if (defaultPickFilter && !defaultPickFilter([renderView, material])) {
              return false;
            }
            const objectId: string | undefined = renderView?.renderData?.id;
            if (!objectId) return true;
            return !isFilteredOut(objectId);
          },
        };

        console.log('[useSpeckleViewerInit] Extensions created');

        // Load Speckle model with retry logic
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS; attempt++) {
          try {
            const originalError = console.error;
            console.error = () => {};

            let urls: string[] = [];
            try {
              urls = await UrlHelper.getResourceUrls(modelUrl, speckleData?.auth_token);
            } finally {
              console.error = originalError;
            }

            if (urls.length === 0) {
              throw new Error('Model still processing on server');
            }

            for (const url of urls) {
              const loader = new SpeckleLoader(viewer.getWorldTree(), url, speckleData?.auth_token);
              await viewer.loadObject(loader, true);
            }

            // Success — initialize audio coordinator
            console.log('[useSpeckleViewerInit] Viewer loaded, initializing SpeckleAudioCoordinator...');

            const coordinator = new SpeckleAudioCoordinator(
              viewer,
              cameraController!,
              selectionExtension!,
              audioOrchestrator,
              audioContext
            );
            coordinator.initialize(scaleForSounds);
            setCoordinator(coordinator);

            // Initialize bounding box manager
            const renderer = viewer.getRenderer();
            const scene = renderer.scene;
            if (scene) {
              const boundingBoxManager = new BoundingBoxManager(scene);
              setBoundingBoxManager(boundingBoxManager);
            } else {
              console.error('[useSpeckleViewerInit] Failed to get scene from renderer!');
            }

            // Initialize playback scheduler
            const playbackScheduler = new PlaybackSchedulerService(audioOrchestrator, audioContext);
            setPlaybackScheduler(playbackScheduler);

            setIsLoading(false);
            setIsViewerReady(true);

            // Always start in Default mode regardless of any persisted state
            setViewMode('default');

            // Register viewer with selection mode context
            setStoreViewer(viewer);

            // Load world tree for selection handling
            const tree = viewer.getWorldTree();
            if (tree) {
              console.log('[useSpeckleViewerInit] World tree loaded');
              setWorldTree(tree);
              incrementWorldTreeVersion();
            }

            // Notify parent
            if (onViewerLoaded) {
              console.log('[useSpeckleViewerInit] Calling onViewerLoaded callback');
              onViewerLoaded(viewer);
            }

            console.log('[useSpeckleViewerInit] ✅ Initialization complete');
            return;
          } catch (err) {
            lastError = err as Error;
            if (attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS - 1) {
              await new Promise(resolve => setTimeout(resolve, SPECKLE_VIEWER_RETRY.RETRY_DELAY_MS));
            }
          }
        }

        // All retries failed
        setIsLoading(false);
        setError(`Failed to load model after ${SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS} attempts`);
      } catch (err) {
        console.error('[useSpeckleViewerInit] Initialization error:', err);
        setIsLoading(false);
        setError(`Failed to initialize viewer: ${(err as Error).message}`);
      }
    };

    initViewer();

    return () => {
      // Cleanup
      const { areaDrawingManager, coordinator, viewer: v, playbackScheduler } =
        useSpeckleEngineStore.getState();

      if (areaDrawingManager) {
        areaDrawingManager.dispose();
        setAreaDrawingManager(null);
      }
      if (coordinator) {
        coordinator.dispose();
        setCoordinator(null);
      }
      if (v) {
        v.dispose();
        setViewer(null);
      }
      if (playbackScheduler) {
        setPlaybackScheduler(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl, onViewerLoaded, refreshKey]);

  // ============================================================================
  // Effect - Initialize Area Drawing Manager (after viewer is ready)
  // ============================================================================
  useEffect(() => {
    const { viewer: v, coordinator: c } = useSpeckleEngineStore.getState();
    if (!isViewerReady || !v || !c) return;

    const adapter = c.getAdapter();
    if (!adapter) return;

    const manager = new AreaDrawingManager(
      v,
      adapter.getScene(),
      adapter.getCustomObjectsGroup()
    );
    setAreaDrawingManager(manager);

    return () => {
      manager.dispose();
      setAreaDrawingManager(null);
    };
  }, [isViewerReady, setAreaDrawingManager]);

  return { isViewerReady, isLoading, error, worldTree };
}

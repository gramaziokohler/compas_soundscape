'use client';
import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import {
  Viewer,
  DefaultViewerParams,
  SpeckleLoader,
  UrlHelper,
  CameraController,
  SelectionExtension,
  FilteringExtension,
} from '@speckle/viewer';
import { SPECKLE_VIEWER_RETRY, UI_COLORS } from '@/lib/constants';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';

/**
 * Props for SpeckleViewer component
 *
 * Data Flow:
 * 1. Backend (speckle_service.py) returns speckleData with viewer_url in the 'url' field
 * 2. Frontend (useAnalysis.ts) receives this data when uploading a 3D model
 * 3. SpeckleViewer receives either viewer_url or speckleData.url to load the model
 * Documentation: https://docs.speckle.systems/developers/viewer/viewer-api
 * Source code: https://github.com/specklesystems/speckle-server/tree/main/packages/viewer
 */
interface SpeckleViewerProps {
  /** Speckle viewer URL (e.g., https://app.speckle.systems/projects/{projectId}/models/{modelId}) */
  viewer_url?: string;
  /** Alternative: pass full speckleData object from backend (backend/services/speckle_service.py) */
  speckleData?: {
    model_id: string;
    version_id: string;
    file_id: string;
    url: string; // This is the viewer_url from backend
    object_id: string;
    auth_token?: string;
  };
  /** Callback when viewer is loaded */
  onViewerLoaded?: (viewer: Viewer) => void;
}

/**
 * Exposed viewer methods via ref
 */
export interface SpeckleViewerHandle {
  viewer: Viewer | null;
  getViewer: () => Viewer | null;
}

export const SpeckleViewer = forwardRef<SpeckleViewerHandle, SpeckleViewerProps>(({ viewer_url, speckleData, onViewerLoaded }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalViewerRef = useRef<Viewer | null>(null);

  // Use context viewer ref if available
  const { viewerRef: contextViewerRef } = useSpeckleViewerContext();
  const viewerRef = contextViewerRef || internalViewerRef;

  // Expose viewer via ref
  useImperativeHandle(ref, () => ({
    viewer: viewerRef.current,
    getViewer: () => viewerRef.current
  }));
  const [isLoading, setIsLoading] = useState(false);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const modelUrl = viewer_url || speckleData?.url;

  useEffect(() => {
    if (!modelUrl) return;

    const initViewer = async () => {
      if (!containerRef.current) return;

      setIsLoading(true);
      setError(null);
      setCurrentAttempt(0);

      // Dispose existing viewer if URL changed
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Clear container to ensure clean slate
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }

      // Configure viewer params
      const params = DefaultViewerParams;
      params.showStats = false;
      params.verbose = false;

      // Create and initialize viewer
      const viewer = new Viewer(containerRef.current, params);
      viewerRef.current = viewer;
      console.log('[SpeckleViewer] Viewer instance created and stored in ref:', viewerRef);
      await viewer.init();

      // Add extensions
      viewer.createExtension(CameraController);
      const selectionExtension = viewer.createExtension(SelectionExtension);
      viewer.createExtension(FilteringExtension);

      // Enable selection
      if (selectionExtension) {
        console.log('[SpeckleViewer] SelectionExtension created successfully');

        // Log selection changes for debugging
        const logSelection = () => {
          const selected = selectionExtension.getSelectedObjects();
          if (selected && selected.length > 0) {
            console.log('[SpeckleViewer] Selection changed:', selected);
          }
        };

        // Try to attach event listener if available
        if (typeof selectionExtension.on === 'function') {
          selectionExtension.on('selection-change', logSelection);
        }
      }


      // Load Speckle model with retry logic (server needs time to process uploads)
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS; attempt++) {
        try {
          setCurrentAttempt(attempt + 1);

          // Suppress console errors during retries (UrlHelper logs errors internally)
          const originalError = console.error;
          console.error = () => {};

          let urls: string[] = [];
          try {
            urls = await UrlHelper.getResourceUrls(modelUrl, speckleData?.auth_token);
          } finally {
            // Restore console.error
            console.error = originalError;
          }

          // Check if we got valid URLs (UrlHelper returns [] on error instead of throwing)
          if (urls.length === 0) {
            throw new Error('Model still processing on server');
          }

          // Successfully got URLs, load the model
          for (const url of urls) {
            const loader = new SpeckleLoader(viewer.getWorldTree(), url, speckleData?.auth_token);
            await viewer.loadObject(loader, true);
          }

          // Success
          setIsLoading(false);
          setCurrentAttempt(0);

          // Notify parent that viewer is loaded
          if (onViewerLoaded && viewerRef.current) {
            onViewerLoaded(viewerRef.current);
          }

          return;
        } catch (error) {
          lastError = error as Error;

          // If not the last attempt, wait before retrying
          if (attempt < SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS - 1) {
            await new Promise(resolve => setTimeout(resolve, SPECKLE_VIEWER_RETRY.RETRY_DELAY_MS));
          }
        }
      }

      // All retries failed
      setIsLoading(false);
      setCurrentAttempt(0);
      setError(`Failed to load model after ${SPECKLE_VIEWER_RETRY.MAX_ATTEMPTS} attempts`);
    };

    initViewer();

    // Cleanup: dispose viewer when URL changes or component unmounts
    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, [modelUrl, onViewerLoaded]);

  return (
    <div className="relative w-full h-full" style={{ height: '100vh' }}>
      {/* Viewer container */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        id="speckle-viewer-container"
      />

      {/* Loading overlay - centered in scene */}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
        >
          <div className="flex flex-col items-center gap-3">
            {/* Animated Spinner */}
            <div
              className="animate-spin rounded-full border-4 border-t-transparent"
              style={{
                width: '48px',
                height: '48px',
                borderColor: UI_COLORS.PRIMARY,
                borderTopColor: 'transparent',
              }}
            />

            {/* Minimal text */}
            <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              Loading model...
            </p>
          </div>
        </div>
      )}

      {/* Error overlay - centered in scene */}
      {error && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
        >
          <div className="text-center p-8">
            <div className="text-6xl mb-4">⚠️</div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: UI_COLORS.ERROR }}>
              Failed to Load Model
            </h3>
            <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              {error}
            </p>
          </div>
        </div>
      )}

      {/* Empty state - centered in scene */}
      {!modelUrl && !isLoading && !error && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ backgroundColor: UI_COLORS.DARK_BG }}
        >
          <div className="text-center p-8">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold mb-2" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              No Model Loaded
            </h3>
            <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              Upload a 3D model to view it here
            </p>
          </div>
        </div>
      )}
    </div>
  );
});

SpeckleViewer.displayName = 'SpeckleViewer';
/**
 * Speckle Interactions Hook
 *
 * Manages hover highlighting and camera controls for Speckle viewer.
 * Adapted from Vue composables for highlighting and camera utilities.
 *
 * Based on:
 * - useHighlightedObjectsUtilities
 * - useCameraUtilities
 */

import { useCallback } from 'react';
import { Viewer, SelectionExtension, CameraController } from '@speckle/viewer';

/**
 * Hook for managing viewer interactions
 */
export function useSpeckleInteractions(viewerRef: React.RefObject<Viewer | null>) {
  /**
   * Highlight objects on hover
   */
  const highlightObjects = useCallback((objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const renderer = viewerRef.current.getRenderer() as any;
      if (renderer && renderer.highlightObjects) {
        renderer.highlightObjects(objectIds, true);
      }
    } catch (error) {
      console.error('Failed to highlight objects:', error);
    }
  }, [viewerRef]);

  /**
   * Remove highlight from objects
   */
  const unhighlightObjects = useCallback((objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const renderer = viewerRef.current.getRenderer() as any;
      if (renderer && renderer.highlightObjects) {
        renderer.highlightObjects(objectIds, false);
      }
    } catch (error) {
      console.error('Failed to unhighlight objects:', error);
    }
  }, [viewerRef]);

  /**
   * Zoom camera to fit specific objects
   */
  const zoomToObjects = useCallback((objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const cameraController = viewerRef.current.getExtension(CameraController) as any;
      if (cameraController && cameraController.setCameraView) {
        cameraController.setCameraView(objectIds, true);
      }
    } catch (error) {
      console.error('Failed to zoom to objects:', error);
    }
  }, [viewerRef]);

  /**
   * Zoom to fit all objects in the scene
   */
  const zoomExtents = useCallback(() => {
    if (!viewerRef.current) return;

    try {
      const controls = (viewerRef.current as any).cameraHandler;
      if (controls && controls.fitToSphere) {
        controls.fitToSphere();
      }
    } catch (error) {
      console.error('Failed to zoom extents:', error);
    }
  }, [viewerRef]);

  /**
   * Select objects in the viewer
   */
  const selectObjects = useCallback((objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const selectionExtension = viewerRef.current.getExtension(SelectionExtension);
      if (selectionExtension && selectionExtension.selectObjects) {
        selectionExtension.selectObjects(objectIds);
      }
    } catch (error) {
      console.error('Failed to select objects:', error);
    }
  }, [viewerRef]);

  /**
   * Clear selection in the viewer
   */
  const clearSelection = useCallback(() => {
    if (!viewerRef.current) return;

    try {
      const selectionExtension = viewerRef.current.getExtension(SelectionExtension);
      if (selectionExtension && selectionExtension.clearSelection) {
        selectionExtension.clearSelection();
      }
    } catch (error) {
      console.error('Failed to clear selection:', error);
    }
  }, [viewerRef]);

  return {
    highlightObjects,
    unhighlightObjects,
    zoomToObjects,
    zoomExtents,
    selectObjects,
    clearSelection
  };
}

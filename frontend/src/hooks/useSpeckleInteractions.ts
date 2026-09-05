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
import { useSpeckleStore } from '@/store';

/**
 * Hook for managing viewer interactions
 */
export function useSpeckleInteractions(viewerRef: React.RefObject<Viewer | null>) {
  /**
   * Highlight objects on hover.
   *
   * Uses the Viewer's own `highlightObjects` helper (the Viewer exposes
   * highlight/select/reset convenience methods that wrap its HighlightExtension;
   * they are NOT on `getRenderer()`). Hidden / non-isolated objects are skipped
   * so hovering a hidden row does not re-show it.
   */
  const highlightObjects = useCallback((objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const hidden = useSpeckleStore.getState().getExplorerHiddenIds();
      const isolated = useSpeckleStore.getState().getExplorerIsolatedIds();
      const visibleIds = objectIds.filter(
        (id) => !hidden.has(id) && (isolated === null || isolated.includes(id)),
      );
      if (visibleIds.length === 0) return;

      const viewer = viewerRef.current as unknown as { highlightObjects?: (ids: string[]) => void };
      if (viewer && typeof viewer.highlightObjects === 'function') {
        viewer.highlightObjects(visibleIds);
      }
    } catch (error) {
      console.error('Failed to highlight objects:', error);
    }
  }, [viewerRef]);

  /**
   * Remove highlight from objects.
   *
   * The Viewer's highlight helper only supports select-all or clear-all, so we
   * clear the whole hover highlight. Only one tree row is hovered at a time.
   */
  const unhighlightObjects = useCallback((_objectIds: string[]) => {
    if (!viewerRef.current) return;

    try {
      const viewer = viewerRef.current as unknown as { resetHighlight?: () => void };
      if (viewer && typeof viewer.resetHighlight === 'function') {
        viewer.resetHighlight();
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

/**
 * Viewer actions behind the review panel's row buttons. Selection, view mode
 * and camera framing are view state — never undo steps. Material assignment
 * goes through the undoable acoustic-material store (one step per click).
 */

import * as THREE from 'three';
import { useAcousticMaterialStore, useModelVersionStore, useSpeckleStore } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { getSelectionLeafIds } from '@/lib/three/speckle-selection-actions';
import { openMaterialsExplorer } from '@/components/layout/sidebar/acoustics/openMaterialsExplorer';
import { SIMULATION_PREFLIGHT } from '@/utils/constants';

/** Half-size (m) of the box framed around a located listener / sound. */
const LOCATE_HALF_EXTENT_M = 1.5;

/**
 * Geometry leaf ids of objects of the loaded version — what material assignments
 * are keyed by (a BIM object's display meshes, a 3dm mesh itself).
 */
export function geometryIdsFor(rawIds: string[]): string[] {
  return rawIds.length > 0 ? getSelectionLeafIds(rawIds) : [];
}

/**
 * Select and frame objects, switch the viewer to Acoustics and open the Object
 * Explorer. When no simulation card has material editing active, expand one so
 * the material columns (and the review panel's dropdowns) become available.
 */
export function focusObjectsForMaterial(rawIds: string[]): void {
  const ids = geometryIdsFor(rawIds);
  if (ids.length === 0) return;
  const { selectionExtension, cameraController } = useSpeckleEngineStore.getState();
  useSpeckleStore.getState().setSelectedObjectIds(ids);
  try {
    selectionExtension?.selectObjects(ids);
    cameraController?.setCameraView(ids, true);
  } catch (err) {
    console.warn('[model-version] Could not focus objects', err);
  }
  openMaterialsExplorer();
  if (!useAcousticMaterialStore.getState().isActive) {
    useModelVersionStore.getState().requestRevealSimulation(null);
  }
}

/** Assign one material to objects of the loaded version (all their geometry leaves). */
export function assignMaterialToObjects(rawIds: string[], materialId: string): void {
  const ids = geometryIdsFor(rawIds);
  if (ids.length > 0) useAcousticMaterialStore.getState().assignMaterialToObjects(ids, materialId);
}

/** Frame the camera on a point (listener / free sound). */
export function framePoint(position: [number, number, number]): void {
  const { cameraController } = useSpeckleEngineStore.getState();
  if (!cameraController) return;
  const center = new THREE.Vector3(...position);
  const half = new THREE.Vector3(LOCATE_HALF_EXTENT_M, LOCATE_HALF_EXTENT_M, LOCATE_HALF_EXTENT_M);
  cameraController.setCameraView(new THREE.Box3(center.clone().sub(half), center.clone().add(half)), true, SIMULATION_PREFLIGHT.FOCUS_FIT);
}

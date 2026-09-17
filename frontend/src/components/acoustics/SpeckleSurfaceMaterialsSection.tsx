/**
 * SpeckleSurfaceMaterialsSection Component
 *
 * Headless orchestrator for the Object-Explorer-driven acoustic material workflow.
 * Material/scattering assignment now happens as two extra columns inside the
 * Object Explorer (keyed by raw Speckle geometry IDs across the WHOLE model).
 * This component no longer renders a layer dropdown — it only:
 * - activates the acoustic material store (isActive + cardType + availableMaterials)
 * - isolates the "Acoustics" layer as a starting point (user may reveal other layers)
 * - saves/restores viewer visibility around that isolation
 * - registers material colors for the viewer
 * - loads/remaps persisted assignments and notifies the parent for the backend payload
 *
 * Assignments are owned by useAcousticMaterialStore. The Object Explorer is the
 * producer (writes assignments); this component is a consumer for color + persistence.
 */

'use client';

import { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { useSpeckleSurfaceMaterials } from '@/hooks/useSpeckleSurfaceMaterials';
import { useSpeckleFiltering } from '@/hooks/useSpeckleFiltering';
import { useSpeckleStore } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import type { AcousticMaterial } from '@/types/materials';
import type { AcousticCardType } from '@/store/acousticMaterialStore';
import type { Viewer } from '@speckle/viewer';
import type { ObjectColorGroup } from '@/types/speckle-materials';

// ── Whole-model id maps ─────────────────────────────────────────────────────
// The Object Explorer keys assignments by raw Speckle object IDs (raw.id).
// Persistence uses applicationId (stable across model republishes). Build both
// directions across the ENTIRE model (not just one layer).

function getRootChildren(worldTree: any): any[] {
  if (!worldTree) return [];
  if (worldTree.tree?._root?.children) return worldTree.tree._root.children;
  if (worldTree._root?.children) return worldTree._root.children;
  if (worldTree.root?.children) return worldTree.root.children;
  if (worldTree.children) return worldTree.children;
  return [];
}

function walkCollectIdMaps(nodes: any[], rawIdToAppId: Map<string, string>, appIdToRawIds: Map<string, string[]>): void {
  for (const node of nodes) {
    const raw = node?.raw || node?.model?.raw || {};
    const rawId: string | undefined = raw.id;
    const appId: string | undefined = raw.applicationId;
    if (rawId && appId) {
      rawIdToAppId.set(rawId, appId);
      // A Brep/BIM object and its display mesh(es) share the SAME applicationId
      // (verified against live Speckle data). Persisted assignments are keyed by
      // applicationId, so record EVERY raw id that carries it — otherwise the
      // remap resolves only the first (the carrier) and the display-mesh tree rows
      // in the Object Explorer keep showing "Select...".
      const existing = appIdToRawIds.get(appId);
      if (existing) {
        if (!existing.includes(rawId)) existing.push(rawId);
      } else {
        appIdToRawIds.set(appId, [rawId]);
      }
    }
    const children = node?.model?.children || node?.children || [];
    if (children.length > 0) walkCollectIdMaps(children, rawIdToAppId, appIdToRawIds);
  }
}

/**
 * Expand persisted assignments (keyed by applicationId or raw id) into a Map
 * keyed by EVERY current raw object id that shares the source applicationId.
 * This keeps the Object Explorer's mesh rows in sync with the carrier rows and
 * with the colors the viewer renders.
 */
function expandSavedAssignments<T extends string | number>(
  source: Record<string, T> | undefined,
  rawIdToAppId: Map<string, string>,
  appIdToRawIds: Map<string, string[]>,
): Map<string, T> {
  const out = new Map<string, T>();
  if (!source) return out;
  for (const [key, value] of Object.entries(source)) {
    if (rawIdToAppId.has(key)) {
      // Already a current raw id.
      out.set(key, value);
      continue;
    }
    const raws = appIdToRawIds.get(key);
    if (raws && raws.length > 0) {
      for (const id of raws) out.set(id, value);
      continue;
    }
    // Unknown — keep as-is (best effort) until the id maps are ready.
    out.set(key, value);
  }
  return out;
}

interface SpeckleSurfaceMaterialsSectionProps {
  viewerRef: React.RefObject<Viewer | null>;
  worldTree?: any;
  availableMaterials: AcousticMaterial[];
  /** Active acoustic card type — drives scattering-column visibility (pyroom only). */
  cardType: AcousticCardType;
  /** When true, the Acoustics layer is isolated in the viewer. Controlled by global toggle. */
  filteringEnabled?: boolean;
  /** When true, UI controls are disabled (read-only mode for completed simulations) */
  isReadOnly?: boolean;
  onMaterialAssignmentsChange: (assignments: Record<string, string>, layerName: string | null, geometryObjectIds: string[], scatteringAssignments: Record<string, number>) => void;
  className?: string;
  // Persisted state for restoring on remount
  initialAssignments?: Record<string, string>;
  initialLayerName?: string | null;
  initialScatteringAssignments?: Record<string, number>;
  initialIsolatedObjectIds?: string[] | null;
  onIsolationChange?: (ids: string[] | null) => void;
}

export function SpeckleSurfaceMaterialsSection({
  viewerRef,
  worldTree: propWorldTree,
  availableMaterials,
  cardType,
  filteringEnabled = true,
  initialAssignments,
  initialLayerName,
  initialScatteringAssignments,
  initialIsolatedObjectIds,
  onIsolationChange,
  onMaterialAssignmentsChange,
}: SpeckleSurfaceMaterialsSectionProps) {

  // Sync worldTree from prop — AcousticsSection handles the viewer lookup
  const [worldTree, setWorldTree] = useState(propWorldTree);
  useEffect(() => {
    if (propWorldTree) setWorldTree(propWorldTree);
  }, [propWorldTree]);

  // Get Speckle filtering extension for layer isolation
  const {
    isolateObjects,
    unIsolateObjects,
    hideObjects,
    hiddenObjects,
    isolatedObjects,
  } = useSpeckleFiltering(viewerRef, 'acoustic-materials');

  // Material color registration (merged with diverse/linked colors)
  const { registerMaterialColors, clearMaterialColors, applyFilterColors } = useSpeckleStore();

  // Surface materials hook — used ONLY for the Acoustics-layer isolation start point
  const {
    selectedLayerId,
    layerOptions,
    getMaterialColor,
    getAllObjectIds,
  } = useSpeckleSurfaceMaterials(viewerRef, worldTree, availableMaterials, {
    initialLayerName,
  });

  // ── Acoustic material store ──
  const activate              = useAcousticMaterialStore((s) => s.activate);
  const deactivate            = useAcousticMaterialStore((s) => s.deactivate);
  const deactivateViewer      = useAcousticMaterialStore((s) => s.deactivateViewer);
  const loadAssignments       = useAcousticMaterialStore((s) => s.loadAssignments);
  const materialAssignments   = useAcousticMaterialStore((s) => s.materialAssignments);
  const scatteringAssignments = useAcousticMaterialStore((s) => s.scatteringAssignments);

  // Whole-model id maps (raw.id <-> applicationId), built once per worldTree.
  // `appIdToRawIds` is plural because a carrier and its display meshes share an
  // applicationId (see walkCollectIdMaps).
  const { rawIdToAppId, appIdToRawIds } = useMemo(() => {
    const rawIdToAppId = new Map<string, string>();
    const appIdToRawIds = new Map<string, string[]>();
    if (worldTree) walkCollectIdMaps(getRootChildren(worldTree), rawIdToAppId, appIdToRawIds);
    return { rawIdToAppId, appIdToRawIds };
  }, [worldTree]);

  // ── Activate the store (whole-tree workflow) ──
  useEffect(() => {
    if (!filteringEnabled) {
      deactivateViewer();
      return;
    }
    activate({ availableMaterials, cardType });
  }, [filteringEnabled, availableMaterials, cardType, activate, deactivateViewer]);

  // Clear store on unmount. Reset initializedRef so a re-mount re-loads assignments.
  useEffect(() => {
    return () => {
      deactivate();
      initializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load persisted assignments on mount (or re-mount after StrictMode cleanup).
  // Persisted keys are applicationId — remap to current raw IDs immediately.
  const initializedRef = useRef(false);
  const skipNextNotifyRef = useRef(true);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    skipNextNotifyRef.current = true;

    const initMaterial = expandSavedAssignments(initialAssignments, rawIdToAppId, appIdToRawIds);
    const initScattering = expandSavedAssignments(initialScatteringAssignments, rawIdToAppId, appIdToRawIds);
    loadAssignments(initMaterial, initScattering);
    useAcousticMaterialStore.temporal.getState().clear();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Late hydration ──
  // The project soundscape (and thus `initialAssignments`) can load AFTER this
  // card mounts (bootstrap). On mount the store was still empty, so the effect
  // above loaded nothing. When the saved assignments arrive and the shared store
  // is still empty, load them so the Object Explorer shows the materials instead
  // of "Select...". Guarded on an empty store to avoid clobbering user edits.
  useEffect(() => {
    if (!initialAssignments || Object.keys(initialAssignments).length === 0) return;
    if (useAcousticMaterialStore.getState().materialAssignments.size > 0) return;

    const initMaterial = expandSavedAssignments(initialAssignments, rawIdToAppId, appIdToRawIds);
    const initScattering = expandSavedAssignments(initialScatteringAssignments, rawIdToAppId, appIdToRawIds);

    skipNextNotifyRef.current = true;
    loadAssignments(initMaterial, initScattering);
    useAcousticMaterialStore.temporal.getState().clear();
  }, [initialAssignments, initialScatteringAssignments, rawIdToAppId, appIdToRawIds, loadAssignments]);
  // ── Re-expand once the whole-model id maps become available ──
  // On mount the worldTree (and thus `appIdToRawIds`) may still be empty, so the
  // effects above kept the persisted applicationId keys verbatim. When the maps
  // arrive, expand every key to the full set of raw ids sharing that appId — the
  // carrier AND its display meshes — so the Object Explorer's mesh rows resolve
  // the same material the viewer already colors.
  const hasRemappedRef = useRef(false);
  useEffect(() => {
    if (hasRemappedRef.current) return;
    if (appIdToRawIds.size === 0) return;
    if (materialAssignments.size === 0) return;

    const currentRawIds = new Set(rawIdToAppId.keys());
    let needsExpansion = false;
    materialAssignments.forEach((_, key) => {
      if (!currentRawIds.has(key)) needsExpansion = true;
    });

    if (!needsExpansion) { hasRemappedRef.current = true; return; }
    hasRemappedRef.current = true;

    const expandedMaterial = expandSavedAssignments(
      Object.fromEntries(materialAssignments),
      rawIdToAppId,
      appIdToRawIds,
    );
    const expandedScattering = expandSavedAssignments(
      Object.fromEntries(scatteringAssignments),
      rawIdToAppId,
      appIdToRawIds,
    );

    // If every saved ID was stale (no matches), keep the originals to avoid
    // a false "materialsChanged" reset that loses completed results.
    if (expandedMaterial.size === 0 && materialAssignments.size > 0) return;

    skipNextNotifyRef.current = true;
    loadAssignments(expandedMaterial, expandedScattering);
    useAcousticMaterialStore.temporal.getState().clear();
  }, [appIdToRawIds, rawIdToAppId, materialAssignments, scatteringAssignments, loadAssignments]);

  // Track previous layer to detect changes
  const previousLayerIdRef = useRef<string | null>(null);

  /**
   * Color visualization: update when material assignments change or filteringEnabled toggles.
   */
  const prevFilteringEnabledForColors = useRef(filteringEnabled);
  useEffect(() => {
    const wasEnabled = prevFilteringEnabledForColors.current;
    prevFilteringEnabledForColors.current = filteringEnabled;

    if (!filteringEnabled) {
      if (wasEnabled) clearMaterialColors();
      return;
    }

    if (materialAssignments.size === 0) {
      clearMaterialColors();
      return;
    }

    const colorMap = new Map<string, string[]>();
    materialAssignments.forEach((materialId, objectId) => {
      const color = getMaterialColor(materialId);
      if (!colorMap.has(color)) colorMap.set(color, []);
      colorMap.get(color)!.push(objectId);
    });
    const colorGroups: ObjectColorGroup[] = [];
    colorMap.forEach((objectIds, color) => colorGroups.push({ objectIds, color }));
    registerMaterialColors(colorGroups);
  }, [filteringEnabled, materialAssignments, getMaterialColor, registerMaterialColors, clearMaterialColors, availableMaterials]);

  /**
   * Notify parent when assignments or selected layer change.
   * Backend payload: object_materials keyed by applicationId (persistence),
   * geometry_object_ids as raw IDs (backend filters by obj.id).
   */
  const onMaterialAssignmentsChangeRef = useRef(onMaterialAssignmentsChange);
  useEffect(() => { onMaterialAssignmentsChangeRef.current = onMaterialAssignmentsChange; }, [onMaterialAssignmentsChange]);

  useEffect(() => {
    if (skipNextNotifyRef.current) {
      skipNextNotifyRef.current = false;
      return;
    }

    const assignmentsObject: Record<string, string> = {};
    materialAssignments.forEach((materialId, objectId) => {
      const appId = rawIdToAppId.get(objectId) || objectId;
      assignmentsObject[appId] = materialId;
    });

    const scatteringObject: Record<string, number> = {};
    scatteringAssignments.forEach((value, objectId) => {
      const appId = rawIdToAppId.get(objectId) || objectId;
      scatteringObject[appId] = value;
    });

    const selectedLayer = layerOptions.find(layer => layer.id === selectedLayerId);
    const layerName = selectedLayer?.name || null;

    // Raw IDs for the backend (matched by obj.id)
    const geometryObjectIds = Array.from(materialAssignments.keys());

    onMaterialAssignmentsChangeRef.current(assignmentsObject, layerName, geometryObjectIds, scatteringObject);
  }, [materialAssignments, scatteringAssignments, selectedLayerId, layerOptions, rawIdToAppId]);

  /**
   * Clear material colors when component unmounts.
   */
  useEffect(() => {
    return () => { clearMaterialColors(); };
  }, [clearMaterialColors]);

  // Headless — material/scattering assignment UI lives in the Object Explorer.
  return null;
}

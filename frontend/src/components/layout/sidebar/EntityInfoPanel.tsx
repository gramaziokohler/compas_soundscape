'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { UI_BORDER_RADIUS, PYROOMACOUSTICS_DEFAULT_SCATTERING, PYROOMACOUSTICS_SCATTERING_MIN, PYROOMACOUSTICS_SCATTERING_MAX } from '@/utils/constants';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { useSpeckleStore } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import { useAudioControlsStore } from '@/store';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { MaterialSelect } from '@/components/ui/MaterialSelect';
import { SoundResultContent } from '@/components/layout/sidebar/sound/SoundResultContent';
import type { HierarchicalMeshObject } from '@/hooks/useSpeckleSurfaceMaterials';
import type { SoundEvent } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** Recursively find an object by ID in the mesh tree */
function findObjectInMeshTree(objects: HierarchicalMeshObject[], objectId: string): HierarchicalMeshObject | null {
  for (const obj of objects) {
    if (obj.id === objectId) return obj;
    const found = findObjectInMeshTree(obj.children, objectId);
    if (found) return found;
  }
  return null;
}

/** Collect all geometry object IDs from the tree */
function collectAllObjectIds(objects: HierarchicalMeshObject[]): string[] {
  const ids: string[] = [];
  for (const obj of objects) {
    if (obj.hasGeometry) ids.push(obj.id);
    ids.push(...collectAllObjectIds(obj.children));
  }
  return ids;
}

/** Collect all geometry IDs from a single node and its descendants */
function collectGeometryIdsFromNode(node: HierarchicalMeshObject): string[] {
  const ids: string[] = [];
  if (node.hasGeometry) ids.push(node.id);
  for (const child of node.children) {
    ids.push(...collectGeometryIdsFromNode(child));
  }
  return ids;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntityInfoPanel Component
 *
 * Embedded version of EntityInfoBox for display in RightSidebar.
 * Two mutually exclusive modes:
 * - Default: entity information + diverse selection / link controls
 * - Material mode (acoustic simulation active): material assignment dropdowns
 * - Receiver mode: receiver details with go-to button
 */

interface EntityInfoPanelProps {
  onGoToReceiver?: (receiverId: string) => void;
  /** Still passed from parent — SoundEvent list owned by useSoundGeneration (not yet migrated). */
  generatedSounds?: SoundEvent[];
}

export function EntityInfoPanel({
  onGoToReceiver,
  generatedSounds,
}: EntityInfoPanelProps) {
  const {
    selectedEntity,
    selectedObjectIds,
    linkVersion,
    getObjectLinkState,
    addToDiverseSelection,
    removeFromDiverseSelection
  } = useSpeckleStore();

  const explorerIsolatedIds = useSpeckleStore((s) => s.explorerIsolatedIds);

  // ── Acoustic material store (replaces AcousticMaterialContext) ──
  const isActive = useAcousticMaterialStore((s) => s.isActive);
  const meshObjects = useAcousticMaterialStore((s) => s.meshObjects);
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const scatteringAssignments = useAcousticMaterialStore((s) => s.scatteringAssignments);
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);
  const assignMaterial = useAcousticMaterialStore((s) => s.assignMaterial);
  const assignMaterialToObjects = useAcousticMaterialStore((s) => s.assignMaterialToObjects);
  const assignScattering = useAcousticMaterialStore((s) => s.assignScattering);
  const assignScatteringToObjects = useAcousticMaterialStore((s) => s.assignScatteringToObjects);

  // ── Audio controls store ──
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals = useAudioControlsStore((s) => s.soundIntervals);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const previewingSoundId = useAudioControlsStore((s) => s.previewingSoundId);
  const onPreviewPlayPause = useAudioControlsStore((s) => s.handlePreviewPlayPause);
  const onPreviewStop = useAudioControlsStore((s) => s.handlePreviewStop);
  const onVolumeChange = useAudioControlsStore((s) => s.handleVolumeChange);
  const onIntervalChange = useAudioControlsStore((s) => s.handleIntervalChange);
  const onVariantChange = useAudioControlsStore((s) => s.handleVariantChange);

  // Local independent playback state for the EntityInfoPanel sound player
  const [localPreviewId, setLocalPreviewId] = useState<string | null>(null);

  const handleLocalPlayPause = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : soundId);
  }, []);

  const handleLocalStop = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : prev);
  }, []);

  // materialState comes directly from context — changes only when DATA changes
  // (the context uses functional state updates with reference-equality guards).

  // Sort materials by absorption for dropdown display
  const sortedMaterials = useMemo(() => {
    if (!isActive) return [];
    return [...availableMaterials]
      .filter(mat => typeof mat.absorption === 'number' && !isNaN(mat.absorption))
      .sort((a, b) => a.absorption - b.absorption);
  }, [isActive, availableMaterials]);

  // Material color map for dropdown backgrounds
  const materialColors = useMemo(() => {
    if (!isActive) return new Map<string, string>();
    const colors = new Map<string, string>();
    availableMaterials.forEach((mat) => {
      colors.set(mat.id, getMaterialColorByAbsorption(mat.absorption));
    });
    return colors;
  }, [isActive, availableMaterials]);

  // Visible object IDs: all geometry IDs filtered by active isolation (if any)
  const visibleObjectIds = useMemo(() => {
    const allIds = collectAllObjectIds(meshObjects);
    if (explorerIsolatedIds === null) return allIds;
    const isolatedSet = new Set(explorerIsolatedIds);
    return allIds.filter(id => isolatedSet.has(id));
  }, [meshObjects, explorerIsolatedIds]);

  // Compute "All Objects" material info — scoped to visible (isolated) objects only
  const allObjectsInfo = useMemo(() => {
    if (!isActive) return null;
    const totalGeometry = visibleObjectIds.length;
    const uniqueMaterials = new Set(
      visibleObjectIds.map(id => materialAssignments.get(id)).filter(Boolean)
    );
    const commonMaterialId = uniqueMaterials.size === 1 ? Array.from(uniqueMaterials)[0]! : null;
    const assignedCount = visibleObjectIds.filter(id => materialAssignments.has(id)).length;
    const unassignedCount = totalGeometry - assignedCount;
    return { totalGeometry, commonMaterialId, uniqueMaterials, assignedCount, unassignedCount };
  }, [isActive, visibleObjectIds, materialAssignments]);

  // Check if the selected entity is in the mesh tree
  const selectedObjectInTree = useMemo(() => {
    if (!isActive || !selectedEntity?.objectId) return null;
    return findObjectInMeshTree(meshObjects, selectedEntity.objectId);
  }, [isActive, meshObjects, selectedEntity?.objectId]);

  // Current material for the selected object (single geometry)
  const selectedObjectMaterialId = useMemo(() => {
    if (!isActive || !selectedEntity?.objectId) return null;
    return materialAssignments.get(selectedEntity.objectId) || null;
  }, [isActive, materialAssignments, selectedEntity?.objectId]);

  // Geometry IDs under the selected node (all descendants when it's a group/layer)
  const selectedGeometryIds = useMemo(() => {
    if (!selectedObjectInTree) return [];
    return collectGeometryIdsFromNode(selectedObjectInTree);
  }, [selectedObjectInTree]);

  // Whether the selected node is a group/layer (not a single geometry object)
  const isGroupSelection = selectedObjectInTree !== null && !selectedObjectInTree.hasGeometry;

  // True multi-select: shift-clicked multiple individual geometry surfaces
  const isMultiSurfaceSelection = isActive && selectedObjectIds.length > 1 && !isGroupSelection;

  // Geometry IDs from the shift-click multi-selection (only actual geometry nodes)
  const multiSelectionGeometryIds = useMemo(() => {
    if (!isMultiSurfaceSelection) return [];
    return selectedObjectIds.filter(id => {
      const node = findObjectInMeshTree(meshObjects, id);
      return node?.hasGeometry === true;
    });
  }, [isMultiSurfaceSelection, selectedObjectIds, meshObjects]);

  // Common material / mixed state for multi-selection
  const multiSelectionAssignmentInfo = useMemo(() => {
    if (!isActive || multiSelectionGeometryIds.length === 0) return null;
    const assignedMaterials = new Set(
      multiSelectionGeometryIds.map(id => materialAssignments.get(id)).filter(Boolean) as string[]
    );
    const commonMaterialId = assignedMaterials.size === 1 ? Array.from(assignedMaterials)[0] : null;
    return { uniqueAssigned: assignedMaterials, commonMaterialId };
  }, [isActive, multiSelectionGeometryIds, materialAssignments]);

  // Scattering value for "All Objects" slider — scoped to visible objects
  const allObjectsScattering = useMemo(() => {
    if (!isActive) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    if (visibleObjectIds.length === 0) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    const values = visibleObjectIds.map(id => scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
    const unique = new Set(values);
    return unique.size === 1 ? values[0] : PYROOMACOUSTICS_DEFAULT_SCATTERING;
  }, [isActive, visibleObjectIds, scatteringAssignments]);

  // Scattering value for selected object/group slider
  const selectedObjectScattering = useMemo(() => {
    if (!isActive) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    if (isGroupSelection && selectedGeometryIds.length > 0) {
      const values = selectedGeometryIds.map(id => scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
      const unique = new Set(values);
      return unique.size === 1 ? values[0] : PYROOMACOUSTICS_DEFAULT_SCATTERING;
    }
    if (!selectedEntity?.objectId) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    return scatteringAssignments.get(selectedEntity.objectId) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING;
  }, [isActive, scatteringAssignments, selectedEntity?.objectId, selectedGeometryIds, isGroupSelection]);

  // Scattering value for multi-surface shift-click selection
  const multiSelectionScattering = useMemo(() => {
    if (!isActive || multiSelectionGeometryIds.length === 0) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    const values = multiSelectionGeometryIds.map(id => scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
    const unique = new Set(values);
    return unique.size === 1 ? values[0] : PYROOMACOUSTICS_DEFAULT_SCATTERING;
  }, [isActive, multiSelectionGeometryIds, scatteringAssignments]);

  // Assignment info for group selections: common material and mixed state
  const selectedGroupAssignmentInfo = useMemo(() => {
    if (!isActive || selectedGeometryIds.length === 0) return null;
    const assignedMaterials = new Set(
      selectedGeometryIds
        .map(id => materialAssignments.get(id))
        .filter(Boolean) as string[]
    );
    const commonMaterialId = assignedMaterials.size === 1 ? Array.from(assignedMaterials)[0] : null;
    return { uniqueAssigned: assignedMaterials, commonMaterialId };
  }, [isActive, materialAssignments, selectedGeometryIds]);

  // ── Scattering sliders (batched — one undo step per drag) ──
  // We need refs to the "assign" callbacks to avoid stale closure inside useBatchedSlider.
  const selectedGeometryIdsRef = useRef(selectedGeometryIds);
  selectedGeometryIdsRef.current = selectedGeometryIds;
  const multiSelectionGeometryIdsRef = useRef(multiSelectionGeometryIds);
  multiSelectionGeometryIdsRef.current = multiSelectionGeometryIds;
  const selectedEntityRef = useRef(selectedEntity);
  selectedEntityRef.current = selectedEntity;
  const isMultiSurfaceSelectionRef = useRef(isMultiSurfaceSelection);
  isMultiSurfaceSelectionRef.current = isMultiSurfaceSelection;
  const visibleObjectIdsRef = useRef(visibleObjectIds);
  visibleObjectIdsRef.current = visibleObjectIds;

  const selectedScatteringSlider = useBatchedSlider<number>(
    'acousticMaterial',
    (value) => {
      if (isMultiSurfaceSelectionRef.current) assignScatteringToObjects(multiSelectionGeometryIdsRef.current, value);
      else if (isGroupSelection) assignScatteringToObjects(selectedGeometryIdsRef.current, value);
      else if (selectedEntityRef.current) assignScattering(selectedEntityRef.current.objectId, value);
    },
  );

  const allScatteringSlider = useBatchedSlider<number>(
    'acousticMaterial',
    (value) => assignScatteringToObjects(visibleObjectIdsRef.current, value),
  );

  // ===== MATERIAL ASSIGNMENT MODE =====
  if (isActive && allObjectsInfo) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div
          className="pb-2 mb-3 text-sm font-semibold flex-shrink-0 text-secondary"
        >
          Material Assignment
        </div>

        <div className="space-y-3 flex-1">
          {/* "All Objects" bulk dropdown */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-secondary">
              All Objects ({allObjectsInfo.totalGeometry})
            </span>
            <MaterialSelect
              value={allObjectsInfo.commonMaterialId || ''}
              onChange={(matId) => assignMaterialToObjects(visibleObjectIds, matId)}
              materials={sortedMaterials}
              materialColors={materialColors}
              placeholder={allObjectsInfo.uniqueMaterials.size > 1 ? '(mixed)' : 'Select...'}
              opacity={allObjectsInfo.uniqueMaterials.size > 1 ? 0.7 : 1}
            />
          </div>

          {/* Per-object / per-group / multi-surface dropdown OR hint text */}
          {(isMultiSurfaceSelection && multiSelectionGeometryIds.length > 0) ||
           (selectedObjectInTree && selectedGeometryIds.length > 0) ? (() => {
            const isMixed = isMultiSurfaceSelection
              ? (multiSelectionAssignmentInfo?.uniqueAssigned.size ?? 0) > 1
              : isGroupSelection
                ? (selectedGroupAssignmentInfo?.uniqueAssigned.size ?? 0) > 1
                : false;
            const effectiveMaterialId = isMultiSurfaceSelection
              ? multiSelectionAssignmentInfo?.commonMaterialId ?? null
              : isGroupSelection
                ? selectedGroupAssignmentInfo?.commonMaterialId ?? null
                : selectedObjectMaterialId;
            const label = isMultiSurfaceSelection
              ? `Selected (${multiSelectionGeometryIds.length})`
              : isGroupSelection
                ? `Selected (${selectedGeometryIds.length})`
                : 'Selected surface';
            const titleText = isMultiSurfaceSelection
              ? `${multiSelectionGeometryIds.length} surfaces selected`
              : selectedObjectInTree?.name ?? '';

            return (
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs truncate"
                  style={{ color: 'var(--color-secondary-hover)', maxWidth: '120px' }}
                  title={titleText}
                >
                  {label}
                </span>
                <MaterialSelect
                  value={effectiveMaterialId || ''}
                  onChange={(matId) => {
                    if (isMultiSurfaceSelection) {
                      assignMaterialToObjects(multiSelectionGeometryIds, matId);
                    } else if (isGroupSelection) {
                      assignMaterialToObjects(selectedGeometryIds, matId);
                    } else if (selectedEntity) {
                      assignMaterial(selectedEntity.objectId, matId);
                    }
                  }}
                  materials={sortedMaterials}
                  materialColors={materialColors}
                  placeholder={isMixed ? '(mixed)' : 'Select...'}
                  opacity={isMixed ? 0.7 : 1}
                />
              </div>
            );
          })() : (
            <p className="text-xs" style={{ color: 'var(--color-secondary-hover)', fontStyle: 'italic' }}>
              Select a surface in the viewer to assign material
            </p>
          )}

          {/* Scattering (per-object / group / multi-surface, same workflow as material) */}
          {(isMultiSurfaceSelection && multiSelectionGeometryIds.length > 0) ||
           (selectedObjectInTree && selectedGeometryIds.length > 0) ? (
            <RangeSlider
              color='var(--color-info)'
              label={
                isMultiSurfaceSelection
                  ? `Scattering (${multiSelectionGeometryIds.length}): `
                  : isGroupSelection
                    ? `Scattering (${selectedGeometryIds.length}): `
                    : 'Scattering: '
              }
              value={isMultiSurfaceSelection ? multiSelectionScattering : selectedObjectScattering}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step={0.01}
              onDragStart={selectedScatteringSlider.onDragStart}
              onChange={selectedScatteringSlider.onChange}
              onChangeCommitted={selectedScatteringSlider.onCommit}
              defaultValue={PYROOMACOUSTICS_DEFAULT_SCATTERING}
              showLabels={false}
              formatValue={(v) => v.toFixed(2)}
              hoverText="Scattering coefficient for selected surface(s) (double-click to reset)"
            />
          ) : (
            <RangeSlider
              color='var(--color-info)'
              label="Scattering (all): "
              value={allObjectsScattering}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step={0.01}
              onDragStart={allScatteringSlider.onDragStart}
              onChange={allScatteringSlider.onChange}
              onChangeCommitted={allScatteringSlider.onCommit}
              defaultValue={PYROOMACOUSTICS_DEFAULT_SCATTERING}
              showLabels={false}
              formatValue={(v) => v.toFixed(2)}
              hoverText="Scattering coefficient for all surfaces (double-click to reset)"
            />
          )}

          {/* Unassigned count */}
          {allObjectsInfo.unassignedCount > 0 && (
            <div
              className="text-xs text-center py-1 px-2"
              style={{
              color: 'var(--color-warning)',
              backgroundColor: 'var(--color-warning-light)',
                borderRadius: `${UI_BORDER_RADIUS.SM}px`
              }}
            >
              {allObjectsInfo.unassignedCount} of {allObjectsInfo.totalGeometry} objects unassigned
            </div>
          )}

          {/* All assigned indicator */}
          {allObjectsInfo.unassignedCount === 0 && allObjectsInfo.assignedCount > 0 && (
            <div
              className="text-xs text-center py-1 px-2"
              style={{
              color: 'var(--color-info)',
              backgroundColor: 'color-mix(in srgb, var(--color-info) 6%, transparent)',
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
              border: `1px solid color-mix(in srgb, var(--color-success) 25%, transparent)`
              }}
            >
              {allObjectsInfo.assignedCount} object{allObjectsInfo.assignedCount !== 1 ? 's' : ''} assigned
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== RECEIVER INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Receiver' && selectedEntity.receiverData) {
    const receiverColor = 'var(--color-receiver)';
    return (
      <div className="flex flex-col">
        {/* Header with Go To button */}
        <div className="my-8 mb-0 text-sm font-semibold flex-shrink-0 text-secondary flex items-center justify-between"
              style={{
                color: receiverColor
              }}  >        
          <span>{selectedEntity.objectName}</span>
          {onGoToReceiver && (
            <button
              onClick={() => onGoToReceiver(selectedEntity.objectId)}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.backgroundColor = receiverColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = receiverColor;
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              className="w-7 h-7 flex items-center justify-center rounded transition-colors"
              style={{
                color: receiverColor,
                borderRadius: '6px'
              }}
              title="Go to receiver (first-person view)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>

        {/* Receiver Details */}
        <div className="space-y-2 text-xs flex-1">
          <div className="flex text-secondary">
            <span>ID:</span>
            <span className="mx-2 max-w-[180px] truncate" title={selectedEntity.objectId}>
              {selectedEntity.objectId}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ===== SOUND INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Sound' && selectedEntity.soundData && generatedSounds) {
    const { promptIndex } = selectedEntity.soundData;
    const variants = generatedSounds.filter(s => s.prompt_index === promptIndex);

    if (variants.length > 0) {
      const selectedVariantIdx = selectedVariants?.[promptIndex] ?? 0;
      const generatedSound = variants[selectedVariantIdx] || variants[0];
      const isMuted = mutedSounds?.has(generatedSound.id) ?? false;

      return (
        <div className="flex flex-col bg-secondary rounded-lg p-2">
        <div className="pb-2 mb-1 text-xs font-sans flex-shrink-0">
          <span className="text-primary">Sound: </span>
          <span className="text-white">{selectedEntity.objectName}</span>
        </div>
          <div className="flex-1 overflow-hidden">
            <SoundResultContent
              generatedSound={generatedSound}
              index={promptIndex}
              variants={variants}
              selectedVariantIdx={selectedVariantIdx}
              isPreviewPlaying={localPreviewId === generatedSound.id}
              isMuted={isMuted}
              soundVolumes={soundVolumes ?? {}}
              soundIntervals={soundIntervals ?? {}}
              onPreviewPlayPause={handleLocalPlayPause}
              onPreviewStop={handleLocalStop}
              onVolumeChange={onVolumeChange}
              onIntervalChange={onIntervalChange}
              onVariantChange={onVariantChange}
            />
          </div>
        </div>
      );
    }
  }

  // ===== DEFAULT: ENTITY INFORMATION MODE =====

  // If no entity selected, show placeholder
  if (!selectedEntity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: 'var(--color-secondary-hover)' }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
        <p className="text-sm" style={{ color: 'var(--color-secondary-hover)' }}>
          Click on an object in the 3D view to see its details
        </p>
      </div>
    );
  }

  // Get current state for this object (re-query on linkVersion change)
  const { isLinked, isDiverse, linkedSoundIndex } = getObjectLinkState(selectedEntity.objectId);

  // Link button config
  const getLinkButtonConfig = () => {
    if (isLinked) {
      return {
        color: 'var(--color-primary)',
        hoverColor: 'var(--color-primary)',
        title: `Linked to Sound #${linkedSoundIndex! + 1} (unlink from Sound tab)`,
        action: () => {}
      };
    } else if (isDiverse) {
      return {
        color: 'var(--color-success)',
        hoverColor: 'var(--color-primary-hover)',
        title: 'Remove from diverse selection',
        action: () => removeFromDiverseSelection(selectedEntity.objectId)
      };
    } else {
      return {
        color: 'var(--color-secondary-hover)',
        hoverColor: 'var(--color-secondary)',
        title: 'Add to diverse selection',
        action: () => addToDiverseSelection(selectedEntity.objectId)
      };
    }
  };

  const linkButtonConfig = getLinkButtonConfig();

  return (
    <div className="h-full flex flex-col">
      {/* Entity Title with action button */}
      <div
        className="my-2 pb-0 mb-0 text-sm text-info font-semibold flex items-center justify-between flex-shrink-0"
      >
        <span>Entity Information</span>

        {/* Link button - toggles diverse selection */}
        <button
          onClick={linkButtonConfig.action}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = `${linkButtonConfig.hoverColor}20`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          disabled={isLinked}
          className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: linkButtonConfig.color,
            opacity: isLinked ? 0.6 : 1,
            cursor: isLinked ? 'not-allowed' : 'pointer'
          }}
          title={linkButtonConfig.title}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        </button>
      </div>

      {/* Entity Details */}
      <div className="space-y-1 text-xs flex-1">
        <div className="flex text-secondary">
          <span>Type:</span>
          <span className="mx-2">{selectedEntity.objectType}</span>
        </div>

        {selectedEntity.objectName && (
          <div className="flex text-secondary">
            <span>Name:</span>
            <span
              className="text-right mx-2 max-w-[180px] truncate"
              title={selectedEntity.objectName}
            >
              {selectedEntity.objectName}
            </span>
          </div>
        )}

        {selectedEntity.parentName && (
          <div className="flex text-secondary">
            <span>Parent:</span>
            <span
              className="text mx-2 max-w-[180px] truncate"
              title={selectedEntity.parentName}
            >
              {selectedEntity.parentName}
            </span>
          </div>
        )}

        {selectedEntity.objectId && (
          <div className="flex text-secondary">
            <span>Object ID:</span>
            <span
              className="text-right mx-2 max-w-[160px] truncate"
              title={selectedEntity.objectId}
            >
              {selectedEntity.objectId}
            </span>
          </div>
        )}

        {/* Linked Sound Information */}
        {isLinked && linkedSoundIndex !== undefined && (
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid var(--color-secondary-light)` }}>
            <div className="flex justify-between items-center">
              <span>Linked to:</span>
              <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                Sound #{linkedSoundIndex + 1}
              </span>
            </div>
          </div>
        )}

        {/* Diverse Selection Information */}
        {isDiverse && !isLinked && (
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid var(--color-secondary-light)` }}>
            <div className="flex justify-between items-center">
              <span>Status:</span>
              <span className="font-medium" style={{ color: 'var(--color-success)' }}>
                Diverse Selection
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

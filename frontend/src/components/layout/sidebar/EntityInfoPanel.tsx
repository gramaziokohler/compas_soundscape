'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { UI_BORDER_RADIUS, PYROOMACOUSTICS_DEFAULT_SCATTERING, PYROOMACOUSTICS_SCATTERING_MIN, PYROOMACOUSTICS_SCATTERING_MAX } from '@/utils/constants';
import { getMaterialColorByAbsorption, getAnalysisGroupColor } from '@/utils/utils';
import { useSpeckleStore, getAnalysisResultGroups } from '@/store';
import { useAcousticMaterialStore } from '@/store';
import { useAudioControlsStore } from '@/store';
import { useAnalysisStore } from '@/store';
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
      <div className="flex flex-col gap-2 text-xs">
        {/* ID row + go-to button */}
        <div className="flex items-center justify-between text-secondary">
          <div className="flex items-center gap-1 min-w-0">
            <span className="flex-shrink-0">ID:</span>
            <span className="mx-1 truncate" title={selectedEntity.objectId}>
              {selectedEntity.objectId}
            </span>
          </div>
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
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded transition-colors"
              style={{ color: receiverColor, borderRadius: '6px' }}
              title="Go to receiver (first-person view)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
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

  return (
    <div className="h-full flex flex-col">

      {/* Analysis Group Information */}
      <AnalysisGroupSection objectId={selectedEntity.objectId} />              

      {/* Entity Details */}
      <div className="space-y-1 text-xs flex-1 overflow-y-auto">
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
      </div>
    </div>
  );
}

// ─── AnalysisGroupSection ─────────────────────────────────────────────────────

/**
 * Inline component shown in EntityInfoPanel when the selected object belongs
 * to a model-analysis group. Supports inline editing of name/description/material.
 */
function AnalysisGroupSection({ objectId }: { objectId: string }) {
  // Subscribe to analysisObjectGroups for reactivity when groups change
  const analysisObjectGroups = useSpeckleStore((s) => s.analysisObjectGroups);

  const matchedGroup = useMemo(() => {
    const groups = getAnalysisResultGroups();
    const idx = groups.findIndex((g) => g.object_ids != null && objectId in g.object_ids);
    if (idx === -1) return null;
    return { group: groups[idx], index: idx };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, analysisObjectGroups]);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!matchedGroup) return null;

  const { group, index } = matchedGroup;
  const color = getAnalysisGroupColor(index);
  const confPct = Math.round((group.confidence ?? 0) * 100);
  const confColor =
    (group.confidence ?? 0) >= 0.7
      ? 'var(--color-success, #4ade80)'
      : (group.confidence ?? 0) >= 0.5
        ? 'var(--color-warning, #fbbf24)'
        : 'var(--color-error, #f87171)';

  const handleEditStart = () => {
    setEditName(group.name);
    setEditDescription(group.description ?? '');
    setEditMaterial(group.material ?? '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    // Find configIndex by searching analysisConfigs for a model-analysis config with this group
    const { analysisConfigs, handleUpdateAnalysisObject } = useAnalysisStore.getState();
    const configIdx = analysisConfigs.findIndex(
      (c) =>
        c.type === 'model-analysis' &&
        (c as any).analysisResult?.architecturalObjects?.[index] !== undefined,
    );
    if (configIdx === -1) return;
    setIsSaving(true);
    try {
      await handleUpdateAnalysisObject(configIdx, index, {
        name: editName,
        description: editDescription,
        material: editMaterial,
      });
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  return (
    <div
      className="pt-2 mt-2 space-y-1"
      style={{ borderTop: `1px solid var(--color-secondary-light)`, borderLeft: `3px solid ${color}`, paddingLeft: 8 }}
    >
      {!isEditing ? (
        <>
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
              Analysis Group
            </span>
            <button
              onClick={handleEditStart}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-secondary-hover opacity-80 hover:opacity-100 hover:bg-secondary-light hover:text-foreground transition-all cursor-pointer"
              style={{ color: 'var(--color-secondary-hover)', cursor: 'pointer' }}
              title="Edit group info"
            >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
            </svg>
            </button>
          </div>
          <div
            className="flex items-center gap-1.5 flex-wrap"
            title={group.description || undefined}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-foreground)' }}>
              {group.name}
            </span>
            <span
              className="text-xs px-1 rounded ml-auto"
              style={{ backgroundColor: 'var(--color-secondary-light)', color: confColor }}
            >
              {confPct}%
            </span>
          </div>
          {group.description && (
            <p className="text-xs leading-tight" style={{ color: 'var(--color-secondary-hover)' }}>
              {group.description}
            </p>
          )}
          {group.material && (
            <span
              className="inline-block text-xs px-1 rounded"
              style={{ backgroundColor: 'var(--color-secondary-light)', color: 'var(--color-secondary-hover)' }}
            >
              {group.material}
            </span>
          )}
        </>
      ) : (
        <>
          <div className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
            Edit Group
          </div>
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Material"
            value={editMaterial}
            onChange={(e) => setEditMaterial(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 text-xs py-1 rounded"
              style={{
                backgroundColor: 'var(--color-success)',
                color: 'var(--color-background)',
                opacity: isSaving ? 0.6 : 1,
                cursor: isSaving ? 'wait' : 'pointer',
              }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 text-xs py-1 rounded"
              style={{
                backgroundColor: 'var(--color-secondary-lighter)',
                color: 'var(--color-secondary-hover)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}


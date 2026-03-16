'use client';

import { useMemo, useState, useCallback } from 'react';
import { UI_COLORS, UI_BORDER_RADIUS, SPECKLE_FILTER_COLORS, RECEIVER_CONFIG, getMaterialColorByAbsorption, PYROOMACOUSTICS_DEFAULT_SCATTERING, PYROOMACOUSTICS_SCATTERING_MIN, PYROOMACOUSTICS_SCATTERING_MAX } from '@/utils/constants';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { useAcousticMaterial } from '@/contexts/AcousticMaterialContext';
import { RangeSlider } from '@/components/ui/RangeSlider';
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
  // Sound props for Sound mode
  generatedSounds?: SoundEvent[];
  selectedVariants?: { [key: number]: number };
  soundVolumes?: { [soundId: string]: number };
  soundIntervals?: { [soundId: string]: number };
  mutedSounds?: Set<string>;
  previewingSoundId?: string | null;
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
}

export function EntityInfoPanel({
  onGoToReceiver,
  generatedSounds,
  selectedVariants,
  soundVolumes,
  soundIntervals,
  mutedSounds,
  previewingSoundId,
  onPreviewPlayPause,
  onPreviewStop,
  onVolumeChange,
  onIntervalChange,
  onVariantChange,
}: EntityInfoPanelProps) {
  const {
    selectedEntity,
    linkVersion,
    getObjectLinkState,
    addToDiverseSelection,
    removeFromDiverseSelection
  } = useSpeckleSelectionMode();

  const { isActive, version, getMaterialState } = useAcousticMaterial();

  // Local independent playback state for the EntityInfoPanel sound player
  const [localPreviewId, setLocalPreviewId] = useState<string | null>(null);

  const handleLocalPlayPause = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : soundId);
  }, []);

  const handleLocalStop = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : prev);
  }, []);

  // Pull material state (re-evaluated when version changes)
  const materialState = isActive ? getMaterialState() : null;

  // Sort materials by absorption for dropdown display
  const sortedMaterials = useMemo(() => {
    if (!materialState) return [];
    return [...materialState.availableMaterials]
      .filter(mat => typeof mat.absorption === 'number' && !isNaN(mat.absorption))
      .sort((a, b) => a.absorption - b.absorption);
  }, [materialState?.availableMaterials, version]);

  // Material color map for dropdown backgrounds
  const materialColors = useMemo(() => {
    if (!materialState) return new Map<string, string>();
    const colors = new Map<string, string>();
    materialState.availableMaterials.forEach((mat) => {
      colors.set(mat.id, getMaterialColorByAbsorption(mat.absorption));
    });
    return colors;
  }, [materialState?.availableMaterials, version]);

  // Compute "All Objects" material info
  const allObjectsInfo = useMemo(() => {
    if (!materialState) return null;
    const allIds = collectAllObjectIds(materialState.meshObjects);
    const totalGeometry = allIds.length;
    const uniqueMaterials = new Set(
      allIds.map(id => materialState.materialAssignments.get(id)).filter(Boolean)
    );
    const commonMaterialId = uniqueMaterials.size === 1 ? Array.from(uniqueMaterials)[0]! : null;
    const assignedCount = materialState.materialAssignments.size;
    const unassignedCount = totalGeometry - assignedCount;
    return { totalGeometry, commonMaterialId, uniqueMaterials, assignedCount, unassignedCount };
  }, [materialState, version]);

  // Check if the selected entity is in the mesh tree
  const selectedObjectInTree = useMemo(() => {
    if (!materialState || !selectedEntity?.objectId) return null;
    return findObjectInMeshTree(materialState.meshObjects, selectedEntity.objectId);
  }, [materialState, selectedEntity?.objectId, version]);

  // Current material for the selected object (single geometry)
  const selectedObjectMaterialId = useMemo(() => {
    if (!materialState || !selectedEntity?.objectId) return null;
    return materialState.materialAssignments.get(selectedEntity.objectId) || null;
  }, [materialState, selectedEntity?.objectId, version]);

  // Geometry IDs under the selected node (all descendants when it's a group/layer)
  const selectedGeometryIds = useMemo(() => {
    if (!selectedObjectInTree) return [];
    return collectGeometryIdsFromNode(selectedObjectInTree);
  }, [selectedObjectInTree, version]);

  // Whether the selected node is a group/layer (not a single geometry object)
  const isGroupSelection = selectedObjectInTree !== null && !selectedObjectInTree.hasGeometry;

  // Scattering value for "All Objects" slider — common value or default
  const allObjectsScattering = useMemo(() => {
    if (!materialState) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    const allIds = collectAllObjectIds(materialState.meshObjects);
    if (allIds.length === 0) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    const values = allIds.map(id => materialState.scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
    const unique = new Set(values);
    return unique.size === 1 ? values[0] : PYROOMACOUSTICS_DEFAULT_SCATTERING;
  }, [materialState, version]);

  // Scattering value for selected object/group slider
  const selectedObjectScattering = useMemo(() => {
    if (!materialState) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    if (isGroupSelection && selectedGeometryIds.length > 0) {
      const values = selectedGeometryIds.map(id => materialState.scatteringAssignments.get(id) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING);
      const unique = new Set(values);
      return unique.size === 1 ? values[0] : PYROOMACOUSTICS_DEFAULT_SCATTERING;
    }
    if (!selectedEntity?.objectId) return PYROOMACOUSTICS_DEFAULT_SCATTERING;
    return materialState.scatteringAssignments.get(selectedEntity.objectId) ?? PYROOMACOUSTICS_DEFAULT_SCATTERING;
  }, [materialState, selectedEntity?.objectId, selectedGeometryIds, isGroupSelection, version]);

  // Assignment info for group selections: common material and mixed state
  const selectedGroupAssignmentInfo = useMemo(() => {
    if (!materialState || selectedGeometryIds.length === 0) return null;
    const assignedMaterials = new Set(
      selectedGeometryIds
        .map(id => materialState.materialAssignments.get(id))
        .filter(Boolean) as string[]
    );
    const commonMaterialId = assignedMaterials.size === 1 ? Array.from(assignedMaterials)[0] : null;
    return { uniqueAssigned: assignedMaterials, commonMaterialId };
  }, [materialState, selectedGeometryIds, version]);

  // Background color helper
  const getSelectBg = (materialId: string | null): string => {
    if (!materialId) return UI_COLORS.PRIMARY;
    return materialColors.get(materialId) || UI_COLORS.PRIMARY;
  };

  // ===== MATERIAL ASSIGNMENT MODE =====
  if (materialState && allObjectsInfo) {
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
            <select
              value={allObjectsInfo.commonMaterialId || ''}
              onChange={(e) => {
                materialState.assignMaterialToAll(e.target.value);
              }}
              className="text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
              style={{
                backgroundColor: getSelectBg(allObjectsInfo.commonMaterialId),
                borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                maxWidth: '140px',
                minWidth: '100px',
                opacity: allObjectsInfo.uniqueMaterials.size > 1 ? 0.7 : 1
              }}
            >
              <option value="" style={{ backgroundColor: UI_COLORS.PRIMARY }}>
                {allObjectsInfo.uniqueMaterials.size > 1 ? '(mixed)' : 'Select...'}
              </option>
              {sortedMaterials.map(material => (
                <option
                  key={material.id}
                  value={material.id}
                  style={{ backgroundColor: materialColors.get(material.id) }}
                >
                  {material.name} ({(material.absorption * 100).toFixed(0)}%)
                </option>
              ))}
            </select>
          </div>

          {/* Per-object / per-group dropdown OR hint text */}
          {selectedObjectInTree && selectedGeometryIds.length > 0 ? (() => {
            const isMixed = isGroupSelection
              ? (selectedGroupAssignmentInfo?.uniqueAssigned.size ?? 0) > 1
              : false;
            const effectiveMaterialId = isGroupSelection
              ? selectedGroupAssignmentInfo?.commonMaterialId ?? null
              : selectedObjectMaterialId;
            const label = isGroupSelection
              ? `Selected (${selectedGeometryIds.length})`
              : 'Selected surface';

            return (
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-xs truncate"
                  style={{ color: UI_COLORS.NEUTRAL_500, maxWidth: '120px' }}
                  title={selectedObjectInTree.name}
                >
                  {label}
                </span>
                <select
                  value={effectiveMaterialId || ''}
                  onChange={(e) => {
                    if (isGroupSelection) {
                      materialState.assignMaterialToObjects(selectedGeometryIds, e.target.value);
                    } else if (selectedEntity) {
                      materialState.assignMaterial(selectedEntity.objectId, e.target.value);
                    }
                  }}
                  className="text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
                  style={{
                    backgroundColor: getSelectBg(effectiveMaterialId),
                    borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                    maxWidth: '140px',
                    minWidth: '100px',
                    opacity: isMixed ? 0.7 : 1
                  }}
                >
                  <option value="" style={{ backgroundColor: UI_COLORS.PRIMARY }}>
                    {isMixed ? '(mixed)' : 'Select...'}
                  </option>
                  {sortedMaterials.map(material => (
                    <option
                      key={material.id}
                      value={material.id}
                      style={{ backgroundColor: materialColors.get(material.id) }}
                    >
                      {material.name} ({(material.absorption * 100).toFixed(0)}%)
                    </option>
                  ))}
                </select>
              </div>
            );
          })() : (
            <p className="text-xs" style={{ color: UI_COLORS.NEUTRAL_500, fontStyle: 'italic' }}>
              Select a surface in the viewer to assign material
            </p>
          )}

          {/* Scattering (per-object, same workflow as material) */}
          {selectedObjectInTree && selectedGeometryIds.length > 0 ? (
            <RangeSlider
              label={isGroupSelection ? `Scattering (${selectedGeometryIds.length}): ` : 'Scattering: '}
              value={selectedObjectScattering}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step={0.01}
              onChange={(value) => {
                if (isGroupSelection) {
                  materialState.assignScatteringToObjects(selectedGeometryIds, value);
                } else if (selectedEntity) {
                  materialState.assignScattering(selectedEntity.objectId, value);
                }
              }}
              defaultValue={PYROOMACOUSTICS_DEFAULT_SCATTERING}
              showLabels={false}
              formatValue={(v) => v.toFixed(2)}
              hoverText="Scattering coefficient for selected surface(s) (double-click to reset)"
            />
          ) : (
            <RangeSlider
              label="Scattering (all): "
              value={allObjectsScattering}
              min={PYROOMACOUSTICS_SCATTERING_MIN}
              max={PYROOMACOUSTICS_SCATTERING_MAX}
              step={0.01}
              onChange={(value) => materialState.assignScatteringToAll(value)}
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
                color: UI_COLORS.WARNING,
                backgroundColor: UI_COLORS.WARNING_LIGHT,
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
                color: UI_COLORS.SUCCESS,
                backgroundColor: `${UI_COLORS.SUCCESS}10`,
                borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                border: `1px solid ${UI_COLORS.SUCCESS}40`
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
    const receiverColor = `#${RECEIVER_CONFIG.COLOR.toString(16).padStart(6, '0')}`;
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
          style={{ color: UI_COLORS.NEUTRAL_500 }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
        <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>
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
        color: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        hoverColor: SPECKLE_FILTER_COLORS.SOUND_LINKED,
        title: `Linked to Sound #${linkedSoundIndex! + 1} (unlink from Sound tab)`,
        action: () => {}
      };
    } else if (isDiverse) {
      return {
        color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION,
        hoverColor: UI_COLORS.PRIMARY_HOVER,
        title: 'Remove from diverse selection',
        action: () => removeFromDiverseSelection(selectedEntity.objectId)
      };
    } else {
      return {
        color: UI_COLORS.NEUTRAL_500,
        hoverColor: UI_COLORS.NEUTRAL_600,
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
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_COLORS.NEUTRAL_200}` }}>
            <div className="flex justify-between items-center">
              <span>Linked to:</span>
              <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.SOUND_LINKED }}>
                Sound #{linkedSoundIndex + 1}
              </span>
            </div>
          </div>
        )}

        {/* Diverse Selection Information */}
        {isDiverse && !isLinked && (
          <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${UI_COLORS.NEUTRAL_200}` }}>
            <div className="flex justify-between items-center">
              <span>Status:</span>
              <span className="font-medium" style={{ color: SPECKLE_FILTER_COLORS.DIVERSE_SELECTION }}>
                Diverse Selection
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

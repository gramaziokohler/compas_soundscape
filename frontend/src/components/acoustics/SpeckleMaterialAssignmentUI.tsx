/**
 * SpeckleMaterialAssignmentUI Component
 *
 * Material assignment UI for Speckle objects in acoustic simulations.
 * Displays layer selector, hierarchical tree of mesh objects, and material dropdown per node.
 * Cascading: assigning material to parent cascades to all children.
 */

'use client';

import { useState, useCallback, useMemo } from 'react';
import { UI_COLORS, UI_BORDER_RADIUS, getMaterialColorByAbsorption } from '@/lib/constants';
import type { SpeckleLayerInfo } from '@/types/speckle-materials';
import type { AcousticMaterial } from '@/types/materials';
import type { HierarchicalMeshObject } from '@/hooks/useSpeckleSurfaceMaterials';

interface SpeckleMaterialAssignmentUIProps {
  layerOptions: SpeckleLayerInfo[];
  selectedLayerId: string | null;
  meshObjects: HierarchicalMeshObject[];
  materialAssignments: Map<string, string>; // objectId -> materialId
  availableMaterials: AcousticMaterial[];
  onSelectLayer: (layerId: string) => void;
  onAssignMaterial: (objectId: string, materialId: string) => void;
  getMaterialColor: (materialId: string) => string;
}

export function SpeckleMaterialAssignmentUI({
  layerOptions,
  selectedLayerId,
  meshObjects,
  materialAssignments,
  availableMaterials,
  onSelectLayer,
  onAssignMaterial,
  getMaterialColor
}: SpeckleMaterialAssignmentUIProps) {
  // Track expanded nodes
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));

  // Sort materials by absorption coefficient (low to high)
  const sortedMaterials = useMemo(() => {
    return [...availableMaterials]
      .filter(mat => typeof mat.absorption === 'number' && !isNaN(mat.absorption))
      .sort((a, b) => a.absorption - b.absorption);
  }, [availableMaterials]);

  // Generate material colors map based on absorption coefficient
  const materialColors = useMemo(() => {
    const colors = new Map<string, string>();
    availableMaterials.forEach((mat) => {
      // Use absorption coefficient to determine color position in gradient
      colors.set(mat.id, getMaterialColorByAbsorption(mat.absorption));
    });
    return colors;
  }, [availableMaterials]);

  // Toggle node expansion
  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // Get all descendant object IDs (for cascading)
  const getAllDescendantIds = useCallback((obj: HierarchicalMeshObject): string[] => {
    const ids: string[] = [];
    if (obj.hasGeometry) {
      ids.push(obj.id);
    }
    for (const child of obj.children) {
      ids.push(...getAllDescendantIds(child));
    }
    return ids;
  }, []);

  // Get inherited material for an object (check ancestors)
  const getInheritedMaterial = useCallback((objectId: string, ancestors: string[]): string | null => {
    // Check direct assignment first
    const directMaterial = materialAssignments.get(objectId);
    if (directMaterial) return directMaterial;

    // Check ancestors from closest to furthest
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestorMaterial = materialAssignments.get(ancestors[i]);
      if (ancestorMaterial) return ancestorMaterial;
    }

    return null;
  }, [materialAssignments]);

  // Handle material change with cascading
  const handleMaterialChange = useCallback((obj: HierarchicalMeshObject, materialId: string) => {
    // Assign to this object
    onAssignMaterial(obj.id, materialId);

    // Cascade: assign to all descendants
    const descendantIds = getAllDescendantIds(obj);
    for (const id of descendantIds) {
      if (id !== obj.id) {
        onAssignMaterial(id, materialId);
      }
    }
  }, [onAssignMaterial, getAllDescendantIds]);

  // Get background color for select based on material
  const getSelectBackgroundColor = useCallback((materialId: string | null): string => {
    if (!materialId) return UI_COLORS.PRIMARY;
    return materialColors.get(materialId) || UI_COLORS.PRIMARY;
  }, [materialColors]);

  /**
   * Render a tree node recursively
   */
  const renderTreeNode = useCallback((
    obj: HierarchicalMeshObject,
    indent: number,
    ancestors: string[]
  ): React.ReactNode => {
    const hasChildren = obj.children.length > 0;
    const isExpanded = expandedNodes.has(obj.id);
    const currentAncestors = [...ancestors, obj.id];

    // Get effective material (direct or inherited)
    const effectiveMaterialId = getInheritedMaterial(obj.id, ancestors);
    const directMaterialId = materialAssignments.get(obj.id);

    // Determine if showing inherited value
    const isInherited = effectiveMaterialId && !directMaterialId;

    return (
      <div key={obj.id} className="flex flex-col">
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-neutral-700/50"
          style={{ paddingLeft: `${8 + indent * 16}px` }}
        >
          {/* Expand/collapse button */}
          {hasChildren ? (
            <button
              onClick={() => toggleExpand(obj.id)}
              className="flex items-center justify-center w-4 h-4 flex-shrink-0"
              style={{ color: UI_COLORS.NEUTRAL_400 }}
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="w-4 h-4 flex-shrink-0" />
          )}

          {/* Geometry indicator */}
          {obj.hasGeometry && (
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: effectiveMaterialId ? getSelectBackgroundColor(effectiveMaterialId) : UI_COLORS.NEUTRAL_500 }}
              title="Has geometry"
            />
          )}

          {/* Object name */}
          <span
            className="flex-1 text-xs truncate"
            style={{ color: UI_COLORS.NEUTRAL_100 }}
            title={`${obj.name} (${obj.speckle_type})`}
          >
            {obj.name}
            {obj.children.length > 0 && !obj.hasGeometry && (
              <span style={{ color: UI_COLORS.NEUTRAL_500 }}> ({obj.children.length})</span>
            )}
          </span>

          {/* Material dropdown */}
          <select
            value={effectiveMaterialId || ''}
            onChange={(e) => handleMaterialChange(obj, e.target.value)}
            className="text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
            style={{
              backgroundColor: getSelectBackgroundColor(effectiveMaterialId),
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
              maxWidth: '130px',
              minWidth: '100px',
              opacity: isInherited ? 0.7 : 1
            }}
            title={isInherited ? 'Inherited from parent' : undefined}
          >
            <option value="" style={{ backgroundColor: UI_COLORS.PRIMARY }}>
              {isInherited ? '(inherited)' : 'Select...'}
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

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="flex flex-col">
            {obj.children.map(child => renderTreeNode(child, indent + 1, currentAncestors))}
          </div>
        )}
      </div>
    );
  }, [expandedNodes, materialAssignments, availableMaterials, materialColors, toggleExpand, getInheritedMaterial, handleMaterialChange, getSelectBackgroundColor]);

  /**
   * Render layer selector dropdown
   */
  const renderLayerSelector = () => {
    if (layerOptions.length === 0) {
      return (
        <div
          className="px-3 py-2 text-xs"
          style={{
            color: UI_COLORS.NEUTRAL_500,
            fontStyle: 'italic'
          }}
        >
          No layers with mesh objects found
        </div>
      );
    }

    // Auto-selected "Acoustics" layer message
    const acousticsLayer = layerOptions.find(l => l.name.toLowerCase() === 'acoustics');
    const showAutoSelectedNote = acousticsLayer && selectedLayerId === acousticsLayer.id;

    return (
      <div className="flex flex-col gap-2">
        {showAutoSelectedNote && (
          <div
            className="px-2 py-1 text-xs"
            style={{
              color: UI_COLORS.SUCCESS,
              backgroundColor: `${UI_COLORS.SUCCESS}20`,
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
              border: `1px solid ${UI_COLORS.SUCCESS}40`
            }}
          >
            ✓ Auto-selected "Acoustics" layer
          </div>
        )}

        <select
          value={selectedLayerId || ''}
          onChange={(e) => onSelectLayer(e.target.value)}
          className="w-full px-3 py-2 text-sm"
          style={{
            backgroundColor: UI_COLORS.NEUTRAL_800,
            color: UI_COLORS.NEUTRAL_100,
            border: `1px solid ${UI_COLORS.NEUTRAL_700}`,
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            cursor: 'pointer'
          }}
        >
          {layerOptions.map(layer => (
            <option key={layer.id} value={layer.id}>
              {layer.name} ({layer.meshCount} objects)
            </option>
          ))}
        </select>
      </div>
    );
  };

  /**
   * Render mesh objects tree
   */
  const renderMeshObjectsTree = () => {
    if (meshObjects.length === 0) {
      return (
        <div
          className="px-3 py-2 text-xs text-center"
          style={{
            color: UI_COLORS.NEUTRAL_500,
            fontStyle: 'italic'
          }}
        >
          No mesh objects in this layer
        </div>
      );
    }

    // Count total geometry objects
    const countGeometry = (objs: HierarchicalMeshObject[]): number => {
      let count = 0;
      for (const obj of objs) {
        if (obj.hasGeometry) count++;
        count += countGeometry(obj.children);
      }
      return count;
    };
    const totalGeometry = countGeometry(meshObjects);
    const assignedCount = materialAssignments.size;

    // Determine the common material for all objects
    const getAllObjectIds = (objs: HierarchicalMeshObject[]): string[] => {
      const ids: string[] = [];
      for (const obj of objs) {
        if (obj.hasGeometry) ids.push(obj.id);
        ids.push(...getAllObjectIds(obj.children));
      }
      return ids;
    };
    const allObjectIds = getAllObjectIds(meshObjects);
    const uniqueMaterials = new Set(allObjectIds.map(id => materialAssignments.get(id)).filter(Boolean));
    const commonMaterialId = uniqueMaterials.size === 1 ? Array.from(uniqueMaterials)[0] : null;

    return (
      <div className="flex flex-col gap-2">
        {/* Root level with "All Objects" */}
        <div className="flex flex-col">
          <div
            className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-neutral-700/50"
          >
            {/* Expand/collapse button */}
            <button
              onClick={() => toggleExpand('root')}
              className="flex items-center justify-center w-4 h-4 flex-shrink-0"
              style={{ color: UI_COLORS.NEUTRAL_400 }}
            >
              {expandedNodes.has('root') ? '▼' : '▶'}
            </button>

            {/* Label */}
            <span
              className="flex-1 text-xs font-medium"
              style={{ color: UI_COLORS.NEUTRAL_100 }}
            >
              All Objects ({totalGeometry})
            </span>

            {/* Material dropdown for all objects */}
            <select
              value={commonMaterialId || ''}
              onChange={(e) => {
                const materialId = e.target.value;
                if (materialId) {
                  // Assign to all root-level objects (which will cascade to all children)
                  meshObjects.forEach(obj => handleMaterialChange(obj, materialId));
                }
              }}
              className="text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
              style={{
                backgroundColor: getSelectBackgroundColor(commonMaterialId || null),
                borderRadius: `${UI_BORDER_RADIUS.SM}px`,
                maxWidth: '130px',
                minWidth: '100px',
                opacity: uniqueMaterials.size > 1 ? 0.7 : 1
              }}
            >
              <option value="" style={{ backgroundColor: UI_COLORS.PRIMARY }}>
                {uniqueMaterials.size > 1 ? '(mixed)' : 'Select...'}
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

          {/* Tree content */}
          {expandedNodes.has('root') && (
            <div
              className="flex flex-col overflow-y-auto"
              style={{ maxHeight: '350px' }}
            >
              {meshObjects.map(obj => renderTreeNode(obj, 0, []))}
            </div>
          )}
        </div>

        {/* Summary */}
        {assignedCount > 0 && (
          <div
            className="px-2 py-1 text-xs text-center"
            style={{
              color: UI_COLORS.SUCCESS,
              backgroundColor: `${UI_COLORS.SUCCESS}10`,
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
              border: `1px solid ${UI_COLORS.SUCCESS}40`
            }}
          >
            {assignedCount} object{assignedCount !== 1 ? 's' : ''} assigned
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{
        backgroundColor: UI_COLORS.NEUTRAL_900,
        borderRadius: `${UI_BORDER_RADIUS.MD}px`,
        border: `1px solid ${UI_COLORS.NEUTRAL_800}`
      }}
    >
      {/* Layer selector */}
      <div className="flex flex-col gap-2">
        <h5
          className="text-xs font-semibold"
          style={{ color: UI_COLORS.NEUTRAL_300 }}
        >
          Acoustic Layer
        </h5>
        {renderLayerSelector()}
      </div>

      {/* Mesh objects tree */}
      {selectedLayerId && (
        <div className="flex flex-col gap-2">
          <h5
            className="text-xs font-semibold"
            style={{ color: UI_COLORS.NEUTRAL_300 }}
          >
            Objects
          </h5>
          {renderMeshObjectsTree()}
        </div>
      )}
    </div>
  );
}

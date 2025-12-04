'use client';

import { useState, useMemo, useEffect } from 'react';
import { UI_COLORS } from '@/lib/constants';
import type { EntityData } from '@/types';
import type { AcousticMaterial, SelectedGeometry } from '@/types/materials';

/**
 * MaterialAssignmentUI Component
 * 
 * Displays hierarchical tree of geometry elements (layers, entities, faces)
 * with material assignment dropdowns. Handles different model types:
 * - 3dm: Layer > Entity > Faces
 * - obj: Group > Entity > Faces
 * - ifc: Entity > Faces
 */

// Helper function to generate gradient colors for materials
export function generateMaterialColor(index: number, total: number): string {
  if (total <= 1) return UI_COLORS.MATERIAL_GRADIENT_START;
  
  const ratio = index / (total - 1);
  
  // Parse start and end colors
  const start = UI_COLORS.MATERIAL_GRADIENT_START.replace('#', '');
  const end = UI_COLORS.MATERIAL_GRADIENT_END.replace('#', '');
  
  const r1 = parseInt(start.substring(0, 2), 16);
  const g1 = parseInt(start.substring(2, 4), 16);
  const b1 = parseInt(start.substring(4, 6), 16);
  
  const r2 = parseInt(end.substring(0, 2), 16);
  const g2 = parseInt(end.substring(2, 4), 16);
  const b2 = parseInt(end.substring(4, 6), 16);
  
  // Interpolate
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

interface MaterialAssignmentUIProps {
  modelEntities: EntityData[];
  modelType: '3dm' | 'obj' | 'ifc' | null;
  geometryData: any;
  selectedGeometry: SelectedGeometry | null;
  onSelectGeometry: (selection: SelectedGeometry | null) => void;
  onAssignMaterial: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  availableMaterials: AcousticMaterial[]; // Choras materials from library
}

export function MaterialAssignmentUI({
  modelEntities,
  modelType,
  geometryData,
  selectedGeometry,
  onSelectGeometry,
  onAssignMaterial,
  availableMaterials
}: MaterialAssignmentUIProps) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(['all']));
  const [materialAssignments, setMaterialAssignments] = useState<Map<string, AcousticMaterial | null>>(new Map());
  const [updateCounter, setUpdateCounter] = useState(0); // Force re-renders for cascading

  // Generate material colors map
  const materialColors = useMemo(() => {
    const colors = new Map<string, string>();
    availableMaterials.forEach((mat, index) => {
      colors.set(mat.id, generateMaterialColor(index, availableMaterials.length));
    });
    return colors;
  }, [availableMaterials]);

  // Group entities by layer/group
  const groupedEntities = useMemo(() => {
    if (!modelEntities || modelEntities.length === 0) return {};

    const groups: Record<string, EntityData[]> = {};

    modelEntities.forEach(entity => {
      const groupKey = entity.layer || 'Default';
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(entity);
    });

    return groups;
  }, [modelEntities]);

  // Get faces for an entity from geometryData
  const getEntityFaces = (entityIndex: number): number[] => {
    if (!geometryData?.face_entity_map) return [];

    const faceIndices: number[] = [];
    geometryData.face_entity_map.forEach((entIdx: number, faceIdx: number) => {
      if (entIdx === entityIndex) {
        faceIndices.push(faceIdx);
      }
    });

    return faceIndices;
  };

  // Auto-expand tree to show selected geometry
  useEffect(() => {
    if (!selectedGeometry) return;

    setExpandedItems(prev => {
      const newExpanded = new Set(prev);
      newExpanded.add('all'); // Always expand root

      if (selectedGeometry.type === 'face' || selectedGeometry.type === 'entity') {
        // Find the entity to get its layer
        const entity = modelEntities.find(e => e.index === selectedGeometry.entityIndex);
        if (entity) {
          const layerId = entity.layer || 'Default';
          newExpanded.add(`layer-${layerId}`); // Expand layer
          newExpanded.add(`entity-${entity.index}`); // Expand entity (fixed format)
        }
      } else if (selectedGeometry.type === 'layer' && selectedGeometry.layerId) {
        newExpanded.add(`layer-${selectedGeometry.layerId}`); // Expand layer
      }

      return newExpanded;
    });
  }, [selectedGeometry, modelEntities]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const handleSelectRow = (selection: SelectedGeometry) => {
    if (
      selectedGeometry &&
      selectedGeometry.type === selection.type &&
      selectedGeometry.faceIndex === selection.faceIndex &&
      selectedGeometry.entityIndex === selection.entityIndex &&
      selectedGeometry.layerId === selection.layerId
    ) {
      // Deselect if clicking the same item
      onSelectGeometry(null);
    } else {
      onSelectGeometry(selection);
    }
  };

  const handleMaterialChange = (selection: SelectedGeometry, materialId: string) => {
    const material = materialId === 'none' ? null : availableMaterials.find(m => m.id === materialId) || null;
    
    const newAssignments = new Map(materialAssignments);
    
    // Apply material to this level ONLY
    // Use ?? instead of || to handle 0 values correctly
    const key = `${selection.type}-${selection.layerId ?? ''}-${selection.entityIndex ?? ''}-${selection.faceIndex ?? ''}`;
    newAssignments.set(key, material);
    
    // CASCADE: Clear any explicit child assignments so they inherit from parent
    if (selection.type === 'global') {
      // Check if model has real layers or just grouped under 'Default'
      const hasRealLayers = Object.keys(groupedEntities).length > 1 || 
                            (Object.keys(groupedEntities).length === 1 && Object.keys(groupedEntities)[0] !== 'Default');
      
      if (hasRealLayers) {
        // Clear all layers, entities, and faces to inherit from global
        Object.keys(groupedEntities).forEach(layerName => {
          const layerKey = `layer-${layerName}--`;
          newAssignments.delete(layerKey);
          
          groupedEntities[layerName].forEach(entity => {
            const entityKey = `entity-${layerName}-${entity.index}-`;
            newAssignments.delete(entityKey);
            
            getEntityFaces(entity.index).forEach(faceIndex => {
              const faceKey = `face-${layerName}-${entity.index}-${faceIndex}`;
              newAssignments.delete(faceKey);
            });
          });
        });
      } else {
        // No real layers - entities are directly under global (no layerId)
        Object.values(groupedEntities).flat().forEach(entity => {
          const entityKey = `entity--${entity.index}-`;
          newAssignments.delete(entityKey);
          
          getEntityFaces(entity.index).forEach(faceIndex => {
            const faceKey = `face--${entity.index}-${faceIndex}`;
            newAssignments.delete(faceKey);
          });
        });
      }
    } else if (selection.type === 'layer' && selection.layerId) {
      // Clear all entities and faces in this layer to inherit from layer
      const entities = groupedEntities[selection.layerId] || [];
      entities.forEach(entity => {
        const entityKey = `entity-${selection.layerId}-${entity.index}-`;
        newAssignments.delete(entityKey);
        
        getEntityFaces(entity.index).forEach(faceIndex => {
          const faceKey = `face-${selection.layerId}-${entity.index}-${faceIndex}`;
          newAssignments.delete(faceKey);
        });
      });
    } else if (selection.type === 'entity' && selection.entityIndex !== undefined) {
      // Clear all faces in this entity to inherit from entity
      getEntityFaces(selection.entityIndex).forEach(faceIndex => {
        const faceKey = `face-${selection.layerId ?? ''}-${selection.entityIndex}-${faceIndex}`;
        newAssignments.delete(faceKey);
      });
    }
    
    // Force update by creating a new Map and incrementing counter for cascading
    const newCounter = updateCounter + 1;
    setMaterialAssignments(new Map(newAssignments));
    setUpdateCounter(newCounter);
    onAssignMaterial(selection, material);
  };

  // Helper to get the select background color based on selected material
  const getSelectBackgroundColor = (materialId: string | undefined): string => {
    if (!materialId || materialId === 'none') {
      return UI_COLORS.PRIMARY;
    }
    return materialColors.get(materialId) || UI_COLORS.PRIMARY;
  };

  const getMaterialForSelection = (selection: SelectedGeometry): AcousticMaterial | null => {
    // Use ?? instead of || to handle 0 values correctly
    const key = `${selection.type}-${selection.layerId ?? ''}-${selection.entityIndex ?? ''}-${selection.faceIndex ?? ''}`;
    const directMaterial = materialAssignments.get(key);
    
    // If there's a direct assignment, return it
    if (directMaterial !== undefined) {
      return directMaterial;
    }
    
    // Otherwise, inherit from parent hierarchy
    if (selection.type === 'face' && selection.entityIndex !== undefined) {
      // Check entity level
      const entityKey = `entity-${selection.layerId ?? ''}-${selection.entityIndex}-`;
      const entityMaterial = materialAssignments.get(entityKey);
      if (entityMaterial !== undefined) return entityMaterial;
      
      // Check layer level
      if (selection.layerId) {
        const layerKey = `layer-${selection.layerId}--`;
        const layerMaterial = materialAssignments.get(layerKey);
        if (layerMaterial !== undefined) return layerMaterial;
      }
    } else if (selection.type === 'entity' && selection.layerId) {
      // Check layer level
      const layerKey = `layer-${selection.layerId}--`;
      const layerMaterial = materialAssignments.get(layerKey);
      if (layerMaterial !== undefined) return layerMaterial;
    }
    
    // Check global level
    const globalKey = 'global---';
    const globalMaterial = materialAssignments.get(globalKey);
    if (globalMaterial !== undefined) return globalMaterial;
    
    return null;
  };

  const isSelected = (selection: SelectedGeometry): boolean => {
    if (!selectedGeometry) return false;
    return (
      selectedGeometry.type === selection.type &&
      selectedGeometry.faceIndex === selection.faceIndex &&
      selectedGeometry.entityIndex === selection.entityIndex &&
      selectedGeometry.layerId === selection.layerId
    );
  };

  if (!modelEntities || modelEntities.length === 0) {
    return (
      <div className="p-3 text-sm" style={{ color: UI_COLORS.NEUTRAL_500 }}>
        No geometry loaded. Upload a 3D model to assign materials.
      </div>
    );
  }

  const hasLayers = Object.keys(groupedEntities).length > 1 || 
                    (Object.keys(groupedEntities).length === 1 && Object.keys(groupedEntities)[0] !== 'Default');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 text-xs">
        {/* All Entities Root */}
        <div className="flex flex-col">
          <div
            className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
            style={{
              backgroundColor: isSelected({ type: 'global' }) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
            }}
            onClick={() => handleSelectRow({ type: 'global' })}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand('all');
              }}
              className="flex items-center justify-center w-4 h-4"
            >
              {expandedItems.has('all') ? '▼' : '▶'}
            </button>
            <span className="flex-1 font-medium">All Entities</span>
            <select
              key={`global-${updateCounter}`}
              value={getMaterialForSelection({ type: 'global' })?.id || 'none'}
              onChange={(e) => {
                e.stopPropagation();
                handleMaterialChange({ type: 'global' }, e.target.value);
              }}
              className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
              style={{
                backgroundColor: getSelectBackgroundColor(getMaterialForSelection({ type: 'global' })?.id),
                borderRadius: '8px',
                maxWidth: '150px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
              {availableMaterials.map((mat, idx) => (
                <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
              ))}
            </select>
          </div>

          {/* Layers/Groups or Direct Entities */}
          {expandedItems.has('all') && (
            <div className="ml-6 flex flex-col gap-1">
              {hasLayers ? (
                // Show layers/groups
                Object.entries(groupedEntities).map(([layerName, entities]) => {
                  const layerId = `layer-${layerName}`;
                  const layerSelection: SelectedGeometry = { type: 'layer', layerId: layerName };

                  return (
                    <div key={layerId} className="flex flex-col">
                      <div
                        className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
                        style={{
                          backgroundColor: isSelected(layerSelection) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
                        }}
                        onClick={() => handleSelectRow(layerSelection)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(layerId);
                          }}
                          className="flex items-center justify-center w-4 h-4"
                        >
                          {expandedItems.has(layerId) ? '▼' : '▶'}
                        </button>
                        <span className="flex-1">{modelType === '3dm' ? 'Layer' : 'Group'}: {layerName}</span>
                        <select
                          key={`layer-${layerName}-${updateCounter}`}
                          value={getMaterialForSelection(layerSelection)?.id || 'none'}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleMaterialChange(layerSelection, e.target.value);
                          }}
                          className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
                          style={{
                            backgroundColor: getSelectBackgroundColor(getMaterialForSelection(layerSelection)?.id),
                            borderRadius: '8px',
                            maxWidth: '150px'
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
                          {availableMaterials.map((mat, idx) => (
                            <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Entities in this layer */}
                      {expandedItems.has(layerId) && (
                        <div className="ml-6 flex flex-col gap-1">
                          {entities.map((entity) => {
                            const entityId = `entity-${entity.index}`;
                            const entitySelection: SelectedGeometry = { 
                              type: 'entity', 
                              entityIndex: entity.index, 
                              layerId: layerName 
                            };

                            return (
                              <div key={entityId} className="flex flex-col">
                                <div
                                  className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
                                  style={{
                                    backgroundColor: isSelected(entitySelection) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
                                  }}
                                  onClick={() => handleSelectRow(entitySelection)}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleExpand(entityId);
                                    }}
                                    className="flex items-center justify-center w-4 h-4"
                                  >
                                    {expandedItems.has(entityId) ? '▼' : '▶'}
                                  </button>
                                  <span className="flex-1">
                                    {entity.name || `Entity ${entity.index}`}
                                  </span>
                                  <select
                                    key={`entity-${layerName}-${entity.index}-${updateCounter}`}
                                    value={getMaterialForSelection(entitySelection)?.id || 'none'}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handleMaterialChange(entitySelection, e.target.value);
                                    }}
                                    className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
                                    style={{
                                      backgroundColor: getSelectBackgroundColor(getMaterialForSelection(entitySelection)?.id),
                                      borderRadius: '8px',
                                      maxWidth: '150px'
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
                                    {availableMaterials.map((mat, idx) => (
                                      <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Faces of this entity */}
                                {expandedItems.has(entityId) && (
                                  <div className="ml-6 flex flex-col gap-1">
                                    {getEntityFaces(entity.index).map((faceIndex) => {
                                      const faceSelection: SelectedGeometry = {
                                        type: 'face',
                                        faceIndex,
                                        entityIndex: entity.index,
                                        layerId: layerName
                                      };

                                      return (
                                        <div
                                          key={`face-${faceIndex}`}
                                          className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
                                          style={{
                                            backgroundColor: isSelected(faceSelection) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
                                          }}
                                          onClick={() => handleSelectRow(faceSelection)}
                                        >
                                          <span className="flex-1 ml-4">Face {faceIndex}</span>
                                          <select
                                            key={`face-${layerName}-${entity.index}-${faceIndex}-${updateCounter}`}
                                            value={getMaterialForSelection(faceSelection)?.id || 'none'}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              handleMaterialChange(faceSelection, e.target.value);
                                            }}
                                            className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
                                            style={{
                                              backgroundColor: getSelectBackgroundColor(getMaterialForSelection(faceSelection)?.id),
                                              borderRadius: '8px',
                                              maxWidth: '150px'
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
                                            {availableMaterials.map((mat, idx) => (
                                              <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
                                            ))}
                                          </select>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                // No layers - show entities directly
                modelEntities.map((entity) => {
                  const entityId = `entity-${entity.index}`;
                  const entitySelection: SelectedGeometry = { type: 'entity', entityIndex: entity.index };

                  return (
                    <div key={entityId} className="flex flex-col">
                      <div
                        className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
                        style={{
                          backgroundColor: isSelected(entitySelection) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
                        }}
                        onClick={() => handleSelectRow(entitySelection)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(entityId);
                          }}
                          className="flex items-center justify-center w-4 h-4"
                        >
                          {expandedItems.has(entityId) ? '▼' : '▶'}
                        </button>
                        <span className="flex-1">
                          {entity.name || `Entity ${entity.index}`}
                        </span>
                        <select
                          key={`entity-${entity.index}-${updateCounter}`}
                          value={getMaterialForSelection(entitySelection)?.id || 'none'}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleMaterialChange(entitySelection, e.target.value);
                          }}
                          className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
                          style={{
                            backgroundColor: getSelectBackgroundColor(getMaterialForSelection(entitySelection)?.id),
                            borderRadius: '8px',
                            maxWidth: '150px'
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
                          {availableMaterials.map((mat, idx) => (
                            <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Faces of this entity */}
                      {expandedItems.has(entityId) && (
                        <div className="ml-6 flex flex-col gap-1">
                          {getEntityFaces(entity.index).map((faceIndex) => {
                            const faceSelection: SelectedGeometry = {
                              type: 'face',
                              faceIndex,
                              entityIndex: entity.index
                            };

                            return (
                              <div
                                key={`face-${faceIndex}`}
                                className="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-neutral-100"
                                style={{
                                  backgroundColor: isSelected(faceSelection) ? UI_COLORS.PRIMARY_LIGHT : 'transparent'
                                }}
                                onClick={() => handleSelectRow(faceSelection)}
                              >
                                <span className="flex-1 ml-4">Face {faceIndex}</span>
                                <select
                                  key={`face-${entity.index}-${faceIndex}-${updateCounter}`}
                                  value={getMaterialForSelection(faceSelection)?.id || 'none'}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleMaterialChange(faceSelection, e.target.value);
                                  }}
                                  className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white truncate"
                                  style={{
                                    backgroundColor: getSelectBackgroundColor(getMaterialForSelection(faceSelection)?.id),
                                    borderRadius: '8px',
                                    maxWidth: '150px'
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>Select material</option>
                                  {availableMaterials.map((mat, idx) => (
                                    <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{mat.name}</option>
                                  ))}
                                </select>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

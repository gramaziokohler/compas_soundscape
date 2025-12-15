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

// Material Select Component for cleaner code
interface MaterialSelectProps {
  selection: SelectedGeometry;
  materialColors: Map<string, string>;
  availableMaterials: AcousticMaterial[];
  getMaterialForSelection: (sel: SelectedGeometry) => AcousticMaterial | null;
  getDisplayValue: (sel: SelectedGeometry) => { value: string; label: string; isVarious: boolean };
  getSelectBackgroundColor: (matId: string | undefined) => string;
  handleMaterialChange: (sel: SelectedGeometry, matId: string) => void;
  updateCounter: number;
}

function MaterialSelect({
  selection,
  materialColors,
  availableMaterials,
  getMaterialForSelection,
  getDisplayValue,
  getSelectBackgroundColor,
  handleMaterialChange,
  updateCounter
}: MaterialSelectProps) {
  const display = getDisplayValue(selection);
  const currentValue = display.isVarious ? 'various' : (display.value || 'none');

  // Use display.value for background color to show inherited material color
  const backgroundColor = display.isVarious
    ? UI_COLORS.NEUTRAL_400
    : getSelectBackgroundColor(display.value !== 'none' ? display.value : undefined);

  return (
    <select
      key={`${selection.type}-${selection.layerId}-${selection.entityIndex}-${selection.faceIndex}-${updateCounter}`}
      value={currentValue}
      onChange={(e) => {
        e.stopPropagation();
        if (e.target.value !== 'various') {
          handleMaterialChange(selection, e.target.value);
        }
      }}
      className="flex-1 text-xs px-2 py-1 text-white rounded focus:outline-none focus:ring-1 focus:ring-white"
      style={{
        backgroundColor,
        borderRadius: '8px',
        maxWidth: '150px'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {display.isVarious && (
        <option value="various" style={{ backgroundColor: UI_COLORS.NEUTRAL_400 }}>{display.label}</option>
      )}
      <option value="none" style={{ backgroundColor: UI_COLORS.PRIMARY }}>{display.isVarious ? 'Select material' : display.label}</option>
      {availableMaterials.map((mat) => {
        // Check if this material is the selected one and needs the missing count
        const isSelected = mat.id === currentValue;
        const label = isSelected && !display.isVarious ? display.label : mat.name;
        return (
          <option key={mat.id} value={mat.id} style={{ backgroundColor: materialColors.get(mat.id) }}>{label}</option>
        );
      })}
    </select>
  );
}

interface MaterialAssignmentUIProps {
  modelEntities: EntityData[];
  modelType: '3dm' | 'obj' | 'ifc' | null;
  geometryData: any;
  selectedGeometry: SelectedGeometry | null;
  onSelectGeometry: (selection: SelectedGeometry | null) => void;
  onAssignMaterial: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  availableMaterials: AcousticMaterial[]; // Choras materials from library
  expandedItems?: Set<string>; // Expanded tree items (persisted)
  onExpandedItemsChange?: (items: Set<string>) => void; // Callback to persist expanded state
  initialAssignments?: Map<number, string>; // faceIndex -> materialId from simulation config
}

export function MaterialAssignmentUI({
  modelEntities,
  modelType,
  geometryData,
  selectedGeometry,
  onSelectGeometry,
  onAssignMaterial,
  availableMaterials,
  expandedItems: externalExpandedItems,
  onExpandedItemsChange,
  initialAssignments
}: MaterialAssignmentUIProps) {
  // Use external expanded state if provided, otherwise use local state
  const [localExpandedItems, setLocalExpandedItems] = useState<Set<string>>(new Set(['all']));
  const expandedItems = externalExpandedItems || localExpandedItems;

  // Wrapper to handle both local state setter (accepts callback) and external setter (accepts value)
  const setExpandedItems = (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (onExpandedItemsChange) {
      // External setter - compute the new value and pass it directly
      const newValue = typeof updater === 'function' ? updater(expandedItems) : updater;
      onExpandedItemsChange(newValue);
    } else {
      // Local state setter - can handle both callback and direct value
      setLocalExpandedItems(updater);
    }
  };

  const [materialAssignments, setMaterialAssignments] = useState<Map<string, AcousticMaterial | null>>(() => {
    // Initialize from initialAssignments on mount
    if (!initialAssignments || initialAssignments.size === 0) return new Map();

    const newAssignments = new Map<string, AcousticMaterial | null>();
    const entityMaterialCounts = new Map<string, Map<string, number>>(); // entityKey -> materialId -> count
    const layerMaterialCounts = new Map<string, Map<string, number>>(); // layerKey -> materialId -> count
    
    // First pass: Set face-level assignments and count materials per entity/layer
    initialAssignments.forEach((materialId, faceIndex) => {
      // Material ID is stored without prefix, but availableMaterials has prefixes
      const material = availableMaterials.find(m => {
        if (m.id === materialId) return true;
        if (m.id.endsWith(`_${materialId}`)) return true;
        return false;
      });
      
      if (material) {
        // Find the entity and layer for this face
        const entityIndex = geometryData?.face_entity_map?.[faceIndex];
        if (entityIndex !== undefined) {
          const entity = modelEntities.find(e => e.index === entityIndex);
          const layerId = entity?.layer || '';
          const faceKey = `face-${layerId}-${entityIndex}-${faceIndex}`;
          newAssignments.set(faceKey, material);
          
          // Track material counts for entity
          const entityKey = `entity-${layerId}-${entityIndex}`;
          if (!entityMaterialCounts.has(entityKey)) {
            entityMaterialCounts.set(entityKey, new Map());
          }
          const entityCounts = entityMaterialCounts.get(entityKey)!;
          entityCounts.set(material.id, (entityCounts.get(material.id) || 0) + 1);
          
          // Track material counts for layer
          if (layerId) {
            const layerKey = `layer-${layerId}`;
            if (!layerMaterialCounts.has(layerKey)) {
              layerMaterialCounts.set(layerKey, new Map());
            }
            const layerCounts = layerMaterialCounts.get(layerKey)!;
            layerCounts.set(material.id, (layerCounts.get(material.id) || 0) + 1);
          }
        }
      }
    });
    
    // Second pass: If all faces in an entity have the same material, set entity-level assignment
    entityMaterialCounts.forEach((materialCounts, entityKey) => {
      if (materialCounts.size === 1) {
        // Only one material used in this entity
        const [materialId] = materialCounts.keys();
        const material = availableMaterials.find(m => m.id === materialId);
        if (material) {
          // Count total faces in this entity
          const match = entityKey.match(/^entity-(.*?)-(\d+)$/);
          if (match) {
            const layerId = match[1];
            const entityIndex = parseInt(match[2]);
            const entityFaceCount = geometryData?.face_entity_map?.filter((ei: number) => ei === entityIndex).length || 0;
            const assignedCount = Array.from(materialCounts.values())[0];
            
            // If all faces are assigned, set entity-level assignment
            if (entityFaceCount === assignedCount) {
              newAssignments.set(`${entityKey}-`, material);
            }
          }
        }
      }
    });
    
    // Third pass: If all faces in a layer have the same material, set layer-level assignment
    layerMaterialCounts.forEach((materialCounts, layerKey) => {
      if (materialCounts.size === 1) {
        const [materialId] = materialCounts.keys();
        const material = availableMaterials.find(m => m.id === materialId);
        if (material) {
          const layerId = layerKey.replace('layer-', '');
          const layerFaceCount = modelEntities
            .filter(e => (e.layer || '') === layerId)
            .reduce((sum, entity) => {
              return sum + (geometryData?.face_entity_map?.filter((ei: number) => ei === entity.index).length || 0);
            }, 0);
          const assignedCount = Array.from(materialCounts.values())[0];
          
          if (layerFaceCount === assignedCount) {
            newAssignments.set(`${layerKey}--`, material);
          }
        }
      }
    });

    return newAssignments;
  });
  const [updateCounter, setUpdateCounter] = useState(0); // Force re-renders for cascading

  // Generate material colors map using hash-based approach (matches ThreeScene)
  const materialColors = useMemo(() => {
    // Helper: Generate stable hash from string (same as ThreeScene)
    const hashString = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return Math.abs(hash);
    };

    const colors = new Map<string, string>();
    availableMaterials.forEach((mat) => {
      // Strip prefix from material ID to match backend format (for consistent hashing)
      const materialId = mat.id.startsWith('choras_') ? mat.id.substring(7) :
                        mat.id.startsWith('pyroom_') ? mat.id.substring(7) :
                        mat.id;

      // Use hash to determine a stable position in the gradient (0-99) - same as ThreeScene
      const hashValue = hashString(materialId);
      const gradientPosition = hashValue % 100; // 0-99
      const color = generateMaterialColor(100-gradientPosition, 100);

      // Store with FULL material ID (with prefix) as key
      colors.set(mat.id, color);
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

    console.log('[MaterialAssignmentUI] Auto-expand effect triggered:', selectedGeometry);

    setExpandedItems(prev => {
      const newExpanded = new Set(prev);
      newExpanded.add('all'); // Always expand root

      if (selectedGeometry.type === 'face' || selectedGeometry.type === 'entity') {
        // Find the entity to get its layer
        const entity = modelEntities.find(e => e.index === selectedGeometry.entityIndex);
        if (entity) {
          // Use 'Default' for entities without a layer (matches grouping logic)
          const layerId = entity.layer || 'Default';
          const layerKey = `layer-${layerId}`;
          // FIX: Match the entityId format used in the render code (without layerId prefix)
          const entityKey = `entity-${entity.index}`;

          newExpanded.add(layerKey); // Expand layer
          newExpanded.add(entityKey); // Expand entity

          console.log('[MaterialAssignmentUI] Expanding:', { layerKey, entityKey, entity, newExpandedSize: newExpanded.size });
        }
      } else if (selectedGeometry.type === 'layer' && selectedGeometry.layerId) {
        newExpanded.add(`layer-${selectedGeometry.layerId}`); // Expand layer
      }

      console.log('[MaterialAssignmentUI] New expanded items:', Array.from(newExpanded));
      return newExpanded;
    });

    // Scroll to the selected face in the list after a short delay to allow for expansion
    setTimeout(() => {
      const faceId = selectedGeometry.type === 'face'
        ? `face-row-${selectedGeometry.faceIndex}`
        : null;
      if (faceId) {
        const element = document.getElementById(faceId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          console.log('[MaterialAssignmentUI] Scrolled to face:', faceId);
        }
      }
    }, 100); // Small delay to allow expansion animation
  }, [selectedGeometry, modelEntities]);
  // Note: setExpandedItems is intentionally omitted from dependencies to avoid infinite loops

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

  // Helper to get display value for parent nodes (various, missing, etc.)
  const getDisplayValue = (selection: SelectedGeometry): { value: string; label: string; isVarious: boolean } => {
    let childMaterials: Set<string> = new Set();
    let totalChildren = 0;
    let assignedChildren = 0;

    if (selection.type === 'global') {
      // Check all entities/faces
      if (hasLayers) {
        Object.entries(groupedEntities).forEach(([layerName, entities]) => {
          entities.forEach(entity => {
            getEntityFaces(entity.index).forEach(faceIndex => {
              totalChildren++;
              const faceSelection: SelectedGeometry = {
                type: 'face',
                faceIndex,
                entityIndex: entity.index,
                layerId: layerName
              };
              const mat = getMaterialForSelection(faceSelection);
              if (mat) {
                assignedChildren++;
                childMaterials.add(mat.id);
              }
            });
          });
        });
      } else {
        modelEntities.forEach(entity => {
          getEntityFaces(entity.index).forEach(faceIndex => {
            totalChildren++;
            const faceSelection: SelectedGeometry = {
              type: 'face',
              faceIndex,
              entityIndex: entity.index
            };
            const mat = getMaterialForSelection(faceSelection);
            if (mat) {
              assignedChildren++;
              childMaterials.add(mat.id);
            }
          });
        });
      }
    } else if (selection.type === 'layer' && selection.layerId) {
      // Check all faces in this layer
      const entities = groupedEntities[selection.layerId] || [];
      entities.forEach(entity => {
        getEntityFaces(entity.index).forEach(faceIndex => {
          totalChildren++;
          const faceSelection: SelectedGeometry = {
            type: 'face',
            faceIndex,
            entityIndex: entity.index,
            layerId: selection.layerId
          };
          const mat = getMaterialForSelection(faceSelection);
          if (mat) {
            assignedChildren++;
            childMaterials.add(mat.id);
          }
        });
      });
    } else if (selection.type === 'entity' && selection.entityIndex !== undefined) {
      // Check all faces in this entity
      getEntityFaces(selection.entityIndex).forEach(faceIndex => {
        totalChildren++;
        const faceSelection: SelectedGeometry = {
          type: 'face',
          faceIndex,
          entityIndex: selection.entityIndex,
          layerId: selection.layerId
        };
        const mat = getMaterialForSelection(faceSelection);
        if (mat) {
          assignedChildren++;
          childMaterials.add(mat.id);
        }
      });
    }

    // Determine display value
    const missingCount = totalChildren - assignedChildren;
    
    if (childMaterials.size === 0) {
      // No materials assigned to children
      if (missingCount > 0) {
        return { value: 'none', label: `Select material (${missingCount} faces missing)`, isVarious: false };
      }
      return { value: 'none', label: 'Select material', isVarious: false };
    } else if (childMaterials.size === 1) {
      // All children have the same material
      const materialId = Array.from(childMaterials)[0];
      const material = availableMaterials.find(m => m.id === materialId);
      if (missingCount > 0) {
        return { value: materialId, label: `${material?.name || 'Unknown'} (${missingCount} missing)`, isVarious: false };
      }
      return { value: materialId, label: material?.name || 'Unknown', isVarious: false };
    } else {
      // Multiple different materials
      if (missingCount > 0) {
        return { value: 'various', label: `various (${missingCount} missing)`, isVarious: true };
      }
      return { value: 'various', label: 'various', isVarious: true };
    }
  };

  const isSelected = (selection: SelectedGeometry): boolean => {
    if (!selectedGeometry) return false;
    const result = (
      selectedGeometry.type === selection.type &&
      selectedGeometry.faceIndex === selection.faceIndex &&
      selectedGeometry.entityIndex === selection.entityIndex &&
      selectedGeometry.layerId === selection.layerId
    );

    return result;
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
            <MaterialSelect
              selection={{ type: 'global' }}
              materialColors={materialColors}
              availableMaterials={availableMaterials}
              getMaterialForSelection={getMaterialForSelection}
              getDisplayValue={getDisplayValue}
              getSelectBackgroundColor={getSelectBackgroundColor}
              handleMaterialChange={handleMaterialChange}
              updateCounter={updateCounter}
            />
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
                                          id={`face-row-${faceIndex}`}
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
                  const entitySelection: SelectedGeometry = {
                    type: 'entity',
                    entityIndex: entity.index,
                    layerId: entity.layer || 'Default'
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
                              entityIndex: entity.index,
                              layerId: entity.layer || 'Default'
                            };

                            return (
                              <div
                                key={`face-${faceIndex}`}
                                id={`face-row-${faceIndex}`}
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

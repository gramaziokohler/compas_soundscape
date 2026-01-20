# Speckle-based Surface Materials for Acoustic Simulations

## Overview

Migrate the Surface Materials UI for PyroomAcoustics and Choras simulations to read from the Speckle world tree instead of file-based geometry data.

## ✅ IMPLEMENTATION STATUS

### Completed (Frontend):
1. ✅ Created TypeScript types (`frontend/src/types/speckle-materials.ts`)
   - SpeckleMeshObject, SpeckleLayerInfo, SpeckleMaterialAssignment, ObjectColorGroup

2. ✅ Enhanced `useSpeckleFiltering` hook
   - Added `setUserObjectColors()` and `removeUserObjectColors()` methods
   - Integrates with FilteringExtension for material visualization

3. ✅ Created `useSpeckleSurfaceMaterials` hook
   - Extracts layers from world tree
   - Auto-selects "Acoustics" layer or provides dropdown
   - Tracks material assignments per object ID
   - Generates color groups for visualization

4. ✅ Created `SpeckleMaterialAssignmentUI` component
   - Layer selector dropdown with auto-selection indicator
   - Object tree with material dropdowns
   - Color-coded material assignments

5. ✅ Created `SpeckleSurfaceMaterialsSection` wrapper component
   - Integrates all hooks and components
   - Fetches worldTree from viewer automatically
   - Applies colors via FilteringExtension

6. ✅ Updated `SimulationTab` to use Speckle components
   - Auto-detects Speckle viewer availability
   - Conditionally renders Speckle or traditional material UI
   - Stores assignments in simulation config

### Completed (Backend):
1. ✅ Added geometry extraction from Speckle display values
   - Implemented `get_model_geometry(project_id, version_id, layer_name)` in SpeckleService
   - Follows Speckle display values pattern (https://docs.speckle.systems/developers/sdks/python/concepts/display-values)
   - Extracts mesh vertices and faces from displayValue properties
   - Supports layer filtering (e.g., "Acoustics" layer)
   - Handles triangulation of quads and polygons
   - Maps faces to object IDs for material assignment
2. ✅ Added new API endpoint /pyroomacoustics/run-simulation-speckle in backend\routers\pyroomacoustics.py
    1. Authenticates with Speckle and fetches geometry from the specified version
    2. Extracts mesh data from Speckle display values
    3. Maps object materials to faces
    4. Creates a pyroomacoustics Room from the mesh
    5. Runs simulation for each source-receiver pair
    6. Exports impulse responses and results

### Completed (API Service & Build):
3. ✅ Added API service method `runPyroomacousticsSimulationSpeckle` to `frontend/src/services/api.ts`
4. ✅ Fixed all compilation bugs - `pnpm build` passes successfully


## User Decisions

 - Material assignment granularity: Object-level (whole Speckle meshes)
 - Geometry source: Backend fetches from Speckle API

 Architecture

 ┌─────────────────────────────────────────────────────────────────┐
 │                         FRONTEND                                 │
 ├─────────────────────────────────────────────────────────────────┤
 │  SpeckleSurfaceMaterialsSection                                 │
 │  ├── Layer selector (finds "Acoustics" or dropdown)             │
 │  ├── SpeckleMaterialAssignmentUI                                │
 │  │   └── Object tree with material dropdowns                    │
 │  └── Color visualization (FilteringExtension.setUserObjectColors)│
 │                                                                  │
 │  Sends to backend:                                               │
 │  {                                                               │
 │    speckle_project_id: "xxx",                                   │
 │    speckle_version_id: "yyy",                                   │
 │    object_materials: {"speckle_obj_id": "material_id", ...},    │
 │    layer_name: "Acoustics",                                     │
 │    source_receiver_pairs: [...]                                 │
 │  }                                                               │
 └─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                         BACKEND                                  │
 ├─────────────────────────────────────────────────────────────────┤
 │  New endpoint: /pyroomacoustics/run-simulation-speckle          │
 │  1. Use SpeckleService to authenticate                          │
 │  2. Fetch geometry via get_model_geometry()                     │
 │  3. Convert Speckle objects → {vertices, faces}                 │
 │  4. Map object materials → per-face absorption                  │
 │  5. Run simulation (same as current)                            │
 └─────────────────────────────────────────────────────────────────┘

 Files to Create

 1. frontend/src/hooks/useSpeckleSurfaceMaterials.ts

 /**
  * Hook for managing Speckle-based surface materials
  * - Extracts layers from world tree
  * - Finds "Acoustics" layer (or provides alternatives)
  * - Extracts mesh objects from selected layer
  * - Tracks material assignments per object ID
  */
 export function useSpeckleSurfaceMaterials(viewerRef, worldTree) {
   // State: selectedLayerId, layerOptions, meshObjects, materialAssignments
   // Methods: selectLayer, assignMaterial, getMaterialColor
 }

 2. frontend/src/components/acoustics/SpeckleMaterialAssignmentUI.tsx

 /**
  * Material assignment UI for Speckle objects
  * - Layer selector dropdown at top
  * - Tree of mesh objects (simplified - no face-level)
  * - Material dropdown per object
  * - Integrates with FilteringExtension for color visualization
  */

 3. frontend/src/components/acoustics/SpeckleSurfaceMaterialsSection.tsx

 /**
  * Wrapper that:
  * - Integrates useSpeckleSurfaceMaterials hook
  * - Handles SpeckleViewerContext access
  * - Applies colors via setUserObjectColors
  * - Same interface as SurfaceMaterialsSection for SimulationTab
  */

 Files to Modify

 4. frontend/src/hooks/useSpeckleFiltering.ts

 Add method:
 const setUserObjectColors = useCallback((groups: { objectIds: string[]; color: string }[]) => {
   if (!filteringExtension) return;
   filteringExtension.setUserObjectColors(groups);
   viewerRef.current?.requestRender();
 }, [filteringExtension]);

 const removeUserObjectColors = useCallback(() => {
   if (!filteringExtension) return;
   filteringExtension.removeUserObjectColors();
   viewerRef.current?.requestRender();
 }, [filteringExtension]);

 5. frontend/src/components/layout/sidebar/SimulationTab.tsx

 Detect Speckle mode and use new component:
 {/* Pyroomacoustics/Choras Mode with Speckle viewer */}
 {(config.mode === 'pyroomacoustics' || config.mode === 'choras') &&
   viewerRef?.current && (
     <SpeckleSurfaceMaterialsSection
       availableMaterials={availableMaterials}
       onMaterialAssignmentsChange={...}
       // ... other props
     />
 )}

 6. frontend/src/services/api.ts

 Add new method:
 async runPyroomacousticsSimulationSpeckle(
   speckleProjectId: string,
   speckleVersionId: string,
   objectMaterials: Record<string, string>, // objectId -> materialId
   layerName: string,
   settings: {...},
   sourceReceiverPairs: [...],
 ): Promise<SimulationResult>

 7. backend/routers/pyroomacoustics.py

 Add new endpoint:
 @router.post("/pyroomacoustics/run-simulation-speckle")
 async def run_simulation_speckle(
     speckle_project_id: str = Form(...),
     speckle_version_id: str = Form(...),
     object_materials: str = Form(...),  # JSON: {"obj_id": "mat_id"}
     layer_name: str = Form(...),
     # ... other settings same as current endpoint
 ):
     # 1. Init SpeckleService and authenticate
     # 2. Fetch geometry from Speckle
     # 3. Convert to vertices/faces format
     # 4. Run simulation (reuse existing logic)

 8. backend/services/geometry_service.py

 Add method:
 @staticmethod
 def extract_geometry_from_speckle_objects(speckle_objects: list) -> dict:
     """
     Convert Speckle mesh objects to standard geometry format.

     Args:
         speckle_objects: List of Speckle Base objects with mesh data

     Returns:
         {
             "vertices": [[x,y,z], ...],
             "faces": [[v0,v1,v2], ...],
             "object_face_ranges": {"obj_id": [start_face, end_face], ...}
         }
     """

 Types to Add

 frontend/src/types/speckle-materials.ts

 export interface SpeckleMeshObject {
   id: string;
   name: string;
   speckle_type: string;
 }

 export interface SpeckleLayerInfo {
   id: string;
   name: string;
   meshCount: number;
   meshObjects: SpeckleMeshObject[];
 }

 export interface SpeckleMaterialAssignment {
   objectId: string;
   materialId: string;
 }

 Key Implementation Details

 Finding "Acoustics" Layer

 function findLayerByName(nodes: ExplorerNode[], name: string): ExplorerNode | null {
   for (const node of nodes) {
     const nodeName = node.raw?.name || node.model?.name || '';
     if (nodeName.toLowerCase() === name.toLowerCase()) return node;

     const children = node.model?.children || node.children;
     if (children) {
       const found = findLayerByName(children as ExplorerNode[], name);
       if (found) return found;
     }
   }
   return null;
 }

 // Usage:
 const acousticsLayer = findLayerByName(rootNodes, 'Acoustics');
 if (!acousticsLayer) {
   // Show dropdown with all available layers that have children
 }

 Color Visualization Pattern

 // Group objects by material, then apply colors
 const colorGroups = materialAssignments.reduce((groups, {objectId, materialId}) => {
   const color = getMaterialColor(materialId);
   const existing = groups.find(g => g.color === color);
   if (existing) {
     existing.objectIds.push(objectId);
   } else {
     groups.push({ objectIds: [objectId], color });
   }
   return groups;
 }, [] as { objectIds: string[]; color: string }[]);

 filteringExtension.setUserObjectColors(colorGroups);
 viewerRef.current.requestRender();

 Verification Steps

 1. Load Speckle model with layers including "Acoustics"
 2. Open simulation tab (Pyroomacoustics or Choras)
 3. Verify layer detection: "Acoustics" auto-selected or dropdown shown
 4. Assign materials: Select objects, choose materials from dropdown
 5. Check color visualization: Objects should be colored by material
 6. Run simulation: Backend should fetch geometry and complete successfully
 7. Test fallback: Load model without "Acoustics" layer, verify dropdown works

 Risks & Mitigations
 ┌─────────────────────────┬────────────────────────────────────────────────────────────────┐
 │          Risk           │                           Mitigation                           │
 ├─────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Speckle API latency     │ Show loading indicator, cache geometry                         │
 ├─────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Large model performance │ Batch color updates, virtual scrolling for object list         │
 ├─────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Missing geometry data   │ Validate Speckle objects have mesh data before simulation      │
 ├─────────────────────────┼────────────────────────────────────────────────────────────────┤
 │ Auth token expiry       │ Check auth status before simulation, prompt re-login if needed │
# Arctic Mode & Entity Visualization Implementation

This document describes the implementation of Arctic Mode rendering and entity visualization features for the COMPAS Soundscape 3D viewer.

## Overview

The implementation adds the following features:
1. **Arctic Mode Rendering** - Mimics Rhino 3D's Arctic Mode visual style
2. **Entity Visualization** - Shows building/model entities as semi-transparent boxes
3. **Entity Selection** - Click-to-select entities with information display
4. **Diverse Object Highlighting** - Highlights entities selected by AI analysis
5. **Optimized Camera Positioning** - Better initial zoom level

## File Structure

### New Files Created

#### 1. `frontend/src/lib/three/sceneSetup.ts`
Utility functions for Three.js scene setup with Arctic Mode styling:
- `createArcticModeScene()` - Creates scene with Arctic Mode background
- `setupArcticModeLighting()` - Configures bright, even lighting
- `createArcticModeGrid()` - Creates Arctic Mode styled grid
- `createArcticModeMaterial()` - Creates Arctic Mode material for geometry
- `setupOrbitControls()` - Sets up camera controls
- `frameCameraToObject()` - Positions camera to frame objects properly

#### 2. `frontend/src/lib/three/entityMeshes.ts`
Utility functions for entity mesh management:
- `createEntityMesh()` - Creates box mesh for entity bounds
- `createEntityMaterial()` - Creates material with highlighting
- `clearMeshGroup()` - Clears and disposes mesh group
- `findClosestEntity()` - Finds closest entity to a point
- Constants: `HIGHLIGHT_COLOR` (pink: #F500B8), `ENTITY_BASE_COLOR`

#### 3. `frontend/src/components/overlays/EntityUIOverlay.tsx`
React component for displaying entity information overlay:
- Shows entity name, type, layer, material, index, position
- Styled to match application design
- Auto-positioned to follow entity in 3D space

### Modified Files

#### 1. `frontend/src/components/scene/ThreeScene.tsx`
Main 3D scene component (reduced from 663 to 607 lines):
- Refactored to use utility functions from `sceneSetup.ts` and `entityMeshes.ts`
- Added entity visualization system
- Added click detection for entity selection
- Added support for highlighting diverse objects
- Improved camera positioning (0.95x multiplier)

#### 2. `frontend/src/hooks/useTextGeneration.ts`
Text generation hook:
- Added `selectedDiverseEntities` state
- Stores entities selected by AI diversity analysis
- Exports entities for visualization

#### 3. `frontend/src/app/page.tsx`
Main application page:
- Passes `selectedDiverseEntities` to ThreeScene

#### 4. `frontend/src/types/index.ts`
Type definitions:
- Added `EntityData` interface
- Added `EntityOverlay` interface

## Feature Details

### Arctic Mode Rendering

**Visual Characteristics:**
- Background: Light blue-grey (#e8edf2)
- Geometry: Arctic white (#f0f4f8)
- Grid: Subtle grey tones
- Lighting: Bright ambient (1.2) + two directional lights (0.6, 0.4)

**Implementation:**
```typescript
const scene = createArcticModeScene();
setupArcticModeLighting(scene);
const mesh = new THREE.Mesh(geometry, createArcticModeMaterial());
```

### Entity Visualization

**Behavior:**
- Each entity rendered as semi-transparent box mesh (60% opacity)
- Boxes based on entity bounding box (min/max coordinates)
- Entities from diverse selection highlighted in pink (70% opacity)
- Selected entity highlighted in bright pink (90% opacity) with emissive glow

**States:**
- **Normal**: Arctic white (#f0f4f8), 60% opacity
- **Diverse**: Pink (#F500B8), 70% opacity, subtle glow
- **Selected**: Pink (#F500B8), 90% opacity, strong glow

### Entity Selection & Display

**Interaction:**
1. User clicks on entity mesh
2. Entity data displayed in overlay above entity
3. Overlay shows: name, type, layer, material, index, position
4. Click empty space to deselect
5. Overlay automatically hidden when sounds are generated

### Diverse Object Highlighting

**Workflow:**
1. User loads model with entities
2. AI analyzes and selects N most diverse objects
3. Selected entities automatically highlighted in pink
4. User can see which objects were chosen for sound generation

### Camera Positioning

**Improvements:**
- Reduced zoom multiplier from 1.5x to 0.95x
- Camera frames geometry more tightly on load
- No more "resets too far" issue

## Color Palette

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| Background | Arctic Blue-Grey | #e8edf2 | Scene background |
| Geometry | Arctic White | #f0f4f8 | Main 3D model |
| Grid Lines | Light Grey | #d0d8e0 | Grid minor |
| Grid Main | Medium Grey | #b0b8c0 | Grid major |
| Highlight | Website Pink | #F500B8 | Selected/diverse entities |

## API Integration

### Entity Data Structure
```typescript
interface EntityData {
  index: number;
  type: string;          // e.g. "IfcWall", "IfcSlab"
  name?: string;         // Entity name if available
  layer?: string;        // Layer name (3DM files)
  material?: string;     // Material name (3DM files)
  position: number[];    // [x, y, z] centroid
  bounds: {
    min: number[];       // [x, y, z] minimum
    max: number[];       // [x, y, z] maximum
    center?: number[];   // [x, y, z] center (optional)
  };
}
```

### Backend Endpoints Used
- `POST /api/analyze-ifc` - Analyzes IFC files for entities
- `POST /api/analyze-3dm` - Analyzes 3DM files for entities
- `POST /api/generate-text` - Generates sound prompts, returns diverse entities

## Performance Considerations

1. **Mesh Disposal**: All entity meshes properly disposed when recreated
2. **Memoization**: Geometry data memoized to prevent unnecessary recalculations
3. **Modular Code**: Utility functions allow tree-shaking and code splitting
4. **Efficient Updates**: Only affected meshes updated on selection change

## Usage Example

```typescript
<ThreeScene
  geometryData={geometryData}
  modelEntities={modelEntities}              // All entities from file
  selectedDiverseEntities={diverseEntities}  // AI-selected entities
  // ... other props
/>
```

## Future Enhancements

Potential improvements:
- [ ] Edge highlighting for selected entities
- [ ] Entity filtering by type/layer
- [ ] Custom colors per entity type
- [ ] Animation when entities are selected
- [ ] Export entity selection
- [ ] Search/filter entities by name

## Testing

To test the features:
1. Load a 3DM or IFC file with multiple objects
2. Verify Arctic Mode styling (light background, white geometry)
3. Use AI text generation to select diverse objects
4. Verify selected entities are highlighted in pink
5. Click on entity boxes to see information overlay
6. Generate sounds and verify entity display resets
7. Check camera zoom is appropriate on model load

## Dependencies

- Three.js (r167+)
- React 18+
- TypeScript 5+

## Notes

- Entity meshes are in a separate group from main geometry
- Click detection prioritizes entity meshes over geometry
- All colors coordinated with website design (#F500B8 pink)
- Arctic Mode inspired by Rhino 3D's rendering mode

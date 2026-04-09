> ## Documentation Index
> Fetch the complete documentation index at: https://docs.speckle.systems/llms.txt
> Use this file to discover all available pages before exploring further.

# SpeckleRenderer

## Properties

### objectPickConfiguration

```typescript  theme={null}
objectPickConfiguration: ObjectPickConfiguration
```

Holds the [*ObjectPickConfiguration*](/developers/viewer/speckle-renderer-api#typedefs) for pick filtering.

<Warning>
  By default the viewer filters the objects from [*ObjectClicked*](/developers/viewer/viewer-api#viewerevent) and [*ObjectDoubleClicked*](/developers/viewer/viewer-api#viewerevent) events the following way:

  * Null materials are ignored
  * Materials with `visible=false` are ignored
  * Transparent materials with `opacity=0` are ignored
  * `SpeckleGhostMaterial` material instances are ignored
</Warning>

## Accessors

### allObjects

```typescript  theme={null}
get allObjects(): Object3D
```

Gets the parent three.js object for all *loaded* scene content.

**Returns**: [***Object3D***](https://threejs.org/docs/index.html?q=objec#api/en/core/Object3D)

### clippingPlanes

```typescript  theme={null}
get clippingPlanes(): Plane[]
set clippingPlanes(value: Plane[])
```

Gets or set the clipping [*Plane*](https://threejs.org/docs/index.html?q=plane#api/en/math/Plane)s for the scene. Anything outside the volume determined by the clipping planes will get visually clipped.

### clippingVolume

```typescript  theme={null}
get clippingVolume(): Box3
set clippingVolume(box: Box3)
```

Gets or set the clipping volume for the renderer as a [*Box3*](https://threejs.org/docs/index.html?q=box3#api/en/math/Box3). Anything outside the clipping volume is not interactible by default.

### indirectIBL

```typescript  theme={null}
set indirectIBL(texture: Texture)
```

Sets the texture for indirect image based lighting. Works as per existing three.js [*Scene*](https://threejs.org/docs/index.html?q=scene#api/en/scenes/Scene.environment) documentation.

### indirectIBLIntensity

```typescript  theme={null}
set indirectIBLIntensity(value: number)
```

Sets the [*envMapIntensity*](https://threejs.org/docs/index.html?q=standard#api/en/materials/MeshStandardMaterial.envMapIntensity) for all [*SpeckleStandardMaterial*](/developers/viewer/speckle-material-api.md)s in the scene.

### intersections

```typescript  theme={null}
get intersections(): Intersections
```

Gets the [*Intersections*](/developers/viewer/intersections-api) instance associated with the renderer.

**Returns**: [***Intersections***](/developers/viewer/intersections-api)

### needsRender

```typescript  theme={null}
set needsRender(value: boolean)
```

Signals the renderer that it needs to render at least one frame. Assigning a *false* value has no effect.

### pipeline

```typescript  theme={null}
get pipeline(): Pipeline
set pipeline(value: Pipeline)
```

Gets or sets the renderer's [*Pipeline*](/developers/viewer/rendering-pipeline-api/pipeline-api).

### renderer

```typescript  theme={null}
get renderer(): SpeckleWebGLRenderer
```

Gets the underlying *SpeckleWebGLRenderer* which is small extension of [*WebGLRenderer*](https://threejs.org/docs/index.html?q=webgl#api/en/renderers/WebGLRenderer).

**Returns**: [***SpeckleWebGLRenderer***](https://threejs.org/docs/index.html?q=webgl#api/en/renderers/WebGLRenderer)

### renderingCamera

```typescript  theme={null}
get renderingCamera(): Camera
```

Gets the currently rendering [*Camera*](https://threejs.org/docs/index.html?q=ca#api/en/cameras/Camera).

**Returns**: [***Camera***](https://threejs.org/docs/index.html?q=ca#api/en/cameras/Camera)

### renderingStats

```typescript  theme={null}
get renderingStats(): RenderingStats
```

Gets the up to date [*RenderingStats*](/developers/viewer/speckle-renderer-api#renderingstats).

**Returns**: [***RenderingStats***](/developers/viewer/speckle-renderer-api#renderingstats)

### scene

```typescript  theme={null}
get scene(): Scene
```

Gets the underlying three.js [*Scene*](https://threejs.org/docs/index.html?q=scene#api/en/scenes/Scene).

**Returns**: [***Scene***](https://threejs.org/docs/index.html?q=scene#api/en/scenes/Scene)

### sceneBox

```typescript  theme={null}
get sceneBox(): Box3
```

Gets the total bounds of the scene.

**Returns**: [***Box3***](https://threejs.org/docs/index.html?q=box#api/en/math/Box3)

### sceneCenter

```typescript  theme={null}
get sceneCenter(): Vector3
```

Gets the center of the total bounds of the scene.

**Returns**: [***Vector3***](https://threejs.org/docs/index.html?q=vec#api/en/math/Vector3)

### sceneSphere

```typescript  theme={null}
get sceneSphere(): Sphere
```

Gets the sphere encompasing the entire scene.

**Returns**: [***Sphere***](https://threejs.org/docs/index.html?q=Sphere#api/en/math/Sphere)

### shadowcatcher

```typescript  theme={null}
get shadowcatcher(): Shadowcatcher
```

Gets *The Shadowcatcher*🛸 instance associated with the renderer.

**Returns**: *Shadowcatcher*

### shadowMapNeedsUpdate

```typescript  theme={null}
set shadowMapNeedsUpdate(value: boolean)
```

Signals the renderer to render the shadowmap.

### sunLight

```typescript  theme={null}
get sunLight(): DirectionalLight
```

Gets the [*DirectionalLight*](https://threejs.org/docs/index.html?q=direct#api/en/lights/DirectionalLight) sun instance.

**Returns**: [***DirectionalLight***](https://threejs.org/docs/index.html?q=direct#api/en/lights/DirectionalLight)

## Methods

### addRenderTree

```typescript  theme={null}
async *addRenderTree(subtreeId: string): AsyncGenerator<any, void, unknown>
```

Generator function which takes the id of a render tree, builds the batches, then adds the batches to the scene. The function will `yield` after each batch has been created, allowing for user defined code to be run in the following fashion.

```typescript  theme={null}
for await (const step of speckleRenderer.addRenderTree(id)) {
  // User defined code
}
```

**Parameters**

* **subtreeId**: The id of the render tree to add to the scene

**Returns**: [***AsyncGenerator***](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncGenerator)

### boxFromObjects

```typescript  theme={null}
boxFromObjects(objectIds: string[]): Box3
```

Builds the bounds of the provided object ids as a [*Box3*](https://threejs.org/docs/index.html?q=box#api/en/math/Box3).

**Parameters**

* **objectIds**: An array of ids that participate in the bounds calculation

**Returns**: [***Box3***](https://threejs.org/docs/index.html?q=box#api/en/math/Box3)

### cancelRenderTree

```typescript  theme={null}
cancelRenderTree(subtreeId: string): void
```

Cancels any ongoing render tree adding operations. Effective cancelling happens as soon as the current running generator step yields.

**Parameters**

* **objectIds**: An array of ids that participate in the bounds calculation

**Returns**: *void*

### enableLayers

```typescript  theme={null}
enableLayers(layers: ObjectLayers[], value: boolean): void
```

Enables/Disables [*ObjectLayer*](/developers/viewer/viewer-api#objectlayers)s from rendering. By default all layers are enabled.

**Parameters**

* **objectIds**: An array of ids that participate in the bounds calculation

**Returns**: *void*

### getBatch

```typescript  theme={null}
getBatch(id: string): Batch
```

Gets a [*Batch*](/developers/viewer/batch-api) by id.

**Parameters**

* **id**: The id of the batch

**Returns**: [***Batch***](/developers/viewer/batch-api)

### getBatchMaterial

```typescript  theme={null}
getBatchMaterial(rv: NodeRenderView): Material
```

Gets the default material of the provided [*NodeRenderView*](/developers/viewer/render-view-api). It's originally defined material.

**Parameters**

* **rv**: [*NodeRenderView*](/developers/viewer/render-view-api)

**Returns**: [***Material***](https://threejs.org/docs/index.html?q=mate#api/en/materials/Material)

### getMaterial

```typescript  theme={null}
getMaterial(rv: NodeRenderView): Material
```

Gets the current material of the provided \[*NodeRenderView*]\(/dev

**Parameters**

* **rv**: [*NodeRenderView*](/developers/viewer/render-view-api)

**Returns**: [***Material***](https://threejs.org/docs/index.html?q=mate#api/en/materials/Material)

### getObject

```typescript  theme={null}
getObject(rv: NodeRenderView): BatchObject
```

Gets the associated [*BatchObject*](/developers/viewer/batch-object-api) with the provided [*NodeRenderView*](/developers/viewer/render-view-api).

**Parameters**

* **rv**: [*NodeRenderView*](/developers/viewer/render-view-api)

**Returns**: [***BatchObject***](/developers/viewer/batch-object-api)

### getObjects

```typescript  theme={null}
getObjects(): BatchObject[]
```

Gets all [*BatchObject*](/developers/viewer/batch-object-api) instances from the renderer.

**Returns**: [***BatchObject\[\]***](/developers/viewer/batch-object-api)

### removeRenderTree

```typescript  theme={null}
removeRenderTree(subtreeId: string)
```

Removes the specified render tree along with all it's generated objects from the scene.

**Parameters**

* **subtreeId**: The id of the render tree to remove from the scene

**Returns**: *void*

### renderViewFromIntersection

```typescript  theme={null}
renderViewFromIntersection(intersection: ExtendedIntersection): NodeRenderView
```

Takes an intersection result produced by [*intersections*](/developers/viewer/speckle-renderer-api#intersections) and outputs the intersected [*NodeRenderView*](/developers/viewer/render-view-api).

**Parameters**

* **intersection**: [*ExtendedIntersection*](/developers/viewer/top-level-acceleration-structure-api#extendedintersection)

**Returns**: [*NodeRenderView*](/developers/viewer/render-view-api)

### resetMaterials

```typescript  theme={null}
resetMaterials(): void
```

Resets all object materials to their original default.

**Returns**: *void*

### resetPipeline

```typescript  theme={null}
resetPipeline(): void
```

Resets the current rendering pipeline.

**Returns**: *void*

### resize

```typescript  theme={null}
resize(width: number, height: number): void
```

Manually resizes the renderer.

**Returns**: *void*

### setMaterial

There are several overloads of this method.

```typescript  theme={null}
setMaterial(rvs: NodeRenderView[], material: Material): void
```

Sets the material instance to the specified rvs.

**Parameters**

* **rvs**: [*NodeRenderView*](/developers/viewer/render-view-api)
* **material**: The material instance to apply. It can be a vanilla three.js [*Material*](https://threejs.org/docs/index.html?q=mate#api/en/materials/Material) but also a [*SpeckleMaterial*](/developers/viewer/speckle-material-api)

```typescript  theme={null}
setMaterial(
    rvs: NodeRenderView[],
    material: RenderMaterial & DisplayStyle & MaterialOptions
): void
```

Creates a material based on the intersection between [*RenderMaterial*](/developers/viewer/speckle-material-api#rendermaterial), [*DisplayStyle*](/developers/viewer/speckle-material-api#displaystyle) and [*MaterialOptions*](/developers/viewer/speckle-material-api#materialoptions). Because this method does not discriminate based on the render view's geometry type (mesh, lines, points) it needs to be able to build materials suitable for all gometry types.

**Parameters**

* **rvs**: [*NodeRenderView*](/developers/viewer/render-view-api)
* **material**: [*RenderMaterial*](/developers/viewer/speckle-material-api#rendermaterial) & [*DisplayStyle*](/developers/viewer/speckle-material-api#displaystyle) & [*MaterialOptions*](/developers/viewer/speckle-material-api#materialoptions)

**Returns**: *void*

```typescript  theme={null}
setMaterial(rvs: NodeRenderView[], material: FilterMaterial): void
```

Sets the filter material to the specified rvs. [*FilterMaterial*](/developers/viewer/speckle-material-api#filterMmaterial)s are a set of predefined material types which are commonly used.

**Parameters**

* **rvs**: [*NodeRenderView*](/developers/viewer/render-view-api)
* **material**: [*FilterMaterial*](/developers/viewer/speckle-material-api#filterMmaterial)

**Returns**: *void*

### setSunLightConfiguration

```typescript  theme={null}
setSunLightConfiguration(config: SunLightConfiguration): void
```

Sets the provided [*SunLightConfiguration*](/developers/viewer/speckle-renderer-api#sunlightconfiguration).

**Parameters**

* **config**: [*SunLightConfiguration*](/developers/viewer/speckle-renderer-api#sunlightconfiguration)

**Returns**: *void*

### updateShadowCatcher

```typescript  theme={null}
updateShadowCatcher(force?: boolean): void
```

Updates *The Shadowcatcher*🛸.

**Parameters**

* *optional* **force**: boolean

**Returns**: *void*

## Typedefs

### ObjectPickConfiguration

```typescript  theme={null}
interface ObjectPickConfiguration {
  pickedObjectsFilter: ((arg: [NodeRenderView, Material]) => boolean) | null
}
```

* **pickedObjectsFilter**: The filtering predicate

You can accept or reject each picked object from [*ObjectClicked*](/developers/viewer/viewer-api#viewerevent) and [*ObjectDoubleClicked*](/developers/viewer/viewer-api#viewerevent) events, based on thier NodeRenderView and Material

### RenderingStats

```typescript  theme={null}
{
  objects: number
  batchCount: number
  drawCalls: number
  trisCount: number
  vertCount: number
  batchDetails: Array<{
    drawCalls: number
    minDrawCalls: number
    tris: number
    verts: number
  }
}
```

Details regarding rendering state.

### SunLightConfiguration

```typescript  theme={null}
interface SunLightConfiguration extends LightConfiguration {
  elevation?: number;
  azimuth?: number;
  radius?: number;
}
```

* **elevation**: Elevation in polar coordinates
* **azimuth**: Azimuth in polar coordinates
* **radius**: Distance from the camera target


Built with [Mintlify](https://mintlify.com).
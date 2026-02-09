# SelectionExtension

> Defalt selection helper extension. Handles object selection automatically, both visually and data wise. Optionally can highlight on hover.

The extension automatically binds to:

* `ViewerEvent.ObjectClicked` for selection detection.
* `ViewerEvent.ObjectDoubleClicked` for focusing on objects
* `InputEvent.PointerMove` for hover detection

<Warning>
  This extension requires and active CameraController extension implementation.
</Warning>

<Warning>
  Note that this extension will automatically remember the last material for
  each material that you select **and automatically apply it upon deselection**.
  This might affect the end result if you are combining selection with other
  operations like isolating, hiding or coloring.
</Warning>

## Accessors

### enabled

```typescript  theme={null}
get enabled(): boolean
set enabled(value: boolean)
```

Enables/disables the extension.

**Returns**: boolean

### options

```typescript  theme={null}
get options(): SelectionExtensionOptions
set options(value: SelectionExtensionOptions)
```

Gets and sets the extension options.

**Returns**: [*SelectionExtensionOptions*](/developers/viewer/extensions/selection-extension-api#selectionextensionoptions)

## Methods

### getSelectedObjects

```typescript  theme={null}
getSelectedObjects(): Array<Record<string, unknown>>
```

Gets the currently selected raw objects.

**Returns**: Array\< Record\< string, unknown > >

### getSelectedNodes

```typescript  theme={null}
getSelectedNodes(): Array<TreeNode>
```

Gets the currently selected nodes.

**Returns**: Array\< TreeNode >

### selectObjects

```typescript  theme={null}
selectObjects(ids: Array<string>, multiSelect = false): void
```

Programatically selects objects by ids.

**Parameters**

* **ids**: Array\< string >
* *optional* **multiSelect**: Signals if this select needs to clear previous one or not

**Returns**: void

### unselectObjects

```typescript  theme={null}
unselectObjects(ids?: Array<string>): void
```

Programatically un-selects objects by ids.

**Parameters**

* *optional* **ids**: Array\< string >. If not specified everything gets unselected

**Returns**: void

## Typedefs

### SelectionExtensionOptions

```typescript  theme={null}
interface SelectionExtensionOptions {
  selectionMaterialData: RenderMaterial & DisplayStyle & MaterialOptions;
  hoverMaterialData?: RenderMaterial & DisplayStyle & MaterialOptions;
}
```

Options for configuring how the visual selection looks. If `hoverMaterialData` is not specified, there will be no hover effect.

<Tip>
  The selection/hover material data is provided as an intersection between a
  [*RenderMaterial*](/developers/viewer/speckle-material-api#rendermaterial),
  a [*DisplayStyle*](/developers/viewer/speckle-material-api#displaystyle)
  and a
  [*MaterialOptions*](/developers/viewer/speckle-material-api#materialoptions)
  in order to accomodate all renderable types: triangles, lines and points.
</Tip>

* **selectionMaterialData**: The material data for selection effect
* **hoverMaterialData**: The material data for hover effect. If not specified, hover will not be enabled

## Constants

### DefaultSelectionExtensionOptions

```typescript  theme={null}
const DefaultSelectionExtensionOptions: SelectionExtensionOptions = {
  selectionMaterialData: {
    id: MathUtils.generateUUID(),
    color: 0x047efb,
    opacity: 1,
    roughness: 1,
    metalness: 0,
    vertexColors: false,
    lineWeight: 1,
    stencilOutlines: true,
    pointSize: 4,
  },
};
```


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.speckle.systems/llms.txt
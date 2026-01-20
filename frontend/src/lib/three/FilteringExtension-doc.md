# FilteringExtension

> The default filtering functionality is exposed as an extension. The current filtering implementation works by providing an updated [_FilteringState_](/developers/viewer/extensions/filtering-extension-api#filteringstate) after each call to its functions. You can use this filtering state to keep track of filtering state.

## Accessors

### filteringState

```typescript  theme={null}
get filteringState(): FilteringState
```

Returns the current [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2).

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

## Methods

### hideObjects

```typescript  theme={null}
hideObjects(
    objectIds: string[],
    stateKey: string = null,
    includeDescendants = false,
    ghost = false
  ): FilteringState
```

Hides the specified object ids.

**Parameters**

* **objectIds**: The ids of the objects to hide
* *optional* **stateKey**: A way of splitting up commands coming from different controls (model explorer, filters, selection) so the viewer filtering api can know whether to reset its internal state or not
* *optional* **includeDescendants**: Whether to include the descendants of the provided object ids
* *optional* **ghost** Whether to ghost the rest of the objects

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### isolateObjects

```typescript  theme={null}
isolateObjects(
    objectIds: string[],
    stateKey: string = null,
    includeDescendants = true,
    ghost = true
  ): FilteringState
```

Hides the specified object ids.

**Parameters**

* **objectIds**: The ids of the objects to hide
* *optional* **stateKey**: A way of splitting up commands coming from different controls (model explorer, filters, selection) so the viewer filtering api can know whether to reset its internal state or not
* *optional* **includeDescendants**: Whether to include the descendants of the provided object ids
* *optional* **ghost** Whether to ghost the rest of the objects

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### isolateObjects

```typescript  theme={null}
removeColorFilter(): FilteringState
```

Removes any current color filters.

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### removeUserObjectColors

```typescript  theme={null}
removeUserObjectColors(): FilteringState
```

Removes any current user color filters.

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### resetFilters

```typescript  theme={null}
resetFilters(): FilteringState
```

Removes al the current filters.

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### setColorFilter

```typescript  theme={null}
setColorFilter(prop: PropertyInfo, ghost = true): FilteringState
```

Applies a color filter.

**Parameters**

* **prop**: [*PropertyInfo*](/developers/viewer/extensions/filtering-extension-api#propertyinfo)
* *optional* **ghost**" Whether to ghost the rest of the objects

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### setUserObjectColors

```typescript  theme={null}
setUserObjectColors(
    groups: { objectIds: string[]; color: string }[]
): FilteringState
```

Applies a user color filter.

<Tip>
  If used appropriately user color filters can typically be much more performant than applying multiple materials per color.
</Tip>

**Parameters**

* **groups**: Groups of objects organized by color

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### showObjects

```typescript  theme={null}
showObjects(
    objectIds: string[],
    stateKey: string = null,
    includeDescendants = false
  ): FilteringState
```

Shows the specified object ids.

**Parameters**

* **objectIds**: The ids of the objects to hide
* *optional* **stateKey**: A way of splitting up commands coming from different controls (model explorer, filters, selection) so the viewer filtering api can know whether to reset its internal state or not
* *optional* **includeDescendants**: Whether to include the descendants of the provided object ids

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

### unIsolateObjects

```typescript  theme={null}
unIsolateObjects(
    objectIds: string[],
    stateKey: string = null,
    includeDescendants = true,
    ghost = true
  ): FilteringState
```

Shows the specified object ids.

**Parameters**

* **objectIds**: The ids of the objects to hide
* *optional* **stateKey**: A way of splitting up commands coming from different controls (model explorer, filters, selection) so the viewer filtering api can know whether to reset its internal state or not
* *optional* **includeDescendants**: Whether to include the descendants of the provided object ids
* *optional* **ghost** Whether to ghost the rest of the objects

**Returns**: [*FilteringState*](/developers/viewer/extensions/filtering-extension-api#filteringstate-2)

## Typedefs

### FilteringState

```typescript  theme={null}
type FilteringState = {
  selectedObjects?: string[];
  hiddenObjects?: string[];
  isolatedObjects?: string[];
  colorGroups?: Record<string, string>[];
  userColorGroups?: { ids: string[]; color: string }[];
  activePropFilterKey?: string;
  passMin?: number | null;
  passMax?: number | null;
};
```

* **selectedObjects**: The current selected object ids
* **hidenObjects**: The current hidden object ids
* **isolatedObjects**: The current isolated object ids
* **colorGroups**: The current color groups
* **userColorGroups**: The current user color groups
* **activePropFilterKey**: The active property filtering key
* **passMin**: The minimal value of the property filtering value if numeric
* **passMax**: The maximum value of the property filtering value if numeric

### PropertyInfo

```typescript  theme={null}
interface PropertyInfo {
  key: string;
  objectCount: number;
  type: 'number' | 'string';
}
```

Outline of a filterable property.

* **key**: The property key
* **objectCount**: The object count where the key is present
* **type**: Property type


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.speckle.systems/llms.txt
> ## Documentation Index
> Fetch the complete documentation index at: https://docs.speckle.systems/llms.txt
> Use this file to discover all available pages before exploring further.

# WorldTree

> The WorldTree is a tree data structure that is used to store the scene graph.

## Constructors

### constructor

```typescript  theme={null}
new WorldTree();
```

**Returns**: [***WorldTree***](/developers/viewer/world-tree-api)

## Accessors

### nodeCount

```typescript  theme={null}
get nodeCount(): number
```

Gets the total node count for the tree.

**Returns**: number

### root

```typescript  theme={null}
get root(): TreeNode
```

Gets the root [*TreeNode*](/developers/viewer/world-tree-api#treenode).

**Returns**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

## Methods

### addNode

```typescript  theme={null}
addNode(node: TreeNode, parent: TreeNode): void
```

Adds a [*TreeNode*](/developers/viewer/world-tree-api#treenode) as a child of the provided parent node.

**Parameters**

* **node**: The [*TreeNode*](/developers/viewer/world-tree-api#treenode) to add
* **parent**: The parent [*TreeNode*](/developers/viewer/world-tree-api#treenode) to add the node to

**Returns**: void

### addSubtree

```typescript  theme={null}
addSubtree(node: TreeNode): void
```

Adds a [*TreeNode*](/developers/viewer/world-tree-api#treenode) as the root of a subtree.
The world tree can be split into subtrees, each of which will have it's dedicated
*NodeMap* for optimal searching speed. A subtree does not differ structurally from
a regular node, and it does not alter the overall hierarchy of the world tree in any way.

**Parameters**

* **node**: The [*TreeNode*](/developers/viewer/world-tree-api#treenode) to add as a subtree

**Returns**: void

### findAll

```typescript  theme={null}
findAll(predicate: SearchPredicate, node?: TreeNode): TreeNode[]
```

Goes throught the tree starting at *node* if provided, otherwise at the tree *root*
and runs the provided predicate for each node. All nodes which satisfy the predicate
are returned.

<Warning>
  Be mindful about the predicate's contents. If the tree is very large this operation
  can lock the main thread for too long. If you need to execute complex predicates
  on large trees, [*walkAsync*](/developers/viewer/world-tree-api#walkasync) is a better candidate.
</Warning>

**Parameters**

* **predicate**: The [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate)
  to run for each node
* *(optional)* **node**: The [*TreeNode*](/developers/viewer/world-tree-api#treenode) to
  start at. If not provided, the tree root will be used

**Returns**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)\[]

### findId

```typescript  theme={null}
findId(id: string, subtreeId?: number): TreeNode[]
```

Find a node by id. The optional *subtreeId* argument can narrow down the search
to a specific subtree, otherwise it will search the entire tree. It returns an
array of nodes because multiple nodes can have the same id, like in the case of instances.

<Tip>
  Using this method for tree searches is encouraged because it's accelerated by a
  backing *NodeMap* which brings down searches to just one or more lookups
</Tip>

**Parameters**

* **id**: The id of the node to search for
* *(optional)* **subtreeId**: The id of the subtree to search in. If *undefined*
  the search will include the entire tree

**Returns**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)\[]

### getAncestors

```typescript  theme={null}
getAncestors(node: TreeNode): TreeNode[]
```

Gets the full list of node ancestors in hierarchical order.

**Parameters**

* **node**: The node to search ancestors for

**Returns**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)\[]

### getInstances

```typescript  theme={null}
getInstances(subtree: string): { [id: string]: Record<string, TreeNode> }
```

Gets all the instances in the provided subtree id.

**Parameters**

* **subtree**: The root subtree id

**Returns**: A dictionary where each instance id holds a record of
[*TreeNode*](/developers/viewer/world-tree-api#treenode) grouped by their instance unique id.

### getRenderTree

```typescript  theme={null}
getRenderTree(): RenderTree
getRenderTree(subtreeId: string): RenderTree | null
```

Gets the [*RenderTree*](/developers/viewer/render-tree-api) instance of the provided subtree id.
If the subtree id is not found, `null` is returned. The overloaded version with
no argument gets the *RenderTree* instance for the entire tree, which can never be null.

**Parameters**

* **subtreeId**: The root subtree id

**Returns**: [*RenderTree*](/developers/viewer/render-tree-api)

### isRoot

```typescript  theme={null}
isRoot(node: TreeNode): boolean
```

Checks is a [*TreeNode*](/developers/viewer/world-tree-api#treenode) is root.

**Parameters**

* **node**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

**Returns**: boolean

### parse

```typescript  theme={null}
parse(model): TreeNode
```

Default way of creating [*TreeNode*](/developers/viewer/world-tree-api#treenode)s.
The input model needs to follow the form.

```
{
    id: string,
    raw?: object,
    atomic?: boolean,
    children?: []
}
```

The input *model* can contain virtually anything, but it should have at least the properties defined above.

**Parameters**

* **node**: `{ id: string, raw?: object, atomic?: boolean, children: []}`

**Returns**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

### purge

```typescript  theme={null}
purge(subtreeId?: string): void
```

Destroys part of the tree, or in the absence of a *subtreeId* argument, the entire tree.

<Warning>
  Purged trees are no longer usable!
</Warning>

**Parameters**

* *optional* **subtreeId**: The subtree root id. If undefined the whole tree will get purged

**Returns**: void

### removeNode

```typescript  theme={null}
removeNode(node: TreeNode): void
```

Removed the provided [*TreeNode*](/developers/viewer/world-tree-api#treenode) from the tree.

**Parameters**

* **node**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

**Returns**: void

### walk

```typescript  theme={null}
walk(predicate: SearchPredicate, node?: TreeNode): void
```

Walks the tree starting at *node* and executes the [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate)
for each node. If *node* argument is undefined, walking starts at root. Walking
is stopped when the predicate returns *false*.

<Warning>
  This function is **synchronous** and depending on the complexity of your
  [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate) and the total
  number of nodes, it might block the main thread. For a heavy
  [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate) use
  [*walkAsync*](/developers/viewer/world-tree-api#walkasync).
</Warning>

**Parameters**

* **predicate**: [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate)
* *optional* **node**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

**Returns**: void

### walkAsync

```typescript  theme={null}
async walkAsync(predicate: SearchPredicate, node?: TreeNode): Promise<boolean>
```

The asynchronous version of [*walk*](/developers/viewer/world-tree-api#walk). The function
will yield for 16ms (one frame) after a cummulated 100ms spent executing. The return
promise will resolve to a boolean which determines if the tree was completely
walked (true) or not (false).

**Parameters**

* **predicate**: [*SearchPredicate*](/developers/viewer/world-tree-api#searchpredicate)
* *optional* **node**: [*TreeNode*](/developers/viewer/world-tree-api#treenode)

**Returns**: Promise\< boolean >

## Typedefs

### NodeData

```typescript  theme={null}
interface NodeData {
  id: string;
  raw: { [prop: string]: any };
  children: TreeNode[];
  atomic: boolean;
  subtreeId?: number;
  renderView?: NodeRenderView;
  instanced?: boolean;
}
```

This is the data payload for each [*TreeNode*](/developers/viewer/world-tree-api#treenode).

* **raw**: Raw from node creation with [*parse*](/developers/viewer/world-tree-api#parse)
* **children**: Children [*TreeNode*](/developers/viewer/world-tree-api#treenode)s
* **atomic**: Whether this node is a complete object (true) or just part of another object (false)
* *optional* **subtreeId**: Assigned at runtime used for search acceleration
* *optional* **renderView**: Data required for everything rendering related
* *optional* **instanced**: Whether this node is an instance

### SearchPredicate

```typescript  theme={null}
type SearchPredicate = (node: TreeNode) => boolean;
```

Delegate type used in tree's [*findAll*](/developers/viewer/world-tree-api#findall),
[*walk*](/developers/viewer/world-tree-api#walk) and
[*walkAsync*](/developers/viewer/world-tree-api#walkasync) methods.

<Warning>
  When using the predicate in [*findAll*](/developers/viewer/world-tree-api#findall) the
  return value detemines if the current node matche the search(*true*) or not(*false*).
  When using the predicate in [*walk*](/developers/viewer/world-tree-api#walk) and
  [*walkAsync*](/developers/viewer/world-tree-api#walkasync), return *false* will stop
  the tree walking early.
</Warning>

### TreeNode

```typescript  theme={null}
type TreeNode = TreeModel.Node<NodeData>;
```

Abstraction of a tree node.
The tree is implemented on top of an existing tree
[library](https://github.com/joaonuno/tree-model-js) which defines the tree nodes
it's own way. At runtime the nodes will consist of:

```typescript  theme={null}
{
  children: Node[]
  config: {childrenPropertyName: 'children', modelComparatorFn: undefined}
  model: NodeData
  parent: TreeNode
}
```

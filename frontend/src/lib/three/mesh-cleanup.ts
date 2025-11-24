/**
 * Three.js Mesh Cleanup Utilities
 *
 * Helper functions for properly disposing of Three.js objects.
 * Prevents memory leaks by cleaning up geometries, materials, and textures.
 */

import * as THREE from "three";

/**
 * Dispose of a mesh and all its resources.
 *
 * Properly cleans up geometry, materials, and removes from scene.
 * Prevents memory leaks by disposing of GPU resources.
 *
 * @param mesh - The mesh to dispose
 * @param scene - Optional scene to remove the mesh from
 */
export function disposeMesh(mesh: THREE.Mesh, scene?: THREE.Scene): void {
  // Dispose geometry
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }

  // Dispose material(s)
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(material => material.dispose());
    } else {
      mesh.material.dispose();
    }
  }

  // Remove from scene if provided
  if (scene) {
    scene.remove(mesh);
  }
}

/**
 * Dispose of a group and all its children.
 *
 * Recursively disposes of all meshes in the group.
 *
 * @param group - The group to dispose
 * @param scene - Optional scene to remove the group from
 */
export function disposeGroup(group: THREE.Group, scene?: THREE.Scene): void {
  // Dispose all children
  group.children.forEach(child => {
    if (child instanceof THREE.Mesh) {
      disposeMesh(child);
    } else if (child instanceof THREE.Group) {
      disposeGroup(child);
    }
  });

  // Remove from scene if provided
  if (scene) {
    scene.remove(group);
  }
}

/**
 * Clear all meshes from a scene.
 *
 * Removes and disposes of all Mesh and Group objects in the scene.
 * Leaves lights, cameras, and other objects intact.
 *
 * @param scene - The scene to clear
 * @param predicate - Optional filter function (return true to dispose)
 */
export function clearMeshes(
  scene: THREE.Scene,
  predicate?: (object: THREE.Object3D) => boolean
): void {
  const objectsToRemove: THREE.Object3D[] = [];

  scene.traverse(object => {
    const shouldRemove = predicate ? predicate(object) : true;

    if (shouldRemove) {
      if (object instanceof THREE.Mesh) {
        disposeMesh(object);
        objectsToRemove.push(object);
      } else if (object instanceof THREE.Group) {
        objectsToRemove.push(object);
      }
    }
  });

  objectsToRemove.forEach(object => {
    if (object.parent) {
      object.parent.remove(object);
    }
  });
}

/**
 * Dispose of a line object.
 *
 * @param line - The line to dispose
 * @param scene - Optional scene to remove the line from
 */
export function disposeLine(line: THREE.Line, scene?: THREE.Scene): void {
  if (line.geometry) {
    line.geometry.dispose();
  }

  if (line.material) {
    if (Array.isArray(line.material)) {
      line.material.forEach(material => material.dispose());
    } else {
      line.material.dispose();
    }
  }

  if (scene) {
    scene.remove(line);
  }
}

/**
 * Dispose of any Three.js object and its resources.
 *
 * Handles Mesh, Group, Line, and other common object types.
 *
 * @param object - The object to dispose
 * @param scene - Optional scene to remove the object from
 */
export function disposeObject(object: THREE.Object3D, scene?: THREE.Scene): void {
  if (object instanceof THREE.Mesh) {
    disposeMesh(object, scene);
  } else if (object instanceof THREE.Line) {
    disposeLine(object, scene);
  } else if (object instanceof THREE.Group) {
    disposeGroup(object, scene);
  } else if (scene) {
    scene.remove(object);
  }
}

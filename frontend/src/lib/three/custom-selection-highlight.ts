/**
 * CustomSelectionHighlight
 *
 * Draws a box outline around each sound sphere / listener in a multi-selection,
 * so the user can see which objects the shared drag gizmo will move. A single
 * selection is shown by the gizmo alone (no outline).
 *
 * Owned by SpeckleDragHandler: `set()` on selection change, `update()` every
 * frame (objects are screen-space scaled and may move), `clear()` on deselect.
 */

import * as THREE from 'three';
import { ObjectLayers } from '@speckle/viewer';
import { getCssColorHex } from '@/utils/utils';
import { CUSTOM_SELECTION_HIGHLIGHT } from '@/utils/constants';

export class CustomSelectionHighlight {
  private scene: THREE.Scene;
  private helpers: THREE.BoxHelper[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public set(objects: THREE.Object3D[]): void {
    this.clear();
    if (objects.length < 2) return;

    const color = getCssColorHex(CUSTOM_SELECTION_HIGHLIGHT.COLOR_VAR);
    for (const object of objects) {
      // Surface markers are empty groups — nothing to outline.
      if (new THREE.Box3().setFromObject(object).isEmpty()) continue;

      const helper = new THREE.BoxHelper(object, color);
      const material = helper.material as THREE.LineBasicMaterial;
      material.depthTest = false;
      material.transparent = true;
      material.opacity = CUSTOM_SELECTION_HIGHLIGHT.OPACITY;
      helper.renderOrder = CUSTOM_SELECTION_HIGHLIGHT.RENDER_ORDER;
      // Same layer as the drag gizmo so Speckle renders it but never picks it.
      helper.layers.set(ObjectLayers.PROPS);
      this.scene.add(helper);
      this.helpers.push(helper);
    }
  }

  public update(): void {
    for (const helper of this.helpers) helper.update();
  }

  public clear(): void {
    for (const helper of this.helpers) {
      this.scene.remove(helper);
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.helpers = [];
  }
}

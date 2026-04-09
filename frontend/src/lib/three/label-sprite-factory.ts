import * as THREE from 'three';
import { OBJECT_LABEL } from '@/utils/constants';

/**
 * Create a canvas-based label sprite for a 3D object.
 *
 * The sprite's scale is updated every frame by the manager's updateScreenSpaceScale()
 * so it stays a constant apparent size regardless of camera distance.
 *
 * The `userData.aspectRatio` field stores the canvas width/height ratio so the
 * caller can scale width proportionally when setting world height.
 * The `userData.labelText` field stores the text so callers can detect name changes.
 */
export function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  const font = `bold ${OBJECT_LABEL.FONT_SIZE}px sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  const padH = OBJECT_LABEL.PADDING_H;
  const padV = OBJECT_LABEL.PADDING_V;
  const canvasW = Math.ceil(textWidth + padH * 2);
  const canvasH = Math.ceil(OBJECT_LABEL.FONT_SIZE + padV * 2);

  canvas.width = canvasW;
  canvas.height = canvasH;

  // Re-set font after canvas resize (resize clears the context state)
  ctx.font = font;

  // Background pill
  ctx.fillStyle = OBJECT_LABEL.BG_COLOR;
  ctx.beginPath();
  ctx.roundRect(0, 0, canvasW, canvasH, OBJECT_LABEL.BORDER_RADIUS);
  ctx.fill();

  // Label text
  ctx.fillStyle = OBJECT_LABEL.TEXT_COLOR;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvasW / 2, canvasH / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });

  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = OBJECT_LABEL.RENDER_ORDER;
  sprite.layers.enable(0);
  sprite.layers.enable(4); // OVERLAY layer for custom objects
  sprite.userData.aspectRatio = canvasW / canvasH;
  sprite.userData.labelText = text;
  sprite.userData.isLabel = true;

  return sprite;
}

/** Dispose a label sprite's GPU resources. */
export function disposeLabelSprite(sprite: THREE.Sprite): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}

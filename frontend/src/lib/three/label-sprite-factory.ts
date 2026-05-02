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

  // Render at device pixel ratio so the texture stays crisp at any scale.
  // Cap at 3× to avoid unnecessarily large textures on very high-DPI screens.
  const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2, 3);

  const font = `bold ${OBJECT_LABEL.FONT_SIZE}px sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  const padH = OBJECT_LABEL.PADDING_H;
  const padV = OBJECT_LABEL.PADDING_V;
  // Logical (CSS) dimensions
  const logicalW = Math.ceil(textWidth + padH * 2);
  const logicalH = Math.ceil(OBJECT_LABEL.FONT_SIZE + padV * 2);

  // Physical canvas dimensions — scaled up for crisp texture
  canvas.width = Math.ceil(logicalW * dpr);
  canvas.height = Math.ceil(logicalH * dpr);

  // Scale context so all drawing commands use logical coordinates
  ctx.scale(dpr, dpr);

  // Re-set font after canvas resize (resize clears the context state)
  ctx.font = font;

  // Background pill
  ctx.fillStyle = 'rgba(20, 20, 20, 0.80)';
  ctx.beginPath();
  ctx.roundRect(0, 0, logicalW, logicalH, OBJECT_LABEL.BORDER_RADIUS);
  ctx.fill();

  // Label text
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, logicalW / 2, logicalH / 2);

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
  // Aspect ratio is computed from logical dimensions so the world-space scale
  // calculation in updateScreenSpaceScale() remains correct.
  sprite.userData.aspectRatio = logicalW / logicalH;
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

import * as THREE from 'three';
import { OBJECT_LABEL } from '@/utils/constants';

/**
 * Draw (or redraw) the label pill + text onto a canvas.
 * Shared by createLabelSprite and updateLabelSprite so text changes re-render
 * the SAME canvas in place — no sprite recreation, so the label never flashes
 * at the default (huge) scale for a frame.
 *
 * @param canvas - Target canvas (gets resized to fit the text)
 * @param renderScale - Resolution multiplier applied to the logical (CSS) size
 * @param text - Label text
 * @returns Logical canvas dimensions { width, height } (used for aspect ratio)
 */
function renderLabelCanvas(
  canvas: HTMLCanvasElement,
  renderScale: number,
  text: string,
): { width: number; height: number } {
  const ctx = canvas.getContext('2d')!;

  const font = `bold ${OBJECT_LABEL.FONT_SIZE}px sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;

  const padH = OBJECT_LABEL.PADDING_H;
  const padV = OBJECT_LABEL.PADDING_V;
  // Logical (CSS) dimensions
  const logicalW = Math.ceil(textWidth + padH * 2);
  const logicalH = Math.ceil(OBJECT_LABEL.FONT_SIZE + padV * 2);

  // Physical canvas dimensions — high resolution for a crisp texture at any zoom.
  // Setting canvas.width/height resets the 2D context state, so everything
  // (including the scale) must be re-applied after the resize.
  canvas.width = Math.ceil(logicalW * renderScale);
  canvas.height = Math.ceil(logicalH * renderScale);

  // Scale context so all drawing commands use logical coordinates
  ctx.scale(renderScale, renderScale);

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

  return { width: logicalW, height: logicalH };
}

/**
 * Create a canvas-based label sprite for a 3D object.
 *
 * The sprite's scale is updated every frame by the manager's updateScreenSpaceScale()
 * so it stays at a constant fraction of the viewport height regardless of camera
 * distance or screen size.
 *
 * `userData.aspectRatio` stores the canvas width/height ratio so the caller can
 * scale width proportionally when setting world height.
 * `userData.labelText` stores the text so callers can detect name changes.
 * `userData.renderScale` stores the canvas resolution multiplier so updateLabelSprite
 * can redraw at the same resolution.
 */
export function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');

  // Render at device pixel ratio so the texture stays crisp at any scale,
  // multiplied by an extra factor so it survives being scaled up when zoomed
  // in close. Cap DPR at 3 to avoid absurdly large textures on very high-DPI screens.
  const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2, 3);
  const renderScale = dpr * OBJECT_LABEL.RENDER_SCALE;

  const { width: logicalW, height: logicalH } = renderLabelCanvas(canvas, renderScale, text);

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
  sprite.userData.renderScale = renderScale;

  return sprite;
}

/**
 * Update an existing label sprite's text in place by redrawing its canvas.
 * Keeps the same sprite object (and therefore the same scale), so changing the
 * text never flashes the label at a wrong size for a frame.
 *
 * @param sprite - Label sprite to update
 * @param text - New label text
 */
export function updateLabelSprite(sprite: THREE.Sprite, text: string): void {
  const material = sprite.material as THREE.SpriteMaterial;
  const map = material.map as THREE.CanvasTexture | null;
  if (!map) return;

  const canvas = map.image as HTMLCanvasElement;
  if (!canvas) return;

  const renderScale =
    (sprite.userData.renderScale as number) ??
    Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 2) : 2, 3) * OBJECT_LABEL.RENDER_SCALE;

  const { width: logicalW, height: logicalH } = renderLabelCanvas(canvas, renderScale, text);

  // Replace the old GPU texture with a fresh one created from the updated
  // canvas. Setting only map.needsUpdate = true is subject to render-timing
  // issues in on-demand renderers (Speckle viewer). A new texture object
  // forces a fresh GPU upload on the next render regardless of timing.
  map.dispose();
  const newTexture = new THREE.CanvasTexture(canvas);
  newTexture.minFilter = THREE.LinearFilter;
  newTexture.magFilter = THREE.LinearFilter;
  material.map = newTexture;
  material.needsUpdate = true;

  sprite.userData.aspectRatio = logicalW / logicalH;
  sprite.userData.labelText = text;
}

/** Dispose a label sprite's GPU resources. */
export function disposeLabelSprite(sprite: THREE.Sprite): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}

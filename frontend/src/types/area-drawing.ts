/**
 * Area Drawing Types
 *
 * Types for the polygon area drawing feature on Text Context cards.
 * Users draw a polygon on the 3D model surface to constrain
 * sound positions and optionally filter Speckle objects for LLM context.
 */

/**
 * A single vertex on the polygon, with its 3D position and surface normal.
 */
export interface PolygonVertex {
  position: [number, number, number];
  normal: [number, number, number];
}

/**
 * A completed drawn area polygon associated with a specific analysis card.
 */
export interface DrawnArea {
  /** Index of the analysis card this area belongs to */
  cardIndex: number;
  /** 3D vertices of the polygon */
  vertices: PolygonVertex[];
  /** Origin point of the drawing plane (first vertex position) */
  planeOrigin: [number, number, number];
  /** Normal of the drawing plane (first vertex normal) */
  planeNormal: [number, number, number];
  /** 2D projected vertices for point-in-polygon tests */
  projectedVertices: [number, number][];
  /** 3D position for the label sprite */
  labelPosition: [number, number, number];
  /** Display name shown on the label */
  displayName: string;
}

/**
 * Visual state of a completed area in the 3D scene.
 * - 'default': light fill, waiting for generation
 * - 'generated': darker fill, sound positions have been computed
 */
export type AreaVisualState = 'default' | 'generated';

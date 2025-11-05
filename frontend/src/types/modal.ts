/**
 * Modal Analysis Types
 * 
 * Types for modal analysis, resonant frequencies, and impact sound synthesis
 */

// ============================================================================
// Modal Analysis Request/Response
// ============================================================================

export interface ModalAnalysisRequest {
  vertices: number[][];
  faces: number[][];
  num_modes?: number;
  material?: string;
  young_modulus?: number;
  poisson_ratio?: number;
  density?: number;
}

export interface MaterialProperties {
  young_modulus: number;
  poisson_ratio: number;
  density: number;
}

export interface MeshInfo {
  num_vertices: number;
  num_faces: number;
  dimensions: number[];
  mesh_quality?: string;
}

export interface FrequencyResponse {
  fundamental_frequency: number;
  quality_factor: number;
  damping_ratio: number;
  bandwidths: number[];
  frequency_ratios: number[];
}

export interface ModeShapeVisualization {
  displacement_magnitudes: number[];   // Normalized displacement per vertex (0-1)
  displacement_vectors: number[][];    // 3D displacement vectors [[dx,dy,dz], ...]
  max_displacement: number;            // Maximum displacement magnitude
}

export interface ModalAnalysisResult {
  frequencies: number[];              // Resonant frequencies (Hz)
  mode_shapes: number[][];            // Mode shape vectors (FEM format)
  mode_shape_visualizations: ModeShapeVisualization[];  // Vertex-mapped for visualization
  material_properties: MaterialProperties;
  mesh_info: MeshInfo;
  num_modes_computed: number;
  frequency_response?: FrequencyResponse;
}

// ============================================================================
// Impact Sound Synthesis
// ============================================================================

export interface ImpactPoint {
  x: number;
  y: number;
  z: number;
}

export interface ImpactParameters {
  position: ImpactPoint;              // Impact location in 3D space
  velocity: number;                   // Impact velocity (m/s) - affects amplitude
  dampingRatio?: number;              // Structural damping ratio (0-1)
  duration?: number;                  // Sound duration (seconds)
  material?: string;                  // Material preset name
}

export interface ModeContribution {
  frequency: number;                  // Mode frequency (Hz)
  amplitude: number;                  // Mode amplitude (0-1)
  damping: number;                    // Mode-specific damping
  phase: number;                      // Initial phase (radians)
}

export interface SynthesisParameters {
  modes: ModeContribution[];          // Array of mode contributions
  sampleRate: number;                 // Audio sample rate (Hz)
  duration: number;                   // Total duration (seconds)
  outputGain: number;                 // Master output gain (0-1)
}

// ============================================================================
// Modal Analysis State
// ============================================================================

export interface ModalAnalysisState {
  isAnalyzing: boolean;
  result: ModalAnalysisResult | null;
  error: string | null;
}

// ============================================================================
// Impact Synthesis State
// ============================================================================

export interface ImpactSynthesisState {
  isSynthesizing: boolean;
  audioBuffer: AudioBuffer | null;
  isPlaying: boolean;
  error: string | null;
}

// ============================================================================
// Mode Visualization State
// ============================================================================

export interface ModeVisualizationState {
  isActive: boolean;                  // Whether mode visualization is active
  selectedModeIndex: number | null;   // Index of currently displayed mode (0-based)
}

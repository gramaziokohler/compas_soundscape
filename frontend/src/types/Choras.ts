// CHORAS Types to request and send data to/from the backend

export interface Material {
  id: number;
  name: string;
  description?: string;
  category?: string;
}

export interface ModelSurface {
  id: string; // The UUID string from the .obj file (e.g. "16f937d3...")
  name: string;
}

export interface ModelInfo {
  id: number;
  name: string;
  materials: ModelSurface[]; // List of surfaces found in the uploaded object
}

export interface SimulationSettings {
  de_c0: number;        // Speed of sound (343)
  de_ir_length: number; // Impulse response length (0.2)
  de_lc: number;        // Characteristic length (1.0)
  edt: number;          // Energy decay threshold (35)
  sim_len_type: "ir_length" | "edt";
}

export interface SolverSettings {
  simulationSettings: SimulationSettings;
}

// The exact payload structure your backend expects for creating a simulation
export interface SimulationCreatePayload {
  modelId: number;
  name: string;
  description?: string;
  taskType: "DE" | "DG"; // Enum based on your logs
  layerIdByMaterialId: Record<string, number>; // Maps Surface UUID -> Material ID
  solverSettings: SolverSettings;
  sources: SourceReceiver[];
  receivers: SourceReceiver[];
}

export interface SourceReceiver {
  id: string;
  isValid: boolean;
  label: string;
  orderNumber: number;
  x: number;
  y: number;
  z: number;
}
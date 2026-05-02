# backend/models/schemas.py
# Pydantic Models for Request Bodies

from pydantic import BaseModel
from enum import Enum
from typing import Optional
from config.constants import DEFAULT_AUDIO_MODEL, DEFAULT_LLM_MODEL, DEFAULT_SPL_DB


class PromptRequest(BaseModel):
    prompt: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None
    llm_model: str = DEFAULT_LLM_MODEL


class SoundGenerationRequest(BaseModel):
    sounds: list[dict]
    bounding_box: dict | None = None
    apply_denoising: bool = False
    audio_model: str = DEFAULT_AUDIO_MODEL
    base_spl_db: float = DEFAULT_SPL_DB


class SoundGenerationStartResponse(BaseModel):
    generation_id: str


class SoundGenerationStatusResponse(BaseModel):
    generation_id: str
    progress: int           # 0–100
    status: str             # "Generating sound 3/5 (bird_chirp)..."
    completed: bool
    cancelled: bool
    error: Optional[str] = None
    result: Optional[list[dict]] = None      # final list of all generated sounds
    partial_sounds: Optional[list[dict]] = None  # sounds ready so far (incremental UX)
    queue_position: Optional[int] = None
    queue_total: Optional[int] = None


class LLMGenerationStartResponse(BaseModel):
    generation_id: str


class LLMGenerationStatusResponse(BaseModel):
    generation_id: str
    progress: int
    status: str
    completed: bool
    cancelled: bool
    error: Optional[str] = None
    result: Optional[dict] = None   # {text, sounds, prompts, selected_entities}
    queue_position: Optional[int] = None
    queue_total: Optional[int] = None


class SEDAnalysisStartResponse(BaseModel):
    task_id: str


class SEDAnalysisStatusResponse(BaseModel):
    task_id: str
    progress: int
    status: str
    completed: bool
    cancelled: bool
    error: Optional[str] = None
    result: Optional[dict] = None  # {audio_info, detected_sounds, total_classes_analyzed}
    queue_position: Optional[int] = None
    queue_total: Optional[int] = None


class UnifiedPromptGenerationRequest(BaseModel):
    context: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None
    llm_model: str = DEFAULT_LLM_MODEL


class IRFormat(str, Enum):
    """Impulse response format enumeration"""
    MONO = "mono"
    BINAURAL = "binaural"
    FOA = "foa"
    TOA = "toa"


class ImpulseResponseMetadata(BaseModel):
    """Metadata for an impulse response file"""
    id: str
    url: str
    name: str
    format: IRFormat
    channels: int  # 1, 2, 4, or 16
    original_channels: int  # Original file channel count (may be higher)
    sample_rate: int
    duration: float  # Duration in seconds
    file_size: int  # Size in bytes


class ImpulseResponseListResponse(BaseModel):
    """Response containing list of available IRs"""
    impulse_responses: list[ImpulseResponseMetadata]


class ModalAnalysisRequest(BaseModel):
    """Request for modal analysis of a mesh"""
    vertices: list[list[float]]
    faces: list[list[int]]
    num_modes: Optional[int] = None
    material: Optional[str] = None  # Material preset name or custom properties
    young_modulus: Optional[float] = None  # Pa
    poisson_ratio: Optional[float] = None  # dimensionless
    density: Optional[float] = None  # kg/m³


class ModalAnalysisResponse(BaseModel):
    """Response containing modal analysis results"""
    frequencies: list[float]  # Resonant frequencies in Hz
    mode_shapes: list[list[float]]  # Mode shape vectors (FEM format)
    mode_shape_visualizations: list[dict]  # Vertex-mapped mode shapes for visualization
    material_properties: dict  # Material properties used
    mesh_info: dict  # Mesh statistics
    num_modes_computed: int
    frequency_response: Optional[dict] = None  # Optional frequency response data


# ============================================================================
# Pyroomacoustics Acoustic Simulation Schemas
# ============================================================================

class PyroomacousticsSettings(BaseModel):
    """Settings for pyroomacoustics simulation"""
    fs: int = 48000
    max_order: Optional[int] = None  # Auto-calculate if None
    use_ray_tracing: bool = False
    rir_duration: float = 1.0


class PyroomacousticsSimulationRequest(BaseModel):
    """Request for pyroomacoustics acoustic simulation"""
    room_dimensions: Optional[list[float]] = None  # [width, length, height]
    materials: dict[str, float]  # {"north": 0.03, "south": 0.03, ...}
    source_position: list[float]
    receiver_position: list[float]
    settings: PyroomacousticsSettings = PyroomacousticsSettings()


class AcousticParameters(BaseModel):
    """Acoustic parameters calculated from RIR"""
    rt60: float  # Reverberation time (s)
    edt: float  # Early decay time (s)
    c50: float  # Speech clarity (dB)
    spl: float  # Sound pressure level (dB); physical for wave-based, relative energy for others
    d50: float  # Definition (0-1)
    drr: float  # Direct-to-reverberant ratio (dB)


class PyroomacousticsSimulationResponse(BaseModel):
    """Response from pyroomacoustics simulation"""
    rir_url: str
    rir_path: str
    acoustic_parameters: AcousticParameters
    room_info: dict
    computation_time: float


class PyroomacousticsMaterial(BaseModel):
    """Material properties for acoustic simulation"""
    absorption: float
    description: str
    category: str


class PyroomacousticsMaterialsResponse(BaseModel):
    """Response containing material database"""
    materials: dict[str, PyroomacousticsMaterial]


# ============================================================================
# Speckle Model Schemas
# ============================================================================

class SpeckleModelAuthor(BaseModel):
    """Author info for a Speckle model"""
    id: str
    name: str
    avatar: Optional[str] = None


class SpeckleVersionSummary(BaseModel):
    """Summary of a single Speckle model version"""
    id: str
    message: Optional[str] = None
    source_application: Optional[str] = None
    referenced_object: Optional[str] = None
    created_at: Optional[str] = None
    author_name: Optional[str] = None


class SpeckleModelDetail(BaseModel):
    """Detailed info for a Speckle model"""
    id: str
    name: str
    display_name: str
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    preview_url: Optional[str] = None
    author: Optional[SpeckleModelAuthor] = None
    versions_count: int = 0
    latest_version: Optional[SpeckleVersionSummary] = None


class SpeckleProjectModelsResponse(BaseModel):
    """Response containing detailed list of models in a Speckle project"""
    project_id: str
    models: list[SpeckleModelDetail]
    total_count: int
    auth_token: Optional[str] = None


# ============================================================================
# Soundscape Data Persistence Schemas
# ============================================================================

class SoundscapeGlobalSettings(BaseModel):
    """Global generation settings for a soundscape session"""
    duration: float = 5.0
    steps: int = 25
    negative_prompt: str = ""
    audio_model: str = "tangoflux"


class SoundscapeSoundConfig(BaseModel):
    """Serializable sound configuration (one card)"""
    index: int
    prompt: str = ""
    type: Optional[str] = None  # CardType: "text-to-audio", "upload", "library"
    duration: float = 5.0
    display_name: Optional[str] = None
    spl_db: Optional[float] = None
    interval_seconds: Optional[float] = None
    entity_index: Optional[int] = None
    entity_node_id: Optional[str] = None  # Full Speckle object hash ID
    seed_copies: int = 1
    steps: int = 25


class SoundscapeSoundEvent(BaseModel):
    """Serializable sound event (generated/uploaded sound placed in 3D)"""
    id: str
    audio_filename: str  # filename only, not full URL
    position: list[float]  # [x, y, z]
    display_name: Optional[str] = None
    prompt: Optional[str] = None
    prompt_index: Optional[int] = None
    volume_db: Optional[float] = None
    current_volume_db: Optional[float] = None
    interval_seconds: Optional[float] = None
    current_interval_seconds: Optional[float] = None
    is_uploaded: bool = False
    entity_index: Optional[int] = None
    entity_node_id: Optional[str] = None  # Full Speckle object hash ID


class SoundscapeReceiver(BaseModel):
    """Serializable receiver position"""
    id: str
    name: str
    position: list[float]  # [x, y, z]
    type: Optional[str] = None


class SoundscapeIRMetadata(BaseModel):
    """Serializable impulse response metadata for persistence"""
    id: str
    url: str = ""  # Original URL (rewritten on restore)
    filename: str  # Filename only, used for persistent copy
    name: str
    format: str  # "mono", "binaural", "foa", "toa"
    channels: int
    original_channels: int
    sample_rate: int
    duration: float
    file_size: int
    normalization_convention: Optional[str] = None
    channel_ordering: Optional[str] = None


class SoundscapeSimulationSettings(BaseModel):
    """Serializable pyroomacoustics simulation settings"""
    max_order: int = 3
    ray_tracing: bool = False
    air_absorption: bool = True
    n_rays: int = 10000
    simulation_mode: str = "foa"
    enable_grid: bool = False


class SoundscapeSimulationConfig(BaseModel):
    """Serializable simulation configuration"""
    id: str
    display_name: str
    type: str  # "pyroomacoustics", "choras", "resonance"
    state: str = "completed"
    simulation_instance_id: Optional[str] = None
    settings: Optional[SoundscapeSimulationSettings] = None
    speckle_material_assignments: Optional[dict[str, str]] = None
    speckle_layer_name: Optional[str] = None
    speckle_geometry_object_ids: Optional[list[str]] = None
    speckle_scattering_assignments: Optional[dict[str, float]] = None
    simulation_results: Optional[str] = None
    current_simulation_id: Optional[str] = None
    imported_ir_ids: Optional[list[str]] = None
    source_receiver_ir_mapping: Optional[dict[str, dict[str, SoundscapeIRMetadata]]] = None
    receiver_positions: Optional[dict[str, list[float]]] = None  # receiverId -> [x, y, z]


class SoundscapeData(BaseModel):
    """Full soundscape data package"""
    version: str = "1.0"
    model_id: str
    model_name: str = ""
    created_at: str = ""  # ISO datetime
    global_settings: SoundscapeGlobalSettings = SoundscapeGlobalSettings()
    sound_configs: list[SoundscapeSoundConfig] = []
    sound_events: list[SoundscapeSoundEvent] = []
    # Simulation persistence (all optional, backward-compatible)
    receivers: list[SoundscapeReceiver] = []
    selected_receiver_id: Optional[str] = None
    simulation_configs: list[SoundscapeSimulationConfig] = []
    active_simulation_index: Optional[int] = None


class SoundscapeSaveRequest(BaseModel):
    """Request to save soundscape data"""
    soundscape_data: SoundscapeData
    audio_urls: list[str] = []  # Audio file URLs to copy
    ir_urls: list[str] = []  # IR file URLs to copy


# ============================================================================
# Choras (DE/DG Wave Simulation) Schemas
# ============================================================================

class ChorasDESettings(BaseModel):
    """Settings for DE (Diffusion Equation / FVM) simulation."""
    de_c0: float = 343.0
    de_lc: float = 1.5
    frequencies: list[int] = [125, 250, 500, 1000, 2000]


class ChorasDGSettings(BaseModel):
    """Settings for DG (Discontinuous Galerkin) simulation."""
    dg_freq_upper_limit: float = 200.0
    dg_c0: float = 343.0
    dg_rho0: float = 1.213
    dg_poly_order: int = 4
    dg_ppw: float = 2.0
    dg_cfl: float = 1.0
    frequencies: list[int] = [125, 250, 500, 1000, 2000]


class ChorasSimulationResult(BaseModel):
    """Response from a completed Choras simulation."""
    simulation_id: str
    message: str
    ir_files: list[str]
    results_file: str
    method: str   # "DE" or "DG"


class ChorasSimulationStartResponse(BaseModel):
    """Immediate response when a simulation is queued (non-blocking)."""
    simulation_id: str
    total_steps: int   # number of pairs (DE) or source groups (DG)
    method: str        # "DE" or "DG"


class ChorasSimulationStatusResponse(BaseModel):
    """Response from the polling status endpoint."""
    simulation_id: str
    progress: int      # 0-100
    status: str
    completed: bool
    cancelled: bool
    error: Optional[str] = None
    result: Optional[ChorasSimulationResult] = None  # populated when completed=True
    queue_position: Optional[int] = None
    queue_total: Optional[int] = None


# ============================================================================
# Pyroomacoustics Async Queue Schemas
# ============================================================================

class PyroomacousticsSimulationStartResponse(BaseModel):
    """Immediate response when a pyroomacoustics simulation is queued (non-blocking)."""
    simulation_id: str


class PyroomacousticsSimulationResult(BaseModel):
    """Result from a completed pyroomacoustics simulation."""
    simulation_id: str
    message: str
    ir_files: list[str]
    results_file: str


class PyroomacousticsSimulationStatusResponse(BaseModel):
    """Response from the pyroomacoustics polling status endpoint."""
    simulation_id: str
    progress: int           # 0–100
    status: str             # human-readable status string
    completed: bool
    cancelled: bool
    error: Optional[str] = None
    result: Optional[PyroomacousticsSimulationResult] = None
    queue_position: Optional[int] = None   # 1-based queue slot; None when running or done
    queue_total: Optional[int] = None      # total jobs in system (running + queued)


class SoundscapeSaveResponse(BaseModel):
    """Response from saving soundscape data"""
    success: bool
    speckle_object_id: Optional[str] = None
    local_folder: Optional[str] = None
    audio_files_copied: int = 0
    ir_files_copied: int = 0
    message: str = ""


class SoundscapeLoadResponse(BaseModel):
    """Response from loading soundscape data"""
    soundscape_data: Optional[SoundscapeData] = None
    audio_base_url: str = ""
    ir_base_url: str = ""
    found: bool = False

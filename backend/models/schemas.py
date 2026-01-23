# backend/models/schemas.py
# Pydantic Models for Request Bodies

from pydantic import BaseModel
from enum import Enum
from typing import Optional
from config.constants import DEFAULT_AUDIO_MODEL


class PromptRequest(BaseModel):
    prompt: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None


class SoundGenerationRequest(BaseModel):
    sounds: list[dict]
    bounding_box: dict | None = None
    apply_denoising: bool = False
    audio_model: str = DEFAULT_AUDIO_MODEL  # Model to use for generation


class IFCEntityInfo(BaseModel):
    index: int
    type: str
    name: str | None
    position: list[float]


class IFCSoundGenerationRequest(BaseModel):
    entities: list[IFCEntityInfo]
    max_sounds: int = 10


class IFCPromptGenerationRequest(BaseModel):
    entities: list[IFCEntityInfo]
    max_sounds: int = 10


class RhinoEntityInfo(BaseModel):
    index: int
    type: str
    name: str | None
    layer: str | None
    material: str | None
    position: list[float]


class RhinoSoundGenerationRequest(BaseModel):
    entities: list[RhinoEntityInfo]
    max_sounds: int = 10


class RhinoPromptGenerationRequest(BaseModel):
    entities: list[RhinoEntityInfo]
    max_sounds: int = 10


class UnifiedPromptGenerationRequest(BaseModel):
    context: str | None = None
    num_sounds: int = 5
    entities: list[dict] | None = None


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


class ImpulseResponseUploadRequest(BaseModel):
    """Request for uploading an impulse response"""
    name: str


class AuralizationSettings(BaseModel):
    """Settings for auralization"""
    enabled: bool = False
    ir_id: Optional[str] = None
    ir_format: Optional[IRFormat] = None
    wet_gain: float = 0.8  # Convolution output gain (0-1)
    dry_gain: float = 0.2  # Direct signal gain (0-1)
    

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
    c80: float  # Music clarity (dB)
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

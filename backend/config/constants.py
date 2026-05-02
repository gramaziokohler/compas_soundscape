"""
Application Constants

Centralized configuration constants extracted from various services and utilities.
This module eliminates magic numbers and promotes consistency across the codebase.
"""

import os
from pathlib import Path

# Get the backend directory path (parent of config/)
BACKEND_DIR = Path(__file__).parent.parent.resolve()

# ============================================================================
# LLM Configuration
# ============================================================================

# Task Cleanup Delays
SOUND_GENERATION_TASK_CLEANUP_DELAY_SECONDS = 600
LLM_TASK_CLEANUP_DELAY_SECONDS = 300
SED_TASK_CLEANUP_DELAY_SECONDS = 300

# Model Configuration
LLM_MODEL_GEMINI_FLASH = "gemini-2.5-flash"
LLM_MODEL_GEMINI_PRO = "gemini-2.5-pro"
LLM_MODEL_GEMINI_3_FLASH = "gemini-3-flash-preview"
LLM_MODEL_GEMINI_3_PRO = "gemini-3.1-pro-preview"
LLM_MODEL_OPENAI = "openai"
LLM_MODEL_ANTHROPIC = "anthropic"

DEFAULT_LLM_MODEL = LLM_MODEL_GEMINI_FLASH

# Provider keys — used in /api/versions response and availability checks
LLM_PROVIDER_GOOGLE    = "google"
LLM_PROVIDER_OPENAI    = "openai"
LLM_PROVIDER_ANTHROPIC = "anthropic"

# Maps each model key to its provider key
LLM_MODEL_TO_PROVIDER = {
    LLM_MODEL_GEMINI_FLASH:   LLM_PROVIDER_GOOGLE,
    LLM_MODEL_GEMINI_PRO:     LLM_PROVIDER_GOOGLE,
    LLM_MODEL_GEMINI_3_FLASH: LLM_PROVIDER_GOOGLE,
    LLM_MODEL_GEMINI_3_PRO:   LLM_PROVIDER_GOOGLE,
    LLM_MODEL_OPENAI:         LLM_PROVIDER_OPENAI,
    LLM_MODEL_ANTHROPIC:      LLM_PROVIDER_ANTHROPIC,
}

# Specific model versions mapped to each provider
LLM_MODEL_VERSIONS = {
    LLM_MODEL_GEMINI_FLASH: "gemini-2.5-flash",
    LLM_MODEL_GEMINI_PRO: "gemini-2.5-pro",
    LLM_MODEL_GEMINI_3_FLASH: "gemini-3-flash-preview",
    LLM_MODEL_GEMINI_3_PRO: "gemini-3.1-pro-preview",
    LLM_MODEL_OPENAI: "gpt-4o",
    LLM_MODEL_ANTHROPIC: "claude-3-5-sonnet-20241022",
}

# LLM Retry Configuration (for handling 503 overload errors)
LLM_MAX_RETRIES = 4  # Maximum number of retry attempts
LLM_INITIAL_RETRY_DELAY = 2.0  # Initial delay in seconds before first retry
LLM_MAX_RETRY_DELAY = 30.0  # Maximum delay in seconds between retries
LLM_BACKOFF_MULTIPLIER = 2.0  # Exponential backoff multiplier

# Default Sound Parameters (consolidated from multiple sources)
DEFAULT_SPL_DB = 70.0  # Default Sound Pressure Level in dB
DEFAULT_ENTITY_SPL_DB = 70.0  # Default SPL for entity prompts
LLM_SUGGESTED_INTERVAL_SECONDS = 30.0  # LLM-suggested interval between sounds
DEFAULT_DURATION_SECONDS = 5.0  # Default sound duration in seconds
DEFAULT_ENTITY_DURATION_SECONDS = 5.0  # Default duration for entity prompts

# SPL Range (dB)
SPL_MIN = 30.0
SPL_MAX = 120.0
SPL_RANGE = (SPL_MIN, SPL_MAX)

# Speed of sound (shared by all simulation methods)
DEFAULT_SPEED_OF_SOUND = 343.0  # m/s
SPEED_OF_SOUND_MIN = 300.0
SPEED_OF_SOUND_MAX = 400.0

# Interval Range (seconds)
INTERVAL_MIN = 5.0
INTERVAL_MAX = 300.0
INTERVAL_RANGE = (INTERVAL_MIN, INTERVAL_MAX)

# Duration Range (seconds)
DURATION_MIN = 5.0
DURATION_MAX = 25.0
DURATION_RANGE = (DURATION_MIN, DURATION_MAX)

# ============================================================================
# Audio Processing Configuration
# ============================================================================

# Audio Normalization
TARGET_RMS = 0.1  # Target RMS level for normalization
CLIPPING_THRESHOLD = 0.99  # Threshold to prevent clipping
SPL_CLIPPING_THRESHOLD = 0.99  # Threshold for SPL calibration clipping prevention

# Sample Rate
AUDIO_SAMPLE_RATE = 44100  # Browser default AudioContext sample rate in Hz (matches Web Audio API default)

# Audio Processing Thresholds
AUDIO_RMS_EPSILON = 1e-8  # Epsilon threshold for RMS calculation
DENOISING_REDUCTION_STRENGTH = 0.8  # Noise reduction strength (prop_decrease)

# ============================================================================
# Audio Generation Configuration
# ============================================================================

# Audio Generation Models
AUDIO_MODEL_TANGOFLUX = "tangoflux"
AUDIO_MODEL_AUDIOLDM2 = "audioldm2"
DEFAULT_AUDIO_MODEL = AUDIO_MODEL_TANGOFLUX  # Default model to use

# Device Configuration
# Set to false to force CPU mode (useful for systems with limited GPU memory)
FORCE_CPU_MODE = os.environ.get("FORCE_CPU_MODE", "false").lower() == "true"

# TangoFlux Model
TANGOFLUX_MODEL_NAME = "declare-lab/TangoFlux"

# AudioLDM2 Model
AUDIOLDM2_MODEL_NAME = "cvssp/audioldm2-large"
AUDIOLDM2_INFERENCE_STEPS = 200  # Default number of inference steps for AudioLDM2
AUDIOLDM2_NUM_WAVEFORMS = 1  # Number of waveforms to generate per prompt
AUDIOLDM2_SAMPLE_RATE = 16000  # AudioLDM2 output sample rate

# Default Generation Parameters (TangoFlux)
DEFAULT_GUIDANCE_SCALE = 4.5  # Default guidance scale for generation
DEFAULT_DIFFUSION_STEPS = 25  # Default number of diffusion steps
DEFAULT_SEED_COPIES = 1  # Default number of copies per sound
DEFAULT_INTERVAL_BETWEEN_SOUNDS = 0  # Default interval between sounds (sequential playback)

# Position Generation (for random placement)
DEFAULT_POSITION_SPACING = 5  # Spacing multiplier for x-axis
DEFAULT_POSITION_OFFSET = 1.5  # Offset multiplier for x-axis
DEFAULT_POSITION_Y = 1  # Default Y position
DEFAULT_POSITION_Z = 0  # Default Z position

# File Processing
FILENAME_MAX_LENGTH = 50  # Maximum length for filename from prompt
PARAM_HASH_LENGTH = 8  # Length of parameter hash for unique identification
DISPLAY_NAME_WORD_COUNT = 3  # Number of words to extract for display name

# Filename Sanitization
WINDOWS_ILLEGAL_FILENAME_CHARS = r'<>:"/\|?*'  # Windows illegal filename characters

# ============================================================================
# Pyroomacoustics Acoustic Simulation Configuration
# ============================================================================

# Simulation Modes
PYROOMACOUSTICS_SIMULATION_MODE_MONO = "mono"  # Single microphone (1 channel)
PYROOMACOUSTICS_SIMULATION_MODE_FOA = "foa"  # First-Order Ambisonics (4 channels: W, X, Y, Z)

# Default Simulation Settings
PYROOMACOUSTICS_DEFAULT_MAX_ORDER = 15  # Default max_order for image source method
PYROOMACOUSTICS_DEFAULT_RAY_TRACING = False  # Default ray tracing state
PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION = False  # Default air absorption state
PYROOMACOUSTICS_DEFAULT_RIR_DURATION = 1.0  # seconds
PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE = PYROOMACOUSTICS_SIMULATION_MODE_MONO  # Default simulation mode

# FOA Ambisonics Configuration
# B-format microphone: Uses directivity patterns (W=omni, Y/Z/X=figure-8) via MicrophoneArray.
# Directivity is applied to ISM; ray tracing uses omnidirectional fallback.

# Ray Tracing Configuration (Hybrid ISM/Ray Tracing)
PYROOMACOUSTICS_RAY_TRACING_N_RAYS = 10000  # Number of rays to shoot (default)
PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN = 1000  # Minimum number of rays
PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX = 50000  # Maximum number of rays
PYROOMACOUSTICS_RAY_TRACING_RECEIVER_RADIUS = 0.5  # Sphere radius around microphone (meters)
PYROOMACOUSTICS_RAY_TRACING_ENERGY_THRES = 1e-7  # Threshold for ray termination
PYROOMACOUSTICS_RAY_TRACING_TIME_THRES = 10.0  # Maximum ray flight time (seconds)
PYROOMACOUSTICS_RAY_TRACING_HIST_BIN_SIZE = 0.004  # Time granularity of energy bins (seconds)
PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER = 3  # Recommended max_order for hybrid simulator
PYROOMACOUSTICS_DEFAULT_SCATTERING = 0.05  # Default scattering coefficient (0-1)
PYROOMACOUSTICS_SCATTERING_MIN = 0.0  # Minimum scattering coefficient (specular reflection)
PYROOMACOUSTICS_SCATTERING_MAX = 1.0  # Maximum scattering coefficient (diffuse reflection)
PYROOMACOUSTICS_DEFAULT_ABSORPTION =  1.0  # Default surface absorption coefficient (0-1)

# Custom Materials (not in pyroomacoustics built-in database)
# Each entry follows the same format as the built-in database:
#   - description: Human-readable description
#   - coeffs: Absorption coefficients at each frequency band (0-1)
#   - center_freqs: Octave band center frequencies in Hz
PYROOMACOUSTICS_CUSTOM_MATERIALS = {
    "perfect_absorber": {
        "description": "Perfect absorber (fully absorptive at all frequencies)",
        "coeffs": [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000],
    },
    "almost_perfect_absorber": {
        "description": "Almost perfect absorber (fully absorptive at all frequencies)",
        "coeffs": [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99],
        "center_freqs": [125, 250, 500, 1000, 2000, 4000, 8000],
    },    
}
PYROOMACOUSTICS_MESH_WELD_TOLERANCE = 1e-4  # Vertex merge tolerance in meters (0.1 mm) for welding connected meshes
PYROOMACOUSTICS_SAMPLE_RATE = 44100  # Sample rate -- uses n_bands = math.floor(np.log2(SAMPLE_RATE / BASE_FREQUENCY))
PYROOMACOUSTICS_USE_RAND_ISM = False  # Use randomized ISM for better realism
PYROOMACOUSTICS_IR_TRIM_THRESHOLD = 0.01  # Fraction of peak amplitude below which trailing IR samples are trimmed
PYROOMACOUSTICS_TASK_CLEANUP_DELAY_SECONDS = 600  # 10 minutes after completion

# Parameter Ranges
PYROOMACOUSTICS_MAX_ORDER_MIN = 0  # Direct path only
PYROOMACOUSTICS_MAX_ORDER_MAX = 20

# Unit Scale Validation (source-to-receiver distance sanity check)
PYROOMACOUSTICS_UNIT_CHECK_MIN_DISTANCE_M = 0.05   # Below this → model likely in millimeters
PYROOMACOUSTICS_UNIT_CHECK_MAX_DISTANCE_M = 100.0  # Above this → model likely not in meters

# RIR Export
PYROOMACOUSTICS_RIR_DIR = str(BACKEND_DIR / "temp" / "static" / "pyroomacoustics_rir")
PYROOMACOUSTICS_RIR_URL_PREFIX = "/static/pyroomacoustics_rir"

# ============================================================================
# Directory Configuration - Temporary Files
# ============================================================================

# Parent Temporary Directory (all temp files go here)
TEMP_PARENT_DIR = str(BACKEND_DIR / "temp")

# Temporary Subdirectories (using absolute paths from BACKEND_DIR)
TEMP_UPLOADS_DIR = str(BACKEND_DIR / "temp" / "uploads")
TEMP_LIBRARY_DIR = str(BACKEND_DIR / "temp" / "library_downloads")
TEMP_SIMULATIONS_DIR = str(BACKEND_DIR / "temp" / "simulations")
TEMP_STATIC_DIR = str(BACKEND_DIR / "temp" / "static")

# ============================================================================
# Directory Configuration - Audio
# ============================================================================

# Generated Sounds Directory
GENERATED_SOUNDS_DIR = "./temp/static/sounds/generated"
GENERATED_SOUND_URL_PREFIX = "/static/sounds/generated"  # URL path prefix for generated sounds

# ============================================================================
# Sound Event Detection (SED) Configuration
# ============================================================================

# YAMNet Model
YAMNET_MODEL_URL = 'https://www.kaggle.com/models/google/yamnet/TensorFlow2/yamnet/1'

# Sample Rate
TARGET_SAMPLE_RATE = 16000  # YAMNet requires 16kHz audio

# Detection Parameters
DETECTION_THRESHOLD = 0.1  # Score threshold for class detection
FRAME_HOP_SECONDS = 0.48  # YAMNet frame hop duration
FRAME_WINDOW_SECONDS = 0.96  # YAMNet analysis window duration
DEFAULT_SED_NUM_SOUNDS = 10  # Default number of top sounds to return
DEFAULT_SED_TOP_N_CLASSES = 100  # Default maximum classes to analyze
SED_MIN_CONFIDENCE = 0.05  # Minimum confidence (mean_score) threshold for returning results

# Audio to dB Conversion
AMPLITUDE_TO_DB_EPSILON = 1e-10  # Epsilon threshold for amplitude to dB conversion
DB_REFERENCE_AMPLITUDE = 1.0  # Reference amplitude level for dB calculation
DURATION_FORMAT_PRECISION = 2  # Decimal precision for duration formatting

# CSV Processing
CSV_HEADER_SKIP_ROWS = 1  # Number of header rows to skip in CSV files

# ============================================================================
# BBC Sound Library Configuration
# ============================================================================

# BBC Search API (public web API)
BBC_API_URL = "https://sound-effects-api.bbcrewind.co.uk/api/sfx/search"
BBC_API_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Content-Type": "application/json",
    "Origin": "https://sound-effects.bbcrewind.co.uk",
    "Referer": "https://sound-effects.bbcrewind.co.uk/",
}
BBC_API_BATCH_SIZE = 20  # Items per API request (matches website default)
BBC_API_MAX_OFFSET = 900  # Maximum pagination offset (API depth limit)
BBC_API_REQUEST_DELAY = 0.2  # Delay between paginated requests (seconds)

# BBC Download
BBC_DOWNLOAD_URL_TEMPLATE = 'https://sound-effects-media.bbcrewind.co.uk/zip/{location}.wav.zip'
MACOSX_SYSTEM_FOLDER = '__MACOSX'  # macOS system folder to skip during extraction

# Search Parameters
MAX_SEARCH_RESULTS = 10  # Maximum number of search results to return
MAX_FILENAME_LENGTH_SAFE = 100  # Maximum filename length limit for safety

# ============================================================================
# Directory Configuration - Data Files
# ============================================================================

# Data Directories
SAMPLE_IFC_FILE_PATH = "data/Duplex_A_20110907.ifc"  # Sample IFC file for testing

# ============================================================================
# Web Server Configuration
# ============================================================================

# CORS Configuration
CORS_ORIGIN_LOCALHOST = "http://localhost"
CORS_ORIGIN_FRONTEND = "http://localhost:3000"
CORS_ORIGIN_NETWORK = "http://129.132.205.138:3000"  # Network access for frontend
CORS_ALLOW_ALL = "*"  # Allow all origins (use for development with dynamic network IPs)

# Static Files
STATIC_MOUNT_PATH = "/static"
STATIC_FILES_DIRECTORY = "temp/static"

# ============================================================================
# Freesound API Configuration
# ============================================================================

# Freesound API
FREESOUND_API_BASE_URL = "https://freesound.org/apiv2/"
FREESOUND_SEARCH_ENDPOINT = "search/text/"
FREESOUND_DOWNLOAD_DIR = "freesound_downloads"
FREESOUND_API_FIELDS = "id,name,previews,download,num_downloads"
FREESOUND_DEFAULT_SORT = "downloads_desc"
FREESOUND_TOP_RESULTS_COUNT = 3  # Top N results to download from Freesound
FREESOUND_DEFAULT_COUNT = 3  # Default number of search results

# HTTP Status Codes
HTTP_STATUS_UNAUTHORIZED = 401

# File Download
FILE_DOWNLOAD_CHUNK_SIZE = 8192  # Chunk size for file streaming download
MAX_EXTENSION_LENGTH = 5  # Maximum extension length validation

# ============================================================================
# Geometry Service Configuration
# ============================================================================

# Coordinate System Configuration
OBJ_ROTATE_Y_TO_Z = False  # Apply Y-up to Z-up rotation for OBJ files (disabled by default)

# Sphere Mesh Configuration
SPHERE_MESH_RESOLUTION_U = 16  # Sphere mesh resolution (u parameter)
SPHERE_MESH_RESOLUTION_V = 16  # Sphere mesh resolution (v parameter)
DEFAULT_SOUND_SOURCE_RADIUS = 0.2  # Default sphere radius for sound source visualization

# ============================================================================
# Modal Analysis Configuration
# ============================================================================

# Default Material Properties
MODAL_ANALYSIS_YOUNG_MODULUS = 200e9  # Young's modulus in Pa (200 GPa - steel)
MODAL_ANALYSIS_POISSON_RATIO = 0.3  # Poisson's ratio (dimensionless)
MODAL_ANALYSIS_DENSITY = 7850  # Density in kg/m³ (steel)

# Analysis Parameters
MODAL_ANALYSIS_NUM_MODES = 10  # Number of vibration modes to compute
MODAL_ANALYSIS_MESH_RESOLUTION = 8  # FE mesh resolution per dimension
MODAL_ANALYSIS_MIN_FREQUENCY = 0.1  # Minimum frequency to report (Hz)
MODAL_ANALYSIS_MAX_FREQUENCY = 20000  # Maximum frequency to report (Hz)
MODAL_ANALYSIS_TIMEOUT = 20.0  # Maximum time for analysis in seconds (prevents infinite loops)

# Mesh Validation Thresholds
MODAL_ANALYSIS_MAX_DEGENERATE_RATIO = 0.05  # Maximum ratio of degenerate triangles (5%)
MODAL_ANALYSIS_MAX_NONMANIFOLD_RATIO = 0.01  # Maximum ratio of non-manifold edges (1%)
MODAL_ANALYSIS_DEGENERATE_AREA_THRESHOLD = 1e-10  # Minimum triangle area (m²)
MODAL_ANALYSIS_VERTEX_COINCIDENCE_DECIMALS = 3 # Decimal places for detecting coincident vertices

# Material Presets (E, ν, ρ)
MODAL_ANALYSIS_MATERIALS = {
    "steel": {
        "young_modulus": 200e9,  # Pa
        "poisson_ratio": 0.3,
        "density": 7850,  # kg/m³
    },
    "aluminum": {
        "young_modulus": 69e9,  # Pa
        "poisson_ratio": 0.33,
        "density": 2700,  # kg/m³
    },
    "concrete": {
        "young_modulus": 30e9,  # Pa
        "poisson_ratio": 0.2,
        "density": 2400,  # kg/m³
    },
    "wood": {
        "young_modulus": 11e9,  # Pa (average for hardwood)
        "poisson_ratio": 0.3,
        "density": 700,  # kg/m³
    },
    "glass": {
        "young_modulus": 70e9,  # Pa
        "poisson_ratio": 0.24,
        "density": 2500,  # kg/m³
    },
}

# ============================================================================
# Audio Channel Configuration
# ============================================================================

# Audio Channel Names
AUDIO_CHANNEL_MONO = "Mono"  # Audio channel format description

# ============================================================================
# Impulse Response Configuration
# ============================================================================

# IR Formats
IR_FORMAT_MONO = "mono"
IR_FORMAT_BINAURAL = "binaural"
IR_FORMAT_FOA = "foa"  # First-Order Ambisonics (4 channels)
IR_FORMAT_SOA = "soa"  # Second-Order Ambisonics (9 channels)
IR_FORMAT_TOA = "toa"  # Third-Order Ambisonics (16 channels)

# Ambisonic Channel Counts
AMBISONIC_FOA_CHANNELS = 4
AMBISONIC_SOA_CHANNELS = 9
AMBISONIC_TOA_CHANNELS = 16

# Ambisonic Channel Names (ACN ordering)
AMBISONIC_FOA_CHANNEL_NAMES = ["W", "X", "Y", "Z"]
AMBISONIC_TOA_CHANNEL_NAMES = [
    "W",   # 0: Omnidirectional
    "Y",   # 1: Left-Right (1st order)
    "Z",   # 2: Up-Down (1st order)
    "X",   # 3: Front-Back (1st order)
    "V",   # 4: (2nd order)
    "T",   # 5: (2nd order)
    "R",   # 6: (2nd order)
    "S",   # 7: (2nd order)
    "U",   # 8: (2nd order)
    "Q",   # 9: (3rd order)
    "O",   # 10: (3rd order)
    "M",   # 11: (3rd order)
    "K",   # 12: (3rd order)
    "L",   # 13: (3rd order)
    "N",   # 14: (3rd order)
    "P",   # 15: (3rd order)
]

# Ambisonic Normalization
AMBISONIC_NORMALIZATION = "SN3D"  # Schmidt semi-normalized (standard)

# IR File Storage
IMPULSE_RESPONSE_DIR = "./temp/static/impulse_responses"
IMPULSE_RESPONSE_URL_PREFIX = "/static/impulse_responses"

# Supported IR Channel Counts
SUPPORTED_IR_CHANNELS = [1, 2, 4, 9, 16]  # Mono, Binaural, FOA, SOA, TOA

# Maximum IR channels to extract from files (e.g., from Odeon)
MAX_IR_CHANNELS = 16

# ============================================================================
# Choras (DE/DG Wave Simulation) Configuration
# ============================================================================

# Output directories (mirrors pyroomacoustics pattern)
CHORAS_RIR_DIR  = str(BACKEND_DIR / "temp" / "static" / "choras_rir")
CHORAS_TEMP_DIR = str(BACKEND_DIR / "temp" / "choras_sims")

# DE (Diffusion Equation / FVM) defaults
CHORAS_DE_DEFAULT_C0           = 343        # Speed of sound (m/s)
CHORAS_DE_DEFAULT_IR_LENGTH    = 0.5        # IR length in seconds
CHORAS_DE_DEFAULT_LC           = 1        # Mesh characteristic length (m)
CHORAS_DE_DEFAULT_EDT          = 35         # EDT target (dB)
CHORAS_DE_DEFAULT_SIM_LEN_TYPE = "edt"     # "edt" or "ir_length"
CHORAS_DE_SAMPLE_RATE          = 20000      # WAV sample rate (1/dt from DEinterface)

# DG (Discontinuous Galerkin) defaults
CHORAS_DG_DEFAULT_C0          = 343         # Speed of sound (m/s)
CHORAS_DG_DEFAULT_RHO0        = 1.213       # Air density (kg/m³)
CHORAS_DG_DEFAULT_IR_LENGTH   = 0.5         # IR length in seconds
CHORAS_DG_DEFAULT_FREQ_UPPER  = 200         # Upper frequency limit (Hz)
CHORAS_DG_DEFAULT_POLY_ORDER  = 4           # Polynomial order
CHORAS_DG_DEFAULT_PPW         = 2           # Points per wavelength
CHORAS_DG_DEFAULT_CFL         = 1.0         # CFL number
CHORAS_DG_SAMPLE_RATE         = 44100       # Output WAV sample rate

# Frequency bands (shared by DE and DG)
CHORAS_DEFAULT_FREQUENCIES = [125, 250, 500, 1000, 2000]

# Absorption material database (5-band: 125, 250, 500, 1000, 2000 Hz)
CHORAS_ABSORPTION_MATERIALS = {
    "concrete_plain": {
        "description": "Plain concrete (painted/unpainted)",
        "coeffs": [0.01, 0.01, 0.02, 0.02, 0.02],
    },
    "brick_unplastered": {
        "description": "Brick, unplastered",
        "coeffs": [0.02, 0.03, 0.03, 0.04, 0.05],
    },
    "plasterboard": {
        "description": "Plasterboard on battens",
        "coeffs": [0.15, 0.10, 0.06, 0.04, 0.04],
    },
    "wood_floor": {
        "description": "Parquet / wood floor on concrete",
        "coeffs": [0.04, 0.04, 0.07, 0.06, 0.06],
    },
    "carpet_thick": {
        "description": "Thick carpet on concrete",
        "coeffs": [0.02, 0.06, 0.14, 0.37, 0.60],
    },
    "glass_window": {
        "description": "Glass window",
        "coeffs": [0.35, 0.25, 0.18, 0.12, 0.07],
    },
    "acoustic_tile": {
        "description": "Acoustic ceiling tile",
        "coeffs": [0.15, 0.25, 0.55, 0.65, 0.65],
    },
    "medium_absorber": {
        "description": "Medium absorber (generic)",
        "coeffs": [0.60, 0.69, 0.71, 0.70, 0.63],
    },
}

# ============================================================================
# Speckle Configuration
# ============================================================================

# Speckle Server
SPECKLE_SERVER_URL = "app.speckle.systems"  # Without https://

# Speckle Project
SPECKLE_PROJECT_NAME = "soundscape-viewer"

# Supported File Formats for Speckle Upload
SPECKLE_SUPPORTED_FORMATS = ["3dm", "obj", "ifc"]

# ============================================================================
# Soundscape Data Persistence Configuration
# ============================================================================

# Local storage for saved soundscapes (per model_id)
# Lives outside temp/ so it is NOT cleared on startup by cleanup_all_temp_directories
SOUNDSCAPE_DATA_DIR = str(BACKEND_DIR / "data" / "soundscapes")
SOUNDSCAPE_DATA_URL_PREFIX = "/soundscapes"

# Speckle Soundscape Object Constants
# Pink color for entity-linked sound sources (ARGB signed 32-bit int: 0xFFF500B8)
SPECKLE_SOUNDSCAPE_PINK_COLOR = -720712
SPECKLE_SOUNDSCAPE_COLLECTION_NAME = "Soundscape"
SPECKLE_SOUND_SOURCES_COLLECTION_NAME = "Sound Sources"
SPECKLE_RECEIVERS_COLLECTION_NAME = "Receivers"

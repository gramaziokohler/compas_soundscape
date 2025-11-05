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

# Model Configuration
LLM_MODEL_NAME = "gemini-2.5-flash"

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

# Interval Range (seconds)
INTERVAL_MIN = 5.0
INTERVAL_MAX = 300.0
INTERVAL_RANGE = (INTERVAL_MIN, INTERVAL_MAX)

# Duration Range (seconds)
DURATION_MIN = 0.5
DURATION_MAX = 30.0
DURATION_RANGE = (DURATION_MIN, DURATION_MAX)

# ============================================================================
# Audio Processing Configuration
# ============================================================================

# Audio Normalization
TARGET_RMS = 0.1  # Target RMS level for normalization
CLIPPING_THRESHOLD = 0.99  # Threshold to prevent clipping
SPL_CLIPPING_THRESHOLD = 0.99  # Threshold for SPL calibration clipping prevention

# Sample Rate
AUDIO_SAMPLE_RATE = 44100  # Standard audio sample rate in Hz

# Audio Processing Thresholds
AUDIO_RMS_EPSILON = 1e-8  # Epsilon threshold for RMS calculation
DENOISING_REDUCTION_STRENGTH = 0.8  # Noise reduction strength (prop_decrease)

# ============================================================================
# Audio Generation Configuration
# ============================================================================

# TangoFlux Model
TANGOFLUX_MODEL_NAME = "declare-lab/TangoFlux"

# Default Generation Parameters
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
# Directory Configuration - Audio
# ============================================================================

# Generated Sounds Directory
GENERATED_SOUNDS_DIR = "./static/sounds/generated"
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

# Audio to dB Conversion
AMPLITUDE_TO_DB_EPSILON = 1e-10  # Epsilon threshold for amplitude to dB conversion
DB_REFERENCE_AMPLITUDE = 1.0  # Reference amplitude level for dB calculation
DURATION_FORMAT_PRECISION = 2  # Decimal precision for duration formatting

# CSV Processing
CSV_HEADER_SKIP_ROWS = 1  # Number of header rows to skip in CSV files

# ============================================================================
# BBC Sound Library Configuration
# ============================================================================

# BBC API
BBC_DOWNLOAD_URL_TEMPLATE = 'https://sound-effects-media.bbcrewind.co.uk/zip/{location}.zip'
MACOSX_SYSTEM_FOLDER = '__MACOSX'  # macOS system folder to skip during extraction

# Search Parameters
MAX_SEARCH_RESULTS = 5  # Maximum number of search results to return
DEFAULT_LIBRARY_MAX_RESULTS = 5  # Default max search results for library
CATEGORY_WEIGHT = 2.0  # Weight for category matching in search
DESCRIPTION_WEIGHT = 1.0  # Weight for description matching in search
MIN_MATCH_SCORE_THRESHOLD = 120  # Minimum score for a valid match
MAX_FILENAME_LENGTH_SAFE = 100  # Maximum filename length limit for safety

# ============================================================================
# Directory Configuration
# ============================================================================

# Temporary Directories (using absolute paths from BACKEND_DIR)
TEMP_UPLOADS_DIR = str(BACKEND_DIR / "temp_uploads")
TEMP_LIBRARY_DIR = str(BACKEND_DIR / "temp_library_downloads")
TEMP_DIR = str(BACKEND_DIR / "temp")

# Data Directories
BBC_LIBRARY_CSV_PATH = './data/BBCSoundEffects.csv'
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
STATIC_FILES_DIRECTORY = "static"

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
IR_FORMAT_TOA = "toa"  # Third-Order Ambisonics (16 channels)

# Ambisonic Channel Counts
AMBISONIC_FOA_CHANNELS = 4
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
IMPULSE_RESPONSE_DIR = "./static/impulse_responses"
IMPULSE_RESPONSE_URL_PREFIX = "/static/impulse_responses"

# Supported IR Channel Counts
SUPPORTED_IR_CHANNELS = [1, 2, 4, 16]  # Mono, Binaural, FOA, TOA

# Maximum IR channels to extract from files (e.g., from Odeon)
MAX_IR_CHANNELS = 16

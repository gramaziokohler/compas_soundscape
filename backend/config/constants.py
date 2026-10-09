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
# Gemini LLM models — only the latest Flash (3.8) and the current Pro (3.1) are
# offered. All Gemini 2.5 and older models have been removed.
LLM_MODEL_GEMINI_FLASH = "gemini-3.8-flash"
LLM_MODEL_GEMINI_PRO = "gemini-3.1-pro-preview"
LLM_MODEL_OPENAI = "openai"
LLM_MODEL_ANTHROPIC = "anthropic"

# Latest Flash model is the default.
DEFAULT_LLM_MODEL = LLM_MODEL_GEMINI_FLASH

# Provider keys — used in /api/versions response and availability checks
LLM_PROVIDER_GOOGLE    = "google"
LLM_PROVIDER_OPENAI    = "openai"
LLM_PROVIDER_ANTHROPIC = "anthropic"

# Maps each model key to its provider key
LLM_MODEL_TO_PROVIDER = {
    LLM_MODEL_GEMINI_FLASH:   LLM_PROVIDER_GOOGLE,
    LLM_MODEL_GEMINI_PRO:     LLM_PROVIDER_GOOGLE,
    LLM_MODEL_OPENAI:         LLM_PROVIDER_OPENAI,
    LLM_MODEL_ANTHROPIC:      LLM_PROVIDER_ANTHROPIC,
}

# Specific model versions mapped to each provider
LLM_MODEL_VERSIONS = {
    LLM_MODEL_GEMINI_FLASH: "gemini-3.8-flash",
    LLM_MODEL_GEMINI_PRO: "gemini-3.1-pro-preview",
    LLM_MODEL_OPENAI: "gpt-4o",
    LLM_MODEL_ANTHROPIC: "claude-3-5-sonnet-20241022",
}

# LLM Retry Configuration (for handling 503 overload errors)
LLM_MAX_RETRIES = 4  # Maximum number of retry attempts
LLM_INITIAL_RETRY_DELAY = 2.0  # Initial delay in seconds before first retry
LLM_MAX_RETRY_DELAY = 30.0  # Maximum delay in seconds between retries
LLM_BACKOFF_MULTIPLIER = 2.0  # Exponential backoff multiplier

# Live thought-summary progress (Gemini include_thoughts → job status_text)
LLM_PROGRESS_THROTTLE_S = 0.3
LLM_STATUS_TEXT_MAX_CHARS = 120
LLM_PROGRESS_THINKING_MIN = 8
LLM_PROGRESS_THINKING_MAX = 40
LLM_PROGRESS_WRITING_MIN = 40
LLM_PROGRESS_WRITING_MAX = 90

# 3D model analysis — entity grouping (utils/entity_grouping.py)
# Identical entities are collapsed into groups (G1, G2, …) so the prompt and the
# LLM's answer scale with the number of distinct object kinds, not entity count.
MODEL_ANALYSIS_MAX_INPUT_TOKENS = 20_000  # Hard cap on the text prompt (estimated)
MODEL_ANALYSIS_CHARS_PER_TOKEN = 4        # Cheap provider-agnostic token estimate
MODEL_ANALYSIS_SIZE_ROUND_M = 0.05        # Bbox-size rounding for the group signature
MODEL_ANALYSIS_PROMPT_SAMPLE_IDS = 5      # Speckle IDs kept per object in downstream agent prompts

# Default Sound Parameters (consolidated from multiple sources)
DEFAULT_DBFS = -18.0  # Default volume level in dBFS (decibels relative to full scale)
DEFAULT_ENTITY_DBFS = -18.0  # Default volume for entity prompts
LLM_SUGGESTED_INTERVAL_SECONDS = 30.0  # LLM-suggested interval between sounds
DEFAULT_DURATION_SECONDS = 5.0  # Default sound duration in seconds
DEFAULT_ENTITY_DURATION_SECONDS = 5.0  # Default duration for entity prompts

# dBFS Range (0 dBFS = digital full scale / clipping, so the range is negative)
DBFS_MIN = -60.0
DBFS_MAX = 0.0
DBFS_RANGE = (DBFS_MIN, DBFS_MAX)

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

# Foley Artist Configuration
DEFAULT_MAXIMUM_FOLEY_SOUNDS = 20  # Maximum total sound events across all scenarios

# Virtual room extents used to anchor scenario sound positions when no context
# model (3D layout analysis) is available. Speckle Z-up: X = width, Y = depth,
# Z = height, floor at z = 0. Keeps LLM-guessed [x, y, z] positions inside a
# plausible 6 x 10 x 3 m room instead of a tiny origin-centred cluster.
VIRTUAL_ROOM_DIMENSIONS = {"width": 6.0, "depth": 10.0, "height": 3.0}
VIRTUAL_ROOM_BOUNDS = {
    "min": [
        -VIRTUAL_ROOM_DIMENSIONS["width"] / 2,
        -VIRTUAL_ROOM_DIMENSIONS["depth"] / 2,
        0.0,
    ],
    "max": [
        VIRTUAL_ROOM_DIMENSIONS["width"] / 2,
        VIRTUAL_ROOM_DIMENSIONS["depth"] / 2,
        VIRTUAL_ROOM_DIMENSIONS["height"],
    ],
    **VIRTUAL_ROOM_DIMENSIONS,
}

# ============================================================================
# Audio Processing Configuration
# ============================================================================

# Audio Normalization
TARGET_RMS = 0.1  # Target RMS level for normalization
CLIPPING_THRESHOLD = 0.99  # Threshold to prevent clipping
DBFS_CLIPPING_THRESHOLD = 0.99  # Threshold for dBFS calibration clipping prevention

# Sample Rate
AUDIO_SAMPLE_RATE = 48000  # MASTER output sample rate (Hz) for every file the backend writes.
                           # Mirror of frontend/src/utils/constants.ts AUDIO_SAMPLE_RATE (AudioContext rate).
                           # Model/solver-native rates below are resampled to this via utils/resampling.py.
RESAMPLE_MAX_DENOMINATOR = 1000  # Max up/down factor when approximating a non-integer rate ratio (resample_poly)

# Audio Processing Thresholds
AUDIO_RMS_EPSILON = 1e-8  # Epsilon threshold for RMS calculation
DENOISING_REDUCTION_STRENGTH = 0.8  # Noise reduction strength (prop_decrease)

# Denoising – onset-based noise-profile detection
DENOISING_NOISE_PROFILE_DURATION = 0.5  # Desired duration (seconds) of noise profile to extract
DENOISING_NOISE_PROFILE_MIN_DURATION = 0.1  # Minimum silence before first onset to consider it usable
DENOISING_NOISE_PROFILE_RATIO = 0.1  # Noise clip is valid if its RMS < this fraction of overall peak amplitude
DENOISING_MIN_PEAK_AMPLITUDE = 0.001  # Below this peak the whole signal is silent — skip denoising
DENOISING_ONSET_HOP_LENGTH = 512  # Hop length (samples) for onset detection
DENOISING_ONSET_PRE_MARGIN = 0.02  # Seconds before first onset to exclude (avoids onset bleed)
DENOISING_TRIM_MERGE_THRESHOLD = 0.2  # Max silence (seconds) between SFX to merge into one continuous region

# Loop detection (seamless-loop region finder) — decimated-envelope search.
# The envelope is decimated to LOOP_FINDER_HOP_SEC resolution so the period scan
# is O(decimated²) instead of the O(n²) full-rate brute force that made the old
# client-side finder take minutes.
LOOP_FINDER_HOP_SEC = 0.01  # Decimation hop (seconds) for the energy envelope
LOOP_FINDER_MIN_LOOP_SEC = 0.5  # Shortest loop window to consider
LOOP_FINDER_MAX_SCAN_SEC = 8.0  # Longest loop window to consider
LOOP_FINDER_ALIGN_REPEATS = 3  # How many loop repeats are aligned when scoring a period
LOOP_FINDER_MIN_MATCH_SCORE = 0.5  # Normalized cross-correlation floor for an acceptable loop
LOOP_FINDER_LENGTH_PENALTY = 0.15  # Fractional score discount across the scan range, favoring shorter loops
LOOP_FINDER_TASK_CLEANUP_DELAY_SECONDS = 300  # Task state retention after completion

# ============================================================================
# Audio Generation Configuration
# ============================================================================

# Audio Generation Models
AUDIO_MODEL_TANGOFLUX = "tangoflux"
AUDIO_MODEL_AUDIOLDM2 = "audioldm2"
AUDIO_MODEL_SA3 = "stable-audio-3"  # StabilityAI stable-audio-3 (small-sfx)
AUDIO_MODEL_TTS = "gemini-tts"
DEFAULT_AUDIO_MODEL = AUDIO_MODEL_SA3  # Default model for text-to-audio

# Device Configuration
# Set to false to force CPU mode (useful for systems with limited GPU memory)
FORCE_CPU_MODE = os.environ.get("FORCE_CPU_MODE", "false").lower() == "true"

# TangoFlux Model
TANGOFLUX_MODEL_NAME = "declare-lab/TangoFlux"
TANGOFLUX_NATIVE_SAMPLE_RATE = 44100  # TangoFlux VAE output rate (resampled to AUDIO_SAMPLE_RATE)
# Optional: "bfloat16" halves VRAM (~9-10GB vs ~18-20GB fp32) at a small quality cost.
# Leave unset (None) for full fp32 precision.
TANGOFLUX_DTYPE = os.environ.get("TANGOFLUX_DTYPE") or None
# Local weights copy. Unlike the HF hub cache (symlinks, needs Windows Developer
# Mode/admin), downloading with `local_dir` copies plain files — required on Windows.
TANGOFLUX_LOCAL_DIR = os.environ.get("TANGOFLUX_LOCAL_DIR") or str(
    BACKEND_DIR / "data" / "models" / "TangoFlux"
)
# GPU worker warm-up generation (paid once at process startup, not per-request)
TANGOFLUX_WARMUP_DURATION_SECONDS = 1
TANGOFLUX_WARMUP_STEPS = 2

# AudioLDM2 Model
AUDIOLDM2_MODEL_NAME = "cvssp/audioldm2-large"
AUDIOLDM2_INFERENCE_STEPS = 200  # Default number of inference steps for AudioLDM2
AUDIOLDM2_NUM_WAVEFORMS = 1  # Number of waveforms to generate per prompt
AUDIOLDM2_SAMPLE_RATE = 16000  # AudioLDM2 native output rate (resampled to AUDIO_SAMPLE_RATE)

# Stable Audio 3 (StabilityAI) — text-to-audio, audio-to-audio and inpainting.
# Runs in an ISOLATED conda env (compas-sa3: Python 3.10, torch 2.7.1, transformers 5)
# because small-sfx needs T5GemmaEncoderModel, which is incompatible with the
# transformers 4.44 / numpy 1.26 pinned by TangoFlux in the main env. It is executed
# by a dedicated resident worker (workers/sa3_runner.py, --role sa3) launched with
# STABLE_AUDIO_PYTHON. Never import stable_audio_3 from the API process.
STABLE_AUDIO_MODEL_NAME = os.environ.get("STABLE_AUDIO_MODEL", "small-sfx")
# Interpreter of the isolated env that has `stable_audio_3` installed. Empty =
# resolved at launch time from the user's conda envs (see workers/sa3_runner.py).
STABLE_AUDIO_PYTHON = os.environ.get("STABLE_AUDIO_PYTHON", "")
# HuggingFace token for the gated stabilityai/stable-audio-3-small-sfx repo. The
# weights are already cached locally; set HF_HUB_OFFLINE=1 to load without a token.
STABLE_AUDIO_HF_TOKEN = os.environ.get("HF_TOKEN", "")
# Local weights cache root (mirrors TANGOFLUX_LOCAL_DIR). Optional.
STABLE_AUDIO_LOCAL_DIR = os.environ.get("STABLE_AUDIO_LOCAL_DIR", "")
# Generation defaults (see backend/stable_audio_3_test.py)
# Steps default to the app-wide diffusion-steps value (advanced settings);
# guidance is Stable Audio 3's CFG scale, kept in [0, 1] (0.9 recommended).
STABLE_AUDIO_DEFAULT_STEPS = 25
STABLE_AUDIO_DEFAULT_GUIDANCE = 0.9
STABLE_AUDIO_GUIDANCE_MIN = 0.0
STABLE_AUDIO_GUIDANCE_MAX = 1.0
STABLE_AUDIO_DEFAULT_INIT_NOISE_LEVEL = 0.9
STABLE_AUDIO_DEFAULT_DURATION_PADDING_S = 6.0
STABLE_AUDIO_DEFAULT_SAMPLER = "pingpong"
STABLE_AUDIO_AVAILABLE_SAMPLERS = ("pingpong", "euler", "rk4", "dpmpp")
STABLE_AUDIO_MIN_DURATION_S = 1.0
STABLE_AUDIO_MAX_DURATION_S = 380.0
# Generation modes
STABLE_AUDIO_MODE_TEXT = "text"
STABLE_AUDIO_MODE_RESTYLE = "restyle"  # audio-to-audio (init_audio + init_noise_level)
STABLE_AUDIO_MODE_INPAINT = "inpaint"  # regenerate masked region(s)
STABLE_AUDIO_MODE_EXTEND = "extend"  # continuation: inpaint a region reaching the tail
STABLE_AUDIO_MODES = (
    STABLE_AUDIO_MODE_TEXT,
    STABLE_AUDIO_MODE_RESTYLE,
    STABLE_AUDIO_MODE_INPAINT,
    STABLE_AUDIO_MODE_EXTEND,
)
# Inpaint regions are [start_seconds, end_seconds] pairs; the mask is 0 (regenerate)
# inside each region and 1 (keep) elsewhere.
STABLE_AUDIO_MAX_INPAINT_REGIONS = 8
STABLE_AUDIO_WARMUP_DURATION_S = 2.0
STABLE_AUDIO_WARMUP_STEPS = 2
# Directory where the API stages uploaded source audio for a transform job.
STABLE_AUDIO_SOURCE_DIR = str(BACKEND_DIR / "temp" / "sa3_sources")

# Gemini TTS Configuration — Gemini 3.8 TTS only (2.5 and 3.1-preview removed).
# Both models share the same schema (Interactions API, WAV unary output).
TTS_MODEL_GEMINI_FLASH = "gemini-3.8-flash-tts"
TTS_MODEL_GEMINI_FLASH_LITE = "gemini-3.8-flash-lite-tts"
TTS_AVAILABLE_MODELS = (
    TTS_MODEL_GEMINI_FLASH,
    TTS_MODEL_GEMINI_FLASH_LITE,
)
DEFAULT_TTS_MODEL = TTS_MODEL_GEMINI_FLASH
TTS_MODEL_NAME = DEFAULT_TTS_MODEL  # alias used by TTSService / version info
TTS_MODEL_NAMES = {
    TTS_MODEL_GEMINI_FLASH: "Gemini 3.8 Flash TTS",
    TTS_MODEL_GEMINI_FLASH_LITE: "Gemini 3.8 Flash-Lite TTS",
}
TTS_SAMPLE_RATE = 24000  # Gemini TTS native output rate (resampled to AUDIO_SAMPLE_RATE)
TTS_DEFAULT_VOICE = "Kore"
TTS_AVAILABLE_VOICES = [
    "Kore",
    "Fenrir",
    "Puck",
    "Charon",
    "Leda",
    "Orus",
    "Achird",
    "Achernar",
    "Algenib",
    "Algieba",
    "Alnilam",
    "Aoede",
    "Autonoe",
    "Callirrhoe",
    "Despina",
    "Enceladus",
    "Erinome",
    "Gacrux",
    "Iapetus",
    "Laomedeia",
    "Pulcherrima",
    "Rasalgethi",
    "Sadachbia",
    "Sadaltager",
    "Schedar",
    "Sulafat",
    "Umbriel",
    "Vindemiatrix",
    "Zephyr",
    "Zubenelgenubi",
]
# Character display names (labels) paired with their Gemini TTS voice value.
# Mirrors TTS_VOICES in frontend/src/utils/constants.ts — keep the two in sync.
# The speech agent picks character names EXCLUSIVELY from these labels.
TTS_VOICE_CHARACTERS = {
    "Chloe": "Kore",
    "Felix": "Fenrir",
    "Max": "Puck",
    "Leo": "Charon",
    "Emma": "Leda",
    "Lucas": "Orus",
    "Alex": "Achird",
    "Sofia": "Achernar",
    "David": "Algenib",
    "Oliver": "Algieba",
    "Thomas": "Alnilam",
    "Mia": "Aoede",
    "Elena": "Callirrhoe",
    "Clara": "Despina",
    "Gabriel": "Enceladus",
    "Eva": "Erinome",
    "Luna": "Gacrux",
    "Victor": "Iapetus",
    "Lara": "Laomedeia",
    "Sara": "Autonoe",
    "Julia": "Pulcherrima",
    "Oscar": "Rasalgethi",
    "Arthur": "Sadachbia",
    "Louis": "Sadaltager",
    "Marcus": "Schedar",
    "Maya": "Sulafat",
    "Simon": "Umbriel",
    "Nina": "Vindemiatrix",
    "Zoe": "Zephyr",
    "Benjamin": "Zubenelgenubi",
}
# Allowed character names the speech agent may assign (the TTS voice labels).
TTS_CHARACTER_NAMES = list(TTS_VOICE_CHARACTERS.keys())
TTS_OUTPUT_DIR = "./temp/static/sounds/generated/tts"
TTS_OUTPUT_URL_PREFIX = "/static/sounds/generated/tts"
TTS_TASK_CLEANUP_DELAY_SECONDS = 600

# ── TTS language / dialect resolution (services/tts_voice_catalog.py,
#    utils/language_resolver.py, routers/tts_voices.py) ──────────────────────
# Gemini 3.8 rejects anything but a BCP-47 tag in speech_config.language, and the
# spoken language follows the transcript text — dialect/accent comes from the
# VOICE. The Extended Voice Library (client.voices.list) is fetched live and
# cached in Redis so new regional voices appear without a code change.
TTS_VOICE_CATALOG_REDIS_KEY = "tts:voice_catalog"
TTS_VOICE_CATALOG_TTL_SECONDS = 24 * 3600
TTS_VOICE_CATALOG_PAGE_SIZE = 100
TTS_VOICE_CATALOG_RETRY_SECONDS = 60  # back-off after a failed library fetch
# Accent of the 30 classic prebuilt voices (Kore, Puck, …). A language resolving
# to this accent keeps the characters' classic voices instead of swapping them.
TTS_CLASSIC_VOICE_ACCENT = "General American"
# Babel display-name locales used to match free text ("Swiss German",
# "Schweizerdeutsch", "suisse allemand") to a BCP-47 tag.
TTS_LANGUAGE_NAME_LOCALES = ("en", "de", "fr", "it")
TTS_VOICE_GENDER_FEMALE = "female"
TTS_VOICE_GENDER_MALE = "male"
TTS_CUSTOM_VOICE_GENDERS = (TTS_VOICE_GENDER_FEMALE, TTS_VOICE_GENDER_MALE)
TTS_CUSTOM_VOICE_TYPE = "prompted"
TTS_CUSTOM_VOICE_DISPLAY_NAME_MAX = 64
TTS_CUSTOM_VOICE_DESCRIPTION_MAX = 600
TTS_CUSTOM_VOICE_DESCRIPTION_TEMPLATE = (
    "Native {dialect} speaker in their 30s. Speaks everyday {dialect} "
    "with fully authentic regional pronunciation, vocabulary and intonation, "
    "never the standard written form."
)  # gender is passed separately (voices.create ``gender``)
# Gemini 3.8 inline vocal tags (speech-generation docs). Transcripts are read
# verbatim, so any other bracketed text — e.g. "[excitedly]" — is spoken aloud.
# Keep tags in English even for non-English transcripts.
TTS_INLINE_VOCAL_TAGS = (
    "<laugh>", "<chuckle>", "<giggle>", "<sigh>", "<cough>", "<throat-clearing>",
    "<gasp>", "<breath>", "<exhales>", "<yawn>", "<sneeze>", "<sob>", "<groan>",
    "<whispering>", "<shout>", "<short pause>", "<long pause>",
)
# Language-resolution outcomes (LanguageMatch.kind). Mirrored in
# frontend/src/types/ttsLanguage.ts.
TTS_LANGUAGE_MATCH_CUSTOM = "custom"
TTS_LANGUAGE_MATCH_LIBRARY = "library"
TTS_LANGUAGE_MATCH_TAG = "tag"
TTS_LANGUAGE_MATCH_UNKNOWN = "unknown"

# Default Generation Parameters (TangoFlux)
DEFAULT_GUIDANCE_SCALE = 4.5  # Default guidance scale for generation
DEFAULT_DIFFUSION_STEPS = 50  # Default number of diffusion steps
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
# Hybrid ISM + ray tracing (max_order=3, air absorption on) is the validated
# configuration (see pyroomacoustics_test_ach.py and acoustic-sim.mdc). Pure
# ISM at high order produces a truncated, non-diffuse tail whose Schroeder
# decay extrapolates to an inflated RT60.
PYROOMACOUSTICS_DEFAULT_MAX_ORDER = 3  # PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER
PYROOMACOUSTICS_DEFAULT_RAY_TRACING = True  # Default ray tracing state
PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION = True  # Default air absorption state
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

# Simulation mesh preparation (services/simulation_mesh_service.py)
# The welded mesh is oriented from the AIR side: diffuse random-walk rays are
# shot from every source/receiver that sits inside the model, each face records
# which side was hit, and the result decides the pyroomacoustics normal
# (pointing away from the air), two-sided surfaces and hidden faces. The same
# preparation runs in the preflight check and in the simulation, so what the
# user inspects is exactly what is simulated.
# User-tunable mesh preparation settings (Advanced settings > Acoustics). Units
# match the UI (millimetres / degrees); the backend clamps to these ranges.
SIM_MESH_WELD_TOLERANCE_MM_DEFAULT = PYROOMACOUSTICS_MESH_WELD_TOLERANCE * 1000.0
SIM_MESH_WELD_TOLERANCE_MM_MAX = 50.0
SIM_MESH_MERGE_COPLANAR_DEFAULT = True
SIM_MESH_COPLANAR_ANGLE_DEG_DEFAULT = 1.0
SIM_MESH_COPLANAR_ANGLE_DEG_MAX = 10.0
SIM_MESH_COPLANAR_DISTANCE_MM_DEFAULT = 1.0
SIM_MESH_COPLANAR_DISTANCE_MM_MAX = 20.0
SIM_MESH_DETECT_TWO_SIDED_DEFAULT = True
SIM_MESH_VISIBILITY_QUALITY_DEFAULT = "standard"
SIM_MESH_VISIBILITY_QUALITY_FACTORS = {"fast": 0.4, "standard": 1.0, "thorough": 2.5}
SIM_MESH_ENCLOSING_OBJECT_MIN_FACES = 4        # Loose-face objects smaller than this are never "closed boxes"
SIM_MESH_ENCLOSING_OBJECT_MAX_FACES = 5000     # Skip the (quadratic) closed-box test above this
SIM_MESH_ENCLOSING_OBJECT_MIN_SHARE = 0.8      # Share of faces with an unambiguous inside for a closed box

SIM_MESH_MIN_TRIANGLE_AREA_M2 = 1e-8          # Drop sliver triangles below this area
SIM_MESH_RAY_SEED = 1234                      # Fixed RNG seed -> deterministic preparation
SIM_MESH_RAY_TEST_BUDGET = 1.5e9              # Max ray-triangle tests for the visibility walk
SIM_MESH_RAYS_PER_SEED_MAX = 4000             # Upper bound on random-walk rays per air seed
SIM_MESH_RAYS_PER_SEED_MIN = 200              # Lower bound (kept even for very heavy meshes)
SIM_MESH_WALK_BOUNCES = 12                    # Diffuse bounces per random-walk ray
SIM_MESH_RAY_EPSILON_M = 1e-5                 # Self-intersection offset for re-emitted rays
SIM_MESH_TWO_SIDED_MIN_HITS = 2               # Hits needed on the minority side to call a face two-sided
SIM_MESH_TWO_SIDED_MIN_FRACTION = 0.1         # ...and its share of the face's hits
SIM_MESH_SEED_OUTSIDE_ESCAPE_FRACTION = 0.5   # Primary-ray escape share above which a seed is outside the model
SIM_MESH_SEED_LEAKY_ESCAPE_FRACTION = 0.02    # Primary-ray escape share above which a seed sees an opening
SIM_MESH_INTERIOR_OBJECT_MAX_DEPTH_M = 1.0    # Outward probe distance below which an air-facing face is an interior object
SIM_MESH_LEAK_RAYS_MAX = 60                   # Escaping rays returned for display
SIM_MESH_LEAK_RAY_DISPLAY_LENGTH_M = 2.0      # Length of a displayed escaping ray past its exit point

# Simulation preflight (services/simulation_preflight_service.py)
PREFLIGHT_SURFACE_ERROR_DISTANCE_M = 0.05     # Source/receiver closer than this to a surface -> error
PREFLIGHT_LEAK_WARNING_FRACTION = 0.005       # Escaping-ray share above which leaks are a warning
PREFLIGHT_LEAK_ERROR_FRACTION = 0.05          # ...and above which they are an error
PREFLIGHT_HOLE_LEAK_MATCH_DISTANCE_M = 0.5    # Max ray-to-hole distance to attribute a leak to a hole
PREFLIGHT_ISM_PATHS_WARNING = 2e7             # Estimated image-source candidates above which ISM is slow
PREFLIGHT_ISM_PATHS_ERROR = 5e8               # ...and above which it is impractical
PREFLIGHT_MODEL_DIAGONAL_MIN_M = 1.0          # Smaller model bounding box -> units probably wrong
PREFLIGHT_MODEL_DIAGONAL_MAX_M = 1000.0       # Larger model bounding box -> units probably wrong
PREFLIGHT_MAX_LISTED_ITEMS = 25               # Max objects listed per issue
PREFLIGHT_MAX_ISSUE_FACE_IDS = 5000           # Max face ids attached to one issue (for highlighting)
PREFLIGHT_PAYLOAD_DECIMALS = 4                # Vertex rounding in the preview payload (0.1 mm)
PYROOMACOUSTICS_SAMPLE_RATE = AUDIO_SAMPLE_RATE  # Sample rate -- uses n_bands = math.floor(np.log2(SAMPLE_RATE / BASE_FREQUENCY))
PYROOMACOUSTICS_USE_RAND_ISM = False  # Use randomized ISM for better realism
PYROOMACOUSTICS_IR_TRIM_THRESHOLD = 0.01  # Fraction of peak amplitude below which trailing IR samples are trimmed
PYROOMACOUSTICS_TASK_CLEANUP_DELAY_SECONDS = 600  # 10 minutes after completion

# Acoustic Metrics Measurement (utils/acoustic_measurement.py)
# ISO 3382-style robust estimation. A metric is only reported when the measured
# Schroeder decay covers at least MIN_DYNAMIC_RANGE_DB of level drop; otherwise
# it is returned as None and flagged unreliable instead of being extrapolated
# from a flattened/truncated tail (the classic cause of inflated RT60).
PYROOMACOUSTICS_METRICS_RT60_MIN_DYNAMIC_RANGE_DB = 15.0   # T30-style: 5→35 dB must be observable
PYROOMACOUSTICS_METRICS_EDT_MIN_DYNAMIC_RANGE_DB = 6.0    # T10-style: 5→15 dB must be observable
PYROOMACOUSTICS_METRICS_RT60_SLOPE_REF_RANGE_DB = 10.0    # Reference decay slope fit over the first 10 dB after headroom (T10), not a fixed time window
PYROOMACOUSTICS_METRICS_DIRECT_SEARCH_FRACTION_S = 0.5    # Direct-arrival search window (s) from sample 0
PYROOMACOUSTICS_METRICS_DIRECT_THRESHOLD_FRACTION = 0.1   # Fraction of global peak used to detect arrival
PYROOMACOUSTICS_METRICS_DIRECT_WINDOW_S = 0.002           # Direct-sound window (s) AFTER the arrival for DRR

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
PREFLIGHT_PAYLOAD_DIR = str(BACKEND_DIR / "temp" / "simulations" / "preflight")  # + /<workspace id>/preflight_<id>.json
TEMP_STATIC_DIR = str(BACKEND_DIR / "temp" / "static")
TEMP_ANALYSIS_DIR = str(BACKEND_DIR / "temp" / "analysis")

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
YAMNET_MODEL_URL = "https://www.kaggle.com/models/google/yamnet/TensorFlow2/yamnet/1"
# TF Hub defaults to %TEMP%\tfhub_modules, which Windows temp cleanup can gut
# (leaving a folder without saved_model.pb). Keep the cache somewhere durable.
TFHUB_CACHE_DIR = os.environ.get("TFHUB_CACHE_DIR") or str(BACKEND_DIR / "data" / "tfhub_modules")

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
# For local development, default origin is http://localhost:3000.
# Set FRONTEND_ORIGIN in .env to override (e.g., http://192.168.1.100:3000 for network access).
# Set CORS_ALLOW_ALL=true in .env to allow all origins (development only).
CORS_ORIGIN_LOCALHOST = "http://localhost"
CORS_ORIGIN_FRONTEND = "http://localhost:3000"
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
AMBISONIC_FOA_CHANNEL_NAMES = ["W", "Y", "Z", "X"]
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
CHORAS_DE_SAMPLE_RATE          = 44100      # DE solver INPUT rate (1/dt of the pressure CSV); resampled to AUDIO_SAMPLE_RATE

# DG (Discontinuous Galerkin) defaults
CHORAS_DG_DEFAULT_C0          = 343         # Speed of sound (m/s)
CHORAS_DG_DEFAULT_RHO0        = 1.213       # Air density (kg/m³)
CHORAS_DG_DEFAULT_IR_LENGTH   = 0.5         # IR length in seconds
CHORAS_DG_DEFAULT_FREQ_UPPER  = 200         # Upper frequency limit (Hz)
CHORAS_DG_DEFAULT_POLY_ORDER  = 4           # Polynomial order
CHORAS_DG_DEFAULT_PPW         = 2           # Points per wavelength
CHORAS_DG_DEFAULT_CFL         = 1.0         # CFL number

# Frequency bands (shared by DE and DG)
CHORAS_DEFAULT_FREQUENCIES = [125, 250, 500, 1000, 2000, 4000, 8000]

# Absorption material database (5-band: 125, 250, 500, 1000, 2000, 4000, 8000 Hz)
CHORAS_ABSORPTION_MATERIALS = {
    "concrete_plain": {
        "description": "Plain concrete (painted/unpainted)",
        "coeffs": [0.01, 0.01, 0.02, 0.02, 0.02, 0.02, 0.02],
    },
    "brick_unplastered": {
        "description": "Brick, unplastered",
        "coeffs": [0.02, 0.03, 0.03, 0.04, 0.05, 0.05, 0.05],
    },
    "plasterboard": {
        "description": "Plasterboard on battens",
        "coeffs": [0.15, 0.10, 0.06, 0.04, 0.04, 0.04, 0.04],
    },
    "wood_floor": {
        "description": "Parquet / wood floor on concrete",
        "coeffs": [0.04, 0.04, 0.07, 0.06, 0.06, 0.06, 0.06],
    },
    "carpet_thick": {
        "description": "Thick carpet on concrete",
        "coeffs": [0.02, 0.06, 0.14, 0.37, 0.60, 0.60, 0.60],
    },
    "glass_window": {
        "description": "Glass window",
        "coeffs": [0.35, 0.25, 0.18, 0.12, 0.07, 0.07, 0.07],
    },
    "acoustic_tile": {
        "description": "Acoustic ceiling tile",
        "coeffs": [0.15, 0.25, 0.55, 0.65, 0.65, 0.65, 0.65],
    },
    "medium_absorber": {
        "description": "Medium absorber (generic)",
        "coeffs": [0.60, 0.69, 0.71, 0.70, 0.63, 0.63, 0.63],
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

# Bundle → legacy re-materialization after ingestion runs in a background thread
# pool so ingestion status polls return immediately (stage "materializing").
SPECKLE_MATERIALIZE_WORKERS = 1
SPECKLE_MATERIALIZING_MESSAGE = "Preparing the model for the viewer..."

# ============================================================================
# Soundscape Data Persistence Configuration
# ============================================================================

# Local storage for saved soundscapes (per model_id)
# Lives outside temp/ so it is NOT touched by the age-based temp janitor
SOUNDSCAPE_DATA_DIR = str(BACKEND_DIR / "data" / "soundscapes")
SOUNDSCAPE_DATA_URL_PREFIX = "/soundscapes"

# Speckle Soundscape Object Constants
# Pink color for entity-linked sound sources (ARGB signed 32-bit int: 0xFFF500B8)
SPECKLE_SOUNDSCAPE_PINK_COLOR = -720712
SPECKLE_SOUNDSCAPE_COLLECTION_NAME = "Soundscape"
SPECKLE_SOUND_SOURCES_COLLECTION_NAME = "Sound Sources"
SPECKLE_RECEIVERS_COLLECTION_NAME = "Receivers"

# ============================================================================
# Job Store (Redis) Configuration
# ============================================================================

# Connection
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")

# Worker pool sizes (env-configurable so a single machine can be retuned
# without a code change; see deploy/README.md)
GPU_WORKER_SLOTS = int(os.environ.get("GPU_WORKER_SLOTS", "2"))
CPU_WORKER_SLOTS = int(os.environ.get("CPU_WORKER_SLOTS", "4"))
CHORAS_WORKER_SLOTS = int(os.environ.get("CHORAS_WORKER_SLOTS", "1"))
SA3_WORKER_SLOTS = int(os.environ.get("SA3_WORKER_SLOTS", "1"))

# Fairness / rate limiting
GPU_QUEUE_PER_SESSION_MAX = int(os.environ.get("GPU_QUEUE_PER_SESSION_MAX", "3"))

# In-process asyncio concurrency (LLM / TTS — network-bound, no subprocess)
LLM_MAX_CONCURRENT = int(os.environ.get("LLM_MAX_CONCURRENT", "8"))
TTS_MAX_CONCURRENT = int(os.environ.get("TTS_MAX_CONCURRENT", "2"))

# Job lifecycle
JOB_HEARTBEAT_TIMEOUT_S = int(os.environ.get("JOB_HEARTBEAT_TIMEOUT_S", "90"))
JOB_RESULT_TTL_S = int(os.environ.get("JOB_RESULT_TTL_S", "3600"))
JOB_REAPER_INTERVAL_S = int(os.environ.get("JOB_REAPER_INTERVAL_S", "30"))
JOB_MAX_ATTEMPTS = int(os.environ.get("JOB_MAX_ATTEMPTS", "2"))
WORKER_HEARTBEAT_INTERVAL_S = int(os.environ.get("WORKER_HEARTBEAT_INTERVAL_S", "10"))

# SSE
SSE_KEEPALIVE_INTERVAL_S = int(os.environ.get("SSE_KEEPALIVE_INTERVAL_S", "15"))

# Janitor (replaces the startup temp wipe — see utils/file_operations.py)
TEMP_JANITOR_MAX_AGE_H = int(os.environ.get("TEMP_JANITOR_MAX_AGE_H", "24"))
TEMP_JANITOR_INTERVAL_S = int(os.environ.get("TEMP_JANITOR_INTERVAL_S", "3600"))

# Job types (queue names in Redis)
JOB_TYPE_SOUND = "sound"
JOB_TYPE_SA3 = "sa3"
JOB_TYPE_PYROOMACOUSTICS = "pyroomacoustics"  # also carries the geometry preflight (variant "pyroomacoustics_preflight")
JOB_TYPE_SED = "sed"
JOB_TYPE_LOOP = "loop"
JOB_TYPE_CHORAS = "choras"

# IO job types (asyncio.create_task in the API process — no queue, no worker)
JOB_TYPE_TTS = "tts"
JOB_TYPE_LLM = "llm"
JOB_TYPE_TTS_VOICE = "tts_voice"  # custom dialect voice creation (routers/tts_voices.py)
IO_JOB_TYPES = (JOB_TYPE_TTS, JOB_TYPE_LLM, JOB_TYPE_TTS_VOICE)

# Job statuses
JOB_STATUS_QUEUED = "queued"
JOB_STATUS_RUNNING = "running"
JOB_STATUS_COMPLETED = "completed"
JOB_STATUS_CANCELLED = "cancelled"
JOB_STATUS_ERROR = "error"

# Redis queue names per job type -> worker role
JOB_TYPE_QUEUE = {
    JOB_TYPE_SOUND: "queue:gpu",
    JOB_TYPE_SA3: "queue:sa3",
    JOB_TYPE_PYROOMACOUSTICS: "queue:cpu",
    JOB_TYPE_SED: "queue:cpu",
    JOB_TYPE_LOOP: "queue:cpu",
    JOB_TYPE_CHORAS: "queue:choras",
}

# GPU-style jobs share the per-session fairness cap and the pending-GPU set.
GPU_LIKE_JOB_TYPES = (JOB_TYPE_SOUND, JOB_TYPE_SA3)

JOB_CANCEL_CHANNEL = "job:cancel"

# ============================================================================
# Auth / Identity (Cloudflare Access + anonymous fallback)
# ============================================================================
# When CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are set, every request must carry
# a valid Cloudflare Access JWT and the verified `email` claim is the user's
# identity (no custom login screen). If they are unset, the app falls back to
# the anonymous session cookie — local dev / legacy behaviour.
CF_ACCESS_TEAM_DOMAIN = os.environ.get("CF_ACCESS_TEAM_DOMAIN", "").strip()
CF_ACCESS_AUD = os.environ.get("CF_ACCESS_AUD", "").strip()
AUTH_DEV_BYPASS = os.environ.get("AUTH_DEV_BYPASS", "").lower() in ("true", "1", "yes")
DEV_USER_EMAIL = os.environ.get("DEV_USER_EMAIL", "dev@localhost").strip().lower()
# When true, requests without a valid Access JWT are rejected (401). Leave
# false during rollout so direct/local requests fall back to an anonymous
# session instead of locking anyone out; set true once the tunnel-only origin
# is confirmed. The origin should only be reachable through Cloudflare anyway.
CF_ACCESS_REQUIRE = os.environ.get("CF_ACCESS_REQUIRE", "").lower() in ("true", "1", "yes")
CF_ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion"
CF_ACCESS_COOKIE = "CF_Authorization"
CF_ACCESS_JWKS_CACHE_TTL_S = int(os.environ.get("CF_ACCESS_JWKS_CACHE_TTL_S", "3600"))
# Tolerance for small origin<->Cloudflare clock differences when validating the
# Access JWT's `nbf`/`iat`/`exp` claims. Without it a skewed origin clock rejects
# every freshly issued token, so only older sessions resolve and new logins
# silently fall back to anonymous. Default 60 s.
CF_ACCESS_JWT_LEEWAY_S = int(os.environ.get("CF_ACCESS_JWT_LEEWAY_S", "60"))

# Load testing through Cloudflare Access (scripts/loadtest/). A service-token JWT
# carries `common_name` (the token's client id) but no `email`. When that client
# id is allowlisted here, the `X-Loadtest-User` header selects one of many
# synthetic identities (`loadtest-<id>@loadtest.local`), so a single token can
# simulate N distinct users. Empty (the default) disables the feature entirely.
LOADTEST_SERVICE_TOKEN_IDS = frozenset(
    cid.strip() for cid in os.environ.get("LOADTEST_SERVICE_TOKEN_IDS", "").split(",") if cid.strip()
)
LOADTEST_USER_HEADER = "X-Loadtest-User"
LOADTEST_EMAIL_DOMAIN = "loadtest.local"
LOADTEST_USER_ID_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"

# Opaque session cookie. Sessions are non-expiring (sliding): the cookie is
# re-issued on every visit and the server-side row never expires.
SESSION_COOKIE = "compas_session"
SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10  # ~10 years (browsers cap ~400d, re-issued on each visit)
SESSION_TOKEN_BYTES = 32

# Workspace invites. Links expire by default (7 days) and can be limited in how
# many times they may be redeemed (0 = unlimited). Owners can revoke any invite.
INVITE_DEFAULT_TTL_S = int(os.environ.get("INVITE_DEFAULT_TTL_S", str(7 * 24 * 3600)))
INVITE_MAX_USES_DEFAULT = int(os.environ.get("INVITE_MAX_USES_DEFAULT", "0"))  # 0 = unlimited
INVITE_MAX_USES_HARD_CAP = 100

# ============================================================================
# SQLite metadata store (workspaces/users/membership/blob refs)
# ============================================================================
# Metadata only — audio/media stays on the filesystem. Note this amends the
# former "no database" rule; durable workspace data still lives under data/.
APP_DB_PATH = str(BACKEND_DIR / "data" / "app.db")

# ============================================================================
# Bug reports (routers/bug_reports.py, services/bug_report_service.py)
# ============================================================================
# Durable: rows in app.db (`bug_reports`), screenshots under data/ — never temp/.
BUG_REPORTS_DIR = BACKEND_DIR / "data" / "bug_reports"
BUG_REPORT_CATEGORIES = ("bug", "visual", "performance", "idea")
BUG_REPORT_STATUS_OPEN = "open"
BUG_REPORT_MAX_DESCRIPTION_CHARS = 5000
BUG_REPORT_MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
BUG_REPORT_MAX_CONTEXT_BYTES = 256 * 1024
BUG_REPORT_SCREENSHOT_BASENAME = "screenshot"

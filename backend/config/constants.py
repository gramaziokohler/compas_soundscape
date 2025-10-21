"""
Application Constants

Centralized configuration constants extracted from various services and utilities.
This module eliminates magic numbers and promotes consistency across the codebase.
"""

# ============================================================================
# LLM Configuration
# ============================================================================

# Model Configuration
LLM_MODEL_NAME = "gemini-2.5-flash"

# Default Sound Parameters
LLM_DEFAULT_SPL = 70.0  # Default Sound Pressure Level in dB
LLM_DEFAULT_INTERVAL = 30.0  # Default interval in seconds

# SPL Range (dB)
SPL_MIN = 30.0
SPL_MAX = 120.0
SPL_RANGE = (SPL_MIN, SPL_MAX)

# Interval Range (seconds)
INTERVAL_MIN = 5.0
INTERVAL_MAX = 300.0
INTERVAL_RANGE = (INTERVAL_MIN, INTERVAL_MAX)

# ============================================================================
# Audio Processing Configuration
# ============================================================================

# Audio Normalization
TARGET_RMS = 0.1  # Target RMS level for normalization
CLIPPING_THRESHOLD = 0.99  # Threshold to prevent clipping
BASE_SPL = 70.0  # Base SPL for volume calculations

# ============================================================================
# Sound Event Detection (SED) Configuration
# ============================================================================

# Sample Rate
TARGET_SAMPLE_RATE = 16000  # YAMNet requires 16kHz audio

# Detection Parameters
DETECTION_THRESHOLD = 0.1  # Score threshold for class detection
FRAME_HOP_SECONDS = 0.48  # YAMNet frame hop duration
FRAME_WINDOW_SECONDS = 0.96  # YAMNet analysis window duration

# ============================================================================
# BBC Sound Library Configuration
# ============================================================================

# Search Parameters
MAX_SEARCH_RESULTS = 5  # Maximum number of search results to return
CATEGORY_WEIGHT = 2.0  # Weight for category matching in search
DESCRIPTION_WEIGHT = 1.0  # Weight for description matching in search
MIN_MATCH_SCORE_THRESHOLD = 120  # Minimum score for a valid match

# ============================================================================
# Directory Configuration
# ============================================================================

# Temporary Directories
TEMP_UPLOADS_DIR = "backend/temp_uploads"
TEMP_LIBRARY_DIR = "backend/temp_library_downloads"

# Data Directories
BBC_LIBRARY_CSV_PATH = './data/BBCSoundEffects.csv'

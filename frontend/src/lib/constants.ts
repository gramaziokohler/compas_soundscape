// ============================================================================
// API Configuration
// ============================================================================

/**
 * Dynamically determine the API base URL based on the current hostname.
 * This allows the app to work both locally and when accessed from network devices.
 *
 * Logic:
 * - If NEXT_PUBLIC_API_BASE_URL is set in .env.local, use it (for manual override)
 * - Otherwise, detect the current hostname:
 *   - localhost/127.0.0.1 → http://localhost:8000
 *   - Network IP (e.g., 129.132.205.138) → http://[same-IP]:8000
 */
function getApiBaseUrl(): string {
  // If explicitly set in environment, use that
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  // Server-side rendering: default to localhost
  if (typeof window === 'undefined') {
    return 'http://localhost:8000';
  }

  // Client-side: detect from window.location
  const hostname = window.location.hostname;

  // Local access (localhost, 127.0.0.1, or [::1])
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return 'http://localhost:8000';
  }

  // Network access: use the same IP as the frontend but port 8000
  return `http://${hostname}:8000`;
}

export const API_BASE_URL = getApiBaseUrl();

// API Endpoints
export const SED_ANALYZE_ENDPOINT = `${API_BASE_URL}/api/analyze-sound-events`;

// ============================================================================
// UI Design System - Unified Color Palette
// ============================================================================
// Note: CSS custom properties are defined in globals.css for Tailwind usage.
// Use Tailwind classes (bg-primary, text-primary, etc.) in components.
// These constants are for programmatic use (Three.js materials, dynamic calculations).

// Brand Colors
export const UI_COLORS = {
  // Primary Brand Color (Pink) - Main accent color
  PRIMARY: "#F500B8",
  PRIMARY_HEX: 0xF500B8, // For Three.js materials
  PRIMARY_HOVER: "#e061c0",
  PRIMARY_LIGHT: "#fce7f6",
  
  // Secondary Color (Sky Blue) - Secondary accent
  SECONDARY: "#0ea5e9",
  SECONDARY_HOVER: "#0284c7",
  SECONDARY_LIGHT: "#e0f2fe",
  
  // Semantic Colors
  SUCCESS: "#10B981", // Green - confirmations, success states
  SUCCESS_HOVER: "#059669",
  SUCCESS_LIGHT: "#d1fae5",
  
  ERROR: "#EF4444", // Red - errors, delete actions
  ERROR_HOVER: "#dc2626",
  ERROR_LIGHT: "#fee2e2",
  
  WARNING: "#F59E0B", // Amber - warnings, cautions
  WARNING_HOVER: "#d97706",
  WARNING_LIGHT: "#fef3c7",
  
  INFO: "#3B82F6", // Blue - informational messages
  INFO_HOVER: "#2563eb",
  INFO_LIGHT: "#dbeafe",
  
  // Neutral Colors (Light Mode)
  NEUTRAL_50: "#fafafa",
  NEUTRAL_100: "#f5f5f5",
  NEUTRAL_200: "#e5e5e5",
  NEUTRAL_300: "#d4d4d4",
  NEUTRAL_400: "#a3a3a3",
  NEUTRAL_500: "#737373",
  NEUTRAL_600: "#525252",
  NEUTRAL_700: "#404040",
  NEUTRAL_800: "#262626",
  NEUTRAL_900: "#171717",
  
  // Dark Mode Overrides (via Tailwind dark: prefix)
  DARK_BG: "#0a0a0a",
  DARK_FG: "#ededed",
  DARK_BORDER: "#262626",
  
 //  Material Colors - Gradient from pink to teal (6-char hex for Three.js compatibility)
  MATERIAL_GRADIENT_START: "#d0128d", // Pink
  MATERIAL_GRADIENT_END: "#65c0b5", // Teal
} as const;

// Legacy exports for backward compatibility (still in use)
export const PRIMARY_COLOR = UI_COLORS.PRIMARY;
export const PRIMARY_COLOR_HEX = UI_COLORS.PRIMARY_HEX;

// ============================================================================
// UI Design System - Spacing, Borders, Shadows
// ============================================================================

// Border Radius (in pixels for programmatic use, use Tailwind classes in components)
export const UI_BORDER_RADIUS = {
  NONE: 0,
  SM: 4,      // Small radius - buttons, inputs
  MD: 8,      // Medium radius - cards, panels (PRIMARY)
  LG: 12,     // Large radius - modals, large cards
  XL: 16,     // Extra large radius
  FULL: 9999, // Fully rounded (circles, pills)
} as const;

// Opacity Values
export const UI_OPACITY = {
  DISABLED: 0.4,
  HOVER: 0.8,
  BACKDROP: 0.8,     // For overlay backgrounds (80%)
  BACKDROP_LIGHT: 0.95, // For light overlays (95%)
  MUTED: 0.5,
  SUBTLE: 0.2,
} as const;

// Spacing (in pixels, use Tailwind classes in components)
export const UI_SPACING = {
  XS: 4,
  SM: 8,
  MD: 12,
  LG: 16,
  XL: 24,
  XXL: 32,
} as const;

// Font Sizes (in pixels, use Tailwind classes in components)
export const UI_FONT_SIZE = {
  XS: 10,    // Extra small text
  SM: 12,    // Small text, labels (PRIMARY)
  BASE: 14,  // Base text, inputs
  MD: 16,    // Medium text
  LG: 18,    // Large text
  XL: 20,    // Extra large text
  XXL: 24,   // Headers
} as const;

// Line Thickness (for borders, strokes)
export const UI_LINE_THICKNESS = {
  THIN: 1,      // Default borders
  MEDIUM: 2,    // Emphasized borders (PRIMARY)
  THICK: 3,     // Strong emphasis
  EXTRA_THICK: 4,
} as const;

// Shadows (CSS box-shadow values)
export const UI_SHADOWS = {
  NONE: "none",
  SM: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  MD: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
  LG: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
  XL: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
  OVERLAY: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", // For overlays
} as const;

// Transitions
export const UI_TRANSITIONS = {
  FAST: "150ms ease-in-out",
  NORMAL: "200ms ease-in-out",
  SLOW: "300ms ease-in-out",
  COLORS: "colors 200ms ease-in-out", // For Tailwind transition-colors
} as const;

// ============================================================================
// UI Design System - Component Specific
// ============================================================================

// Buttons
export const UI_BUTTON = {
  PADDING_SM: "6px 12px",    // Small buttons (py-1.5 px-3)
  PADDING_MD: "8px 16px",    // Medium buttons (py-2 px-4) - PRIMARY
  PADDING_LG: "12px 24px",   // Large buttons (py-3 px-6)
  HEIGHT_SM: "32px",         // h-8
  HEIGHT_MD: "40px",         // h-10
  HEIGHT_LG: "48px",         // h-12
  BORDER_RADIUS_SM: "4px",   // rounded (small)
  BORDER_RADIUS_MD: "6px",   // rounded-md (STANDARD for all buttons)
  BORDER_RADIUS_LG: "8px",   // rounded-lg
  BORDER_RADIUS_FULL: "9999px", // rounded-full
  FONT_SIZE: UI_FONT_SIZE.SM,
  FONT_WEIGHT: "500",        // font-medium (STANDARD)
  TRANSITION: UI_TRANSITIONS.COLORS,
} as const;

// Checkboxes
export const UI_CHECKBOX = {
  SIZE: 16,                  // Width and height (w-4 h-4)
  BORDER_RADIUS: UI_BORDER_RADIUS.SM,
  FOCUS_RING_WIDTH: 2,       // focus:ring-2
  ACCENT_COLOR: UI_COLORS.PRIMARY, // accent-primary
} as const;

// Input Fields
export const UI_INPUT = {
  PADDING: "8px 12px",       // Padding for text inputs
  BORDER_RADIUS: UI_BORDER_RADIUS.MD,
  BORDER_WIDTH: UI_LINE_THICKNESS.THIN,
  FONT_SIZE: UI_FONT_SIZE.SM,
  FOCUS_RING_WIDTH: 1,       // focus:ring-1
} as const;

// Cards and Panels
export const UI_CARD = {
  PADDING: UI_SPACING.MD,    // p-3 (12px)
  BORDER_RADIUS: UI_BORDER_RADIUS.MD,
  BORDER_WIDTH: UI_LINE_THICKNESS.THIN,
  SHADOW: UI_SHADOWS.MD,
} as const;

// Overlays (3D Scene UI)
export const UI_OVERLAY = {
  BACKGROUND: `rgba(0, 0, 0, ${UI_OPACITY.BACKDROP})`, // black/80
  BACKDROP_BLUR: "8px",      // backdrop-blur-sm
  BORDER_RADIUS: UI_BORDER_RADIUS.MD,
  BORDER_COLOR: `rgba(255, 255, 255, ${UI_OPACITY.SUBTLE})`, // white/20
  BORDER_WIDTH: UI_LINE_THICKNESS.THIN,
  PADDING: UI_SPACING.MD,
  SHADOW: UI_SHADOWS.OVERLAY,
  MIN_WIDTH: "200px",
  WIDTH: "230px",            // Standard width for all overlays (Sound UI and Entity UI)
  MARGIN: 200,               // Margin for overlay positioning
  BOTTOM_OFFSET: 6,          // Bottom offset in Tailwind units
  RIGHT_OFFSET: 6,           // Right offset in Tailwind units
  GAP: 20,                   // Gap between stacked overlays (in pixels)
  VERTICAL_STACK_OFFSET: 230, // Offset when stacking Entity UI above Sound UI (EntityBox ~110px + GAP 20px + clearance ~130px)
} as const;

// 3D Scene Control Buttons (bottom-right corner)
export const UI_SCENE_BUTTON = {
  SIZE: "24px",              // w-6 h-6 (50% of original 48px)
  ICON_SIZE: "12px",         // w-3 h-3 (proportional to button size)
  BORDER_RADIUS: "4px",      // rounded (small radius for small buttons)
  GAP: "8px",                // gap-2 between buttons
} as const;

// Entity Overlays (Light background)
export const UI_ENTITY_OVERLAY = {
  BACKGROUND: `rgba(255, 255, 255, ${UI_OPACITY.BACKDROP_LIGHT})`, // white/95
  BACKDROP_BLUR: "8px",
  BORDER_RADIUS: UI_BORDER_RADIUS.MD,
  BORDER_COLOR: UI_COLORS.NEUTRAL_300,
  BORDER_WIDTH: UI_LINE_THICKNESS.THIN,
  PADDING: UI_SPACING.MD,
  SHADOW: UI_SHADOWS.LG,
  MIN_WIDTH: "200px",
} as const;

// Validation Messages
export const UI_VALIDATION = {
  PADDING: "8px",            // p-2
  BORDER_RADIUS: UI_BORDER_RADIUS.MD,
  BORDER_WIDTH: UI_LINE_THICKNESS.THIN,
  FONT_SIZE: UI_FONT_SIZE.XS,
  ICON_SIZE: 16,             // w-4 h-4
} as const;

// Tabs
export const UI_TABS = {
  PADDING: "6px 12px",       // px-3 py-1
  BORDER_RADIUS_TOP: "8px 8px 0 0", // rounded-t
  FONT_SIZE: UI_FONT_SIZE.XS,
  TRANSITION: UI_TRANSITIONS.COLORS,
} as const;

// ============================================================================
// Default Sound Generation Values (Consolidated)
// ============================================================================
export const DEFAULT_DURATION_SECONDS = 5;
export const DEFAULT_GUIDANCE_SCALE = 4.5;
export const DEFAULT_DIFFUSION_STEPS = 25;
export const DEFAULT_SEED_COPIES = 1;
export const DEFAULT_SPL_DB = 70;

// Position Generation (for sound sphere spacing)
// These values match the backend's position calculation logic
// Used to space sounds evenly when no bounding box is provided
export const DEFAULT_POSITION_SPACING = 5;    // Spacing multiplier for x-axis
export const DEFAULT_POSITION_OFFSET = 1.5;   // Offset multiplier for x-axis
export const DEFAULT_POSITION_Y = 1;          // Default Y position
export const DEFAULT_POSITION_Z = 0;          // Default Z position

// Audio Generation Models
export const AUDIO_MODEL_TANGOFLUX = "tangoflux";
export const AUDIO_MODEL_AUDIOLDM2 = "audioldm2";
export const DEFAULT_AUDIO_MODEL = AUDIO_MODEL_TANGOFLUX;

// Audio Model Display Names
export const AUDIO_MODEL_NAMES = {
  [AUDIO_MODEL_TANGOFLUX]: "TangoFlux",
  [AUDIO_MODEL_AUDIOLDM2]: "AudioLDM2"
} as const;

export const DEFAULT_SOUND_CONFIG = {
  prompt: "",
  duration: DEFAULT_DURATION_SECONDS,
  guidance_scale: DEFAULT_GUIDANCE_SCALE,
  negative_prompt: "",
  seed_copies: DEFAULT_SEED_COPIES,
  interval_seconds: 0,
  spl_db: DEFAULT_SPL_DB
};

// Audio Playback Configuration
export const AUDIO_PLAYBACK = {
  // Default interval in seconds when not specified
  DEFAULT_INTERVAL_SECONDS: 5,

  // Randomness percentage for interval-based playback (±10% variance)
  INTERVAL_RANDOMNESS_PERCENT: 10,
} as const;

// ============================================================================
// File Type Configuration
// ============================================================================

// Model File Extensions
export const MODEL_FILE_EXTENSIONS = ['.obj', '.stl', '.ifc', '.3dm', '.gltf', '.glb', '.fbx'];
export const VALID_FILE_EXTENSIONS = ['.obj', '.stl', '.ifc', '.3dm']; // Legacy - for backward compatibility
export const ACCEPT_FILE_TYPES = ".obj,.stl,.ifc,.3dm";

// Audio File Extensions
export const AUDIO_FILE_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.wma'];
export const AUDIO_UPLOAD_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'];

// Combined Accept String for File Input
export const FILE_INPUT_ACCEPT_STRING = '.obj,.stl,.ifc,.3dm,.wav,.mp3,.flac,.ogg,.m4a';
export const BROWSE_FILE_TYPE_HINT = '(.obj, .stl, .ifc, .3dm, .wav, .mp3)';

// ============================================================================
// Text Generation Configuration
// ============================================================================
export const DEFAULT_NUM_SOUNDS = 5;
export const NUM_SOUNDS_MIN = 1;
export const NUM_SOUNDS_MAX = 30;
// ENTITY_HIGHLIGHT_DELAY_MS moved to UI_TIMING section
export const LLM_SUGGESTED_INTERVAL_SECONDS = 0;

// LLM Retry Configuration (matches backend constants)
export const LLM_RETRY = {
  MAX_ATTEMPTS: 5,              // Maximum retry attempts (matches backend LLM_MAX_RETRIES)
  INITIAL_DELAY: 2.0,           // Initial delay in seconds (matches backend LLM_INITIAL_RETRY_DELAY)
  MAX_DELAY: 30.0,              // Maximum delay in seconds (matches backend LLM_MAX_RETRY_DELAY)
  BACKOFF_MULTIPLIER: 2.0,      // Exponential backoff multiplier (matches backend LLM_BACKOFF_MULTIPLIER)
} as const;

// ============================================================================
// Sound Event Detection (SED) Configuration
// ============================================================================
export const SED_TOP_N_CLASSES = '100';

// ============================================================================
// UI Slider Configuration (Sound Overlays)
// ============================================================================

// Volume Slider Settings
export const UI_VOLUME_SLIDER = {
  MIN: 30,           // Minimum volume in dB SPL (quiet/whisper)
  MAX: 120,          // Maximum volume in dB SPL (loud/concert)
  STEP: 1,           // Step size for volume adjustments
  LABEL: 'Volume (dB SPL)',
  MIN_LABEL: '30',
  MAX_LABEL: '120'
} as const;

// Interval Slider Settings
export const UI_INTERVAL_SLIDER = {
  MIN: 0,            // Minimum interval in seconds (0 = continuous loop)
  MAX: 300,          // Maximum interval in seconds (5 minutes)
  STEP: 5,           // Step size for interval adjustments (5 second increments)
  LABEL: 'Playback Interval (s)',
  LOOP_TEXT: 'Loop',
  MIN_LABEL: '0',
  MAX_LABEL: '300'
} as const;

// Auralization Audio Processing Constants
// These values ensure physically accurate auralization while preventing digital clipping
export const AURALIZATION_LIMITER = {
  // Limiter threshold in dB (close to 0dBFS for minimal intervention)
  THRESHOLD_DB: -0.5,
  
  // Knee curve (0 = hard/brick-wall limiting for transparency)
  KNEE_DB: 0,
  
  // Compression ratio (20:1 = essentially infinite, true limiting)
  RATIO: 20,
  
  // Attack time in seconds (1ms = fast response to prevent clipping)
  ATTACK_SEC: 0.001,
  
  // Release time in seconds (100ms = natural recovery)
  RELEASE_SEC: 0.1
} as const;

// Impulse Response Processing Constants
export const IMPULSE_RESPONSE = {
  // Normalization scale factor (0.5 = -6dB headroom for convolution)
  NORMALIZATION_SCALE: 0.5,

  // Minimum amplitude threshold for normalization (avoid amplifying silence)
  MIN_AMPLITUDE_THRESHOLD: 0.001,

  // Fade-in length in samples to prevent clicks
  FADE_IN_SAMPLES: 64,

  // Maximum supported channels
  MAX_CHANNELS: 16,  // Changed from 2 to 16 to support TOA

  // Fixed gain multiplier for ambisonic IRs (instead of normalization)
  // This preserves channel balance and temporal dynamics for proper localization
  // Tuned to give reasonable levels without clipping after SN3D→N3D conversion
  AMBISONIC_IR_GAIN_MULTIPLIER: 0.3  // -10.5dB for headroom with FOA gain compensation
} as const;

// ============================================================================
// Ambisonic Audio Configuration
// ============================================================================
export const AMBISONIC = {
  // Ambisonic orders
  ORDER: {
    FOA: 1,  // First Order Ambisonics (4 channels)
    SOA: 2,  // Second Order Ambisonics (9 channels)
    TOA: 3   // Third Order Ambisonics (16 channels)
  } as const,

  // Channel counts
  CHANNELS: {
    FOA: 4,   // 1st order: W, X, Y, Z
    SOA: 9,   // 2nd order: (order+1)^2 channels
    TOA: 16   // 3rd order: (order+1)^2 channels
  } as const,

  // ACN channel ordering (standard for ambisonics)
  ACN_ORDERING: true as const,

  // Normalization scheme (JSAmbisonics uses N3D internally)
  NORMALIZATION: 'N3D' as const,

  // SN3D to N3D conversion factors (multiply SN3D channel by these to get N3D)
  // Most ambisonic IRs are recorded in SN3D, but JSAmbisonics expects N3D
  // Reference: https://en.wikipedia.org/wiki/Ambisonic_data_exchange_formats
  SN3D_TO_N3D: {
    // FOA (First Order) - ACN channels 0-3
    FOA: [
      1.0,          // ACN 0 (W): no change
      1.732050808,  // ACN 1 (Y): sqrt(3)
      1.732050808,  // ACN 2 (Z): sqrt(3)
      1.732050808   // ACN 3 (X): sqrt(3)
    ],
    // SOA (Second Order) - ACN channels 0-8
    SOA: [
      1.0,          // ACN 0 (W): no change
      1.732050808,  // ACN 1 (Y): sqrt(3)
      1.732050808,  // ACN 2 (Z): sqrt(3)
      1.732050808,  // ACN 3 (X): sqrt(3)
      2.236067977,  // ACN 4 (V): sqrt(5)
      2.236067977,  // ACN 5 (T): sqrt(5)
      2.236067977,  // ACN 6 (R): sqrt(5)
      2.236067977,  // ACN 7 (S): sqrt(5)
      2.236067977   // ACN 8 (U): sqrt(5)
    ],
    // TOA (Third Order) - ACN channels 0-15
    TOA: [
      1.0,          // ACN 0 (W): no change
      1.732050808,  // ACN 1 (Y): sqrt(3)
      1.732050808,  // ACN 2 (Z): sqrt(3)
      1.732050808,  // ACN 3 (X): sqrt(3)
      2.236067977,  // ACN 4 (V): sqrt(5)
      2.236067977,  // ACN 5 (T): sqrt(5)
      2.236067977,  // ACN 6 (R): sqrt(5)
      2.236067977,  // ACN 7 (S): sqrt(5)
      2.236067977,  // ACN 8 (U): sqrt(5)
      2.645751311,  // ACN 9 (Q): sqrt(7)
      2.645751311,  // ACN 10 (O): sqrt(7)
      2.645751311,  // ACN 11 (M): sqrt(7)
      2.645751311,  // ACN 12 (K): sqrt(7)
      2.645751311,  // ACN 13 (L): sqrt(7)
      2.645751311,  // ACN 14 (N): sqrt(7)
      2.645751311   // ACN 15 (P): sqrt(7)
    ]
  } as const,

  // Order-dependent gain compensation for N3D normalization
  // Compensates for energy scaling when summing multiple ambisonic channels
  // Formula: 1 / sqrt(numChannels) to maintain consistent perceived loudness
  ORDER_GAIN_COMPENSATION: {
    MONO: 1.0,           // 1 channel: no compensation (for AmbisonicIRMode reference)
    FOA: 0.5,            // 4 channels: 1/sqrt(4) = 0.5 (-6dB)
    SOA: 0.333,          // 9 channels: 1/sqrt(9) ≈ 0.333 (-9.5dB)
    TOA: 0.25            // 16 channels: 1/sqrt(16) = 0.25 (-12dB)
  } as const,

  // Mono IR boost to match compensated ambisonic IR levels
  // MonoIR convolution produces less energy than multi-channel IR convolution
  // Boost by 2x (~+6dB) to match FOA level after compensation
  MONO_IR_BOOST: 1.0 as const,

  // Stereo IR boost (same as mono for consistency)
  STEREO_IR_BOOST: 1.0 as const,

  // Channel names for FOA (ACN ordering)
  FOA_CHANNEL_NAMES: ['W', 'X', 'Y', 'Z'] as const,

  // Channel names for SOA (ACN ordering, 9 channels)
  SOA_CHANNEL_NAMES: [
    'W',                                          // 0th order
    'Y', 'Z', 'X',                               // 1st order
    'V', 'T', 'R', 'S', 'U'                     // 2nd order
  ] as const,

  // Channel names for TOA (ACN ordering, 16 channels)
  TOA_CHANNEL_NAMES: [
    'W',                                          // 0th order
    'Y', 'Z', 'X',                               // 1st order
    'V', 'T', 'R', 'S', 'U',                    // 2nd order
    'Q', 'O', 'M', 'K', 'L', 'N', 'P'          // 3rd order
  ] as const
} as const;

// ============================================================================
// HRTF (Head-Related Transfer Function) Configuration
// ============================================================================
export const HRTF = {
  // Default HRTF dataset path (IRCAM subject 1076)
  DEFAULT_HRTF_PATH: '/hrtf/IRC_1076_C_HRIR_48000.sofa.json',

  // HRTF loading configuration
  FETCH_TIMEOUT_MS: 10000,  // 10 second timeout for loading HRTF
  RETRY_ATTEMPTS: 3,         // Number of retry attempts if loading fails

  // HRTF type
  FORMAT: 'ircam' as const,  // IRCAM SOFA JSON format

  // Enable auto-loading on decoder initialization
  AUTO_LOAD: true            // Automatically load HRTFs on startup
} as const;

// ============================================================================
// Stereo Speaker Configuration (for Stereo IR Mode)
// ============================================================================
export const STEREO_SPEAKER = {
  // Standard stereo speaker positions (ITU-R BS.775 recommendation)
  // ±30° azimuth from listener front, horizontal plane
  LEFT_AZIMUTH_RAD: Math.PI / 6,     // 30° in radians (left front)
  RIGHT_AZIMUTH_RAD: -Math.PI / 6,   // -30° in radians (right front)
  
  // Left/Right speaker positions in degrees
  LEFT_AZIMUTH_DEG: 30,              // 30° left
  RIGHT_AZIMUTH_DEG: -30,            // 30° right
  
  // Elevation (horizontal plane)
  ELEVATION_RAD: 0,                  // 0° elevation
  
  // Reference distance from listener
  REFERENCE_DISTANCE: 1.5,           // 1.5 meters (typical near-field monitoring)
  
  // Gain compensation for L+R summing
  // -3dB per channel to prevent clipping when both channels are combined
  LR_GAIN_COMPENSATION_DB: -3,       // -3dB per channel
  LR_GAIN_COMPENSATION_LINEAR: Math.pow(10, -3 / 20), // ≈ 0.707 (√2/2)
  
  // Interpretation modes
  MODE: {
    BINAURAL: 'binaural' as const,    // Direct stereo playback (pre-spatialized)
    SPEAKER: 'speaker' as const        // L/R split + ambisonic encoding at ±30°
  }
} as const;


// IR format constants
export const IR_FORMAT = {
  MONO: "mono",
  BINAURAL: "binaural",
  FOA: "foa",
  SOA: "soa",
  TOA: "toa"
} as const;

// ============================================================================
// Audio Control Constants
// ============================================================================
export const AUDIO_CONTROL = {
  // Volume limits (linear gain values)
  SOURCE_VOLUME: {
    MIN: 0.0,
    MAX: 5.0,  // Allows +20dB boost above baseline
  },
  
  // Master volume limits (linear gain values)
  MASTER_VOLUME: {
    MIN: 0.0,
    MAX: 1.0,   // Unity gain maximum
  },
  
  // Limiter settings (DynamicsCompressorNode)
  LIMITER: {
    THRESHOLD_DB: -6.0,    // Start limiting at -6dB (provides headroom)
    KNEE_DB: 0.0,          // Hard knee for brick-wall limiting
    RATIO: 20.0,           // High compression ratio for limiting effect
    ATTACK_SEC: 0.0,       // Instant attack (0ms)
    RELEASE_SEC: 0.1,      // Moderate release (100ms) to avoid pumping
  },
  
  // Default gain values
  DEFAULTS: {
    UNITY_GAIN: 1.0,       // Standard unity gain
    MUTED_GAIN: 0.0,       // Fully muted
    UNMUTED_GAIN: 1.0,     // Unmuted state
  }
} as const;

// ============================================================================
// Resonance Audio Configuration
// ============================================================================
export const RESONANCE_AUDIO = {
  // Default ambisonic order for Resonance Audio scene
  DEFAULT_AMBISONIC_ORDER: 1, // 1st order (4 channels)
  
  // Default room dimensions (meters)
  DEFAULT_ROOM_DIMENSIONS: {
    width: 10,   // X dimension
    height: 3,   // Y dimension (typical room height)
    depth: 10    // Z dimension
  },
  
  // Default room materials (Resonance Audio material names)
  // See: https://resonance-audio.github.io/resonance-audio/reference/web/Utils.html#.ROOM_MATERIAL_COEFFICIENTS
  DEFAULT_ROOM_MATERIALS: {
    left: 'brick-bare',
    right: 'brick-bare',
    front: 'brick-bare',
    back: 'brick-bare',
    down: 'parquet-on-concrete',
    up: 'acoustic-ceiling-tiles'
  },
  
  // Available room materials (from Resonance Audio library)
  ROOM_MATERIALS: {
    // Hard surfaces (high reflection)
    TRANSPARENT: 'transparent',
    ACOUSTIC_CEILING_TILES: 'acoustic-ceiling-tiles',
    BRICK_BARE: 'brick-bare',
    BRICK_PAINTED: 'brick-painted',
    CONCRETE_BLOCK_COARSE: 'concrete-block-coarse',
    CONCRETE_BLOCK_PAINTED: 'concrete-block-painted',
    CURTAIN_HEAVY: 'curtain-heavy',
    FIBER_GLASS_INSULATION: 'fiber-glass-insulation',
    GLASS_THIN: 'glass-thin',
    GLASS_THICK: 'glass-thick',
    GRASS: 'grass',
    LINOLEUM_ON_CONCRETE: 'linoleum-on-concrete',
    MARBLE: 'marble',
    METAL: 'metal',
    PARQUET_ON_CONCRETE: 'parquet-on-concrete',
    PLASTER_ROUGH: 'plaster-rough',
    PLASTER_SMOOTH: 'plaster-smooth',
    PLYWOOD_PANEL: 'plywood-panel',
    POLISHED_CONCRETE_OR_TILE: 'polished-concrete-or-tile',
    SHEET_ROCK: 'sheet-rock',
    WATER_OR_ICE_SURFACE: 'water-or-ice-surface',
    WOOD_CEILING: 'wood-ceiling',
    WOOD_PANEL: 'wood-panel',
    // Soft surfaces (low reflection, high absorption)
    UNIFORM: 'uniform'
  },
  
  // Material absorption coefficients (from Resonance Audio source code)
  // Average across frequency bands (31.25Hz to 8000Hz)
  MATERIAL_ABSORPTION: {
    'transparent': 1.0,
    'acoustic-ceiling-tiles': 0.775,
    'brick-bare': 0.045,
    'brick-painted': 0.018,
    'concrete-block-coarse': 0.361,
    'concrete-block-painted': 0.088,
    'curtain-heavy': 0.426,
    'fiber-glass-insulation': 0.738,
    'glass-thin': 0.085,
    'glass-thick': 0.196,
    'grass': 0.394,
    'linoleum-on-concrete': 0.026,
    'marble': 0.013,
    'metal': 0.049,
    'parquet-on-concrete': 0.054,
    'plaster-rough': 0.032,
    'plaster-smooth': 0.029,
    'plywood-panel': 0.215,
    'polished-concrete-or-tile': 0.015,
    'sheet-rock': 0.151,
    'water-or-ice-surface': 0.017,
    'wood-ceiling': 0.107,
    'wood-panel': 0.193,
    'uniform': 0.5
  } as Record<string, number>,

  
  // Source configuration defaults
  DEFAULT_ROLLOFF: 'logarithmic', // Most natural sounding
  DEFAULT_MIN_DISTANCE: 1,        // Meters
  DEFAULT_MAX_DISTANCE: 50,       // Meters
  DEFAULT_DIRECTIVITY_PATTERN: 0, // Omnidirectional
  DEFAULT_DIRECTIVITY_SHARPNESS: 0.5,
  
  // Distance models
  DISTANCE_MODELS: {
    LOGARITHMIC: 'logarithmic',
    LINEAR: 'linear',
    NONE: 'none'
  },
  
  // Bounding Box Visualization
  BOUNDING_BOX: {
    // Wireframe color (cyan)
    WIREFRAME_COLOR: 0x00ffff,
    WIREFRAME_WIDTH: 2,
    
    // Face plane opacity
    FACE_BASE_OPACITY: 0.15,
    FACE_ABSORPTION_OPACITY_SCALE: 0.8, // Additional opacity based on absorption
    
    // Label sprite sizing (relative to bounding box dimensions)
    LABEL_SCALE_FACTOR: 0.2, // Label width = max(bbox dimensions) * this factor
    LABEL_ASPECT_RATIO: 2.0,  // Width to height ratio
    
    // Label text rendering
    LABEL_CANVAS_WIDTH: 256,
    LABEL_CANVAS_HEIGHT: 128,
    LABEL_FONT: 'Bold 24px Arial',
    LABEL_BG_COLOR: 'rgba(0, 0, 0, 0)',
    LABEL_TEXT_COLOR: 'black',
    
    // Render order (higher = rendered later/on top)
    WIREFRAME_RENDER_ORDER: 999,
    FACE_RENDER_ORDER: 998,
    LABEL_RENDER_ORDER: 1000,
    
    // Auto bounding box from sound sources (when no geometry)
    AUTO_BBOX_THRESHOLD: 2.0, // Meters to add on each side of sound sources
    AUTO_BBOX_MIN_SIZE: 5.0    // Minimum dimension for auto bounding box
  }
} as const;

// ============================================================================
// Audio Visualization Configuration
// ============================================================================
export const AUDIO_VISUALIZATION = {
  // Enable/disable waveform display globally
  ENABLE_WAVEFORM_DISPLAY: true,

  // Number of waveform points to visualize (affects performance/detail trade-off)
  WAVEFORM_POINTS: 400,

  // Canvas dimensions for sidebar waveform
  WAVEFORM_WIDTH: 320,
  WAVEFORM_HEIGHT: 160, // Increased to accommodate bottom time labels

  // dB range for waveform display
  WAVEFORM_MIN_DB: -60,
  WAVEFORM_MAX_DB: 0
} as const;


// ============================================================================
// Three.js Scene Configuration
// ============================================================================

// Lighting
export const SCENE_LIGHTING = {
  AMBIENT_INTENSITY: 1.2,
  PRIMARY_DIRECTIONAL_INTENSITY: 0.6,
  SECONDARY_DIRECTIONAL_INTENSITY: 0.4
} as const;

// Grid
export const SCENE_GRID = {
  SIZE: 20,
  DIVISIONS: 20,
  COLOR_MAIN: 0xb0b8c0,
  COLOR_SECONDARY: 0xd0d8e0
} as const;

// Arctic Theme
export const ARCTIC_THEME = {
  BACKGROUND_COLOR: 0xe8edf2,
  GEOMETRY_COLOR: 0xf0f4f8,
  MATERIAL_ROUGHNESS: 0.5,
  GEOMETRY_OPACITY: 0.5  // Slightly transparent geometry (70% opacity)
} as const;

// Camera
export const CAMERA_CONFIG = {
  FOV_DEGREES: 75,
  NEAR_PLANE: 0.1,
  FAR_PLANE: 1000,
  INIT_X: 15,
  INIT_Y: 10,
  INIT_Z: 15,
  FRAME_MULTIPLIER: 0.95
} as const;

// Sound Spheres
export const SOUND_SPHERE = {
  RADIUS_MULTIPLIER: 0.3,
  WIDTH_SEGMENTS: 32,
  HEIGHT_SEGMENTS: 32,
  EMISSIVE_INTENSITY: 0.7,
  ROUGHNESS: 0.3,
  METALNESS: 0.1,
  OPACITY: 0.5,
  TRANSPARENT: true,
} as const;

// Receiver Configuration
export const RECEIVER_CONFIG = {
  CUBE_SIZE_MULTIPLIER: 0.3,
  PREVIEW_SIZE_MULTIPLIER: 0.3,
  DEFAULT_EAR_HEIGHT_METERS: 1.6,
  EMISSIVE_INTENSITY: 0.3,
  ROUGHNESS: 0.3,
  METALNESS: 0.7,
  PREVIEW_OPACITY: 0.5,
  COLOR: 0x0ea5e9 // Sky-500
} as const;

// ============================================================================
// SVG Configuration
// ============================================================================

// Standard SVG namespace (used in all SVG elements)
export const SVG_XMLNS = "http://www.w3.org/2000/svg";

// Common SVG properties for icons
export const SVG_ICON_PROPS = {
  XMLNS: SVG_XMLNS,
  FILL: "none" as const,
  STROKE: "currentColor" as const,
  STROKE_WIDTH: "2",
  STROKE_LINECAP: "round" as const,
  STROKE_LINEJOIN: "round" as const
} as const;

// ============================================================================
// Tailwind CSS Class Constants (for programmatic usage)
// ============================================================================
// Note: These are for when you need to construct classes dynamically in TypeScript.
// For static JSX, use Tailwind classes directly.

// Common text size classes
export const TAILWIND_TEXT_SIZE = {
  XS: "text-xs",      // 0.75rem (12px) - Most common for labels, small text
  SM: "text-sm",      // 0.875rem (14px) - Common for body text
  BASE: "text-base",  // 1rem (16px) - Default size
  LG: "text-lg",      // 1.125rem (18px)
  XL: "text-xl"       // 1.25rem (20px)
} as const;

// Common border radius classes
export const TAILWIND_ROUNDED = {
  NONE: "rounded-none",
  SM: "rounded",      // 0.25rem (4px)
  MD: "rounded-md",   // 0.375rem (6px) - Most common
  LG: "rounded-lg",   // 0.5rem (8px)
  FULL: "rounded-full" // Circular
} as const;

// Common padding combinations (horizontal/vertical)
export const TAILWIND_PADDING = {
  XS: "px-1 py-0.5",   // Minimal padding
  SM: "px-2 py-1",     // Small padding (very common)
  MD: "px-3 py-2",     // Medium padding (common for inputs)
  LG: "px-4 py-2",     // Large padding (common for buttons)
  XL: "px-5 py-2",     // Extra large padding
  BUTTON_SM: "px-3 py-1.5",  // Small button padding
  BUTTON_MD: "px-4 py-2",    // Medium button padding (most common)
  BUTTON_LG: "px-6 py-3"     // Large button padding
} as const;

// Common gap classes (flex/grid spacing)
export const TAILWIND_GAP = {
  XS: "gap-1",   // 0.25rem (4px)
  SM: "gap-2",   // 0.5rem (8px) - Very common
  MD: "gap-3",   // 0.75rem (12px)
  LG: "gap-4",   // 1rem (16px)
  XL: "gap-6"    // 1.5rem (24px)
} as const;

// Common transition classes
export const TAILWIND_TRANSITION = {
  COLORS: "transition-colors",           // Most common
  ALL: "transition-all",                 // Transitions all properties
  DEFAULT: "transition-all duration-200" // With duration
} as const;

// Common overlay/backdrop patterns (complete class strings)
export const TAILWIND_OVERLAY = {
  // Dark overlay with blur (most common for 3D UI)
  DARK_BLUR: "bg-black/80 backdrop-blur-sm rounded-lg border border-white/20",
  
  // Light overlay with blur
  LIGHT_BLUR: "bg-white/95 backdrop-blur-sm rounded-lg border border-gray-300",
  
  // Sky-themed overlay (for ambisonic notice)
  SKY_BLUR: "bg-sky-900/90 backdrop-blur-sm rounded-lg border border-sky-500/50"
} as const;

// ============================================================================
// Utility Configuration
// ============================================================================

// Display Names
export const DISPLAY_NAME_MAX_WORDS = 3;

// Scaling
export const SCALE_FACTOR_DIVISOR = 10;
export const MIN_SCALE_FOR_SOUNDS = 0.2;
export const MAX_SCALE_FOR_SOUNDS = 5;

// Audio Channel Names
export const AUDIO_CHANNEL_NAMES = {
  MONO: "Mono",
  STEREO: "Stereo",
  QUAD: "Quad (4-ch)",
  FOA: "Ambisonic FOA (4-ch)",
  TOA: "Ambisonic TOA (16-ch)"
} as const;

// Stereo Channel Labels
export const STEREO_CHANNEL_LABELS = ['L', 'R'];

// Audio Info Formatting
export const DURATION_PRECISION_PLACES = 3;
export const CONFIDENCE_PRECISION_PERCENT = 0.1;
export const AMPLITUDE_PRECISION_PLACES = 0.1;

// ============================================================================
// Audio Volume Configuration
// ============================================================================
export const AUDIO_VOLUME = {
  MUTED: 0,
  FULL: 1,
  DEFAULT: 0.8
} as const;

// ============================================================================
// Screen Projection Configuration (NDC to screen space)
// ============================================================================
export const SCREEN_PROJECTION = {
  SCALE: 0.5,
  OFFSET: 0.5,
  CAMERA_BEHIND_THRESHOLD: 1
} as const;

// ============================================================================
// UI Timing Configuration (Debounce, Delays, Intervals)
// ============================================================================
export const UI_TIMING = {
  UPDATE_DEBOUNCE_MS: 50,
  RECEIVER_UPDATE_DELAY_MS: 200,
  SCENE_UPDATE_DELAY_MS: 100,
  ENTITY_HIGHLIGHT_DELAY_MS: 800
} as const;

// ============================================================================
// Entity Configuration
// ============================================================================
export const ENTITY_CONFIG = {
  SCALE_MULTIPLIER: 1.25,
  SELECTION_SCALE: 1.2
} as const;

// ============================================================================
// Timeline Defaults
// ============================================================================
export const TIMELINE_DEFAULTS = {
  DURATION_MS: 60000,  // 1 minute default timeline duration
} as const;

// ============================================================================
// Audio Context States
// ============================================================================
export const AUDIO_CONTEXT_STATE = {
  RUNNING: 'running',
  SUSPENDED: 'suspended',
  CLOSED: 'closed'
} as const;

// ============================================================================
// Modal Impact Sound Synthesis Configuration
// ============================================================================

// Impact Sound Parameters
export const IMPACT_SOUND = {
  // Duration
  DEFAULT_DURATION: 2.0,           // Default impact sound duration (seconds)
  MIN_DURATION: 0.5,               // Minimum duration (seconds)
  MAX_DURATION: 5.0,               // Maximum duration (seconds)
  
  // Damping
  DEFAULT_DAMPING_RATIO: 0.02,     // Default structural damping (2% - typical for metals)
  MIN_DAMPING_RATIO: 0.001,        // Minimum damping (0.1% - very resonant)
  MAX_DAMPING_RATIO: 0.2,          // Maximum damping (20% - heavily damped)
  
  // Material-specific damping ratios
  DAMPING_RATIOS: {
    steel: 0.01,        // 1% - highly resonant
    aluminum: 0.015,    // 1.5%
    concrete: 0.05,     // 5% - more damped
    wood: 0.03,         // 3%
    glass: 0.008,       // 0.8% - very resonant
  },
  
  // Excitation (impact characteristics)
  EXCITATION_DURATION: 0.002,      // Impact pulse duration (2ms - typical for hard impact)
  EXCITATION_ATTACK: 0.0001,       // Attack time for impact pulse (0.1ms)
  
  // Mode amplitude distribution
  MODE_AMPLITUDE_DECAY: 0.7,       // Exponential decay factor for higher modes
  FUNDAMENTAL_AMPLITUDE: 1.0,      // Amplitude of fundamental mode
  
  // Impact location influence
  POSITION_INFLUENCE_STRENGTH: 0.5, // How much impact position affects mode amplitudes (0-1)
  
  // Synthesis
  SAMPLE_RATE: 44100,              // Audio sample rate (Hz)
  MAX_MODES_TO_SYNTHESIZE: 20,     // Maximum number of modes to include in synthesis
  MIN_MODE_AMPLITUDE: 0.01,        // Minimum mode amplitude to include (1%)
  
  // Output
  OUTPUT_GAIN: 0.3,                // Master output gain
  NORMALIZATION_TARGET: 0.9,       // Target peak amplitude for normalization
} as const;

// Impact Material Presets (for UI selection)
export const IMPACT_MATERIALS = {
  steel: { name: 'Steel', damping: 0.01, color: '#A8A9AD' },
  aluminum: { name: 'Aluminum', damping: 0.015, color: '#8C92AC' },
  concrete: { name: 'Concrete', damping: 0.05, color: '#9B9B9B' },
  wood: { name: 'Wood', damping: 0.03, color: '#D2691E' },
  glass: { name: 'Glass', damping: 0.008, color: '#B0E0E6' },
} as const;

// ============================================================================
// Sound State Defaults
// ============================================================================
export const SOUND_STATE_DEFAULT = 'stopped' as const;

// ============================================================================
// UI Layout Configuration
// ============================================================================

// Timeline Layout
export const TIMELINE_LAYOUT = {
  BOTTOM_OFFSET_PX: 20,
  SIDEBAR_WIDTH_PX: 48,
  CONTENT_WIDTH_PX: 400,
  MAX_WIDTH_PX: 1500,
} as const;

// Button Sizes (Tailwind)
export const BUTTON_SIZES = {
  SMALL: 5,   // w-5 h-5
  MEDIUM: 12,  // w-12 h-12
  LARGE: 16   // w-16 h-16
} as const;

// Playback Controls
export const PLAYBACK_CONTROLS = {
  HORIZONTAL_OFFSET: "calc(50% + 192px)",
  BUTTON_PADDING: "px-4 py-1.5",
  CONTROLS_PADDING: "px-4 py-2",
  PRIMARY_PINK: UI_COLORS.PRIMARY,
  MIDDLE_PINK: '#F57EC8',
  BUTTON_GREY: UI_COLORS.NEUTRAL_400
} as const;

// Audio Scheduler
export const DEFAULT_RANDOMNESS_PERCENT = 10;

// ============================================================================
// Audio Timeline Configuration
// ============================================================================
export const AUDIO_TIMELINE = {
  // Default timeline duration (120 seconds)
  DEFAULT_DURATION_MS: 120000,

  // Maximum iterations to display per sound
  MAX_ITERATIONS_TO_DISPLAY: 50,

  // Colors for different sound generation methods
  SOUND_COLORS: {
    IMPORT: UI_COLORS.INFO,       // Blue - Imported sounds
    LIBRARY: UI_COLORS.SUCCESS,   // Green - Library sounds (BBC, Freesound)
    TTA: UI_COLORS.PRIMARY,       // Primary pink - Text-to-Audio (TangoFlux)
  },
} as const;

// ============================================================================
// WaveSurfer Enhanced Timeline Configuration
// ============================================================================
export const WAVESURFER_TIMELINE = {
  // Timeline mode
  DEFAULT_MODE: 'classic' as 'classic' | 'enhanced',

  // Fixed timeline duration
  FIXED_DURATION_SECONDS: 180,       // 3 minutes fixed timeline

  // WaveSurfer visual config
  WAVEFORM_COLOR: UI_COLORS.NEUTRAL_600,    // Grey waveform
  PROGRESS_COLOR: UI_COLORS.PRIMARY,         // Pink progress
  CURSOR_COLOR: UI_COLORS.PRIMARY,           // Pink cursor
  CURSOR_WIDTH: 2,
  TRACK_HEIGHT: 35,                  // Waveform height per track
  ITERATION_HEIGHT: 25,              // Height for each iteration waveform
  
  // Mute/Solo visual feedback
  MUTED_COLOR: UI_COLORS.NEUTRAL_600,       // Grey color for muted sounds (same as waveform base)

  // Waveform rendering
  BAR_WIDTH: 2,
  BAR_GAP: 1,
  BAR_RADIUS: 2,

  // Regions config (for sound clips/iterations)
  REGION_COLOR_ALPHA: 0.3,          // 30% opacity
  REGION_BORDER_WIDTH: 2,
  REGION_HANDLE_WIDTH: 5,

  // Timeline plugin config
  TIME_INTERVAL: 15,                  // Time markers every 15s
  PRIMARY_LABEL_INTERVAL: 30,        // Bold labels every 30s
  SECONDARY_HEIGHT: 5,               // Secondary tick height
  PRIMARY_HEIGHT: 10,                // Primary tick height
  NOTCH_PERCENTAGE: 90,              // Percentage of track height for notches

  // Zoom & pan
  MIN_ZOOM: 1,
  MAX_ZOOM: 10,
  DEFAULT_ZOOM: 1,
  ZOOM_STEP: 0.01,

  // Track layout
  TRACK_SPACING: 5,
  TRACK_PADDING: 5,
  TRACK_LABEL_WIDTH: 120,            // Width reserved for track labels

  // Colors
  BACKGROUND_COLOR: '#000000',              // Black background
  TRACK_BACKGROUND_COLOR: UI_COLORS.NEUTRAL_800, // Dark grey track background
  GRID_COLOR: UI_COLORS.NEUTRAL_600,        // Grey grid lines
  TEXT_COLOR: '#FFFFFF',                    // White text

  // Performance
  PIXELS_PER_SECOND: 5,              // Pixels per second (180s needs to fit on screen)
  MAX_CANVAS_WIDTH: 4000,            // Maximum canvas width for performance
} as const;


// ============================================================================
// Audio Mode Configuration & UI
// ============================================================================

/**
 * Audio mode descriptions for UI display
 * Maps AudioMode enum values to human-readable descriptions
 */
export const AUDIO_MODE_DESCRIPTIONS = {
  no_ir_resonance: {
    name: 'ShoeBox Acoustics',
    shortName: 'ShoeBox',
    description: 'Google Resonance Audio with synthetic room acoustics',
    details: 'High-quality spatial audio with early reflections and reverb simulation.',
    dof: '6 DOF',
    requiresReceiver: false,
    requiresIR: false,
    icon: '🏛️',
  },
  anechoic: {
    name: 'No Acoustics',
    shortName: 'No Acoustics',
    description: 'Dry source with ambisonic encoding and binaural decoding',
    details: 'Clean spatial audio without reflections. Supports FOA/SOA/TOA.',
    dof: '6 DOF',
    requiresReceiver: false,
    requiresIR: false,
    icon: '🎵',
  },
  mono_ir: {
    name: 'Mono IR',
    shortName: 'Mono IR',
    description: 'Mono impulse response convolution',
    details: 'Single-channel IR convolved with source, then encoded to ambisonics.',
    dof: '3 DOF',
    requiresReceiver: true,
    requiresIR: true,
    icon: '🔊',
  },
  stereo_ir: {
    name: 'Stereo IR',
    shortName: 'Stereo IR',
    description: 'Stereo impulse response (binaural or speaker)',
    details: 'Dual-channel IR with interpretation toggle (binaural/speaker mode).',
    dof: '3 DOF',
    requiresReceiver: true,
    requiresIR: true,
    icon: '🎧',
  },
  ambisonic_ir: {
    name: 'Ambisonic IR',
    shortName: 'Ambisonic IR',
    description: 'Multi-channel ambisonic impulse response',
    details: 'FOA/SOA/TOA IR convolution with rotation and binaural decoding.',
    dof: '3 DOF',
    requiresReceiver: true,
    requiresIR: true,
    icon: '🌐',
  },
} as const;

/**
 * Audio mode colors for UI differentiation
 * Uses existing UI_COLORS for consistency
 */
export const AUDIO_MODE_COLORS = {
  no_ir_resonance: UI_COLORS.SECONDARY,
  anechoic: UI_COLORS.PRIMARY,
  mono_ir: UI_COLORS.SUCCESS,
  stereo_ir: UI_COLORS.WARNING,
  ambisonic_ir: UI_COLORS.PRIMARY,
} as const;

/**
 * Ambisonic order configuration
 */
export const AMBISONIC_ORDER_INFO = {
  1: {
    name: 'FOA',
    fullName: 'First Order Ambisonics',
    channels: 4,
    description: 'Basic spatial resolution, lower CPU usage',
    icon: '🔵',
  },
  2: {
    name: 'SOA',
    fullName: 'Second Order Ambisonics',
    channels: 9,
    description: 'Medium spatial resolution, moderate CPU usage',
    icon: '🟢',
  },
  3: {
    name: 'TOA',
    fullName: 'Third Order Ambisonics',
    channels: 16,
    description: 'High spatial resolution, higher CPU usage',
    icon: '🟣',
  },
} as const;

/**
 * Audio mode UI configuration
 */
export const AUDIO_MODE_UI = {
  // Mode selector
  SELECTOR_HEIGHT: 48,
  SELECTOR_GAP: 8,
  BUTTON_PADDING_X: 12,
  BUTTON_PADDING_Y: 8,

  // Status display
  STATUS_UPDATE_INTERVAL_MS: 100,
  STATUS_FADE_IN_MS: 200,
  STATUS_FADE_OUT_MS: 300,

  // IR management
  IR_FILE_MAX_SIZE_MB: 100,
  IR_SUPPORTED_FORMATS: ['.wav', '.flac', '.ogg'],
  IR_SUPPORTED_CHANNEL_COUNTS: [1, 2, 4, 9, 16],

  // Transition animations
  MODE_TRANSITION_FADE_MS: 100,
  BUTTON_HOVER_TRANSITION_MS: 150,
} as const;

/**
 * Audio warnings and notices
 */
export const AUDIO_WARNINGS = {
  RECEIVER_REQUIRED: '⚠️ IR mode requires a receiver to be placed in the scene',
  HRTF_UNAVAILABLE: '⚠️ HRTF data unavailable - using basic panning',
  IR_INVALID_CHANNELS: '⚠️ Unsupported channel count for IR',
  ORDER_UNSUPPORTED: '⚠️ Ambisonic order not supported by browser',
  MODE_INIT_FAILED: '⚠️ Audio mode initialization failed',
} as const;

// ============================================================================
// Choras Acoustic Simulation Configuration
// ============================================================================

// Choras API Configuration
export const CHORAS_API_BASE = 'http://localhost:5001';

// Default Simulation Settings (DE - Diffusion Equation Method)
export const CHORAS_DEFAULT_C0 = 343; // Speed of sound in m/s
export const CHORAS_DEFAULT_IR_LENGTH = 0.2; // Impulse response length in seconds
export const CHORAS_DEFAULT_LC = 1.0; // Characteristic length in meters
export const CHORAS_DEFAULT_EDT = 35; // Energy decay threshold in dB
export const CHORAS_DEFAULT_SIM_LEN_TYPE = 'ir_length'; // Simulation length type

// Simulation Length Type Options
export const CHORAS_SIM_LEN_TYPE_IR = 'ir_length';
export const CHORAS_SIM_LEN_TYPE_EDT = 'edt';

// Simulation Parameter Ranges
export const CHORAS_C0_MIN = 300; // Minimum speed of sound (m/s)
export const CHORAS_C0_MAX = 400; // Maximum speed of sound (m/s)
export const CHORAS_IR_LENGTH_MIN = 0.05; // Minimum IR length (seconds)
export const CHORAS_IR_LENGTH_MAX = 5.0; // Maximum IR length (seconds)
export const CHORAS_LC_MIN = 0.1; // Minimum characteristic length (meters)
export const CHORAS_LC_MAX = 10.0; // Maximum characteristic length (meters)
export const CHORAS_EDT_MIN = 20; // Minimum EDT (dB)
export const CHORAS_EDT_MAX = 60; // Maximum EDT (dB)

// Polling Configuration
export const CHORAS_POLL_INTERVAL = 2000; // Milliseconds between status checks
export const CHORAS_INITIAL_POLL_DELAY = 1000; // Wait 1s before first poll to let Choras initialize files
export const CHORAS_TIMEOUT = 600000; // Maximum simulation time (10 minutes in ms)
export const CHORAS_POLL_TIMEOUT = 30000; // Timeout for individual poll requests (30 seconds)
export const CHORAS_RUN_TIMEOUT = 30000; // Timeout for simulation start request (30 seconds)
export const CHORAS_MAX_POLL_RETRIES = 5; // Maximum retry attempts for failed polls

// ============================================================================
// Pyroomacoustics Acoustic Simulation Configuration
// ============================================================================

// Simulation Modes
export const PYROOMACOUSTICS_SIMULATION_MODE_MONO = "mono"; // Single microphone (1 channel)
export const PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL = "binaural"; // Two microphones for left/right ears (2 channels)
export const PYROOMACOUSTICS_SIMULATION_MODE_FOA = "foa"; // First-Order Ambisonics (4 channels: W, X, Y, Z)

// Simulation Mode Display Names
export const PYROOMACOUSTICS_SIMULATION_MODE_NAMES = {
  [PYROOMACOUSTICS_SIMULATION_MODE_MONO]: "Mono (1-ch)",
  [PYROOMACOUSTICS_SIMULATION_MODE_BINAURAL]: "Binaural (2-ch)",
  [PYROOMACOUSTICS_SIMULATION_MODE_FOA]: "FOA Ambisonics (4-ch)"
} as const;

// Default Simulation Settings
export const PYROOMACOUSTICS_DEFAULT_MAX_ORDER = 5; // Default max_order for image source method
export const PYROOMACOUSTICS_DEFAULT_RAY_TRACING = false; // Default ray tracing state
export const PYROOMACOUSTICS_DEFAULT_AIR_ABSORPTION = false; // Default air absorption state
export const PYROOMACOUSTICS_DEFAULT_SIMULATION_MODE = PYROOMACOUSTICS_SIMULATION_MODE_MONO; // Default simulation mode

// Parameter Ranges
export const PYROOMACOUSTICS_MAX_ORDER_MIN = 0; // Direct path only
export const PYROOMACOUSTICS_MAX_ORDER_MAX = 20; // Maximum reflection order

// Ray Tracing Configuration (displayed when enabled)
export const PYROOMACOUSTICS_RAY_TRACING_RECOMMENDED_MAX_ORDER = 3; // Recommended when using ray tracing
export const PYROOMACOUSTICS_RAY_TRACING_N_RAYS = 10000; // Default number of rays
export const PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MIN = 1000; // Minimum number of rays
export const PYROOMACOUSTICS_RAY_TRACING_N_RAYS_MAX = 50000; // Maximum number of rays
export const PYROOMACOUSTICS_DEFAULT_SCATTERING = 0.1; // Default scattering coefficient (0-1)
export const PYROOMACOUSTICS_SCATTERING_MIN = 0.0; // Minimum scattering (specular reflection)
export const PYROOMACOUSTICS_SCATTERING_MAX = 1.0; // Maximum scattering (diffuse reflection)



// Single source of truth for the demo recorder.
export const APP_URL = 'http://localhost:3000';

export const CAPTURE = {
  width: 1920,
  height: 1080,
  jpegQuality: 92,
  fps: 30,
};

export const MOTION = {
  moveMs: 750, // cursor glide duration
  stepMs: 16, // one mouse-move step (~60 Hz)
  preClickMs: 180, // settle before pressing
  postClickMs: 350, // linger after releasing
  typeMs: 55, // mean delay between keystrokes
};

export const CURSOR = {
  size: 30,
  pressMs: 110,
  rippleMs: 520,
  rippleColor: 'rgba(0, 0, 255, 0.35)', // app brand blue
};

export const PATHS = {
  framesDir: 'out/frames',
  outDir: 'out',
  videoAssets: '../video/assets',
};

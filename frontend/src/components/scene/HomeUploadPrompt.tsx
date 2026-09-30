'use client';

import type { CSSProperties } from 'react';
import { useUIStore } from '@/store';

export interface HomeUploadPromptProps {
  style?: CSSProperties;
}

/**
 * HomeUploadPrompt Component
 *
 * One-line invitation on the empty Home stage: "Upload a 3D model or start
 * below". "Upload" opens the load-model dialog (Speckle browser + file upload).
 * Sits above the Home new-scene panel (Simple mode) or alone above the bottom
 * bar (Expert mode).
 *
 * Usage:
 * ```tsx
 * <HomeUploadPrompt />
 * ```
 */
export function HomeUploadPrompt({ style }: HomeUploadPromptProps) {
  return (
    <p className="home-prompt" style={style}>
      <button
        type="button"
        className="home-prompt__link"
        onClick={() => useUIStore.getState().setShowLoadModelPanel(true)}
      >
        Upload
      </button>{' '}
      a 3D model or start below
    </p>
  );
}

/**
 * Speckle Viewer Context
 *
 * Provides access to the Speckle viewer instance across components
 * without prop drilling through the entire component tree.
 */

'use client';

import React, { createContext, useContext, useRef, useState, ReactNode } from 'react';
import type { Viewer } from '@speckle/viewer';

interface SpeckleViewerContextType {
  viewerRef: React.RefObject<Viewer | null>;
  modelFileName: string | null;
  setModelFileName: (fileName: string | null) => void;
}

const SpeckleViewerContext = createContext<SpeckleViewerContextType | null>(null);

export function SpeckleViewerProvider({ children }: { children: ReactNode }) {
  const viewerRef = useRef<Viewer | null>(null);
  const [modelFileName, setModelFileName] = useState<string | null>(null);

  return (
    <SpeckleViewerContext.Provider value={{ viewerRef, modelFileName, setModelFileName }}>
      {children}
    </SpeckleViewerContext.Provider>
  );
}

export function useSpeckleViewerContext() {
  const context = useContext(SpeckleViewerContext);
  if (!context) {
    // Return a fallback ref if context is not available
    // This makes the hook work even outside the provider
    return { 
      viewerRef: { current: null } as React.RefObject<Viewer | null>,
      modelFileName: null,
      setModelFileName: () => {}
    };
  }
  return context;
}

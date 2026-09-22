'use client';

import React, { useEffect } from 'react';
import { SceneEmptyState } from '@/components/scene/SceneEmptyState';

interface SpeckleModelSelectData {
  model_id: string;
  version_id: string;
  file_id: string;
  url: string;
  object_id: string;
  auth_token?: string;
  display_name?: string;
}

interface SpeckleModelModalProps {
  open: boolean;
  onClose: () => void;
  modelFile: File | null;
  isDragging: boolean;
  speckleTokenSet: boolean | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onSpeckleModelSelect?: (speckleData: SpeckleModelSelectData) => void;
  onLoadHomeProject?: (modelId: string) => void;
  isUploadingModel?: boolean;
}

/**
 * SpeckleModelModal
 *
 * Centered pop-up hosting the file-upload + Speckle model browser with a dimmed
 * backdrop. Used from the Home stage hint and the "Load a Speckle model" button.
 *
 * Usage:
 * ```tsx
 * <SpeckleModelModal open={show} onClose={() => setShow(false)} ... />
 * ```
 */
export function SpeckleModelModal({
  open,
  onClose,
  modelFile,
  isDragging,
  speckleTokenSet,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onSpeckleModelSelect,
  onLoadHomeProject,
  isUploadingModel = false,
}: SpeckleModelModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <SceneEmptyState
          modelFile={modelFile}
          isDragging={isDragging}
          speckleTokenSet={speckleTokenSet}
          onFileChange={onFileChange}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onSpeckleModelSelect={onSpeckleModelSelect}
          onLoadHomeProject={onLoadHomeProject}
          isUploadingModel={isUploadingModel}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

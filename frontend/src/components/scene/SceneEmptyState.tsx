'use client';

import React from 'react';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { SpeckleModelBrowser } from '@/components/scene/SpeckleModelBrowser';
import { useTextGenerationStore } from '@/store';
import { MODEL_FILE_EXTENSIONS } from '@/utils/constants';
import { Spinner } from '@/components/ui/Spinner';

interface SpeckleModelSelectData {
  model_id: string;
  version_id: string;
  file_id: string;
  url: string;
  object_id: string;
  auth_token?: string;
  display_name?: string;
}

interface SceneEmptyStateProps {
  modelFile: File | null;
  isDragging: boolean;
  speckleTokenSet: boolean | null;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onSpeckleModelSelect?: (speckleData: SpeckleModelSelectData) => void;
  isUploadingModel?: boolean;
  onClose?: () => void;
}

export function SceneEmptyState({
  modelFile,
  isDragging,
  speckleTokenSet,
  onFileChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onSpeckleModelSelect,
  isUploadingModel = false,
  onClose,
}: SceneEmptyStateProps) {
  return (
    <div
      className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg pointer-events-auto"
      style={{
        width: 'min(92vw, 22rem)',
        border: '1px solid var(--color-overlay-border)',
        borderRadius: '8px',
        background: 'var(--color-overlay-bg)',
        padding: '12px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">Load model</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-secondary-hover hover:text-foreground px-1"
            title="Close"
          >
            ×
          </button>
        )}
      </div>

      {speckleTokenSet === null ? (
        <div className="flex justify-center py-4">
          <Spinner size={24} />
        </div>
      ) : speckleTokenSet === true ? (
        <div className="flex flex-col gap-3">
          <FileUploadArea
            file={modelFile}
            isDragging={isDragging}
            acceptedFormats={MODEL_FILE_EXTENSIONS.join(',')}
            acceptedExtensions={MODEL_FILE_EXTENSIONS.join(', ')}
            onFileChange={onFileChange}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            inputId="scene-model-upload"
            multiple={false}
            isUploading={isUploadingModel}
            fluid
          />
          {onSpeckleModelSelect && (
            <SpeckleModelBrowser onModelSelect={onSpeckleModelSelect} />
          )}
        </div>
      ) : (
        <div
          className="rounded-lg p-3 text-center flex flex-col gap-3"
          style={{
            border: '1px dashed var(--color-secondary-light)',
            background: 'var(--color-secondary-lighter)',
          }}
        >
          <p className="text-xs text-secondary-hover">
            3D models are hosted through{' '}
            <a
              href="https://app.speckle.systems"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: 'var(--color-primary)' }}
            >
              app.speckle.systems
            </a>
            . Add your Speckle token to upload and browse models. The sandbox room stays usable without it.
          </p>
          <button
            type="button"
            onClick={() => useTextGenerationStore.getState().triggerOpenTokenSettings()}
            className="self-center text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              border: '1px solid var(--color-secondary-light)',
              color: 'var(--color-secondary-hover)',
            }}
          >
            Configure Speckle token in Settings →
          </button>
        </div>
      )}
    </div>
  );
}

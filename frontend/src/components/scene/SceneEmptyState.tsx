'use client';

import React from 'react';
import Image from 'next/image';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { SpeckleModelBrowser } from '@/components/scene/SpeckleModelBrowser';
import { useTextGenerationStore } from '@/store/textGenerationStore';
import { MODEL_FILE_EXTENSIONS } from '@/utils/constants';

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
}: SceneEmptyStateProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/50">
      <div className="flex flex-col items-center gap-6 p-8" style={{ maxWidth: '400px' }}>
        <div className="text-center">
          <div className="flex items-center gap-4 flex-shrink-0 mb-4 justify-center">
            <Image
              className="invert flex-shrink-0"
              src="/compas_icon_white.png"
              alt="compas logo"
              width={100}
              height={100}
              priority
            />
          </div>
          <h3 className="text-xl font-semibold mb-2">Compas Soundscape</h3>
        </div>

        {speckleTokenSet === true ? (
          <>
            <div className="w-full">
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
              />
            </div>
            {onSpeckleModelSelect && (
              <SpeckleModelBrowser onModelSelect={onSpeckleModelSelect} />
            )}
          </>
        ) : speckleTokenSet === false ? (
          <div
            className="w-full rounded-lg p-5 text-center flex flex-col gap-3"
            style={{
              border: `1px dashed var(--color-secondary-light)`,
              background: 'var(--color-secondary-lighter)',
            }}
          >
            <p className="text-xs text-neutral-600">
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
              . Add your Speckle token to upload and browse models.
            </p>
            <button
              type="button"
              onClick={() => useTextGenerationStore.getState().triggerOpenTokenSettings()}
              className="self-center text-xs px-3 py-1.5 rounded transition-colors"
              style={{
                border: `1px solid var(--color-secondary-light)`,
                color: 'var(--color-secondary-hover)',
              }}
            >
              Configure Speckle token in Settings →
            </button>
          </div>
        ) : null /* loading — render nothing while checking */}
      </div>
    </div>
  );
}

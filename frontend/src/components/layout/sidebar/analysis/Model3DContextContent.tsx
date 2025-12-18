'use client';

import { useState } from 'react';
import type { ModelAnalysisConfig } from '@/types/analysis';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { UI_COLORS, UI_BUTTON, UI_CARD, MODEL_FILE_EXTENSIONS } from '@/lib/constants';

/**
 * Model3DContextContent Component
 * 
 * UI for 3D model analysis configuration (before generation)
 * Uses geometry_service.py backend
 */

interface Model3DContextContentProps {
  config: ModelAnalysisConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<ModelAnalysisConfig>) => void;
  onAnalyze: (index: number) => void;
}

export function Model3DContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
  onAnalyze
}: Model3DContextContentProps) {
  // File upload state
  const [isDragging, setIsDragging] = useState(false);

  const hasModelLoaded = config.modelEntities.length > 0;
  const hasSelectedEntities = config.selectedDiverseEntities.length > 0;

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    // Update config with the file - useEffect in page.tsx will handle upload
    onUpdateConfig(index, { modelFile: file });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    onUpdateConfig(index, { modelFile: file });
    
    // Trigger file upload via parent - will be handled by page.tsx
    // File upload will update the config with modelEntities
    
    // Reset input
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* File upload area - only show if no model loaded */}
      {!hasModelLoaded && (
        <FileUploadArea
          file={config.modelFile}
          isDragging={isDragging}
          acceptedFormats={MODEL_FILE_EXTENSIONS.join(',')}
          acceptedExtensions={MODEL_FILE_EXTENSIONS.join(', ')}
          onFileChange={handleFileChange}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          inputId={`model-upload-${index}`}
          multiple={false}
        />
      )}

      {/* Model loaded UI */}
      {hasModelLoaded && (
        <div className="space-y-2">
          {/* Model info */}
          <div
            className="rounded p-2 text-xs"
            style={{
              backgroundColor: UI_COLORS.SUCCESS_LIGHT,
              borderColor: UI_COLORS.SUCCESS,
              borderWidth: '1px',
              borderStyle: 'solid',
              borderRadius: '8px',
              color: UI_COLORS.SUCCESS
            }}
          >
            ✓ Model loaded: {config.modelFile?.name || 'Unknown'}
            <div style={{ color: UI_COLORS.SUCCESS_HOVER }}>
              {config.modelEntities.length} objects
            </div>
          </div>

          {/* Hide import UI and show model name */}
          <div className="text-sm font-medium" style={{ color: UI_COLORS.NEUTRAL_700 }}>
            {config.modelFile?.name || '3D Model'}
          </div>

          {/* Number of sounds slider */}
          <div>
            <label className="text-xs mb-2 block" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              Number of sounds: <span style={{ color: UI_COLORS.PRIMARY, fontWeight: 'bold' }}>{config.numSounds}</span>
            </label>
            <input
              type="range"
              value={config.numSounds}
              onChange={(e) => onUpdateConfig(index, { numSounds: parseInt(e.target.value) })}
              min="1"
              max="30"
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary"
              style={{ backgroundColor: UI_COLORS.NEUTRAL_200 }}
            />
            <div className="flex justify-between text-xs mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>
              <span>1</span>
              <span>30</span>
            </div>
          </div>

          {/* Analyze 3D Model button */}
          <button
            onClick={() => onAnalyze(index)}
            disabled={isAnalyzing}
            className="w-full text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            style={{
              borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
              padding: UI_BUTTON.PADDING_MD,
              fontSize: UI_BUTTON.FONT_SIZE,
              fontWeight: UI_BUTTON.FONT_WEIGHT,
              backgroundColor: UI_COLORS.PRIMARY
            }}
            onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER)}
            onMouseLeave={(e) => !e.currentTarget.disabled && (e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY)}
          >
            {isAnalyzing ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyzing...
              </>
            ) : (
              'Analyze 3D Model'
            )}
          </button>

          {/* Show selected entities count below button */}
          {hasSelectedEntities && !isAnalyzing && (
            <div
              className="rounded p-2 text-xs"
              style={{
                backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                borderColor: UI_COLORS.SUCCESS,
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '8px',
                color: UI_COLORS.SUCCESS
              }}
            >
              ✨ {config.selectedDiverseEntities.length} diverse objects selected
            </div>
          )}

          {/* Generate Sound Ideas button */}
          {hasSelectedEntities && (
            <button
              onClick={() => onAnalyze(index)}
              disabled={isAnalyzing}
              className="w-full text-white transition-colors"
              style={{
                borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
                padding: UI_BUTTON.PADDING_MD,
                fontSize: UI_BUTTON.FONT_SIZE,
                fontWeight: UI_BUTTON.FONT_WEIGHT,
                backgroundColor: isAnalyzing ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
                opacity: isAnalyzing ? 0.4 : 1,
                cursor: isAnalyzing ? 'not-allowed' : 'pointer'
              }}
              onMouseEnter={(e) => {
                if (!isAnalyzing) {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY_HOVER;
                }
              }}
              onMouseLeave={(e) => {
                if (!isAnalyzing) {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                }
              }}
            >
              Generate Sound Ideas
            </button>
          )}
        </div>
      )}
    </div>
  );
}

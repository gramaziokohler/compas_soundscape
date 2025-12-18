'use client';

import { useState } from 'react';
import type { AnalysisConfig, AnalysisResult, ModelAnalysisConfig, AudioAnalysisConfig, TextAnalysisConfig } from '@/types/analysis';
import { Model3DContextContent } from '@/components/layout/sidebar/analysis/Model3DContextContent';
import { AudioContextContent } from '@/components/layout/sidebar/analysis/AudioContextContent';
import { TextContextContent } from '@/components/layout/sidebar/analysis/TextContextContent';
import { AnalysisResultContent } from '@/components/layout/sidebar/analysis/AnalysisResultContent';
import { UI_COLORS } from '@/lib/constants';

/**
 * AnalysisTab Component
 * 
 * Displays a single analysis configuration in the sidebar.
 * 
 * **States:**
 * - Collapsed: Shows only title and action buttons (delete, reset)
 * - Expanded (no result): Shows full analysis UI with controls
 * - Expanded (has result): Shows selectable text prompts
 * 
 * **Background Colors:**
 * - No result: Lighter neutral background
 * - Has result: Success-tinted background
 */

interface AnalysisTabProps {
  config: AnalysisConfig;
  index: number;
  isExpanded: boolean;
  hasResult: boolean;
  result?: AnalysisResult;
  isAnalyzing?: boolean;

  // Callbacks
  onToggleExpand: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onRemove: (index: number) => void;
  onReset: (index: number) => void;
  onAnalyze: (index: number) => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
}

export function AnalysisTab({
  config,
  index,
  isExpanded,
  hasResult,
  result,
  isAnalyzing,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  onAnalyze,
  onTogglePromptSelection
}: AnalysisTabProps) {
  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingValue, setEditingValue] = useState('');

  // Display name based on type and custom name
  const getDefaultName = () => {
    switch (config.type) {
      case '3d-model':
        if ((config as ModelAnalysisConfig).modelFile) {
          return (config as ModelAnalysisConfig).modelFile!.name;
        }
        return '3D Model Context';
      case 'audio':
        if ((config as AudioAnalysisConfig).audioFile) {
          return (config as AudioAnalysisConfig).audioFile!.name;
        }
        return 'Audio Context';
      case 'text':
        return `Text Context ${index + 1}`;
      default:
        return `Context ${index + 1}`;
    }
  };

  const baseName = config.display_name || getDefaultName();
  const displayName = `${index + 1}. ${baseName}`;

  // Additional info for collapsed state
  const getCollapsedInfo = () => {
    if (hasResult && result) {
      const selectedCount = result.prompts.filter(p => p.selected).length;
      return `(${selectedCount} selected prompt${selectedCount !== 1 ? 's' : ''})`;
    }
    
    // Before generation, show different info based on type
    if (config.type === '3d-model') {
      const modelConfig = config as ModelAnalysisConfig;
      if (modelConfig.selectedDiverseEntities.length > 0) {
        return `(${modelConfig.selectedDiverseEntities.length} selected entities)`;
      }
    }
    
    return '';
  };

  // Name editing handlers
  const handleDoubleClickName = () => {
    setIsEditingName(true);
    setEditingValue(baseName);
  };

  const handleSaveName = () => {
    if (editingValue.trim()) {
      onUpdateConfig(index, { display_name: editingValue.trim() });
    }
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Background color based on result state
  const backgroundColor = hasResult ? UI_COLORS.DARK_BG : UI_COLORS.NEUTRAL_100;
  const textColor = hasResult ? UI_COLORS.NEUTRAL_200 : UI_COLORS.NEUTRAL_900;

  return (
    <div
      className="rounded transition-all"
      style={{
        backgroundColor,
        padding: isExpanded ? '12px' : '8px',
        borderRadius: '8px',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isExpanded ? UI_COLORS.NEUTRAL_300 : UI_COLORS.NEUTRAL_200,
      }}
    >
      {/* Header - Always visible */}
      <div className="flex items-center justify-between gap-2">
        {/* Title - editable on double-click */}
        {isEditingName ? (
          <input
            type="text"
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleEditKeyDown}
            autoFocus
            className="flex-1 text-sm font-medium px-2 py-1 rounded outline-none focus:ring-1"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_100,
              borderColor: UI_COLORS.PRIMARY,
              borderRadius: '8px',
              color: textColor
            }}
          />
        ) : (
          <div
            onDoubleClick={handleDoubleClickName}
            onClick={() => onToggleExpand(index)}
            className="flex-1 text-left text-sm font-medium cursor-pointer transition-opacity group"
            style={{ color: textColor }}
            title="Double-click to edit name"
          >
            <div className="truncate">
              {displayName}
              <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
            </div>
            {!isExpanded && getCollapsedInfo() && (
              <div className="text-xs mt-0.5" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                {getCollapsedInfo()}
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">

          {/* Reset button - only show if result exists */}
          {hasResult && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset(index);
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              style={{
                color: UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
                e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
              }}
              title="Reset to configuration UI"
            >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            </button>
          )}

          {/* Close button - don't allow deleting 3D model context (first tab) */}
          {!(config.type === '3d-model' && index === 0) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(index);
              }}
              className="w-5 h-5 flex items-center justify-center text-lg rounded-full transition-colors leading-none"
              style={{
                color: UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = UI_COLORS.ERROR;
                e.currentTarget.style.backgroundColor = `${UI_COLORS.ERROR}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="Remove analysis"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* If result exists, show prompt selection UI */}
          {hasResult && result ? (
            <AnalysisResultContent
              result={result}
              onTogglePromptSelection={onTogglePromptSelection}
            />
          ) : (
            <>
              {/* If no result, show type-specific analysis UI */}
              {config.type === '3d-model' && (
                <Model3DContextContent
                  config={config as ModelAnalysisConfig}
                  index={index}
                  isAnalyzing={isAnalyzing || false}
                  onUpdateConfig={onUpdateConfig}
                  onAnalyze={onAnalyze}
                />
              )}

              {config.type === 'audio' && (
                <AudioContextContent
                  config={config as AudioAnalysisConfig}
                  index={index}
                  isAnalyzing={isAnalyzing || false}
                  onUpdateConfig={onUpdateConfig}
                  onAnalyze={onAnalyze}
                />
              )}

              {config.type === 'text' && (
                <TextContextContent
                  config={config as TextAnalysisConfig}
                  index={index}
                  isAnalyzing={isAnalyzing || false}
                  onUpdateConfig={onUpdateConfig}
                  onAnalyze={onAnalyze}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

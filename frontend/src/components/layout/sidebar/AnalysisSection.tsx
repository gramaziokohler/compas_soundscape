'use client';

import React, { useMemo, useCallback } from "react";
import type { AnalysisSectionProps, AnalysisConfig, AnalysisResult, ModelAnalysisConfig, AudioAnalysisConfig, TextAnalysisConfig } from "@/types/analysis";
import type { CardTypeOption } from "@/components/ui/CardSection";
import { CARD_TYPE_LABELS } from '@/types/card';
import { CardSection } from "@/components/ui/CardSection";
import { Card } from "@/components/ui/Card";
import { Model3DContextContent } from "@/components/layout/sidebar/analysis/Model3DContextContent";
import { AudioContextContent } from "@/components/layout/sidebar/analysis/AudioContextContent";
import { TextContextContent } from "@/components/layout/sidebar/analysis/TextContextContent";
import { AnalysisResultContent } from "@/components/layout/sidebar/analysis/AnalysisResultContent";
import { useSpeckleStore } from '@/store';
import { useAreaDrawingStore } from '@/store';

/**
 * AnalysisSection Component
 *
 * Manages multiple analysis cards (3D Model, Audio, Text contexts).
 * Each card can generate text prompts that users can select.
 * Selected prompts from all cards are sent to sound generation.
 *
 * **Architecture:**
 * - Uses CardSection for expand/collapse and add button logic
 * - Uses Card component for each analysis item
 * - Content components passed as beforeContent/afterContent props
 */
export function AnalysisSection({
  analysisConfigs = [],
  activeTab,
  isRunning,
  error,
  analysisResult = [],
  hasGlobalModelLoaded = false,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onSetActiveTab,
  onRun, // Generic action callback - passed to content components as onAnalyze
  onStop,
  onReset,
  onTogglePromptSelection,
  onSendToSoundGeneration
}: AnalysisSectionProps) {
  // Get diverse selection from store (works even without a 3D model card)
  const { diverseSelectedObjectIds, clearDiverseSelection } = useSpeckleStore();
  const diverseCount = diverseSelectedObjectIds.size;

  // Area drawing store (for text card draw-area buttons)
  const areaDrawing = useAreaDrawingStore();

  // Helper to check if an analysis has generated results
  const hasResult = useCallback((index: number): boolean => {
    return analysisResult.some(r => r.configIndex === index);
  }, [analysisResult]);

  // Helper to get result for a config index
  const getResult = useCallback((index: number): AnalysisResult | undefined => {
    return analysisResult.find(r => r.configIndex === index);
  }, [analysisResult]);

  // Get collapsed info for a config
  const getCollapsedInfo = useCallback((config: AnalysisConfig, index: number): string => {
    const result = getResult(index);
    if (result) {
      const selectedCount = result.prompts.filter(p => p.selected).length;
      return `(${selectedCount} selected prompt${selectedCount !== 1 ? 's' : ''})`;
    }

    if (config.type === '3d-model') {
      const modelConfig = config as ModelAnalysisConfig;
      if (modelConfig.selectedDiverseEntities.length > 0) {
        return `(${modelConfig.selectedDiverseEntities.length} selected entities)`;
      }
    }

    return '';
  }, [getResult]);

  // Get before content (configuration UI) for a config
  const getBeforeContent = useCallback((config: AnalysisConfig, index: number) => {
    switch (config.type) {
      case '3d-model':
        return (
          <Model3DContextContent
            config={config as ModelAnalysisConfig}
            index={index}
            isAnalyzing={isRunning}
            onUpdateConfig={onUpdateConfig}
          />
        );
      case 'audio':
        return (
          <AudioContextContent
            config={config as AudioAnalysisConfig}
            index={index}
            isAnalyzing={isRunning}
            onUpdateConfig={onUpdateConfig}
          />
        );
      case 'text':
        return (
          <TextContextContent
            config={config as TextAnalysisConfig}
            index={index}
            isAnalyzing={isRunning}
            onUpdateConfig={onUpdateConfig}
          />
        );
      default:
        return null;
    }
  }, [isRunning, onUpdateConfig]);

  // Get after content (result UI) for a config
  const getAfterContent = useCallback((config: AnalysisConfig, index: number) => {
    const result = getResult(index);
    if (!result) return null;

    return (
      <AnalysisResultContent
        analysisResult={result}
        onTogglePromptSelection={onTogglePromptSelection}
      />
    );
  }, [getResult, onTogglePromptSelection]);

  // Check if a 3D model is loaded
  const hasModelLoaded = useMemo(() => {
    if (hasGlobalModelLoaded) return true;
    return analysisConfigs.some(config =>
      config.type === '3d-model' && ((config as ModelAnalysisConfig).modelFile !== null || (config as ModelAnalysisConfig).speckleData !== undefined)
    );
  }, [analysisConfigs, hasGlobalModelLoaded]);

  // Available card types for add button
  const availableTypes: CardTypeOption[] = useMemo(() => [
    {
      type: '3d-model',
      label: CARD_TYPE_LABELS['3d-model'],
      enabled: hasModelLoaded,
      disabledTooltip: 'Import a 3D model first (right sidebar)'
    },
    {
      type: 'audio',
      label: CARD_TYPE_LABELS['audio'],
      enabled: true
    },
    {
      type: 'text',
      label: CARD_TYPE_LABELS['text'],
      enabled: true
    }
  ], [hasModelLoaded]);

  // Calculate total selected prompts
  const totalSelectedPrompts = useMemo(() => {
    return analysisResult.reduce((total, result) => {
      const selectedCount = result.prompts.filter(p => p.selected).length;
      return total + selectedCount;
    }, 0);
  }, [analysisResult]);

  const canSendToGeneration = totalSelectedPrompts > 0;

  // Pending count calculation
  const getPendingCount = useCallback((items: AnalysisConfig[]) => {
    return items.length - analysisResult.length;
  }, [analysisResult.length]);

  // Render card function
  const renderCard = useCallback((
    config: AnalysisConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (index: number) => void
  ) => {
    const configHasResult = hasResult(index);

    // Compute action button state based on card type
    let actionButtonLabel = 'Generate Sound Prompts';
    let actionButtonDisabled = false;
    let actionButtonDisabledReason: string | undefined;
    let actionButtonColor = "success";

    switch (config.type) {
      case '3d-model': {
        const modelConfig = config as ModelAnalysisConfig;
        actionButtonLabel = modelConfig.selectedDiverseEntities.length === 0? 'Auto-select diverse entities' : 'Generate Sound Ideas';
        actionButtonDisabled = modelConfig.modelEntities.length === 0;
        actionButtonDisabledReason = actionButtonDisabled ? 'Loading objects...' : undefined;
        actionButtonColor = modelConfig.selectedDiverseEntities.length === 0 ? 'success' : 'success-hover';
        break;
      }
      case 'audio': {
        const audioConfig = config as AudioAnalysisConfig;
        actionButtonLabel = 'Analyze Sound Events';
        actionButtonDisabled = audioConfig.audioFile === null;
        actionButtonDisabledReason = actionButtonDisabled ? 'No audio file loaded' : undefined;
        break;
      }
      case 'text': {
        const textConfig = config as TextAnalysisConfig;
        actionButtonLabel = 'Generate Sound Prompts';
        actionButtonDisabled = textConfig.textInput.trim().length === 0;
        actionButtonDisabledReason = actionButtonDisabled ? 'Enter a text description' : undefined;
        break;
      }
    }

    // Build custom buttons for text cards (draw area button)
    let customButtons: React.ReactNode[] | undefined;
    if (config.type === 'text') {
      const cardHasArea = areaDrawing.hasArea(index);
      const isDrawingThis = areaDrawing.isDrawing && areaDrawing.drawingCardIndex === index;

      const drawAreaBtn = (
        <button
          key="draw-area"
          onClick={(e) => {
            e.stopPropagation();
            if (isDrawingThis) {
              areaDrawing.cancelDrawing();
            } else {
              areaDrawing.startDrawing(index);
            }
          }}
          title={isDrawingThis ? 'Cancel drawing' : 'Draw area in viewer'}
          className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
            isDrawingThis
              ? 'text-white bg-success'
              : cardHasArea
                ? 'text-success bg-emerald-100'
                : 'text-secondary-hover hover:bg-emerald-100'
          }`}
        >
          {/* Polygon icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l8 5v10l-8 5-8-5V7z" />
          </svg>
        </button>
      );
      customButtons = [drawAreaBtn];
    }

    return (
      <Card
        config={config}
        index={index}
        isExpanded={isExpanded}
        hasResult={configHasResult}
        result={getResult(index)}
        isRunning={isRunning}
        collapsedInfo={getCollapsedInfo(config, index)}
        showIndex={true}
        canRemove={true}
        closeButtonTitle="Remove analysis"
        resetButtonTitle="Reset to configuration UI"
        onToggleExpand={onToggleExpand}
        onUpdateConfig={onUpdateConfig}
        onRemove={onRemoveConfig}
        onReset={onReset}
        beforeContent={getBeforeContent(config, index)}
        afterContent={getAfterContent(config, index)}
        // Action button props
        onRun={onRun ? async () => onRun(index) : undefined}
        onCancel={onStop ? () => onStop() : undefined}
        actionButtonLabel={actionButtonLabel}
        actionButtonDisabled={actionButtonDisabled}
        actionButtonDisabledReason={actionButtonDisabledReason}
        actionButtonColor={actionButtonColor}
        color="success"
        customButtons={customButtons}
      />
    );
  }, [hasResult, getResult, isRunning, getCollapsedInfo, onUpdateConfig, onRemoveConfig, onReset, getBeforeContent, getAfterContent, onRun, onStop, areaDrawing]);

  // Footer with send button
  const footer = (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-center text-secondary-hover">
        ({totalSelectedPrompts} sound prompt{totalSelectedPrompts !== 1 ? 's' : ''})
      </div>

      <button
        onClick={onSendToSoundGeneration}
        disabled={!canSendToGeneration}
        className={`w-full py-2 px-4 rounded-md text-white text-xs font-medium transition-colors ${
          canSendToGeneration
            ? 'hover:opacity-80 cursor-pointer'
            : 'bg-secondary-hover opacity-40 cursor-not-allowed'
        }`}
        style={canSendToGeneration ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
      >
        Send to Sound Generation
      </button>
    </div>
  );

  const header = (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-success">
        Context cards
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="flex-1">
        <CardSection
          items={analysisConfigs}
          availableTypes={availableTypes}
          emptyMessage="No analysis contexts yet. Import a 3D model from the right sidebar to get started."
          statusLabel="context"
          addButtonTitle="Add context analysis"
          onAddItem={onAddConfig}
          renderCard={renderCard}
          footer={footer}
          header={header}
          getPendingCount={getPendingCount}
          isRunning={isRunning}
          error={error}
          color="success"
        />
      </div>

      {/* Diverse selection indicator — anchored at bottom of analysis section */}
      {diverseCount > 0 && (
        <div className="sticky bottom-0 z-20 flex items-center justify-between py-2 bg-background">
          <span className="text-xs text-success">
            {diverseCount} object{diverseCount !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={clearDiverseSelection}
            className="w-5 h-5 flex items-center justify-center rounded-full transition-colors text-secondary-hover hover:bg-secondary-light hover:text-foreground cursor-pointer"
            title="Clear diverse selection"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
      )}
    </div>
  );
}

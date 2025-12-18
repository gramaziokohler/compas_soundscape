'use client';

import { useState, useRef, useEffect, useMemo } from "react";
import type { AnalysisSectionProps, AnalysisType } from "@/types/analysis";
import { AnalysisTab } from "./AnalysisTab";
import { UI_COLORS, UI_BUTTON } from "@/lib/constants";

/**
 * AnalysisSection Component
 * 
 * Manages multiple analysis tabs (3D Model, Audio, Text contexts)
 * Each tab can generate text prompts that users can select
 * Selected prompts from all tabs are sent to sound generation
 */
export function AnalysisSection({
  analysisConfigs,
  activeAnalysisTab,
  isAnalyzing,
  analysisError,
  analysisResults,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onSetActiveTab,
  onAnalyze,
  onStopAnalysis,
  onTogglePromptSelection,
  onSendToSoundGeneration,
  onReset
}: AnalysisSectionProps) {
  // Track which analysis tabs are expanded
  const [expandedTabs, setExpandedTabs] = useState<Set<number>>(new Set([0])); // Default first tab expanded

  // Track analysis type selector dropdown visibility
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const typeSelectorRef = useRef<HTMLDivElement>(null);
  
  // Refs for scrolling
  const analysisListRef = useRef<HTMLDivElement>(null);
  const analysisTabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Helper to check if an analysis has generated results
  const hasResult = (index: number): boolean => {
    return analysisResults.some(r => r.configIndex === index);
  };

  // Helper to get result for a config index
  const getResult = (index: number) => {
    return analysisResults.find(r => r.configIndex === index);
  };

  // Toggle expansion of an analysis tab (only one can be expanded at a time)
  const handleToggleExpand = (index: number) => {
    setExpandedTabs(prev => {
      const wasExpanded = prev.has(index);

      if (wasExpanded) {
        return new Set(); // Collapse if already expanded
      }

      // Expand this tab and scroll to it
      setTimeout(() => {
        const tabElement = analysisTabRefs.current.get(index);
        tabElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);

      return new Set([index]); // Expand only this tab
    });
  };

  // Handle reset (convert generated result back to configuration UI)
  const handleReset = (index: number) => {
    onReset(index);
  };

  // Calculate analysis status
  const analysisStatus = useMemo(() => {
    const totalContexts = analysisConfigs.length;
    const completedCount = analysisResults.length;
    const pendingCount = totalContexts - completedCount;
    return { totalContexts, completedCount, pendingCount };
  }, [analysisConfigs.length, analysisResults.length]);

  // Calculate total selected prompts across all tabs
  const totalSelectedPrompts = useMemo(() => {
    return analysisResults.reduce((total, result) => {
      const selectedCount = result.prompts.filter(p => p.selected).length;
      return total + selectedCount;
    }, 0);
  }, [analysisResults]);

  // Determine if "Send to sound generation" button should be enabled
  const canSendToGeneration = totalSelectedPrompts > 0;

  // When adding a new analysis, expand it and collapse others
  useEffect(() => {
    const lastIndex = analysisConfigs.length - 1;
    if (lastIndex >= 0) {
      setExpandedTabs(new Set([lastIndex]));
    }
  }, [analysisConfigs.length]);

  // Close type selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeSelectorRef.current && !typeSelectorRef.current.contains(event.target as Node)) {
        setShowTypeSelector(false);
      }
    };

    if (showTypeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTypeSelector]);

  // Handle type selection
  const handleTypeSelect = (type: AnalysisType) => {
    onAddConfig(type);
    setShowTypeSelector(false);
  };

  return (
    <div className="flex flex-col gap-3">

      {/* Analysis status */}
      <div className="flex items-center text-xs w-full gap-1" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        {analysisStatus.totalContexts} context{analysisStatus.totalContexts !== 1 ? 's' : ''}
        {analysisStatus.pendingCount > 0 && (
          <span> ({analysisStatus.pendingCount} pending)</span>
        )}

        {/* Add Analysis button with type selector dropdown */}
        <div className="ml-auto relative" ref={typeSelectorRef}>
          <button
            onClick={() => setShowTypeSelector(!showTypeSelector)}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
            style={{
              backgroundColor: UI_COLORS.PRIMARY,
              borderRadius: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY}
            title="Add context analysis"
            aria-label="Add context analysis"
          >
            <span className="text-lg leading-none">+</span>
          </button>

          {/* Type selector dropdown */}
          {showTypeSelector && (
            <div
              className="absolute right-0 mt-1 z-10 rounded shadow-lg"
              style={{
                backgroundColor: 'white',
                borderRadius: '8px',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: UI_COLORS.NEUTRAL_300,
                minWidth: '200px'
              }}
            >
              <button
                onClick={() => handleTypeSelect('3d-model')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '8px 8px 0 0',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                3D Model Context
              </button>
              <button
                onClick={() => handleTypeSelect('audio')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{ color: UI_COLORS.NEUTRAL_900 }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Audio Context
              </button>
              <button
                onClick={() => handleTypeSelect('text')}
                className="w-full text-left px-3 py-2 text-xs transition-colors"
                style={{
                  borderRadius: '0 0 8px 8px',
                  color: UI_COLORS.NEUTRAL_900
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }}
              >
                Text Context
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Vertical list of analysis tabs */}
      <div ref={analysisListRef} className="flex flex-col gap-2">
        {analysisConfigs.map((config, index) => {
          const result = getResult(index);
          return (
          <div
            key={index}
            ref={(el) => {
              if (el) {
                analysisTabRefs.current.set(index, el);
              } else {
                analysisTabRefs.current.delete(index);
              }
            }}
          >
            <AnalysisTab
              config={config}
              index={index}
              isExpanded={expandedTabs.has(index)}
              hasResult={hasResult(index)}
              result={result}
              isAnalyzing={isAnalyzing}
              onToggleExpand={handleToggleExpand}
              onUpdateConfig={onUpdateConfig}
              onRemove={onRemoveConfig}
              onReset={handleReset}
              onAnalyze={onAnalyze}
              onTogglePromptSelection={onTogglePromptSelection}
            />
          </div>
        )})}
      </div>

      {/* Error display */}
      {analysisError && (
        <div
          className="p-3 text-sm rounded"
          style={{
            backgroundColor: UI_COLORS.ERROR_LIGHT,
            borderColor: UI_COLORS.ERROR,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderRadius: '8px',
            color: UI_COLORS.ERROR
          }}
        >
          {analysisError}
        </div>
      )}

      {/* Selected prompts count and Send button */}
      <div className="flex flex-col gap-2">
        <div className="text-xs text-center" style={{ color: UI_COLORS.NEUTRAL_600 }}>
          ({totalSelectedPrompts} sound prompt{totalSelectedPrompts !== 1 ? 's' : ''})
        </div>

        <button
          onClick={onSendToSoundGeneration}
          disabled={!canSendToGeneration}
          className="w-full text-white transition-colors"
          style={{
            borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
            padding: UI_BUTTON.PADDING_MD,
            fontSize: UI_BUTTON.FONT_SIZE,
            fontWeight: UI_BUTTON.FONT_WEIGHT,
            backgroundColor: !canSendToGeneration ? UI_COLORS.NEUTRAL_400 : UI_COLORS.SUCCESS,
            opacity: !canSendToGeneration ? 0.4 : 1,
            cursor: !canSendToGeneration ? 'not-allowed' : 'pointer'
          }}
          onMouseEnter={(e) => {
            if (canSendToGeneration) {
              e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS_HOVER;
            }
          }}
          onMouseLeave={(e) => {
            if (canSendToGeneration) {
              e.currentTarget.style.backgroundColor = UI_COLORS.SUCCESS;
            }
          }}
        >
          Send to Sound Generation
        </button>
      </div>

    </div>
  );
}

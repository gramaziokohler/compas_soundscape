'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ModelAnalysisConfig } from '@/types/analysis';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { getRootNodesForModel } from '@/hooks/useSpeckleTree';
import type { Viewer } from '@speckle/viewer';
import { UI_COLORS, UI_BUTTON } from '@/lib/constants';

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
  // Get viewer ref from context
  const { viewerRef } = useSpeckleViewerContext();
  
  // Get selection mode context
  const { diverseSelectedObjectIds } = useSpeckleSelectionMode();

  // World tree state (for entity population only)
  const [worldTree, setWorldTree] = useState<any>(null);
  const worldTreeRef = useRef<any>(null);
  const hasLoadedTreeRef = useRef<boolean>(false);

  // Trigger tree fetch when viewer becomes available or speckleData changes
  useEffect(() => {
    if (!viewerRef?.current || !config.speckleData) return;

    const attemptTreeLoad = () => {
      if (!viewerRef.current) return false;

      const tree = viewerRef.current.getWorldTree();
      if (tree) {
        const rootNodes = getRootNodesForModel(tree);
        
        if (rootNodes && rootNodes.length > 0) {
          hasLoadedTreeRef.current = true;
          worldTreeRef.current = tree;
          setWorldTree(tree);
          return true;
        }
      }
      return false;
    };

    if (attemptTreeLoad()) return;

    const timeouts: NodeJS.Timeout[] = [];
    const delays = [500, 1000, 1500, 2000, 2500, 3000];
    
    delays.forEach(delay => {
      const timeout = setTimeout(() => {
        if (!hasLoadedTreeRef.current) {
          attemptTreeLoad();
        }
      }, delay);
      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [viewerRef?.current, config.speckleData]);
  
  // Sync diverse selections from context to config
  useEffect(() => {
    const diverseIds = Array.from(diverseSelectedObjectIds);
    const diverseEntities = config.modelEntities.filter(entity => 
      diverseIds.includes(entity.nodeId || entity.id)
    );
    
    // Only update if different to avoid infinite loops
    const currentIds = config.selectedDiverseEntities.map(e => e.nodeId || e.id).sort();
    const newIds = diverseEntities.map(e => e.nodeId || e.id).sort();
    
    if (JSON.stringify(currentIds) !== JSON.stringify(newIds)) {
      onUpdateConfig(index, { selectedDiverseEntities: diverseEntities });
    }
  }, [diverseSelectedObjectIds, config.modelEntities, index, onUpdateConfig]);

  // Auto-populate entities from worldTree (recursively traverse children)
  useEffect(() => {
    // Only populate if we have worldTree and speckleData
    if (!worldTree || !config.speckleData) {
      return;
    }
    
    // Debounce: Wait 500ms for tree to stabilize
    const timeout = setTimeout(() => {
      
      // Extract entities by recursively walking the tree
      const entities: any[] = [];
      let entityIndex = 0;
      
      const processNode = (node: any) => {
        if (!node) return;
        
        const hasRenderView = node.model?.renderView || node.renderView;
        const raw = node.raw || node.model?.raw || {};
        const id = raw.id || node.model?.id || node.id || `node-${entityIndex}`;
        const speckleType = raw.speckle_type || raw.speckle?.type || 'Object';
        const name = raw.name || node.model?.name || speckleType.split('.').pop() || 'Object';
        
        // Include nodes that have a render view or speckle_type
        if (hasRenderView || raw.speckle_type) {
          entities.push({
            id,
            index: entityIndex++,
            type: speckleType,
            name,
            speckle_type: speckleType,
            raw,
            nodeId: id,
          });
        }
        
        // Recursively process children
        const nodeChildren = node.model?.children || node.children;
        if (nodeChildren && Array.isArray(nodeChildren)) {
          nodeChildren.forEach(processNode);
        }
      };
      
      // Start from root children using the helper function
      const rootNodes = getRootNodesForModel(worldTree);
      
      if (rootNodes && Array.isArray(rootNodes)) {
        rootNodes.forEach(processNode);
      }
      
      if (entities.length > 0 && entities.length !== config.modelEntities.length) {
        onUpdateConfig(index, { modelEntities: entities });
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [worldTree, config.speckleData, config.modelEntities.length, index, onUpdateConfig]);

  // Model is loaded if we have a file OR speckleData (new Speckle workflow)
  const hasModelLoaded = config.modelFile !== null || config.speckleData !== undefined;
  const hasSelectedEntities = config.selectedDiverseEntities.length > 0;

  return (
    <div className="space-y-3">
      {/* Model not loaded message */}
      {!hasModelLoaded && (
        <div
          className="rounded p-3 text-xs text-center"
          style={{
            backgroundColor: UI_COLORS.NEUTRAL_100,
            color: UI_COLORS.NEUTRAL_600,
          }}
        >
          No model loaded. Import a 3D model from the right sidebar.
        </div>
      )}

      {/* Model loaded UI */}
      {hasModelLoaded && (
        <div className="space-y-3">
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
            ✓ Model: {config.modelFile?.name || 'Unknown'}
            <div style={{ color: UI_COLORS.SUCCESS_HOVER }}>
              {config.modelEntities.length > 0 
                ? `${config.modelEntities.length} objects` 
                : 'Loading objects...'}
            </div>
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
            disabled={isAnalyzing || config.modelEntities.length === 0}
            className="w-full text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
            style={{
              borderRadius: UI_BUTTON.BORDER_RADIUS_MD,
              padding: UI_BUTTON.PADDING_MD,
              fontSize: UI_BUTTON.FONT_SIZE,
              fontWeight: UI_BUTTON.FONT_WEIGHT,
              backgroundColor: UI_COLORS.PRIMARY,
              cursor: (isAnalyzing || config.modelEntities.length === 0) ? 'not-allowed' : 'pointer'
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
            ) : config.modelEntities.length === 0 ? (
              'Loading objects...'
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

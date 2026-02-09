'use client';

import { useState, useRef, useEffect } from 'react';
import type { ModelAnalysisConfig } from '@/types/analysis';
import { useSpeckleViewerContext } from '@/contexts/SpeckleViewerContext';
import { useSpeckleSelectionMode } from '@/contexts/SpeckleSelectionModeContext';
import { getRootNodesForModel } from '@/hooks/useSpeckleTree';
import { UI_COLORS, NUM_SOUNDS_MIN, NUM_SOUNDS_MAX } from '@/lib/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';

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
}

export function Model3DContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig
}: Model3DContextContentProps) {
  // Get viewer ref from context
  const { viewerRef } = useSpeckleViewerContext();
  
  // Get selection mode context
  const { diverseSelectedObjectIds, setDiverseSelection } = useSpeckleSelectionMode();

  // World tree state (for entity population only)
  const [worldTree, setWorldTree] = useState<any>(null);
  const worldTreeRef = useRef<any>(null);
  const hasLoadedTreeRef = useRef<boolean>(false);

  // Track the source of diverse selection updates to prevent infinite loops
  // 'backend' = update came from backend API (should sync config → context)
  // 'context' = update came from manual user action (should sync context → config)
  // null = no pending sync
  const syncSourceRef = useRef<'backend' | 'context' | null>(null);

  // Track previous config entity count to detect backend updates
  const prevConfigEntityCountRef = useRef<number>(0);

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
  
  // Detect backend updates to config.selectedDiverseEntities
  // This runs when the backend returns selected entities (count changes significantly)
  useEffect(() => {
    const currentCount = config.selectedDiverseEntities.length;
    const prevCount = prevConfigEntityCountRef.current;

    // Detect if this is a backend update (count changed and we have entities)
    // Backend updates typically set a specific number of entities all at once
    if (currentCount > 0 && currentCount !== prevCount) {
      // Extract nodeIds from config.selectedDiverseEntities
      const configNodeIds = config.selectedDiverseEntities
        .map(entity => entity.nodeId || entity.id)
        .filter(Boolean);

      // Get current context IDs for comparison
      const contextIds = Array.from(diverseSelectedObjectIds);

      // Only sync if this looks like a backend update (not a context-driven update)
      // Backend updates: config has entities that context doesn't know about
      const configHasNewEntities = configNodeIds.some(id => !contextIds.includes(id));

      if (configHasNewEntities) {
        console.log('[Model3DContextContent] Backend update detected, syncing config -> context:', {
          configCount: configNodeIds.length,
          contextCount: contextIds.length
        });
        syncSourceRef.current = 'backend';
        setDiverseSelection(configNodeIds);
      }
    }

    prevConfigEntityCountRef.current = currentCount;
  }, [config.selectedDiverseEntities, diverseSelectedObjectIds, setDiverseSelection]);

  // Sync FROM context TO config (for manual selections via EntityInfoPanel)
  // This handles when user manually adds/removes entities from diverse selection
  useEffect(() => {
    // Skip if this update came from a backend sync (prevents infinite loop)
    if (syncSourceRef.current === 'backend') {
      syncSourceRef.current = null;
      return;
    }

    const diverseIds = Array.from(diverseSelectedObjectIds);
    const diverseEntities = config.modelEntities.filter(entity =>
      diverseIds.includes(entity.nodeId || entity.id)
    );

    // Compare IDs to check if update is needed
    const currentIds = config.selectedDiverseEntities.map(e => e.nodeId || e.id).sort();
    const newIds = diverseEntities.map(e => e.nodeId || e.id).sort();

    const isDifferent = currentIds.length !== newIds.length ||
      !currentIds.every((id, i) => id === newIds[i]);

    if (isDifferent) {
      console.log('[Model3DContextContent] Manual selection, syncing context -> config:', {
        contextCount: diverseIds.length,
        configCount: currentIds.length,
        newConfigCount: newIds.length
      });
      onUpdateConfig(index, { selectedDiverseEntities: diverseEntities });
    }
  }, [diverseSelectedObjectIds, config.modelEntities, config.selectedDiverseEntities, index, onUpdateConfig]);

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
            <div className="mx-4 text-xs text-secondary-hover">
              {!(config.selectedDiverseEntities.length > 0)
                // ? `${config.modelEntities.length} objects`
                ? 'Select diverse objects from the model or auto-select below.' 
                : ''}
            </div>

          {/* Number of sounds */}
          <RangeSlider
            label="Number of sounds: "
            value={config.numSounds}
            min={NUM_SOUNDS_MIN}
            max={NUM_SOUNDS_MAX}
            step={1}
            onChange={(value) => onUpdateConfig(index, { numSounds: value })}
          />

          {/* Note: Action button is rendered by Card component */}
        </div>
      )}
    </div>
  );
}

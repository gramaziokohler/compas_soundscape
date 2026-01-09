/**
 * SimulationTab Component
 * 
 * Displays a single acoustic simulation configuration in the Acoustics sidebar.
 * Similar to SoundTab but for acoustic simulations.
 * 
 * **States:**
 * - Collapsed: Shows only title, mode, and status (close button)
 * - Expanded (before simulation): Shows full simulation settings UI
 * - Expanded (after simulation): Shows simulation results and IR Library
 * 
 * **Background Colors:**
 * - Before simulation / Idle: Lighter neutral background
 * - After simulation (completed): Success-tinted background
 */

'use client';

import { useState, useMemo, useCallback } from 'react';
import { UI_COLORS } from '@/lib/constants';
import type { SimulationConfig, AcousticSimulationMode } from '@/types/acoustics';
import type { ReceiverData, SoundEvent, CompasGeometry } from '@/types';
import type { ImpulseResponseMetadata } from '@/types/audio';
import type { AcousticMaterial, SelectedGeometry } from '@/types/materials';

// Import simulation-specific components
import { ResonanceAudioControls } from '@/components/controls/ResonanceAudioControls';
import { SurfaceMaterialsSection } from '@/components/acoustics/SurfaceMaterialsSection';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';

// Import simulation settings components
import { ChorasSimulationSettings } from './ChorasSimulationSettings';
import { PyroomAcousticsSimulationSettings } from './PyroomAcousticsSimulationSettings';

interface SimulationTabProps {
  config: SimulationConfig;
  index: number;
  isExpanded: boolean;
  isActive: boolean; // Whether this simulation is currently applied to audio orchestrator
  
  // Callbacks
  onToggleExpand: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<SimulationConfig>) => void;
  onRemove: (index: number) => void;
  onReset: (index: number) => void;
  onActivate: (index: number) => void;
  onUpdateName: (index: number, name: string) => void;
  
  // Simulation execution
  onRunSimulation?: (index: number) => Promise<void>;
  onCancelSimulation?: (index: number) => void;
  
  // Shared props
  modelFile?: File | null;
  geometryData?: CompasGeometry | null;
  receivers?: ReceiverData[];
  soundscapeData?: SoundEvent[] | null;
  
  // Material assignment (for Choras and Pyroomacoustics)
  availableMaterials?: AcousticMaterial[];
  modelEntities?: any[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onHoverGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;

  // Resonance Audio specific
  resonanceAudioConfig?: any;
  onToggleResonanceAudio?: (enabled: boolean) => void;
  onUpdateRoomMaterials?: (materials: any) => void;
  hasGeometry?: boolean;
  showBoundingBox?: boolean;
  onToggleBoundingBox?: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  
  // IR Library
  onIRImported?: () => void;
  irRefreshTrigger?: number;
  onSelectIRFromLibrary?: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR?: () => void;
  selectedIRId?: string | null;
  auralizationConfig?: any;
}

// Helper to get mode display name
function getModeDisplayName(mode: AcousticSimulationMode): string {
  switch (mode) {
    case 'resonance': return 'Resonance Audio';
    case 'choras': return 'Choras';
    case 'pyroomacoustics': return 'PyroomAcoustics';
  }
}

// Helper to get status display text
function getStatusDisplay(config: SimulationConfig): { text: string; color: string } {
  if (config.mode === 'resonance') {
    return { text: '', color: '' }; // No status for Resonance Audio
  }

  const simConfig = config as any;
  
  if (simConfig.state === 'completed' && simConfig.simulationResults) {
    return { text: 'Completed', color: UI_COLORS.SUCCESS };
  }
  
  if (simConfig.isRunning) {
    const progress = simConfig.progress || 0;
    return { text: `${progress}%`, color: UI_COLORS.PRIMARY };
  }
  
  if (simConfig.error) {
    return { text: 'Error', color: UI_COLORS.ERROR };
  }
  
  if (simConfig.state === 'idle' || simConfig.state === 'before-simulation') {
    return { text: 'Pending', color: UI_COLORS.NEUTRAL_500 };
  }
  
  return { text: '', color: '' };
}

export function SimulationTab({
  config,
  index,
  isExpanded,
  isActive,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  onActivate,
  onUpdateName,
  onRunSimulation,
  onCancelSimulation,
  modelFile,
  geometryData,
  receivers = [],
  soundscapeData = [],
  availableMaterials = [],
  modelEntities = [],
  modelType = null,
  selectedGeometry = null,
  onSelectGeometry,
  onHoverGeometry,
  onAssignMaterial,
  resonanceAudioConfig,
  onToggleResonanceAudio,
  onUpdateRoomMaterials,
  hasGeometry = false,
  showBoundingBox = false,
  onToggleBoundingBox,
  onRefreshBoundingBox,
  onIRImported,
  irRefreshTrigger = 0,
  onSelectIRFromLibrary,
  onClearIR,
  selectedIRId = null,
  auralizationConfig
}: SimulationTabProps) {
  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingValue, setEditingValue] = useState('');

  // Display name
  const displayName = `${index + 1}. ${config.name}`;
  const modeDisplay = getModeDisplayName(config.mode);
  const statusDisplay = getStatusDisplay(config);

  // Background color based on simulation state
  const isCompleted = config.state === 'completed';
  const backgroundColor = isCompleted ? UI_COLORS.DARK_BG : UI_COLORS.NEUTRAL_100;
  const textColor = isCompleted ? UI_COLORS.NEUTRAL_200 : UI_COLORS.NEUTRAL_900;

  // Name editing handlers
  const handleDoubleClickName = () => {
    setIsEditingName(true);
    setEditingValue(config.name);
  };

  const handleSaveName = () => {
    if (editingValue.trim()) {
      onUpdateName(index, editingValue.trim());
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

  // Handle simulation execution
  const handleRunSimulation = async () => {
    if (onRunSimulation) {
      await onRunSimulation(index);
    }
  };

  const handleCancelSimulation = () => {
    if (onCancelSimulation) {
      onCancelSimulation(index);
    }
  };

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
        outline: isActive ? `2px solid ${UI_COLORS.PRIMARY}` : 'none',
        outlineOffset: '2px'
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
            onClick={() => {
              onToggleExpand(index);
              onActivate(index);
            }}
            className="flex-1 text-left text-sm font-medium cursor-pointer transition-opacity group"
            style={{ color: textColor }}
            title="Double-click to edit name, click to expand/activate"
          >
            <div className="truncate">
              {displayName} ({modeDisplay})
              <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
            </div>
            {statusDisplay.text && (
              <div className="text-xs mt-0.5" style={{ color: statusDisplay.color }}>
                {statusDisplay.text}
              </div>
            )}
          </div>
        )}

        {/* Reset button - only show if simulation is completed */}
        {isCompleted && (
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
            title="Reset to simulation setup"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          className="w-5 h-5 flex items-center justify-center text-lg rounded-full transition-colors leading-none flex-shrink-0"
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
          title="Remove simulation"
        >
          ×
        </button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* Resonance Audio Mode */}
          {config.mode === 'resonance' && resonanceAudioConfig && onToggleResonanceAudio && onUpdateRoomMaterials && (
            <ResonanceAudioControls
              config={resonanceAudioConfig}
              onToggle={onToggleResonanceAudio}
              onUpdateRoomMaterials={onUpdateRoomMaterials}
              hasGeometry={hasGeometry}
              showBoundingBox={showBoundingBox}
              onToggleBoundingBox={onToggleBoundingBox!}
              onRefreshBoundingBox={onRefreshBoundingBox}
            />
          )}

          {/* Choras Mode */}
          {config.mode === 'choras' && (
            <>
              {/* Surface Materials - always render when callbacks are available */}
              {!isCompleted && onSelectGeometry && onAssignMaterial && (
                <SurfaceMaterialsSection
                  key={`${config.id}-${(config as any).resetTimestamp || 0}`}
                  modelEntities={modelEntities}
                  modelType={modelType}
                  geometryData={geometryData || null}
                  selectedGeometry={selectedGeometry || null}
                  onSelectGeometry={onSelectGeometry}
                  onHoverGeometry={onHoverGeometry}
                  onAssignMaterial={onAssignMaterial}
                  availableMaterials={availableMaterials}
                  expandedItems={(config as any).expandedMaterialItems ? new Set((config as any).expandedMaterialItems) : undefined}
                  onExpandedItemsChange={(items) => onUpdateConfig(index, { expandedMaterialItems: Array.from(items) } as any)}
                  initialAssignments={(config as any).faceToMaterialMap}
                  resetTrigger={(config as any).resetTimestamp}
                  excludedLayers={(config as any).excludedLayers ? new Set((config as any).excludedLayers) : undefined}
                  onExcludedLayersChange={(layers) => onUpdateConfig(index, { excludedLayers: Array.from(layers) } as any)}
                />
              )}

              {/* Simulation Settings (before or during simulation) */}
              {(!isCompleted || (config as any).isRunning) && (
                <ChorasSimulationSettings
                  config={config as any}
                  modelFile={modelFile || null}
                  receivers={receivers}
                  soundscapeData={soundscapeData || []}
                  onUpdateConfig={(updates: Partial<SimulationConfig>) => onUpdateConfig(index, updates)}
                  onRunSimulation={handleRunSimulation}
                  onCancelSimulation={handleCancelSimulation}
                />
              )}

              {/* Acoustic Metrics (after simulation) - extracted from simulation results */}
              {isCompleted && (config as any).simulationResults && (() => {
                const results = (config as any).simulationResults;
                const metricsMatch = results.match(/Acoustic Metrics:\s*\n?(RT60:[^\n]+)/);
                const metricsLine = metricsMatch ? metricsMatch[1] : null;

                return metricsLine ? (
                  <div
                    className="px-3 py-2 rounded text-xs"
                    style={{
                      color: 'white',
                      borderRadius: '8px'
                    }}
                  >
                    <div className="font-medium mb-1">Acoustic Metrics:</div>
                    <div>{metricsLine}</div>
                  </div>
                ) : null;
              })()}

              {/* IR Library (after simulation) */}
              {isCompleted && onSelectIRFromLibrary && onClearIR && (
                <div className="flex flex-col gap-2">
                  <ImpulseResponseUpload
                    onSelectIR={onSelectIRFromLibrary}
                    onClearIR={onClearIR}
                    selectedIRId={selectedIRId}
                    auralizationConfig={auralizationConfig}
                    simulationResults={(config as any).simulationResults}
                    refreshTrigger={irRefreshTrigger}
                    simulationIRIds={(config as any).importedIRIds}
                    isSimulationMode={true}
                  />
                </div>
              )}
            </>
          )}

          {/* Pyroomacoustics Mode */}
          {config.mode === 'pyroomacoustics' && (
            <>
              {/* Surface Materials - always render when callbacks are available */}
              {!isCompleted && onSelectGeometry && onAssignMaterial && (
                <SurfaceMaterialsSection
                  key={`${config.id}-${(config as any).resetTimestamp || 0}`}
                  modelEntities={modelEntities}
                  modelType={modelType}
                  geometryData={geometryData || null}
                  selectedGeometry={selectedGeometry || null}
                  onSelectGeometry={onSelectGeometry}
                  onHoverGeometry={onHoverGeometry}
                  onAssignMaterial={onAssignMaterial}
                  availableMaterials={availableMaterials}
                  expandedItems={(config as any).expandedMaterialItems ? new Set((config as any).expandedMaterialItems) : undefined}
                  onExpandedItemsChange={(items) => onUpdateConfig(index, { expandedMaterialItems: Array.from(items) } as any)}
                  initialAssignments={(config as any).faceToMaterialMap}
                  resetTrigger={(config as any).resetTimestamp}
                  excludedLayers={(config as any).excludedLayers ? new Set((config as any).excludedLayers) : undefined}
                  onExcludedLayersChange={(layers) => onUpdateConfig(index, { excludedLayers: Array.from(layers) } as any)}
                />
              )}

              {/* Simulation Settings (before or during simulation) */}
              {(!isCompleted || (config as any).isRunning) && (
                <PyroomAcousticsSimulationSettings
                  config={config as any}
                  modelFile={modelFile || null}
                  receivers={receivers}
                  soundscapeData={soundscapeData || []}
                  onUpdateConfig={(updates: Partial<SimulationConfig>) => onUpdateConfig(index, updates)}
                  onRunSimulation={handleRunSimulation}
                  onCancelSimulation={handleCancelSimulation}
                />
              )}

              {/* Acoustic Metrics (after simulation) - extracted from simulation results */}
              {isCompleted && (config as any).simulationResults && (() => {
                const results = (config as any).simulationResults;
                const metricsMatch = results.match(/Acoustic Metrics:\s*\n?(RT60:[^\n]+)/);
                const metricsLine = metricsMatch ? metricsMatch[1] : null;

                return metricsLine ? (
                  <div
                    className="px-3 py-2 rounded text-xs"
                    style={{
                      color: 'white',
                      borderRadius: '8px'
                    }}
                  >
                    <div className="font-medium mb-1">Acoustic Metrics:</div>
                    <div>{metricsLine}</div>
                  </div>
                ) : null;
              })()}

              {/* IR Library (after simulation) */}
              {isCompleted && onSelectIRFromLibrary && onClearIR && (
                <div className="flex flex-col gap-2">
                  <ImpulseResponseUpload
                    onSelectIR={onSelectIRFromLibrary}
                    onClearIR={onClearIR}
                    selectedIRId={selectedIRId}
                    auralizationConfig={auralizationConfig}
                    simulationResults={(config as any).simulationResults}
                    refreshTrigger={irRefreshTrigger}
                    simulationIRIds={(config as any).importedIRIds}
                    isSimulationMode={true}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

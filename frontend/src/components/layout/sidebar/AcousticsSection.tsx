/**
 * AcousticsSection Component
 * 
 * Main container for acoustic simulations, analogous to SoundGenerationSection.
 * Manages multiple simulation configurations (Resonance Audio, Choras, Pyroomacoustics).
 * 
 * Features:
 * - Add simulation button with mode selector dropdown
 * - List of simulation tabs (collapsed/expanded)
 * - Only one simulation can be active at a time (applies to audio orchestrator)
 * - When no simulation is selected, defaults to "No Acoustics" (anechoic)
 * - Each simulation tab retains its settings when switching between tabs
 */

'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { UI_COLORS, UI_BUTTON } from '@/lib/constants';
import type { SimulationConfig, AcousticSimulationMode } from '@/types/acoustics';
import type { ReceiverData, SoundEvent, CompasGeometry, EntityData } from '@/types';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, AuralizationConfig } from '@/types/audio';
import type { AcousticMaterial, SelectedGeometry } from '@/types/materials';
import { SimulationTab } from './SimulationTab';
import { ReceiversSection } from './ReceiversSection';

interface AcousticsSectionProps {
  // Simulation configs
  simulationConfigs: SimulationConfig[];
  activeSimulationIndex: number | null; // Which simulation is currently active (null = no acoustics)
  
  // Callbacks
  onAddConfig: (mode: AcousticSimulationMode) => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<SimulationConfig>) => void;
  onResetSimulation: (index: number) => void;
  onSetActiveSimulation: (index: number | null) => void;
  onUpdateSimulationName: (index: number, name: string) => void;

  // Simulation execution
  onRunSimulation?: (index: number) => Promise<void>;
  onCancelSimulation?: (index: number) => void;
  
  // Shared props
  modelFile?: File | null;
  geometryData?: CompasGeometry | null;
  receivers?: ReceiverData[];
  soundscapeData?: SoundEvent[] | null;
  
  // Material assignment
  availableMaterials?: AcousticMaterial[];
  modelEntities?: EntityData[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  
  // Resonance Audio specific
  resonanceAudioConfig?: ResonanceAudioConfig;
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
  auralizationConfig?: AuralizationConfig;
  
  // Receiver management
  isPlacingReceiver?: boolean;
  onStartPlacingReceiver?: () => void;
  onDeleteReceiver?: (id: string) => void;
  onUpdateReceiverName?: (id: string, name: string) => void;
  onGoToReceiver?: (id: string) => void;
}

export function AcousticsSection({
  simulationConfigs,
  activeSimulationIndex,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onResetSimulation,
  onSetActiveSimulation,
  onUpdateSimulationName,
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
  auralizationConfig,
  isPlacingReceiver = false,
  onStartPlacingReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onGoToReceiver
}: AcousticsSectionProps) {
  // Track which simulation tabs are expanded
  const [expandedTabs, setExpandedTabs] = useState<Set<number>>(new Set());
  
  // Track mode selector dropdown visibility
  const [showModeSelector, setShowModeSelector] = useState(false);
  const modeSelectorRef = useRef<HTMLDivElement>(null);
  
  // Refs for scrolling
  const simulationListRef = useRef<HTMLDivElement>(null);
  const simulationTabRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Simulation status
  const simulationStatus = useMemo(() => {
    const totalSimulations = simulationConfigs.length;
    const completedCount = simulationConfigs.filter(config => config.state === 'completed').length;
    const runningCount = simulationConfigs.filter(config => (config as any).isRunning).length;
    const pendingCount = totalSimulations - completedCount - runningCount;
    
    return { totalSimulations, completedCount, runningCount, pendingCount };
  }, [simulationConfigs]);

  // Toggle expansion of a simulation tab (only one can be expanded at a time)
  const handleToggleExpand = (index: number) => {
    setExpandedTabs(prev => {
      const wasExpanded = prev.has(index);

      if (wasExpanded) {
        return new Set(); // Collapse if already expanded
      }

      // Expand this tab and scroll to it
      setTimeout(() => {
        const tabElement = simulationTabRefs.current.get(index);
        tabElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);

      return new Set([index]); // Expand only this tab
    });
  };

  // When adding a new simulation, expand it and collapse others
  useEffect(() => {
    const lastIndex = simulationConfigs.length - 1;
    if (lastIndex >= 0) {
      setExpandedTabs(new Set([lastIndex]));
    }
  }, [simulationConfigs.length]);

  // When active simulation changes externally, expand it
  useEffect(() => {
    if (activeSimulationIndex !== null && activeSimulationIndex >= 0 && activeSimulationIndex < simulationConfigs.length) {
      setExpandedTabs(new Set([activeSimulationIndex]));

      // Scroll to the active simulation
      setTimeout(() => {
        const tabElement = simulationTabRefs.current.get(activeSimulationIndex);
        tabElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [activeSimulationIndex, simulationConfigs.length]);

  // Close mode selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modeSelectorRef.current && !modeSelectorRef.current.contains(event.target as Node)) {
        setShowModeSelector(false);
      }
    };

    if (showModeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showModeSelector]);

  // Handle mode selection
  const handleModeSelect = (mode: AcousticSimulationMode) => {
    onAddConfig(mode);
    setShowModeSelector(false);
  };

  // Handle simulation activation
  const handleActivate = (index: number) => {
    // If clicking on already active simulation, do nothing (keep it active)
    // If clicking on a different simulation, activate it
    if (activeSimulationIndex !== index) {
      onSetActiveSimulation(index);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Current mode indicator */}
      <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        Current mode: {activeSimulationIndex === null ? 'No Acoustics (Anechoic)' : `Simulation ${activeSimulationIndex + 1}`}
      </div>

      {/* Receivers Section */}
      {onStartPlacingReceiver && onDeleteReceiver && onUpdateReceiverName && onGoToReceiver && (
        <ReceiversSection
          receivers={receivers}
          isPlacingReceiver={isPlacingReceiver}
          onStartPlacingReceiver={onStartPlacingReceiver}
          onDeleteReceiver={onDeleteReceiver}
          onUpdateReceiverName={onUpdateReceiverName}
          onGoToReceiver={onGoToReceiver}
        />
      )}

      {/* Simulation status */}
      <div className="flex items-center text-xs w-full gap-1" style={{ color: UI_COLORS.NEUTRAL_600 }}>
        {simulationStatus.totalSimulations} simulation{simulationStatus.totalSimulations !== 1 ? 's' : ''}
        {simulationStatus.completedCount > 0 && (
          <span> ({simulationStatus.completedCount} completed</span>
        )}
        {simulationStatus.runningCount > 0 && (
          <span>{simulationStatus.completedCount > 0 ? ', ' : ' ('}{simulationStatus.runningCount} running</span>
        )}
        {simulationStatus.pendingCount > 0 && (
          <span>{(simulationStatus.completedCount > 0 || simulationStatus.runningCount > 0) ? ', ' : ' ('}{simulationStatus.pendingCount} pending</span>
        )}
        {(simulationStatus.completedCount > 0 || simulationStatus.runningCount > 0 || simulationStatus.pendingCount > 0) && <span>)</span>}

        {/* Add Simulation button with mode selector dropdown */}
        <div className="ml-auto relative" ref={modeSelectorRef}>
          <button
            onClick={() => setShowModeSelector(!showModeSelector)}
            className="w-8 h-8 rounded text-white font-bold transition-colors flex items-center justify-center"
            style={{
              backgroundColor: UI_COLORS.PRIMARY,
              borderRadius: '8px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_400}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.PRIMARY}
            title="Add simulation"
            aria-label="Add simulation"
          >
            <span className="text-lg leading-none">+</span>
          </button>

          {/* Mode selector dropdown */}
          {showModeSelector && (
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
                onClick={() => handleModeSelect('resonance')}
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
                ShoeBox simulation
              </button>
              <button
                onClick={() => handleModeSelect('pyroomacoustics')}
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
                Ray-tracing simulation
              </button>
                            <button
                onClick={() => handleModeSelect('choras')}
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
                Wave-based simulation
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Vertical list of simulation tabs */}
      <div ref={simulationListRef} className="flex flex-col gap-2">
        {simulationConfigs.map((config, index) => (
          <div
            key={index}
            ref={(el) => {
              if (el) {
                simulationTabRefs.current.set(index, el);
              } else {
                simulationTabRefs.current.delete(index);
              }
            }}
          >
            <SimulationTab
              config={config}
              index={index}
              isExpanded={expandedTabs.has(index)}
              isActive={activeSimulationIndex === index}
              onToggleExpand={handleToggleExpand}
              onUpdateConfig={onUpdateConfig}
              onRemove={onRemoveConfig}
              onReset={onResetSimulation}
              onActivate={handleActivate}
              onUpdateName={onUpdateSimulationName}
              onRunSimulation={onRunSimulation}
              onCancelSimulation={onCancelSimulation}
              modelFile={modelFile}
              geometryData={geometryData}
              receivers={receivers}
              soundscapeData={soundscapeData}
              availableMaterials={availableMaterials}
              modelEntities={modelEntities}
              modelType={modelType}
              selectedGeometry={selectedGeometry}
              onSelectGeometry={onSelectGeometry}
              onAssignMaterial={onAssignMaterial}
              resonanceAudioConfig={resonanceAudioConfig}
              onToggleResonanceAudio={onToggleResonanceAudio}
              onUpdateRoomMaterials={onUpdateRoomMaterials}
              hasGeometry={hasGeometry}
              showBoundingBox={showBoundingBox}
              onToggleBoundingBox={onToggleBoundingBox}
              onRefreshBoundingBox={onRefreshBoundingBox}
              onIRImported={onIRImported}
              irRefreshTrigger={irRefreshTrigger}
              onSelectIRFromLibrary={onSelectIRFromLibrary}
              onClearIR={onClearIR}
              selectedIRId={selectedIRId}
              auralizationConfig={auralizationConfig}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState, useCallback } from 'react';
import { UI_RIGHT_SIDEBAR, UI_SIDEBAR_RESIZE, UI_SCALE } from '@/utils/constants';
import { useRightSidebarStore } from '@/store';
import { useSidebarResize } from '@/hooks/useSidebarResize';
import { useVerticalResize } from '@/hooks/useVerticalResize';
import { useViewportScale } from '@/hooks/useViewportScale';
import { AcousticsSection } from '@/components/layout/sidebar/AcousticsSection';
import { ListenersSection } from '@/components/layout/sidebar/ListenersSection';
import type { ReceiverData, GridListenerData } from '@/types/receiver';
import type { ImpulseResponseMetadata, ResonanceAudioConfig, AuralizationConfig } from '@/types/audio';
import type { SelectedGeometry, AcousticMaterial } from '@/types/materials';
import type { CompasGeometry, EntityData, SoundEvent } from '@/types';
import type { SimulationConfig, AcousticSimulationMode } from '@/types/acoustics';
import type { AudioRenderingMode } from '@/components/audio/AudioRenderingModeSelector';
import type { RoomScale } from '@/components/layout/sidebar/acoustics/ResonanceAudioControls';

/**
 * RightSidebar Component
 *
 * Fixed sidebar on the right side of the screen.
 * Contains AcousticsSection (top 65%) and ListenersSection (bottom 35%).
 * Toggled via a floating button on the mid-right edge of the screen.
 */

interface RightSidebarProps {
  isVisible: boolean;
  /** Fired during resize drag so parent can sync layout-sensitive children. */
  onWidthChange?: (width: number) => void;

  // === AcousticsSection props ===
  onSelectIRFromLibrary: (irMetadata: ImpulseResponseMetadata) => Promise<void>;
  onClearIR: () => void;
  selectedIRId: string | null;
  auralizationConfig: AuralizationConfig;
  resonanceAudioConfig: ResonanceAudioConfig;
  onToggleResonanceAudio: (enabled: boolean) => void;
  onUpdateRoomMaterials: (materials: any) => void;
  hasGeometry: boolean;
  showBoundingBox: boolean;
  onToggleBoundingBox: (show: boolean) => void;
  onRefreshBoundingBox?: () => void;
  roomScale?: RoomScale;
  onRoomScaleChange?: (scale: RoomScale) => void;
  audioRenderingMode?: AudioRenderingMode;
  onAudioRenderingModeChange?: (mode: AudioRenderingMode) => void;
  modelEntities?: EntityData[];
  modelType?: '3dm' | 'obj' | 'ifc' | null;
  geometryData?: CompasGeometry | null;
  selectedGeometry?: SelectedGeometry | null;
  onSelectGeometry?: (selection: SelectedGeometry | null) => void;
  onHoverGeometry?: (selection: SelectedGeometry | null) => void;
  onAssignMaterial?: (selection: SelectedGeometry, material: AcousticMaterial | null) => void;
  modelFile?: File | null;
  speckleData?: { model_id: string; version_id: string; object_id: string; url: string; auth_token?: string } | null;
  soundscapeData?: SoundEvent[] | null;
  onIRImported?: () => void;
  irRefreshTrigger?: number;
  simulationConfigs?: SimulationConfig[];
  activeSimulationIndex?: number | null;
  onAddSimulationConfig?: (mode: AcousticSimulationMode) => void;
  onRemoveSimulationConfig?: (index: number) => void;
  onUpdateSimulationConfig?: (index: number, updates: Partial<SimulationConfig>) => void;
  onSetActiveSimulation?: (index: number | null) => void;
  onUpdateSimulationName?: (index: number, name: string) => void;
  onIRHover?: (sourceId: string | null, receiverId: string | null) => void;
  onGoToReceiver?: (receiverId: string) => void;
  fpsExitTrigger?: number;
  isFPSModeActive?: boolean;
  forcedActiveGroupId?: string | null;
  onIRGainChange?: (index: number, gainDb: number) => void;
  onIRNormalizeChange?: (index: number, enabled: boolean) => void;

  // === ListenersSection props ===
  receivers: ReceiverData[];
  gridListeners: GridListenerData[];
  onAddReceiver: (type: string) => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  onUpdateReceiverPosition: (id: string, position: [number, number, number]) => void;
  onToggleReceiverHiddenForSimulation: (id: string) => void;
  onAddGridListener: () => void;
  onDeleteGridListener: (id: string) => void;
  onComputeBounds: (objectIds: string[]) => { min: [number, number, number]; max: [number, number, number] } | null;
  expandedGridListenerId: string | null;
  onExpandedGridListenerChange: (id: string | null) => void;
  onExitFPS?: () => void;
  forcedExpandedListenerId?: string | null;
  collapseListenerCardTrigger?: number;
  listenerOrientation: { x: number; y: number; z: number };
}

export function RightSidebar({
  isVisible,
  onWidthChange,
  // Acoustics
  onSelectIRFromLibrary,
  onClearIR,
  selectedIRId,
  auralizationConfig,
  resonanceAudioConfig,
  onToggleResonanceAudio,
  onUpdateRoomMaterials,
  hasGeometry,
  showBoundingBox,
  onToggleBoundingBox,
  onRefreshBoundingBox,
  roomScale,
  onRoomScaleChange,
  audioRenderingMode,
  onAudioRenderingModeChange,
  modelEntities,
  modelType,
  geometryData,
  selectedGeometry,
  onSelectGeometry,
  onHoverGeometry,
  onAssignMaterial,
  modelFile,
  speckleData,
  soundscapeData,
  onIRImported,
  irRefreshTrigger,
  simulationConfigs,
  activeSimulationIndex,
  onAddSimulationConfig,
  onRemoveSimulationConfig,
  onUpdateSimulationConfig,
  onSetActiveSimulation,
  onUpdateSimulationName,
  onIRHover,
  onGoToReceiver,
  fpsExitTrigger,
  isFPSModeActive,
  forcedActiveGroupId,
  onIRGainChange,
  onIRNormalizeChange,
  // Listeners
  receivers,
  gridListeners,
  onAddReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onUpdateReceiverPosition,
  onToggleReceiverHiddenForSimulation,
  onAddGridListener,
  onDeleteGridListener,
  onComputeBounds,
  expandedGridListenerId,
  onExpandedGridListenerChange,
  onExitFPS,
  forcedExpandedListenerId,
  collapseListenerCardTrigger,
  listenerOrientation,
}: RightSidebarProps) {
  const { isExpanded, requestExpand, requestCollapse, simulationAreaRatio, setSimulationAreaRatio } = useRightSidebarStore();
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const [isSplitHandleHovered, setIsSplitHandleHovered] = useState(false);

  const handleWidthChange = useCallback((w: number) => {
    onWidthChange?.(w);
    useRightSidebarStore.getState().setSidebarWidth(w);
  }, [onWidthChange]);

  // Sidebar width — clamped-fluid (see UI_SCALE.RIGHT_SIDEBAR): proportional to
  // the viewport width between physical min/max bounds.
  const scale = useViewportScale();
  const sidebarMinWidth = scale.physical(UI_SIDEBAR_RESIZE.RIGHT_MIN_WIDTH);
  const sidebarMaxWidth = scale.clampW(
    UI_SCALE.RIGHT_SIDEBAR.MIN,
    UI_SCALE.RIGHT_SIDEBAR.FRACTION,
    UI_SCALE.RIGHT_SIDEBAR.MAX,
  );
  const sidebarDefaultWidth = scale.clampW(
    UI_SCALE.RIGHT_SIDEBAR.MIN,
    UI_SCALE.RIGHT_SIDEBAR.DEFAULT_FRACTION,
    UI_SCALE.RIGHT_SIDEBAR.MAX,
  );

  const { width: sidebarWidth, isResizing, handleMouseDown: handleResizeMouseDown } = useSidebarResize({
    initialWidth: sidebarDefaultWidth,
    minWidth: sidebarMinWidth,
    maxWidth: sidebarMaxWidth,
    direction: 'left',
    onWidthChange: handleWidthChange,
  });

  const {
    ratio: acousticsRatio,
    isResizing: isSplitResizing,
    handleMouseDown: handleSplitResizeMouseDown,
  } = useVerticalResize({
    initialRatio: simulationAreaRatio,
    minRatio: UI_SIDEBAR_RESIZE.RIGHT_SPLIT_MIN_RATIO,
    maxRatio: UI_SIDEBAR_RESIZE.RIGHT_SPLIT_MAX_RATIO,
    onRatioChange: setSimulationAreaRatio,
  });

  const listenersRatio = 1 - acousticsRatio;

  if (!isVisible) return null;

  return (
    <>
      {/* Toggle button — floats at the mid-right edge of the screen */}
      <button
        onClick={() => isExpanded ? requestCollapse() : requestExpand()}
        title={isExpanded ? 'Collapse panel' : 'Acoustics'}
        style={{
          position: 'fixed',
          right: isExpanded ? `${sidebarWidth}px` : '0px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 15,
          transition: 'right 300ms ease-in-out',
        }}
        className="flex flex-col items-center justify-center w-5 py-3 gap-1.5 bg-primary border border-secondary-light rounded-l-md shadow-md hover:bg-primary-hover"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          {isExpanded ? (
            <path d="M3 3L8 8L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M7 3L2 8L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        {!isExpanded && (
          <span
            style={{ writingMode: 'vertical-rl', fontSize: '12px', letterSpacing: '0.05em' }}
            className="text-secondary-light-static font-medium select-none"
          >
            Acoustics
          </span>
        )}
      </button>

      <aside
        className="fixed top-0 right-0 h-screen flex flex-col transition-all duration-300 ease-in-out overflow-hidden bg-background"
        style={{
          width: isExpanded ? `${sidebarWidth}px` : '0px',
          borderLeft: isExpanded ? `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)` : 'none',
          opacity: isExpanded ? 0.95 : 0,
          zIndex: 10,
          userSelect: (isResizing || isSplitResizing) ? 'none' : undefined,
        }}
      >
        {/* Resize handle — left edge */}
        {isExpanded && (
          <div
            onMouseDown={handleResizeMouseDown}
            onMouseEnter={() => setIsHandleHovered(true)}
            onMouseLeave={() => setIsHandleHovered(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: `${UI_SIDEBAR_RESIZE.HANDLE_HIT_AREA}px`,
              height: '100%',
              cursor: 'col-resize',
              zIndex: 20,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'flex-start',
            }}
          >
            <div
              style={{
                width: `${UI_SIDEBAR_RESIZE.HANDLE_WIDTH}px`,
                height: '100%',
                backgroundColor: (isHandleHovered || isResizing) ? 'var(--color-primary)' : 'transparent',
                transition: 'background-color 150ms ease',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        {/* ===== Acoustics Section (top, resizable) ===== */}
        <div
          className="overflow-y-auto"
          style={{ flexGrow: acousticsRatio, flexBasis: 0, minHeight: 0, padding: `${UI_RIGHT_SIDEBAR.PADDING}px`, paddingBottom: '0.5rem' }}
        >
          <AcousticsSection
            onSelectIRFromLibrary={onSelectIRFromLibrary}
            onClearIR={onClearIR}
            selectedIRId={selectedIRId}
            auralizationConfig={auralizationConfig}
            resonanceAudioConfig={resonanceAudioConfig}
            onToggleResonanceAudio={onToggleResonanceAudio}
            onUpdateRoomMaterials={onUpdateRoomMaterials}
            hasGeometry={hasGeometry}
            showBoundingBox={showBoundingBox}
            onToggleBoundingBox={onToggleBoundingBox}
            onRefreshBoundingBox={onRefreshBoundingBox}
            roomScale={roomScale}
            onRoomScaleChange={onRoomScaleChange}
            audioRenderingMode={audioRenderingMode}
            onAudioRenderingModeChange={onAudioRenderingModeChange}
            modelEntities={modelEntities}
            modelType={modelType}
            geometryData={geometryData}
            selectedGeometry={selectedGeometry}
            onSelectGeometry={onSelectGeometry}
            onHoverGeometry={onHoverGeometry}
            onAssignMaterial={onAssignMaterial}
            modelFile={modelFile}
            speckleData={speckleData}
            soundscapeData={soundscapeData}
            onIRImported={onIRImported}
            irRefreshTrigger={irRefreshTrigger}
            simulationConfigs={simulationConfigs}
            activeSimulationIndex={activeSimulationIndex}
            onIRHover={onIRHover}
            onAddSimulationConfig={onAddSimulationConfig}
            onRemoveSimulationConfig={onRemoveSimulationConfig}
            onUpdateSimulationConfig={onUpdateSimulationConfig}
            onSetActiveSimulation={onSetActiveSimulation}
            onUpdateSimulationName={onUpdateSimulationName}
            onGoToReceiver={onGoToReceiver}
            fpsExitTrigger={fpsExitTrigger}
            isFPSModeActive={isFPSModeActive}
            forcedActiveGroupId={forcedActiveGroupId}
            onIRGainChange={onIRGainChange}
            onIRNormalizeChange={onIRNormalizeChange}
          />
        </div>

        {/* Vertical resize handle — split between Acoustics (top) and Listeners (bottom) */}
        <div
          onMouseDown={handleSplitResizeMouseDown}
          onMouseEnter={() => setIsSplitHandleHovered(true)}
          onMouseLeave={() => setIsSplitHandleHovered(false)}
          style={{
            flexShrink: 0,
            height: `${UI_SIDEBAR_RESIZE.HANDLE_HIT_AREA}px`,
            width: '100%',
            cursor: 'row-resize',
            zIndex: 20,
            display: 'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              height: `${UI_SIDEBAR_RESIZE.HANDLE_WIDTH}px`,
              width: '100%',
              backgroundColor: (isSplitHandleHovered || isSplitResizing) ? 'var(--color-primary)' : 'var(--color-secondary-light)',
              transition: 'background-color 150ms ease',
              borderRadius: '2px',
            }}
          />
        </div>

        {/* ===== Listeners Section (bottom, resizable) ===== */}
        <div
          className="overflow-y-auto"
          style={{ flexGrow: listenersRatio, flexBasis: 0, minHeight: 0, padding: `${UI_RIGHT_SIDEBAR.PADDING}px`, paddingTop: '0.5rem' }}
        >
          <ListenersSection
            receivers={receivers}
            gridListeners={gridListeners}
            onAddReceiver={onAddReceiver}
            onDeleteReceiver={onDeleteReceiver}
            onUpdateReceiverName={onUpdateReceiverName}
            onUpdateReceiverPosition={onUpdateReceiverPosition}
            onGoToReceiver={onGoToReceiver ?? (() => {})}
            onToggleReceiverHiddenForSimulation={onToggleReceiverHiddenForSimulation}
            onAddGridListener={onAddGridListener}
            onDeleteGridListener={onDeleteGridListener}
            onComputeBounds={onComputeBounds}
            expandedGridListenerId={expandedGridListenerId}
            onExpandedGridListenerChange={onExpandedGridListenerChange}
            onExitFPS={onExitFPS}
            forcedExpandedId={forcedExpandedListenerId}
            collapseAllTrigger={collapseListenerCardTrigger}
            listenerOrientation={listenerOrientation}
          />
        </div>
      </aside>
    </>
  );
}

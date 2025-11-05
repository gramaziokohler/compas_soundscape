/**
 * Impact Sound Playback UI
 *
 * Minimalistic right-side overlay showing impact sound status and mode visualization controls
 * Matches the style of OrientationIndicator
 */

'use client';

import { UI_COLORS, UI_OVERLAY } from '@/lib/constants';
import type { ModalAnalysisResult, ModeVisualizationState } from '@/types/modal';

interface ImpactSoundPlaybackProps {
  isPlaying: boolean;
  fundamentalFrequency?: number;
  numModes?: number;
  material?: string;
  meshQuality?: string;
  onExit: () => void;
  highlightHelp?: boolean;
  // Mode visualization props
  modalResult?: ModalAnalysisResult | null;
  visualizationState?: ModeVisualizationState;
  onSelectMode?: (modeIndex: number | null) => void;
}

export function ImpactSoundPlayback({
  isPlaying,
  fundamentalFrequency,
  numModes,
  material,
  meshQuality,
  onExit,
  highlightHelp = false,
  modalResult,
  visualizationState,
  onSelectMode,
}: ImpactSoundPlaybackProps) {
  return (
    <div
      className="fixed right-6 top-6 pointer-events-auto z-30"
    >
      <div
        className="rounded-lg px-4 py-3 text-white font-mono text-sm"
        style={{
          backgroundColor: UI_OVERLAY.BACKGROUND,
          backdropFilter: 'blur(8px)',
          borderRadius: '8px',
          borderColor: `${UI_OVERLAY.BORDER_COLOR}`,
          borderWidth: '1px',
          borderStyle: 'solid',
          minWidth: '200px',
        }}
      >
        {/* Header with Exit Button */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isPlaying && (
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: UI_COLORS.PRIMARY,
                }}
              />
            )}
            <span className="font-semibold" style={{ color: 'white' }}>
              Impact Sound
            </span>
          </div>
          
          <button
            onClick={onExit}
            className="w-5 h-5 flex items-center justify-center rounded text-xs transition-all"
            style={{
              backgroundColor: 'transparent',
              color: UI_COLORS.NEUTRAL_400,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_800;
              e.currentTarget.style.color = 'white';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = UI_COLORS.NEUTRAL_400;
            }}
            title="Exit impact mode"
          >
            ✕
          </button>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
          {fundamentalFrequency && (
            <>
              <div style={{ color: UI_COLORS.NEUTRAL_400 }}>Frequency</div>
              <div style={{ color: 'white' }} className="text-right">{fundamentalFrequency.toFixed(0)} Hz</div>
            </>
          )}
          
          {numModes && (
            <>
              <div style={{ color: UI_COLORS.NEUTRAL_400 }}>Modes</div>
              <div style={{ color: 'white' }} className="text-right">{numModes}</div>
            </>
          )}
          
          {material && (
            <>
              <div style={{ color: UI_COLORS.NEUTRAL_400 }}>Material</div>
              <div style={{ color: 'white' }} className="text-right capitalize">{material}</div>
            </>
          )}
          
          {meshQuality && (
            <>
              <div style={{ color: UI_COLORS.NEUTRAL_400 }}>Mesh</div>
              <div 
                style={{ 
                  color: meshQuality.includes('High') ? UI_COLORS.SUCCESS : 
                         meshQuality.includes('Good') ? UI_COLORS.PRIMARY :
                         meshQuality.includes('Bounding') ? UI_COLORS.WARNING : 'white'
                }} 
                className="text-right text-xs"
              >
                {meshQuality}
              </div>
            </>
          )}
        </div>

        {/* Mode Visualization Controls */}
        {modalResult && visualizationState && onSelectMode && (
          <div
            className="pt-3 mt-3 space-y-3"
            style={{
              borderTopColor: `${UI_OVERLAY.BORDER_COLOR}`,
              borderTopWidth: '1px',
              borderTopStyle: 'solid',
            }}
          >
            {/* Mode Selector */}
            <div className="space-y-1.5">
              <div className="text-xs" style={{ color: UI_COLORS.NEUTRAL_400 }}>
                Nodal Lines (Mode Shape)
              </div>
              <select
                value={visualizationState.selectedModeIndex ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  onSelectMode(value === '' ? null : parseInt(value));
                }}
                className="w-full px-2 py-1.5 rounded text-xs transition-colors"
                style={{
                  backgroundColor: UI_OVERLAY.BACKGROUND,
                  color: 'white',
                  border: `1px solid ${UI_OVERLAY.BORDER_COLOR}`,
                }}
              >
                {modalResult.frequencies.map((freq, idx) => (
                  <option key={idx} value={idx}>
                    Mode {idx + 1}: {freq.toFixed(1)} Hz
                  </option>
                ))}
              </select>
            </div>

            {/* Mode Info */}
            {visualizationState.selectedModeIndex !== null && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div style={{ color: UI_COLORS.NEUTRAL_400 }}>Frequency</div>
                <div style={{ color: UI_COLORS.PRIMARY }} className="text-right font-mono">
                  {modalResult.frequencies[visualizationState.selectedModeIndex].toFixed(2)} Hz
                </div>
              </div>
            )}
          </div>
        )}

        {/* Help text - matches OrientationIndicator style */}
        <div
          className={`pt-2 text-xs text-center transition-all duration-500`}
          style={{
            borderTopColor: `${UI_OVERLAY.BORDER_COLOR}`,
            borderTopWidth: '1px',
            borderTopStyle: 'solid',
            color: highlightHelp ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_400,
            fontWeight: highlightHelp ? 'bold' : 'normal',
          }}
        >
          Click object to generate impact
        </div>
      </div>
    </div>
  );
}

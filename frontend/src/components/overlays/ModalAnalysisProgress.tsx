/**
 * Modal Analysis Progress Overlay
 * 
 * Shows progress during backend modal analysis computation
 */

'use client';

import { UI_COLORS } from '@/lib/constants';

interface ModalAnalysisProgressProps {
  entityName?: string;
  onCancel?: () => void;
}

export function ModalAnalysisProgress({ entityName, onCancel }: ModalAnalysisProgressProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-auto z-50"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="p-8 rounded-lg shadow-2xl max-w-md w-full mx-4"
        style={{
          backgroundColor: 'rgba(15, 15, 15, 0.95)',
          border: `2px solid ${UI_COLORS.PRIMARY}`,
        }}
      >
        {/* Title */}
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold mb-2" style={{ color: UI_COLORS.PRIMARY }}>
            🔬 Modal Analysis
          </h2>
          {entityName && (
            <p className="text-sm" style={{ color: UI_COLORS.NEUTRAL_400 }}>
              Analyzing: <span style={{ color: 'white' }}>{entityName}</span>
            </p>
          )}
        </div>

        {/* Animated Spinner */}
        <div className="flex justify-center mb-6">
          <div
            className="animate-spin rounded-full border-4 border-t-transparent"
            style={{
              width: '64px',
              height: '64px',
              borderColor: UI_COLORS.PRIMARY,
              borderTopColor: 'transparent',
            }}
          />
        </div>

        {/* Progress Text */}
        <div className="space-y-2 mb-6 text-sm" style={{ color: UI_COLORS.NEUTRAL_300 }}>
          <div className="flex items-center gap-2">
            <span className="animate-pulse">⚙️</span>
            <span>Computing resonant frequencies...</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>📊</span>
            <span>Analyzing vibration modes...</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>🎵</span>
            <span>Preparing impact synthesis...</span>
          </div>
        </div>

        {/* Info Box */}
        <div
          className="p-4 rounded mb-6 text-xs"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            border: `1px solid ${UI_COLORS.NEUTRAL_700}`,
            color: UI_COLORS.NEUTRAL_400,
          }}
        >
          <p className="mb-2">
            <strong style={{ color: 'white' }}>What's happening?</strong>
          </p>
          <p>
            The system is performing finite element analysis to find the object's natural
            frequencies and vibration modes. This enables physically-accurate impact sounds.
          </p>
        </div>

        {/* Cancel Button */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="w-full py-2 px-4 rounded font-medium transition-colors"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_700,
              color: 'white',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_700;
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

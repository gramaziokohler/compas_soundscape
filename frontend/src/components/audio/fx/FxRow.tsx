'use client';

import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { FX_TYPE_LABELS, isStableAudioFx, type FxInstance, type FxParams } from '@/lib/audio/fx/fx-types';
import { FxInstanceEditor } from './editors/FxInstanceEditor';

interface FxRowProps {
  soundId: string;
  instance: FxInstance;
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  analyser: AnalyserNode | null;
  sampleRate: number;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRemove: () => void;
  onLiveParams: (params: FxParams) => void;
  onCommitParams: (params: FxParams) => void;
}

export function FxRow({
  soundId, instance, isLast, expanded, analyser, sampleRate,
  onToggleExpand, onToggleEnabled, onRemove, onLiveParams, onCommitParams,
}: FxRowProps) {
  return (
    <div className="relative">
      <div
        className="absolute left-0 top-0 bottom-0 w-px"
        style={{
          background: instance.enabled ? 'var(--color-primary)' : 'var(--color-secondary-light)',
          opacity: isLast && !expanded ? 0.4 : 1,
        }}
        aria-hidden
      />
      <div className="pl-3">
        <div className="flex items-center gap-2 min-h-[28px]">
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left text-xs text-foreground cursor-grab"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          >
            {expanded
              ? <ChevronDown size={11} className="shrink-0 text-secondary-hover" />
              : <ChevronRight size={11} className="shrink-0 text-secondary-hover" />}
            {isStableAudioFx(instance.type) && (
              <Sparkles size={11} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
            )}
            <span
              className="truncate"
              style={instance.enabled ? { color: 'var(--color-primary)' } : undefined}
            >
              {FX_TYPE_LABELS[instance.type]}
            </span>
          </button>
          <div
            role="switch"
            aria-checked={instance.enabled}
            title={instance.enabled ? 'Bypass' : 'Enable'}
            className={`toggle-switch ${instance.enabled ? 'checked' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleEnabled(!instance.enabled); }}
          />
          <button
            type="button"
            data-no-drag
            className="text-xs text-secondary-hover hover:text-foreground px-1"
            title="Remove effect"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            ×
          </button>
        </div>
        {expanded && (
          <div className="card-collapse-body">
            <FxInstanceEditor
              soundId={soundId}
              instance={instance}
              analyser={analyser}
              sampleRate={sampleRate}
              onLive={onLiveParams}
              onCommit={onCommitParams}
            />
          </div>
        )}
      </div>
    </div>
  );
}

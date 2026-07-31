'use client';

import type { FoleyResult, FoleySoundEvent, FoleyScenario } from '@/types/analysis';
import { useSpeckleStore } from '@/store';
import { Badge } from '@/components/ui/Badge';

interface ScenarioResultContentProps {
  foleyResult: FoleyResult;
  selectedKeys: string[];
  onToggle: (key: string) => void;
}

interface FoleySoundItemProps {
  sound: FoleySoundEvent;
  checked: boolean;
  onToggle: () => void;
}

function FoleySoundItem({ sound, checked, onToggle }: FoleySoundItemProps) {
  const { highlightObjectForHover, clearHoverHighlight } = useSpeckleStore();
  const involvedIds = sound.objectsInvolved ?? [];

  return (
    <div
      className="flex items-start gap-2 py-1.5 px-2 rounded-md transition-colors cursor-default"
      style={{ borderRadius: '6px' }}
      onMouseEnter={() => involvedIds.length > 0 && highlightObjectForHover(involvedIds)}
      onMouseLeave={() => clearHoverHighlight()}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        className="mt-0.5 flex-shrink-0 cursor-pointer"
        checked={checked}
        onChange={onToggle}
        aria-label={`Select ${sound.soundName}`}
      />

      <div className="flex-1 min-w-0 space-y-0.5">
        {/* Name row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-background-static font-semibold truncate">{sound.soundName}</span>
          {sound.category && (
            <Badge variant="neutral">{sound.category}</Badge>
          )}
          {sound.spl && (
            <span
              className="text-[10px] px-1.5 py-0 rounded-full font-medium flex-shrink-0 ml-auto"
              style={{
                backgroundColor: 'var(--color-primary-light, rgba(var(--color-primary-rgb,0,0,0),0.15))',
                color: 'var(--color-primary)',
              }}
            >
              {sound.spl}
            </span>
          )}
        </div>

        {/* Description */}
        {sound.description && (
          <p className="text-[11px] leading-snug" style={{ color: 'var(--color-neutral-400, #9ca3af)' }}>
            {sound.description}
          </p>
        )}

        {/* Timestamps */}
        {sound.timestamps && sound.timestamps.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {sound.timestamps.map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-1 rounded font-mono"
                style={{
                  backgroundColor: 'var(--color-secondary-light)',
                  color: 'var(--color-secondary-hover)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScenarioResultContent({ foleyResult, selectedKeys, onToggle }: ScenarioResultContentProps) {
  const selectedSet = new Set(selectedKeys);

  if (!foleyResult.scenarios || foleyResult.scenarios.length === 0) {
    return (
      <p className="text-xs text-center py-4" style={{ color: 'var(--color-neutral-400, #9ca3af)' }}>
        No foley sounds generated.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-2">
      {foleyResult.scenarios.map((scenario: FoleyScenario, si: number) => (
        <div key={si}>
          {/* Scenario title */}
          {foleyResult.scenarios.length > 1 && (
            <p
              className="text-xs font-semibold mb-1.5 pb-1"
              style={{
                color: 'var(--color-secondary-hover)',
                borderBottom: '1px solid var(--color-secondary-light)',
              }}
            >
              {scenario.scenario_title}
            </p>
          )}

          <div className="space-y-0.5">
            {scenario.sound_events.map((sound: FoleySoundEvent, ei: number) => {
              const key = `${scenario.scenario_title}__${sound.soundName}`;
              return (
                <FoleySoundItem
                  key={`${si}-${ei}`}
                  sound={sound}
                  checked={selectedSet.has(key)}
                  onToggle={() => onToggle(key)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

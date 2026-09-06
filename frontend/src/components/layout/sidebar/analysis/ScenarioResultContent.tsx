'use client';

import type { FoleyResult, FoleySoundEvent, FoleyScenario } from '@/types/analysis';
import { useSpeckleStore, useUIStore } from '@/store';
import { ToggleField } from '@/components/ui/ToggleField';

/** Pinned above "Analysis Settings" on generated scenario cards. */
export function ScenarioParcoursToggle() {
  const showScenarioParcours = useUIStore((s) => s.showScenarioParcours);
  const setShowScenarioParcours = useUIStore((s) => s.setShowScenarioParcours);

  return (
    <ToggleField
      checked={showScenarioParcours}
      onChange={setShowScenarioParcours}
      label="Show scenario parcours"
      onBlueBackground
      className="!mb-0"
    />
  );
}

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
      className="py-1.5 px-2 rounded-md transition-colors cursor-default"
      style={{ borderRadius: '6px' }}
      onMouseEnter={() => involvedIds.length > 0 && highlightObjectForHover(involvedIds)}
      onMouseLeave={() => clearHoverHighlight()}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 card-stack--tight">
          <ToggleField
            checked={checked}
            onChange={() => onToggle()}
            label={sound.soundName}
            badge={sound.category || undefined}
            onBlueBackground
            className="!mb-0"
          />

          {/* Description */}
          {sound.description && (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--color-on-blue-muted)' }}>
              {sound.description}
            </p>
          )}

          {/* Timestamps */}
          {sound.timestamps && sound.timestamps.length > 0 && (
            <div className="flex flex-wrap gap-1 card-title-info">
              {sound.timestamps.map((t, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1 rounded font-mono"
                  style={{
                    backgroundColor: 'var(--color-warning-light)',
                    color: 'var(--color-warning)',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        {sound.spl && (
          <span
            className="text-[10px] px-1.5 py-0 rounded-full font-medium flex-shrink-0"
            style={{
              backgroundColor: 'var(--color-warning)',
              color: 'var(--color-on-blue)',
            }}
          >
            {sound.spl}
          </span>
        )}
      </div>
    </div>
  );
}

export function ScenarioResultContent({ foleyResult, selectedKeys, onToggle }: ScenarioResultContentProps) {
  const selectedSet = new Set(selectedKeys);

  if (!foleyResult.scenarios || foleyResult.scenarios.length === 0) {
    return (
      <p className="text-xs text-center py-4" style={{ color: 'var(--color-on-blue-muted)' }}>
        No foley sounds generated.
      </p>
    );
  }

  return (
    <div className="card-stack">
      {foleyResult.scenarios.map((scenario: FoleyScenario, si: number) => (
        <div key={si}>
          {/* Scenario title */}
          {foleyResult.scenarios.length > 1 && (
            <p
              className="text-xs font-semibold card-label pb-1"
              style={{
                color: 'var(--color-on-blue)',
                borderBottom: '1px solid var(--color-on-blue-faint)',
              }}
            >
              {scenario.scenario_title}
            </p>
          )}

          <div className="card-stack--tight">
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

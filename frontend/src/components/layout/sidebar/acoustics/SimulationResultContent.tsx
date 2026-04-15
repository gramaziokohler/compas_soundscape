/**
 * SimulationResultContent Component
 *
 * Renders the results of a simulation (metrics and IR upload) for Choras and Pyroomacoustics cards.
 * Displayed in the `afterContent` slot of the card after completion.
 *
 * Also exports SimulationSettingsSection — a collapsible, read-only text summary of the
 * simulation settings used (Simulation Mode, Rays, Air Absorption, …).
 */

'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { SimulationConfig, ChorasSimulationConfig, PyroomAcousticsSimulationConfig } from '@/types/acoustics';

interface SimulationResultContentProps {
  config: SimulationConfig;
  onClearIR: () => void;
  irRefreshTrigger?: number;
  onIRHover?: (sourceId: string | null, receiverId: string | null) => void;
}

export function SimulationResultContent({
  config,
  onClearIR,
  irRefreshTrigger = 0,
  onIRHover
}: SimulationResultContentProps) {

  const simulationConfig = config as any;
  const results = simulationConfig.simulationResults;

  const [lowEnergyIRIds, setLowEnergyIRIds] = useState<Set<string>>(new Set());

  const handleLowEnergyIdsChange = useCallback((ids: Set<string>) => {
    setLowEnergyIRIds(ids);
  }, []);

  return (
    <div className="space-y-3">
       {/* Metrics Display */}
       {results && (
         <div className="bg-slate-800 text-white p-3 rounded text-xs overflow-x-auto">
            <pre className="whitespace-pre-wrap font-sans text-xs">{results}</pre>
         </div>
       )}

       {/* Low-energy IR warning */}
       {lowEnergyIRIds.size > 0 && (
         <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-900/30 border border-red-500/60 text-red-400 text-xs">
           <span className="font-bold shrink-0">!</span>
           <span>
             {lowEnergyIRIds.size === 1
               ? '1 impulse response has very low energy and may produce poor auralization.'
               : `${lowEnergyIRIds.size} impulse responses have very low energy and may produce poor auralization.`}
           </span>
         </div>
       )}

       {/* IR Library Integration */}
       <ImpulseResponseUpload
          onClearIR={onClearIR}
          simulationResults={results}
          refreshTrigger={irRefreshTrigger}
          simulationIRIds={simulationConfig.importedIRIds}
          sourceReceiverIRMapping={simulationConfig.sourceReceiverIRMapping}
          onIRHover={onIRHover}
          onLowEnergyIdsChange={handleLowEnergyIdsChange}
       />
    </div>
  );
}

// =============================================================================
// SimulationSettingsSection
// =============================================================================

interface SettingRowProps {
  label: string;
  value: string;
}

function SettingRow({ label, value }: SettingRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className="text-neutral-300 text-right">{value}</span>
    </div>
  );
}

interface SimulationSettingsSectionProps {
  config: SimulationConfig;
}

/**
 * Collapsible read-only summary of the simulation settings used.
 * Collapsed by default — no dropdowns or sliders, just labelled values.
 */
export function SimulationSettingsSection({ config }: SimulationSettingsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const rows: { label: string; value: string }[] = [];

  if (config.type === 'pyroomacoustics') {
    const s = (config as PyroomAcousticsSimulationConfig).settings;
    rows.push({ label: 'Simulation Mode', value: s.simulation_mode === 'foa' ? 'FOA' : 'Mono' });
    rows.push({ label: 'Rays', value: s.n_rays.toLocaleString() });
    rows.push({ label: 'Ray Tracing', value: s.ray_tracing ? 'Yes' : 'No' });
    rows.push({ label: 'Air Absorption', value: s.air_absorption ? 'Yes' : 'No' });
    rows.push({ label: 'Max Order (ISM)', value: String(s.max_order) });
    if (s.enable_grid) rows.push({ label: 'Grid Receivers', value: 'Yes' });
  } else if (config.type === 'choras') {
    const s = (config as ChorasSimulationConfig).settings;
    rows.push({ label: 'Speed of Sound', value: `${s.de_c0} m/s` });
    rows.push({ label: 'IR Length', value: `${s.de_ir_length} s` });
    rows.push({ label: 'Length Type', value: s.sim_len_type === 'edt' ? 'EDT' : 'IR Length' });
    rows.push({ label: 'Char. Length', value: `${s.de_lc} m` });
    rows.push({ label: 'EDT Threshold', value: `${s.edt} dB` });
  }

  if (rows.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="flex items-center gap-1.5 w-full text-left text-xs text-secondary-light hover:text-neutral-300 transition-colors"
      >
        {isExpanded
          ? <ChevronDown size={11} className="shrink-0" />
          : <ChevronRight size={11} className="shrink-0" />
        }
        <span>Simulation Settings</span>
      </button>
      {isExpanded && (
        <div className="mt-2 space-y-1 text-xs">
          {rows.map(({ label, value }) => (
            <SettingRow key={label} label={label} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

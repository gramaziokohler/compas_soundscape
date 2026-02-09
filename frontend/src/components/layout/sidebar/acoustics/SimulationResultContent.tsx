/**
 * SimulationResultContent Component
 * 
 * Renders the results of a simulation (metrics and IR upload) for Choras and Pyroomacoustics cards.
 * Displayed in the `afterContent` slot of the card after completion.
 */

'use client';

import { ImpulseResponseUpload } from '@/components/audio/ImpulseResponseUpload';
import type { SimulationConfig } from '@/types/acoustics';

interface SimulationResultContentProps {
  config: SimulationConfig;
  onClearIR: () => void;
  irRefreshTrigger?: number;
}

export function SimulationResultContent({
  config,
  onClearIR,
  irRefreshTrigger = 0
}: SimulationResultContentProps) {
  
  const simulationConfig = config as any;
  const results = simulationConfig.simulationResults;

  return (
    <div className="space-y-3">
       {/* Metrics Display */}
       {results && (
         <div className="bg-slate-800 text-white p-3 rounded text-xs overflow-x-auto">
            <pre className="whitespace-pre-wrap font-sans text-xs">{results}</pre>
         </div>
       )}
       
       {/* IR Library Integration */}
       <ImpulseResponseUpload
          onClearIR={onClearIR}
          simulationResults={results}
          refreshTrigger={irRefreshTrigger}
          simulationIRIds={simulationConfig.importedIRIds}
       />
    </div>
  );
}

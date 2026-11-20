'use client';

import type { ProgressLane } from '@/types';
import { formatElapsed } from '@/utils/progressLanes';

export interface ProgressLanesProps {
  /** One row per parallel part of the run */
  lanes: ProgressLane[];
}

/**
 * ProgressLanes — the detail under a GenerateButton's progress bar: one row per
 * parallel part of a run (label, current step with counts, elapsed time, thin bar).
 */
export function ProgressLanes({ lanes }: ProgressLanesProps) {
  return (
    <div className="progress-lanes">
      {lanes.map((lane, i) => (
        <div key={`${lane.label}-${i}`} className={`progress-lane progress-lane-${lane.state}`}>
          <div className="progress-lane-row">
            <span className="progress-lane-label" title={lane.label}>{lane.label}</span>
            <span className="progress-lane-text" title={lane.text}>
              {lane.text}
              {lane.elapsedS != null && <span className="progress-lane-time">{formatElapsed(lane.elapsedS)}</span>}
            </span>
          </div>
          <div className="progress-track progress-lane-track">
            <div className="progress-fill" style={{ width: `${Math.round(lane.fraction * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

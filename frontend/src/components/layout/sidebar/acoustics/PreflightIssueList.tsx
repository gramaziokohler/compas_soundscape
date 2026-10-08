/**
 * PreflightIssueList
 *
 * Issues of a geometry preflight, errors first. Hovering a row highlights the
 * issue in the 3D preview; clicking it frames the camera on it and expands
 * its explanation and the affected objects.
 */

'use client';

import { useMemo, useState } from 'react';
import { useSimulationPreflightStore } from '@/store';
import { SIMULATION_PREFLIGHT } from '@/utils/constants';
import type { PreflightIssue, PreflightSeverity } from '@/types/simulationPreflight';

const SEVERITY_ORDER: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 };

const SEVERITY_DOT: Record<PreflightSeverity, string> = {
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
};

interface PreflightIssueListProps {
  issues: PreflightIssue[];
  /** Show info-level issues (auto-fixes, statistics). */
  showInfo: boolean;
}

function hasLocation(issue: PreflightIssue): boolean {
  return !!issue.position || !!issue.segment || issue.face_ids.length > 0 || issue.loop_ids.length > 0;
}

export function PreflightIssueList({ issues, showInfo }: PreflightIssueListProps) {
  const focusedIssueId = useSimulationPreflightStore((s) => s.focusedIssueId);
  const focusIssue = useSimulationPreflightStore((s) => s.focusIssue);
  const hoverIssue = useSimulationPreflightStore((s) => s.hoverIssue);
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      issues
        .filter((i) => showInfo || i.severity !== 'info')
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [issues, showInfo],
  );

  if (sorted.length === 0) {
    return <p className="text-xxs text-secondary-hover">No problems found.</p>;
  }

  return (
    <ul className="card-stack--tight max-h-[min(40vh,320px)] overflow-y-auto" onMouseLeave={() => hoverIssue(null)}>
      {sorted.map((issue) => {
        const isOpen = expanded === issue.id;
        const isFocused = focusedIssueId === issue.id;
        const objects = issue.object_ids.slice(0, SIMULATION_PREFLIGHT.MAX_LISTED_OBJECTS);
        const more = issue.object_ids.length - objects.length;
        return (
          <li key={issue.id} onMouseEnter={() => hoverIssue(issue.id)}>
            <button
              type="button"
              className={`flex w-full cursor-pointer items-start gap-1.5 rounded px-1 text-left text-xs leading-4 transition-colors hover:bg-secondary-light ${isFocused ? 'bg-secondary-light' : ''}`}
              onClick={() => {
                setExpanded(isOpen ? null : issue.id);
                if (hasLocation(issue)) focusIssue(issue.id);
              }}
              title={hasLocation(issue) ? 'Show in 3D' : undefined}
            >
              <span className={`mt-1 h-2 w-2 flex-none rounded-full ${SEVERITY_DOT[issue.severity]}`} />
              <span className="min-w-0 flex-1">{issue.title}</span>
            </button>
            {isOpen && (
              <div className="card-collapse-body pl-4 text-xxs leading-4 text-secondary-hover">
                <p>{issue.detail}</p>
                {objects.length > 0 && (
                  <p className="card-title-meta break-all">
                    Objects: {objects.join(', ')}
                    {more > 0 && ` (+${more} more)`}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

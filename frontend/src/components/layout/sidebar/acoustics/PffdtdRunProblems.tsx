/**
 * PffdtdRunProblems — grid problems a wave-based run reported after voxelising.
 *
 * Arrives while the run is polling (job `partial.problems`, e.g. the model
 * leaks) and stays with the result. Same rows as the voxel preview's problem
 * list; these problems are unlocated, so a click only expands the explanation.
 */

'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { SEVERITY_DOT, SEVERITY_ORDER } from './PffdtdVoxelPreviewPanel';
import type { PffdtdVoxelProblem } from '@/types/pffdtd';

interface PffdtdRunProblemsProps {
  problems: PffdtdVoxelProblem[];
}

export function PffdtdRunProblems({ problems }: PffdtdRunProblemsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(
    () => problems.filter((p) => p.severity !== 'info').sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [problems],
  );
  if (sorted.length === 0) return null;
  const nErrors = sorted.filter((p) => p.severity === 'error').length;
  const nWarnings = sorted.length - nErrors;

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-1.5">
        <span className="text-xxs text-secondary-hover">Simulation grid</span>
        {nErrors > 0 && <Badge variant="error">{nErrors} error{nErrors > 1 ? 's' : ''}</Badge>}
        {nWarnings > 0 && <Badge variant="warning">{nWarnings} warning{nWarnings > 1 ? 's' : ''}</Badge>}
      </div>
      <ul className="card-stack--tight">
        {sorted.map((problem) => {
          const isOpen = expanded === problem.id;
          return (
            <li key={problem.id}>
              <button
                type="button"
                className={`flex w-full cursor-pointer items-start gap-1.5 rounded px-1 text-left text-xs leading-4 transition-colors hover:bg-secondary-light ${isOpen ? 'bg-secondary-light' : ''}`}
                onClick={() => setExpanded(isOpen ? null : problem.id)}
              >
                <span className={`mt-1 h-2 w-2 flex-none rounded-full ${SEVERITY_DOT[problem.severity]}`} />
                <span className="min-w-0 flex-1">
                  {problem.title}
                  {isOpen && <span className="card-collapse-body block text-xxs text-secondary-hover">{problem.detail}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

'use client';

import { useMemo } from 'react';
import type { AnalyzeModelConfig } from '@/types/analysis';
import { getAnalysisGroupColor } from '@/utils/utils';

/**
 * AnalyzeModelResultContent
 *
 * Displays identified architectural object groups after model analysis completes.
 * Color application is handled by AnalysisGroupColorSync in AnalysisSection.
 */

interface Props {
  config: AnalyzeModelConfig;
}

export function AnalyzeModelResultContent({ config }: Props) {
  const result = config.analysisResult;
  const objects = result?.architecturalObjects ?? [];
  const spaceDescription = result?.spaceDescription;

  const stats = useMemo(() => {
    const total = objects.length;
    return { total };
  }, [objects]);

  if (!result || objects.length === 0) return null;

  return (
    <div className="space-y-2 px-4 pb-2">
      {/* Space description */}
      {spaceDescription && (
        <div
          className="rounded px-2 py-2 max-h-28 overflow-y-auto"
          style={{
            borderLeft: '2px solid var(--color-primary)',
            backgroundColor: 'var(--color-secondary-hover)',
            scrollbarWidth: 'thin',
            scrollbarColor: 'var(--color-secondary-light) transparent',
          }}
        >
          <p
            className="text-xs leading-relaxed"
            style={{ color: 'var(--color-background)', opacity: 0.85 }}
          >
            {spaceDescription}
          </p>
        </div>
      )}

      {/* Summary row */}
      <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-secondary-hover)' }}>
        <span>
          <span style={{ color: 'var(--color-background-static)', fontWeight: 600 }}>{stats.total}</span> groups
        </span>
      </div>

      {/* Object group list */}
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
        {objects.map((obj, i) => {
          const color = getAnalysisGroupColor(i);

          return (
            <div
              key={i}
              className="flex items-start gap-2 rounded px-2 py-1.5"
              title={obj.description || undefined}
              style={{
                borderLeft: `3px solid ${color}`,
                backgroundColor: 'var(--color-secondary-hover)',
                cursor: obj.description ? 'default' : undefined,
              }}
            >
              {/* Color swatch */}
              <div
                className="flex-shrink-0 rounded-sm mt-0.5"
                style={{ width: 10, height: 10, backgroundColor: color }}
              />
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-xs font-medium truncate"
                    style={{ color: 'var(--color-background)' }}
                  >
                    {obj.name}
                  </span>
                  {obj.quantity > 1 && (
                    <span
                      className="text-xs px-1 rounded"
                      style={{
                        backgroundColor: 'var(--color-secondary-hover)',
                        color: 'var(--color-secondary-light)',
                      }}
                    >
                      ×{obj.quantity}
                    </span>
                  )}
                </div>
                {obj.material && (
                  <span
                    className="inline-block text-xs px-1 rounded"
                    style={{
                      backgroundColor: 'var(--color-secondary-hover)',
                      color: 'var(--color-secondary-light)',
                    }}
                  >
                    {obj.material}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

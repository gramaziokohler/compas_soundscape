'use client';

import { useState, useCallback, useEffect } from 'react';
import type { AnalyzeModelConfig } from '@/types/analysis';
import { getAnalysisGroupColor } from '@/utils/utils';
import { useSpeckleStore, useAnalysisStore } from '@/store';

/**
 * AnalyzeModelResultContent
 *
 * Displays identified architectural object groups after model analysis completes.
 * Results are shown as single lines with a colored left-border badge.
 * Hover or expand highlights only that group's meshes in the 3D viewer (group color).
 * The pen icon switches to an inline edit form. Only one group expanded at a time.
 */

interface Props {
  config: AnalyzeModelConfig;
  configIndex: number;
}

export function AnalyzeModelResultContent({ config, configIndex }: Props) {
  const result = config.analysisResult;
  const objects = result?.architecturalObjects ?? [];
  const spaceDescription = result?.spaceDescription;

  const zoomToObjectById = useSpeckleStore((s) => s.zoomToObjectById);
  const handleUpdateAnalysisObject = useAnalysisStore((s) => s.handleUpdateAnalysisObject);

  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [editingValues, setEditingValues] = useState<Record<number, { name: string; description: string; material: string }>>({});

  const handleClick = useCallback(
    (groupIdx: number, ids: string[]) => {
      if (ids.length > 0) zoomToObjectById(ids);
      setEditingIndex(null);
      setExpandedIndex((prev) => (prev === groupIdx ? null : groupIdx));
    },
    [zoomToObjectById],
  );

  const handleStartEditing = useCallback(
    (groupIdx: number) => {
      const group = objects[groupIdx];
      setEditingValues((ev) => ({
        ...ev,
        [groupIdx]: {
          name: group.name,
          description: group.description ?? '',
          material: group.material ?? '',
        },
      }));
      setEditingIndex(groupIdx);
    },
    [objects],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
  }, []);

  const handleSave = useCallback(
    async (groupIdx: number) => {
      const values = editingValues[groupIdx];
      if (!values) return;
      await handleUpdateAnalysisObject(configIndex, groupIdx, values);
      setExpandedIndex(null);
      setEditingIndex(null);
    },
    [configIndex, editingValues, handleUpdateAnalysisObject],
  );

  const buildAllGroupColors = useCallback(
    () =>
      objects
        .map((obj, i) => ({
          objectIds: Object.keys(obj.object_ids ?? {}),
          color: getAnalysisGroupColor(i),
        }))
        .filter((g) => g.objectIds.length > 0),
    [objects],
  );

  const applyGroupViewerFocus = useCallback(
    (focusIdx: number | null) => {
      if (focusIdx !== null) {
        const group = objects[focusIdx];
        const ids = Object.keys(group?.object_ids ?? {});
        if (ids.length === 0) return;
        useSpeckleStore.getState().setAnalysisObjectGroups(
          [{ objectIds: ids, color: getAnalysisGroupColor(focusIdx) }],
          objects,
        );
        return;
      }
      const colorGroups = buildAllGroupColors();
      if (colorGroups.length > 0) {
        useSpeckleStore.getState().setAnalysisObjectGroups(colorGroups, objects);
      }
    },
    [buildAllGroupColors, objects],
  );

  const focusIndex = hoveredIndex ?? expandedIndex;

  useEffect(() => {
    applyGroupViewerFocus(focusIndex);
  }, [applyGroupViewerFocus, focusIndex]);

  if (!result || objects.length === 0) return null;

  return (
    <div className="card-stack">
      {spaceDescription && (
        <>
        <p
          className="text-xs leading-relaxed max-h-[min(128px,30dvh)] overflow-y-auto"
        > 
        <span className="font-bold text-on-blue"> Space description: </span>
        <span style={{ color: 'var(--color-on-blue-muted)' }}>
          {spaceDescription}
        </span>
        </p>
        </>
      )}

      {/* Summary row */}
      <div className="text-xs" style={{ color: 'var(--color-on-blue-muted)' }}>
        <span style={{ color: 'var(--color-on-blue)', fontWeight: 600 }}>{objects.length}</span> groups
      </div>

      {/* Object group list */}
      <div className="card-stack--tight max-h-[min(280px,50dvh)] overflow-y-auto pr-0.5">
        {objects.map((obj, i) => {
          const color = getAnalysisGroupColor(i);
          const ids = Object.keys(obj.object_ids ?? {});
          const isExpanded = expandedIndex === i;
          const isEditing = editingIndex === i;

          return (
            <div key={i}>
              {/* Collapsed row */}
              {!isExpanded && (
                <div
                  className="flex items-center gap-2 py-1 pl-1 pr-1 cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ borderLeft: `3px solid ${color}` }}
                  onMouseEnter={() => ids.length > 0 && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => handleClick(i, ids)}
                  title={ids.length > 0 ? `Click to zoom to ${ids.length} ${ids.length === 1 ? 'object' : 'objects'}` : (obj.description || undefined)}
                >
                  <span
                    className="text-xs font-medium truncate flex-1 min-w-0"
                    style={{ color: 'var(--color-on-blue)' }}
                  >
                    {obj.name}
                  </span>
                  {obj.quantity > 1 && (
                    <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-on-blue-muted)' }}>
                      x{obj.quantity}
                    </span>
                  )}
                </div>
              )}

              {/* Expanded: info mode */}
              {isExpanded && !isEditing && (
                <div
                  className="mt-1 mb-1 ml-1 card-stack--md px-2 py-2 rounded"
                  style={{ borderLeft: `2px solid ${color}`, backgroundColor: 'var(--color-blue-chip-bg)' }}
                  onMouseEnter={() => ids.length > 0 && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="text-left text-xs font-medium flex-1 min-w-0"
                      style={{ color: 'var(--color-on-blue)' }}
                      onClick={() => {
                        setExpandedIndex(null);
                        setEditingIndex(null);
                      }}
                      title="Click to collapse"
                    >
                      {obj.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEditing(i);
                      }}
                      className="on-blue-btn flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full transition-all cursor-pointer"
                      title="Edit group info"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
                      </svg>
                    </button>
                  </div>
                  {obj.description && (
                    <p
                      className="text-xs leading-relaxed max-h-[min(96px,20dvh)] overflow-y-auto"
                      style={{ color: 'var(--color-on-blue-muted)' }}
                    >
                      {obj.description}
                    </p>
                  )}
                  {obj.material && (
                    <span
                      className="inline-block text-xs px-1 rounded"
                      style={{
                        backgroundColor: 'var(--color-on-blue-faint)',
                        color: 'var(--color-on-blue)',
                      }}
                    >
                      {obj.material}
                    </span>
                  )}
                </div>
              )}

              {/* Expanded: editing mode */}
              {isExpanded && isEditing && (
                <div
                  className="mt-1 mb-1 ml-1 card-stack--md px-2 py-2 rounded"
                  style={{ borderLeft: `2px solid ${color}`, backgroundColor: 'var(--color-blue-chip-bg)' }}
                  onMouseEnter={() => ids.length > 0 && setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <button
                    type="button"
                    className="text-left text-xs font-medium"
                    style={{ color: 'var(--color-on-blue)' }}
                    onClick={() => {
                      setExpandedIndex(null);
                      setEditingIndex(null);
                    }}
                    title="Click to collapse"
                  >
                    Edit Group
                  </button>
                  <input
                    className="w-full text-xs rounded px-2 py-1 placeholder:text-on-blue-muted"
                    style={{
                      backgroundColor: 'var(--color-blue-chip-bg)',
                      border: '1px solid var(--color-on-blue-faint)',
                      color: 'var(--color-on-blue)',
                    }}
                    placeholder="Name"
                    value={editingValues[i]?.name ?? obj.name}
                    onChange={(e) =>
                      setEditingValues((ev) => ({
                        ...ev,
                        [i]: { ...ev[i], name: e.target.value },
                      }))
                    }
                  />
                  <input
                    className="w-full text-xs rounded px-2 py-1 placeholder:text-on-blue-muted"
                    style={{
                      backgroundColor: 'var(--color-blue-chip-bg)',
                      border: '1px solid var(--color-on-blue-faint)',
                      color: 'var(--color-on-blue)',
                    }}
                    placeholder="Description"
                    value={editingValues[i]?.description ?? ''}
                    onChange={(e) =>
                      setEditingValues((ev) => ({
                        ...ev,
                        [i]: { ...ev[i], description: e.target.value },
                      }))
                    }
                  />
                  <input
                    className="w-full text-xs rounded px-2 py-1 placeholder:text-on-blue-muted"
                    style={{
                      backgroundColor: 'var(--color-blue-chip-bg)',
                      border: '1px solid var(--color-on-blue-faint)',
                      color: 'var(--color-on-blue)',
                    }}
                    placeholder="Material"
                    value={editingValues[i]?.material ?? ''}
                    onChange={(e) =>
                      setEditingValues((ev) => ({
                        ...ev,
                        [i]: { ...ev[i], material: e.target.value },
                      }))
                    }
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSave(i);
                      }}
                      className="flex-1 text-xs py-1 rounded"
                      style={{
                        backgroundColor: 'var(--color-on-blue)',
                        color: 'var(--color-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelEdit();
                      }}
                      className="flex-1 text-xs py-1 rounded"
                      style={{
                        backgroundColor: 'var(--color-error)',
                        color: 'var(--color-on-blue)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

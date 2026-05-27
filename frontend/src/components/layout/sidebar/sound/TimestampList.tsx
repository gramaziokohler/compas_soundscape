'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * TimestampList Component
 *
 * Editable list of MM:SS time inputs used in timestamp scheduling mode.
 * Replaces the interval slider when a sound is in 'timestamps' mode.
 *
 * Internally stores and exposes timestamps in seconds (number[]).
 * Displays each timestamp as an editable "MM:SS" text input.
 */

export interface TimestampListProps {
  /** Timestamps in seconds */
  timestamps: number[];
  onChange: (timestamps: number[]) => void;
}

/** Format seconds (number) → "MM:SS" string */
function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Parse "MM:SS" string → seconds (number). Returns NaN if invalid. */
function parseMMSS(value: string): number {
  const trimmed = value.trim();
  // Accept "MM:SS" or plain seconds "SSS"
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex === -1) {
    const n = parseFloat(trimmed);
    return isNaN(n) ? NaN : n;
  }
  const mm = parseInt(trimmed.slice(0, colonIndex), 10);
  const ss = parseInt(trimmed.slice(colonIndex + 1), 10);
  if (isNaN(mm) || isNaN(ss) || ss < 0 || ss > 59) return NaN;
  return mm * 60 + ss;
}

export function TimestampList({ timestamps, onChange }: TimestampListProps) {
  // Local editing state so the user can type freely before committing
  const [editValues, setEditValues] = useState<string[]>(() =>
    timestamps.map(formatSeconds)
  );

  // Sync edit values only when external timestamps actually change (e.g. undo/redo).
  // Using a ref to track the last known canonical value prevents resetting while the
  // user is mid-type (which caused inputs to be non-editable).
  const prevCanonicalRef = useRef<string>(JSON.stringify(timestamps));
  useEffect(() => {
    const canonical = JSON.stringify(timestamps);
    if (canonical !== prevCanonicalRef.current) {
      prevCanonicalRef.current = canonical;
      setEditValues(timestamps.map(formatSeconds));
    }
  }, [timestamps]);

  const handleEdit = useCallback(
    (idx: number, value: string) => {
      const next = [...editValues];
      next[idx] = value;
      setEditValues(next);
    },
    [editValues],
  );

  const handleCommit = useCallback(
    (idx: number) => {
      const parsed = parseMMSS(editValues[idx]);
      if (isNaN(parsed)) {
        // Revert to previous valid value
        const next = [...editValues];
        next[idx] = formatSeconds(timestamps[idx] ?? 0);
        setEditValues(next);
        return;
      }
      const next = [...timestamps];
      next[idx] = parsed;
      onChange(next);
    },
    [editValues, timestamps, onChange],
  );

  const handleAdd = useCallback(() => {
    const newTs = [...timestamps, 0];
    const newEdit = [...editValues, '00:00'];
    setEditValues(newEdit);
    onChange(newTs);
  }, [timestamps, editValues, onChange]);

  const handleRemove = useCallback(
    (idx: number) => {
      const newTs = timestamps.filter((_, i) => i !== idx);
      const newEdit = editValues.filter((_, i) => i !== idx);
      setEditValues(newEdit);
      onChange(newTs);
    },
    [timestamps, editValues, onChange],
  );

  return (
    <div className="flex flex-col items-center" style={{ minWidth: '52px' }}>
      <span className="text-[10px] mb-1 text-secondary-hover">Times</span>

      {/* Scrollable list */}
      <div
        className="flex flex-col gap-0.5 overflow-y-auto"
        style={{ maxHeight: '110px', scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}
      >
        {editValues.length === 0 && (
          <span className="text-[9px] text-secondary-hover italic px-1">none</span>
        )}

        {editValues.map((val, idx) => (
          <div key={idx} className="flex items-center gap-0.5">
            <input
              type="text"
              value={val}
              onChange={(e) => handleEdit(idx, e.target.value)}
              onBlur={() => handleCommit(idx)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCommit(idx); }}
              className="text-[9px] text-center rounded px-1 py-0.5 outline-none bg-foreground text-background"
              style={{
                width: '36px',
                borderColor: 'var(--card-color, var(--color-primary))55',
              }}
              title={`Timestamp ${idx + 1}: MM:SS`}
            />
            <button
              onClick={() => handleRemove(idx)}
              className="flex-shrink-0 transition-opacity hover:opacity-70 text-secondary-hover"
              title="Remove timestamp"
              style={{ lineHeight: 1, fontSize: '10px', padding: '1px' }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add button */}
      <button
        onClick={handleAdd}
        className="mt-1 flex items-center justify-center rounded transition-opacity hover:opacity-70"
        style={{
          width: '16px',
          height: '16px',
          fontSize: '12px',
          color: 'var(--card-color, var(--color-primary))',
          lineHeight: 1,
        }}
        title="Add timestamp"
      >
        +
      </button>

      <span className="text-[10px] mt-1 text-secondary-hover">Int.</span>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSoundFxStore } from '@/store';
import type { FxChain, FxParams } from '@/lib/audio/fx/fx-types';
import { EmptyState } from '@/components/ui/EmptyState';
import { FxRow } from './FxRow';
import { FxAddMenu } from './FxAddMenu';

interface FxStackProps {
  soundId: string;
  chain: FxChain;
  analyser: AnalyserNode | null;
  sampleRate: number;
  onBypass: (instanceId: string, enabled: boolean) => void;
  onParamsLive: (instanceId: string, params: FxParams) => void;
  onStructuralChange: () => void;
}

/** Row header region (px from the top) that initiates a drag. */
const DRAG_HEADER_PX = 28;

interface DragState {
  index: number;
  startY: number;
  hasMoved: boolean;
  insertionIndex: number;
}

export function FxStack({
  soundId, chain, analyser, sampleRate, onBypass, onParamsLive, onStructuralChange,
}: FxStackProps) {
  const expandedId = useSoundFxStore((s) => s.expandedId);
  const addInstance = useSoundFxStore((s) => s.addInstance);
  const removeInstance = useSoundFxStore((s) => s.removeInstance);
  const reorderInstance = useSoundFxStore((s) => s.reorderInstance);
  const toggleInstance = useSoundFxStore((s) => s.toggleInstance);
  const patchInstanceParams = useSoundFxStore((s) => s.patchInstanceParams);
  const setExpandedId = useSoundFxStore((s) => s.setExpandedId);

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragRef = useRef<DragState | null>(null);
  const countRef = useRef(chain.instances.length);
  countRef.current = chain.instances.length;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const suppressClickRef = useRef(false);

  const onStructuralChangeRef = useRef(onStructuralChange);
  onStructuralChangeRef.current = onStructuralChange;

  /** Nearest gap index (0..n) to cursorY. */
  const calcInsertionIndex = useCallback((cursorY: number): number => {
    const n = countRef.current;
    if (n === 0) return 0;
    const gaps: number[] = [];
    for (let i = 0; i < n; i++) {
      const el = rowRefs.current.get(i);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (i === 0) gaps[0] = r.top;
      const nextEl = rowRefs.current.get(i + 1);
      gaps[i + 1] = nextEl ? (r.bottom + nextEl.getBoundingClientRect().top) / 2 : r.bottom;
    }
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i <= n; i++) {
      if (gaps[i] === undefined) continue;
      const d = Math.abs(cursorY - gaps[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.hasMoved && Math.abs(e.clientY - drag.startY) > 4) drag.hasMoved = true;
      if (!drag.hasMoved) return;
      drag.insertionIndex = calcInsertionIndex(e.clientY);
      setInsertionIndex(drag.insertionIndex);
    };

    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragIndex(null);
      setInsertionIndex(null);
      // Swallow the click that follows a moved drag so the row doesn't also
      // toggle its expand state.
      suppressClickRef.current = drag?.hasMoved ?? false;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
      if (!drag?.hasMoved) return;

      const ins = drag.insertionIndex;
      if (ins === drag.index || ins === drag.index + 1) return;
      const targetIndex = ins > drag.index ? ins - 1 : ins;
      reorderInstance(soundId, drag.index, targetIndex);
      onStructuralChangeRef.current();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [calcInsertionIndex, reorderInstance, soundId]);

  const handleDragStart = (index: number, e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[role="switch"], input, select, textarea, a, [data-no-drag]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientY - rect.top > DRAG_HEADER_PX) return;
    e.preventDefault();
    suppressClickRef.current = false;
    dragRef.current = { index, startY: e.clientY, hasMoved: false, insertionIndex: index + 1 };
    setDragIndex(index);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const n = chain.instances.length;
  const isNoOpInsertion =
    insertionIndex === null || dragIndex === null
      ? false
      : insertionIndex === dragIndex || insertionIndex === dragIndex + 1;
  const showLine = dragIndex !== null && !isNoOpInsertion;

  return (
    <div className="card-stack">
      <div ref={listRef} className="card-stack--tight">
        {n === 0 && (
          <EmptyState message="No effects yet. Add one to start shaping this sample." />
        )}
        {showLine && insertionIndex === 0 && <InsertionLine />}
        {chain.instances.map((inst, index) => (
          <div key={inst.instanceId}>
            <div
              ref={(el) => {
                if (el) rowRefs.current.set(index, el);
                else rowRefs.current.delete(index);
              }}
              style={{
                opacity: dragIndex === index ? 0.3 : 1,
                transition: dragIndex === null ? 'opacity 0.15s' : 'none',
              }}
              onMouseDown={(e) => handleDragStart(index, e)}
            >
              <FxRow
                soundId={soundId}
                instance={inst}
                isFirst={index === 0}
                isLast={index === n - 1}
                expanded={expandedId === inst.instanceId}
                analyser={analyser}
                sampleRate={sampleRate}
                onToggleExpand={() => setExpandedId(expandedId === inst.instanceId ? null : inst.instanceId)}
                onToggleEnabled={(enabled) => {
                  toggleInstance(soundId, inst.instanceId, enabled);
                  onBypass(inst.instanceId, enabled);
                }}
                onRemove={() => {
                  removeInstance(soundId, inst.instanceId);
                  onStructuralChange();
                }}
                onLiveParams={(params) => {
                  patchInstanceParams(soundId, inst.instanceId, params);
                  onParamsLive(inst.instanceId, params);
                }}
                onCommitParams={(params) => {
                  patchInstanceParams(soundId, inst.instanceId, params);
                  onParamsLive(inst.instanceId, params);
                }}
              />
            </div>
            {showLine && insertionIndex === index + 1 && <InsertionLine />}
          </div>
        ))}
      </div>
      <FxAddMenu
        onAdd={(type) => {
          addInstance(soundId, type);
          onStructuralChange();
        }}
      />
    </div>
  );
}

function InsertionLine() {
  return (
    <div
      className="relative mx-1"
      style={{
        height: 2,
        borderRadius: 1,
        backgroundColor: 'var(--color-primary)',
        boxShadow: '0 0 7px var(--color-primary)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -4,
          top: -3,
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: 'var(--color-primary)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -4,
          top: -3,
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: 'var(--color-primary)',
        }}
      />
    </div>
  );
}

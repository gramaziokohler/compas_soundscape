'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReceiverData, GridListenerData } from '@/types/receiver';
import type { CardType } from '@/types/card';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { SingleListenerContent } from './listeners/SingleListenerContent';
import { GridListenerContent } from './listeners/GridListenerContent';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { RECEIVER_CONFIG } from '@/utils/constants';

// Unified item type satisfying CardBaseConfig
type SingleListenerConfig = ReceiverData & { type: 'listener'; display_name?: string };
type GridListenerConfig = GridListenerData & { type: 'grid-listener'; display_name?: string };
type ListenerItemConfig = SingleListenerConfig | GridListenerConfig;

interface ListenersSectionProps {
  receivers: ReceiverData[];
  gridListeners: GridListenerData[];
  onAddReceiver: (type: string) => void;
  onDeleteReceiver: (id: string) => void;
  onUpdateReceiverName: (id: string, name: string) => void;
  onUpdateReceiverPosition: (id: string, position: [number, number, number]) => void;
  onGoToReceiver: (id: string) => void;
  onToggleReceiverHiddenForSimulation: (id: string) => void;
  onAddGridListener: () => void;
  onDeleteGridListener: (id: string) => void;
  onComputeBounds: (objectIds: string[]) => { min: [number, number, number]; max: [number, number, number] } | null;
  expandedGridListenerId: string | null;
  onExpandedGridListenerChange: (id: string | null) => void;
  onExitFPS?: () => void;
  forcedExpandedId?: string | null;
  collapseAllTrigger?: number;
}

const LISTENER_COLOR = `#${RECEIVER_CONFIG.COLOR.toString(16).padStart(6, '0')}`;

const AVAILABLE_TYPES: CardTypeOption[] = [
  { type: 'listener', label: 'Single listener', enabled: true },
  { type: 'grid-listener', label: 'Grid listener', enabled: true },
];

export function ListenersSection({
  receivers,
  gridListeners,
  onAddReceiver,
  onDeleteReceiver,
  onUpdateReceiverName,
  onUpdateReceiverPosition,
  onGoToReceiver,
  onToggleReceiverHiddenForSimulation,
  onAddGridListener,
  onDeleteGridListener,
  onComputeBounds,
  expandedGridListenerId,
  onExpandedGridListenerChange,
  onExitFPS,
  forcedExpandedId,
  collapseAllTrigger,
}: ListenersSectionProps) {
  const { updateGridListener, toggleGridListenerHiddenForSimulation } = useGridListenersStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prevGridCountRef = useRef(gridListeners.length);

  // Auto-expand newly added grid listener
  useEffect(() => {
    if (gridListeners.length > prevGridCountRef.current) {
      const newest = gridListeners[gridListeners.length - 1];
      if (newest) onExpandedGridListenerChange(newest.id);
    }
    prevGridCountRef.current = gridListeners.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridListeners.length]);

  // Force-expand a specific single listener from outside
  useEffect(() => {
    if (forcedExpandedId != null && forcedExpandedId !== expandedId) {
      setExpandedId(forcedExpandedId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedExpandedId]);

  // Collapse all
  useEffect(() => {
    if (collapseAllTrigger == null) return;
    setExpandedId(null);
    onExpandedGridListenerChange(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseAllTrigger]);

  // Unified items array for CardSection
  const items = useMemo<ListenerItemConfig[]>(() => [
    ...receivers.map(r => ({ ...r, type: 'listener' as const })),
    ...gridListeners.map(g => ({ ...g, type: 'grid-listener' as const })),
  ], [receivers, gridListeners]);

  // Compute controlled expandedIndex from the two ID-based states
  const expandedIndex = useMemo<number | null>(() => {
    if (expandedId) {
      const idx = receivers.findIndex(r => r.id === expandedId);
      return idx >= 0 ? idx : null;
    }
    if (expandedGridListenerId) {
      const idx = gridListeners.findIndex(g => g.id === expandedGridListenerId);
      return idx >= 0 ? receivers.length + idx : null;
    }
    return null;
  }, [expandedId, expandedGridListenerId, receivers, gridListeners]);

  const handleExpandedIndexChange = useCallback((index: number | null) => {
    // Exit FPS if we were viewing a single listener and now we're not
    if (expandedId !== null && (index === null || index >= receivers.length)) {
      onExitFPS?.();
    }

    if (index === null) {
      setExpandedId(null);
      onExpandedGridListenerChange(null);
      return;
    }

    if (index < receivers.length) {
      setExpandedId(receivers[index].id);
      onGoToReceiver(receivers[index].id);
      onExpandedGridListenerChange(null);
    } else {
      setExpandedId(null);
      onExpandedGridListenerChange(gridListeners[index - receivers.length].id);
    }
  }, [expandedId, receivers, gridListeners, onGoToReceiver, onExpandedGridListenerChange, onExitFPS]);

  const handleAddItem = useCallback((type: CardType) => {
    if (type === 'listener') onAddReceiver('single');
    else if (type === 'grid-listener') onAddGridListener();
  }, [onAddReceiver, onAddGridListener]);

  const handleUpdateConfig = useCallback((index: number, updates: Partial<ListenerItemConfig>) => {
    const item = items[index];
    if (!item || !('display_name' in updates) || updates.display_name === undefined) return;
    if (item.type === 'listener') {
      onUpdateReceiverName(item.id, updates.display_name);
    } else {
      updateGridListener(item.id, { name: updates.display_name });
    }
  }, [items, onUpdateReceiverName, updateGridListener]);

  const handleRemove = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.type === 'listener') {
      if (expandedId === item.id) { setExpandedId(null); onExitFPS?.(); }
      onDeleteReceiver(item.id);
    } else {
      onDeleteGridListener(item.id);
    }
  }, [items, expandedId, onDeleteReceiver, onDeleteGridListener, onExitFPS]);

  const handlePositionChange = useCallback((
    id: string, axis: 0 | 1 | 2, raw: string, currentPos: [number, number, number],
  ) => {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) return;
    const next: [number, number, number] = [...currentPos] as [number, number, number];
    next[axis] = parsed;
    onUpdateReceiverPosition(id, next);
  }, [onUpdateReceiverPosition]);

  const header = (
    <div className="flex items-center gap-2 w-full justify-between">
      <div className="text-xs font-medium text-warning">
        Listener cards
      </div>
    </div>
      );

  const renderCard = useCallback((
    item: ListenerItemConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (i: number) => void,
  ) => {
    const isHidden = item.hiddenForSimulation ?? false;

    const hideButton = (
      <button
        key="hide"
        onClick={(e) => {
          e.stopPropagation();
          if (item.type === 'listener') {
            onToggleReceiverHiddenForSimulation(item.id);
          } else {
            toggleGridListenerHiddenForSimulation(item.id);
          }
        }}
        className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
          isHidden
            ? 'bg-warning-light text-warning'
            : 'text-secondary-hover hover:bg-secondary-light hover:text-foreground'
        }`}
        title={isHidden ? 'Show for simulation' : 'Hide for simulation'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isHidden ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          )}
        </svg>
      </button>
    );

    const content = item.type === 'listener' ? (
      <SingleListenerContent
        receiver={item}
        color={LISTENER_COLOR}
        onUpdatePosition={handlePositionChange}
      />
    ) : (
      <GridListenerContent
        grid={item}
        color={LISTENER_COLOR}
        onComputeBounds={onComputeBounds}
      />
    );

    return (
      <div style={{ opacity: isHidden ? 0.55 : 1 }}>
        <Card
          config={item}
          index={index}
          isExpanded={isExpanded}
          hasResult={false}
          defaultName={item.name}
          color="warning"
          showIndex={true}
          canRemove={true}
          closeButtonTitle="Delete listener"
          customButtons={[hideButton]}
          onToggleExpand={onToggleExpand}
          onUpdateConfig={handleUpdateConfig as (index: number, updates: Partial<typeof item>) => void}
          onRemove={handleRemove}
          onReset={() => {}}
          beforeContent={content}
        />
      </div>
    );
  }, [
    onToggleReceiverHiddenForSimulation,
    toggleGridListenerHiddenForSimulation,
    handlePositionChange,
    handleUpdateConfig,
    handleRemove,
    onComputeBounds,
  ]);

  return (
    <CardSection
      items={items}
      availableTypes={AVAILABLE_TYPES}
      emptyMessage="No listeners yet. Click + to add one."
      statusLabel="listener"
      addButtonTitle="Add listener"
      onAddItem={handleAddItem}
      renderCard={renderCard}
      color="warning"
      expandedIndex={expandedIndex}
      header={header}
      onExpandedIndexChange={handleExpandedIndexChange}
    />
  );
}

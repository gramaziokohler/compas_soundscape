'use client';

import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import type { ReceiverData, GridListenerData } from '@/types/receiver';
import type { CardType, CustomMenuItem } from '@/types/card';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { SingleListenerContent } from './listeners/SingleListenerContent';
import { GridListenerContent } from './listeners/GridListenerContent';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useReceiversStore } from '@/store/receiversStore';
import { usePositionClipboardStore, useUIStore } from '@/store';
import { Bubble, BubbleAddButton, BubbleExitButton, BubbleHeading } from '@/components/ui/Bubble';
import { ListenerIcon, ListenerGridIcon } from '@/components/ui/BubbleIcons';
import { ContextMenu } from '@/components/ui/ContextMenu';
import { useDismissOnSceneClick } from '@/hooks/useDismissOnSceneClick';
import { SCENE_BOTTOM_BAR, SIMPLE_MODE } from '@/utils/constants';

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
  listenerOrientation: { x: number; y: number; z: number };
  /**
   * `section` (default) = card list in the right sidebar. `bubbles` = Simple-mode
   * bottom-right stack of listener bubbles + one floating card panel.
   */
  presentation?: 'section' | 'bubbles';
}

const LISTENER_COLOR = 'var(--color-receiver)';

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
  listenerOrientation,
  presentation = 'section',
}: ListenersSectionProps) {
  const { updateGridListener, toggleGridListenerHiddenForSimulation, reorderGridListeners, duplicateGridListenerAt } = useGridListenersStore();
  const reorderReceivers = useReceiversStore((s) => s.reorderReceivers);
  const duplicateReceiverAt = useReceiversStore((s) => s.duplicateReceiverAt);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prevGridCountRef = useRef(gridListeners.length);

  // Copied position for the right-click "Paste position" menu item (shared across
  // sound + listener cards). Null when nothing has been copied yet.
  const copiedPosition = usePositionClipboardStore((s) => s.position);

  // Auto-expand newly added grid listener
  useEffect(() => {
    if (gridListeners.length > prevGridCountRef.current) {
      const newest = gridListeners[gridListeners.length - 1];
      if (newest) onExpandedGridListenerChange(newest.id);
    }
    prevGridCountRef.current = gridListeners.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridListeners.length]);

  // Force-expand a specific single listener from outside (go-to-listener / scene double-click)
  useEffect(() => {
    if (forcedExpandedId != null) {
      setExpandedId(forcedExpandedId);
      onExpandedGridListenerChange(null);
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

  // Expand/collapse controls listener visibility: only the expanded grid's
  // listener dots are shown in the 3D scene (drives showListeners, which the
  // scene/filter logic in page.tsx reads). Collapsed grids are hidden.
  useEffect(() => {
    const { gridListeners: grids } = useGridListenersStore.getState();
    for (const g of grids) {
      const shouldShow = g.id === expandedGridListenerId;
      if (g.showListeners !== shouldShow) {
        updateGridListener(g.id, { showListeners: shouldShow });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedGridListenerId, gridListeners.length]);

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

  // Within-type reorder only (cross-type moves are silently ignored)
  const handleReorder = useCallback((from: number, to: number) => {
    const nReceivers = receivers.length;
    const fromIsReceiver = from < nReceivers;
    const toIsReceiver = to < nReceivers;
    if (fromIsReceiver && toIsReceiver) {
      reorderReceivers(from, to);
    } else if (!fromIsReceiver && !toIsReceiver) {
      reorderGridListeners(from - nReceivers, to - nReceivers);
    }
  }, [receivers.length, reorderReceivers, reorderGridListeners]);

  // Ctrl+drag duplicate — within-type only, cross-type drops are silently ignored
  const handleDuplicate = useCallback((from: number, toInsertion: number) => {
    const nReceivers = receivers.length;
    const nGrid = gridListeners.length;
    const fromIsReceiver = from < nReceivers;

    if (fromIsReceiver) {
      // Only allow insert within receiver range
      if (toInsertion > nReceivers) return;
      duplicateReceiverAt(from, toInsertion);
    } else {
      // Grid listener: only allow insert within grid range
      const fromGrid = from - nReceivers;
      const toGridInsertion = toInsertion - nReceivers;
      if (toGridInsertion < 0 || toGridInsertion > nGrid) return;
      duplicateGridListenerAt(fromGrid, toGridInsertion);
    }
  }, [receivers.length, gridListeners.length, duplicateReceiverAt, duplicateGridListenerAt]);


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
    floating?: FloatingCardOptions,
  ) => {
    const isHidden = item.hiddenForSimulation ?? false;

    const hideButton: CustomMenuItem = {
      key: 'hide',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {isHidden ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          )}
        </svg>
      ),
      label: isHidden ? 'Show for simulation' : 'Hide for simulation',
      isActive: isHidden,
      onClick: (e) => {
        e.stopPropagation();
        if (item.type === 'listener') {
          onToggleReceiverHiddenForSimulation(item.id);
        } else {
          toggleGridListenerHiddenForSimulation(item.id);
        }
      },
    };

    // Position copy / paste — single listeners only (grid listeners have no
    // single position to copy or paste onto).
    const clipboardButtons: CustomMenuItem[] = [];
    if (item.type === 'listener') {
      clipboardButtons.push({
        key: 'copy-position',
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
          </svg>
        ),
        label: 'Copy position',
        disabled: !item.position,
        onClick: (e) => {
          e.stopPropagation();
          if (item.position) usePositionClipboardStore.getState().copyPosition([...item.position]);
        },
      });

      if (copiedPosition) {
        clipboardButtons.push({
          key: 'paste-position',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          ),
          label: 'Paste position',
          onClick: (e) => {
            e.stopPropagation();
            onUpdateReceiverPosition(item.id, copiedPosition);
          },
        });
      }
    }

    const content = item.type === 'listener' ? (
      <SingleListenerContent
        receiver={item}
        color={LISTENER_COLOR}
        onUpdatePosition={onUpdateReceiverPosition}
        listenerOrientation={listenerOrientation}
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
          customButtons={[...clipboardButtons, hideButton, ...(floating?.extraMenu ?? [])]}
          onReduce={floating?.onReduce}
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
    handleUpdateConfig,
    handleRemove,
    onComputeBounds,
    listenerOrientation,
    onUpdateReceiverPosition,
    copiedPosition,
  ]);

  if (presentation === 'bubbles') {
    return (
      <ListenerBubbles
        items={items}
        expandedIndex={expandedIndex}
        onToggle={handleExpandedIndexChange}
        onAddItem={handleAddItem}
        renderCard={renderCard}
      />
    );
  }

  return (
    <div id="listeners-section">
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
        onReorder={handleReorder}
        onDuplicate={handleDuplicate}
      />
    </div>
  );
}

// ============================================================================
// Simple-mode presentation
// ============================================================================

/** Extra Card props used when a card floats beside its bubble (Simple mode). */
interface FloatingCardOptions {
  onReduce: () => void;
  extraMenu?: CustomMenuItem[];
}

interface ListenerBubblesProps {
  items: ListenerItemConfig[];
  expandedIndex: number | null;
  onToggle: (index: number | null) => void;
  onAddItem: (type: CardType) => void;
  renderCard: (
    item: ListenerItemConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (i: number) => void,
    floating?: FloatingCardOptions,
  ) => ReactNode;
}

/** A listener is "ready" once it takes part in simulations (grids also need points). */
function isListenerReady(item: ListenerItemConfig): boolean {
  if (item.hiddenForSimulation) return false;
  return item.type === 'listener' || item.points.length > 0;
}

/**
 * Bottom-right stack of listener bubbles, growing upward from the corner ("+"
 * nearest the corner), just above the scene bottom bar (and the docked DAW).
 * Click an inactive listener → activate it (first-person for a single listener,
 * show a grid's points); click the active one → open / reduce its card, which
 * floats beside the stack (no wrapper). Its ⋮ menu has "Stop listening"; while
 * a single listener is active with its card reduced, a warning exit button to
 * its left leaves the first-person view.
 */
function ListenerBubbles({ items, expandedIndex, onToggle, onAddItem, renderCard }: ListenerBubblesProps) {
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const dockLift = useUIStore((s) => s.dawDockBottomSpace);

  // The card belongs to the active listener — close it when that changes.
  useEffect(() => {
    setPanelOpen(false);
  }, [expandedIndex]);

  useDismissOnSceneClick(() => setPanelOpen(false), panelOpen);

  const size = SIMPLE_MODE.BUBBLE_SIZE;
  const bottom = SCENE_BOTTOM_BAR.HEIGHT + SIMPLE_MODE.LISTENERS_BOTTOM_GAP + dockLift;
  const stackCount = items.length + 1; // + the add button
  const headingBottom = bottom + stackCount * (size + SIMPLE_MODE.BUBBLE_GAP);
  const openItem = panelOpen && expandedIndex !== null ? items[expandedIndex] : undefined;

  const handleClick = (index: number) => {
    if (expandedIndex !== index) onToggle(index);
    else setPanelOpen((open) => !open);
  };

  return (
    <>
      <BubbleHeading style={{ right: SIMPLE_MODE.EDGE_MARGIN, bottom: headingBottom }}>Listeners</BubbleHeading>
      <div
        className="bubble-column transition-all duration-300"
        style={{
          right: SIMPLE_MODE.EDGE_MARGIN,
          bottom,
          gap: SIMPLE_MODE.BUBBLE_GAP,
          flexDirection: 'column-reverse',
          alignItems: 'flex-end',
          zIndex: SIMPLE_MODE.Z_INDEX,
        }}
      >
        <BubbleAddButton
          label="Add listener"
          labelSide="left"
          tone="listener"
          size={size}
          active={addMenu !== null}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            // Opens up-left of the corner; ContextMenu clamps into the viewport.
            setAddMenu({ x: rect.left, y: rect.top });
          }}
        />
        {items.map((item, index) => {
          const active = expandedIndex === index;
          const showExit = active && !panelOpen && item.type === 'listener';
          return (
            <div key={item.id} className="flex items-center" style={{ gap: SIMPLE_MODE.BUBBLE_GAP }}>
            {showExit && <BubbleExitButton label="Leave FPS view" labelSide="left" onClick={() => onToggle(null)} />}
            <Bubble
              label={item.name}
              detail={
                active
                  ? 'Active — click to open'
                  : item.type === 'grid-listener' ? 'Grid listener — click to show' : 'Listener — click to listen here'
              }
              icon={item.type === 'grid-listener' ? <ListenerGridIcon size={size / 2} /> : <ListenerIcon size={size / 2} />}
              size={size}
              labelSide="left"
              ready={isListenerReady(item)}
              selected={active}
              tone="listener"
              onClick={() => handleClick(index)}
            />
            </div>
          );
        })}
      </div>

      {addMenu && (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          title="Add listener"
          items={AVAILABLE_TYPES.map((t) => ({ key: t.type, label: t.label, onClick: () => onAddItem(t.type) }))}
          onClose={() => setAddMenu(null)}
        />
      )}

      {openItem && expandedIndex !== null && (
        <div
          className="bubble-card-host"
          style={{
            right: SIMPLE_MODE.EDGE_MARGIN + size + SIMPLE_MODE.PANEL_GAP,
            bottom,
            width: SIMPLE_MODE.PANEL_WIDTH,
            maxHeight: SIMPLE_MODE.PANEL_MAX_HEIGHT,
            zIndex: SIMPLE_MODE.Z_INDEX,
          }}
        >
          {renderCard(openItem, expandedIndex, true, () => setPanelOpen(false), {
            onReduce: () => setPanelOpen(false),
            extraMenu: [{
              key: 'stop-listening',
              icon: <ListenerIcon size={12} />,
              label: openItem.type === 'listener' ? 'Stop listening here' : 'Hide grid points',
              onClick: (e) => {
                e.stopPropagation();
                onToggle(null);
              },
            }],
          })}
        </div>
      )}
    </>
  );
}

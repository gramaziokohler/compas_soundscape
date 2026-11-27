'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { ReceiverData, GridListenerData, ListenerExpandRequest } from '@/types/receiver';
import type { CardType, CustomMenuItem } from '@/types/card';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { SingleListenerContent } from './listeners/SingleListenerContent';
import { GridListenerContent } from './listeners/GridListenerContent';
import { HeatmapListenerContent } from './listeners/HeatmapListenerContent';
import { ListenerBubbles, type FloatingCardOptions } from './listeners/ListenerBubbles';
import type { ListenerItemConfig } from './listeners/listenerItems';
import { useGridListenersStore } from '@/store/gridListenersStore';
import { useReceiversStore } from '@/store/receiversStore';
import { usePositionClipboardStore, useHeatmapListenersStore } from '@/store';
import { useHeatmapGradient } from '@/hooks/useHeatmapGradient';
import { useOnFloatingPanelsCollapse } from '@/hooks/useOnFloatingPanelsCollapse';
import { useCanEdit } from '@/hooks/useCanEdit';
import { FpsLockedNotice } from './listeners/FpsLockedNotice';

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
  /** Powered single listener (viewer locked in its FPS view), or null. */
  poweredListenerId: string | null;
  /** Powered grid listener (its points shown in the viewer), or null. */
  activeGridListenerId: string | null;
  /** Power a grid listener on / off (one powered listener at a time). */
  onToggleGridListenerPower: (id: string) => void;
  onExitFPS?: () => void;
  /** Viewer in first-person view (a single listener, or a point of the powered grid). */
  isFPSModeActive?: boolean;
  /** Expand a listener / grid card from outside (viewer click, go-to-listener). */
  listenerExpandRequest?: ListenerExpandRequest | null;
  /**
   * `section` (default) = card list in the right sidebar. `bubbles` = Simple-mode
   * bottom-right stack of listener bubbles + one floating card panel.
   */
  presentation?: 'section' | 'bubbles';
}

const LISTENER_COLOR = 'var(--color-receiver)';

const SINGLE_POWER_TITLES = { on: 'Stop listening', off: 'Listen from here' };
const GRID_POWER_TITLES = { on: 'Hide grid points', off: 'Show grid points' };
const HEATMAP_POWER_TITLES = { on: 'Hide heatmap', off: 'Show heatmap' };

const AVAILABLE_TYPES: CardTypeOption[] = [
  { type: 'listener', label: 'Single listener', enabled: true },
  { type: 'grid-listener', label: 'Grid listener', enabled: true },
  { type: 'heatmap-listener', label: 'Heatmap', enabled: true },
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
  poweredListenerId,
  activeGridListenerId,
  onToggleGridListenerPower,
  onExitFPS,
  isFPSModeActive = false,
  listenerExpandRequest,
  presentation = 'section',
}: ListenersSectionProps) {
  const { updateGridListener, toggleGridListenerHiddenForSimulation, reorderGridListeners, duplicateGridListenerAt } = useGridListenersStore();
  const reorderReceivers = useReceiversStore((s) => s.reorderReceivers);
  // Heatmaps live in their own store; their power (gradient plane shown) is store state too.
  const heatmapListeners = useHeatmapListenersStore((s) => s.heatmapListeners);
  const activeHeatmapId = useHeatmapListenersStore((s) => s.activeHeatmapId);
  useHeatmapGradient();
  const duplicateReceiverAt = useReceiversStore((s) => s.duplicateReceiverAt);

  // Expanded card (single or grid) — UI only. Powering a listener (FPS view /
  // grid points) is separate: the card header's power button.
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  // A bubble's "Rename": the floating card opens with its title editable.
  const [renameRequest, setRenameRequest] = useState<{ id: string; seq: number } | null>(null);
  // Opening a model / reloading the page starts with every listener pop-up reduced.
  useOnFloatingPanelsCollapse(() => setExpandedItemId(null));
  const prevGridCountRef = useRef(gridListeners.length);
  const prevHeatmapCountRef = useRef(heatmapListeners.length);

  // Copied position for the right-click "Paste position" menu item (shared across
  // sound + listener cards). Null when nothing has been copied yet.
  const copiedPosition = usePositionClipboardStore((s) => s.position);

  // Auto-expand newly added grid listener (expanded only — power stays off)
  useEffect(() => {
    if (gridListeners.length > prevGridCountRef.current) {
      const newest = gridListeners[gridListeners.length - 1];
      if (newest) setExpandedItemId(newest.id);
    }
    prevGridCountRef.current = gridListeners.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridListeners.length]);

  // Auto-expand a newly added heatmap (power stays off until its surface is set)
  useEffect(() => {
    if (heatmapListeners.length > prevHeatmapCountRef.current) {
      const newest = heatmapListeners[heatmapListeners.length - 1];
      if (newest) setExpandedItemId(newest.id);
    }
    prevHeatmapCountRef.current = heatmapListeners.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapListeners.length]);

  // One powered listener at a time: an FPS view or a powered grid turns the heatmap off.
  useEffect(() => {
    if (poweredListenerId !== null || activeGridListenerId !== null) {
      useHeatmapListenersStore.getState().setActiveHeatmap(null);
    }
  }, [poweredListenerId, activeGridListenerId]);

  // Expand a card on request from outside (viewer click / double-click, go-to-listener)
  useEffect(() => {
    if (listenerExpandRequest) setExpandedItemId(listenerExpandRequest.id);
  }, [listenerExpandRequest]);

  // Power controls grid listener visibility: only the powered grid's listener
  // dots are shown in the 3D scene (drives showListeners, which the scene /
  // filter logic in page.tsx reads).
  useEffect(() => {
    const { gridListeners: grids } = useGridListenersStore.getState();
    for (const g of grids) {
      const shouldShow = g.id === activeGridListenerId;
      if (g.showListeners !== shouldShow) {
        updateGridListener(g.id, { showListeners: shouldShow });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGridListenerId, gridListeners.length]);

  // Unified items array for CardSection
  const items = useMemo<ListenerItemConfig[]>(() => [
    ...receivers.map(r => ({ ...r, type: 'listener' as const })),
    ...gridListeners.map(g => ({ ...g, type: 'grid-listener' as const })),
    ...heatmapListeners.map(h => ({ ...h, type: 'heatmap-listener' as const })),
  ], [receivers, gridListeners, heatmapListeners]);

  const indexOfId = useCallback((id: string | null): number | null => {
    if (id == null) return null;
    const idx = items.findIndex(i => i.id === id);
    return idx >= 0 ? idx : null;
  }, [items]);

  const expandedIndex = useMemo(() => indexOfId(expandedItemId), [indexOfId, expandedItemId]);
  const poweredIndex = useMemo(
    () => indexOfId(poweredListenerId) ?? indexOfId(activeGridListenerId) ?? indexOfId(activeHeatmapId),
    [indexOfId, poweredListenerId, activeGridListenerId, activeHeatmapId],
  );

  const handleExpandedIndexChange = useCallback((index: number | null) => {
    setExpandedItemId(index === null ? null : items[index]?.id ?? null);
  }, [items]);

  // Grid whose point the viewer is standing on (FPS on a grid listener point)
  const fpsGridListenerId = isFPSModeActive && poweredListenerId === null ? activeGridListenerId : null;
  const canEdit = useCanEdit();

  const isItemPowered = useCallback((item: ListenerItemConfig) => {
    if (item.type === 'listener') return poweredListenerId === item.id;
    if (item.type === 'heatmap-listener') return activeHeatmapId === item.id;
    return activeGridListenerId === item.id;
  }, [poweredListenerId, activeGridListenerId, activeHeatmapId]);

  /** Toggle an item's power. Single → FPS view (onGoToReceiver toggles it off when active). */
  const toggleItemPower = useCallback((item: ListenerItemConfig) => {
    if (item.type === 'listener') {
      onGoToReceiver(item.id);
    } else if (item.type === 'grid-listener') {
      onToggleGridListenerPower(item.id);
    } else {
      const heatmapStore = useHeatmapListenersStore.getState();
      if (heatmapStore.activeHeatmapId === item.id) {
        heatmapStore.setActiveHeatmap(null);
        return;
      }
      // Powering a heatmap leaves the FPS view / hides the powered grid first.
      if (poweredListenerId !== null) onExitFPS?.();
      if (activeGridListenerId !== null) onToggleGridListenerPower(activeGridListenerId);
      heatmapStore.setActiveHeatmap(item.id);
    }
  }, [onGoToReceiver, onToggleGridListenerPower, onExitFPS, poweredListenerId, activeGridListenerId]);

  // Bubbles: power an item on (index) or switch the powered one off (null)
  const handleBubblePower = useCallback((index: number | null) => {
    const target = index !== null ? items[index] : poweredIndex !== null ? items[poweredIndex] : undefined;
    if (!target) return;
    if (index !== null && isItemPowered(target)) return;
    toggleItemPower(target);
  }, [items, poweredIndex, isItemPowered, toggleItemPower]);

  const handleAddItem = useCallback((type: CardType) => {
    if (type === 'listener') onAddReceiver('single');
    else if (type === 'grid-listener') onAddGridListener();
    else if (type === 'heatmap-listener') useHeatmapListenersStore.getState().addHeatmapListener();
  }, [onAddReceiver, onAddGridListener]);

  const handleUpdateConfig = useCallback((index: number, updates: Partial<ListenerItemConfig>) => {
    const item = items[index];
    if (!item || !('display_name' in updates) || updates.display_name === undefined) return;
    if (item.type === 'listener') {
      onUpdateReceiverName(item.id, updates.display_name);
    } else if (item.type === 'heatmap-listener') {
      useHeatmapListenersStore.getState().updateHeatmapListener(item.id, { name: updates.display_name });
    } else {
      updateGridListener(item.id, { name: updates.display_name });
    }
  }, [items, onUpdateReceiverName, updateGridListener]);

  const handleRemove = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    if (expandedItemId === item.id) setExpandedItemId(null);
    if (item.type === 'listener') {
      if (poweredListenerId === item.id) onExitFPS?.();
      onDeleteReceiver(item.id);
    } else if (item.type === 'heatmap-listener') {
      useHeatmapListenersStore.getState().removeHeatmapListener(item.id);
    } else {
      if (activeGridListenerId === item.id) onToggleGridListenerPower(item.id);
      onDeleteGridListener(item.id);
    }
  }, [items, expandedItemId, poweredListenerId, activeGridListenerId, onDeleteReceiver, onDeleteGridListener, onExitFPS, onToggleGridListenerPower]);

  // Items are laid out by type: [receivers | grids | heatmaps]. Reorder and duplicate
  // stay within a type (cross-type moves are silently ignored).
  const typeRanges = useMemo(() => {
    const nR = receivers.length;
    const nG = gridListeners.length;
    return [
      { start: 0, end: nR },
      { start: nR, end: nR + nG },
      { start: nR + nG, end: nR + nG + heatmapListeners.length },
    ];
  }, [receivers.length, gridListeners.length, heatmapListeners.length]);

  const rangeOf = useCallback(
    (index: number) => typeRanges.findIndex((r) => index >= r.start && index < r.end),
    [typeRanges],
  );

  const handleReorder = useCallback((from: number, to: number) => {
    const kind = rangeOf(from);
    if (kind < 0 || rangeOf(to) !== kind) return;
    const { start } = typeRanges[kind];
    if (kind === 0) reorderReceivers(from, to);
    else if (kind === 1) reorderGridListeners(from - start, to - start);
    else useHeatmapListenersStore.getState().reorderHeatmapListeners(from - start, to - start);
  }, [rangeOf, typeRanges, reorderReceivers, reorderGridListeners]);

  // Ctrl+drag duplicate — insert positions stay within the item's type range
  // (end inclusive: after its last item); cross-type drops are silently ignored.
  const handleDuplicate = useCallback((from: number, toInsertion: number) => {
    const kind = rangeOf(from);
    if (kind < 0) return;
    const { start, end } = typeRanges[kind];
    if (toInsertion < start || toInsertion > end) return;
    if (kind === 0) duplicateReceiverAt(from, toInsertion);
    else if (kind === 1) duplicateGridListenerAt(from - start, toInsertion - start);
    else useHeatmapListenersStore.getState().duplicateHeatmapListenerAt(from - start, toInsertion - start);
  }, [rangeOf, typeRanges, duplicateReceiverAt, duplicateGridListenerAt]);


  const header = (
    <div className="flex items-center gap-2 w-full justify-between">
      <div className="text-xs font-medium text-warning">
        Listener cards
      </div>
    </div>
      );

  // Card / bubble right-click rows: the same menu on an expanded card and on its bubble.
  const buildListenerMenu = useCallback((item: ListenerItemConfig): CustomMenuItem[] => {
    // Heatmaps never feed the IR simulations: nothing to hide or copy.
    if (item.type === 'heatmap-listener') return [];
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

    return [...clipboardButtons, hideButton];
  }, [onToggleReceiverHiddenForSimulation, toggleGridListenerHiddenForSimulation, onUpdateReceiverPosition, copiedPosition]);

  const renderCard = useCallback((
    item: ListenerItemConfig,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (i: number) => void,
    floating?: FloatingCardOptions,
  ) => {
    const isPowered = isItemPowered(item);
    const isHidden = item.type !== 'heatmap-listener' && (item.hiddenForSimulation ?? false);

    // Share view: listeners are only powered on/off — no position / orientation /
    // grid editors, clipboard or hide buttons.
    const content = !canEdit ? (
      isPowered && item.type === 'listener' ? <FpsLockedNotice /> : null
    ) : item.type === 'listener' ? (
      <SingleListenerContent
        receiver={item}
        color={LISTENER_COLOR}
        onUpdatePosition={onUpdateReceiverPosition}
        isPowered={isPowered}
      />
    ) : item.type === 'heatmap-listener' ? (
      <HeatmapListenerContent
        heatmap={item}
        color={LISTENER_COLOR}
        onComputeBounds={onComputeBounds}
        isPowered={isPowered}
        onPowerOn={() => { if (!isPowered) toggleItemPower(item); }}
      />
    ) : (
      <GridListenerContent
        grid={item}
        color={LISTENER_COLOR}
        onComputeBounds={onComputeBounds}
        isPowered={isPowered}
        isInFPS={fpsGridListenerId === item.id}
        onPowerOn={() => { if (!isPowered) toggleItemPower(item); }}
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
          customButtons={canEdit ? [...buildListenerMenu(item), ...(floating?.extraMenu ?? [])] : floating?.extraMenu}
          renameRequest={renameRequest?.id === item.id ? renameRequest.seq : undefined}
          onReduce={floating?.onReduce}
          onToggleExpand={onToggleExpand}
          onUpdateConfig={handleUpdateConfig as (index: number, updates: Partial<typeof item>) => void}
          onRemove={handleRemove}
          onTogglePower={() => toggleItemPower(item)}
          isPoweredOn={isPowered}
          powerTitles={item.type === 'listener' ? SINGLE_POWER_TITLES : item.type === 'heatmap-listener' ? HEATMAP_POWER_TITLES : GRID_POWER_TITLES}
          beforeContent={content}
        />
      </div>
    );
  }, [
    buildListenerMenu,
    renameRequest,
    handleUpdateConfig,
    handleRemove,
    onComputeBounds,
    onUpdateReceiverPosition,
    isItemPowered,
    toggleItemPower,
    fpsGridListenerId,
    canEdit,
  ]);

  if (presentation === 'bubbles') {
    return (
      <ListenerBubbles
        items={items}
        availableTypes={AVAILABLE_TYPES}
        activeIndex={poweredIndex}
        openIndex={expandedIndex}
        isFpsMode={poweredListenerId !== null || fpsGridListenerId !== null}
        onTogglePower={handleBubblePower}
        buildMenu={canEdit ? buildListenerMenu : undefined}
        onRename={canEdit ? (item) => {
          setExpandedItemId(item.id);
          setRenameRequest({ id: item.id, seq: Date.now() });
        } : undefined}
        onExitFps={() => onExitFPS?.()}
        onOpenChange={(index) => {
          setRenameRequest(null);
          handleExpandedIndexChange(index);
        }}
        onAddItem={handleAddItem}
        onReorder={canEdit ? handleReorder : undefined}
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
